"use client";

import { useCallback, useRef, useState } from "react";
import { parseTemperatureFromText } from "@/lib/parseTemperatureFromText";

const CONCURRENCY = 5;

async function transcribeClip(url) {
  const audioResp = await fetch(url);
  const audioBuf = await audioResp.arrayBuffer();
  const resp = await fetch("/api/dev/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audioBuf,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "transcribe failed");
  return data.text;
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
          localResults.push({
            ...item,
            transcript: text,
            parsed,
            valueCorrect,
            unitCorrect,
            correct: valueCorrect && unitCorrect,
          });
        } catch (err) {
          localResults.push({ ...item, error: String(err.message || err), correct: false });
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
      <button
        onClick={run}
        disabled={running}
        className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-40 mb-4"
      >
        {running ? `Running… (${done}/${manifestLen})` : "Run accuracy test"}
      </button>

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
  return { total, correct, byNoise };
}

function MarkdownSummary({ summary }) {
  if (summary.total === 0) return null;
  const pct = ((summary.correct / summary.total) * 100).toFixed(1);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4">
      <p className="font-semibold">
        {summary.correct}/{summary.total} correct ({pct}%)
      </p>
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
