/**
 * Extracts a spoken temperature number from an STT transcript string.
 * AssemblyAI's inverse-text-normalization already turns spoken numbers
 * into digits (e.g. "one fifty two" -> "152"), so this only needs to
 * find the right number in the sentence, including negatives and an
 * optional Celsius/Fahrenheit unit hint.
 *
 * Returns { value: number|null, unit: 'F'|'C'|null }
 */
function parseTemperatureFromText(text) {
  if (!text || typeof text !== "string") return { value: null, unit: null };

  const lower = text.toLowerCase();

  // Prefer a number immediately followed by "degree(s)" (optionally with
  // a unit word/letter), since that's the actual reading, not e.g. a
  // count of items mentioned in the same sentence.
  const matches = [...lower.matchAll(/(-?\d+(?:\.\d+)?)\s*degrees?\s*(fahrenheit|celsius|f\b|c\b)?/gi)];

  let numberMatch = matches[0];
  if (!numberMatch) {
    // Fall back to the first standalone number anywhere in the sentence.
    const anyNumber = lower.match(/-?\d+(?:\.\d+)?/);
    if (!anyNumber) return { value: null, unit: null };
    return { value: Number(anyNumber[0]), unit: lower.includes("celsius") ? "C" : "F" };
  }

  const value = Number(numberMatch[1]);
  let unit = null;
  const unitWord = numberMatch[2];
  if (unitWord) {
    unit = unitWord.startsWith("c") ? "C" : "F";
  } else if (lower.includes("celsius")) {
    unit = "C";
  } else {
    unit = "F"; // default assumption, matches agentConfig's default
  }

  return { value, unit };
}

module.exports = { parseTemperatureFromText };
