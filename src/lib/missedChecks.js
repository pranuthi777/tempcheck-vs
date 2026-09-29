/**
 * Per-unit/location missed-check detection.
 *
 * The old signal was a single global "minutes since ANY reading was
 * logged" — so a cook checking the walk-in cooler every ten minutes made
 * the fryer's missed three-hour check invisible, and a busy, chatty shift
 * looked "fine" even when a specific station hadn't actually been checked
 * in hours. This replaces it with an independent timer per unit/location:
 * each unit's own most recent reading is tracked, and it's flagged
 * overdue once more than `intervalMs` has passed since ITS last check,
 * not the shift's last reading of any kind.
 *
 * "Unit" here is whatever the cook named — a location ("walk-in cooler")
 * or, if no location was given, a food item ("chicken breast") — the same
 * grouping the dashboard's live status board already uses.
 */

const HOUR_MS = 3600000;
const DEFAULT_INTERVAL_MS = 2 * HOUR_MS;

/**
 * @param {{readings: Array, now: number, intervalMs?: number}} input
 * @returns {Array<{unit:string, lastCheckedAt:number, minutesSince:number}>}
 *   Most-overdue unit first.
 */
function computeOverdueUnits({ readings, now, intervalMs = DEFAULT_INTERVAL_MS }) {
  // label -> { label, lastCheckedAt }, keyed by a case-insensitive form so
  // "Walk-in Cooler" and "walk-in cooler" are the same unit, but the
  // original casing is kept for display.
  const lastByUnit = new Map();

  for (const r of readings) {
    if (r.superseded) continue;
    // A cooling_start/check is tracking one specific batch, not a routine
    // temperature check of the unit — it must not stand in for "this
    // station was checked" (nor mask a real check being overdue).
    if (r.category === "cooling") continue;
    const label = r.location || r.foodItem;
    if (!label) continue;
    const key = label.toLowerCase().trim();
    if (!key) continue;
    const existing = lastByUnit.get(key);
    if (!existing || r.timestamp > existing.lastCheckedAt) {
      lastByUnit.set(key, { label, lastCheckedAt: r.timestamp });
    }
  }

  const overdue = [];
  for (const { label, lastCheckedAt } of lastByUnit.values()) {
    const elapsedMs = now - lastCheckedAt;
    if (elapsedMs >= intervalMs) {
      overdue.push({ unit: label, lastCheckedAt, minutesSince: Math.floor(elapsedMs / 60000) });
    }
  }
  overdue.sort((a, b) => b.minutesSince - a.minutesSince);
  return overdue;
}

module.exports = { computeOverdueUnits, DEFAULT_INTERVAL_MS };
