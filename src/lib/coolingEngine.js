/**
 * FDA Food Code 3-501.14(A) cooling curve: cooked, potentially hazardous
 * food must be cooled from 135°F to 70°F within 2 hours, AND from 135°F to
 * 41°F within a total of 6 hours (i.e. no more than 4 additional hours
 * after reaching 70°F). Unlike every other check in this app, this one
 * needs TWO readings — a start and a later check — because it's a rate
 * requirement, not a point-in-time threshold. Still zero LLM judgment: the
 * verdict is a plain comparison of elapsed time against the two checkpoints
 * above, same deterministic-engine principle as ruleEngine.js.
 *
 * Known simplification, stated plainly: with only a start and one check
 * reading (no cook is going to log a third intermediate point mid-shift),
 * this can't verify the 70°F checkpoint was met exactly at the 2-hour mark
 * if the check happens later than that — it assumes monotonic cooling
 * (temperature only goes down) between the two logged points, which holds
 * for real food in a cooler but isn't independently confirmed. Good enough
 * for a hands-free MVP; a real HACCP program would log a mid-point too.
 *
 * A LATE check past a deadline is handled honestly, not optimistically or
 * punitively: if the reading right now is still above the target, that's
 * unambiguous — monotonic cooling means it was above the target at the
 * deadline too, so it's a real, provable violation (discard). But if the
 * late reading is AT OR BELOW the target, that does NOT prove compliance
 * — it might have reached the target right at the deadline (compliant) or
 * only much later, well past it (a violation) — this app has no
 * intermediate data point to tell which. Calling that "safe" would be a
 * false-safe; calling it "red, discard" would be punishing a cook for a
 * genuinely unknown outcome, potentially discarding food that was actually
 * fine. So it's reported as "amber: compliance can't be verified" and
 * left for a manager to decide, rather than the code guessing either way.
 *
 * A start temperature well below 135°F means the food never started hot
 * from cooking — it's "ambient/room-temperature ingredients" (e.g.
 * reconstituted or prepared cold food), for which the two-stage 70°F/2h
 * checkpoint doesn't apply and can't be meaningfully anchored at all.
 * FDA Food Code 3-501.14(B) governs that case instead: a single-stage
 * limit, straight to 41°F within 4 hours, no intermediate checkpoint.
 */

const COOLING_CITATION = "FDA Food Code 3-501.14(A)";
const AMBIENT_CITATION = "FDA Food Code 3-501.14(B)";
const HOUR_MS = 3600000;
const STAGE1_LIMIT_F = 70;
const STAGE1_MAX_HOURS = 2;
const STAGE1_START_MIN_F = 135; // below this, the food didn't start hot from cooking — see AMBIENT_CITATION above
const STAGE2_LIMIT_F = 41;
const STAGE2_MAX_HOURS = 6; // total elapsed since the start reading, not additional
const AMBIENT_LIMIT_F = 41;
const AMBIENT_MAX_HOURS = 4;

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{startTemperatureF:number, startTimestamp:number, checkTemperatureF:number, checkTimestamp:number}} input
 * @returns {{status:'safe'|'amber'|'red', message:string, correctiveAction:string|null, citation:string, elapsedHours:number}}
 */
