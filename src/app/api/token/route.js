// Server-side only: mints a short-lived AssemblyAI Voice Agent token so the
// real API key never reaches the browser. The browser uses this token to
// open the Voice Agent WebSocket directly.
//
// Docs: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/api-spec/generate-voice-agent-token

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ASSEMBLYAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
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
    return Response.json(
      { error: `Could not reach AssemblyAI: ${String(err)}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: `AssemblyAI token request failed (${upstream.status}): ${text}` },
      { status: 502 }
    );
  }

  const data = await upstream.json();
  return Response.json({ token: data.token, expires_in_seconds: data.expires_in_seconds });
}
