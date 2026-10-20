// NP-UI-P1a -- pure keyboard / pagination helpers behind the shared UI primitives. Run with:
//
//   node --test src/lib/ui/ui-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const u = await import("./ui-core.ts");

test("nextIndex: horizontal arrows move and wrap, skipping disabled; Home / End; other keys ignored", () => {
  const d = [false, true, false, false];
  assert.equal(u.nextIndex("ArrowRight", 0, d), 2);
  assert.equal(u.nextIndex("ArrowRight", 3, d), 0);
  assert.equal(u.nextIndex("ArrowLeft", 0, d), 3);
  assert.equal(u.nextIndex("ArrowLeft", 2, d), 0);
  assert.equal(u.nextIndex("Home", 3, d), 0);
  assert.equal(u.nextIndex("End", 0, d), 3);
  assert.equal(u.nextIndex("ArrowDown", 0, d), null, "vertical key on a horizontal composite");
  assert.equal(u.nextIndex("a", 0, d), null);
});

test("nextIndex: vertical orientation uses Up / Down; all-disabled and empty return null", () => {
  assert.equal(u.nextIndex("ArrowDown", 0, [false, false], "vertical"), 1);
  assert.equal(u.nextIndex("ArrowUp", 0, [false, false], "vertical"), 1);
  assert.equal(u.nextIndex("ArrowRight", 0, [false, false], "vertical"), null);
  assert.equal(u.nextIndex("ArrowRight", 0, [true, true]), null);
  assert.equal(u.nextIndex("ArrowRight", 0, []), null);
});

test("firstEnabled", () => {
  assert.equal(u.firstEnabled([true, false, false]), 1);
  assert.equal(u.firstEnabled([false, true, false], 1), 2);
  assert.equal(u.firstEnabled([false, true, true], 2), 0);
  assert.equal(u.firstEnabled([true, true]), -1);
});

test("paginationRange: first / last always, current with siblings, gaps only where pages are skipped", () => {
  assert.deepEqual(u.paginationRange(1, 0), []);
  assert.deepEqual(u.paginationRange(1, 1), [1]);
  assert.deepEqual(u.paginationRange(1, 5), [1, 2, "gap", 5]);
  assert.deepEqual(u.paginationRange(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(u.paginationRange(6, 12), [1, "gap", 5, 6, 7, "gap", 12]);
  assert.deepEqual(u.paginationRange(12, 12), [1, "gap", 11, 12]);
  assert.deepEqual(u.paginationRange(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(u.paginationRange(99, 3), [1, 2, 3], "page clamped");
});

test("pageItemRange", () => {
  assert.equal(u.pageItemRange(1, 25, 0), null);
  assert.deepEqual(u.pageItemRange(1, 25, 112), { from: 1, to: 25 });
  assert.deepEqual(u.pageItemRange(2, 25, 112), { from: 26, to: 50 });
  assert.deepEqual(u.pageItemRange(5, 25, 112), { from: 101, to: 112 });
  assert.deepEqual(u.pageItemRange(9, 25, 112), { from: 101, to: 112 }, "clamped to the last page");
});

test("typeaheadIndex: next enabled match after current, wrapping; non-single chars ignored", () => {
  const labels = ["Edit", "Export", "Delete", "Duplicate"];
  assert.equal(u.typeaheadIndex("e", 0, labels, [false, false, false, false]), 1);
  assert.equal(u.typeaheadIndex("e", 1, labels, [false, false, false, false]), 0);
  assert.equal(u.typeaheadIndex("d", 0, labels, [false, false, true, false]), 3);
  assert.equal(u.typeaheadIndex("x", 0, labels, [false, false, false, false]), null);
  assert.equal(u.typeaheadIndex("Enter", 0, labels, [false, false, false, false]), null);
});
