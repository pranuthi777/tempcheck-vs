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

  let lower = text.toLowerCase();

  // AssemblyAI's inverse-text-normalization sometimes leaves "negative"
  // spelled out instead of emitting a "-" sign (e.g. "negative 5 degrees").
  // Normalize it to a literal minus so one numeric pattern handles both.
  lower = lower.replace(/\bnegative\s+(?=\d)/g, "-");

  // A "°" symbol is equivalent to the word "degrees" for our purposes
  // (e.g. "3°C") — normalize it so the same pattern matches either form.
  lower = lower.replace(/°\s*/g, " degrees ");

  // A leading "-" only counts as a minus sign when it isn't just a hyphen
  // glued onto the previous word by the STT (e.g. "ammon-146" should read
  // as 146, not -146), and not a bare separator between two back-to-back
  // degree readings (a self-correction rendered as "140 degrees -130
  // degrees" — see below, that "-130" means "corrected to 130", not
  // "negative 130"). A letter or digit immediately before it, or the word
  // "degree(s)" right before it, disqualifies it as a minus sign.
  const NOT_A_MINUS_SIGN_HERE = "(?<![a-z0-9])(?<!degrees\\s)(?<!degree\\s)";

  // Prefer a number immediately followed by "degree(s)" (optionally with
  // a unit word/letter), since that's the actual reading, not e.g. a
  // count of items mentioned in the same sentence.
  const strongPattern = new RegExp(
    `${NOT_A_MINUS_SIGN_HERE}(-?\\d+(?:\\.\\d+)?)\\s*degrees?\\s*(fahrenheit|celsius|f\\b|c\\b)?`,
    "gi"
  );
  const matches = [...lower.matchAll(strongPattern)];

  let numberMatch = matches[0];
  if (numberMatch) {
    // Self-correction handling: a cook who corrects themselves ("one forty
    // no, one thirty degrees") means the LAST number, not the first. When
    // AssemblyAI gives each number its own "degrees" (often because it
    // renders each as "140°" / "130°", normalized to "degrees" above),
    // that produces multiple strongPattern matches back to back with only
    // a short connector between them — a hyphen, comma, or a word like
    // "no"/"sorry"/"wait"/"or". Walk forward through any such chain and
    // keep the last link. A real second reading (a different location or
    // food item named in between, as in the run-on multi-reading test)
    // breaks the chain, so that case still correctly keeps its first
    // reading — see parseTemperatureFromText.test.js for both cases.
    const isCorrectionConnector = (between) =>
      /^[\s,-]*$/.test(between) || /^[\s,-]*\b(no|sorry|wait|or)\b[\s,-]*$/i.test(between);
    for (let i = 1; i < matches.length; i++) {
      const prevEnd = numberMatch.index + numberMatch[0].length;
      const between = lower.slice(prevEnd, matches[i].index);
      if (isCorrectionConnector(between)) {
        numberMatch = matches[i];
      } else {
        break;
      }
    }
  }
  if (!numberMatch) {
    // Fallback: no "degrees" word anywhere. A number spoken right after a
    // unit/station label ("cooler 2", "station 3", "#3", "number 5") is
    // that label, NOT the reading — taking it at face value silently
    // misreads a real temperature (e.g. "cooler 2 reads 50" must not parse
    // as 2°F). So: find every standalone number, drop any that's
    // immediately preceded by a label word, and among what's left prefer
    // the LAST one (same self-correction instinct as the "degrees" path
    // above — "165, now it's 170" means 170). If nothing is left, return
    // null so the voice agent asks the cook to repeat the reading instead
    // of guessing.
    const LABEL_BEFORE_NUMBER = /(?:\b(?:cooler|well|station|number)\b\s*#?\s*|#\s*)$/i;
    const anyNumberPattern = new RegExp(`${NOT_A_MINUS_SIGN_HERE}-?\\d+(?:\\.\\d+)?`, "g");
    const allNumbers = [...lower.matchAll(anyNumberPattern)];
    const candidates = allNumbers.filter((m) => !LABEL_BEFORE_NUMBER.test(lower.slice(0, m.index)));
    const chosen = candidates[candidates.length - 1];
    if (!chosen) return { value: null, unit: null };
    return { value: Number(chosen[0]), unit: lower.includes("celsius") ? "C" : "F" };
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
