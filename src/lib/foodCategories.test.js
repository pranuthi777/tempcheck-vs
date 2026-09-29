const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCategory, categoryConflict } = require("./foodCategories");

test("newly added item types resolve to the right category", () => {
  assert.equal(resolveCategory({ foodItem: "tri-tip" }), "whole_muscle");
  assert.equal(resolveCategory({ foodItem: "lobster" }), "fish_seafood");
  assert.equal(resolveCategory({ foodItem: "chicken wings" }), "poultry");
  assert.equal(resolveCategory({ foodItem: "chorizo" }), "ground_meat");
  assert.equal(resolveCategory({ foodItem: "oysters" }), "fish_seafood");
});

test("an unrecognized item still falls back to unknown, never a guess", () => {
  assert.equal(resolveCategory({ foodItem: "quinoa salad" }), "unknown");
});

test("code wins: a code-resolvable food_item/location overrides the LLM's own reading_type guess", () => {
  // "chicken breast" is a hard-coded poultry item. If the agent's LLM
  // mislabels it hot_holding (a real, observed live-agent mistake), the
  // deterministic code mapping must win, not the LLM's guess — a 140F
  // chicken breast is a serious poultry violation (needs 165F), not a
  // borderline-safe hot-holding reading (only needs 135F).
  assert.equal(resolveCategory({ foodItem: "chicken breast", readingType: "hot_holding" }), "poultry");
  // Ordinary case: no conflict, LLM's reading_type is trusted when nothing
  // in the food item/location contradicts it.
  assert.equal(resolveCategory({ foodItem: "soup", readingType: "reheating" }), "reheating");
});

test("category conflict is flagged when the LLM's reading_type disagrees with the code-resolved category", () => {
  const conflict = categoryConflict({ foodItem: "chicken breast", readingType: "hot_holding" });
  assert.equal(conflict, true);

  const noConflict1 = categoryConflict({ foodItem: "chicken breast", readingType: "poultry" });
  assert.equal(noConflict1, false);

  // No LLM reading_type given at all — nothing to conflict with.
  const noConflict2 = categoryConflict({ foodItem: "chicken breast" });
  assert.equal(noConflict2, false);

  // Code can't resolve anything (unknown item) — no conflict to flag,
  // the LLM's guess is all we have.
  const noConflict3 = categoryConflict({ foodItem: "quinoa salad", readingType: "cold_holding" });
  assert.equal(noConflict3, false);
});

test("freezer/walk-in freezer resolve to their own 'freezer' category, not cold_holding", () => {
  assert.equal(resolveCategory({ location: "freezer" }), "freezer");
  assert.equal(resolveCategory({ location: "walk-in freezer" }), "freezer");
  // Everyday cold-holding units are unaffected.
  assert.equal(resolveCategory({ location: "walk-in cooler" }), "cold_holding");
  assert.equal(resolveCategory({ location: "reach-in fridge" }), "cold_holding");
});
