"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceAgent } from "@/lib/useVoiceAgent";
import { exportHaccpPdf } from "@/lib/haccpPdf";
import { loadShift, saveShift, clearShift } from "@/lib/shiftStorage";
import { playLogBeep, playAlertTone } from "@/lib/audioCues";
import { computeEntryHash, verifyHashChain, GENESIS_HASH } from "@/lib/hashChain";
import { computeOverdueUnits, DEFAULT_INTERVAL_MS } from "@/lib/missedChecks";
import { loadSettings, saveSettings } from "@/lib/settingsStorage";
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

// Top accent bar shown on each status-board card — a quick color read from
// a few steps away, on top of the border/badge, since a kitchen "glance"
// display benefits from redundant color coding.
const STATUS_ACCENT = {
  safe: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  unknown: "bg-slate-500",
};

// Round-2 UI pass (task R2-UI): a small, consistent button/card vocabulary
// instead of every button in the toolbar sharing one undifferentiated
// slate-800 style. PRIMARY is the one action a cook needs most (start a
// shift); DEMO is the secondary happy-path for a judge with no mic; DANGER
// ends a live session; GHOST is for utility actions (verify, export,
// settings) that should read as available but not competing for attention;
// ICON is GHOST's square variant for a single glyph.
const BTN = {
  primary:
    "px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 font-semibold text-white shadow-lg shadow-emerald-950/50 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
  demo:
    "px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 font-semibold text-white shadow-lg shadow-violet-950/50 transition",
  danger:
    "px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 font-semibold text-white shadow-lg shadow-red-950/50 transition",
  ghost:
    "px-4 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 font-medium text-slate-200 transition disabled:opacity-40 disabled:hover:bg-slate-900/70 disabled:hover:border-slate-800 disabled:cursor-not-allowed",
  icon:
    "w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900/70 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 transition text-base",
};

// A shared "card" surface — rounded, subtly elevated, faintly bordered —
// so every panel on the dashboard (manager summary, captions, settings,
// log) reads as part of one coherent system instead of a stack of
// differently-flavored boxes.
const CARD = "rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-sm shadow-black/20";

