const test = require("node:test");
const assert = require("node:assert/strict");
const { createCorrectionTracker } = require("./correctionTracker");

test("a same-food-item reading with a correction cue shortly after is flagged as a correction", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  const t0 = 1000;
  const first = tracker.checkAndRecord({
    id: "a",
    foodItem: "chicken breast",
    temperatureF: 140,
    status: "red",
    timestamp: t0,
    cookText: "Chicken breast, one forty.",
  });
  assert.equal(first, null); // nothing to correct yet

  const second = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken breast",
    temperatureF: 170,
    status: "safe",
    timestamp: t0 + 5000,
    cookText: "Wait, that's wrong, it's actually one seventy.",
  });
  assert.ok(second);
  assert.equal(second.id, "a");
  assert.equal(second.temperatureF, 140);
  assert.equal(second.status, "red");
});

test("Round-3 #P0-1: two DIFFERENT food items at the same location are never linked as a correction, even close in time", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  const chicken = tracker.checkAndRecord({
    id: "a",
    location: "walk-in cooler",
    foodItem: "chicken",
    temperatureF: 48,
    status: "red",
    timestamp: 0,
    cookText: "Walk-in cooler, chicken, forty eight.",
  });
  assert.equal(chicken, null);

  // Twenty seconds later, a DIFFERENT item at the SAME location — this
  // must never be mistaken for a correction of the chicken reading, even
  // though it mentions the same location and even has "wait" in it.
  const milk = tracker.checkAndRecord({
    id: "b",
    location: "walk-in cooler",
    foodItem: "milk",
    temperatureF: 38,
    status: "safe",
    timestamp: 20000,
    cookText: "Wait, also the walk-in cooler, milk, thirty eight.",
  });
  assert.equal(milk, null);
});

test("location-only readings (no food_item at all) are never treated as correctable, even with a cue phrase", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({
    id: "a",
    location: "walk-in cooler",
    temperatureF: 38,
    status: "amber",
    timestamp: 0,
    cookText: "Walk-in cooler, thirty eight.",
  });
  const second = tracker.checkAndRecord({
    id: "b",
    location: "walk-in cooler",
    temperatureF: 48,
    status: "red",
    timestamp: 2000,
    cookText: "No wait, walk-in cooler is actually forty eight.",
  });
  // No food_item on either side — never linked, regardless of the cue
  // phrase or how close in time. Both entries stay in the log
  // independently rather than risk silently hiding one.
  assert.equal(second, null);
});

test("same food_item, close in time, but NO correction cue in the new reading's words — not treated as a correction", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({
    id: "a",
    foodItem: "chicken breast",
    temperatureF: 140,
    status: "red",
    timestamp: 0,
    cookText: "Chicken breast, one forty.",
  });
  // A manager saying "check that chicken again" is a genuine independent
  // re-check, not a correction — no cue phrase, so it must not link.
  const recheck = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken breast",
    temperatureF: 170,
    status: "safe",
    timestamp: 3000,
    cookText: "Chicken breast, one seventy.",
  });
  assert.equal(recheck, null);
});

test("matches on food_item alone with a cue phrase, even if location wasn't repeated", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", foodItem: "chicken breast", temperatureF: 140, status: "red", timestamp: 0, cookText: "Chicken breast, one forty." });
  const corrected = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken breast",
    temperatureF: 170,
    status: "safe",
    timestamp: 3000,
    cookText: "Sorry, chicken breast is one seventy.",
  });
  assert.equal(corrected.id, "a");
});

test("outside the correction window, it's treated as a brand-new independent check, not a correction", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", foodItem: "soup", temperatureF: 140, status: "amber", timestamp: 0, cookText: "Soup, one forty." });
  const later = tracker.checkAndRecord({
    id: "b",
    foodItem: "soup",
    temperatureF: 138,
    status: "amber",
    timestamp: 46000, // 1s past the window
    cookText: "Wait, soup is one thirty eight.",
  });
  assert.equal(later, null);
});

test("a different food item is never mistaken for a correction of an unrelated reading", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", foodItem: "chicken", temperatureF: 140, status: "red", timestamp: 0, cookText: "Chicken, one forty." });
  const unrelated = tracker.checkAndRecord({
    id: "b",
    foodItem: "steak",
    temperatureF: 145,
    status: "safe",
    timestamp: 1000,
    cookText: "Wait, also steak, one forty five.",
  });
  assert.equal(unrelated, null);
});

test("a chain of corrections links each new reading to the immediately-prior one", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  tracker.checkAndRecord({ id: "a", foodItem: "chicken", temperatureF: 140, status: "red", timestamp: 0, cookText: "Chicken, one forty." });
  const secondCorrection = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken",
    temperatureF: 150,
    status: "red",
    timestamp: 2000,
    cookText: "Wait, chicken is one fifty.",
  });
  assert.equal(secondCorrection.id, "a");

  // A third correction (cook corrects themself AGAIN) links to "b", the
  // most recent one — not back to the original "a".
  const thirdCorrection = tracker.checkAndRecord({
    id: "c",
    foodItem: "chicken",
    temperatureF: 165,
    status: "safe",
    timestamp: 3000,
    cookText: "Sorry, actually chicken is one sixty five.",
  });
  assert.equal(thirdCorrection.id, "b");
});

test("a reading with no finite temperature never counts as, or gets treated as corrected by, anything", () => {
  const tracker = createCorrectionTracker({ windowMs: 45000 });
  const noTemp = tracker.checkAndRecord({
    id: "a",
    foodItem: "chicken",
    temperatureF: NaN,
    status: "unknown",
    timestamp: 0,
    cookText: "Chicken, unclear.",
  });
  assert.equal(noTemp, null);

  // A real follow-up reading shouldn't be marked as "correcting" the
  // unparseable one — there's no prior number to have corrected.
  const follow = tracker.checkAndRecord({
    id: "b",
    foodItem: "chicken",
    temperatureF: 140,
    status: "red",
    timestamp: 1000,
    cookText: "Wait, chicken is one forty.",
  });
  assert.equal(follow, null);
});
