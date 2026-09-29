const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateReading } = require("./ruleEngine");

// --- Amber/red semantics (redesigned) ---
// The FDA Food Code itself is binary: compliant or violation, at the exact
// `safeAt` threshold. There is no official middle tier. So under the
// corrected design:
//   - "red" means an ACTUAL violation — crossed the FDA line. No buffer.
//   - "amber" sits entirely on the COMPLIANT side of the line — a
//     close-call heads-up ("still legal, but worth double-checking"), never
//     a mislabeled violation.
//   - "safe" means comfortably compliant, outside the amber band.
// For cold_holding (safeAt=41, amberBandF=3): safe < 38, amber 38-41, red > 41.
// For an "at_or_above" category (safeAt=S, amberBandF=B): safe > S+B,
// amber S..S+B, red < S.

test("cold holding: comfortably safe well below the limit", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 30 });
  assert.equal(r.category, "cold_holding");
  assert.equal(r.status, "safe");
  assert.equal(r.correctiveAction, null);
});

test("cold holding: 38F-41F is amber (compliant, but close to the 41F line)", () => {
  const low = evaluateReading({ location: "walk-in cooler", temperatureF: 38 });
  assert.equal(low.status, "amber");
  assert.equal(low.correctiveAction, null); // amber is compliant — no violation, no corrective action

  const high = evaluateReading({ location: "walk-in cooler", temperatureF: 41 });
  assert.equal(high.status, "amber");
});

test("cold holding: any reading above 41F is red — no buffer, it's an actual violation", () => {
  const barelyOver = evaluateReading({ location: "walk-in cooler", temperatureF: 41.1 });
  assert.equal(barelyOver.status, "red");
  assert.ok(barelyOver.correctiveAction);

  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 48 });
  assert.equal(r.status, "red");
  assert.match(r.correctiveAction, /colder unit|discard/i);
});

test("poultry: red for anything below 165F — the FDA line is binary, no amber buffer under it", () => {
  const r = evaluateReading({ foodItem: "chicken breast", temperatureF: 152 });
  assert.equal(r.category, "poultry");
  assert.equal(r.status, "red");
  assert.match(r.correctiveAction, /165/);

  // Even 164.9F — a hair under the line — is a real violation, not amber.
  const barelyUnder = evaluateReading({ foodItem: "chicken", temperatureF: 164.9 });
  assert.equal(barelyUnder.status, "red");
});

test("poultry: 165F-170F is amber (compliant, but close enough to double-check)", () => {
  const atLimit = evaluateReading({ foodItem: "chicken", temperatureF: 165 });
  assert.equal(atLimit.status, "amber");
  assert.equal(atLimit.correctiveAction, null);

  const upperBand = evaluateReading({ foodItem: "chicken", temperatureF: 170 });
  assert.equal(upperBand.status, "amber");
});

test("poultry: comfortably safe above the amber band", () => {
  const r = evaluateReading({ foodItem: "chicken", temperatureF: 180 });
  assert.equal(r.status, "safe");
});

test("ground meat: 155F boundary is amber, below is red", () => {
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 155 }).status, "amber");
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 160 }).status, "amber");
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 161 }).status, "safe");
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 149 }).status, "red");
});

test("whole muscle: steak at 145F is amber (compliant, close call), 130F red, 151F safe", () => {
  assert.equal(evaluateReading({ foodItem: "steak", temperatureF: 145 }).status, "amber");
  assert.equal(evaluateReading({ foodItem: "steak", temperatureF: 130 }).status, "red");
  assert.equal(evaluateReading({ foodItem: "steak", temperatureF: 151 }).status, "safe");
});

test("fish/seafood/eggs: 145F-150F is amber, below 145F is red, above 150F is safe", () => {
  assert.equal(evaluateReading({ foodItem: "salmon", temperatureF: 146 }).status, "amber");
  assert.equal(evaluateReading({ foodItem: "salmon", temperatureF: 151 }).status, "safe");
  assert.equal(evaluateReading({ foodItem: "eggs", temperatureF: 138 }).status, "red");
});

test("freezer: keeps frozen at 0F or below; -3F-0F is amber, above 0F is red, well below is safe", () => {
  assert.equal(evaluateReading({ location: "freezer", temperatureF: -10 }).status, "safe");
  assert.equal(evaluateReading({ location: "walk-in freezer", temperatureF: -2 }).status, "amber");
  assert.equal(evaluateReading({ location: "freezer", temperatureF: 0 }).status, "amber");
  assert.equal(evaluateReading({ location: "freezer", temperatureF: 5 }).status, "red");
  const r = evaluateReading({ location: "walk-in freezer", temperatureF: 10 });
  assert.equal(r.category, "freezer");
  assert.match(r.correctiveAction, /colder|discard|freezer/i);
});

