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
