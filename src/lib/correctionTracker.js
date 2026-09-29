/**
 * Detects when a newly logged reading is actually the cook CORRECTING a
 * reading they just gave, rather than a brand-new independent check.
 *
 * Two distinct correction cases exist in this app:
 *  1. Mid-sentence, same tool call ("38, no wait, 48") — already handled
 *     entirely inside the voice agent's own system prompt (agentConfig.js
 *     rule 7): the LLM is instructed to send only the LAST number, so only
 *     ONE log_reading call happens and there's nothing for this module to
 *     do.
 *  2. Cross-turn, two separate tool calls: the cook hears the readback and
 *     THEN corrects it ("wait, that's wrong, it's 48") as its own turn.
 *     This produces two separate log_reading calls for what is really one
 *     physical reading — without this tracker, the app would silently keep
 *     BOTH entries in the log side by side, with no link between them and
 *     no way to tell the first one was wrong. That's a real gap: a stale
 *     "safe" entry sitting in the log right next to its correction, with
 *     nothing marking it superseded.
 *
 * This module only detects case 2 and reports which prior reading (if any)
 * a new one corrects — it doesn't remove or mutate anything itself. The
 * caller (useVoiceAgent.js) decides how to record the audit trail.
 *
 * Round-3 critique #P0-1 — a real, dangerous bug found by manual review:
 * this used to match on LOCATION alone (or food_item alone) purely by
 * proximity in time. That meant two DIFFERENT food items checked
 * back-to-back at the same station — "walk-in cooler, chicken, forty
 * eight" then, twenty seconds later, "walk-in cooler, milk, thirty
 * eight" — got linked as if the second corrected the first, because both
 * mention "walk-in cooler." The genuine 48°F chicken violation would have
 * been silently marked "superseded" by an unrelated milk reading and
 * dropped out of the violations list. Fixed two ways, both required:
 *
 *  1. Matching is now on food_item ONLY, never location. A correction is
 *     about the same physical item being re-stated, not the same shelf.
 *     A reading with no food_item at all (a pure storage-unit/air check,
 *     e.g. "walk-in cooler, thirty eight") is never treated as
 *     correctable by this tracker — two consecutive location-only
 *     readings are two independent checks. A genuinely spoken correction
 *     of a location-only reading going undetected just leaves two
 *     separate entries in the log, which is the safe direction to err in
 *     (nothing is ever hidden); the old behavior's failure mode was the
 *     dangerous direction (a real violation silently vanishing).
 *  2. Proximity in time is no longer sufficient by itself either: the new
 *     reading's own spoken words must contain an explicit correction cue
 *     ("no", "wait", "sorry", "I mean", "actually", "that's wrong", …).
 *     Two honest, independent re-checks of the same food item within the
 *     window (a manager saying "check that chicken again") must not be
 *     silently merged just because they're close together in time and
 *     share a food item.
 */

const DEFAULT_WINDOW_MS = 45000;

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

// Food-item-only identity key — see the file header for why location is
// deliberately never used to match a correction.
function identityKeyFor({ foodItem }) {
  const item = normalize(foodItem);
  return item ? "item:" + item : null;
}

const CORRECTION_CUE_PATTERNS = [
  /\bno\b/i,
  /\bnope\b/i,
  /\bwait\b/i,
  /\bsorry\b/i,
  /\bi mean\b/i,
  /\bactually\b/i,
  /\bthat'?s wrong\b/i,
  /\bmy mistake\b/i,
  /\bmisspoke\b/i,
  /\bcorrection\b/i,
  /\bmeant to say\b/i,
  /\bnot\s+\d/i, // "not thirty eight" / "not 38"
];

function hasCorrectionCue(text) {
  const t = text || "";
  return CORRECTION_CUE_PATTERNS.some((re) => re.test(t));
}

/**
 * @param {{windowMs?: number}} [options]
 */
function createCorrectionTracker({ windowMs = DEFAULT_WINDOW_MS } = {}) {
  const latestByKey = new Map(); // key -> { id, temperatureF, status, timestamp }

  /**
   * Records a new reading and, if it looks like a correction of a very
   * recent prior reading for the SAME food_item AND the new reading's own
   * spoken words contain a correction cue, returns that prior reading's
   * info. Always updates the tracker's own "latest" state for this
   * reading's key (when it has a food_item), whether or not a correction
   * was detected — so a LATER reading with a cue phrase can still find
   * and correct an earlier one that had none.
   *
   * @param {{id:string, foodItem?:string, temperatureF:number, status:string, timestamp?:number, cookText?:string}} reading
   * @returns {{id:string, temperatureF:number, status:string, timestamp:number}|null}
   */
  function checkAndRecord({ id, foodItem, temperatureF, status, timestamp = Date.now(), cookText }) {
    const key = identityKeyFor({ foodItem });
    let corrects = null;

    if (key && Number.isFinite(temperatureF) && hasCorrectionCue(cookText)) {
      const prior = latestByKey.get(key);
      if (
        prior &&
        prior.id !== id &&
        Number.isFinite(prior.temperatureF) &&
        timestamp - prior.timestamp >= 0 &&
        timestamp - prior.timestamp <= windowMs
      ) {
        corrects = prior;
      }
    }

    if (key && Number.isFinite(temperatureF)) {
      latestByKey.set(key, { id, temperatureF, status, timestamp });
    }

    return corrects;
  }

  return { checkAndRecord, windowMs };
}

module.exports = { createCorrectionTracker, identityKeyFor, hasCorrectionCue, DEFAULT_WINDOW_MS };
