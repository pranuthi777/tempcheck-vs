// Internal, server-side-only helper used by the accuracy test harness
// (/dev/accuracy-test). Takes raw audio bytes, runs them through
// AssemblyAI's real async transcription API, and returns the transcript
// text. This is the same STT engine as the Voice Agent, called directly
// so we can batch-measure number-capture accuracy against a known
// ground truth without needing a live microphone for every clip.

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

async function pollUntilDone(id, apiKey, { intervalMs = 1500, timeoutMs = 60000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { Authorization: apiKey },
    });
    const data = await resp.json();
    if (data.status === "completed") return data;
    if (data.status === "error") throw new Error(data.error || "Transcription failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Transcription timed out");
}

export async function POST(request) {
  // This route spends real AssemblyAI credits per call and isn't needed by
  // the cook-facing app at all — only by the internal accuracy harness. If
  // DEV_HARNESS_SECRET is configured, require it so a public deployment
  // link can't be used by strangers to burn API credits.
  const requiredSecret = process.env.DEV_HARNESS_SECRET;
  if (requiredSecret && request.headers.get("x-dev-secret") !== requiredSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 });
  }

  const audioBuffer = await request.arrayBuffer();
  if (!audioBuffer || audioBuffer.byteLength === 0) {
    return Response.json({ error: "No audio body received" }, { status: 400 });
  }

  try {
    const uploadResp = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: apiKey },
      body: Buffer.from(audioBuffer),
    });
    if (!uploadResp.ok) {
      const t = await uploadResp.text();
      throw new Error(`Upload failed (${uploadResp.status}): ${t}`);
    }
    const { upload_url } = await uploadResp.json();

    const transcriptResp = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    if (!transcriptResp.ok) {
      const t = await transcriptResp.text();
      throw new Error(`Transcript request failed (${transcriptResp.status}): ${t}`);
    }
    const { id } = await transcriptResp.json();

    const result = await pollUntilDone(id, apiKey);
    return Response.json({ text: result.text || "" });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 502 });
  }
}
