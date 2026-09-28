"use client";

import { useCallback, useRef, useState } from "react";
import { evaluateReading } from "./ruleEngine";
import { buildSessionUpdate } from "./agentConfig";
import { PCMPlayer } from "./audioPlayer";
import { startMicCapture } from "./micCapture";

function celsiusToFahrenheit(c) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

/**
 * Owns the whole Voice Agent WebSocket lifecycle: connect, mic streaming,
 * playback, tool-call handling (running the deterministic rule engine),
 * and transcript captions. `onReading` is called once per logged reading
 * with the full evaluated record for the dashboard/log/PDF to consume.
 */
export function useVoiceAgent({ onReading, onTranscriptLine }) {
  const [status, setStatus] = useState("idle"); // idle | connecting | listening | error | ended
  const [error, setError] = useState(null);
  const [userCaption, setUserCaption] = useState("");
  const [agentCaption, setAgentCaption] = useState("");

  const wsRef = useRef(null);
  const playerRef = useRef(null);
  const stopMicRef = useRef(null);
  const pendingResultsRef = useRef([]); // [{call_id, result}]
  const lastUserTextRef = useRef("");

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

      const evaluation = evaluateReading({
        location: args.location,
        foodItem: args.food_item,
        readingType: args.reading_type,
        temperatureF,
      });

      const record = {
        id: msg.call_id || crypto.randomUUID(),
        timestamp: Date.now(),
        location: args.location || null,
        foodItem: args.food_item || null,
        rawArgs: args,
        temperatureF,
        cookText: lastUserTextRef.current,
        ...evaluation,
      };

      onReading?.(record);

      const resultPayload = {
        status: evaluation.status,
        message: evaluation.message,
        corrective_action: evaluation.correctiveAction,
        logged_temperature_f: temperatureF,
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

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const tokenResp = await fetch("/api/token");
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) throw new Error(tokenData.error || "Failed to get token");

      const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${tokenData.token}`);
      wsRef.current = ws;
      playerRef.current = new PCMPlayer();

      ws.onopen = () => {
        ws.send(JSON.stringify(buildSessionUpdate()));
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
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus((s) => (s === "error" ? s : "ended"));
      };

      stopMicRef.current = await startMicCapture((base64Chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input.audio", audio: base64Chunk }));
        }
      });
    } catch (err) {
      setError(String(err.message || err));
      setStatus("error");
    }
  }, [handleServerMessage]);

  const disconnect = useCallback(() => {
    try {
      wsRef.current?.send(JSON.stringify({ type: "session.end" }));
    } catch {
      /* ignore */
    }
    wsRef.current?.close();
    stopMicRef.current?.();
    playerRef.current?.close();
    setStatus("ended");
  }, []);

  return { status, error, userCaption, agentCaption, connect, disconnect };
}
