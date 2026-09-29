"use client";

import { useCallback, useRef, useState } from "react";
import { parseTemperatureFromText } from "@/lib/parseTemperatureFromText";
import { evaluateReading } from "@/lib/ruleEngine";

function celsiusToFahrenheit(c) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

// Runs the same deterministic rule engine the live app uses against a
// {location, food_item, reading_type, value, unit} reading, so the harness
// can ask "what would TempCheck's dashboard actually have shown for this
// number?" for both the ground-truth reading and whatever was parsed from
// the real STT transcript.
function evalAgainstRuleEngine(item, value, unit) {
  if (!Number.isFinite(value)) return evaluateReading({ temperatureF: NaN });
  const temperatureF = unit === "C" ? celsiusToFahrenheit(value) : value;
  return evaluateReading({
    location: item.expected.location,
    foodItem: item.expected.food_item,
    readingType: item.expected.reading_type,
    temperatureF,
  });
}

// The headline number everyone will ask about first: of every clip where
// the STT/parser got the number wrong, how would that wrong number
// actually have played out on the real dashboard, given the amber/red
// rule-engine verdict (ruleEngine.js)? Amber is now a compliant close-call
// tier (not a violation) that still gets an explicit spoken confirmation
// before moving on, same as before under the retired confirmRecommended
// field — so it still counts as "caught," not silent.
//   - "silent_false_safe": the wrong number logs as a plain "safe" reading
//     with no confirmation prompt, while the TRUE reading was actually
//     amber/red/unknown — the exact, critical failure mode this metric
//     exists to catch and hold at zero.
//   - "caught_by_confirmation": the wrong number is itself amber (a
//     compliant close call that still gets a yes/no confirmation) or red
//     (which gets a spoken corrective-action question) — the mistake
//     doesn't slip through silently, even though the logged number is wrong.
//   - "rejected_as_unknown": the wrong number (or a parse failure) lands in
//     the "unknown" category/implausible-range guard, which already forces
//     a clarifying question before anything is logged.
//   - "wrong_but_harmless": the number is wrong, but not in a way that
//     changes the safety verdict at all (e.g. off by a degree, still safe
//     either way) — an accuracy miss, not a safety miss.
function classifyMiss(item, parsed) {
  const truth = evalAgainstRuleEngine(item, item.expected.temperature_value, item.expected.temperature_unit);
  const logged = evalAgainstRuleEngine(item, parsed?.value, parsed?.unit);

  if (logged.status === "unknown") return "rejected_as_unknown";
  if (logged.status === "amber" || logged.status === "red") {
    return "caught_by_confirmation";
  }
  if (logged.status === "safe" && truth.status !== "safe") return "silent_false_safe";
  return "wrong_but_harmless";
}

// Lowered from 5 (then 3) after live runs showed the AssemblyAI async-v2
// queue backing up under sustained concurrent load, and a long unattended
// run holding many simultaneous connections made the browser tab shed
// requests wholesale ("Failed to fetch" on ~645/648 clips with no
// AssemblyAI-side error at all) once backgrounded for an extended stretch.
// Fewer simultaneous connections plus the retry wrapper above make a full
// run of the expanded test set survive both kinds of hiccup.
const CONCURRENCY = 2;

// A browser fetch() has no built-in timeout: if the underlying connection
// goes silent (observed live — the laptop running this harness slept
// mid-run and some in-flight requests never resolved OR rejected on wake),
// the promise just hangs forever. Since a worker awaits one clip at a time,
// a single hung fetch permanently stalls that worker (and Cancel can't help
// — the cancel check only runs between clips, never inside a still-pending
// await). Wrap every fetch in an AbortController timeout so a dead
// connection surfaces as a normal, retryable error instead of a silent
// hang that requires a full page reload to recover from.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeClipOnce(url) {
  const audioResp = await fetchWithTimeout(url, {}, 30000);
  if (!audioResp.ok) throw new Error(`clip fetch failed (${audioResp.status})`);
  const audioBuf = await audioResp.arrayBuffer();
  // The server side already gives itself up to 3 minutes to poll AssemblyAI
  // (see api/dev/transcribe/route.js); give the client fetch a bit more
  // headroom than that so a legitimately-slow-but-alive request isn't cut
  // off right as the server was about to answer.
  const resp = await fetchWithTimeout(
    "/api/dev/transcribe",
    { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: audioBuf },
    210000
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "transcribe failed");
  return data.text;
}

