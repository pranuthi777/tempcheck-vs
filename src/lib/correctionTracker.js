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
 * Heuristic, stated plainly: "the same exchange" is approximated as
 * "the same normalized location/food_item, within a short time window."
 * A real correction almost always happens within seconds of the original
 * readback. A deliberately short window (default 45s) is used specifically
 * so two legitimate, separate checks of the same station later in a shift
 * are NOT mistaken for a correction of each other — a real but accepted
 * false-negative trade-off, not a claim that every correction is caught.
 */

const DEFAULT_WINDOW_MS = 45000;

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

// Mirrors useVoiceAgent.js's coolingKeys(): index under BOTH non-empty
// fields (food_item and location) since a correction may repeat only one
// of them ("walk-in cooler 38" ... "no, the cooler's 48").
function keysFor({ location, foodItem }) {
  const keys = [];
  if (foodItem) keys.push("item:" + normalize(foodItem));
  if (location) keys.push("loc:" + normalize(location));
  return keys;
}

/**
 * @param {{windowMs?: number}} [options]
 */
function createCorrectionTracker({ windowMs = DEFAULT_WINDOW_MS } = {}) {
  const latestByKey = new Map(); // key -> { id, temperatureF, status, timestamp }

  /**
   * Records a new reading and, if it looks like a correction of a very
   * recent prior reading for the same location/food_item, returns that
   * prior reading's info. Always updates the tracker's own "latest" state
   * for this reading's keys, whether or not a correction was detected.
   *
   * @param {{id:string, location?:string, foodItem?:string, temperatureF:number, status:string, timestamp?:number}} reading
   * @returns {{id:string, temperatureF:number, status:string, timestamp:number}|null}
   */
  function checkAndRecord({ id, location, foodItem, temperatureF, status, timestamp = Date.now() }) {
    const keys = keysFor({ location, foodItem });
    let corrects = null;

    if (keys.length > 0 && Number.isFinite(temperatureF)) {
      for (const k of keys) {
        const prior = latestByKey.get(k);
        if (
          prior &&
          prior.id !== id &&
          Number.isFinite(prior.temperatureF) &&
          timestamp - prior.timestamp >= 0 &&
          timestamp - prior.timestamp <= windowMs
        ) {
          corrects = prior;
          break;
        }
      }
    }

    const record = { id, temperatureF, status, timestamp };
    for (const k of keys) latestByKey.set(k, record);

    return corrects;
  }

  return { checkAndRecord, windowMs };
}

module.exports = { createCorrectionTracker, keysFor, DEFAULT_WINDOW_MS };
