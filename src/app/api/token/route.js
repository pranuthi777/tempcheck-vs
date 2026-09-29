// Server-side only: mints a short-lived AssemblyAI Voice Agent token so the
// real API key never reaches the browser. The browser uses this token to
// open the Voice Agent WebSocket directly.
//
// Docs: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/api-spec/generate-voice-agent-token
//
// Unlike the internal /api/dev/transcribe harness route, this one is meant
// to be called by the real cook-facing app, so it can't be disabled by
// default — every real shift needs it. That makes it the one route that's
// actually exposed to the open internet with no auth in front of it, so it
// gets the same two protections as the dev route, for the same reason: it
// spends real AssemblyAI credits per call. See src/lib/apiGuard.js (unit
// tested) for the same-origin check and rate limiter themselves.

import { isCrossOrigin, createRateLimiter } from "@/lib/apiGuard";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
// Real cook usage is a handful of tokens per shift (one on connect,
// occasionally one more after a reconnect), so this is sized generously
// above that — a circuit breaker against automated abuse, not a tight
// quota.
const RATE_LIMIT_MAX_PER_IP = 60;
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxPerKey: RATE_LIMIT_MAX_PER_IP });

// Generic, non-leaking error text for the client. Upstream error bodies
// (AssemblyAI's own response text, raw exception messages) are logged
// server-side only via console.error, never forwarded verbatim — they
// could contain account/infra details that don't belong in a public
// response.
const GENERIC_ERROR = { error: "Could not start a voice session right now. Please try again." };

export async function GET(request) {
  if (isCrossOrigin({ origin: request.headers.get("origin"), requestUrl: request.url })) {
    return Response.json(GENERIC_ERROR, { status: 403 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (limiter.isLimited(ip)) {
    return Response.json(GENERIC_ERROR, { status: 429 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.error("[/api/token] ASSEMBLYAI_API_KEY is not configured on the server.");
    return Response.json(GENERIC_ERROR, { status: 500 });
  }

  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "3600");

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[/api/token] Could not reach AssemblyAI:", err);
    return Response.json(GENERIC_ERROR, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(`[/api/token] AssemblyAI token request failed (${upstream.status}): ${text}`);
    return Response.json(GENERIC_ERROR, { status: 502 });
  }

  const data = await upstream.json();
  return Response.json({ token: data.token, expires_in_seconds: data.expires_in_seconds });
}