test("hot holding: 135F-140F is amber, below 135F is red, above 140F is safe", () => {
  assert.equal(evaluateReading({ location: "steam table", temperatureF: 136 }).status, "amber");
  assert.equal(evaluateReading({ location: "steam table", temperatureF: 141 }).status, "safe");
  assert.equal(evaluateReading({ location: "steam table", temperatureF: 120 }).status, "red");
});

test("reheating: explicit readingType overrides location/item guess", () => {
  const r = evaluateReading({ readingType: "reheating", foodItem: "soup", temperatureF: 175 });
  assert.equal(r.category, "reheating");
  assert.equal(r.status, "safe");

  // 170F is the top of reheating's amber band (165-170), not "safe" —
  // a reading exactly at the edge of the band still gets the close-call
  // treatment, it isn't rounded up to comfortably-safe.
  const edge = evaluateReading({ readingType: "reheating", foodItem: "soup", temperatureF: 170 });
  assert.equal(edge.status, "amber");
});

test("unknown item/location is flagged, never assumed safe", () => {
  const r = evaluateReading({ location: "prep table", foodItem: "quinoa salad", temperatureF: 60 });
  assert.equal(r.category, "unknown");
  assert.equal(r.status, "unknown");
  assert.ok(r.correctiveAction);
});

test("non-numeric temperature is flagged, not silently defaulted", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: "not a number" });
  assert.equal(r.status, "unknown");
});

test("very cold cooler reading is 'safe' by the cold-holding rule (colder is never a hazard), but out-of-range hot-holding is red", () => {
  // -10F in a cooler is unusually cold (maybe a broken thermometer) but is
  // not an FDA violation for cold holding — the rule only requires <=41F,
  // and -10F is well outside the amber band too.
  assert.equal(evaluateReading({ location: "walk-in cooler", temperatureF: -10 }).status, "safe");
  // The equivalent nonsense case for a rule with a lower bound (hot holding)
  // correctly comes back red.
  assert.equal(evaluateReading({ location: "steam table", temperatureF: -10 }).status, "red");
});

test("amber never carries a corrective action — it's compliant, not a violation; red always does", () => {
  const amber = evaluateReading({ location: "walk-in cooler", temperatureF: 40 });
  assert.equal(amber.status, "amber");
  assert.equal(amber.correctiveAction, null);

  const red = evaluateReading({ location: "walk-in cooler", temperatureF: 45 });
  assert.equal(red.status, "red");
  assert.ok(red.correctiveAction);
});

test("the old confirmRecommended field is gone — amber itself is now the close-call signal", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 38 });
  assert.equal(r.confirmRecommended, undefined);
});

test("code wins over the LLM's reading_type: chicken breast mislabeled hot_holding is still evaluated as poultry and comes back red at 140F", () => {
  const r = evaluateReading({ foodItem: "chicken breast", readingType: "hot_holding", temperatureF: 140 });
  assert.equal(r.category, "poultry");
  assert.equal(r.status, "red");
  assert.equal(r.categoryConflict, true);
  assert.match(r.correctiveAction, /165/);
});

test("no conflict flag when the LLM's reading_type matches (or there's nothing to check it against)", () => {
  const agree = evaluateReading({ foodItem: "chicken breast", readingType: "poultry", temperatureF: 180 });
  assert.equal(agree.categoryConflict, false);

  const noGuess = evaluateReading({ foodItem: "chicken breast", temperatureF: 180 });
  assert.equal(noGuess.categoryConflict, false);

  // Code can't resolve this one at all, so the LLM's own reading_type is
  // trusted and there's nothing to flag as a conflict.
  const trusted = evaluateReading({ foodItem: "soup", readingType: "reheating", temperatureF: 175 });
  assert.equal(trusted.category, "reheating");
  assert.equal(trusted.categoryConflict, false);
});

test("every recognized category cites its specific FDA Food Code section", () => {
  const cases = [
    { location: "walk-in cooler", temperatureF: 30, citation: "3-501.16(A)(2)" },
    { location: "steam table", temperatureF: 141, citation: "3-501.16(A)(1)" },
    { foodItem: "chicken breast", temperatureF: 180, citation: "3-401.11(A)(2)" },
    { foodItem: "ground beef", temperatureF: 161, citation: "3-401.11(A)(3)" },
    { foodItem: "steak", temperatureF: 151, citation: "3-401.11(A)(1)/(B)" },
    { foodItem: "salmon", temperatureF: 151, citation: "3-401.11(A)(1)" },
    { readingType: "reheating", foodItem: "soup", temperatureF: 175, citation: "3-403.11(A)" },
  ];
  for (const { citation, ...input } of cases) {
    const r = evaluateReading(input);
    assert.ok(r.citation && r.citation.includes(citation), `expected citation containing ${citation}, got ${r.citation}`);
  }
});
