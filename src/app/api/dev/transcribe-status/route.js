// TEMPORARY diagnostic route — see transcribe-start/route.js. Returns the
// current status of a transcript job by id without waiting, so the client
// can poll past the normal 60s budget. Delete once the investigation is done.

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

export async function GET(request) {
  if (process.env.ENABLE_DEV_HARNESS !== "true") {
    return Response.json({ error: "Dev harness disabled." }, { status: 404 });
  }
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  try {
    const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { Authorization: apiKey },
    });
    const data = await resp.json();
    return Response.json({
      status: data.status,
      error: data.error,
      text: data.text,
      audio_duration: data.audio_duration,
    });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 502 });
  }
}