// A run against ~650 real clips takes long enough (each one is a real
// AssemblyAI round trip) that transient hiccups are expected: the async
// queue running slow, or the browser tab getting backgrounded for a long
// stretch and having a fetch or two get dropped ("Failed to fetch" with no
// AssemblyAI-side cause at all). One flaky attempt shouldn't count as a
// real accuracy failure and corrupt the measured number, so retry a few
// times with backoff before giving up on a clip.
async function transcribeClip(url, { attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await transcribeClipOnce(url);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export default function AccuracyTestPage() {
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

    const manifest = await fetch("/test-audio/manifest.json").then((r) => r.json());
    setManifestLen(manifest.length);

    const queue = [...manifest];
    const localResults = [];

    async function worker() {
      while (queue.length > 0 && !cancelRef.current) {
        const item = queue.shift();
        if (!item) break;
        try {
          const text = await transcribeClip(`/test-audio/${item.file}`);
          const parsed = parseTemperatureFromText(text);
          const expected = item.expected;
          const valueCorrect = parsed.value === expected.temperature_value;
          const unitCorrect = parsed.unit === expected.temperature_unit;
          const correct = valueCorrect && unitCorrect;
          localResults.push({
            ...item,
            transcript: text,
            parsed,
            valueCorrect,
            unitCorrect,
            correct,
            missClass: correct ? null : classifyMiss(item, parsed),
          });
        } catch (err) {
          localResults.push({
            ...item,
            error: String(err.message || err),
            correct: false,
            missClass: classifyMiss(item, null),
          });
        }
        setDone((d) => d + 1);
        setResults([...localResults]);
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    setRunning(false);
  }, []);

  const summary = summarize(results);

  return (
    <main className="max-w-5xl mx-auto p-6 text-sm">
      <h1 className="text-xl font-bold mb-2">TempCheck — Noisy-Kitchen Accuracy Test</h1>
      <p className="text-slate-400 mb-4">
        Internal QA harness. Runs every clip in /test-audio through the real AssemblyAI
        transcription API and compares the extracted number to ground truth. Not part of the
        cook-facing app.
      </p>
      <div className="flex gap-2 mb-4">
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-40"
        >
          {running ? `Running… (${done}/${manifestLen})` : "Run accuracy test"}
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
          <MarkdownSummary summary={summary} />
          <table className="w-full text-xs mt-4 border border-slate-800">
            <thead className="bg-slate-900">
              <tr>
                <th className="p-1 text-left">File</th>
                <th className="p-1 text-left">Noise</th>
                <th className="p-1 text-left">Expected</th>
                <th className="p-1 text-left">Transcript</th>
                <th className="p-1 text-left">Parsed</th>
                <th className="p-1 text-left">Miss class</th>
                <th className="p-1 text-left">OK</th>
              </tr>
            </thead>
            <tbody>
              {results
                .filter((r) => !r.correct)
                .map((r) => (
                  <tr key={r.file} className="border-t border-slate-800">
                    <td className="p-1">{r.file}</td>
                    <td className="p-1">{r.noise_condition}</td>
                    <td className="p-1">
                      {r.expected.temperature_value}
                      {r.expected.temperature_unit}
                    </td>
                    <td className="p-1">{r.transcript || r.error}</td>
                    <td className="p-1">
                      {r.parsed ? `${r.parsed.value}${r.parsed.unit || ""}` : "—"}
                    </td>
                    <td className={`p-1 ${r.missClass === "silent_false_safe" ? "text-red-400 font-semibold" : ""}`}>
                      {r.missClass}
                    </td>
                    <td className="p-1">❌</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

function summarize(results) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const byNoise = {};
  for (const r of results) {
    const key = r.noise_condition;
    byNoise[key] = byNoise[key] || { total: 0, correct: 0 };
    byNoise[key].total += 1;
    if (r.correct) byNoise[key].correct += 1;
  }
  const missClasses = { silent_false_safe: 0, caught_by_confirmation: 0, rejected_as_unknown: 0, wrong_but_harmless: 0 };
  const silentFalseSafeItems = [];
  for (const r of results) {
    if (!r.missClass) continue;
    missClasses[r.missClass] = (missClasses[r.missClass] || 0) + 1;
    if (r.missClass === "silent_false_safe") silentFalseSafeItems.push(r);
  }
  const misses = total - correct;
  return { total, correct, byNoise, missClasses, misses, silentFalseSafeItems };
}

function MarkdownSummary({ summary }) {
  if (summary.total === 0) return null;
  const pct = ((summary.correct / summary.total) * 100).toFixed(1);
  const sfs = summary.missClasses.silent_false_safe;
  const sfsRate = ((sfs / summary.total) * 100).toFixed(2);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4">
      <p className="font-semibold">
        {summary.correct}/{summary.total} correct ({pct}%)
      </p>
      <p className={`mt-2 font-semibold ${sfs > 0 ? "text-red-400" : "text-emerald-400"}`}>
        Silent false-safe rate: {sfs}/{summary.total} ({sfsRate}%)
      </p>
      {summary.misses > 0 && (
        <p className="mt-1 text-slate-400 text-xs">
          Of {summary.misses} misses: {summary.missClasses.caught_by_confirmation} caught by
          amber/red or the close-call confirmation, {summary.missClasses.rejected_as_unknown}{" "}
          rejected as unknown, {summary.missClasses.wrong_but_harmless} wrong but harmless
          (didn&apos;t change the verdict), {sfs} silent false-safe.
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {Object.entries(summary.byNoise).map(([noise, s]) => (
          <li key={noise}>
            {noise}: {s.correct}/{s.total} ({((s.correct / s.total) * 100).toFixed(1)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}
