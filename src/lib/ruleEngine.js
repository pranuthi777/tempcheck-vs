/**
 * Deterministic FDA Food Code temperature rule engine.
 *
 * IMPORTANT: this file contains zero calls to any LLM. Every safety decision
 * is a plain numeric comparison against a published limit, so the same
 * reading always produces the same verdict. The voice agent's LLM is only
 * ever used to extract structured fields (location/item/temperature) from
 * speech and to phrase the spoken response — it never decides whether a
 * temperature is safe.
 *
 * Limits are drawn from the FDA Food Code (2022 edition), specifically:
 *  - 3-501.16(A)(2): cold holding at 41°F (5°C) or below
 *  - 3-501.16(A)(1): hot holding at 135°F (57°C) or above
 *  - 3-401.11(A)(2): poultry, stuffed meats/pasta/poultry: 165°F (15 sec)
 *  - 3-401.11(A)(3): ground/injected meats: 155°F (15 sec)
 *  - 3-401.11(A)(1)/(B): whole-muscle intact beef/pork/veal/lamb roasts &
 *    steaks/chops: 145°F (3 min rest for roasts; steaks/chops 145°F/15 sec)
 *  - 3-401.11(A)(1): fish, shellfish, eggs for immediate service: 145°F (15 sec)
 *  - 3-403.11(A): reheating for hot holding: 165°F within 2 hours
 *
 * IMPORTANT — what's regulatory vs. what's ours: the FDA Food Code itself is
 * binary (compliant / violation) at the `safeAt` thresholds above — it does
 * not define an "amber" tier. `amberBandF` below is our own invented
 * early-warning buffer (a few degrees before the hard violation line), so a
 * cook gets a heads-up before a reading actually crosses into "red." It is
 * explicitly NOT a Food Code number and is labelled "borderline" in the
 * message text, never presented as a regulatory limit — stated here plainly
 * so it's never mistaken for one of the cited limits above.
 */

const { resolveCategory, CATEGORY_LABELS } = require("./foodCategories");

// [amberLow, safeThreshold] pairs per category. Direction differs:
// cold_holding is "safe at or BELOW threshold"; everything else is
// "safe at or ABOVE threshold". amberBandF is our own early-warning buffer,
// not an FDA number — see the file header.
// citation is the specific FDA Food Code (2022 edition) section for that
// limit — the same sections cited in the file header — shown in the log
// and the exported PDF so a reading's regulatory basis is never just
// asserted, it's pointed at.
const LIMITS = {
  cold_holding: { direction: "at_or_below", safeAt: 41, amberBandF: 4, citation: "FDA Food Code 3-501.16(A)(2)" },
  hot_holding: { direction: "at_or_above", safeAt: 135, amberBandF: 5, citation: "FDA Food Code 3-501.16(A)(1)" },
  poultry: { direction: "at_or_above", safeAt: 165, amberBandF: 5, citation: "FDA Food Code 3-401.11(A)(2)" },
  ground_meat: { direction: "at_or_above", safeAt: 155, amberBandF: 5, citation: "FDA Food Code 3-401.11(A)(3)" },
  whole_muscle: { direction: "at_or_above", safeAt: 145, amberBandF: 5, citation: "FDA Food Code 3-401.11(A)(1)/(B)" },
  fish_seafood: { direction: "at_or_above", safeAt: 145, amberBandF: 5, citation: "FDA Food Code 3-401.11(A)(1)" },
  reheating: { direction: "at_or_above", safeAt: 165, amberBandF: 5, citation: "FDA Food Code 3-403.11(A)" },
};

// How close (in °F) a *safe* reading has to be to its category's limit
// before we treat it as a close call worth an explicit confirmation, not
// just a one-way readback. This exists because of a real gap: a reading
// that's misheard within the safe zone (e.g. a true 48°F logged as a
// "safe" 38°F for cold holding) produces a normal, unremarkable-sounding
// "safe" readback that's easy to not really listen to. We can't detect
// that specific failure from the logged number alone — but a lot of the
// readings a cook actually calls out *are* close to the line on purpose
// (checking a cooler that's running warm, watching a steam table drift
// down), and those are exactly the readings worth double-checking before
// moving on. Not an FDA number — see the file header note on amberBandF.
const CONFIRM_MARGIN_F = 5;

