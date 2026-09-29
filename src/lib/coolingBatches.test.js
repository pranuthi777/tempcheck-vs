const test = require("node:test");
const assert = require("node:assert/strict");
const { makeBatchId, findMatches } = require("./coolingBatches");

test("makeBatchId is stable for the same item+location+start time, and distinct otherwise", () => {
  const a = makeBatchId({ foodItem: "chili", location: "walk-in cooler", startTimestamp: 1000 });
  const b = makeBatchId({ foodItem: "chili", location: "walk-in cooler", startTimestamp: 1000 });
  const c = makeBatchId({ foodItem: "chili", location: "walk-in cooler", startTimestamp: 2000 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("findMatches finds a single batch by food_item alone", () => {
  const batches = [
    { batchId: "1", foodItem: "chili", location: null, startTemperatureF: 135, startTimestamp: 0 },
    { batchId: "2", foodItem: "soup", location: null, startTemperatureF: 140, startTimestamp: 0 },
  ];
  const matches = findMatches(batches, { foodItem: "chili" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].batchId, "1");
});

test("findMatches finds a single batch by location alone", () => {
  const batches = [{ batchId: "1", foodItem: null, location: "walk-in cooler", startTemperatureF: 135, startTimestamp: 0 }];
  const matches = findMatches(batches, { location: "walk-in cooler" });
  assert.equal(matches.length, 1);
});

test("findMatches returns nothing for an item/location with no pending batch", () => {
  const batches = [{ batchId: "1", foodItem: "chili", location: null, startTemperatureF: 135, startTimestamp: 0 }];
  assert.equal(findMatches(batches, { foodItem: "soup" }).length, 0);
});

test("findMatches returns MULTIPLE batches when two pending starts share the same item/location — real ambiguity, not silently picking one", () => {
  const batches = [
    { batchId: "1", foodItem: "chili", location: null, startTemperatureF: 135, startTimestamp: 1000 },
    { batchId: "2", foodItem: "chili", location: null, startTemperatureF: 130, startTimestamp: 5000 },
  ];
  const matches = findMatches(batches, { foodItem: "chili" });
  assert.equal(matches.length, 2);
});

test("a second cooling_start for the same item never silently overwrites the first pending batch", () => {
  // Regression test for the old Map-based tracker: two batches, added in
  // sequence, must BOTH still be present and independently discoverable.
  const batches = [];
  batches.push({ batchId: makeBatchId({ foodItem: "chili", startTimestamp: 0 }), foodItem: "chili", location: null, startTemperatureF: 135, startTimestamp: 0 });
  batches.push({ batchId: makeBatchId({ foodItem: "chili", startTimestamp: 1000 }), foodItem: "chili", location: null, startTemperatureF: 130, startTimestamp: 1000 });
  assert.equal(batches.length, 2);
  assert.equal(findMatches(batches, { foodItem: "chili" }).length, 2);
});
