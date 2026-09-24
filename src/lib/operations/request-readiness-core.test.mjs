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

const { deriveRequestReadiness, deriveRequestActions } = await import("./request-readiness-core.ts");

const base = { passengerId: null, passengerActive: false, hasLinkedTrips: false };
const linked = { passengerId: "passenger-1", passengerActive: true, hasLinkedTrips: false };

test("readiness — pending + no passenger -> needs_passenger", () => {
  assert.equal(deriveRequestReadiness({ ...base, state: "pending" }), "needs_passenger");
});

test("readiness — pending + active passenger -> awaiting_decision (never ready: a pending Request cannot become a Trip)", () => {
  assert.equal(deriveRequestReadiness({ ...linked, state: "pending" }), "awaiting_decision");
});

test("readiness — pending + INACTIVE linked passenger -> needs_passenger", () => {
  assert.equal(deriveRequestReadiness({ ...linked, passengerActive: false, state: "pending" }), "needs_passenger");
});

test("readiness — accepted + no passenger -> needs_passenger (H)", () => {
  assert.equal(deriveRequestReadiness({ ...base, state: "accepted" }), "needs_passenger");
});

test("readiness — accepted + active passenger + no trip -> ready (I)", () => {
  assert.equal(deriveRequestReadiness({ ...linked, state: "accepted" }), "ready");
});

test("readiness — accepted + inactive passenger -> needs_passenger", () => {
  assert.equal(deriveRequestReadiness({ ...linked, passengerActive: false, state: "accepted" }), "needs_passenger");
});

test("readiness — accepted + trips -> trip_created", () => {
  assert.equal(deriveRequestReadiness({ ...linked, hasLinkedTrips: true, state: "accepted" }), "trip_created");
});

test("readiness — declined/cancelled -> not_convertible regardless of passenger/trips", () => {
  assert.equal(deriveRequestReadiness({ ...linked, state: "declined" }), "not_convertible");
  assert.equal(deriveRequestReadiness({ ...linked, hasLinkedTrips: true, state: "cancelled" }), "not_convertible");
});

test("readiness — unknown state is never ready", () => {
  assert.equal(deriveRequestReadiness({ ...linked, state: "some_future_state" }), "awaiting_decision");
  assert.equal(deriveRequestReadiness({ ...base, state: "some_future_state" }), "needs_passenger");
});

test("actions — pending: Accept + Decline, never Cancel, never Create Trip (B/C/D/V)", () => {
  const a = deriveRequestActions({ ...linked, state: "pending" });
  assert.deepEqual(a, {
    canAccept: true, canDecline: true, canCancel: false, cancelBlockedByTrips: false,
    canCreateTrip: false, canCreateAnotherTrip: false, canLinkPassenger: true,
  });
});

test("actions — accepted, no passenger: Cancel + link, no Create Trip, no Accept/Decline", () => {
  const a = deriveRequestActions({ ...base, state: "accepted" });
  assert.deepEqual(a, {
    canAccept: false, canDecline: false, canCancel: true, cancelBlockedByTrips: false,
    canCreateTrip: false, canCreateAnotherTrip: false, canLinkPassenger: true,
  });
});

test("actions — accepted + ready: Create Trip + Cancel", () => {
  const a = deriveRequestActions({ ...linked, state: "accepted" });
  assert.equal(a.canCreateTrip, true);
  assert.equal(a.canCancel, true);
  assert.equal(a.canCreateAnotherTrip, false);
});

test("actions — accepted with trips: cancel blocked (N), Create Another Trip, passenger frozen", () => {
  const a = deriveRequestActions({ ...linked, hasLinkedTrips: true, state: "accepted" });
  assert.equal(a.canCancel, false);
  assert.equal(a.cancelBlockedByTrips, true);
  assert.equal(a.canCreateTrip, false);
  assert.equal(a.canCreateAnotherTrip, true);
  assert.equal(a.canLinkPassenger, false);
});

test("actions — declined/cancelled are terminal: no action at all (O/P)", () => {
  for (const state of ["declined", "cancelled"]) {
    const a = deriveRequestActions({ ...linked, state });
    assert.ok(Object.values(a).every((v) => v === false), state);
  }
});
