// Server-issued timestamp for the tamper-evident hash chain (Bug #5).
//
// Why this exists: the client's own Date.now() is trivially changeable by
// whoever controls that computer's system clock. Asking the server (a
// Vercel serverless function whose clock the browser can't touch) for the
// timestamp at the moment of logging is a real, if modest, improvement —
// it means the recorded time reflects when THIS SERVER received the
// request, not whatever the browser's clock happened to say. It is not a
// cryptographic timestamp authority and this app doesn't claim it is; see
// the honesty note in hashChain.js for what the hash chain as a whole does
// and doesn't prove.
//
// Deliberately tiny and side-effect-free: no auth, no state, nothing to
// rate-limit or abuse beyond ordinary traffic, so it stays out of the way
// of the /api/token hardening in Bug #8.
export async function GET() {
  return Response.json(
    { timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
