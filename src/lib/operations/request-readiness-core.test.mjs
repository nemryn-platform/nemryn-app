// Focused unit tests for the pure Request readiness derivation helper
// (P1-E1-S2D). Run with:
//
//   node --test src/lib/operations/request-readiness-core.test.mjs
//
// Deliberately tests the pure core module only
// (request-readiness-core.ts), which has no runtime import of any kind,
// matching operations-brief-core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { deriveRequestReadiness } = await import("./request-readiness-core.ts");

test("deriveRequestReadiness — pending + active linked passenger -> ready", () => {
  assert.equal(
    deriveRequestReadiness({ state: "pending", passengerId: "passenger-1", passengerActive: true }),
    "ready",
  );
});

test("deriveRequestReadiness — pending + null passenger -> needs_passenger", () => {
  assert.equal(
    deriveRequestReadiness({ state: "pending", passengerId: null, passengerActive: false }),
    "needs_passenger",
  );
});

test("deriveRequestReadiness — pending + linked but INACTIVE passenger -> needs_passenger (never ready merely because passengerId is set)", () => {
  assert.equal(
    deriveRequestReadiness({ state: "pending", passengerId: "passenger-1", passengerActive: false }),
    "needs_passenger",
  );
});

test("deriveRequestReadiness — accepted -> accepted (never 'ready', never 'needs review')", () => {
  assert.equal(
    deriveRequestReadiness({ state: "accepted", passengerId: "passenger-1", passengerActive: true }),
    "accepted",
  );
});

test("deriveRequestReadiness — accepted with no linked passenger is still 'accepted', not 'needs_passenger' (accepted means a Trip already has its own passenger_id — this Request-level field no longer gates anything)", () => {
  assert.equal(
    deriveRequestReadiness({ state: "accepted", passengerId: null, passengerActive: false }),
    "accepted",
  );
});

test("deriveRequestReadiness — declined -> not_convertible", () => {
  assert.equal(
    deriveRequestReadiness({ state: "declined", passengerId: "passenger-1", passengerActive: true }),
    "not_convertible",
  );
});

test("deriveRequestReadiness — cancelled -> not_convertible", () => {
  assert.equal(
    deriveRequestReadiness({ state: "cancelled", passengerId: null, passengerActive: false }),
    "not_convertible",
  );
});

test("deriveRequestReadiness — declined with an active linked passenger is STILL not_convertible (state gates before passenger check, matching create_trip's own state-first validation order)", () => {
  assert.equal(
    deriveRequestReadiness({ state: "declined", passengerId: "passenger-1", passengerActive: true }),
    "not_convertible",
  );
});

test("deriveRequestReadiness — unrecognized/unexpected state falls through to the same passenger-gated logic as pending, never silently 'ready'", () => {
  assert.equal(
    deriveRequestReadiness({ state: "some_future_state", passengerId: null, passengerActive: false }),
    "needs_passenger",
  );
  assert.equal(
    deriveRequestReadiness({ state: "some_future_state", passengerId: "passenger-1", passengerActive: true }),
    "ready",
  );
});

test("deriveRequestReadiness — never returns a numeric score or anything outside the 4 closed states", () => {
  const result = deriveRequestReadiness({ state: "pending", passengerId: "p1", passengerActive: true });
  assert.equal(typeof result, "string");
  assert.ok(["ready", "needs_passenger", "not_convertible", "accepted"].includes(result));
});
