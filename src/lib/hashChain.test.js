const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeEntryHash,
  buildHashChain,
  verifyHashChain,
  verifyLog,
  deriveReadingState,
  GENESIS_HASH,
} = require("./hashChain");

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
    seq: 0,
    ...overrides,
  };
}

// Builds a reading + its matching, hash-chained events (correction and/or
// resolution) the way page.js actually appends them, for the verifyLog
// tests below.
async function buildLogWithEvents({ readingOverrides, correction, resolution } = {}) {
  let prevHash = GENESIS_HASH;
  let seq = 0;

  const r = reading({ ...readingOverrides, seq: seq++ });
  r.hash = await computeEntryHash(r, prevHash);
  r.prevHash = prevHash;
  prevHash = r.hash;

  const events = [];
  if (correction) {
    const ev = { kind: "correction", id: "corr-1", targetId: r.id, seq: seq++, ...correction };
    ev.prevHash = prevHash;
    ev.hash = await computeEntryHash(ev, prevHash);
    prevHash = ev.hash;
    events.push(ev);
  }
  if (resolution) {
    const ev = { kind: "resolution", id: "res-1", targetId: r.id, seq: seq++, ...resolution };
    ev.prevHash = prevHash;
    ev.hash = await computeEntryHash(ev, prevHash);
    prevHash = ev.hash;
    events.push(ev);
  }
  return { readings: [r], events };
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

// Round-3 critique #P0-3: superseding/resolving must be real, hashed,
// appended events — not an unhashed flag mutated onto the original entry.
test("verifyLog passes when a reading's superseded flag matches a real, hash-chained correction event", async () => {
  const { readings, events } = await buildLogWithEvents({
    readingOverrides: { status: "red", temperatureF: 152 },
    correction: { correctedTemperatureF: 165, correctedStatus: "safe", timestamp: 2000 },
  });
  const withFlag = readings.map((r) => ({ ...r, superseded: true, supersededAt: 2000 }));
  const result = await verifyLog({ readings: withFlag, events });
  assert.equal(result.verified, true);
});

test("verifyLog FAILS when superseded:true is hand-set on a reading with no matching correction event", async () => {
  const { readings, events } = await buildLogWithEvents({
    readingOverrides: { status: "red", temperatureF: 152 },
    // no correction event at all
  });
  const tampered = readings.map((r) => ({ ...r, superseded: true, supersededAt: 9999 }));
  const result = await verifyLog({ readings: tampered, events });
  assert.equal(result.verified, false);
  assert.equal(result.brokenAt, "a");
});

test("verifyLog FAILS when resolvedAt is hand-set on a reading with no matching resolution event", async () => {
  const { readings, events } = await buildLogWithEvents({
    readingOverrides: { status: "red", temperatureF: 152 },
  });
  const tampered = readings.map((r) => ({ ...r, resolvedAt: 9999 }));
  const result = await verifyLog({ readings: tampered, events });
  assert.equal(result.verified, false);
  assert.equal(result.brokenAt, "a");
});

test("verifyLog passes when a reading's resolvedAt matches a real, hash-chained resolution event", async () => {
  const { readings, events } = await buildLogWithEvents({
    readingOverrides: { status: "red", temperatureF: 152 },
    resolution: { resolved: true, timestamp: 3000 },
  });
  const withFlag = readings.map((r) => ({ ...r, resolvedAt: 3000 }));
  const result = await verifyLog({ readings: withFlag, events });
  assert.equal(result.verified, true);
});

test("verifyLog FAILS when a real correction event is deleted but the superseded flag is left behind", async () => {
  const { readings, events } = await buildLogWithEvents({
    readingOverrides: { status: "red", temperatureF: 152 },
    correction: { correctedTemperatureF: 165, correctedStatus: "safe", timestamp: 2000 },
  });
  const stillFlagged = readings.map((r) => ({ ...r, superseded: true, supersededAt: 2000 }));
  const eventsDeleted = []; // the correction event itself was removed
  const result = await verifyLog({ readings: stillFlagged, events: eventsDeleted });
  assert.equal(result.verified, false);
  assert.equal(result.brokenAt, "a");
});

test("verifyLog still catches ordinary structural tampering (a reading's temperature edited after the fact)", async () => {
  const { readings, events } = await buildLogWithEvents({ readingOverrides: { temperatureF: 38 } });
  const tampered = readings.map((r) => ({ ...r, temperatureF: 100 }));
  const result = await verifyLog({ readings: tampered, events });
  assert.equal(result.verified, false);
});

test("deriveReadingState replays events in seq order, so a later resolution toggle wins", async () => {
  const state = deriveReadingState([
    { kind: "resolution", targetId: "a", resolved: true, timestamp: 100, seq: 2 },
    { kind: "resolution", targetId: "a", resolved: false, timestamp: 50, seq: 1 },
  ]);
  // seq 1 (resolved:false) happened first, seq 2 (resolved:true) second —
  // the final state should reflect seq 2 regardless of array order.
  assert.equal(state.get("a").resolvedAt, 100);
});
