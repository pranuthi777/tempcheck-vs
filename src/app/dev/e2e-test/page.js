"use client";

// Round-2 critique #P1-7: the offline accuracy harness (/dev/accuracy-test)
// measures AssemblyAI's raw STT + this app's own regex parser — it never
// exercises the two things that differ in the real product: the live Voice
// Agent's `keyterms` word-boost list, and the LLM's own field extraction
// from a transcript into a `log_reading` tool call. This page runs a
// smaller, curated set of the SAME clips through the REAL production path
// — /api/token -> the real AssemblyAI Voice Agent WebSocket -> the real
// session config from agentConfig.js -> a real tool call — and scores the
// actual tool-call arguments the LLM extracted, not a transcript parsed
// offline. Internal QA only, not part of the cook-facing app.
//
// Clip selection (public/test-audio/e2e-manifest.json, 55 clips): every one
// of the 36 distinct ground-truth phrases from the full 648-clip set at
// least once (clean audio, one voice), PLUS extra voice variants for every
// self-correction phrase (4 of them — the exact case the README already
// discloses as sometimes failing live) and the two FDA boundary-value
// phrases (41°F, 135°F), so those specific real-product risks are
// deliberately over-sampled rather than diluted into a single average.

import { useCallback, useRef, useState } from "react";
import { buildSessionUpdate } from "@/lib/agentConfig";
import { int16BufferToBase64 } from "@/lib/pcmBase64";

const SAMPLE_RATE = 24000;
const CHUNK_MS = 100;
const CHUNK_SAMPLES = (SAMPLE_RATE * CHUNK_MS) / 1000;
const TRAILING_SILENCE_MS = 1600;
const TOOL_CALL_TIMEOUT_MS = 20000;
const SESSION_READY_TIMEOUT_MS = 10000;

function celsiusToFahrenheit(c) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