function evaluateCoolingCheck({ startTemperatureF, startTimestamp, checkTemperatureF, checkTimestamp }) {
  // elapsedHours (rounded to 1 decimal) is for DISPLAY only. Every actual
  // deadline comparison below uses the exact elapsedMs — rounding first
  // would let a check that's genuinely a minute past a deadline (e.g.
  // 2h00m59s, which rounds to a deceptively clean "2.0h") get treated as
  // still within it.
  const elapsedMs = Math.max(0, checkTimestamp - startTimestamp);
  const elapsedHours = round1(elapsedMs / HOUR_MS);
  const t = round1(checkTemperatureF);

  let status, message, correctiveAction, citation;

  if (startTemperatureF < STAGE1_START_MIN_F) {
    // --- Ambient/room-temperature ingredients: FDA Food Code 3-501.14(B) ---
    citation = AMBIENT_CITATION;
    if (elapsedMs <= AMBIENT_MAX_HOURS * HOUR_MS) {
      if (t <= AMBIENT_LIMIT_F) {
        status = "safe";
        message = `Compliant: reached ${t}°F after ${elapsedHours}h from ${round1(
          startTemperatureF
        )}°F (ambient-ingredient rule: 41°F within 4h, no cooking-derived 2h/70°F checkpoint).`;
        correctiveAction = null;
      } else {
        status = "amber";
        message = `${t}°F after ${elapsedHours}h — on track, but must reach 41°F by the 4-hour mark (ambient-ingredient rule).`;
        correctiveAction = "Keep cooling; re-check before the 4-hour mark to confirm it reaches 41°F.";
      }
    } else if (t <= AMBIENT_LIMIT_F) {
      status = "amber";
      message = `${t}°F after ${elapsedHours}h — compliance can't be verified: no reading was logged at or before the 4-hour mark, so whether it reached 41°F in time isn't provable either way. A manager should review.`;
      correctiveAction = null;
    } else {
      status = "red";
      message = `Cooling violation: still ${t}°F after ${elapsedHours}h — the 4-hour ambient-ingredient limit was missed.`;
      correctiveAction = "Discard the product. It exceeded the maximum allowed cooling time under the FDA Food Code.";
    }
    return { status, message, correctiveAction, citation, elapsedHours };
  }

  // --- Cooked food, two-stage curve: FDA Food Code 3-501.14(A) ---
  citation = COOLING_CITATION;
  if (elapsedMs <= STAGE1_MAX_HOURS * HOUR_MS) {
    if (t <= STAGE1_LIMIT_F) {
      status = "safe";
      message = `On track: reached ${t}°F after ${elapsedHours}h from ${round1(
        startTemperatureF
      )}°F (needs 70°F within 2h, then 41°F within 6h total).`;
      correctiveAction = null;
    } else {
      status = "amber";
      message = `${t}°F after ${elapsedHours}h — still above 70°F with the 2-hour checkpoint approaching.`;
      correctiveAction =
        "Speed up cooling now (ice bath, shallow pans, blast chiller) to reach 70°F before the 2-hour mark.";
    }
  } else if (elapsedMs <= STAGE2_MAX_HOURS * HOUR_MS) {
    if (t <= STAGE2_LIMIT_F) {
      status = "safe";
      message = `Compliant: reached ${t}°F after ${elapsedHours}h total (within the 6-hour limit).`;
      correctiveAction = null;
    } else if (t <= STAGE1_LIMIT_F) {
      // Passed the 2h/70°F checkpoint but hasn't reached 41°F yet, and
      // there's still time left before the 6h mark — on track, not a
      // violation yet, but worth a heads-up close to the deadline.
      status = "amber";
      message = `${t}°F after ${elapsedHours}h — on track, but must reach 41°F by the 6-hour mark.`;
      correctiveAction = "Keep cooling; re-check before the 6-hour mark to confirm it reaches 41°F.";
    } else {
      // Never made it under 70°F even now, past the 2-hour checkpoint —
      // the first stage was already missed.
      status = "red";
      message = `Cooling violation: still ${t}°F after ${elapsedHours}h — the 70°F/2-hour checkpoint was missed.`;
      correctiveAction = "Discard the product. It did not cool to 70°F within the required 2 hours.";
    }
  } else if (t <= STAGE2_LIMIT_F) {
    // Past the 6h deadline, but AT OR BELOW 41°F right now: this does not
    // prove it complied (it might have reached 41°F right at 6h, or only
    // much later) — see the file header note. Never a silent "discard"
    // call on an outcome the code genuinely can't determine.
    status = "amber";
    message = `${t}°F after ${elapsedHours}h — compliance can't be verified: no reading was logged at or before the 6-hour mark, so whether it reached 41°F in time isn't provable either way. A manager should review.`;
    correctiveAction = null;
  } else {
    // Still above 41°F even now, past 6h — unambiguous: it was above 41°F
    // at the 6h mark too (monotonic cooling), so this is a real violation.
    status = "red";
    message = `Cooling violation: still ${t}°F after ${elapsedHours}h — the 6-hour limit to reach 41°F was missed.`;
    correctiveAction = "Discard the product. It exceeded the maximum allowed cooling time under the FDA Food Code.";
  }

  return { status, message, correctiveAction, citation, elapsedHours };
}

module.exports = {
  evaluateCoolingCheck,
  COOLING_CITATION,
  AMBIENT_CITATION,
  STAGE1_LIMIT_F,
  STAGE1_MAX_HOURS,
  STAGE1_START_MIN_F,
  STAGE2_LIMIT_F,
  STAGE2_MAX_HOURS,
  AMBIENT_LIMIT_F,
  AMBIENT_MAX_HOURS,
};
