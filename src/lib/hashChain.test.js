const test = require("node:test");
const assert = require("node:assert/strict");
const { computeEntryHash, buildHashChain, verifyHashChain, GENESIS_HASH } = require("./hashChain");

function reading(overrides) {
  return {
    id: "a",
    timestamp: 1000,
    serverTimestamp: "2026-09-29T00:00:00.000Z",
    location: "walk-in cooler",
    foodItem: null,
    temperatureF: 38,
    category: "cold_holding",
    status: "amber",
    cookText: "Walk-in cooler, 38 degrees.",
    correctsReadingId: null,
    ...overrides,
  };
}

test("the same entry content always produces the same hash (deterministic)", async () => {
  const h1 = await computeEntryHash(reading({ id: "a" }), GENESIS_HASH);
  const h2 = await computeEntryHash(reading({ id: "a" }), GENESIS_HASH);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("changing any field of the entry changes its hash", async () => {
  const base = await computeEntryHash(reading({ temperatureF: 38 }), GENESIS_HASH);
  const tampered = await computeEntryHash(reading({ temperatureF: 48 }), GENESIS_HASH);
  assert.notEqual(base, tampered);
});

test("a different prevHash changes the resulting hash, even for identical content", async () => {
  const h1 = await computeEntryHash(reading(), GENESIS_HASH);
  const h2 = await computeEntryHash(reading(), "f".repeat(64));
  assert.notEqual(h1, h2);
});

test("buildHashChain links entries in order, each depending on the previous hash", async () => {
  const entries = [
    reading({ id: "a", temperatureF: 38 }),
    reading({ id: "b", temperatureF: 48, location: null, foodItem: "chicken breast", category: "poultry", status: "red" }),
  ];
  const chained = await buildHashChain(entries);
  assert.equal(chained[0].prevHash, GENESIS_HASH);
  assert.equal(chained[1].prevHash, chained[0].hash);
  assert.notEqual(chained[0].hash, chained[1].hash);
});

test("verifyHashChain confirms an untouched chain is intact", async () => {
  const entries = [
    reading({ id: "a", temperatureF: 38 }),
    reading({ id: "b", temperatureF: 152, foodItem: "chicken breast", category: "poultry", status: "red" }),
    reading({ id: "c", temperatureF: 140, location: "steam table", category: "hot_holding", status: "amber" }),
  ];
  const chained = await buildHashChain(entries);
  const result = await verifyHashChain(chained);
  assert.equal(result.verified, true);
  assert.equal(result.brokenAt, null);
});

test("verifyHashChain catches a value edited after the fact (e.g. temperature changed in storage)", async () => {
  const entries = [reading({ id: "a", temperatureF: 38 }), reading({ id: "b", temperatureF: 152 })];
  const chained = await buildHashChain(entries);
  const tampered = chained.map((e) => (e.id === "b" ? { ...e, temperatureF: 100 } : e));
  const result = await verifyHashChain(tampered);
  assert.equal(result.verified, false);
  assert.equal(result.brokenAt, "b");
});

test("verifyHashChain catches entries being reordered", async () => {
  const entries = [reading({ id: "a", temperatureF: 38 }), reading({ id: "b", temperatureF: 48 })];
  const chained = await buildHashChain(entries);
  const reordered = [chained[1], chained[0]];
  const result = await verifyHashChain(reordered);
  assert.equal(result.verified, false);
});

test("verifyHashChain catches an entry being deleted from the middle of the chain", async () => {
  const entries = [
    reading({ id: "a", temperatureF: 38 }),
    reading({ id: "b", temperatureF: 152, foodItem: "chicken breast" }),
    reading({ id: "c", temperatureF: 140, location: "steam table" }),
  ];
  const chained = await buildHashChain(entries);
  const withMiddleDeleted = [chained[0], chained[2]];
  const result = await verifyHashChain(withMiddleDeleted);
  assert.equal(result.verified, false);
  assert.equal(result.brokenAt, "c");
});

test("an empty log verifies trivially (nothing to break)", async () => {
  const result = await verifyHashChain([]);
  assert.equal(result.verified, true);
});
