// Focused unit tests for the pure Progressive Assignment core (P1-OPS-PROG1).
// Run with:
//
//   node --test src/lib/operations/assignment-defaults-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { deriveAssignmentDefaults, orderDriversForOperator, deriveDriverDayFacts, deriveVehicleGuidance } = await import(
  "./assignment-defaults-core.ts"
);

const D1 = { id: "d1" };
const D2 = { id: "d2" };
const V1 = { id: "v1" };
const V2 = { id: "v2" };

function defaults(overrides = {}) {
  return deriveAssignmentDefaults({
    mode: "assign",
    currentDriverId: null,
    currentVehicleId: null,
    driverOptions: [D1],
    vehicleOptions: [V1],
    ...overrides,
  });
}

test("assign: exactly one driver and one vehicle are prefilled", () => {
  assert.deepEqual(defaults(), { driverId: "d1", driverSource: "only_option", vehicleId: "v1", vehicleSource: "only_option" });
});

test("assign: multiple drivers -> no driver guessed; single vehicle still prefilled", () => {
  const result = defaults({ driverOptions: [D1, D2] });
  assert.equal(result.driverId, null);
  assert.equal(result.driverSource, "none");
  assert.equal(result.vehicleId, "v1");
});

test("assign: multiple vehicles -> no vehicle guessed", () => {
  const result = defaults({ vehicleOptions: [V1, V2] });
  assert.equal(result.vehicleId, null);
  assert.equal(result.vehicleSource, "none");
  assert.equal(result.driverId, "d1");
});

test("assign: zero options -> nothing prefilled", () => {
  assert.deepEqual(defaults({ driverOptions: [], vehicleOptions: [] }), {
    driverId: null,
    driverSource: "none",
    vehicleId: null,
    vehicleSource: "none",
  });
});

test("reassign: existing driver and vehicle win over uniqueness defaults", () => {
  const result = defaults({ mode: "reassign", currentDriverId: "d2", currentVehicleId: "v2", driverOptions: [D1, D2], vehicleOptions: [V2] });
  assert.deepEqual(result, { driverId: "d2", driverSource: "existing", vehicleId: "v2", vehicleSource: "existing" });
});

test("reassign: existing vehicle preserved even when it is one of several", () => {
  const result = defaults({ mode: "reassign", currentDriverId: "d1", currentVehicleId: "v2", vehicleOptions: [V1, V2] });
  assert.equal(result.vehicleId, "v2");
  assert.equal(result.vehicleSource, "existing");
});

test("reassign: existing 'no vehicle' is never overwritten by the only active vehicle", () => {
  const result = defaults({ mode: "reassign", currentDriverId: "d1", currentVehicleId: null, vehicleOptions: [V1] });
  assert.equal(result.vehicleId, null);
  assert.equal(result.vehicleSource, "none");
});

test("reassign: an inactive current driver/vehicle is not swapped for a different unique option", () => {
  const result = defaults({ mode: "reassign", currentDriverId: "gone", currentVehicleId: "gone-v", driverOptions: [D1], vehicleOptions: [V1] });
  assert.deepEqual(result, { driverId: null, driverSource: "none", vehicleId: null, vehicleSource: "none" });
});

test("orderDriversForOperator: linked operator first with (you), others keep order, nothing mutated", () => {
  const input = [
    { id: "j", displayName: "James Example" },
    { id: "s", displayName: "Sarah Example" },
    { id: "v", displayName: "Victor Example" },
  ];
  const ordered = orderDriversForOperator(input, "v");
  assert.deepEqual(
    ordered.map((d) => d.label),
    ["Victor Example (you)", "James Example", "Sarah Example"],
  );
  assert.equal(ordered[0].displayName, "Victor Example");
  assert.equal(ordered[0].isSelf, true);
  assert.equal(input[2].displayName, "Victor Example");
});

test("orderDriversForOperator: no linked driver / not eligible -> unchanged order, no (you)", () => {
  const input = [
    { id: "a", displayName: "A" },
    { id: "b", displayName: "B" },
  ];
  assert.deepEqual(orderDriversForOperator(input, null).map((d) => d.label), ["A", "B"]);
  assert.deepEqual(orderDriversForOperator(input, "zzz").map((d) => d.label), ["A", "B"]);
});

