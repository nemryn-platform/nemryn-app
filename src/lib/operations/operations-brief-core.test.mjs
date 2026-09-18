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

const {
  computeDayState,
  deriveNextDepartures,
  deriveOperationsBrief,
  countDriversCurrentlyOnTrip,
  deriveRecurringCareSummary,
  deriveProofOfServiceSummary,
} = await import("./operations-brief-core.ts");

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
const NO_PENDING_REQUESTS = { pendingRequestCount: 0, oldestPendingRequestCreatedAt: null };
/** A legitimate "zero trips scheduled tomorrow" result — used as the default "not under test" value throughout this file's PRE-EXISTING test cases below, exactly like NO_DRIVERS/NO_PENDING_REQUESTS are each other's "not under test" defaults. Deliberately NOT `null` (which means a genuine fetch failure, P1-E1-S4E §11) — the dedicated Tomorrow Readiness section further down exercises `null` and real non-zero summaries explicitly. */
const NO_TOMORROW_READINESS = { totalScheduledTrips: 0, readyCount: 0, needsPreparationCount: 0 };
/** A legitimate "no active arrangements have any missing occurrences" result (P1-E2-S1F) — used as the default "not under test" value throughout this file's pre-existing test cases below, exactly like NO_TOMORROW_READINESS. Deliberately NOT `null` (which means a genuine fetch failure) — the dedicated Recurring Care section further down exercises `null` and real non-zero summaries explicitly. */
const NO_RECURRING_CARE = { activeArrangementCount: 0, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null };
/** A legitimate "no completed trips yesterday" result (P1-E3-S1F) — used as the default "not under test" value throughout this file's pre-existing test cases below, exactly like NO_TOMORROW_READINESS/NO_RECURRING_CARE. Deliberately NOT `null` (which means a genuine fetch failure) — the dedicated Proof-of-Service section further down exercises `null` and real non-zero summaries explicitly. */
const NO_PROOF_OF_SERVICE = { completedTripCount: 0, readyForReviewCount: 0, needsReviewCount: 0, evidenceIntegrityGapCount: 0 };

// ---------------------------------------------------------------------
// A. ZERO TRIPS
// ---------------------------------------------------------------------

test("deriveOperationsBrief — zero trips today: NO_TRIPS, everything empty", () => {
  const data = makeTodaysOperationsData({ todayTrips: [] });
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
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
  const result = deriveOperationsBrief(data, drivers, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
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
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, now);
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
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.unassignedCount, 2);
});

test("deriveOperationsBrief — no duplicate unassigned-row collection exists on the result", () => {
  const data = makeTodaysOperationsData();
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal("unassignedTrips" in result, false);
  assert.equal("unassigned" in result, false);
});

// ---------------------------------------------------------------------
// E. ACTIVE NOW — pass-through only, no independent re-derivation
// ---------------------------------------------------------------------

test("deriveOperationsBrief — activeNow is exactly the input activeTrips (same reference, no re-filtering)", () => {
  const active = [makeTrip({ id: "a1", state: "en_route_to_pickup" })];
  const data = makeTodaysOperationsData({ activeTrips: active });
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
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

// ---------------------------------------------------------------------
// H. REQUEST SUMMARY (P1-E1-S2G) — deriveOperationsBrief is a pure
// pass-through for requestSummary: the actual "pending" filtering
// (state='pending', organization-scoped, accepted/declined/cancelled
// excluded) happens entirely in the server-only query
// (operations-brief.ts's getRequestSummary, reusing requests-list.ts's
// own Pending queue definition) — this pure core has no database access
// by design (see this file's own header comment), so it cannot and does
// not re-verify SQL-level filtering. Those cases (accepted/declined/
// cancelled excluded, organization isolation) are covered by live/SQL
// validation instead, exactly like getDriverSnapshot's own query logic
// is never unit-tested here either — only its pure counting helper
// (countDriversCurrentlyOnTrip, above) is.
// ---------------------------------------------------------------------

test("deriveOperationsBrief — requestSummary: zero pending requests passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { pendingRequestCount: 0, oldestPendingRequestCreatedAt: null };
  const result = deriveOperationsBrief(data, NO_DRIVERS, summary, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.requestSummary, summary);
});

test("deriveOperationsBrief — requestSummary: one pending request passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { pendingRequestCount: 1, oldestPendingRequestCreatedAt: "2026-09-14T08:00:00.000Z" };
  const result = deriveOperationsBrief(data, NO_DRIVERS, summary, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.requestSummary, summary);
});

