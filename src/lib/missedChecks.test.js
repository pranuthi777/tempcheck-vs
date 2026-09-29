const test = require("node:test");
const assert = require("node:assert/strict");
const { computeOverdueUnits, DEFAULT_INTERVAL_MS } = require("./missedChecks");

const HOUR = 3600000;

test("no readings means no overdue units", () => {
  assert.deepEqual(computeOverdueUnits({ readings: [], now: 10 * HOUR }), []);
});

test("a unit checked recently is not overdue", () => {
  const readings = [{ location: "walk-in cooler", timestamp: 9 * HOUR, category: "cold_holding" }];
  const overdue = computeOverdueUnits({ readings, now: 9 * HOUR + 30 * 60000, intervalMs: 2 * HOUR });
  assert.deepEqual(overdue, []);
});

test("a unit last checked more than the interval ago is overdue, with its own minutesSince", () => {
  const readings = [{ location: "walk-in cooler", timestamp: 0, category: "cold_holding" }];
  const overdue = computeOverdueUnits({ readings, now: 3 * HOUR, intervalMs: 2 * HOUR });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].unit, "walk-in cooler");
  assert.equal(overdue[0].minutesSince, 180);
});

test("each unit has its OWN timer — a frequently-checked cooler never masks a station nobody checked", () => {
  const readings = [
    // walk-in cooler checked constantly, most recently 5 minutes ago
    { location: "walk-in cooler", timestamp: 0, category: "cold_holding" },
    { location: "walk-in cooler", timestamp: 1 * HOUR, category: "cold_holding" },
    { location: "walk-in cooler", timestamp: 2.5 * HOUR - 5 * 60000, category: "cold_holding" },
    // fryer only checked once, 3 hours ago
    { location: "fryer", timestamp: 0, category: "hot_holding" },
  ];
  const overdue = computeOverdueUnits({ readings, now: 2.5 * HOUR, intervalMs: 2 * HOUR });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].unit, "fryer");
});

test("a superseded reading doesn't count as the unit's last check when a real later one exists", () => {
  const readings = [
    { id: "a", location: "steam table", timestamp: 0, category: "hot_holding", superseded: true },
    { id: "b", location: "steam table", timestamp: 30 * 60000, category: "hot_holding" },
  ];
  const overdue = computeOverdueUnits({ readings, now: 45 * 60000, intervalMs: 2 * HOUR });
  assert.deepEqual(overdue, []);
});

test("cooling-in-progress readings don't establish a unit's routine-check timer", () => {
  // A cooling_start/check tracks one batch, not a routine temperature
  // check of the unit — an old cooling reading must not stand in for a
  // real check and must not falsely appear as "checked" either, since
  // there's no OTHER reading for this unit at all.
  const readings = [{ location: "walk-in cooler", timestamp: 0, category: "cooling" }];
  const overdue = computeOverdueUnits({ readings, now: 5 * HOUR, intervalMs: 2 * HOUR });
  assert.deepEqual(overdue, []);
});

test("multiple overdue units are sorted most-overdue first", () => {
  const readings = [
    { location: "fryer", timestamp: 0, category: "hot_holding" }, // 4h ago
    { location: "prep cooler", timestamp: 2 * HOUR, category: "cold_holding" }, // 2h ago
  ];
  const overdue = computeOverdueUnits({ readings, now: 4 * HOUR, intervalMs: 1 * HOUR });
  assert.equal(overdue.length, 2);
  assert.equal(overdue[0].unit, "fryer");
  assert.equal(overdue[1].unit, "prep cooler");
});

test("interval is configurable, not hardcoded to a global 45 minutes", () => {
  const readings = [{ location: "walk-in cooler", timestamp: 0, category: "cold_holding" }];
  const overdueTight = computeOverdueUnits({ readings, now: 1 * HOUR, intervalMs: 30 * 60000 });
  const overdueLoose = computeOverdueUnits({ readings, now: 1 * HOUR, intervalMs: 3 * HOUR });
  assert.equal(overdueTight.length, 1);
  assert.equal(overdueLoose.length, 0);
});

test("falls back to food_item as the unit when no location was given", () => {
  const readings = [{ foodItem: "chili", timestamp: 0, category: "cooked" }];
  const overdue = computeOverdueUnits({ readings, now: 3 * HOUR, intervalMs: 2 * HOUR });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].unit, "chili");
});

test("a reading with neither location nor food_item is skipped, never crashes", () => {
  const readings = [{ timestamp: 0, category: "cold_holding" }];
  assert.doesNotThrow(() => computeOverdueUnits({ readings, now: 5 * HOUR }));
});

test("default interval is 2 hours", () => {
  assert.equal(DEFAULT_INTERVAL_MS, 2 * HOUR);
});
