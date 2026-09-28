const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTemperatureFromText } = require("./parseTemperatureFromText");

test("plain number with degrees", () => {
  assert.deepEqual(parseTemperatureFromText("walk in cooler 38 degrees"), { value: 38, unit: "F" });
});

test("three digit number", () => {
  assert.deepEqual(parseTemperatureFromText("chicken breast 152 degrees"), { value: 152, unit: "F" });
});

test("explicit fahrenheit word", () => {
  assert.deepEqual(parseTemperatureFromText("steam table 136 degrees fahrenheit"), {
    value: 136,
    unit: "F",
  });
});

test("explicit celsius word", () => {
  assert.deepEqual(parseTemperatureFromText("walk in cooler 3 degrees celsius"), {
    value: 3,
    unit: "C",
  });
});

test("negative number", () => {
  assert.deepEqual(parseTemperatureFromText("walk in freezer -5 degrees"), { value: -5, unit: "F" });
});

test("no degrees word at all falls back to first number", () => {
  assert.deepEqual(parseTemperatureFromText("chicken 165"), { value: 165, unit: "F" });
});

test("no number present returns null value", () => {
  assert.deepEqual(parseTemperatureFromText("walk in cooler is fine"), { value: null, unit: null });
});

test("empty/undefined input does not throw", () => {
  assert.deepEqual(parseTemperatureFromText(""), { value: null, unit: null });
  assert.deepEqual(parseTemperatureFromText(undefined), { value: null, unit: null });
});
