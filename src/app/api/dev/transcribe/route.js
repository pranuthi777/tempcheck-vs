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
  // the cook-facing app at all — only by the internal accuracy harness.
  //
  // Security note (a prior version of this comment claimed a shared-secret
  // header protected this route "against public abuse" — that was wrong,
  // and worth stating plainly: a secret checked by a route that only a
  // public browser page ever calls can't actually be secret, since it would
  // have to be visible in that page's own client-side code or network
  // requests to be sent at all. The real fix is safe-by-default: this route
  // is disabled unless ENABLE_DEV_HARNESS=true is explicitly set in the
  // deployment's environment (not a secret — just an on/off switch, safe to
  // document publicly). A fresh deploy following this repo's own README
  // therefore ships with this route OFF, not silently open.
  if (process.env.ENABLE_DEV_HARNESS !== "true") {
    return Response.json(
      { error: "Dev harness disabled. Set ENABLE_DEV_HARNESS=true to enable it temporarily." },
      { status: 404 }
    );
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
