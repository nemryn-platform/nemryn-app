// NP-P2-S7-D (defect D-1) -- the assignment the Trip Detail summary shows. Run with:
//
//   node --test src/lib/operations/trip-assignment-display-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { displayAssignmentOf } = await import("./trip-assignment-display-core.ts");

const ORG = "org-a";
const OTHER = "org-b";
const a = (id, assignedAt, endedAt, organizationId = ORG) => ({ id, organizationId, assignedAt, endedAt });

test("active trip: the active assignment, as before", () => {
  const rows = [a("old", "2026-10-26T08:00:00Z", "2026-10-26T08:10:00Z"), a("now", "2026-10-26T08:10:00Z", null)];
  for (const state of ["scheduled", "en_route_to_pickup", "passenger_onboard", "arrived_at_destination"]) {
    assert.equal(displayAssignmentOf(rows, state, ORG)?.id, "now");
  }
});

test("completed trip without an active assignment: the most recently ended assignment (who drove)", () => {
  const rows = [a("only", "2026-10-26T08:00:00Z", "2026-10-26T09:30:00Z")];
  assert.equal(displayAssignmentOf(rows, "completed", ORG)?.id, "only");
});

test("reassigned then completed: the final driver, not the one reassigned away from (order-independent)", () => {
  const first = a("first", "2026-10-26T07:00:00Z", "2026-10-26T07:30:00Z");
  const final = a("final", "2026-10-26T07:30:00Z", "2026-10-26T09:00:00Z");
  assert.equal(displayAssignmentOf([first, final], "completed", ORG)?.id, "final");
  assert.equal(displayAssignmentOf([final, first], "completed", ORG)?.id, "final");
  // same end instant: the later assignment wins
  const tieA = a("tie-early", "2026-10-26T07:00:00Z", "2026-10-26T09:00:00Z");
  const tieB = a("tie-late", "2026-10-26T08:00:00Z", "2026-10-26T09:00:00Z");
  assert.equal(displayAssignmentOf([tieB, tieA], "completed", ORG)?.id, "tie-late");
});

test("completed trip with an active assignment still shows the active one (existing behaviour wins)", () => {
  const rows = [a("ended", "2026-10-26T07:00:00Z", "2026-10-26T08:00:00Z"), a("active", "2026-10-26T08:00:00Z", null)];
  assert.equal(displayAssignmentOf(rows, "completed", ORG)?.id, "active");
});

test("missing / unusable assignment history: none (placeholders stay)", () => {
  assert.equal(displayAssignmentOf([], "completed", ORG), null);
  assert.equal(displayAssignmentOf(null, "completed", ORG), null);
  assert.equal(displayAssignmentOf(undefined, "completed", ORG), null);
  assert.equal(displayAssignmentOf([a("bad", "2026-10-26T07:00:00Z", "not-a-date")], "completed", ORG), null);
});

test("ended assignments are not shown for non-completed trips (cancelled, no-show, scheduled after an unassign)", () => {
  const rows = [a("ended", "2026-10-26T07:00:00Z", "2026-10-26T08:00:00Z")];
  for (const state of ["cancelled", "no_show", "scheduled"]) assert.equal(displayAssignmentOf(rows, state, ORG), null);
});

test("cross-tenant: another organization's rows are never shown, active or ended", () => {
  const foreignActive = a("foreign-active", "2026-10-26T08:00:00Z", null, OTHER);
  const foreignEnded = a("foreign-ended", "2026-10-26T08:00:00Z", "2026-10-26T10:00:00Z", OTHER);
  const own = a("own", "2026-10-26T07:00:00Z", "2026-10-26T09:00:00Z");
  assert.equal(displayAssignmentOf([foreignActive, own], "completed", ORG)?.id, "own");
  assert.equal(displayAssignmentOf([foreignEnded, own], "completed", ORG)?.id, "own");
  assert.equal(displayAssignmentOf([foreignActive], "scheduled", ORG), null);
  assert.equal(displayAssignmentOf([foreignEnded], "completed", ORG), null);
});
