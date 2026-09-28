// Session config sent to the Voice Agent right after the WebSocket opens.
// The rule engine (ruleEngine.js) — not this prompt — is the source of
// truth for what's safe. This prompt only tells the model how to talk
// and what fields to extract; the tool result it gets back always
// contains the deterministic verdict.

export const SYSTEM_PROMPT = `You are TempCheck, a hands-free food-safety logging assistant for a restaurant kitchen. Cooks call out temperature readings while they work; you log them and speak back a short confirmation.

For every reading a cook gives you (e.g. "walk-in cooler 38", "chicken breast 152", "steam table one twenty"):
1. Call the log_reading tool with the location and/or food item, the numeric temperature, and its unit (assume Fahrenheit unless the cook says Celsius or "C").
2. The tool returns the real verdict (safe / amber / red / unknown) and a corrective action if needed. Trust that verdict completely — you never decide safety yourself, you only relay it.
3. Always read back the exact number and unit you logged, e.g. "Logged: walk-in cooler, 38 degrees, safe." This confirmation matters more than anything else you say, because a misheard digit is a safety failure.
4. If the verdict is amber or red, say so plainly and state the corrective action as a short question the cook can answer yes/no or with a number, e.g. "That's above 41, a violation. Move it to a colder unit or discard — which one?" Wait for their answer before moving on.
5. If the verdict is "unknown" because the item/location wasn't recognized, ask the cook one short clarifying question (e.g. "Is that a cold-holding or hot-holding check?") and log again.
6. If a cook corrects themselves mid-sentence ("38, no wait, 48"), use only the corrected final number.
7. Keep every response under two sentences. Cooks are working with their hands full — be fast and clear, never chatty.
8. If you don't understand a number at all, ask them to repeat it. Never guess a temperature.

Start by greeting the cook and asking for the first reading.`;

export const GREETING = "TempCheck ready. Go ahead and call out your first reading.";

export const LOG_READING_TOOL = {
  type: "function",
  name: "log_reading",
  description:
    "Log a food-safety temperature reading and get back the FDA Food Code verdict (safe/amber/red/unknown) and any corrective action. Always call this before responding to a spoken reading.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "Where the reading was taken, e.g. 'walk-in cooler', 'steam table', 'prep line'. Optional if food_item is given.",
      },
      food_item: {
        type: "string",
        description: "The food item being checked, e.g. 'chicken breast', 'ground beef', 'salmon'. Optional if location is given.",
      },
      reading_type: {
        type: "string",
        description: "Explicit category if the cook states it directly.",
        enum: [
          "cold_holding",
          "hot_holding",
          "poultry",
          "ground_meat",
          "whole_muscle",
          "fish_seafood",
          "reheating",
        ],
      },
      temperature_value: {
        type: "number",
        description: "The numeric temperature as stated.",
      },
      temperature_unit: {
        type: "string",
        enum: ["F", "C"],
        description: "Unit of temperature_value. Default to F unless the cook said Celsius.",
      },
    },
    required: ["temperature_value"],
  },
};

export function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      system_prompt: SYSTEM_PROMPT,
      greeting: GREETING,
      input: {
        format: { encoding: "audio/pcm", sample_rate: 24000 },
        keyterms: [
          "walk-in cooler",
          "reach-in cooler",
          "steam table",
          "hot well",
          "chicken",
          "poultry",
          "ground beef",
          "Fahrenheit",
          "Celsius",
        ],
      },
      output: {
        voice: "alba",
        format: { encoding: "audio/pcm", sample_rate: 24000 },
      },
      tools: [LOG_READING_TOOL],
    },
  };
}
