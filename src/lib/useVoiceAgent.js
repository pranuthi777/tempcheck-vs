"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateReading } from "./ruleEngine";
import { evaluateCoolingCheck, COOLING_CITATION } from "./coolingEngine";
import { buildSessionUpdate } from "./agentConfig";
import { PCMPlayer } from "./audioPlayer";
import { startMicCapture, startDemoCapture } from "./micCapture";

// Verified live: a real cooling_check tool call came back with BOTH
// food_item and location set (the model filled in location from earlier
// context even though the cook never mentioned it for that reading), while
// the matching cooling_start call had only food_item. A single "prefer one
// field" key would have failed to pair them whichever field it preferred,
// so a cooling_start is indexed under BOTH of its non-empty fields, and a
// cooling_check matches on either one — food_item first since that's the
// more specific/stable identifier for what's actually cooling.
function coolingKeys(args) {
  const keys = [];
  if (args.food_item) keys.push("item:" + args.food_item.toLowerCase().trim());
  if (args.location) keys.push("loc:" + args.location.toLowerCase().trim());
  return keys;
}

function celsiusToFahrenheit(c) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

/**
 * Owns the whole Voice Agent WebSocket lifecycle: connect, mic streaming,
 * playback, tool-call handling (running the deterministic rule engine),
 * transcript captions, and a one-shot auto-reconnect (session.resume)
 * if the socket drops unexpectedly (flaky wifi shouldn't kill a kitchen
 * shift). `onReading` is called once per logged reading with the full
 * evaluated record for the dashboard/log/PDF to consume.
 */
