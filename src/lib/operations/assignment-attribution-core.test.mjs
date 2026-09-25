// Unit tests for the pure assignment attribution (P1-OPS-PROG3B).
//   node --test src/lib/operations/assignment-attribution-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { deriveAssignmentAttribution } = await import("./assignment-attribution-core.ts");

const VIEWER = "viewer-1";
const names = new Map([["admin-1", "Maria Example"]]);
const a = (id, assignedBy, assignedAt, endedAt = null, endReason = null) => ({ id, assignedBy, assignedAt, endedAt, endReason });

test("no assignment -> null", () => {
  assert.equal(deriveAssignmentAttribution([], VIEWER, names), null);
});

test("first assignment by a visible member -> 'Assigned by <name>'", () => {
  assert.deepEqual(deriveAssignmentAttribution([a("1", "admin-1", "2026-09-25T11:42:00Z")], VIEWER, names), {
    verb: "Assigned", who: "Maria Example", at: "2026-09-25T11:42:00Z", reason: null,
  });
});

test("assigned by the viewer -> 'you'", () => {
  assert.equal(deriveAssignmentAttribution([a("1", VIEWER, "2026-09-25T11:42:00Z")], VIEWER, names).who, "you");
});

test("assigner name not visible (e.g. Dispatcher viewing another member) -> 'a team member'", () => {
  assert.equal(deriveAssignmentAttribution([a("1", "someone-else", "2026-09-25T11:42:00Z")], VIEWER, names).who, "a team member");
  assert.equal(deriveAssignmentAttribution([a("1", "blank", "2026-09-25T11:42:00Z")], VIEWER, new Map([["blank", "  "]])).who, "a team member");
});

test("assigned_by null -> who null (renders 'Assigned · <time>')", () => {
  assert.equal(deriveAssignmentAttribution([a("1", null, "2026-09-25T11:42:00Z")], VIEWER, names).who, null);
});

test("reassignment with operator reason", () => {
  const r = deriveAssignmentAttribution(
    [a("old", "x", "2026-09-25T10:00:00Z", "2026-09-25T11:42:00Z", "Driver unavailable"), a("new", "admin-1", "2026-09-25T11:42:00Z")],
    VIEWER,
    names,
  );
  assert.deepEqual(r, { verb: "Reassigned", who: "Maria Example", at: "2026-09-25T11:42:00Z", reason: "Driver unavailable" });
});

test("reassignment with the default 'reassigned' reason -> Reassigned, no Reason line", () => {
  const r = deriveAssignmentAttribution(
    [a("old", "x", "2026-09-25T10:00:00Z", "2026-09-25T11:42:00Z", "reassigned"), a("new", VIEWER, "2026-09-25T11:42:00Z")],
    VIEWER,
    names,
  );
  assert.equal(r.verb, "Reassigned");
  assert.equal(r.reason, null);
  assert.equal(r.who, "you");
});

test("system end reasons never produce a Reason and trip-ending ones are not reassignments", () => {
  for (const reason of ["trip_completed", "trip_cancelled", "no_show"]) {
    const r = deriveAssignmentAttribution([a("only", "admin-1", "2026-09-25T10:00:00Z", "2026-09-25T12:00:00Z", reason)], VIEWER, names);
    assert.equal(r.verb, "Assigned");
    assert.equal(r.reason, null);
  }
});

test("completed trip after a reassignment: attributes the last (completing) assignment as Reassigned", () => {
  const r = deriveAssignmentAttribution(
    [
      a("old", "x", "2026-09-25T10:00:00Z", "2026-09-25T11:00:00Z", "Vehicle issue"),
      a("last", "admin-1", "2026-09-25T11:00:00Z", "2026-09-25T13:00:00Z", "trip_completed"),
    ],
    VIEWER,
    names,
  );
  assert.deepEqual(r, { verb: "Reassigned", who: "Maria Example", at: "2026-09-25T11:00:00Z", reason: "Vehicle issue" });
});
