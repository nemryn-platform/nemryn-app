// Focused unit tests for the pure Tomorrow Readiness aggregation helper
// (P1-E1-S4C). Run with:
//
//   node --test src/lib/operations/tomorrow-readiness-core.test.mjs
//
// Deliberately tests the pure core module only
// (tomorrow-readiness-core.ts), which has no runtime import of any kind
// (only an `import type` reference to trip-readiness-core.ts, erased at
// compile time) — no Supabase, no server-only, no date-boundary/
// timezone logic at all. This test file itself DOES import the real
// `deriveTripReadiness` (exactly like trip-readiness-core.test.mjs
// already does) to build realistic, genuinely-evaluated `readiness`
// values for each candidate — mirroring exactly what the real server
// wrapper (tomorrow-readiness.ts) does: evaluate each Trip via S4B's
// own unmodified evaluator, THEN hand the already-evaluated result to
// the aggregator. Date-boundary/DST behavior is tested separately (see
// the day-bounds DST test file), since organizationDayBoundsUtc lives
// in a server-only module this file deliberately never imports.

import test from "node:test";
import assert from "node:assert/strict";

const { aggregateTomorrowReadiness } = await import("./tomorrow-readiness-core.ts");
const { deriveTripReadiness } = await import("./trip-readiness-core.ts");

function makeFacts(overrides = {}) {
  return {
    state: "scheduled",
    scheduledPickupAt: "2026-11-02T14:00:00.000Z",
    hasActiveAssignment: true,
    assignedVehicleId: "vehicle-1",
    driverStatus: "active",
    vehicleStatus: "active",
    passengerStatus: "active",
    openExceptionCount: 0,
    ...overrides,
  };
}

/** Mirrors exactly what the real wrapper does: evaluate facts via the real S4B evaluator, then build a candidate carrying the already-evaluated result. */
function makeCandidate({ facts: factsOverrides = {}, ...overrides } = {}) {
  const facts = makeFacts(factsOverrides);
  return {
    tripId: "trip-1",
    scheduledPickupAt: facts.scheduledPickupAt ?? "2026-11-02T14:00:00.000Z",
    passengerDisplayName: "Test Passenger",
    readiness: deriveTripReadiness(facts),
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A. ZERO TRIPS
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — zero candidates -> total=0, ready=0, needsPreparation=0, empty items", () => {
  const result = aggregateTomorrowReadiness([]);
  assert.equal(result.totalScheduledTrips, 0);
  assert.equal(result.readyCount, 0);
  assert.equal(result.needsPreparationCount, 0);
  assert.deepEqual(result.items, []);
});

// ---------------------------------------------------------------------
// B / C. ONE READY, ONE NOT READY
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — one fully ready Trip -> 1/1/0", () => {
  const result = aggregateTomorrowReadiness([makeCandidate()]);
  assert.equal(result.totalScheduledTrips, 1);
  assert.equal(result.readyCount, 1);
  assert.equal(result.needsPreparationCount, 0);
  assert.equal(result.items[0].readiness.state, "READY");
  assert.deepEqual(result.items[0].readiness.reasons, []);
});

test("aggregateTomorrowReadiness — one not-ready Trip -> 1/0/1", () => {
  const result = aggregateTomorrowReadiness([
    makeCandidate({ facts: { hasActiveAssignment: false, assignedVehicleId: null, driverStatus: null, vehicleStatus: null } }),
  ]);
  assert.equal(result.totalScheduledTrips, 1);
  assert.equal(result.readyCount, 0);
  assert.equal(result.needsPreparationCount, 1);
  assert.deepEqual(result.items[0].readiness.reasons, ["NEEDS_DRIVER"]);
});

// ---------------------------------------------------------------------
// D. MIXED READY / NOT READY
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — mixed ready/not-ready Trips -> correct aggregate counts", () => {
  const candidates = [
    makeCandidate({ tripId: "t1" }),
    makeCandidate({ tripId: "t2", facts: { driverStatus: "inactive" } }),
    makeCandidate({ tripId: "t3" }),
    makeCandidate({ tripId: "t4", facts: { openExceptionCount: 2 } }),
  ];
  const result = aggregateTomorrowReadiness(candidates);
  assert.equal(result.totalScheduledTrips, 4);
  assert.equal(result.readyCount, 2);
  assert.equal(result.needsPreparationCount, 2);
});