// Target day: 2026-09-25 America/New_York -> [04:00Z, next 04:00Z)
const DAY = { dayStartUtc: "2026-09-25T04:00:00.000Z", dayEndUtc: "2026-09-26T04:00:00.000Z" };
function trip(tripId, state, scheduledPickupAt) {
  return { tripId, state, scheduledPickupAt, pickupDescription: "p", destinationDescription: "d" };
}

test("deriveDriverDayFacts: only other non-terminal trips on the target org-local day, earliest first", () => {
  const facts = deriveDriverDayFacts({
    targetTripId: "target",
    ...DAY,
    trips: [
      trip("t-1400", "scheduled", "2026-09-25T18:00:00.000Z"),
      trip("t-0830", "scheduled", "2026-09-25T12:30:00.000Z"),
      trip("target", "scheduled", "2026-09-25T15:00:00.000Z"),
      trip("today-1600", "scheduled", "2026-09-24T20:00:00.000Z"),
      trip("completed-0700", "completed", "2026-09-25T11:00:00.000Z"),
      trip("cancelled-1700", "cancelled", "2026-09-25T21:00:00.000Z"),
      trip("noshow", "no_show", "2026-09-25T13:00:00.000Z"),
      trip("unscheduled", "scheduled", null),
    ],
  });
  assert.deepEqual(facts.otherTrips.map((t) => t.tripId), ["t-0830", "t-1400"]);
  assert.equal(facts.currentTrip, null);
});

test("deriveDriverDayFacts: day window is half-open [start, end)", () => {
  const facts = deriveDriverDayFacts({
    targetTripId: "x",
    ...DAY,
    trips: [trip("at-start", "scheduled", DAY.dayStartUtc), trip("at-end", "scheduled", DAY.dayEndUtc)],
  });
  assert.deepEqual(facts.otherTrips.map((t) => t.tripId), ["at-start"]);
});

test("deriveDriverDayFacts: in-progress trip on any day is the current trip; target never counts", () => {
  const facts = deriveDriverDayFacts({
    targetTripId: "target",
    ...DAY,
    trips: [
      trip("target", "en_route_to_pickup", "2026-09-25T15:00:00.000Z"),
      trip("live", "passenger_onboard", "2026-09-24T20:00:00.000Z"),
    ],
  });
  assert.equal(facts.currentTrip?.tripId, "live");
  assert.deepEqual(facts.otherTrips, []);
});

test("deriveDriverDayFacts: duplicate rows (day + current queries) listed once", () => {
  const live = trip("live", "en_route_to_pickup", "2026-09-25T13:00:00.000Z");
  const facts = deriveDriverDayFacts({ targetTripId: "x", ...DAY, trips: [live, live] });
  assert.deepEqual(facts.otherTrips.map((t) => t.tripId), ["live"]);
  assert.equal(facts.currentTrip?.tripId, "live");
});

test("deriveDriverDayFacts: unscheduled target -> no day list, current trip still reported", () => {
  const facts = deriveDriverDayFacts({
    targetTripId: "x",
    dayStartUtc: null,
    dayEndUtc: null,
    trips: [trip("a", "scheduled", "2026-09-25T13:00:00.000Z"), trip("b", "arrived_at_pickup", "2026-09-25T12:00:00.000Z")],
  });
  assert.deepEqual(facts.otherTrips, []);
  assert.equal(facts.currentTrip?.tripId, "b");
});

test("deriveVehicleGuidance", () => {
  assert.equal(deriveVehicleGuidance(0, null), "no_active_vehicles");
  assert.equal(deriveVehicleGuidance(2, null), "no_vehicle_selected");
  assert.equal(deriveVehicleGuidance(1, "v1"), "none");
});

// ---------------- P1-OPS-PROG2: recurring-history prefill ----------------
const { selectRecurringAssignmentHint } = await import("./assignment-defaults-core.ts");

const ARR = "arr-1";
const TARGET = { tripId: "target", recurringArrangementId: ARR, scheduledPickupAt: "2026-10-10T14:00:00.000Z" };
function occ(tripId, state, at, completedBy = { driverId: "dA", vehicleId: "vA" }, arrangement = ARR) {
  return { tripId, recurringArrangementId: arrangement, state, scheduledPickupAt: at, completedBy };
}

