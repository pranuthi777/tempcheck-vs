/**
 * SHA-256 hash chain across log entries (Bug #5 / tamper-evidence).
 *
 * IMPORTANT — what this actually proves, and what it doesn't: this app
 * has no server-side persistent log store; readings live in the browser
 * (localStorage) until exported. So this hash chain cannot prove a probe
 * was actually used, and it cannot stop someone with full control of their
 * own browser (devtools, editing localStorage directly) from fabricating
 * an entirely new, internally-consistent chain from scratch. What it DOES
 * catch is the much more common and realistic tampering scenario: editing
 * or deleting an entry from an EXISTING log after the fact (e.g. changing
 * a 152°F chicken-breast violation to 165°F after the shift, to make the
 * PDF look clean) — any such edit breaks the chain from that point
 * forward, because each entry's hash depends on the exact content of every
 * entry before it. Combined with the server-issued timestamp (see
 * /api/log-timestamp — attests when the entry was logged from the
 * server's own clock, harder to fake than a client Date.now() alone) and
 * the verbatim spoken transcript stored per entry, this is honestly a
 * "this is what was said, in this order, at this time" guarantee — not a
 * "a thermometer probe touched food at this temperature" guarantee. Say so
 * plainly wherever this is surfaced (README, PDF).
 */

const GENESIS_HASH = "0".repeat(64);

// Only the fields that define "what was logged," in a fixed order, so the
// hash is reproducible and never depends on object key insertion order or
// on volatile UI-only fields. Fields like `resolvedAt` or `superseded` are
// deliberately EXCLUDED — a manager marking a violation resolved, or a
// later correction linking back to this entry, must never look like
// tampering with the original record.
function canonicalPayload(entry) {
  return JSON.stringify({
    id: entry.id,
    clientTimestamp: entry.timestamp,
    serverTimestamp: entry.serverTimestamp || null,
    location: entry.location || null,
    foodItem: entry.foodItem || null,
    temperatureF: Number.isFinite(entry.temperatureF) ? entry.temperatureF : null,
    category: entry.category || null,
    status: entry.status || null,
    cookText: entry.cookText || null,
    correctsReadingId: entry.correctsReadingId || null,
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeEntryHash(entry, prevHash) {
  return sha256Hex(prevHash + canonicalPayload(entry));
}

/**
 * Builds a fresh chain over entries given in chronological (oldest-first)
 * order, returning each entry with its `prevHash`/`hash` attached.
 */
async function buildHashChain(entries) {
  let prevHash = GENESIS_HASH;
  const out = [];
  for (const entry of entries) {
    const hash = await computeEntryHash(entry, prevHash);
    out.push({ ...entry, prevHash, hash });
    prevHash = hash;
  }
  return out;
}

/**
 * Recomputes hashes over entries (chronological, oldest-first) that
 * already carry their own `prevHash`/`hash` from when they were logged,
 * and confirms every link still matches — i.e. nothing was edited,
 * reordered, inserted, or deleted after the fact.
 *
 * @returns {{verified:boolean, brokenAt:string|null, reason:string|null}}
 */
async function verifyHashChain(entries) {
  let prevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return {
        verified: false,
        brokenAt: entry.id,
        reason: "This entry's prevHash doesn't match the previous entry's hash — entries may have been reordered, inserted, or deleted.",
      };
    }
    const recomputed = await computeEntryHash(entry, prevHash);
    if (recomputed !== entry.hash) {
      return {
        verified: false,
        brokenAt: entry.id,
        reason: "This entry's stored hash doesn't match its content — it may have been edited after logging.",
      };
    }
    prevHash = entry.hash;
  }
  return { verified: true, brokenAt: null, reason: null };
}

module.exports = { canonicalPayload, sha256Hex, computeEntryHash, buildHashChain, verifyHashChain, GENESIS_HASH };
