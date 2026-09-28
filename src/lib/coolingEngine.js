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
 */

const COOLING_CITATION = "FDA Food Code 3-501.14(A)";
const STAGE1_LIMIT_F = 70;
const STAGE1_MAX_HOURS = 2;
const STAGE2_LIMIT_F = 41;
const STAGE2_MAX_HOURS = 6; // total elapsed since the start reading, not additional

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{startTemperatureF:number, startTimestamp:number, checkTemperatureF:number, checkTimestamp:number}} input
 * @returns {{status:'safe'|'amber'|'red', message:string, correctiveAction:string|null, citation:string, elapsedHours:number}}
 */
function evaluateCoolingCheck({ startTemperatureF, startTimestamp, checkTemperatureF, checkTimestamp }) {
  const elapsedMs = checkTimestamp - startTimestamp;
  const elapsedHours = round1(Math.max(0, elapsedMs) / 3600000);
  const t = round1(checkTemperatureF);

  let status, message, correctiveAction;

  if (elapsedHours <= STAGE1_MAX_HOURS) {
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
  } else if (elapsedHours <= STAGE2_MAX_HOURS) {
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
  } else {
    status = "red";
    message = `Cooling violation: ${elapsedHours}h have passed since ${round1(
      startTemperatureF
    )}°F — the 6-hour limit to reach 41°F was missed.`;
    correctiveAction = "Discard the product. It exceeded the maximum allowed cooling time under the FDA Food Code.";
  }

  return { status, message, correctiveAction, citation: COOLING_CITATION, elapsedHours };
}

module.exports = {
  evaluateCoolingCheck,
  COOLING_CITATION,
  STAGE1_LIMIT_F,
  STAGE1_MAX_HOURS,
  STAGE2_LIMIT_F,
  STAGE2_MAX_HOURS,
};
