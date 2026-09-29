const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCoolingCheck } = require("./coolingEngine");

const HOUR = 3600000;
const MINUTE = 60000;
const SECOND = 1000;

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
  assert.match(r.correctiveAction, /discard/i);
});

test("past 6h but AT or under 41F now: compliance can't be verified (amber, not red/discard) — the late check can't prove it made the 6h deadline", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 38,
    checkTimestamp: 7 * HOUR,
  });
  assert.equal(r.status, "amber");
  assert.equal(r.correctiveAction, null);
  assert.match(r.message, /can't be verified|cannot be verified/i);
  assert.match(r.message, /manager/i);
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

// --- Boundary precision (item c): compare EXACT elapsed ms, never a
// rounded display value, or a check just barely past a deadline gets
// misclassified as still within it.
test("boundary: exactly 2h00m00s is still within the first stage", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 90,
    checkTimestamp: 2 * HOUR,
  });
  assert.equal(r.status, "amber"); // still stage-1 rules: >70F within 2h is a heads-up, not yet red
});

test("boundary: 2h00m59s (barely past 2h) is already stage 2 — a rounded 2.0h must not hide the crossing", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 90,
    checkTimestamp: 2 * HOUR + 59 * SECOND,
  });
  assert.equal(r.status, "red"); // past 2h, still above 70F: the checkpoint was missed for real
});

test("boundary: 2h01m past start is unambiguously stage 2", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 90,
    checkTimestamp: 2 * HOUR + 1 * MINUTE,
  });
  assert.equal(r.status, "red");
});

test("boundary: exactly 6h00m00s is still (inclusively) within the second stage window, same treatment as the exact-2h boundary above", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 50,
    checkTimestamp: 6 * HOUR,
  });
  assert.equal(r.status, "amber"); // exactly at, not past, the 6h mark — same inclusive boundary as exactly-2h above
});

test("boundary: 6h01m past start with temp still above 41F is the 'compliance can't be verified' amber case, not a fresh violation call", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 135,
    startTimestamp: 0,
    checkTemperatureF: 50,
    checkTimestamp: 6 * HOUR + 1 * MINUTE,
  });
  // Above 41F even now (still 50F) — this IS an unambiguous, provable
  // violation (monotonic cooling means it was above 41F at the 6h mark
  // too), so it's still red/discard, same as the "past 6h and above 41F"
  // case above. The "can't be verified" amber only applies when the LATE
  // reading itself is already at/under 41F (see the dedicated test above).
  assert.equal(r.status, "red");
});

// --- Ambient/room-temperature ingredients (item b): a start temperature
// well below 135F means the food never started hot from cooking, so the
// 2h/70F checkpoint of the two-stage curve can't be meaningfully anchored.
// FDA Food Code 3-501.14(B) applies instead: straight to 41F within 4h,
// no intermediate checkpoint.
test("ambient ingredients (start well below 135F): safe within 4h at or under 41F", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 75,
    startTimestamp: 0,
    checkTemperatureF: 40,
    checkTimestamp: 3 * HOUR,
  });
  assert.equal(r.status, "safe");
  assert.equal(r.citation, "FDA Food Code 3-501.14(B)");
});

test("ambient ingredients: within 4h but still above 41F is on track (amber), not yet a violation", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 75,
    startTimestamp: 0,
    checkTemperatureF: 55,
    checkTimestamp: 3 * HOUR,
  });
  assert.equal(r.status, "amber");
  assert.equal(r.citation, "FDA Food Code 3-501.14(B)");
});

test("ambient ingredients: past 4h and still above 41F is a real violation (red)", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 75,
    startTimestamp: 0,
    checkTemperatureF: 55,
    checkTimestamp: 5 * HOUR,
  });
  assert.equal(r.status, "red");
  assert.match(r.correctiveAction, /discard/i);
});

test("ambient ingredients: past 4h but at/under 41F now — compliance can't be verified (amber), same reasoning as the two-stage curve's 6h case", () => {
  const r = evaluateCoolingCheck({
    startTemperatureF: 75,
    startTimestamp: 0,
    checkTemperatureF: 39,
    checkTimestamp: 5 * HOUR,
  });
  assert.equal(r.status, "amber");
  assert.equal(r.correctiveAction, null);
  assert.match(r.message, /can't be verified|cannot be verified/i);
});
