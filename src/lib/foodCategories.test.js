const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCategory } = require("./foodCategories");

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

test("freezer/walk-in freezer resolve to their own 'freezer' category, not cold_holding", () => {
  assert.equal(resolveCategory({ location: "freezer" }), "freezer");
  assert.equal(resolveCategory({ location: "walk-in freezer" }), "freezer");
  // Everyday cold-holding units are unaffected.
  assert.equal(resolveCategory({ location: "walk-in cooler" }), "cold_holding");
  assert.equal(resolveCategory({ location: "reach-in fridge" }), "cold_holding");
});
