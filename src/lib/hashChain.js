/**
 * SHA-256 hash chain across log entries (Bug #5 / tamper-evidence).
 *
 * IMPORTANT — what this actually proves, and what it doesn't: this app
 * has no server-side persistent log store; readings live in the browser
 * (localStorage) until exported. So this hash chain cannot prove a probe
 * was actually used, and — Round-3 critique #P0-4 — it cannot stop someone
 * with full control of their own browser (devtools, editing localStorage
 * directly) from recomputing a brand-new, internally-consistent chain from
 * scratch and replacing the stored one wholesale: nothing here is signed
 * by anything the browser doesn't also control. What it DOES catch is a
 * NAIVE edit: changing, inserting, reordering, or deleting an entry (or a
 * correction/resolution event, see below) in an EXISTING chain without
 * recomputing every hash after it — the realistic case of someone editing
 * one field in devtools/localStorage and not bothering to (or not being
 * able to, without the original secret ordering) regenerate the rest of
 * the chain by hand. Turning this into a guarantee a sophisticated
 * attacker with full browser access couldn't defeat would need a
 * server-side HMAC over each entry (secret key never shipped to the
 * client) or a persistent server-side log store — this app has neither
 * (no backend database; see README "Tamper-evident log" and "Known
 * limitations"). Combined with the server-issued timestamp (see
 * /api/log-timestamp) and the verbatim spoken transcript stored per entry,
 * this is honestly a "this is what was said, in this order, at this time,
 * and nothing was edited without also being re-hashed" guarantee — not an
 * unforgeable one, and not a "a thermometer probe touched food at this
 * temperature" guarantee. Say so plainly wherever this is surfaced.
 *
 * Round-3 critique #P0-3: a manager marking a violation resolved, or a
 * cook's later correction linking back to an earlier reading, used to be
 * an UNHASHED flag (`superseded`/`resolvedAt`) mutated directly onto the
 * original reading object — which meant hand-editing that flag in
 * localStorage (setting a real 152°F chicken-breast violation's
 * `superseded: true`, say, to make it vanish from the violations list)
 * left the hash chain completely intact, because those fields were never
 * part of any entry's hashed payload. Superseding and resolving are now
 * their own small, hashed, APPENDED events (kind "correction" / kind
 * "resolution") in the very same chain as the readings themselves — the
 * original reading's own hash still never changes after logging (exactly
 * as before), but the fact that it was later corrected or resolved is now
 * itself a tamper-evident fact, not a free-floating flag. verifyLog below
 * cross-checks every reading's cached superseded/resolvedAt display flags
 * against what the verified event log actually says, and reports a
 * mismatch as broken — see verifyLog's tests for exactly what this catches.
 */

const GENESIS_HASH = "0".repeat(64);

// Only the fields that define "what was logged," in a fixed order, so the
// hash is reproducible and never depends on object key insertion order or
// on volatile UI-only fields. For a reading, `superseded`/`resolvedAt`/
// `supersededAt`/`supersededNote` are deliberately EXCLUDED — see the file
// header: those are now separate, appended "correction"/"resolution"
// events (below), never unhashed flags baked into the original entry.
function canonicalPayload(entry) {
  const kind = entry.kind || "reading";

  if (kind === "reading") {
    return JSON.stringify({
      kind: "reading",
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

  if (kind === "correction") {
    return JSON.stringify({
      kind: "correction",
      id: entry.id,
      targetId: entry.targetId,
      correctedTemperatureF: Number.isFinite(entry.correctedTemperatureF) ? entry.correctedTemperatureF : null,
      correctedStatus: entry.correctedStatus || null,
      timestamp: entry.timestamp,
    });
  }

  if (kind === "resolution") {
    return JSON.stringify({
      kind: "resolution",
      id: entry.id,
      targetId: entry.targetId,
      resolved: !!entry.resolved,
      timestamp: entry.timestamp,
    });
  }

  throw new Error(`canonicalPayload: unknown entry kind "${kind}"`);
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
 * reordered, inserted, or deleted after the fact. Works over readings
 * AND correction/resolution events alike (canonicalPayload branches on
 * `kind`) — this is the purely structural check; verifyLog below also
 * cross-checks derived state.
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

/**
 * Replays a (chronologically sorted) list of correction/resolution events
 * into a Map of targetId -> derived display state. The LAST event for a
 * given target wins (a resolution can be toggled back and forth; a
 * correction is normally one-shot but replaying in order is still
 * correct either way).
 */
function deriveReadingState(events) {
  const sorted = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const state = new Map();
  for (const ev of sorted) {
    if (ev.kind === "correction") {
      const s = state.get(ev.targetId) || {};
      state.set(ev.targetId, {
        ...s,
        superseded: true,
        supersededAt: ev.timestamp,
        correctedTemperatureF: ev.correctedTemperatureF,
        correctedStatus: ev.correctedStatus,
      });
    } else if (ev.kind === "resolution") {
      const s = state.get(ev.targetId) || {};
      state.set(ev.targetId, { ...s, resolvedAt: ev.resolved ? ev.timestamp : null });
    }
  }
  return state;
}

// A reading's cached display flags must match what the verified event log
// actually says — a mismatch means the flag was set (or cleared) some way
// other than through the app's own correction/resolve actions, which are
// the only things that append a matching event.
function stateMatches(reading, derived) {
  const wantSuperseded = !!(derived && derived.superseded);
  if (!!reading.superseded !== wantSuperseded) return false;
  const wantResolvedAt = (derived && derived.resolvedAt) || null;
  const haveResolvedAt = reading.resolvedAt || null;
  if (!!wantResolvedAt !== !!haveResolvedAt) return false;
  return true;
}

/**
 * Full verification: readings and correction/resolution events are merged
 * into one append-ordered (by `seq`) chain and structurally verified
 * together (verifyHashChain), THEN every reading's cached
 * superseded/resolvedAt flags are cross-checked against what the verified
 * events actually derive — see the file header for why this second step
 * exists (Round-3 #P0-3).
 *
 * @param {{readings: object[], events: object[]}} log
 * @returns {{verified:boolean, brokenAt:string|null, reason:string|null}}
 */
async function verifyLog({ readings, events }) {
  const merged = [...readings, ...events].slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const structural = await verifyHashChain(merged);
  if (!structural.verified) return structural;

  const derivedByTarget = deriveReadingState(events);
  for (const r of readings) {
    const derived = derivedByTarget.get(r.id);
    if (!stateMatches(r, derived)) {
      return {
        verified: false,
        brokenAt: r.id,
        reason:
          "This entry's superseded/resolved status doesn't match the tamper-evident correction/resolution log — it was set some way other than through the app's own Mark Resolved button or a spoken correction.",
      };
    }
  }
  return { verified: true, brokenAt: null, reason: null };
}

module.exports = {
  canonicalPayload,
  sha256Hex,
  computeEntryHash,
  buildHashChain,
  verifyHashChain,
  deriveReadingState,
  verifyLog,
  GENESIS_HASH,
};
