"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import { exportHaccpPdf } from "@/lib/haccpPdf";
import { loadShift, saveShift, clearShift } from "@/lib/shiftStorage";
import { playLogBeep, playAlertTone } from "@/lib/audioCues";
import { computeEntryHash, verifyHashChain, GENESIS_HASH } from "@/lib/hashChain";
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

// No station-by-station check schedule is configured (that would need its
// own setup UI), so the missed-check reminder uses one plain, honest
// signal instead: how long it's been since ANY reading was logged during
// a live shift. 45 minutes is a reasonable default gap for a kitchen that
// should be checking something regularly, not a regulatory number.
const MISSED_CHECK_MINUTES = 45;

export default function Home() {
  const [readings, setReadings] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bigDisplay, setBigDisplay] = useState(false);
  const [dateFilter, setDateFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("all");
  // Mirrors shiftStartRef.current for the one place that needs to read it
  // during render (the missed-check calculation below) — reading a ref's
  // .current directly during render isn't allowed, only in effects/handlers.
  const [shiftStartDisplay, setShiftStartDisplay] = useState(null);
  const shiftStartRef = useRef(null);
  const shiftEndRef = useRef(null);
  const soundEnabledRef = useRef(true);
  // Tamper-evident hash chain (Bug #5 / #26): each entry's hash depends on
  // the previous entry's hash, so lastHashRef always holds "what the next
  // entry must chain from." Restored from the newest restored reading's
  // own hash below, or GENESIS_HASH for a fresh shift.
  const lastHashRef = useRef(GENESIS_HASH);
  const [integrityResult, setIntegrityResult] = useState(null); // {verified, brokenAt, reason} | null
  // Pending cooling-curve starts (see coolingBatches.js / useVoiceAgent.js).
  // Mirrored here purely so it can be persisted to shiftStorage — the hook
  // owns the actual matching logic, this is just "what to save."
  const [coolingPending, setCoolingPending] = useState([]);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Restore an in-progress (or just-ended, not-yet-exported) shift from
  // localStorage on load — so a crashed tab or accidental reload doesn't
  // silently lose a shift's compliance record. See src/lib/shiftStorage.js.
  // Pending cooling-curve batches (coolingBatches.js) are restored via
  // restoreCoolingPending below, once — that function comes from
  // useVoiceAgent(), which is declared further down this component, so the
  // restored batches are staged here in a ref and picked up by a second
  // effect (after the useVoiceAgent() call) rather than called directly.
  const pendingCoolingRestoreRef = useRef(null);
  const [coolingRestoreTick, setCoolingRestoreTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Deferred a tick so this never fires synchronously during the mount
    // effect (avoids a same-render cascade) and so the server-rendered
    // (always-empty) HTML never mismatches the client's first paint.
    Promise.resolve().then(() => {
      if (cancelled) return;
      const saved = loadShift();
      if (saved && (saved.readings.length > 0 || saved.coolingPending?.length > 0)) {
        setReadings(saved.readings);
        shiftStartRef.current = saved.shiftStart ?? null;
        shiftEndRef.current = saved.shiftEnd ?? null;
        setShiftStartDisplay(shiftStartRef.current);
        setRestoredNotice(true);
        // readings are stored newest-first, so [0] is the last link in the
        // hash chain so far — resume from there, not from genesis, or
        // every reading after a reload would look like a broken chain.
        if (saved.readings[0]?.hash) lastHashRef.current = saved.readings[0].hash;
        pendingCoolingRestoreRef.current = saved.coolingPending || [];
        setCoolingRestoreTick((t) => t + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onReading = useCallback((record) => {
    setRestoredNotice(false);
    setReadings((prev) => {
      // A reading that corrects an earlier one (see correctionTracker.js /
      // useVoiceAgent.js) marks that earlier entry "superseded" instead of
      // leaving two unlinked entries side by side — the old one stays in
      // the log for the audit trail (never deleted), but is excluded from
      // live counts/summaries so a corrected-away "safe" or "red" reading
      // never lingers as if it were still current.
      const next = record.correctsReadingId
        ? prev.map((r) =>
            r.id === record.correctsReadingId
              ? { ...r, superseded: true, supersededAt: record.timestamp, supersededNote: record.correctionNote }
              : r
          )
        : prev;
      return [record, ...next];
    });
    if (soundEnabledRef.current) {
      if (record.status === "amber" || record.status === "red") {
        playAlertTone(record.status);
      } else {
        playLogBeep();
      }
    }

    // Tamper-evidence (Bug #5 / #26): fetch a server-issued timestamp and
    // extend the hash chain, then merge those fields onto this entry once
    // ready. Done AFTER the synchronous UI update above so network/crypto
    // latency never delays the cook's spoken readback — the reading is
    // already visible and already sent back to the voice agent; this just
    // fills in its tamper-evidence fields a beat later.
    (async () => {
      let serverTimestamp = null;
      try {
        const resp = await fetch("/api/log-timestamp");
        const data = await resp.json();
        serverTimestamp = data.timestamp || null;
      } catch {
        // Best-effort: if the server timestamp can't be fetched (offline,
        // deploy hiccup), the hash chain still runs off the client
        // timestamp alone rather than failing to log the reading at all.
      }
      const prevHash = lastHashRef.current;
      const entryForHash = { ...record, serverTimestamp };
      const hash = await computeEntryHash(entryForHash, prevHash);
      lastHashRef.current = hash;
      setReadings((prev) => prev.map((r) => (r.id === record.id ? { ...r, serverTimestamp, prevHash, hash } : r)));
    })();
  }, []);

  // Recomputes the hash chain over every reading in this shift (oldest
  // first — `readings` itself is stored newest-first) and reports whether
  // it's still intact. See hashChain.js for exactly what this does and
  // doesn't prove.
  const verifyIntegrity = useCallback(async () => {
    const chronological = [...readings].reverse();
    const result = await verifyHashChain(chronological);
    setIntegrityResult(result);
    return result;
  }, [readings]);

  // A manager (or the cook themselves) marks a flagged reading resolved
  // once the corrective action has actually been taken — e.g. the product
  // was moved to a colder unit or discarded. This is a separate, explicit
  // step from logging the reading itself: the voice agent can't know
  // whether the corrective action really happened, only that it was
  // stated back to the cook.
  const toggleResolved = useCallback((id) => {
    setReadings((prev) =>
      prev.map((r) => (r.id === id ? { ...r, resolvedAt: r.resolvedAt ? null : Date.now() } : r))
    );
  }, []);

  const onTranscriptLine = useCallback((line) => {
    setTranscript((prev) => [...prev.slice(-30), line]);
  }, []);

  const onCoolingPendingChange = useCallback((batches) => {
    setCoolingPending(batches);
  }, []);

  const {
    status,
    error,
    userCaption,
    agentCaption,
    connect,
    disconnect,
    isDemo,
    demoFinished,
    pushToTalk,
    setPushToTalk,
    talking,
    startTalking,
    stopTalking,
    restoreCoolingPending,
    resetCoolingPending,
  } = useVoiceAgent({
    onReading,
    onTranscriptLine,
    onCoolingPendingChange,
  });

  // Picks up a shift restored from localStorage (see the effect above,
  // which stages the batches in pendingCoolingRestoreRef because
  // restoreCoolingPending isn't available until the useVoiceAgent() call
  // above has run) and pushes it into the hook exactly once per restore.
  useEffect(() => {
    if (coolingRestoreTick === 0) return;
    if (pendingCoolingRestoreRef.current === null) return;
    restoreCoolingPending(pendingCoolingRestoreRef.current);
    pendingCoolingRestoreRef.current = null;
  }, [coolingRestoreTick, restoreCoolingPending]);

  // Persist on every change so a mid-shift crash never loses more than the
  // last render's worth of readings. Demo readings never touch the real
  // saved shift.
  useEffect(() => {
    if (isDemo) return;
    if (readings.length === 0 && !shiftStartRef.current && coolingPending.length === 0) return;
    saveShift({
      shiftStart: shiftStartRef.current,
      shiftEnd: shiftEndRef.current,
      readings,
      coolingPending,
    });
  }, [readings, isDemo, coolingPending]);

  const startShift = useCallback(() => {
    // A brand-new shift replaces whatever was persisted, including a
    // previously-restored, already-exported shift.
    clearShift();
    setReadings([]);
    setRestoredNotice(false);
    shiftStartRef.current = Date.now();
    shiftEndRef.current = null;
    setShiftStartDisplay(shiftStartRef.current);
    resetCoolingPending();
    connect();
  }, [connect, resetCoolingPending]);

  const endShift = useCallback(() => {
    shiftEndRef.current = Date.now();
    saveShift({
      shiftStart: shiftStartRef.current,
      shiftEnd: shiftEndRef.current,
      readings,
      coolingPending,
    });
    disconnect();
  }, [disconnect, readings, coolingPending]);

  // "Try Demo" (backlog #7 — first-60-seconds judge experience): plays a
  // pre-recorded sample kitchen clip through the exact same real pipeline
  // (mic-capture -> WebSocket -> AssemblyAI -> tool call -> rule engine ->
  // UI) instead of a real microphone, so a judge with no mic, or who just
  // doesn't want to grant mic access, can still see the whole thing work
  // for real in under a minute. Demo readings never touch the real
  // persisted shift in localStorage (guarded below) and are cleared the
  // moment the demo ends, so they can never be mistaken for, or overwrite,
  // a real cook's log.
  const startDemo = useCallback(() => {
    setReadings([]);
    setRestoredNotice(false);
    shiftStartRef.current = Date.now();
    shiftEndRef.current = null;
    setShiftStartDisplay(shiftStartRef.current);
    resetCoolingPending();
    connect({ demo: true });
  }, [connect, resetCoolingPending]);

  const endDemo = useCallback(() => {
    disconnect();
    setReadings([]);
    shiftStartRef.current = null;
    shiftEndRef.current = null;
    setShiftStartDisplay(null);
    resetCoolingPending();
  }, [disconnect, resetCoolingPending]);

  // Superseded (corrected-away) readings stay in `readings` for the audit
  // trail but must never count toward live totals — a reading the cook
  // corrected is not "still safe" or "still a violation" anymore, its
  // replacement is.
  const summary = useMemo(() => {
    const counts = { safe: 0, amber: 0, red: 0, unknown: 0 };
    for (const r of readings) {
      if (r.superseded) continue;
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return counts;
  }, [readings]);

  // Latest reading per location/item, for the top status board.
  const latestByKey = useMemo(() => {
    const map = new Map();
    for (const r of readings) {
      if (r.superseded) continue;
      const key = (r.location || r.foodItem || "unspecified").toLowerCase();
      if (!map.has(key)) map.set(key, r);
    }
    return Array.from(map.values());
  }, [readings]);

  const isLive = status === "listening" || status === "connecting" || status === "reconnecting";

  // Ticks once a minute while a shift is live, purely to keep the "time
  // since last reading" reminder below live-updating without any reading
  // itself changing.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, [isLive]);

  // Manager daily summary: readings logged, flagged, still-unresolved
  // corrective actions, and a plain missed-check signal (see
  // MISSED_CHECK_MINUTES above) — the kind of one-glance rollup a manager
  // checking in mid-shift actually wants, not just a raw reading count.
  const managerSummary = useMemo(() => {
    // Only "red" is an actual FDA violation that needs a manager's
    // corrective-action follow-up and a resolve click — "amber" is
    // compliant (just close to the limit) and never gets a resolve
    // button, so it must not count toward "still unresolved" here either.
    // A superseded (corrected-away) reading is excluded too — it's not a
    // live violation anymore, its correction is.
    const flagged = readings.filter((r) => r.status === "red" && !r.superseded);
    const unresolved = flagged.filter((r) => !r.resolvedAt);
    const lastReadingAt = readings[0]?.timestamp ?? null;
    const referencePoint = lastReadingAt ?? shiftStartDisplay;
    const minutesSinceLastReading = isLive && referencePoint ? Math.floor((nowTick - referencePoint) / 60000) : null;
    return {
      total: readings.length,
      flaggedCount: flagged.length,
      unresolvedCount: unresolved.length,
      minutesSinceLastReading,
      missedCheck: minutesSinceLastReading !== null && minutesSinceLastReading >= MISSED_CHECK_MINUTES,
    };
  }, [readings, isLive, nowTick, shiftStartDisplay]);

  // Distinct dates and stations/items present in the current log, for the
  // PDF export filters below. "Station" here means whatever the cook named
  // — a location ("walk-in cooler") or a food item ("chicken breast") —
  // since that's the only grouping the app actually has.
  const availableDates = useMemo(() => {
    const set = new Set(readings.map((r) => new Date(r.timestamp).toLocaleDateString()));
    return Array.from(set).sort();
  }, [readings]);

  const availableStations = useMemo(() => {
    const set = new Set(readings.map((r) => r.location || r.foodItem || "Unspecified"));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [readings]);

  const filteredReadings = useMemo(() => {
    return readings.filter((r) => {
      if (dateFilter !== "all" && new Date(r.timestamp).toLocaleDateString() !== dateFilter) return false;
      if (stationFilter !== "all" && (r.location || r.foodItem || "Unspecified") !== stationFilter) return false;
      return true;
    });
  }, [readings, dateFilter, stationFilter]);

  const handleExportPdf = useCallback(async () => {
    const parts = [];
    if (dateFilter !== "all") parts.push(dateFilter);
    if (stationFilter !== "all") parts.push(stationFilter);
    // Integrity is verified over the FULL shift log, not just the filtered
    // rows being exported — filtering which rows print in the PDF doesn't
    // change whether the underlying log itself is intact.
    const integrity = await verifyIntegrity();
    exportHaccpPdf(filteredReadings, {
      shiftStart: shiftStartRef.current,
      shiftEnd: shiftEndRef.current,
      filterDescription: parts.length > 0 ? parts.join(" — ") : null,
      integrity,
    });
  }, [filteredReadings, dateFilter, stationFilter, verifyIntegrity]);

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
            <>
              <button
                onClick={startShift}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold transition"
              >
                Start Shift
              </button>
              <button
                onClick={startDemo}
                title="Plays a ~30s sample kitchen recording through the real app — no microphone needed"
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 font-semibold transition"
              >
                🎬 Try Demo (no mic needed)
              </button>
            </>
          ) : isDemo ? (
            <button
              onClick={endDemo}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 font-semibold transition"
            >
              End Demo
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
            onClick={verifyIntegrity}
            disabled={readings.length === 0}
            title="Recomputes the tamper-evident hash chain over every reading this shift and confirms nothing was edited, reordered, or deleted after logging."
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 font-semibold transition"
          >
            🔒 Verify Log Integrity
          </button>
          <button
            onClick={handleExportPdf}
            disabled={filteredReadings.length === 0}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 font-semibold transition"
          >
            Export HACCP PDF{dateFilter !== "all" || stationFilter !== "all" ? " (filtered)" : ""}
          </button>
        </div>
      </header>

      {integrityResult && (
        <div
          className={`-mt-2 rounded-lg border text-sm px-3 py-2 ${
            integrityResult.verified
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
              : "border-red-700 bg-red-950/40 text-red-300"
          }`}
        >
          {integrityResult.verified
            ? "🔒 Log integrity: verified — every entry's hash chains correctly from the start of this shift, nothing edited, reordered, or deleted."
            : `⚠️ Log integrity: BROKEN at entry ${integrityResult.brokenAt} — ${integrityResult.reason}`}
        </div>
      )}

      {readings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 -mt-2">
          <span className="uppercase tracking-wide font-semibold text-slate-500">PDF filters:</span>
          <label className="flex items-center gap-1.5">
            Date
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value="all">All dates</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Station / item
            <select
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value="all">All stations</option>
              {availableStations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <span>
            {filteredReadings.length} of {readings.length} reading{readings.length === 1 ? "" : "s"} match
          </span>
        </div>
      )}

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

      {!isLive && !restoredNotice && readings.length === 0 && (
        <div className="rounded-lg border border-violet-800 bg-violet-950/30 text-violet-300 text-sm px-3 py-2">
          New here? Click <strong>Try Demo</strong> above to hear a sample kitchen conversation
          flow through the real app in about 30 seconds — real speech recognition, real FDA rule
          checks, real spoken confirmation, no microphone required.
        </div>
      )}

      {isDemo && isLive && (
        <div className="rounded-lg border border-violet-700 bg-violet-950/50 text-violet-300 text-sm px-3 py-2">
          🎬 <strong>Demo mode</strong> — a sample kitchen recording is playing through the real
          pipeline (no microphone is being used).{" "}
          {demoFinished
            ? "Demo clip finished — press End Demo above, or explore the log and PDF export below."
            : "Sit back for about 30 seconds while it plays four sample readings."}
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

      {/* Manager summary */}
      {readings.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Manager Summary
          </h2>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-2xl font-bold">{managerSummary.total}</p>
              <p className="text-slate-500 text-xs">Readings logged</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{managerSummary.flaggedCount}</p>
              <p className="text-slate-500 text-xs">Violations (red)</p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${managerSummary.unresolvedCount > 0 ? "text-amber-400" : ""}`}>
                {managerSummary.unresolvedCount}
              </p>
              <p className="text-slate-500 text-xs">Corrective actions unresolved</p>
            </div>
          </div>
          {managerSummary.missedCheck && (
            <div className="mt-3 rounded-lg border border-amber-700 bg-amber-950/40 text-amber-300 text-sm px-3 py-2">
              No reading logged in over {managerSummary.minutesSinceLastReading} minutes — check that
              stations are still being monitored.
            </div>
          )}
        </section>
      )}

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
                {r.status === "amber" && (
                  <p className="text-xs opacity-90 mt-1 font-semibold">
                    🔎 Compliant, but close to the limit — confirmed with the cook
                  </p>
                )}
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
                <th className="text-left px-3 py-2 font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => {
                // Only "red" is an actual FDA violation needing a manager
                // resolution — "amber" is compliant, just close to the
                // limit, so it doesn't need the resolve workflow. A
                // superseded (corrected-away) reading never needs
                // resolving either — it's not current anymore.
                const isFlagged = r.status === "red" && !r.superseded;
                return (
                  <tr
                    key={`${r.id}-${r.timestamp}`}
                    className={`border-t border-slate-800 ${r.superseded ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </td>
                    <td className={`px-3 py-2 ${r.superseded ? "line-through" : ""}`}>
                      {r.location || r.foodItem || "—"}
                      {r.coolingStage && (
                        <span className="ml-1.5 text-xs text-sky-400">
                          ({r.coolingStage === "start" ? "cooling start" : "cooling check"})
                        </span>
                      )}
                      {r.categoryConflict && (
                        <span
                          className="ml-1.5 text-xs text-amber-400"
                          title={`Category conflict: evaluated as ${r.categoryLabel} (code-resolved from the item/location) — the voice agent's own guess disagreed. Worth a manager's review.`}
                        >
                          ⚠️ category conflict
                        </span>
                      )}
                      {r.superseded && (
                        <span className="ml-1.5 text-xs text-slate-500 not-italic no-underline" title={r.supersededNote}>
                          (superseded — corrected)
                        </span>
                      )}
                      {r.correctionNote && (
                        <p className="text-xs text-sky-400 font-normal mt-0.5">↳ {r.correctionNote}</p>
                      )}
                    </td>
                    <td className={`px-3 py-2 font-mono ${r.superseded ? "line-through" : ""}`}>
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
                      {r.status === "amber" && (
                        <span className="ml-1 text-xs text-slate-400" title="Compliant, but close to the limit — confirmed with the cook before logging">
                          🔎
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{r.correctiveAction || "—"}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.citation || "—"}</td>
                    <td className="px-3 py-2 text-slate-500 italic">{r.cookText || "—"}</td>
                    <td className="px-3 py-2">
                      {isFlagged ? (
                        <button
                          onClick={() => toggleResolved(r.id)}
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                            r.resolvedAt
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-700"
                              : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                          }`}
                        >
                          {r.resolvedAt ? "✓ Resolved" : "Mark resolved"}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {readings.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
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