// How long a unit/location can go without its OWN reading before it's
// flagged overdue (see missedChecks.js) — a single shift-wide "minutes
// since ANY reading" signal let a frequently-checked cooler mask a fryer
// nobody had actually checked in hours. 2 hours is a reasonable default
// check cadence for a kitchen, not a regulatory number; there's no
// per-station schedule UI (yet), so every unit shares this one interval.
const MISSED_CHECK_INTERVAL_MS = DEFAULT_INTERVAL_MS;

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
  // Round-2 critique #P1-8 (HACCP PDF chain-of-custody fields): establishment
  // name and thermometer ID/calibration date are "set once in settings" —
  // they don't change shift to shift, so they're persisted separately from
  // the shift itself (settingsStorage.js), not re-asked every time.
  // Lazy initializer (not an effect + setState) so this never triggers a
  // cascading render; loadSettings() returns {} during SSR (no window) and
  // the settings panel is hidden by default, so there's nothing for a
  // server/client mismatch to show up in on first paint.
  const [settings, setSettingsState] = useState(() => ({
    establishmentName: "",
    thermometerId: "",
    lastCalibrationDate: "",
    ...loadSettings(),
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  // The cook's name/initials, asked once per shift (not persistent like the
  // settings above) so every reading in the exported log has an owner, like
  // a real HACCP log — "This is Maria."
  const [cookName, setCookName] = useState("");
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
        if (saved.cookName) setCookName(saved.cookName);
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
      cookName,
    });
  }, [readings, isDemo, coolingPending, cookName]);

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
      cookName,
    });
    disconnect();
    setCookName("");
  }, [disconnect, readings, coolingPending, cookName]);

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
  // corrective actions, and a per-unit/location missed-check list (see
  // missedChecks.js) — the kind of one-glance rollup a manager checking in
  // mid-shift actually wants, not just a raw reading count.
  const managerSummary = useMemo(() => {
    // Only "red" is an actual FDA violation that needs a manager's
    // corrective-action follow-up and a resolve click — "amber" is
    // compliant (just close to the limit) and never gets a resolve
    // button, so it must not count toward "still unresolved" here either.
    // A superseded (corrected-away) reading is excluded too — it's not a
    // live violation anymore, its correction is.
    const flagged = readings.filter((r) => r.status === "red" && !r.superseded);
    const unresolved = flagged.filter((r) => !r.resolvedAt);
    const overdueUnits = isLive
      ? computeOverdueUnits({ readings, now: nowTick, intervalMs: MISSED_CHECK_INTERVAL_MS })
      : [];
    return {
      total: readings.length,
      flaggedCount: flagged.length,
      unresolvedCount: unresolved.length,
      overdueUnits,
      missedCheck: overdueUnits.length > 0,
    };
  }, [readings, isLive, nowTick]);

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
      establishmentName: settings.establishmentName,
      thermometerId: settings.thermometerId,
      lastCalibrationDate: settings.lastCalibrationDate,
      cookName,
    });
  }, [filteredReadings, dateFilter, stationFilter, verifyIntegrity, settings, cookName]);

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-950/50 flex items-center justify-center text-xl"
            aria-hidden="true"
          >
            🌡️
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight">TempCheck</h1>
            <p className="text-slate-400 text-sm">
              Hands-free HACCP-style temperature logging, built on AssemblyAI&apos;s Voice Agent API.
            </p>
          </div>
        </div>
      </header>

      {/* Toolbar: primary shift controls on the left (the one thing a cook
          actually needs to touch), utility actions grouped on the right,
          visually de-emphasized so they don't compete with Start Shift. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isLive && (
            <input
              type="text"
              value={cookName}
              onChange={(e) => setCookName(e.target.value)}
              placeholder="Cook name / initials"
              title="Shown as 'Logged by' on the exported HACCP PDF — asked once per shift, like a real paper log."
              className="px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 text-sm placeholder:text-slate-500 w-44 focus:border-emerald-600"
            />
          )}
          {!isLive ? (
            <>
              <button onClick={startShift} className={BTN.primary}>
                ▶ Start Shift
              </button>
              <button
                onClick={startDemo}
                title="Plays a ~30s sample kitchen recording through the real app — no microphone needed"
                className={BTN.demo}
              >
                🎬 Try Demo (no mic needed)
              </button>
            </>
          ) : isDemo ? (
            <button onClick={endDemo} className={BTN.danger}>
              ■ End Demo
            </button>
          ) : (
            <button onClick={endShift} className={BTN.danger}>
              ■ End Shift
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button
            onClick={verifyIntegrity}
            disabled={readings.length === 0}
            title="Recomputes the tamper-evident hash chain over every reading this shift and confirms nothing was edited, reordered, or deleted after logging."
            className={BTN.ghost}
          >
            🔒 Verify Log
          </button>
          <button
            onClick={handleExportPdf}
            disabled={filteredReadings.length === 0}
            className={BTN.ghost}
          >
            📄 Export PDF{dateFilter !== "all" || stationFilter !== "all" ? " (filtered)" : ""}
          </button>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            title="Establishment name and thermometer ID/calibration date — shown on the exported HACCP PDF"
            aria-label="Settings"
            className={`${BTN.icon} ${settingsOpen ? "border-emerald-600 text-emerald-300" : ""}`}
          >
            ⚙️
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className={`${CARD} p-4 grid gap-3 sm:grid-cols-3 text-sm`}>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs font-medium">Establishment name</span>
            <input
              type="text"
              value={settings.establishmentName || ""}
              onChange={(e) => updateSettings({ establishmentName: e.target.value })}
              placeholder="e.g. Maple Street Diner"
              className="px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800 placeholder:text-slate-500 focus:border-emerald-600"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs font-medium">Thermometer ID</span>
            <input
              type="text"
              value={settings.thermometerId || ""}
              onChange={(e) => updateSettings({ thermometerId: e.target.value })}
              placeholder="e.g. Probe #2"
              className="px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800 placeholder:text-slate-500 focus:border-emerald-600"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs font-medium">Last calibration date</span>
            <input
              type="date"
              value={settings.lastCalibrationDate || ""}
              onChange={(e) => updateSettings({ lastCalibrationDate: e.target.value })}
              className="px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800 focus:border-emerald-600"
            />
          </label>
        </div>
      )}

      {integrityResult && (
        <div
          className={`rounded-xl border text-sm px-4 py-2.5 ${
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
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="uppercase tracking-wide font-semibold text-slate-500">PDF filters</span>
          <label className="flex items-center gap-1.5">
            Date
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-slate-900/70 border border-slate-800 rounded-lg px-2 py-1 text-slate-200"
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
              className="bg-slate-900/70 border border-slate-800 rounded-lg px-2 py-1 text-slate-200"
            >
              <option value="all">All stations</option>
              {availableStations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <span className="text-slate-500">
            {filteredReadings.length} of {readings.length} reading{readings.length === 1 ? "" : "s"} match
          </span>
        </div>
      )}

      {/* Hands-free controls: sound cues, big kitchen-display mode, and an
          optional push-to-talk mode for very loud kitchens where always-on
          listening picks up too much background noise. Styled as a chip
          toolbar rather than plain text links so it reads as a control
          surface, not a footnote. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => setSoundEnabled((v) => !v)}
          title="Beep on log, alert tone on amber/red"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition ${
            soundEnabled
              ? "border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-600"
              : "border-slate-800 bg-slate-900/30 text-slate-500 hover:text-slate-300"
          }`}
        >
          <span>{soundEnabled ? "🔊" : "🔇"}</span>
          <span>Sound {soundEnabled ? "on" : "off"}</span>
        </button>
        <button
          onClick={() => setBigDisplay(true)}
          title="Full-screen, glanceable from across the kitchen"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-600 transition"
        >
          <span>⛶</span>
          <span>Big display</span>
        </button>
        <label
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer transition ml-auto ${
            pushToTalk
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
              : "border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-600"
          }`}
        >
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
            className={`px-4 py-1.5 rounded-full font-semibold select-none transition ${
              talking
                ? "bg-emerald-500 text-white shadow-lg shadow-emerald-950/50"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            }`}
          >
            {talking ? "🎙️ Listening — release when done" : "Hold to talk"}
          </button>
        )}
      </div>

      {restoredNotice && (
        <div className="rounded-xl border border-sky-800 bg-sky-950/50 text-sky-300 text-sm px-4 py-2.5">
          Restored {readings.length} reading{readings.length === 1 ? "" : "s"} from before this
          page was reloaded — nothing was lost. Export the PDF whenever you&apos;re ready, or
          press Start Shift to begin a new one.
        </div>
      )}

      {!isLive && !restoredNotice && readings.length === 0 && (
        <div className="rounded-xl border border-violet-800 bg-violet-950/30 text-violet-300 text-sm px-4 py-2.5">
          New here? Click <strong>Try Demo</strong> above to hear a sample kitchen conversation
          flow through the real app in about 30 seconds — real speech recognition, real FDA rule
          checks, real spoken confirmation, no microphone required.
        </div>
      )}

      {isDemo && isLive && (
        <div className="rounded-xl border border-violet-700 bg-violet-950/50 text-violet-300 text-sm px-4 py-2.5">
          🎬 <strong>Demo mode</strong> — a sample kitchen recording is playing through the real
          pipeline (no microphone is being used).{" "}
          {demoFinished
            ? "Demo clip finished — press End Demo above, or explore the log and PDF export below."
            : "Sit back for about 30 seconds while it plays four sample readings."}
        </div>
      )}

      {/* Live status + captions, unified into one panel: a status pill up
          top, then the running caption feed styled like chat bubbles (cook
          on the left, TempCheck's spoken reply on the right) so it reads
          at a glance instead of as two stacked paragraphs of plain text. */}
      <div className={`${CARD} p-4`}>
        <div className="flex items-center gap-2 text-sm mb-3">
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
          <span className="text-slate-400 capitalize font-medium">
            {status === "reconnecting" ? "Reconnecting…" : status}
          </span>
          {error && <span className="text-red-400">— {error}</span>}
        </div>

        <div className="min-h-[56px] text-sm space-y-2">
          {userCaption && (
            <p className="flex items-start gap-2 text-slate-200">
              <span className="shrink-0">🎙️</span>
              <span className="rounded-xl rounded-tl-none bg-slate-800/80 px-3 py-1.5">{userCaption}</span>
            </p>
          )}
          {agentCaption && (
            <p className="flex items-start gap-2 text-sky-200">
              <span className="shrink-0">🔊</span>
              <span className="rounded-xl rounded-tl-none bg-sky-900/40 px-3 py-1.5">{agentCaption}</span>
            </p>
          )}
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
      </div>

      {/* Manager summary */}
      {readings.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Manager Summary
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
              <p className="text-2xl font-bold tabular-nums">{managerSummary.total}</p>
              <p className="text-slate-500 text-xs mt-0.5">Readings logged</p>
            </div>
            <div
              className={`rounded-xl border px-4 py-3 ${
                managerSummary.flaggedCount > 0
                  ? "border-red-900 bg-red-950/30"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <p className={`text-2xl font-bold tabular-nums ${managerSummary.flaggedCount > 0 ? "text-red-400" : ""}`}>
                {managerSummary.flaggedCount}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">Violations (red)</p>
            </div>
            <div
              className={`rounded-xl border px-4 py-3 ${
                managerSummary.unresolvedCount > 0
                  ? "border-amber-900 bg-amber-950/30"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <p className={`text-2xl font-bold tabular-nums ${managerSummary.unresolvedCount > 0 ? "text-amber-400" : ""}`}>
                {managerSummary.unresolvedCount}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">Corrective actions unresolved</p>
            </div>
          </div>
          {managerSummary.missedCheck && (
            <div className="mt-3 rounded-xl border border-amber-700 bg-amber-950/40 text-amber-300 text-sm px-4 py-3">
              <p className="font-semibold mb-1.5 flex items-center gap-1.5">
                <span>⏰</span>
                {managerSummary.overdueUnits.length === 1 ? "Station overdue for a check:" : "Stations overdue for a check:"}
              </p>
              <ul className="space-y-1">
                {managerSummary.overdueUnits.map((u) => (
                  <li key={u.unit} className="flex items-center justify-between gap-2 border-t border-amber-900/50 pt-1 first:border-t-0 first:pt-0">
                    <span className="font-medium">{u.unit}</span>
                    <span className="text-amber-400/80 whitespace-nowrap">{u.minutesSince} min ago</span>
                  </li>
                ))}
              </ul>
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
                className={`relative overflow-hidden rounded-xl border-2 p-4 pt-5 shadow-sm shadow-black/20 hover:-translate-y-0.5 transition-transform ${
                  STATUS_STYLES[r.status] || STATUS_STYLES.unknown
                }`}
              >
                <span className={`absolute top-0 left-0 right-0 h-1.5 ${STATUS_ACCENT[r.status] || STATUS_ACCENT.unknown}`} />
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[r.status]}`} />
                  <span className="font-semibold capitalize">{r.status}</span>
                </div>
                <p className="text-sm opacity-90">{r.location || r.foodItem}</p>
                <p className="text-2xl font-bold tabular-nums">
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
        <div className="flex flex-wrap gap-2 mt-3 text-xs">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/50 text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.safe}`} /> Safe {summary.safe}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/50 text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.amber}`} /> Amber {summary.amber}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/50 text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.red}`} /> Red {summary.red}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/50 text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.unknown}`} /> Unknown {summary.unknown}
          </span>
        </div>
      </section>

      {/* Full log */}
      <section className="flex-1">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Full Log ({readings.length})
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80 shadow-sm shadow-black/20 max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 sticky top-0 z-10 shadow-sm shadow-black/40">
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
              {readings.map((r, i) => {
                // Only "red" is an actual FDA violation needing a manager
                // resolution — "amber" is compliant, just close to the
                // limit, so it doesn't need the resolve workflow. A
                // superseded (corrected-away) reading never needs
                // resolving either — it's not current anymore.
                const isFlagged = r.status === "red" && !r.superseded;
                return (
                  <tr
                    key={`${r.id}-${r.timestamp}`}
                    className={`border-t border-slate-800/80 hover:bg-slate-800/30 transition-colors ${
                      i % 2 === 1 ? "bg-slate-900/30" : ""
                    } ${r.superseded ? "opacity-50" : ""}`}
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

      <details className={`${CARD} text-xs text-slate-500 p-3 open:pb-4`}>
        <summary className="cursor-pointer select-none font-medium text-slate-400 hover:text-slate-200 transition">
          Recent transcript
        </summary>
        <ul className="mt-2 space-y-1 pl-1">
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