test("deriveOperationsBrief — requestSummary: multiple pending requests passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { pendingRequestCount: 7, oldestPendingRequestCreatedAt: "2026-09-10T08:00:00.000Z" };
  const result = deriveOperationsBrief(data, NO_DRIVERS, summary, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.requestSummary, summary);
});

test("deriveOperationsBrief — requestSummary is independent of dayState/attention/driverSnapshot (no cross-contamination)", () => {
  const trip = makeTrip({ id: "t1", state: "completed" });
  const data = makeTodaysOperationsData({ todayTrips: [trip] });
  const drivers = { totalActiveDrivers: 5, driversCurrentlyOnTrip: 2 };
  const summary = { pendingRequestCount: 3, oldestPendingRequestCreatedAt: "2026-09-12T08:00:00.000Z" };
  const result = deriveOperationsBrief(data, drivers, summary, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.dayState, "ALL_COMPLETE");
  assert.deepEqual(result.driverSnapshot, drivers);
  assert.deepEqual(result.requestSummary, summary);
});

test("deriveOperationsBrief — existing behavior (dayState/attention/nextDepartures/unassignedCount/activeNow) unchanged by requestSummary's addition", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-dup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  const data = makeTodaysOperationsData({
    todayTrips: [trip],
    needsAssignmentTrips: [trip],
    attentionItems: [makeAttentionItem(trip, "NEEDS_ASSIGNMENT")],
  });
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, now);
  assert.equal(result.dayState, "ACTIVE_DAY");
  assert.equal(result.nextDepartures.length, 0);
  assert.equal(result.attention.length, 1);
  assert.equal(result.unassignedCount, 1);
  assert.deepEqual(result.activeNow, []);
});

// ---------------------------------------------------------------------
// I. TOMORROW READINESS SUMMARY (P1-E1-S4E) — deriveOperationsBrief is a
// pure pass-through here too: the real day-bounds/candidate-query/
// evaluator logic lives entirely in S4C/S4C1's getTomorrowReadiness,
// narrowed to 3 counts by getTomorrowReadinessSummary (operations-
// brief.ts) — this pure core never recomputes readiness, so these tests
// only confirm the pass-through/independence contract, exactly like the
// requestSummary section above.
// ---------------------------------------------------------------------

test("deriveOperationsBrief — tomorrowReadiness: zero trips passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { totalScheduledTrips: 0, readyCount: 0, needsPreparationCount: 0 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, summary, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.tomorrowReadiness, summary);
});

test("deriveOperationsBrief — tomorrowReadiness: all ready passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { totalScheduledTrips: 4, readyCount: 4, needsPreparationCount: 0 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, summary, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.tomorrowReadiness, summary);
});

test("deriveOperationsBrief — tomorrowReadiness: one needs-preparation trip passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { totalScheduledTrips: 3, readyCount: 2, needsPreparationCount: 1 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, summary, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.tomorrowReadiness, summary);
});

test("deriveOperationsBrief — tomorrowReadiness: multiple needs-preparation trips passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { totalScheduledTrips: 25, readyCount: 18, needsPreparationCount: 7 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, summary, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.tomorrowReadiness, summary);
});

test("deriveOperationsBrief — tomorrowReadiness: null (genuine fetch failure) passes through unchanged, never coerced to a zero/ready value", () => {
  const data = makeTodaysOperationsData();
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, null, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.tomorrowReadiness, null);
});

