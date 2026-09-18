// Focused unit tests for the pure Proof-of-Service evidence-normalization
// helpers (P1-E3-S1C). Run with:
//
//   node --test src/lib/operations/trip-proof-of-service-evidence.test.mjs
//
// Tests the pure module only (trip-proof-of-service-evidence.ts), which
// has no runtime import of any kind, matching
// trip-proof-of-service-core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { evaluateLifecycleEventChain, extractLifecycleEventTimestamps, classifyCompletionAssignmentCardinality } =
  await import("./trip-proof-of-service-evidence.ts");

const COMPLETED_AT = "2026-11-01T15:30:00.000Z";

function fullChain(overrides = {}) {
  const base = {
    en_route_to_pickup: "2026-11-01T14:50:00.000Z",
    arrived_at_pickup: "2026-11-01T15:00:00.000Z",
    passenger_onboard: "2026-11-01T15:05:00.000Z",
    en_route_to_destination: "2026-11-01T15:10:00.000Z",
    arrived_at_destination: "2026-11-01T15:28:00.000Z",
    trip_completed: COMPLETED_AT,
    ...overrides,
  };
  return Object.entries(base)
    .filter(([, v]) => v !== null)
    .map(([eventType, occurredAt]) => ({ eventType, occurredAt }));
}

// ---------------------------------------------------------------------
// Complete 6-event chain -> true
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — complete 6-event chain, in order, trip_completed matches completedAt -> true", () => {
  assert.equal(evaluateLifecycleEventChain(fullChain(), COMPLETED_AT), true);
});

// ---------------------------------------------------------------------
// Missing event -> false
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — missing required event -> false", () => {
  const events = fullChain().filter((e) => e.eventType !== "passenger_onboard");
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), false);
});

// ---------------------------------------------------------------------
// Duplicate required event -> false
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — duplicate required event -> false, never silently accepted", () => {
  const events = [...fullChain(), { eventType: "arrived_at_pickup", occurredAt: "2026-11-01T15:01:00.000Z" }];
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), false);
});

// ---------------------------------------------------------------------
// Out-of-order event timestamps -> false, never silently re-sorted
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — out-of-order timestamps -> false", () => {
  // passenger_onboard occurs BEFORE arrived_at_pickup — violates the
  // required monotonic order even though every required type is present
  // exactly once.
  const events = fullChain({ passenger_onboard: "2026-11-01T14:55:00.000Z" });
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), false);
});

// ---------------------------------------------------------------------
// Unrelated event type ignored
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — unrelated event types (driver_assigned, note_added) never affect the result", () => {
  const events = [
    ...fullChain(),
    { eventType: "driver_assigned", occurredAt: "2026-11-01T14:00:00.000Z" },
    { eventType: "note_added", occurredAt: "2026-11-01T14:10:00.000Z" },
    { eventType: "driver_reassigned", occurredAt: "2026-11-01T14:20:00.000Z" },
  ];
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), true);
});

// ---------------------------------------------------------------------
// completed_at cross-check
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — trip_completed occurred_at not equal to trips.completed_at -> false", () => {
  const events = fullChain({ trip_completed: "2026-11-01T15:30:00.500Z" });
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), false);
});

test("evaluateLifecycleEventChain — completedAt null -> false (defensive, mirrors the S1B core's own independent integrity check)", () => {
  assert.equal(evaluateLifecycleEventChain(fullChain(), null), false);
});

test("evaluateLifecycleEventChain — empty event list -> false", () => {
  assert.equal(evaluateLifecycleEventChain([], COMPLETED_AT), false);
});

// ---------------------------------------------------------------------
// extractLifecycleEventTimestamps
// ---------------------------------------------------------------------

test("extractLifecycleEventTimestamps — complete chain returns every required timestamp", () => {
  const result = extractLifecycleEventTimestamps(fullChain());
  assert.equal(result.en_route_to_pickup, "2026-11-01T14:50:00.000Z");
  assert.equal(result.arrived_at_pickup, "2026-11-01T15:00:00.000Z");
  assert.equal(result.passenger_onboard, "2026-11-01T15:05:00.000Z");
  assert.equal(result.en_route_to_destination, "2026-11-01T15:10:00.000Z");
  assert.equal(result.arrived_at_destination, "2026-11-01T15:28:00.000Z");
  assert.equal(result.trip_completed, COMPLETED_AT);
});

test("extractLifecycleEventTimestamps — missing event -> null for that type, others unaffected", () => {
  const events = fullChain().filter((e) => e.eventType !== "passenger_onboard");
  const result = extractLifecycleEventTimestamps(events);
  assert.equal(result.passenger_onboard, null);
  assert.equal(result.arrived_at_pickup, "2026-11-01T15:00:00.000Z");
});

test("extractLifecycleEventTimestamps — duplicated event -> null for that type (never an arbitrary candidate)", () => {
  const events = [...fullChain(), { eventType: "arrived_at_pickup", occurredAt: "2026-11-01T15:01:00.000Z" }];
  const result = extractLifecycleEventTimestamps(events);
  assert.equal(result.arrived_at_pickup, null);
});

test("extractLifecycleEventTimestamps — unrelated event types never appear in the result", () => {
  const events = [...fullChain(), { eventType: "driver_assigned", occurredAt: "2026-11-01T14:00:00.000Z" }];
  const result = extractLifecycleEventTimestamps(events);
  assert.deepEqual(Object.keys(result).sort(), [
    "arrived_at_destination",
    "arrived_at_pickup",
    "en_route_to_destination",
    "en_route_to_pickup",
    "passenger_onboard",
    "trip_completed",
  ]);
});

// ---------------------------------------------------------------------
// classifyCompletionAssignmentCardinality
// ---------------------------------------------------------------------

test("classifyCompletionAssignmentCardinality — 0 rows -> 'none'", () => {
  assert.equal(classifyCompletionAssignmentCardinality(0), "none");
});

test("classifyCompletionAssignmentCardinality — 1 row -> 'one'", () => {
  assert.equal(classifyCompletionAssignmentCardinality(1), "one");
});

test("classifyCompletionAssignmentCardinality — 2 rows -> 'multiple'", () => {
  assert.equal(classifyCompletionAssignmentCardinality(2), "multiple");
});

test("classifyCompletionAssignmentCardinality — 5 rows -> 'multiple' (never silently picks one)", () => {
  assert.equal(classifyCompletionAssignmentCardinality(5), "multiple");
});

// ---------------------------------------------------------------------
// Stable ordering — result independent of input array order
// ---------------------------------------------------------------------

test("evaluateLifecycleEventChain — result is independent of the input array's own order", () => {
  const events = fullChain();
  const shuffled = [...events].reverse();
  assert.equal(evaluateLifecycleEventChain(events, COMPLETED_AT), evaluateLifecycleEventChain(shuffled, COMPLETED_AT));
  assert.equal(evaluateLifecycleEventChain(shuffled, COMPLETED_AT), true);
});