export function useVoiceAgent({ onReading, onTranscriptLine }) {
  const [status, setStatus] = useState("idle"); // idle | connecting | listening | reconnecting | error | ended
  const [error, setError] = useState(null);
  const [userCaption, setUserCaption] = useState("");
  const [agentCaption, setAgentCaption] = useState("");
  // Demo mode: "try it without a mic" plays a sample clip through the real
  // pipeline instead of a real microphone. isDemo lets the UI badge the
  // session so nobody mistakes it for a live shift; demoFinished flips once
  // the sample clip has finished playing.
  const [isDemo, setIsDemo] = useState(false);
  const [demoFinished, setDemoFinished] = useState(false);

  const wsRef = useRef(null);
  const playerRef = useRef(null);
  const stopMicRef = useRef(null);
  const pendingResultsRef = useRef([]); // [{call_id, result}]
  const lastUserTextRef = useRef("");
  const sessionInfoRef = useRef(null); // { sessionId, resumeToken, expiresAt }
  const deliberateCloseRef = useRef(false);
  const resumeAttemptedRef = useRef(false);
  const openSocketRef = useRef(null);
  // Pending cooling-curve starts, keyed by normalized location/food_item —
  // see coolingEngine.js. Lives only for the session (not persisted across
  // a reload, a known, disclosed limitation); a start not yet matched by a
  // check just means that item's cooling progress isn't being tracked.
  const coolingPendingRef = useRef(new Map());

  // Push-to-talk: in a very loud kitchen, always-on listening can pick up
  // too much background noise/chatter. micOpenRef gates whether captured
  // mic chunks actually get sent up the WebSocket — the AudioWorklet itself
  // keeps running either way (tearing down/rebuilding the audio graph on
  // every press would be slow and glitchy), so toggling this is instant.
  // Default true = continuous listening, today's default experience.
  const micOpenRef = useRef(true);
  const [pushToTalk, setPushToTalkState] = useState(false);
  const [talking, setTalking] = useState(false);

  const setPushToTalk = useCallback((enabled) => {
    setPushToTalkState(enabled);
    // Switching INTO push-to-talk starts muted until the button is held;
    // switching back to continuous re-opens the mic immediately.
    micOpenRef.current = !enabled;
    setTalking(false);
  }, []);

  const startTalking = useCallback(() => {
    if (!pushToTalk) return;
    micOpenRef.current = true;
    setTalking(true);
  }, [pushToTalk]);

  const stopTalking = useCallback(() => {
    if (!pushToTalk) return;
    micOpenRef.current = false;
    setTalking(false);
  }, [pushToTalk]);

  const handleToolCall = useCallback(
    (msg) => {
      const args = msg.arguments || {};
      let temperatureF = null;
      if (typeof args.temperature_value === "number") {
        temperatureF =
          args.temperature_unit === "C"
            ? celsiusToFahrenheit(args.temperature_value)
            : args.temperature_value;
      }

      let evaluation;
      let coolingStage = null; // "start" | "check" | null, for the dashboard/log to badge

      if (args.reading_type === "cooling_start") {
        coolingStage = "start";
        const keys = coolingKeys(args);
        if (keys.length > 0 && Number.isFinite(temperatureF)) {
          const pendingRecord = { startTemperatureF: temperatureF, startTimestamp: Date.now() };
          for (const k of keys) coolingPendingRef.current.set(k, pendingRecord);
        }
        evaluation = {
          category: "cooling",
          categoryLabel: "Cooling (in progress)",
          status: "safe",
          limitF: null,
          correctiveAction: null,
          message: Number.isFinite(temperatureF)
            ? `Cooling started at ${temperatureF}°F. Must reach 70°F within 2h, then 41°F within 6h total.`
            : "Cooling start logged, but no valid starting temperature was captured.",
          citation: COOLING_CITATION,
        };
      } else if (args.reading_type === "cooling_check") {
        coolingStage = "check";
        const keys = coolingKeys(args);
        let pending = null;
        for (const k of keys) {
          pending = coolingPendingRef.current.get(k);
          if (pending) break;
        }
        if (!pending || !Number.isFinite(temperatureF)) {
          evaluation = {
            category: "cooling",
            categoryLabel: "Cooling (in progress)",
            status: "unknown",
            limitF: null,
            correctiveAction: "Log the cooling starting temperature first, then check again.",
            message: "No matching cooling-start reading was found for this item.",
            citation: COOLING_CITATION,
          };
        } else {
          const result = evaluateCoolingCheck({
            startTemperatureF: pending.startTemperatureF,
            startTimestamp: pending.startTimestamp,
            checkTemperatureF: temperatureF,
            checkTimestamp: Date.now(),
          });
          evaluation = {
            category: "cooling",
            categoryLabel: "Cooling check",
            status: result.status,
            limitF: null,
            correctiveAction: result.correctiveAction,
            message: result.message,
            citation: result.citation,
          };
          // A violation or a compliant final reading both resolve this
          // cooling pair; an "amber" (still in progress, on track) leaves
          // it pending so a later check can pair against the same start.
          // Clear every key that was pointing at this record (it may have
          // been indexed under both food_item and location), not just the
          // one this particular check happened to match on.
          if (result.status !== "amber") {
            for (const [k, v] of coolingPendingRef.current.entries()) {
              if (v === pending) coolingPendingRef.current.delete(k);
            }
          }
        }
      } else {
        evaluation = evaluateReading({
          location: args.location,
          foodItem: args.food_item,
          readingType: args.reading_type,
          temperatureF,
        });
      }

      const record = {
        id: msg.call_id || crypto.randomUUID(),
        timestamp: Date.now(),
        location: args.location || null,
        foodItem: args.food_item || null,
        rawArgs: args,
        temperatureF,
        cookText: lastUserTextRef.current,
        coolingStage,
        ...evaluation,
      };

      onReading?.(record);

      const resultPayload = {
        status: evaluation.status,
        message: evaluation.message,
        corrective_action: evaluation.correctiveAction,
        logged_temperature_f: temperatureF,
        // True for a "safe" reading close enough to its category's limit
        // that it's worth an explicit yes/no confirmation before moving on
        // — see CONFIRM_MARGIN_F in ruleEngine.js. This is what closes the
        // "silent false-safe" gap: a plain readback of a safe-sounding
        // number is easy to not really listen to, so close calls get an
        // explicit confirmation loop instead, same as amber/red already do.
        confirm_recommended: !!evaluation.confirmRecommended,
      };

      pendingResultsRef.current.push({
        call_id: msg.call_id,
        result: JSON.stringify(resultPayload),
      });
    },
    [onReading]
  );

  const flushPendingResults = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (pendingResultsRef.current.length > 0) {
      const item = pendingResultsRef.current.shift();
      ws.send(JSON.stringify({ type: "tool.result", ...item }));
    }
  }, []);

  const handleServerMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case "session.ready":
          sessionInfoRef.current = {
            sessionId: msg.session_id,
            resumeToken: msg.resume_token,
            readyAt: Date.now(),
          };
          resumeAttemptedRef.current = false;
          setStatus("listening");
          break;
        case "transcript.user.delta":
          setUserCaption(msg.text || "");
          break;
        case "transcript.user":
          setUserCaption("");
          lastUserTextRef.current = msg.text || "";
          onTranscriptLine?.({ role: "user", text: msg.text, ts: Date.now() });
          break;
        case "reply.started":
          setAgentCaption("");
          break;
        case "transcript.agent.delta":
          setAgentCaption((prev) => `${prev}${msg.delta || ""}`);
          break;
        case "transcript.agent":
          onTranscriptLine?.({
            role: "agent",
            text: msg.text,
            interrupted: !!msg.interrupted,
            ts: Date.now(),
          });
          if (msg.interrupted) playerRef.current?.flush();
          break;
        case "reply.audio":
          if (msg.data) playerRef.current?.enqueueBase64(msg.data);
          break;
        case "reply.done":
          setAgentCaption("");
          if (msg.status === "interrupted") playerRef.current?.flush();
          flushPendingResults();
          break;
        case "tool.call":
          handleToolCall(msg);
          break;
        case "session.error":
          setError(msg.message || "Session error");
          break;
        case "session.ended":
          setStatus("ended");
          break;
        default:
          break;
      }
    },
    [flushPendingResults, handleToolCall, onTranscriptLine]
  );

  const openSocket = useCallback(
    async (resumeSessionId) => {
      const tokenResp = await fetch("/api/token");
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) throw new Error(tokenData.error || "Failed to get token");

      const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${tokenData.token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (resumeSessionId) {
          ws.send(JSON.stringify({ type: "session.resume", session_id: resumeSessionId }));
        } else {
          ws.send(JSON.stringify(buildSessionUpdate()));
        }
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        handleServerMessage(msg);
      };

      ws.onerror = () => {
        setError("WebSocket connection error.");
      };

      ws.onclose = () => {
        if (deliberateCloseRef.current) {
          setStatus("ended");
          return;
        }
        const info = sessionInfoRef.current;
        const withinGrace = info && Date.now() - info.readyAt < 30000;
        if (withinGrace && !resumeAttemptedRef.current) {
          resumeAttemptedRef.current = true;
          setStatus("reconnecting");
          openSocketRef.current?.(info.sessionId).catch(() => {
            setError("Reconnect failed — the session couldn't be resumed in time.");
            setStatus("error");
          });
        } else {
          setStatus("ended");
        }
      };
    },
    [handleServerMessage]
  );

  useEffect(() => {
    openSocketRef.current = openSocket;
  }, [openSocket]);

  const connect = useCallback(
    async ({ demo = false } = {}) => {
      setError(null);
      setStatus("connecting");
      deliberateCloseRef.current = false;
      resumeAttemptedRef.current = false;
      sessionInfoRef.current = null;
      setIsDemo(demo);
      setDemoFinished(false);
      try {
        playerRef.current = new PCMPlayer();
        await openSocket(null);
        // Reset the mic gate for this session: open (continuous) unless
        // push-to-talk was already selected before Start Shift was pressed.
        // Demo mode always forces continuous listening — there's no one
        // there to hold a push-to-talk button while the sample clip plays.
        micOpenRef.current = demo ? true : !pushToTalk;
        const onChunk = (base64Chunk) => {
          if (!micOpenRef.current) return;
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input.audio", audio: base64Chunk }));
          }
        };
        stopMicRef.current = demo
          ? await startDemoCapture(onChunk, () => setDemoFinished(true))
          : await startMicCapture(onChunk);
      } catch (err) {
        setError(String(err.message || err));
        setStatus("error");
      }
    },
    [openSocket, pushToTalk]
  );

  const disconnect = useCallback(() => {
    deliberateCloseRef.current = true;
    try {
      wsRef.current?.send(JSON.stringify({ type: "session.end" }));
    } catch {
      /* ignore */
    }
    wsRef.current?.close();
    stopMicRef.current?.();
    playerRef.current?.close();
    setStatus("ended");
    setIsDemo(false);
    setDemoFinished(false);
  }, []);

  return {
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
  };
}