test("deriveOperationsBrief — tomorrowReadiness is independent of dayState/attention/driverSnapshot/requestSummary (no cross-contamination)", () => {
  const trip = makeTrip({ id: "t1", state: "completed" });
  const data = makeTodaysOperationsData({ todayTrips: [trip] });
  const drivers = { totalActiveDrivers: 5, driversCurrentlyOnTrip: 2 };
  const requestSummary = { pendingRequestCount: 3, oldestPendingRequestCreatedAt: "2026-09-12T08:00:00.000Z" };
  const tomorrow = { totalScheduledTrips: 10, readyCount: 6, needsPreparationCount: 4 };
  const result = deriveOperationsBrief(data, drivers, requestSummary, tomorrow, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.dayState, "ALL_COMPLETE");
  assert.deepEqual(result.driverSnapshot, drivers);
  assert.deepEqual(result.requestSummary, requestSummary);
  assert.deepEqual(result.tomorrowReadiness, tomorrow);
});

test("deriveOperationsBrief — existing behavior (dayState/attention/nextDepartures/unassignedCount/activeNow/requestSummary) unchanged by tomorrowReadiness's addition", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-dup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  const data = makeTodaysOperationsData({
    todayTrips: [trip],
    needsAssignmentTrips: [trip],
    attentionItems: [makeAttentionItem(trip, "NEEDS_ASSIGNMENT")],
  });
  const requestSummary = { pendingRequestCount: 1, oldestPendingRequestCreatedAt: "2026-09-14T08:00:00.000Z" };
  const tomorrow = { totalScheduledTrips: 2, readyCount: 1, needsPreparationCount: 1 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, requestSummary, tomorrow, NO_RECURRING_CARE, NO_PROOF_OF_SERVICE, now);
  assert.equal(result.dayState, "ACTIVE_DAY");
  assert.equal(result.nextDepartures.length, 0);
  assert.equal(result.attention.length, 1);
  assert.equal(result.unassignedCount, 1);
  assert.deepEqual(result.activeNow, []);
  assert.deepEqual(result.requestSummary, requestSummary);
});

// ---------------------------------------------------------------------
// J. RECURRING CARE SUMMARY (P1-E2-S1F) — deriveRecurringCareSummary is
// pure aggregation only: every date/weekday/timezone/skip/readiness/
// cancellation rule that decided each row's own `missingCount`/
// `nextMissingDate` already ran inside the S1C evaluator
// (recurring-care-core.ts) before this function ever sees a row — these
// tests prove the AGGREGATION is correct (active-only filtering, sum,
// arrangement-with-missing count, earliest-next-missing-date), never
// re-derive or second-guess what the evaluator itself already decided
// (§10/§11/§12's own tests below construct an INPUT that already
// reflects what the authoritative evaluator would have produced for
// those scenarios, exactly like the tomorrowReadiness/requestSummary
// pass-through tests above prove pass-through rather than re-deriving
// Tomorrow Readiness's own evaluator).
// ---------------------------------------------------------------------

test("deriveRecurringCareSummary — zero arrangements: everything zero, nextMissingDate null", () => {
  const result = deriveRecurringCareSummary([]);
  assert.deepEqual(result, { activeArrangementCount: 0, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null });
});

test("deriveRecurringCareSummary — active arrangements, all covered (missingCount 0 everywhere)", () => {
  const rows = [
    { status: "active", assurance: { missingCount: 0, nextMissingDate: null } },
    { status: "active", assurance: { missingCount: 0, nextMissingDate: null } },
  ];
  const result = deriveRecurringCareSummary(rows);
  assert.deepEqual(result, { activeArrangementCount: 2, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null });
});

test("deriveRecurringCareSummary — one arrangement, one missing occurrence", () => {
  const rows = [{ status: "active", assurance: { missingCount: 1, nextMissingDate: "2026-09-25" } }];
  const result = deriveRecurringCareSummary(rows);
  assert.deepEqual(result, { activeArrangementCount: 1, missingOccurrenceCount: 1, arrangementsWithMissingCount: 1, nextMissingDate: "2026-09-25" });
});

test("deriveRecurringCareSummary — one arrangement, multiple missing occurrences, sums correctly", () => {
  const rows = [{ status: "active", assurance: { missingCount: 4, nextMissingDate: "2026-09-18" } }];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.missingOccurrenceCount, 4);
  assert.equal(result.arrangementsWithMissingCount, 1);
});

