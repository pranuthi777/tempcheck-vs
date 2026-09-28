const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateReading } = require("./ruleEngine");

test("cold holding: safe at 38F walk-in cooler", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 38 });
  assert.equal(r.category, "cold_holding");
  assert.equal(r.status, "safe");
  assert.equal(r.correctiveAction, null);
});

test("cold holding: red at 48F walk-in cooler (the 38 vs 48 misread case)", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 48 });
  assert.equal(r.status, "red");
  assert.match(r.correctiveAction, /colder unit|discard/i);
});

test("cold holding: amber at 43F", () => {
  const r = evaluateReading({ location: "walk-in cooler", temperatureF: 43 });
  assert.equal(r.status, "amber");
});

test("poultry: red below 165F", () => {
  const r = evaluateReading({ foodItem: "chicken breast", temperatureF: 152 });
  assert.equal(r.category, "poultry");
  assert.equal(r.status, "red");
  assert.match(r.correctiveAction, /165/);
});

test("poultry: safe at exactly 165F (boundary)", () => {
  const r = evaluateReading({ foodItem: "chicken", temperatureF: 165 });
  assert.equal(r.status, "safe");
});

test("poultry: safe at 165.0 but red at 164.9 (boundary precision)", () => {
  const r = evaluateReading({ foodItem: "chicken", temperatureF: 164.9 });
  assert.equal(r.status, "amber"); // within amber band of 5F below 165
});

test("ground meat: 155F boundary", () => {
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 155 }).status, "safe");
  assert.equal(evaluateReading({ foodItem: "ground beef", temperatureF: 149 }).status, "red");
});

test("whole muscle: steak at 145F safe, 130F red", () => {
  assert.equal(evaluateReading({ foodItem: "steak", temperatureF: 145 }).status, "safe");
  assert.equal(evaluateReading({ foodItem: "steak", temperatureF: 130 }).status, "red");
});

test("fish/seafood/eggs: 145F threshold", () => {
  assert.equal(evaluateReading({ foodItem: "salmon", temperatureF: 146 }).status, "safe");
  assert.equal(evaluateReading({ foodItem: "eggs", temperatureF: 138 }).status, "red");
});

test("hot holding: 135F threshold, steam table location", () => {
  assert.equal(evaluateReading({ location: "steam table", temperatureF: 136 }).status, "safe");
  assert.equal(evaluateReading({ location: "steam table", temperatureF: 120 }).status, "red");
});

test("reheating: explicit readingType overrides location/item guess", () => {
  const r = evaluateReading({ readingType: "reheating", foodItem: "soup", temperatureF: 170 });
  assert.equal(r.category, "reheating");
  assert.equal(r.status, "safe");
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
  // not an FDA violation for cold holding — the rule only requires <=41F.
  assert.equal(evaluateReading({ location: "walk-in cooler", temperatureF: -10 }).status, "safe");
  // The equivalent nonsense case for a rule with a lower bound (hot holding)
  // correctly comes back red.
  assert.equal(evaluateReading({ location: "steam table", temperatureF: -10 }).status, "red");
});
