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

// Real bugs found by running the 270-clip noisy-kitchen accuracy harness
// against the live AssemblyAI transcription API (not hypothetical cases):

test("spelled-out 'negative' before a number is treated as a minus sign", () => {
  assert.deepEqual(parseTemperatureFromText("walk in freezer negative 5 degrees"), {
    value: -5,
    unit: "F",
  });
  assert.deepEqual(parseTemperatureFromText("walk in 3 or negative 5 degrees"), {
    value: -5,
    unit: "F",
  });
});

test("a hyphen glued onto the previous word is not read as a minus sign", () => {
  // Real transcript: AssemblyAI rendered "salmon, 146 degrees" as
  // "Ammon-146 degrees." — the hyphen belongs to the mis-transcribed word,
  // not the number.
  assert.deepEqual(parseTemperatureFromText("Ammon-146 degrees."), { value: 146, unit: "F" });
});

test("degree symbol is recognized as equivalent to the word 'degrees'", () => {
  assert.deepEqual(parseTemperatureFromText("walk-in cooler 3°C."), { value: 3, unit: "C" });
  assert.deepEqual(parseTemperatureFromText("Chicken, 74°C."), { value: 74, unit: "C" });
  assert.deepEqual(parseTemperatureFromText("38°F"), { value: 38, unit: "F" });
});

// Real bugs found by running the 648-clip expanded accuracy harness against
// the live AssemblyAI transcription API:

test("a filler-less self-correction rendered as two '°' numbers takes the last one, not negative", () => {
  // Real transcript for "steam table one forty no one thirty degrees":
  // AssemblyAI rendered it as "Steam table 140°-130°." — normalizing "°" to
  // "degrees" turns this into two back-to-back degree matches joined only
  // by a hyphen. The old code took the first (140) and, worse, read the
  // hyphen in front of "130" as a minus sign (-130) since nothing but the
  // NOT_AFTER_LETTER check guarded against it.
  assert.deepEqual(parseTemperatureFromText("Steam table 140°-130°."), { value: 130, unit: "F" });
});

test("a filler-less self-correction joined by 'or' still takes the last number", () => {
  // Real transcript: "Steam table 140° or 130°."
  assert.deepEqual(parseTemperatureFromText("Steam table 140° or 130°."), { value: 130, unit: "F" });
});

test("a hyphen directly between two numbers-with-degrees is a separator, not a minus sign", () => {
  assert.deepEqual(parseTemperatureFromText("140 degrees-130 degrees"), { value: 130, unit: "F" });
});

test("a real second reading (different item named in between) still keeps the first reading", () => {
  // The run-on multi-reading test phrase: only the first reading is
  // scored, so an unrelated word (a food item name) between two
  // degree-matches must NOT be treated as a correction chain.
  assert.deepEqual(
    parseTemperatureFromText("walk in cooler 41 degrees chicken 165 degrees ground beef 155 degrees"),
    { value: 41, unit: "F" }
  );
});