const CORRECTIVE_ACTIONS = {
  cold_holding:
    "Move product to a colder unit or add ice immediately. If it's been above 41°F for more than 4 hours, discard it.",
  hot_holding:
    "Reheat to at least 165°F within 2 hours, or discard the product.",
  poultry: "Continue cooking until it reaches at least 165°F, then re-check.",
  ground_meat:
    "Continue cooking until it reaches at least 155°F, then re-check.",
  whole_muscle:
    "Continue cooking until it reaches at least 145°F with a 3-minute rest, then re-check.",
  fish_seafood:
    "Continue cooking until it reaches at least 145°F, then re-check.",
  reheating:
    "Continue reheating to at least 165°F. If more than 2 hours have passed since reheating started, discard.",
  unknown:
    "Category not recognized — flag for a manager to classify and re-check manually.",
};

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{location?:string, foodItem?:string, readingType?:string, temperatureF:number}} input
 * @returns {{
 *   category: string, categoryLabel: string, status: 'safe'|'amber'|'red'|'unknown',
 *   limitF: number|null, correctiveAction: string|null, message: string,
 *   citation: string|null
 * }}
 */
function evaluateReading(input) {
  const temperatureF = Number(input.temperatureF);
  const category = resolveCategory(input);
  const categoryLabel = CATEGORY_LABELS[category];

  if (!Number.isFinite(temperatureF)) {
    return {
      category,
      categoryLabel,
      status: "unknown",
      limitF: null,
      correctiveAction: "Could not parse a numeric temperature — ask the cook to repeat the reading.",
      message: "No valid temperature was captured.",
      citation: null,
      confirmRecommended: false,
    };
  }

  // Sanity bound: no kitchen thermometer reading should plausibly fall
  // outside this range. A number outside it is almost certainly a
  // misheard digit (e.g. "138" heard as "38") and must be re-confirmed
  // with the cook rather than logged as-is.
  if (temperatureF < -20 || temperatureF > 250) {
    return {
      category,
      categoryLabel,
      status: "unknown",
      limitF: null,
      correctiveAction:
        "That reading is outside any plausible kitchen temperature range — ask the cook to repeat it before logging.",
      message: `${round1(temperatureF)}°F is implausible and was not saved.`,
      citation: null,
      confirmRecommended: false,
    };
  }

  if (category === "unknown") {
    return {
      category,
      categoryLabel,
      status: "unknown",
      limitF: null,
      correctiveAction: CORRECTIVE_ACTIONS.unknown,
      message: `${round1(temperatureF)}°F logged, but the item/location wasn't recognized. A manager should classify it.`,
      citation: null,
      confirmRecommended: false,
    };
  }

  const limit = LIMITS[category];
  const t = round1(temperatureF);

  let status;
  if (limit.direction === "at_or_below") {
    if (t <= limit.safeAt) status = "safe";
    else if (t <= limit.safeAt + limit.amberBandF) status = "amber";
    else status = "red";
  } else {
    if (t >= limit.safeAt) status = "safe";
    else if (t >= limit.safeAt - limit.amberBandF) status = "amber";
    else status = "red";
  }

  const verb = limit.direction === "at_or_below" ? "at or below" : "at or above";
  const message =
    status === "safe"
      ? `${t}°F is within the safe range for ${categoryLabel.toLowerCase()} (must be ${verb} ${limit.safeAt}°F).`
      : `${t}°F is ${status === "red" ? "a violation" : "borderline"} for ${categoryLabel.toLowerCase()} (must be ${verb} ${limit.safeAt}°F).`;

  // A "safe" verdict close enough to the limit that it's worth an explicit
  // confirmation before moving on, not just a readback — see CONFIRM_MARGIN_F
  // above. Amber/red readings already get a corrective-action question, so
  // this only fires for status === "safe".
  const confirmRecommended = status === "safe" && Math.abs(t - limit.safeAt) <= CONFIRM_MARGIN_F;

  return {
    category,
    categoryLabel,
    status,
    limitF: limit.safeAt,
    correctiveAction: status === "safe" ? null : CORRECTIVE_ACTIONS[category],
    message,
    citation: limit.citation,
    confirmRecommended,
  };
}

module.exports = { evaluateReading, LIMITS, CORRECTIVE_ACTIONS, CONFIRM_MARGIN_F };