test("deriveRecurringCareSummary — multiple arrangements with missing occurrences: counts sum, arrangement count reflects distinct arrangements", () => {
  const rows = [
    { status: "active", assurance: { missingCount: 2, nextMissingDate: "2026-09-25" } },
    { status: "active", assurance: { missingCount: 1, nextMissingDate: "2026-09-19" } },
    { status: "active", assurance: { missingCount: 0, nextMissingDate: null } },
  ];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.activeArrangementCount, 3);
  assert.equal(result.missingOccurrenceCount, 3);
  assert.equal(result.arrangementsWithMissingCount, 2);
  assert.equal(result.nextMissingDate, "2026-09-19", "the EARLIEST next-missing date across all arrangements with missing occurrences");
});

test("deriveRecurringCareSummary — a SKIPPED date is never counted as missing (already excluded from the evaluator's own missingCount before this function ever sees it)", () => {
  // The evaluator's own expectedCount = patternDateCount - skippedCount,
  // and missingCount only ever counts truly MISSING expected dates — a
  // row reflecting "1 pattern date, 1 skipped, 0 missing" (exactly what
  // the S1C evaluator would produce for an arrangement whose only
  // near-horizon pattern date was deliberately skipped) must never
  // surface as a missing occurrence here.
  const rows = [{ status: "active", assurance: { missingCount: 0, nextMissingDate: null } }];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.missingOccurrenceCount, 0);
  assert.equal(result.arrangementsWithMissingCount, 0);
});

test("deriveRecurringCareSummary — a SCHEDULED occurrence whose Trip needs preparation is still not missing (Trip Readiness is a separate concern this function never touches)", () => {
  // A Trip with Readiness=NEEDS_PREPARATION still SATISFIES its occurrence
  // at the Recurring Care layer (P1-E2-S1E's own locked rule) — the
  // evaluator's own missingCount already reflects this (the occurrence is
  // SCHEDULED, not MISSING), so a row like this must never be counted.
  const rows = [{ status: "active", assurance: { missingCount: 0, nextMissingDate: null } }];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.missingOccurrenceCount, 0, "a scheduled-but-not-ready occurrence must never inflate missingOccurrenceCount");
});

test("deriveRecurringCareSummary — a date whose only linked Trip is cancelled is reflected as missing, through the authoritative evaluator's own input, with no special-case cancellation logic in this function", () => {
  // Mirrors exactly what the S1C evaluator itself produces when the only
  // linked Trip for a date is cancelled (a cancelled Trip never satisfies
  // an occurrence, so it remains MISSING) — this function performs no
  // cancellation-specific logic of its own; it simply counts whatever
  // missingCount the evaluator already decided.
  const rows = [{ status: "active", assurance: { missingCount: 1, nextMissingDate: "2026-09-20" } }];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.missingOccurrenceCount, 1);
  assert.equal(result.nextMissingDate, "2026-09-20");
});

test("deriveRecurringCareSummary — a PAUSED arrangement's own missing occurrences never contribute (§5 — active-only)", () => {
  const rows = [
    { status: "active", assurance: { missingCount: 1, nextMissingDate: "2026-09-25" } },
    { status: "paused", assurance: { missingCount: 3, nextMissingDate: "2026-09-18" } },
  ];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.activeArrangementCount, 1, "the paused row is excluded from the active count too");
  assert.equal(result.missingOccurrenceCount, 1, "the paused arrangement's own 3 missing occurrences never contribute");
  assert.equal(result.arrangementsWithMissingCount, 1);
  assert.equal(result.nextMissingDate, "2026-09-25", "never the paused arrangement's own earlier date");
});

test("deriveRecurringCareSummary — an ENDED arrangement's own missing occurrences never contribute (§5 — active-only)", () => {
  const rows = [{ status: "ended", assurance: { missingCount: 5, nextMissingDate: "2026-09-18" } }];
  const result = deriveRecurringCareSummary(rows);
  assert.deepEqual(result, { activeArrangementCount: 0, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null });
});