// ---------------------------------------------------------------------
// E. MULTI-REASON PRESERVATION
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — multi-reason Trip retains ALL reasons, never collapsed", () => {
  const candidate = makeCandidate({
    facts: { assignedVehicleId: null, vehicleStatus: null, driverStatus: "inactive", openExceptionCount: 1 },
  });
  const result = aggregateTomorrowReadiness([candidate]);
  assert.deepEqual(result.items[0].readiness.reasons, ["NEEDS_VEHICLE", "DRIVER_INACTIVE", "OPEN_EXCEPTION"]);
});

// ---------------------------------------------------------------------
// F / G. ORDERING — chronological, deterministic tiebreak
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — stable chronological ordering by scheduledPickupAt", () => {
  const candidates = [
    makeCandidate({ tripId: "late", scheduledPickupAt: "2026-11-02T20:00:00.000Z" }),
    makeCandidate({ tripId: "early", scheduledPickupAt: "2026-11-02T08:00:00.000Z" }),
    makeCandidate({ tripId: "middle", scheduledPickupAt: "2026-11-02T14:00:00.000Z" }),
  ];
  const result = aggregateTomorrowReadiness(candidates);
  assert.deepEqual(result.items.map((i) => i.tripId), ["early", "middle", "late"]);
});

test("aggregateTomorrowReadiness — two Trips with the same scheduled time use tripId as a deterministic tiebreaker", () => {
  const sameTime = "2026-11-02T14:00:00.000Z";
  const candidates = [
    makeCandidate({ tripId: "zzz-trip", scheduledPickupAt: sameTime }),
    makeCandidate({ tripId: "aaa-trip", scheduledPickupAt: sameTime }),
  ];
  const result = aggregateTomorrowReadiness(candidates);
  assert.deepEqual(result.items.map((i) => i.tripId), ["aaa-trip", "zzz-trip"]);

  // Order of input must not matter -- same result either way.
  const reversed = aggregateTomorrowReadiness([...candidates].reverse());
  assert.deepEqual(reversed.items.map((i) => i.tripId), ["aaa-trip", "zzz-trip"]);
});

// ---------------------------------------------------------------------
// Q. AGGREGATE INVARIANT — total = ready + needsPreparation
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — invariant: totalScheduledTrips === readyCount + needsPreparationCount, always", () => {
  const candidates = [
    makeCandidate({ tripId: "t1" }),
    makeCandidate({ tripId: "t2", facts: { passengerStatus: "inactive" } }),
    makeCandidate({ tripId: "t3", facts: { scheduledPickupAt: null } }),
    makeCandidate({ tripId: "t4" }),
    makeCandidate({ tripId: "t5", facts: { openExceptionCount: 1 } }),
  ];
  const result = aggregateTomorrowReadiness(candidates);
  assert.equal(result.totalScheduledTrips, result.readyCount + result.needsPreparationCount);
  assert.equal(result.items.length, result.totalScheduledTrips);
});

test("aggregateTomorrowReadiness — every item's own fields are exactly what was supplied (no silent substitution)", () => {
  const candidate = makeCandidate({ tripId: "provenance-check", passengerDisplayName: "Provenance Passenger" });
  const result = aggregateTomorrowReadiness([candidate]);
  assert.equal(result.items[0].tripId, "provenance-check");
  assert.equal(result.items[0].passengerDisplayName, "Provenance Passenger");
  assert.equal(result.items[0].scheduledPickupAt, candidate.scheduledPickupAt);
});

// ---------------------------------------------------------------------
// R. NOT_APPLICABLE NEVER EMITTED — enforced as a hard invariant
// ---------------------------------------------------------------------

test("aggregateTomorrowReadiness — throws if a candidate's own readiness is NOT_APPLICABLE (contract violation, never silently counted as READY)", () => {
  const badCandidate = makeCandidate({ facts: { state: "completed" } });
  assert.equal(badCandidate.readiness.state, "NOT_APPLICABLE");
  assert.throws(() => aggregateTomorrowReadiness([badCandidate]), /NOT_APPLICABLE/);
});

test("aggregateTomorrowReadiness — a NOT_APPLICABLE candidate is never silently folded into readyCount", () => {
  const candidates = [makeCandidate({ tripId: "good" }), makeCandidate({ tripId: "bad", facts: { state: "cancelled" } })];
  assert.throws(() => aggregateTomorrowReadiness(candidates));
});
