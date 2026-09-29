const test = require("node:test");
const assert = require("node:assert/strict");
const { createCorrectionTracker } = require("./correctionTracker");

test("a second reading for the same location shortly after is flagged as a correction", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  const t0 = 1000;
  const first = tracker.checkAndRecord({
    id: "a",
    location: "walk-in cooler",
    temperatureF: 38,
    status: "amber",
    timestamp: t0,
  });
  assert.equal(first, null); // nothing to correct yet

  const second = tracker.checkAndRecord({
    id: "b",
    location: "walk-in cooler",
    temperatureF: 48,
    status: "red",
    timestamp: t0 + 5000, // 5s later — well within the correction window
  });
  assert.ok(second);
  assert.equal(second.id, "a");
  assert.equal(second.temperatureF, 38);
  assert.equal(second.status, "amber");
});

test("matches on food_item alone, even if location wasn't repeated", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", foodItem: "chicken breast", temperatureF: 140, status: "red", timestamp: 0 });
  const corrected = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken breast",
    temperatureF: 170,
    status: "safe",
    timestamp: 3000,
  });
  assert.equal(corrected.id, "a");
});

test("outside the correction window, it's treated as a brand-new independent check, not a correction", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", location: "steam table", temperatureF: 140, status: "amber", timestamp: 0 });
  const later = tracker.checkAndRecord({
    id: "b",
    location: "steam table",
    temperatureF: 138,
    status: "amber",
    timestamp: 46000, // 1s past the window
  });
  assert.equal(later, null);
});

test("a different location/item is never mistaken for a correction of an unrelated reading", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", location: "walk-in cooler", temperatureF: 38, status: "amber", timestamp: 0 });
  const unrelated = tracker.checkAndRecord({
    id: "b",
    location: "steam table",
    temperatureF: 140,
    status: "amber",
    timestamp: 1000,
  });
  assert.equal(unrelated, null);
});

test("a chain of corrections links each new reading to the immediately-prior one", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", location: "walk-in cooler", temperatureF: 38, status: "amber", timestamp: 0 });
  const secondCorrection = tracker.checkAndRecord({
    id: "b",
    location: "walk-in cooler",
    temperatureF: 48,
    status: "red",
    timestamp: 2000,
  });
  assert.equal(secondCorrection.id, "a");

  // A third correction (cook corrects themself AGAIN) links to "b", the
  // most recent one — not back to the original "a".
  const thirdCorrection = tracker.checkAndRecord({
    id: "c",
    location: "walk-in cooler",
    temperatureF: 40,
    status: "amber",
    timestamp: 3000,
  });
  assert.equal(thirdCorrection.id, "b");
});

test("a reading with no finite temperature never counts as, or gets treated as corrected by, anything", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  const noTemp = tracker.checkAndRecord({
    id: "a",
    location: "walk-in cooler",
    temperatureF: NaN,
    status: "unknown",
    timestamp: 0,
  });
  assert.equal(noTemp, null);

  // A real follow-up reading shouldn't be marked as "correcting" the
  // unparseable one — there's no prior number to have corrected.
  const follow = tracker.checkAndRecord({
    id: "b",
    location: "walk-in cooler",
    temperatureF: 38,
    status: "amber",
    timestamp: 1000,
  });
  assert.equal(follow, null);
});
