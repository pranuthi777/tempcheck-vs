// TEMPORARY diagnostic route — investigating a live AssemblyAI slowdown
// (transcripts stuck in "processing" for 60s+ on a 2.5s clip, which never
// happened before today). Same safe-by-default gate as /api/dev/transcribe.
// Returns the transcript id immediately after creating the job, without
// waiting, so the client can poll status past the normal 60s budget to see
// whether the job ever completes. Delete once the investigation is done.

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

export async function POST(request) {
  if (process.env.ENABLE_DEV_HARNESS !== "true") {
    return Response.json({ error: "Dev harness disabled." }, { status: 404 });
  }
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 });
  }
  const audioBuffer = await request.arrayBuffer();
  try {
    const t0 = Date.now();
    const uploadResp = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: apiKey },
      body: Buffer.from(audioBuffer),
    });
    if (!uploadResp.ok) {
      const t = await uploadResp.text();
      throw new Error(`Upload failed (${uploadResp.status}): ${t}`);
    }
    const uploadMs = Date.now() - t0;
    const { upload_url } = await uploadResp.json();

    const t1 = Date.now();
    const transcriptResp = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    if (!transcriptResp.ok) {
      const t = await transcriptResp.text();
      throw new Error(`Transcript request failed (${transcriptResp.status}): ${t}`);
    }
    const createMs = Date.now() - t1;
    const { id, status } = await transcriptResp.json();
    return Response.json({ id, status, uploadMs, createMs });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 502 });
  }
}
