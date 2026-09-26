// Focused unit tests for the pure Trip Readiness derivation helper
// (P1-E1-S4B). Run with:
//
//   node --test src/lib/operations/trip-readiness-core.test.mjs
//
// Deliberately tests the pure core module only (trip-readiness-core.ts),
// which has no runtime import of any kind, matching
// request-readiness-core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { deriveTripReadiness } = await import("./trip-readiness-core.ts");

function makeFacts(overrides = {}) {
  return {
    state: "scheduled",
    scheduledPickupAt: "2026-11-01T14:00:00.000Z",
    hasActiveAssignment: true,
    assignedVehicleId: "vehicle-1",
    driverStatus: "active",
    vehicleStatus: "active",
    passengerStatus: "active",
    openExceptionCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A. READY CASE
// ---------------------------------------------------------------------

test("deriveTripReadiness — scheduled + fully prepared -> READY, empty reasons", () => {
  const result = deriveTripReadiness(makeFacts());
  assert.equal(result.state, "READY");
  assert.deepEqual(result.reasons, []);
});

// ---------------------------------------------------------------------
// B. NOT_APPLICABLE — every non-scheduled lifecycle state
// ---------------------------------------------------------------------

test("deriveTripReadiness — non-scheduled lifecycle states all -> NOT_APPLICABLE with empty reasons", () => {
  const states = [
    "en_route_to_pickup",
    "arrived_at_pickup",
    "passenger_onboard",
    "en_route_to_destination",
    "arrived_at_destination",
    "completed",
    "cancelled",
    "no_show",
  ];
  for (const state of states) {
    // Deliberately supply facts that WOULD trigger every reason if this
    // state were evaluated, to prove NOT_APPLICABLE short-circuits
    // before any reason logic runs at all.
    const result = deriveTripReadiness(
      makeFacts({ state, scheduledPickupAt: null, hasActiveAssignment: false, passengerStatus: "inactive", openExceptionCount: 3 }),
    );
    assert.equal(result.state, "NOT_APPLICABLE", `expected NOT_APPLICABLE for state=${state}`);
    assert.deepEqual(result.reasons, [], `expected empty reasons for state=${state}`);
  }
});

// ---------------------------------------------------------------------
// C. NO_SCHEDULE
// ---------------------------------------------------------------------

test("deriveTripReadiness — scheduled + no scheduled_pickup_at -> NEEDS_PREPARATION [NO_SCHEDULE]", () => {
  const result = deriveTripReadiness(makeFacts({ scheduledPickupAt: null }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["NO_SCHEDULE"]);
});

// ---------------------------------------------------------------------
// D. NO ASSIGNMENT SEMANTICS — NEEDS_DRIVER, never also NEEDS_VEHICLE
// ---------------------------------------------------------------------

test("deriveTripReadiness — scheduled + no active assignment -> NEEDS_DRIVER only, NOT NEEDS_VEHICLE", () => {
  const result = deriveTripReadiness(
    makeFacts({ hasActiveAssignment: false, assignedVehicleId: null, driverStatus: null, vehicleStatus: null }),
  );
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["NEEDS_DRIVER"]);
  assert.equal(result.reasons.includes("NEEDS_VEHICLE"), false);
});

test("deriveTripReadiness — scheduled + active assignment + vehicle_id null -> NEEDS_VEHICLE only", () => {
  const result = deriveTripReadiness(makeFacts({ hasActiveAssignment: true, assignedVehicleId: null, vehicleStatus: null }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["NEEDS_VEHICLE"]);
  assert.equal(result.reasons.includes("NEEDS_DRIVER"), false);
});

// ---------------------------------------------------------------------
// E. DRIVER / VEHICLE / PASSENGER STATUS
// ---------------------------------------------------------------------

test("deriveTripReadiness — scheduled + assigned Driver inactive -> DRIVER_INACTIVE", () => {
  const result = deriveTripReadiness(makeFacts({ driverStatus: "inactive" }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["DRIVER_INACTIVE"]);
});

test("deriveTripReadiness — scheduled + assigned Vehicle inactive -> VEHICLE_INACTIVE", () => {
  const result = deriveTripReadiness(makeFacts({ vehicleStatus: "inactive" }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["VEHICLE_INACTIVE"]);
});

test("deriveTripReadiness — DRIVER_INACTIVE never fires without an active assignment (defensive, even if caller passed a stray status)", () => {
  const result = deriveTripReadiness(makeFacts({ hasActiveAssignment: false, assignedVehicleId: null, driverStatus: "inactive" }));
  assert.equal(result.reasons.includes("DRIVER_INACTIVE"), false);
  assert.deepEqual(result.reasons, ["NEEDS_DRIVER"]);
});

test("deriveTripReadiness — VEHICLE_INACTIVE never fires when no Vehicle is assigned (defensive, even if caller passed a stray status)", () => {
  const result = deriveTripReadiness(makeFacts({ assignedVehicleId: null, vehicleStatus: "inactive" }));
  assert.equal(result.reasons.includes("VEHICLE_INACTIVE"), false);
  assert.deepEqual(result.reasons, ["NEEDS_VEHICLE"]);
});

test("deriveTripReadiness — scheduled + Passenger inactive -> PASSENGER_INACTIVE", () => {
  const result = deriveTripReadiness(makeFacts({ passengerStatus: "inactive" }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["PASSENGER_INACTIVE"]);
});

// ---------------------------------------------------------------------
// F. OPEN EXCEPTION
// ---------------------------------------------------------------------

test("deriveTripReadiness — scheduled + open exception -> OPEN_EXCEPTION", () => {
  const result = deriveTripReadiness(makeFacts({ openExceptionCount: 1 }));
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["OPEN_EXCEPTION"]);
});

test("deriveTripReadiness — multiple open exceptions still yield exactly one OPEN_EXCEPTION reason (count, not enumerated per-row)", () => {
  const result = deriveTripReadiness(makeFacts({ openExceptionCount: 5 }));
  assert.deepEqual(result.reasons, ["OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// G. MULTI-REASON CASE — all relevant reasons returned, stable order
// ---------------------------------------------------------------------

test("deriveTripReadiness — multiple simultaneous gaps -> all relevant reasons returned in stable order", () => {
  const result = deriveTripReadiness(
    makeFacts({
      scheduledPickupAt: null,
      hasActiveAssignment: true,
      assignedVehicleId: null,
      vehicleStatus: null,
      driverStatus: "inactive",
      passengerStatus: "inactive",
      openExceptionCount: 2,
    }),
  );
  assert.equal(result.state, "NEEDS_PREPARATION");
  assert.deepEqual(result.reasons, ["NO_SCHEDULE", "NEEDS_VEHICLE", "DRIVER_INACTIVE", "PASSENGER_INACTIVE", "OPEN_EXCEPTION"]);
});

test("deriveTripReadiness — every possible reason at once still yields a stable, fully-ordered list", () => {
  const result = deriveTripReadiness(
    makeFacts({
      scheduledPickupAt: null,
      hasActiveAssignment: false,
      assignedVehicleId: null,
      driverStatus: null,
      vehicleStatus: null,
      passengerStatus: "inactive",
      openExceptionCount: 1,
    }),
  );
  // NEEDS_VEHICLE cannot coexist with NEEDS_DRIVER (no assignment at
  // all means NEEDS_DRIVER only) — confirming the mutual-exclusion rule
  // holds even in the "everything else is also broken" case.
  assert.deepEqual(result.reasons, ["NO_SCHEDULE", "NEEDS_DRIVER", "PASSENGER_INACTIVE", "OPEN_EXCEPTION"]);
});

test("deriveTripReadiness — reason order is always REASON_ORDER regardless of which facts are set first", () => {
  const a = deriveTripReadiness(makeFacts({ openExceptionCount: 1, scheduledPickupAt: null }));
  const b = deriveTripReadiness(makeFacts({ scheduledPickupAt: null, openExceptionCount: 1 }));
  assert.deepEqual(a.reasons, b.reasons);
  assert.deepEqual(a.reasons, ["NO_SCHEDULE", "OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// H. NO UNSUPPORTED REASON EVER APPEARS
// ---------------------------------------------------------------------

test("deriveTripReadiness — READY result always has an empty reason list", () => {
  const result = deriveTripReadiness(makeFacts());
  assert.equal(result.reasons.length, 0);
});

test("deriveTripReadiness — no unsupported reason code ever appears in any result", () => {
  const SUPPORTED = new Set([
    "NO_SCHEDULE",
    "NEEDS_DRIVER",
    "NEEDS_VEHICLE",
    "DRIVER_INACTIVE",
    "VEHICLE_INACTIVE",
    "PASSENGER_INACTIVE",
    "OPEN_EXCEPTION",
  ]);
  const combos = [
    makeFacts(),
    makeFacts({ scheduledPickupAt: null }),
    makeFacts({ hasActiveAssignment: false, assignedVehicleId: null, driverStatus: null, vehicleStatus: null }),
    makeFacts({ assignedVehicleId: null, vehicleStatus: null }),
    makeFacts({ driverStatus: "inactive" }),
    makeFacts({ vehicleStatus: "inactive" }),
    makeFacts({ passengerStatus: "inactive" }),
    makeFacts({ openExceptionCount: 3 }),
    makeFacts({ state: "completed" }),
    makeFacts({ state: "cancelled" }),
  ];
  for (const facts of combos) {
    const result = deriveTripReadiness(facts);
    for (const reason of result.reasons) {
      assert.equal(SUPPORTED.has(reason), true, `unsupported reason code returned: ${reason}`);
    }
  }
});

// ---------------------------------------------------------------------
// P1-OPS-PROG5B -- known availability / capability reasons
// ---------------------------------------------------------------------

test("PROG5: known availability reasons make the trip NEEDS_PREPARATION, in REASON_ORDER after VEHICLE_INACTIVE", () => {
  const r = deriveTripReadiness(makeFacts({
    vehicleStatus: "inactive",
    passengerStatus: "inactive",
    availabilityReasons: ["VEHICLE_WHEELCHAIR_MISMATCH", "DRIVER_OFF_SHIFT", "VEHICLE_OUT_OF_SERVICE", "DRIVER_TIME_OFF"],
  }));
  assert.equal(r.state, "NEEDS_PREPARATION");
  assert.deepEqual(r.reasons, ["VEHICLE_INACTIVE", "DRIVER_TIME_OFF", "DRIVER_OFF_SHIFT", "VEHICLE_OUT_OF_SERVICE", "VEHICLE_WHEELCHAIR_MISMATCH", "PASSENGER_INACTIVE"]);
});

test("PROG5: no availability facts (every pre-PROG5 trip) -> identical result (backward compatibility)", () => {
  for (const facts of [makeFacts(), makeFacts({ assignedVehicleId: null, vehicleStatus: null }), makeFacts({ openExceptionCount: 1 })]) {
    assert.deepEqual(deriveTripReadiness({ ...facts, availabilityReasons: [] }), deriveTripReadiness(facts));
  }
  assert.equal(deriveTripReadiness(makeFacts({ availabilityReasons: [] })).state, "READY");
});

test("PROG5: availability reasons never apply without an active assignment, nor outside 'scheduled'", () => {
  const unassigned = deriveTripReadiness(makeFacts({ hasActiveAssignment: false, assignedVehicleId: null, driverStatus: null, vehicleStatus: null, availabilityReasons: ["DRIVER_TIME_OFF"] }));
  assert.deepEqual(unassigned.reasons, ["NEEDS_DRIVER"]);
  assert.equal(deriveTripReadiness(makeFacts({ state: "completed", availabilityReasons: ["DRIVER_TIME_OFF"] })).state, "NOT_APPLICABLE");
});
