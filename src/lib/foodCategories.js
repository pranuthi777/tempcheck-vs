/**
 * Maps a spoken food item name to an FDA Food Code temperature category.
 * This is intentionally a simple, auditable lookup table (not an LLM guess)
 * because misclassifying a category is itself a safety failure.
 *
 * Categories map 1:1 to the limits in ruleEngine.js.
 */

// Longest keys first isn't required because we do exact + substring matching
// in order; keep entries lowercase, singular/plural variants included.
const ITEM_CATEGORY_MAP = {
  // --- cold_holding locations (used when a reading is a fridge/cooler check,
  // not a specific food item) ---
  "walk-in cooler": "cold_holding",
  "walk in cooler": "cold_holding",
  "reach-in cooler": "cold_holding",
  "reach in cooler": "cold_holding",
  "reach-in fridge": "cold_holding",
  fridge: "cold_holding",
  cooler: "cold_holding",
  "salad bar": "cold_holding",
  "cold well": "cold_holding",
  "prep cooler": "cold_holding",

  // --- freezer (frozen storage) — its own category, not cold_holding: the
  // safe range is 0°F/-18°C or colder, nowhere near the 41°F cold-holding
  // line, so lumping them together would let a badly-warming freezer read
  // as "safe" all the way up to 41°F. ---
  "walk-in freezer": "freezer",
  freezer: "freezer",

  // --- hot_holding locations ---
  "steam table": "hot_holding",
  "hot well": "hot_holding",
  "hot box": "hot_holding",
  "hot holding": "hot_holding",

  // --- poultry (165F / 15s) ---
  chicken: "poultry",
  turkey: "poultry",
  duck: "poultry",
  goose: "poultry",
  quail: "poultry",
  "cornish hen": "poultry",
  "chicken breast": "poultry",
  "chicken thigh": "poultry",
  "chicken wings": "poultry",
  wings: "poultry",
  "ground chicken": "poultry",
  "ground turkey": "poultry",
  "stuffed chicken": "poultry",
  "stuffed turkey": "poultry",

  // --- ground / injected meat (155F / 15s) ---
  "ground beef": "ground_meat",
  hamburger: "ground_meat",
  "ground pork": "ground_meat",
  sausage: "ground_meat",
  meatballs: "ground_meat",
  "ground lamb": "ground_meat",
  "ground venison": "ground_meat",
  chorizo: "ground_meat",
  "italian sausage": "ground_meat",
  "breakfast sausage": "ground_meat",

  // --- whole muscle meat (145F / 3 min rest) ---
  steak: "whole_muscle",
  roast: "whole_muscle",
  "prime rib": "whole_muscle",
  "tri-tip": "whole_muscle",
  "tri tip": "whole_muscle",
  "pork chop": "whole_muscle",
  "pork loin": "whole_muscle",
  "pork tenderloin": "whole_muscle",
  lamb: "whole_muscle",
  "rack of lamb": "whole_muscle",
  "lamb chop": "whole_muscle",
  veal: "whole_muscle",
  ham: "whole_muscle",
  brisket: "whole_muscle",
  venison: "whole_muscle",
  "prime rib roast": "whole_muscle",

  // --- fish / seafood / eggs for immediate service (145F / 15s) ---
  fish: "fish_seafood",
  salmon: "fish_seafood",
  tuna: "fish_seafood",
  cod: "fish_seafood",
  halibut: "fish_seafood",
  tilapia: "fish_seafood",
  trout: "fish_seafood",
  shrimp: "fish_seafood",
  prawns: "fish_seafood",
  scallops: "fish_seafood",
  lobster: "fish_seafood",
  crab: "fish_seafood",
  mussels: "fish_seafood",
  clams: "fish_seafood",
  oysters: "fish_seafood",
  calamari: "fish_seafood",
  squid: "fish_seafood",
  seafood: "fish_seafood",
  eggs: "fish_seafood",
  egg: "fish_seafood",
  "scrambled eggs": "fish_seafood",
  "poached eggs": "fish_seafood",
  omelet: "fish_seafood",
  omelette: "fish_seafood",

  // --- reheating (165F within 2h; hot-held item reheated from cold) ---
  "reheated soup": "reheating",
  "reheated chili": "reheating",
  "reheated gravy": "reheating",
  "reheated sauce": "reheating",
  "reheated stew": "reheating",
  leftovers: "reheating",
};

