// Focused unit tests for the pure Operations Brief derivation helpers
// (P1-E1-S1B). Run with:
//
//   node --test src/lib/operations/operations-brief-core.test.mjs
//
// Deliberately tests the pure core module only (operations-brief-core.ts),
// never operations-brief.ts (the server-only wrapper) — this file has no
// `server-only`/`next/headers` import, so it can be imported directly
// under plain Node, matching src/lib/app-url-core.test.mjs's own
// established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { computeDayState, deriveNextDepartures, deriveOperationsBrief, countDriversCurrentlyOnTrip } = await import(
  "./operations-brief-core.ts"
);

function makeTrip(overrides = {}) {
  return {
    id: "trip-1",
    state: "scheduled",
    statusLabel: "Scheduled",
    scheduledPickupAt: null,
    passengerName: "Test Passenger",
    pickupDescription: "123 Main St",
    destinationDescription: "456 Oak Ave",
    driverName: null,
    vehicleLabel: null,
    activeAssignmentId: null,
    ...overrides,
  };
}

function makeAttentionItem(trip, code) {
  return {
    trip,
    assurance: { code, label: code, explanation: "test", sourceFacts: [] },
  };
}

function makeTodaysOperationsData(overrides = {}) {
  return {
    dayBoundsUtc: { startUtc: "2026-09-15T00:00:00.000Z", endUtc: "2026-09-16T00:00:00.000Z" },
    todayTrips: [],
    needsAssignmentTrips: [],
    completedTodayTrips: [],
    activeTrips: [],
    activityLog: [],
    attentionItems: [],
    summary: {
      todayCount: 0,
      activeCount: 0,
      needsAssignmentCount: 0,
      completedTodayCount: 0,
      attentionCount: 0,
      onTrackCount: 0,
    },
    ...overrides,
  };
}

const NO_DRIVERS = { totalActiveDrivers: 0, driversCurrentlyOnTrip: 0 };

// ---------------------------------------------------------------------
// A. ZERO TRIPS
// ---------------------------------------------------------------------

test("deriveOperationsBrief — zero trips today: NO_TRIPS, everything empty", () => {
  const data = makeTodaysOperationsData({ todayTrips: [] });
  const result = deriveOperationsBrief(data, NO_DRIVERS, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.dayState, "NO_TRIPS");
  assert.deepEqual(result.attention, []);
  assert.deepEqual(result.activeNow, []);
  assert.deepEqual(result.nextDepartures, []);
  assert.equal(result.unassignedCount, 0);
  assert.equal(result.totalTripsToday, 0);
});

test("deriveOperationsBrief — zero trips today still reports real driver counts", () => {
  const data = makeTodaysOperationsData({ todayTrips: [] });
  const drivers = { totalActiveDrivers: 3, driversCurrentlyOnTrip: 0 };
  const result = deriveOperationsBrief(data, drivers, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.driverSnapshot, drivers);
});

// ---------------------------------------------------------------------
// B. NEXT DEPARTURES WINDOW — now = 10:00, both boundaries inclusive
// ---------------------------------------------------------------------

test("deriveNextDepartures — 2-hour window: both boundaries inclusive, outside excluded", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trips = [
    makeTrip({ id: "t-0959", scheduledPickupAt: "2026-09-15T09:59:00.000Z" }),
    makeTrip({ id: "t-1000", scheduledPickupAt: "2026-09-15T10:00:00.000Z" }),
    makeTrip({ id: "t-1159", scheduledPickupAt: "2026-09-15T11:59:00.000Z" }),
    makeTrip({ id: "t-1200", scheduledPickupAt: "2026-09-15T12:00:00.000Z" }),
    makeTrip({ id: "t-1201", scheduledPickupAt: "2026-09-15T12:01:00.000Z" }),
  ];
  const result = deriveNextDepartures(trips, new Set(), now);
  assert.deepEqual(
    result.map((t) => t.id),
    ["t-1000", "t-1159", "t-1200"],
  );
});

test("deriveNextDepartures — excludes non-'scheduled' state trips even inside the window", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-active", state: "en_route_to_pickup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  assert.deepEqual(deriveNextDepartures([trip], new Set(), now), []);
});

test("deriveNextDepartures — excludes a trip with no scheduledPickupAt", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-no-time", scheduledPickupAt: null });
  assert.deepEqual(deriveNextDepartures([trip], new Set(), now), []);
});

test("deriveNextDepartures — preserves the input's own relative order", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trips = [
    makeTrip({ id: "second", scheduledPickupAt: "2026-09-15T11:00:00.000Z" }),
    makeTrip({ id: "first", scheduledPickupAt: "2026-09-15T10:15:00.000Z" }),
  ];
  const result = deriveNextDepartures(trips, new Set(), now);
  assert.deepEqual(
    result.map((t) => t.id),
    ["second", "first"],
  );
});

// ---------------------------------------------------------------------
// C. ATTENTION DE-DUP
// ---------------------------------------------------------------------

test("deriveNextDepartures — excludes a trip already present in attentionItems", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-dup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  assert.deepEqual(deriveNextDepartures([trip], new Set(["t-dup"]), now), []);
});

test("deriveOperationsBrief — a scheduled trip inside the window AND in attentionItems is never in nextDepartures", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-dup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  const data = makeTodaysOperationsData({
    todayTrips: [trip],
    needsAssignmentTrips: [trip],
    attentionItems: [makeAttentionItem(trip, "NEEDS_ASSIGNMENT")],
  });
  const result = deriveOperationsBrief(data, NO_DRIVERS, now);
  assert.equal(result.nextDepartures.length, 0);
  assert.equal(result.attention.length, 1);
  assert.equal(result.attention[0].trip.id, "t-dup");
});