test("deriveRecurringCareSummary — a row with assurance=null (excluded by the evaluator's own coarse near-horizon filter) contributes to activeArrangementCount but not to any missing count", () => {
  const rows = [
    { status: "active", assurance: null },
    { status: "active", assurance: { missingCount: 2, nextMissingDate: "2026-09-22" } },
  ];
  const result = deriveRecurringCareSummary(rows);
  assert.equal(result.activeArrangementCount, 2);
  assert.equal(result.missingOccurrenceCount, 2);
  assert.equal(result.arrangementsWithMissingCount, 1);
});

test("deriveOperationsBrief — recurringCare: zero-arrangement summary passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { activeArrangementCount: 0, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, summary, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.recurringCare, summary);
});

test("deriveOperationsBrief — recurringCare: a real missing summary passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { activeArrangementCount: 3, missingOccurrenceCount: 4, arrangementsWithMissingCount: 2, nextMissingDate: "2026-09-25" };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, summary, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.recurringCare, summary);
});

test("deriveOperationsBrief — recurringCare: null (genuine fetch failure) passes through unchanged, never coerced to a zero/covered value", () => {
  const data = makeTodaysOperationsData();
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, null, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.recurringCare, null);
});

test("deriveOperationsBrief — recurringCare is independent of dayState/attention/driverSnapshot/requestSummary/tomorrowReadiness (no cross-contamination)", () => {
  const trip = makeTrip({ id: "t1", state: "completed" });
  const data = makeTodaysOperationsData({ todayTrips: [trip] });
  const drivers = { totalActiveDrivers: 5, driversCurrentlyOnTrip: 2 };
  const requestSummary = { pendingRequestCount: 3, oldestPendingRequestCreatedAt: "2026-09-12T08:00:00.000Z" };
  const tomorrow = { totalScheduledTrips: 10, readyCount: 6, needsPreparationCount: 4 };
  const recurring = { activeArrangementCount: 1, missingOccurrenceCount: 1, arrangementsWithMissingCount: 1, nextMissingDate: "2026-09-20" };
  const result = deriveOperationsBrief(data, drivers, requestSummary, tomorrow, recurring, NO_PROOF_OF_SERVICE, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.dayState, "ALL_COMPLETE");
  assert.deepEqual(result.driverSnapshot, drivers);
  assert.deepEqual(result.requestSummary, requestSummary);
  assert.deepEqual(result.tomorrowReadiness, tomorrow);
  assert.deepEqual(result.recurringCare, recurring);
});

test("deriveOperationsBrief — existing behavior (dayState/attention/nextDepartures/unassignedCount/activeNow/requestSummary/tomorrowReadiness) unchanged by recurringCare's addition", () => {
  const now = new Date("2026-09-15T10:00:00.000Z");
  const trip = makeTrip({ id: "t-dup", scheduledPickupAt: "2026-09-15T10:30:00.000Z" });
  const data = makeTodaysOperationsData({
    todayTrips: [trip],
    needsAssignmentTrips: [trip],
    attentionItems: [makeAttentionItem(trip, "NEEDS_ASSIGNMENT")],
  });
  const requestSummary = { pendingRequestCount: 1, oldestPendingRequestCreatedAt: "2026-09-14T08:00:00.000Z" };
  const tomorrow = { totalScheduledTrips: 2, readyCount: 1, needsPreparationCount: 1 };
  const recurring = { activeArrangementCount: 2, missingOccurrenceCount: 0, arrangementsWithMissingCount: 0, nextMissingDate: null };
  const result = deriveOperationsBrief(data, NO_DRIVERS, requestSummary, tomorrow, recurring, NO_PROOF_OF_SERVICE, now);
  assert.equal(result.dayState, "ACTIVE_DAY");
  assert.equal(result.nextDepartures.length, 0);
  assert.equal(result.attention.length, 1);
  assert.equal(result.unassignedCount, 1);
  assert.deepEqual(result.activeNow, []);
  assert.deepEqual(result.requestSummary, requestSummary);
  assert.deepEqual(result.tomorrowReadiness, tomorrow);
});

