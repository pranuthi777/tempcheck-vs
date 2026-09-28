const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCoolingCheck } = require("./coolingEngine");

const HOUR = 3600000;

test("within 2h, at or under 70F is on track (safe)", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 65,
    checkTimestamp: 1 * HOUR,
  });
  assert.equal(r.status, "safe");
  assert.equal(r.citation, "FDA Food Code 3-501.14(A)");
  assert.equal(r.elapsedHours, 1);
});

test("within 2h, still above 70F is a heads-up (amber), not yet a violation", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 90,
    checkTimestamp: 1 * HOUR,
  });
  assert.equal(r.status, "amber");
});

test("between 2h and 6h, at or under 41F is compliant (safe)", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 35,
    checkTimestamp: 3 * HOUR,
  });
  assert.equal(r.status, "safe");
});

test("between 2h and 6h, under 70F but not yet 41F is on track (amber)", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 55,
    checkTimestamp: 3 * HOUR,
  });
  assert.equal(r.status, "amber");
});

test("past 2h and still above 70F is a real violation (red) — the first checkpoint was missed", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 80,
    checkTimestamp: 3 * HOUR,
  });
  assert.equal(r.status, "red");
});

test("past 6h and still above 41F is a violation (red) — the final checkpoint was missed", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 50,
    checkTimestamp: 7 * HOUR,
  });
  assert.equal(r.status, "red");
  assert.equal(r.elapsedHours, 7);
});

test("negative/garbage elapsed time (clock skew) never produces a negative hour count", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 1000,
    checkTemperatureF: 65,
    checkTimestamp: 500,
  });
  assert.equal(r.elapsedHours, 0);
});
