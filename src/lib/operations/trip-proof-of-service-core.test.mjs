// Focused unit tests for the pure Proof-of-Service Assurance derivation
// helper (P1-E3-S1B). Run with:
//
//   node --test src/lib/operations/trip-proof-of-service-core.test.mjs
//
// Deliberately tests the pure core module only
// (trip-proof-of-service-core.ts), which has no runtime import of any
// kind, matching trip-readiness-core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { deriveTripProofOfService } = await import("./trip-proof-of-service-core.ts");

function makeFacts(overrides = {}) {
  return {
    tripState: "completed",
    hasPassenger: true,
    hasPickupDescription: true,
    hasDestinationDescription: true,
    completedAt: "2026-11-01T15:32:00.000Z",
    hasCompleteLifecycleEventChain: true,
    hasCompletionAssignment: true,
    completionAssignmentVehicleId: "vehicle-1",
    openExceptionCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A/B/C/D. APPLICABILITY — scheduled, every in-progress state,
// cancelled, no_show -> NOT_APPLICABLE
// ---------------------------------------------------------------------

test("deriveTripProofOfService — scheduled -> NOT_APPLICABLE, empty reasons", () => {
  const result = deriveTripProofOfService(makeFacts({ tripState: "scheduled" }));
  assert.equal(result.state, "NOT_APPLICABLE");
  assert.deepEqual(result.reasons, []);
});

test("deriveTripProofOfService — every in-progress state -> NOT_APPLICABLE, empty reasons", () => {
  const states = [
    "scheduled",
    "en_route_to_pickup",
    "arrived_at_pickup",
    "passenger_onboard",
    "en_route_to_destination",
    "arrived_at_destination",
  ];
  for (const tripState of states) {
    // Deliberately supply facts that WOULD trigger every reason if this
    // state were evaluated, to prove NOT_APPLICABLE short-circuits
    // before any reason logic runs at all.
    const result = deriveTripProofOfService(
      makeFacts({
        tripState,
        completedAt: null,
        hasPassenger: false,
        hasPickupDescription: false,
        hasDestinationDescription: false,
        hasCompleteLifecycleEventChain: false,
        hasCompletionAssignment: false,
        completionAssignmentVehicleId: null,
        openExceptionCount: 5,
      }),
    );
    assert.equal(result.state, "NOT_APPLICABLE", `expected NOT_APPLICABLE for tripState=${tripState}`);
    assert.deepEqual(result.reasons, [], `expected empty reasons for tripState=${tripState}`);
  }
});

test("deriveTripProofOfService — cancelled -> NOT_APPLICABLE (locked, S1B §22), never a billability judgment", () => {
  const result = deriveTripProofOfService(
    makeFacts({
      tripState: "cancelled",
      completedAt: null,
      hasCompletionAssignment: false,
      hasCompleteLifecycleEventChain: false,
      openExceptionCount: 3,
    }),
  );
  assert.equal(result.state, "NOT_APPLICABLE");
  assert.deepEqual(result.reasons, []);
});

test("deriveTripProofOfService — no_show -> NOT_APPLICABLE (locked, S1B §21), never NO_SHOW_READY/REVENUE/CHARGEABLE", () => {
  const result = deriveTripProofOfService(
    makeFacts({
      tripState: "no_show",
      completedAt: null,
      hasCompletionAssignment: false,
      hasCompleteLifecycleEventChain: false,
      openExceptionCount: 3,
    }),
  );
  assert.equal(result.state, "NOT_APPLICABLE");
  assert.deepEqual(result.reasons, []);
});

// ---------------------------------------------------------------------
// E. READY CASE
// ---------------------------------------------------------------------

test("deriveTripProofOfService — completed, complete evidence, Vehicle present, no open exception -> READY_FOR_REVIEW, empty reasons", () => {
  const result = deriveTripProofOfService(makeFacts());
  assert.equal(result.state, "READY_FOR_REVIEW");
  assert.deepEqual(result.reasons, []);
});

// ---------------------------------------------------------------------
// F. MISSING_VEHICLE
// ---------------------------------------------------------------------

test("deriveTripProofOfService — completed, Vehicle missing (completion assignment present, vehicle_id null) -> NEEDS_REVIEW [MISSING_VEHICLE]", () => {
  const result = deriveTripProofOfService(makeFacts({ completionAssignmentVehicleId: null }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["MISSING_VEHICLE"]);
});

// ---------------------------------------------------------------------
// G. OPEN_EXCEPTION
// ---------------------------------------------------------------------

test("deriveTripProofOfService — completed, open exception -> NEEDS_REVIEW [OPEN_EXCEPTION]", () => {
  const result = deriveTripProofOfService(makeFacts({ openExceptionCount: 1 }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["OPEN_EXCEPTION"]);
});

test("deriveTripProofOfService — multiple open exceptions still yield exactly one OPEN_EXCEPTION reason (count, not enumerated per-row)", () => {
  const result = deriveTripProofOfService(makeFacts({ openExceptionCount: 5 }));
  assert.deepEqual(result.reasons, ["OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// H. MULTI-REASON — Vehicle missing + open exception, both preserved
// ---------------------------------------------------------------------

test("deriveTripProofOfService — completed, Vehicle missing + open exception -> NEEDS_REVIEW [MISSING_VEHICLE, OPEN_EXCEPTION]", () => {
  const result = deriveTripProofOfService(makeFacts({ completionAssignmentVehicleId: null, openExceptionCount: 2 }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["MISSING_VEHICLE", "OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// I-N. EVIDENCE_INTEGRITY_GAP — fail-closed structural defects
// ---------------------------------------------------------------------

test("deriveTripProofOfService — completed_at missing -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP]", () => {
  const result = deriveTripProofOfService(makeFacts({ completedAt: null }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

test("deriveTripProofOfService — completion assignment missing -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP], never also MISSING_VEHICLE", () => {
  const result = deriveTripProofOfService(makeFacts({ hasCompletionAssignment: false, completionAssignmentVehicleId: null }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
  assert.equal(result.reasons.includes("MISSING_VEHICLE"), false);
});

test("deriveTripProofOfService — lifecycle event chain incomplete -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP]", () => {
  const result = deriveTripProofOfService(makeFacts({ hasCompleteLifecycleEventChain: false }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

test("deriveTripProofOfService — Passenger missing -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP]", () => {
  const result = deriveTripProofOfService(makeFacts({ hasPassenger: false }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

test("deriveTripProofOfService — pickup missing/blank -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP]", () => {
  const result = deriveTripProofOfService(makeFacts({ hasPickupDescription: false }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

test("deriveTripProofOfService — destination missing/blank -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP]", () => {
  const result = deriveTripProofOfService(makeFacts({ hasDestinationDescription: false }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

// ---------------------------------------------------------------------
// O. multiple structural defects -> ONE EVIDENCE_INTEGRITY_GAP only
// ---------------------------------------------------------------------

test("deriveTripProofOfService — multiple simultaneous structural defects -> exactly one EVIDENCE_INTEGRITY_GAP, never duplicated", () => {
  const result = deriveTripProofOfService(
    makeFacts({
      completedAt: null,
      hasPassenger: false,
      hasPickupDescription: false,
      hasDestinationDescription: false,
      hasCompleteLifecycleEventChain: false,
      hasCompletionAssignment: false,
      completionAssignmentVehicleId: null,
    }),
  );
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP"]);
});

// ---------------------------------------------------------------------
// P. structural defect + open exception -> both preserved
// ---------------------------------------------------------------------

test("deriveTripProofOfService — structural defect + open exception -> NEEDS_REVIEW [EVIDENCE_INTEGRITY_GAP, OPEN_EXCEPTION]", () => {
  const result = deriveTripProofOfService(makeFacts({ hasPassenger: false, openExceptionCount: 1 }));
  assert.equal(result.state, "NEEDS_REVIEW");
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP", "OPEN_EXCEPTION"]);
});

test("deriveTripProofOfService — completion assignment missing + open exception -> EVIDENCE_INTEGRITY_GAP + OPEN_EXCEPTION, still never MISSING_VEHICLE", () => {
  const result = deriveTripProofOfService(
    makeFacts({ hasCompletionAssignment: false, completionAssignmentVehicleId: null, openExceptionCount: 1 }),
  );
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP", "OPEN_EXCEPTION"]);
  assert.equal(result.reasons.includes("MISSING_VEHICLE"), false);
});

// ---------------------------------------------------------------------
// Q. stable deterministic reason ordering, regardless of fact-set order
// ---------------------------------------------------------------------

test("deriveTripProofOfService — reason order is always REASON_ORDER (EVIDENCE_INTEGRITY_GAP, MISSING_VEHICLE, OPEN_EXCEPTION) regardless of which facts are set first", () => {
  const a = deriveTripProofOfService(
    makeFacts({ openExceptionCount: 1, completionAssignmentVehicleId: null, hasPassenger: false }),
  );
  const b = deriveTripProofOfService(
    makeFacts({ hasPassenger: false, completionAssignmentVehicleId: null, openExceptionCount: 1 }),
  );
  assert.deepEqual(a.reasons, b.reasons);
  assert.deepEqual(a.reasons, ["EVIDENCE_INTEGRITY_GAP", "MISSING_VEHICLE", "OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// R/S. READY / NOT_APPLICABLE always have empty reason lists
// ---------------------------------------------------------------------

test("deriveTripProofOfService — READY_FOR_REVIEW result always has an empty reason list", () => {
  const result = deriveTripProofOfService(makeFacts());
  assert.equal(result.reasons.length, 0);
});

test("deriveTripProofOfService — NOT_APPLICABLE result always has an empty reason list", () => {
  const result = deriveTripProofOfService(makeFacts({ tripState: "cancelled" }));
  assert.equal(result.reasons.length, 0);
});

// ---------------------------------------------------------------------
// T/U/V. NO GPS, NOTES, or MONETARY fact is ever required by the
// contract — proven by exhaustively checking the facts object keys any
// caller is required to supply.
// ---------------------------------------------------------------------

test("deriveTripProofOfService — fact contract requires no GPS, notes, or monetary field", () => {
  const facts = makeFacts();
  const keys = Object.keys(facts);
  const forbidden = [
    "location",
    "gps",
    "latitude",
    "longitude",
    "note",
    "notes",
    "rate",
    "fare",
    "price",
    "charge",
    "payer",
    "invoice",
    "payment",
    "currency",
    "mileage",
    "odometer",
    "signature",
    "photo",
  ];
  for (const key of keys) {
    const lowered = key.toLowerCase();
    for (const bad of forbidden) {
      assert.equal(lowered.includes(bad), false, `fact contract must not include a ${bad}-related field, found: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------
// No unsupported reason code ever appears in any result
// ---------------------------------------------------------------------

test("deriveTripProofOfService — no unsupported reason code ever appears in any result", () => {
  const SUPPORTED = new Set(["EVIDENCE_INTEGRITY_GAP", "MISSING_VEHICLE", "OPEN_EXCEPTION"]);
  const combos = [
    makeFacts(),
    makeFacts({ completionAssignmentVehicleId: null }),
    makeFacts({ openExceptionCount: 3 }),
    makeFacts({ completedAt: null }),
    makeFacts({ hasCompletionAssignment: false, completionAssignmentVehicleId: null }),
    makeFacts({ hasCompleteLifecycleEventChain: false }),
    makeFacts({ hasPassenger: false }),
    makeFacts({ hasPickupDescription: false }),
    makeFacts({ hasDestinationDescription: false }),
    makeFacts({ tripState: "scheduled" }),
    makeFacts({ tripState: "cancelled" }),
    makeFacts({ tripState: "no_show" }),
  ];
  for (const facts of combos) {
    const result = deriveTripProofOfService(facts);
    for (const reason of result.reasons) {
      assert.equal(SUPPORTED.has(reason), true, `unsupported reason code returned: ${reason}`);
    }
  }
});
