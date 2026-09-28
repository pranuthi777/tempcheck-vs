"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import { exportHaccpPdf } from "@/lib/haccpPdf";

const STATUS_STYLES = {
  safe: "bg-emerald-500/15 border-emerald-500 text-emerald-300",
  amber: "bg-amber-500/15 border-amber-500 text-amber-300",
  red: "bg-red-500/15 border-red-500 text-red-300",
  unknown: "bg-slate-500/15 border-slate-500 text-slate-300",
};

const STATUS_DOT = {
  safe: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  unknown: "bg-slate-400",
};

export default function Home() {
  const [readings, setReadings] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const shiftStartRef = useRef(null);
  const shiftEndRef = useRef(null);

  const onReading = useCallback((record) => {
    setReadings((prev) => [record, ...prev]);
  }, []);

  const onTranscriptLine = useCallback((line) => {
    setTranscript((prev) => [...prev.slice(-30), line]);
  }, []);

  const { status, error, userCaption, agentCaption, connect, disconnect } = useVoiceAgent({
    onReading,
    onTranscriptLine,
  });

  const startShift = useCallback(() => {
    shiftStartRef.current = Date.now();
    shiftEndRef.current = null;
    connect();
  }, [connect]);

  const endShift = useCallback(() => {
    shiftEndRef.current = Date.now();
    disconnect();
  }, [disconnect]);

  const summary = useMemo(() => {
    const counts = { safe: 0, amber: 0, red: 0, unknown: 0 };
    for (const r of readings) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [readings]);

  // Latest reading per location/item, for the top status board.
  const latestByKey = useMemo(() => {
    const map = new Map();
    for (const r of readings) {
      const key = (r.location || r.foodItem || "unspecified").toLowerCase();
      if (!map.has(key)) map.set(key, r);
    }
    return Array.from(map.values());
  }, [readings]);

  const isLive = status === "listening" || status === "connecting";

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4 py-6 gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TempCheck</h1>
          <p className="text-slate-400 text-sm">
            Hands-free HACCP temperature logging, built on AssemblyAI&apos;s Voice Agent API.
          </p>
        </div>
        <div className="flex gap-2">
          {!isLive ? (
            <button
              onClick={startShift}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold transition"
            >
              Start Shift
            </button>
          ) : (
            <button
              onClick={endShift}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 font-semibold transition"
            >
              End Shift
            </button>
          )}
          <button
            onClick={() =>
              exportHaccpPdf(readings, {
                shiftStart: shiftStartRef.current,
                shiftEnd: shiftEndRef.current,
              })
            }
            disabled={readings.length === 0}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 font-semibold transition"
          >
            Export HACCP PDF
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            status === "listening"
              ? "bg-emerald-400 animate-pulse"
              : status === "connecting"
              ? "bg-amber-400 animate-pulse"
              : status === "error"
              ? "bg-red-400"
              : "bg-slate-600"
          }`}
        />
        <span className="text-slate-400 capitalize">{status}</span>
        {error && <span className="text-red-400">— {error}</span>}
      </div>

      {/* Live captions */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 min-h-[72px] text-sm space-y-1">
        {userCaption && <p className="text-slate-300">🎙️ {userCaption}</p>}
        {agentCaption && <p className="text-sky-300">🔊 {agentCaption}</p>}
        {!userCaption && !agentCaption && (
          <p className="text-slate-500">
            {isLive ? "Listening for a reading…" : "Press Start Shift and call out a reading."}
          </p>
        )}
      </div>

      {/* Status board */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Live Status Board
        </h2>
        {latestByKey.length === 0 ? (
          <p className="text-slate-500 text-sm">No readings logged yet this shift.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {latestByKey.map((r) => (
              <div
                key={r.id}
                className={`rounded-xl border-2 p-4 ${STATUS_STYLES[r.status] || STATUS_STYLES.unknown}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[r.status]}`} />
                  <span className="font-semibold capitalize">{r.status}</span>
                </div>
                <p className="text-sm opacity-90">{r.location || r.foodItem}</p>
                <p className="text-2xl font-bold">
                  {Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—"}
                </p>
                <p className="text-xs opacity-70">{r.categoryLabel}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-4 mt-3 text-xs text-slate-400">
          <span>Safe: {summary.safe}</span>
          <span>Amber: {summary.amber}</span>
          <span>Red: {summary.red}</span>
          <span>Unknown: {summary.unknown}</span>
        </div>
      </section>

      {/* Full log */}
      <section className="flex-1">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Full Log ({readings.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Location / Item</th>
                <th className="text-left px-3 py-2 font-medium">Temp</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Corrective Action</th>
                <th className="text-left px-3 py-2 font-medium">Cook&apos;s Words</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr key={`${r.id}-${r.timestamp}`} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">{r.location || r.foodItem || "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    {Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        STATUS_STYLES[r.status] || STATUS_STYLES.unknown
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.correctiveAction || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 italic">{r.cookText || "—"}</td>
                </tr>
              ))}
              {readings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No readings yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">Recent transcript</summary>
        <ul className="mt-2 space-y-1">
          {transcript.map((t, i) => (
            <li key={i}>
              <span className="font-semibold">{t.role === "user" ? "Cook" : "TempCheck"}:</span>{" "}
              {t.text} {t.interrupted && <em>(interrupted)</em>}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