const CATEGORY_LABELS = {
  cold_holding: "Cold holding",
  freezer: "Freezer (frozen storage)",
  hot_holding: "Hot holding",
  poultry: "Poultry (cooking)",
  ground_meat: "Ground/injected meat (cooking)",
  whole_muscle: "Whole-muscle meat (cooking)",
  fish_seafood: "Fish, seafood & eggs (cooking)",
  reheating: "Reheating for hot holding",
  unknown: "Unrecognized item",
};

/**
 * Look up a category from the food_item/location text alone, via the
 * deterministic ITEM_CATEGORY_MAP — no LLM input involved. Returns null if
 * nothing in the map matches.
 */
function codeResolvedCategory({ location, foodItem }) {
  const normalize = (s) => (s || "").toLowerCase().trim();
  const loc = normalize(location);
  const item = normalize(foodItem);

  for (const [key, category] of Object.entries(ITEM_CATEGORY_MAP)) {
    if (loc && loc.includes(key)) return category;
  }
  for (const [key, category] of Object.entries(ITEM_CATEGORY_MAP)) {
    if (item && item.includes(key)) return category;
  }
  return null;
}

/**
 * Resolve a free-text location/food-item string to a category.
 *
 * "Code wins": the deterministic ITEM_CATEGORY_MAP lookup from
 * food_item/location is authoritative whenever it resolves to something.
 * The agent's own LLM-supplied reading_type is used ONLY as a fallback,
 * when the code lookup can't classify the item at all — it never
 * overrides a code-resolvable category, even if the LLM disagrees. This
 * matters because the LLM's reading_type is a free-form guess from the
 * same model that also (rarely) mishears a number; "chicken breast" must
 * always be evaluated as poultry (165F), never accidentally downgraded to
 * hot_holding (135F) because the model guessed wrong.
 *
 * Falls back to "unknown" rather than guessing — an unrecognized item
 * must be flagged for a human to categorize, never silently assumed safe.
 */
function resolveCategory({ location, foodItem, readingType }) {
  const codeCategory = codeResolvedCategory({ location, foodItem });
  if (codeCategory) return codeCategory;

  // Nothing in the map matched — fall back to the LLM's own guess, if it
  // gave a valid one.
  const normalize = (s) => (s || "").toLowerCase().trim();
  const explicit = normalize(readingType).replace(/\s+/g, "_");
  if (explicit && CATEGORY_LABELS[explicit] && explicit !== "unknown") {
    return explicit;
  }

  return "unknown";
}

/**
 * True when the LLM's reading_type disagrees with the code-resolved
 * category — worth flagging for a human to review, even though the code
 * category (not the LLM's guess) is what actually gets evaluated. No
 * conflict is reported when there's nothing to compare (no reading_type
 * given, or the code lookup couldn't resolve anything on its own).
 */
function categoryConflict({ location, foodItem, readingType }) {
  const codeCategory = codeResolvedCategory({ location, foodItem });
  if (!codeCategory) return false;

  const normalize = (s) => (s || "").toLowerCase().trim();
  const explicit = normalize(readingType).replace(/\s+/g, "_");
  if (!explicit || !CATEGORY_LABELS[explicit] || explicit === "unknown") return false;

  return explicit !== codeCategory;
}

module.exports = { ITEM_CATEGORY_MAP, CATEGORY_LABELS, resolveCategory, categoryConflict };