test("recurring hint: no prior occurrence -> null", () => {
  assert.equal(selectRecurringAssignmentHint(TARGET, []), null);
});

test("recurring hint: non-recurring target -> null", () => {
  assert.equal(selectRecurringAssignmentHint({ ...TARGET, recurringArrangementId: null }, [occ("o1", "completed", "2026-10-08T14:00:00.000Z")]), null);
});

test("recurring hint: unassigned / cancelled / no-show / scheduled occurrences never count", () => {
  const history = [
    occ("o-unassigned", "completed", "2026-10-09T14:00:00.000Z", null),
    occ("o-cancelled", "cancelled", "2026-10-08T14:00:00.000Z"),
    occ("o-noshow", "no_show", "2026-10-07T14:00:00.000Z"),
    occ("o-scheduled", "scheduled", "2026-10-06T14:00:00.000Z"),
  ];
  assert.equal(selectRecurringAssignmentHint(TARGET, history), null);
});

test("recurring hint: newest EARLIER completed occurrence of the same arrangement wins", () => {
  const history = [
    occ("old", "completed", "2026-10-01T14:00:00.000Z", { driverId: "dOld", vehicleId: "vOld" }),
    occ("newest", "completed", "2026-10-08T14:00:00.000Z", { driverId: "dNew", vehicleId: null }),
    occ("later", "completed", "2026-10-12T14:00:00.000Z", { driverId: "dLater", vehicleId: "vLater" }),
    occ("other-arr", "completed", "2026-10-09T14:00:00.000Z", { driverId: "dOther", vehicleId: "vOther" }, "arr-2"),
    occ("target", "completed", "2026-10-10T14:00:00.000Z", { driverId: "dSelf", vehicleId: "vSelf" }),
  ];
  assert.deepEqual(selectRecurringAssignmentHint(TARGET, history), { driverId: "dNew", vehicleId: null });
});

test("PROG2 priority: recurring driver+vehicle prefilled when still eligible", () => {
  const r = defaults({ driverOptions: [D1, D2], vehicleOptions: [V1, V2], recurringHint: { driverId: "d2", vehicleId: "v2" } });
  assert.deepEqual(r, { driverId: "d2", driverSource: "recurring_history", vehicleId: "v2", vehicleSource: "recurring_history" });
});

test("PROG2 priority: inactive historical driver ignored -> unique fallback / none", () => {
  const unique = defaults({ driverOptions: [D1], vehicleOptions: [V1, V2], recurringHint: { driverId: "gone", vehicleId: "v2" } });
  assert.equal(unique.driverId, "d1");
  assert.equal(unique.driverSource, "only_option");
  assert.equal(unique.vehicleSource, "recurring_history");
  const many = defaults({ driverOptions: [D1, D2], vehicleOptions: [V1, V2], recurringHint: { driverId: "gone", vehicleId: "gone-v" } });
  assert.deepEqual(many, { driverId: null, driverSource: "none", vehicleId: null, vehicleSource: "none" });
});

test("PROG2 priority: historical 'no vehicle' is never invented; uniqueness may still apply", () => {
  const two = defaults({ driverOptions: [D1, D2], vehicleOptions: [V1, V2], recurringHint: { driverId: "d1", vehicleId: null } });
  assert.equal(two.vehicleId, null);
  const one = defaults({ driverOptions: [D1, D2], vehicleOptions: [V1], recurringHint: { driverId: "d1", vehicleId: null } });
  assert.equal(one.vehicleId, "v1");
  assert.equal(one.vehicleSource, "only_option");
});

test("PROG2 priority: reassign ignores recurring history entirely", () => {
  const r = defaults({ mode: "reassign", currentDriverId: "d1", currentVehicleId: null, driverOptions: [D1, D2], vehicleOptions: [V1], recurringHint: { driverId: "d2", vehicleId: "v1" } });
  assert.deepEqual(r, { driverId: "d1", driverSource: "existing", vehicleId: null, vehicleSource: "none" });
});
