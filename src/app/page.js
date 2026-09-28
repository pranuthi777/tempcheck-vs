"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import { exportHaccpPdf } from "@/lib/haccpPdf";
import { loadShift, saveShift, clearShift } from "@/lib/shiftStorage";
import { playLogBeep, playAlertTone } from "@/lib/audioCues";
import BigDisplay from "@/components/BigDisplay";

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
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bigDisplay, setBigDisplay] = useState(false);
  const shiftStartRef = useRef(null);
  const shiftEndRef = useRef(null);
  const soundEnabledRef = useRef(true);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Restore an in-progress (or just-ended, not-yet-exported) shift from
  // localStorage on load — so a crashed tab or accidental reload doesn't
  // silently lose a shift's compliance record. See src/lib/shiftStorage.js.
  useEffect(() => {
    let cancelled = false;
    // Deferred a tick so this never fires synchronously during the mount
    // effect (avoids a same-render cascade) and so the server-rendered
    // (always-empty) HTML never mismatches the client's first paint.
    Promise.resolve().then(() => {
      if (cancelled) return;
      const saved = loadShift();
      if (saved && saved.readings.length > 0) {
        setReadings(saved.readings);
        shiftStartRef.current = saved.shiftStart ?? null;
        shiftEndRef.current = saved.shiftEnd ?? null;
        setRestoredNotice(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every change so a mid-shift crash never loses more than the
  // last render's worth of readings.
  useEffect(() => {
    if (readings.length === 0 && !shiftStartRef.current) return;
    saveShift({
      shiftStart: shiftStartRef.current,
      shiftEnd: shiftEndRef.current,
      readings,
    });
  }, [readings]);

  const onReading = useCallback((record) => {
    setRestoredNotice(false);
    setReadings((prev) => [record, ...prev]);
    if (soundEnabledRef.current) {
      if (record.status === "amber" || record.status === "red") {
        playAlertTone(record.status);
      } else {
        playLogBeep();
      }
    }
  }, []);

  const onTranscriptLine = useCallback((line) => {
    setTranscript((prev) => [...prev.slice(-30), line]);
  }, []);

  const {
    status,
    error,
    userCaption,
    agentCaption,
    connect,
    disconnect,
    pushToTalk,
    setPushToTalk,
    talking,
    startTalking,
    stopTalking,
  } = useVoiceAgent({
    onReading,
    onTranscriptLine,
  });

  const startShift = useCallback(() => {
    // A brand-new shift replaces whatever was persisted, including a
    // previously-restored, already-exported shift.
    clearShift();
    setReadings([]);
    setRestoredNotice(false);
    shiftStartRef.current = Date.now();
    shiftEndRef.current = null;
    connect();
  }, [connect]);

  const endShift = useCallback(() => {
    shiftEndRef.current = Date.now();
    saveShift({
      shiftStart: shiftStartRef.current,
      shiftEnd: shiftEndRef.current,
      readings,
    });
    disconnect();
  }, [disconnect, readings]);

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

  const isLive = status === "listening" || status === "connecting" || status === "reconnecting";

  if (bigDisplay) {
    return (
      <BigDisplay
        latestReading={readings[0] || null}
        summary={summary}
        isLive={isLive}
        onExit={() => setBigDisplay(false)}
      />
    );
  }

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4 py-6 gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TempCheck</h1>
          <p className="text-slate-400 text-sm">
            Hands-free HACCP-style temperature logging, built on AssemblyAI&apos;s Voice Agent API.
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

      {/* Hands-free controls: sound cues, big kitchen-display mode, and an
          optional push-to-talk mode for very loud kitchens where always-on
          listening picks up too much background noise. */}
      <div className="flex flex-wrap items-center gap-3 text-sm border-t border-b border-slate-800 py-2">
        <button
          onClick={() => setSoundEnabled((v) => !v)}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white transition"
          title="Beep on log, alert tone on amber/red"
        >
          <span>{soundEnabled ? "🔊" : "🔇"}</span>
          <span>Sound {soundEnabled ? "on" : "off"}</span>
        </button>
        <button
          onClick={() => setBigDisplay(true)}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white transition"
          title="Full-screen, glanceable from across the kitchen"
        >
          <span>⛶</span>
          <span>Big display</span>
        </button>
        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={pushToTalk}
            onChange={(e) => setPushToTalk(e.target.checked)}
            className="accent-emerald-500"
          />
          <span>Push-to-talk (loud kitchen)</span>
        </label>
        {pushToTalk && isLive && (
          <button
            onMouseDown={startTalking}
            onMouseUp={stopTalking}
            onMouseLeave={stopTalking}
            onTouchStart={(e) => {
              e.preventDefault();
              startTalking();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopTalking();
            }}
            className={`px-4 py-1.5 rounded-lg font-semibold select-none transition ${
              talking
                ? "bg-emerald-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {talking ? "🎙️ Listening — release when done" : "Hold to talk"}
          </button>
        )}
      </div>

      {restoredNotice && (
        <div className="rounded-lg border border-sky-800 bg-sky-950/50 text-sky-300 text-sm px-3 py-2">
          Restored {readings.length} reading{readings.length === 1 ? "" : "s"} from before this
          page was reloaded — nothing was lost. Export the PDF whenever you&apos;re ready, or
          press Start Shift to begin a new one.
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            status === "listening"
              ? "bg-emerald-400 animate-pulse"
              : status === "connecting" || status === "reconnecting"
              ? "bg-amber-400 animate-pulse"
              : status === "error"
              ? "bg-red-400"
              : "bg-slate-600"
          }`}
        />
        <span className="text-slate-400 capitalize">
          {status === "reconnecting" ? "Reconnecting…" : status}
        </span>
        {error && <span className="text-red-400">— {error}</span>}
      </div>

      {/* Live captions */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 min-h-[72px] text-sm space-y-1">
        {userCaption && <p className="text-slate-300">🎙️ {userCaption}</p>}
        {agentCaption && <p className="text-sky-300">🔊 {agentCaption}</p>}
        {!userCaption && !agentCaption && (
          <p className="text-slate-500">
            {!isLive
              ? "Press Start Shift and call out a reading."
              : pushToTalk
              ? "Hold the talk button and call out a reading."
              : "Listening for a reading…"}
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
                <p className="text-xs opacity-70">
                  {r.categoryLabel}
                  {r.coolingStage === "start" && " — cooling in progress"}
                </p>
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
                <th className="text-left px-3 py-2 font-medium">FDA Section</th>
                <th className="text-left px-3 py-2 font-medium">Cook&apos;s Words</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr key={`${r.id}-${r.timestamp}`} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">
                    {r.location || r.foodItem || "—"}
                    {r.coolingStage && (
                      <span className="ml-1.5 text-xs text-sky-400">
                        ({r.coolingStage === "start" ? "cooling start" : "cooling check"})
                      </span>
                    )}
                  </td>
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
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.citation || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 italic">{r.cookText || "—"}</td>
                </tr>
              ))}
              {readings.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
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