// Decodes a clip file into 24kHz mono PCM16 — decodeAudioData resamples to
// whatever sample rate the AudioContext was created with, same as the real
// mic-capture / demo-capture paths (micCapture.js), so this exercises the
// exact same audio format the Voice Agent actually receives from the app.
async function decodeClipToInt16(url) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor({ sampleRate: SAMPLE_RATE });
  try {
    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const samples = audioBuffer.getChannelData(0);
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  } finally {
    await ctx.close();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Runs ONE clip through the real Voice Agent WebSocket end to end: open a
// fresh session (a fresh token + a fresh session.update, exactly like a
// real shift starting), stream the clip's real audio at real-time pacing,
// stream trailing silence so the server's own turn-detection has something
// to detect the end of speech against, and capture the first tool.call's
// raw arguments. Deliberately does NOT send a tool.result back — this is
// scoring extraction, not a full conversational round trip, and closing
// right after capture keeps each clip's session short.
async function runClipEndToEnd(item) {
  const int16 = await decodeClipToInt16(`/test-audio/${item.file}`);

  const tokenResp = await fetch("/api/token");
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(tokenData.error || "token request failed");

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${tokenData.token}`);
    let settled = false;
    let sessionReady = false;
    let greetingDone = false;
    let toolCallTimer = null;
    let sessionReadyTimer = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(toolCallTimer);
      clearTimeout(sessionReadyTimer);
      try {
        ws.send(JSON.stringify({ type: "session.end" }));
      } catch {
        /* already closing */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    }

    sessionReadyTimer = setTimeout(() => {
      finish({ error: "session.ready timed out" });
    }, SESSION_READY_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify(buildSessionUpdate()));
    };

    ws.onerror = () => {
      if (!settled) finish({ error: "WebSocket error" });
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "session.ready" && !sessionReady) {
        sessionReady = true;
        clearTimeout(sessionReadyTimer);
        // Real fix, found by running this harness against the live
        // pipeline: session.ready immediately triggers the agent's own
        // spoken greeting (a real reply.started/reply.audio/reply.done
        // turn). Streaming the clip's audio starting at session.ready, the
        // same instant, overlaps that greeting — the server's turn
        // detection does not treat audio arriving during the agent's own
        // reply as real user speech (a real cook doesn't start talking
        // over the greeting either), so the clip's audio was effectively
        // getting lost, and only a stray fragment surfaced much later.
        // Waiting for the greeting's own reply.done below, THEN streaming
        // the clip, matches how a real shift actually starts.
      }

      if (msg.type === "reply.done" && !greetingDone) {
        greetingDone = true;
        // Stream the real clip audio at real-time pacing, now that the
        // agent has finished its own greeting.
        //
        // Bug found by running this harness against production: if the
        // WebSocket closes mid-stream (server hangup, network blip), a bare
        // ws.send() throws synchronously. That throw happens inside this
        // async onmessage handler, so it becomes an unhandled promise
        // rejection — it never reaches the outer runClipEndToEnd Promise,
        // finish() never runs, and that clip's await hangs forever, freezing
        // the whole sequential harness loop. Wrapping each streaming loop in
        // try/catch and routing a failure through finish() guarantees the
        // clip's promise always settles.
        try {
          for (let i = 0; i < int16.length; i += CHUNK_SAMPLES) {
            const chunk = int16.subarray(i, i + CHUNK_SAMPLES);
            ws.send(JSON.stringify({ type: "input.audio", audio: int16BufferToBase64(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)) }));
            await sleep(CHUNK_MS);
          }
          // Trailing silence so the server's turn-detection has a real gap
          // to key off, same as a cook pausing after speaking.
          const silenceChunk = new Int16Array(CHUNK_SAMPLES);
          const silenceB64 = int16BufferToBase64(silenceChunk.buffer);
          for (let t = 0; t < TRAILING_SILENCE_MS; t += CHUNK_MS) {
            ws.send(JSON.stringify({ type: "input.audio", audio: silenceB64 }));
            await sleep(CHUNK_MS);
          }
        } catch (err) {
          finish({ error: "WebSocket closed mid-stream: " + String(err?.message || err) });
          return;
        }

        toolCallTimer = setTimeout(() => {
          finish({ error: "No tool call received before timeout" });
        }, TOOL_CALL_TIMEOUT_MS);
      }

      if (msg.type === "tool.call") {
        finish({ arguments: msg.arguments || {} });
      }

      if (msg.type === "session.error") {
        finish({ error: msg.error || "session.error" });
      }
    };

    ws.onclose = () => {
      if (!settled) finish({ error: "WebSocket closed before a tool call arrived" });
    };
  });
}

function scoreResult(item, outcome) {
  const expected = item.expected;
  if (outcome.error) {
    return { ...item, outcome, correct: false, receivedF: null, note: outcome.error };
  }
  const args = outcome.arguments;
  const value = typeof args.temperature_value === "number" ? args.temperature_value : null;
  const unit = args.temperature_unit === "C" ? "C" : "F";
  const receivedF = value === null ? null : unit === "C" ? celsiusToFahrenheit(value) : value;
  const expectedF =
    expected.temperature_unit === "C" ? celsiusToFahrenheit(expected.temperature_value) : expected.temperature_value;
  // Score on the Fahrenheit-normalized value (matches how the rule engine
  // itself compares) rather than requiring the exact same unit word back —
  // the LLM is free to log in either unit as long as the real temperature
  // logged is correct.
  const correct = receivedF !== null && Math.abs(receivedF - expectedF) < 0.5;
  return { ...item, outcome, correct, receivedF, expectedF };
}

export default function EndToEndTestPage() {
  const [manifestLen, setManifestLen] = useState(0);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setDone(0);
    cancelRef.current = false;

    const manifest = await fetch("/test-audio/e2e-manifest.json").then((r) => r.json());
    setManifestLen(manifest.length);

    const localResults = [];
    // Sequential, not concurrent: each clip opens its own real Voice Agent
    // session (a real WebSocket, a real LLM turn) — running many at once
    // would be an unrealistic multi-session load test, not a measurement
    // of ordinary single-cook usage, and would make timeouts/tool-call
    // ordering ambiguous to score.
    for (const item of manifest) {
      if (cancelRef.current) break;
      try {
        const outcome = await runClipEndToEnd(item);
        localResults.push(scoreResult(item, outcome));
      } catch (err) {
        localResults.push(scoreResult(item, { error: String(err.message || err) }));
      }
      setDone((d) => d + 1);
      setResults([...localResults]);
      await sleep(500);
    }
    setRunning(false);
  }, []);

  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const pct = total > 0 ? ((correct / total) * 100).toFixed(1) : "—";

  return (
    <main className="max-w-5xl mx-auto p-6 text-sm">
      <h1 className="text-xl font-bold mb-2">TempCheck — End-to-End Voice Agent Accuracy</h1>
      <p className="text-slate-400 mb-4">
        Internal QA harness. Runs a curated 55-clip subset through the REAL production path
        (token -&gt; live Voice Agent WebSocket -&gt; real session config -&gt; real tool call) and
        scores the actual log_reading arguments the LLM extracted — not an offline transcript
        parse. Not part of the cook-facing app. Each run costs real AssemblyAI usage.
      </p>
      <div className="flex gap-2 mb-4">
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-40"
        >
          {running ? `Running… (${done}/${manifestLen})` : "Run end-to-end test"}
        </button>
        {running && (
          <button
            onClick={() => {
              cancelRef.current = true;
            }}
            className="px-4 py-2 rounded bg-red-700 hover:bg-red-600"
          >
            Cancel
          </button>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded p-4">
            <p className="font-semibold">
              {correct}/{total} correct ({pct}%)
            </p>
          </div>
          <table className="w-full text-xs mt-4 border border-slate-800">
            <thead className="bg-slate-900">
              <tr>
                <th className="p-1 text-left">File</th>
                <th className="p-1 text-left">Phrase</th>
                <th className="p-1 text-left">Expected °F</th>
                <th className="p-1 text-left">Logged °F</th>
                <th className="p-1 text-left">Note</th>
                <th className="p-1 text-left">OK</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.file} className="border-t border-slate-800">
                  <td className="p-1">{r.file}</td>
                  <td className="p-1">{r.phrase}</td>
                  <td className="p-1">{r.expectedF ?? "—"}</td>
                  <td className="p-1">{r.receivedF ?? "—"}</td>
                  <td className="p-1">{r.note || (r.outcome?.error ?? "")}</td>
                  <td className="p-1">{r.correct ? "✅" : "❌"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