// ---------------------------------------------------------------------
// PROOF-OF-SERVICE SUMMARY (P1-E3-S1F)
// ---------------------------------------------------------------------

function pos(state, reasons = []) {
  return { state, reasons };
}

test("deriveProofOfServiceSummary — 0 trips -> all counts zero", () => {
  const result = deriveProofOfServiceSummary([]);
  assert.deepEqual(result, { completedTripCount: 0, readyForReviewCount: 0, needsReviewCount: 0, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — 1 READY_FOR_REVIEW", () => {
  const result = deriveProofOfServiceSummary([pos("READY_FOR_REVIEW")]);
  assert.deepEqual(result, { completedTripCount: 1, readyForReviewCount: 1, needsReviewCount: 0, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — 1 NEEDS_REVIEW", () => {
  const result = deriveProofOfServiceSummary([pos("NEEDS_REVIEW", ["MISSING_VEHICLE"])]);
  assert.deepEqual(result, { completedTripCount: 1, readyForReviewCount: 0, needsReviewCount: 1, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — mixed results", () => {
  const result = deriveProofOfServiceSummary([
    pos("READY_FOR_REVIEW"),
    pos("READY_FOR_REVIEW"),
    pos("NEEDS_REVIEW", ["MISSING_VEHICLE"]),
    pos("NEEDS_REVIEW", ["OPEN_EXCEPTION"]),
    pos("NEEDS_REVIEW", ["EVIDENCE_INTEGRITY_GAP"]),
  ]);
  assert.deepEqual(result, { completedTripCount: 5, readyForReviewCount: 2, needsReviewCount: 3, evidenceIntegrityGapCount: 1 });
});

test("deriveProofOfServiceSummary — all READY", () => {
  const result = deriveProofOfServiceSummary([pos("READY_FOR_REVIEW"), pos("READY_FOR_REVIEW"), pos("READY_FOR_REVIEW")]);
  assert.deepEqual(result, { completedTripCount: 3, readyForReviewCount: 3, needsReviewCount: 0, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — all NEEDS_REVIEW", () => {
  const result = deriveProofOfServiceSummary([
    pos("NEEDS_REVIEW", ["MISSING_VEHICLE"]),
    pos("NEEDS_REVIEW", ["OPEN_EXCEPTION"]),
  ]);
  assert.deepEqual(result, { completedTripCount: 2, readyForReviewCount: 0, needsReviewCount: 2, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — a multi-reason NEEDS_REVIEW Trip counts once in needsReviewCount, not once per reason", () => {
  const result = deriveProofOfServiceSummary([pos("NEEDS_REVIEW", ["MISSING_VEHICLE", "OPEN_EXCEPTION"])]);
  assert.deepEqual(result, { completedTripCount: 1, readyForReviewCount: 0, needsReviewCount: 1, evidenceIntegrityGapCount: 0 });
});

test("deriveProofOfServiceSummary — EVIDENCE_INTEGRITY_GAP count reflects Trips carrying that specific reason", () => {
  const result = deriveProofOfServiceSummary([
    pos("NEEDS_REVIEW", ["EVIDENCE_INTEGRITY_GAP"]),
    pos("NEEDS_REVIEW", ["EVIDENCE_INTEGRITY_GAP", "OPEN_EXCEPTION"]),
    pos("NEEDS_REVIEW", ["MISSING_VEHICLE"]),
  ]);
  assert.deepEqual(result, { completedTripCount: 3, readyForReviewCount: 0, needsReviewCount: 3, evidenceIntegrityGapCount: 2 });
});

test("deriveProofOfServiceSummary — a MISSING_VEHICLE-only Trip counts once as NEEDS_REVIEW, zero evidence-integrity contribution", () => {
  const result = deriveProofOfServiceSummary([pos("NEEDS_REVIEW", ["MISSING_VEHICLE"])]);
  assert.equal(result.needsReviewCount, 1);
  assert.equal(result.evidenceIntegrityGapCount, 0);
});

test("deriveProofOfServiceSummary — an OPEN_EXCEPTION-only Trip counts once as NEEDS_REVIEW, zero evidence-integrity contribution", () => {
  const result = deriveProofOfServiceSummary([pos("NEEDS_REVIEW", ["OPEN_EXCEPTION"])]);
  assert.equal(result.needsReviewCount, 1);
  assert.equal(result.evidenceIntegrityGapCount, 0);
});

test("deriveProofOfServiceSummary — arithmetic invariant: readyForReviewCount + needsReviewCount === completedTripCount, across many combinations", () => {
  const combos = [
    [],
    [pos("READY_FOR_REVIEW")],
    [pos("NEEDS_REVIEW", ["MISSING_VEHICLE"])],
    [pos("READY_FOR_REVIEW"), pos("NEEDS_REVIEW", ["OPEN_EXCEPTION"]), pos("READY_FOR_REVIEW")],
    [pos("NOT_APPLICABLE")],
    [pos("READY_FOR_REVIEW"), pos("NOT_APPLICABLE"), pos("NEEDS_REVIEW", ["MISSING_VEHICLE"])],
  ];
  for (const results of combos) {
    const summary = deriveProofOfServiceSummary(results);
    assert.equal(
      summary.readyForReviewCount + summary.needsReviewCount,
      summary.completedTripCount,
      `invariant violated for input length ${results.length}`,
    );
  }
});

test("deriveProofOfServiceSummary — unexpected NOT_APPLICABLE in a completed-set input fails closed: counted into needsReviewCount AND evidenceIntegrityGapCount, never silently dropped", () => {
  const result = deriveProofOfServiceSummary([pos("READY_FOR_REVIEW"), pos("NOT_APPLICABLE")]);
  assert.deepEqual(result, { completedTripCount: 2, readyForReviewCount: 1, needsReviewCount: 1, evidenceIntegrityGapCount: 1 });
});

test("deriveProofOfServiceSummary — an entirely unrecognized state string is also treated as the same fail-closed anomaly, never crashes", () => {
  const result = deriveProofOfServiceSummary([pos("SOME_FUTURE_STATE")]);
  assert.deepEqual(result, { completedTripCount: 1, readyForReviewCount: 0, needsReviewCount: 1, evidenceIntegrityGapCount: 1 });
});

test("deriveProofOfServiceSummary — stable, deterministic result for the same input", () => {
  const input = [pos("READY_FOR_REVIEW"), pos("NEEDS_REVIEW", ["MISSING_VEHICLE"]), pos("NEEDS_REVIEW", ["OPEN_EXCEPTION"])];
  const a = deriveProofOfServiceSummary(input);
  const b = deriveProofOfServiceSummary(input);
  assert.deepEqual(a, b);
});

test("deriveOperationsBrief — proofOfService: null (genuine fetch failure / declined-unavailable) passes through unchanged, never coerced to a zero value", () => {
  const data = makeTodaysOperationsData();
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, null, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.proofOfService, null);
});

test("deriveOperationsBrief — proofOfService: a real whole-window summary passes through unchanged", () => {
  const data = makeTodaysOperationsData();
  const summary = { completedTripCount: 5, readyForReviewCount: 3, needsReviewCount: 2, evidenceIntegrityGapCount: 1 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, summary, new Date("2026-09-15T10:00:00.000Z"));
  assert.deepEqual(result.proofOfService, summary);
});

test("deriveOperationsBrief — proofOfService is independent of dayState/attention/driverSnapshot/requestSummary/tomorrowReadiness/recurringCare (no cross-contamination)", () => {
  const trip = makeTrip({ id: "t1", state: "completed" });
  const data = makeTodaysOperationsData({ todayTrips: [trip] });
  const summary = { completedTripCount: 4, readyForReviewCount: 4, needsReviewCount: 0, evidenceIntegrityGapCount: 0 };
  const result = deriveOperationsBrief(data, NO_DRIVERS, NO_PENDING_REQUESTS, NO_TOMORROW_READINESS, NO_RECURRING_CARE, summary, new Date("2026-09-15T10:00:00.000Z"));
  assert.equal(result.dayState, "ALL_COMPLETE");
  assert.deepEqual(result.recurringCare, NO_RECURRING_CARE);
  assert.deepEqual(result.proofOfService, summary);
});
