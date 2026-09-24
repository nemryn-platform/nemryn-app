// Unit tests for the pure Readiness-to-Action core (P1-OPS-PROG2).
//   node --test src/lib/operations/readiness-actions-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { deriveTomorrowAssignAction, deriveTomorrowSummaryLine, createTripNoticeParam } = await import("./readiness-actions-core.ts");

test("Tomorrow action: unassigned NEEDS_DRIVER(+NEEDS_VEHICLE) -> Assign", () => {
  assert.deepEqual(deriveTomorrowAssignAction({ state: "scheduled", hasActiveAssignment: false, reasons: ["NEEDS_DRIVER", "NEEDS_VEHICLE"] }), { mode: "assign", label: "Assign" });
});

test("Tomorrow action: assigned without vehicle -> Add vehicle (reassign keeps driver)", () => {
  assert.deepEqual(deriveTomorrowAssignAction({ state: "scheduled", hasActiveAssignment: true, reasons: ["NEEDS_VEHICLE"] }), { mode: "reassign", label: "Add vehicle" });
});

test("Tomorrow action: non-assignment reasons only -> none", () => {
  for (const reasons of [["OPEN_EXCEPTION"], ["PASSENGER_INACTIVE"], ["DRIVER_INACTIVE"], []]) {
    assert.equal(deriveTomorrowAssignAction({ state: "scheduled", hasActiveAssignment: true, reasons }), null);
  }
});

test("Tomorrow action: non-assignable state -> none even with NEEDS_DRIVER", () => {
  for (const state of ["passenger_onboard", "completed", "cancelled", "no_show"]) {
    assert.equal(deriveTomorrowAssignAction({ state, hasActiveAssignment: false, reasons: ["NEEDS_DRIVER"] }), null);
  }
});

test("Tomorrow action: mixed reasons still offer Assign (exception stays for the operator)", () => {
  assert.equal(deriveTomorrowAssignAction({ state: "scheduled", hasActiveAssignment: false, reasons: ["NEEDS_DRIVER", "NEEDS_VEHICLE", "OPEN_EXCEPTION"] })?.label, "Assign");
});

test("Overview Tomorrow line", () => {
  assert.equal(deriveTomorrowSummaryLine(null), "Tomorrow unavailable");
  assert.equal(deriveTomorrowSummaryLine({ totalScheduledTrips: 0, needsPreparationCount: 0 }), "Nothing scheduled for tomorrow");
  assert.equal(deriveTomorrowSummaryLine({ totalScheduledTrips: 4, needsPreparationCount: 0 }), "4 trips · All ready");
  assert.equal(deriveTomorrowSummaryLine({ totalScheduledTrips: 4, needsPreparationCount: 2 }), "4 trips · 2 need preparation");
  assert.equal(deriveTomorrowSummaryLine({ totalScheduledTrips: 1, needsPreparationCount: 1 }), "1 trip · 1 needs preparation");
  assert.doesNotMatch(deriveTomorrowSummaryLine({ totalScheduledTrips: 3, needsPreparationCount: 1 }), /%/);
});

test("New Trip outcome notice param", () => {
  assert.equal(createTripNoticeParam("not_requested"), null);
  assert.equal(createTripNoticeParam("assigned"), "assigned");
  assert.equal(createTripNoticeParam("failed"), "assignment_failed");
});
