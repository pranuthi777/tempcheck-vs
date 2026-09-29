/**
 * Tracks pending "cooling start" readings as an explicit list of batches
 * (not a key->single-record map), so a second pot of the same item cooling
 * at the same time never silently overwrites the first one's pending
 * record — a real bug in the old Map-based tracker (keyed by normalized
 * item/location, last write wins).
 *
 * Each batch is keyed by item+location+start time (makeBatchId), which
 * this module's caller persists (shiftStorage) so pending cooling starts
 * survive a reload rather than vanishing the moment the tab closes.
 */

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function makeBatchId({ foodItem, location, startTimestamp }) {
  return `${normalize(foodItem)}|${normalize(location)}|${startTimestamp}`;
}

/**
 * Returns every pending batch whose food_item or location matches (by the
 * same normalized-substring-free exact-field comparison used elsewhere in
 * this app's cooling logic) — food_item first, then location, mirroring
 * how a cooling_check is usually phrased. Returns an array so the caller
 * can tell a single unambiguous match from a genuine "more than one batch
 * could be this" ambiguity, instead of silently picking the first one.
 */
function findMatches(batches, { foodItem, location }) {
  const item = normalize(foodItem);
  const loc = normalize(location);
  if (!item && !loc) return [];

  const byItem = item ? batches.filter((b) => normalize(b.foodItem) === item) : [];
  if (byItem.length > 0) return byItem;

  const byLoc = loc ? batches.filter((b) => normalize(b.location) === loc) : [];
  return byLoc;
}

module.exports = { makeBatchId, findMatches };