// ---------------------------------------------------------------------
// D. UNASSIGNED COUNT — count only, never a second row collection
// ---------------------------------------------------------------------

test("deriveOperationsBrief — unassignedCount reflects needsAssignmentTrips length", () => {
  const unassigned = [makeTrip({ id: "u1" }), makeTrip({ id: "u2" })];
  const data = makeTodaysOperationsData({ todayTrips: unassigned, needsAssignmentTrips: unassigned });
  const result = deriveOperationsBrief(data, NO_DRIVERS, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.unassignedCount, 2);
});

test("deriveOperationsBrief — no duplicate unassigned-row collection exists on the result", () => {
  const data = makeTodaysOperationsData();
  const result = deriveOperationsBrief(data, NO_DRIVERS, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal("unassignedTrips" in result, false);
  assert.equal("unassigned" in result, false);
});

// ---------------------------------------------------------------------
// E. ACTIVE NOW — pass-through only, no independent re-derivation
// ---------------------------------------------------------------------

test("deriveOperationsBrief — activeNow is exactly the input activeTrips (same reference, no re-filtering)", () => {
  const active = [makeTrip({ id: "a1", state: "en_route_to_pickup" })];
  const data = makeTodaysOperationsData({ activeTrips: active });
  const result = deriveOperationsBrief(data, NO_DRIVERS, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.activeNow, active);
});

// ---------------------------------------------------------------------
// F. DAY STATE
// ---------------------------------------------------------------------

test("computeDayState — 0 trips -> NO_TRIPS", () => {
  assert.equal(computeDayState([]), "NO_TRIPS");
});

test("computeDayState — all completed -> ALL_COMPLETE", () => {
  assert.equal(computeDayState([makeTrip({ state: "completed" }), makeTrip({ state: "completed" })]), "ALL_COMPLETE");
});

test("computeDayState — completed + cancelled -> ACTIVE_DAY (never ALL_COMPLETE)", () => {
  assert.equal(computeDayState([makeTrip({ state: "completed" }), makeTrip({ state: "cancelled" })]), "ACTIVE_DAY");
});

test("computeDayState — completed + no_show -> ACTIVE_DAY (never ALL_COMPLETE)", () => {
  assert.equal(computeDayState([makeTrip({ state: "completed" }), makeTrip({ state: "no_show" })]), "ACTIVE_DAY");
});

test("computeDayState — a scheduled trip present -> ACTIVE_DAY", () => {
  assert.equal(computeDayState([makeTrip({ state: "scheduled" })]), "ACTIVE_DAY");
});

test("computeDayState — an in-progress trip present -> ACTIVE_DAY", () => {
  assert.equal(computeDayState([makeTrip({ state: "en_route_to_pickup" })]), "ACTIVE_DAY");
});

// ---------------------------------------------------------------------
// G. DRIVER SNAPSHOT
//
// countDriversCurrentlyOnTrip itself is deliberately lifecycle-agnostic —
// it counts distinct driverIds among rows already carrying a pre-computed
// `isActiveState` boolean (see operations-brief-core.ts's own doc comment
// on DriverAssignmentStateRow for why: that classification is
// presentation.ts's `isActiveTripState`, called once by the server-only
// wrapper, never re-derived here). So this section tests two things
// separately: isActiveTripState's own real state classification (imported
// directly — presentation.ts has no sibling imports, so it is safely
// Node-loadable exactly like operations-brief-core.ts), and
// countDriversCurrentlyOnTrip's own counting/de-dup behavior given
// already-classified rows.
// ---------------------------------------------------------------------

const { isActiveTripState } = await import("./presentation.ts");

test("isActiveTripState — every one of the 5 active states classifies true", () => {
  const states = ["en_route_to_pickup", "arrived_at_pickup", "passenger_onboard", "en_route_to_destination", "arrived_at_destination"];
  for (const state of states) {
    assert.equal(isActiveTripState(state), true, `expected ${state} to be active`);
  }
});

test("isActiveTripState — completed trip is not active", () => {
  assert.equal(isActiveTripState("completed"), false);
});

test("isActiveTripState — cancelled trip is not active", () => {
  assert.equal(isActiveTripState("cancelled"), false);
});

test("isActiveTripState — future scheduled trip is not active", () => {
  assert.equal(isActiveTripState("scheduled"), false);
});

test("countDriversCurrentlyOnTrip — an active-state row counts", () => {
  assert.equal(countDriversCurrentlyOnTrip([{ driverId: "d1", isActiveState: true }]), 1);
});

test("countDriversCurrentlyOnTrip — a non-active-state row does not count", () => {
  assert.equal(countDriversCurrentlyOnTrip([{ driverId: "d1", isActiveState: false }]), 0);
});

test("countDriversCurrentlyOnTrip — one driver with two active-state assignment rows counts exactly once", () => {
  const rows = [
    { driverId: "d1", isActiveState: true },
    { driverId: "d1", isActiveState: true },
  ];
  assert.equal(countDriversCurrentlyOnTrip(rows), 1);
});

test("countDriversCurrentlyOnTrip — distinct drivers each count", () => {
  const rows = [
    { driverId: "d1", isActiveState: true },
    { driverId: "d2", isActiveState: true },
  ];
  assert.equal(countDriversCurrentlyOnTrip(rows), 2);
});

test("countDriversCurrentlyOnTrip — a driver's own non-active row does not mask a different driver's active row", () => {
  const rows = [
    { driverId: "d1", isActiveState: false },
    { driverId: "d2", isActiveState: true },
  ];
  assert.equal(countDriversCurrentlyOnTrip(rows), 1);
});

test("countDriversCurrentlyOnTrip — empty rows -> 0", () => {
  assert.equal(countDriversCurrentlyOnTrip([]), 0);
});
