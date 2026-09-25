// Unit tests for the Dispatch grid extent geometry (P1-OPS-PROG4B).
import test from "node:test";
import assert from "node:assert/strict";

const { extentBlockGeometry, EXTENT_HOUR_WIDTH_PX, EXTENT_MIN_BLOCK_WIDTH_PX, UNKNOWN_EXTENT_CHIP_WIDTH_PX } = await import("./dispatch-grid.ts");

const DAY = Date.parse("2026-10-10T04:00:00.000Z"); // local midnight, New York
const axis = { start: 6, end: 20 };
const at = (h) => DAY + h * 3_600_000;

test("known extent: position from start, width proportional to duration", () => {
  const g = extentBlockGeometry({ startMs: at(9), durationMinutes: 90 }, DAY, axis);
  assert.equal(g.known, true);
  assert.equal(g.left, 3 * EXTENT_HOUR_WIDTH_PX);
  assert.equal(g.width, 1.5 * EXTENT_HOUR_WIDTH_PX);
});

test("short known extent gets the minimum click target, never zero", () => {
  assert.equal(extentBlockGeometry({ startMs: at(9), durationMinutes: 5 }, DAY, axis).width, EXTENT_MIN_BLOCK_WIDTH_PX);
});

test("unknown duration: fixed chip, no proportional implication", () => {
  const a = extentBlockGeometry({ startMs: at(9), durationMinutes: null }, DAY, axis);
  const b = extentBlockGeometry({ startMs: at(9), durationMinutes: null }, DAY, { start: 0, end: 24 });
  assert.equal(a.known, false);
  assert.equal(a.width, UNKNOWN_EXTENT_CHIP_WIDTH_PX);
  assert.equal(b.width, UNKNOWN_EXTENT_CHIP_WIDTH_PX);
});

test("clipping: continues after the axis / started before the axis", () => {
  const next = extentBlockGeometry({ startMs: at(19), durationMinutes: 180 }, DAY, axis);
  assert.equal(next.continuesAfter, true);
  assert.ok(next.left + next.width <= (axis.end - axis.start) * EXTENT_HOUR_WIDTH_PX);
  const before = extentBlockGeometry({ startMs: at(-2), durationMinutes: 600 }, DAY, axis);
  assert.equal(before.clippedStart, true);
  assert.equal(before.left, 0);
});
