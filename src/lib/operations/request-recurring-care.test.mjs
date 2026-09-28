// P1-PILOT-R3 (PR-04) -- Request -> Recurring Care: readiness, actions, structured prefill. Run with:
//
//   node --test src/lib/operations/request-recurring-care.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { deriveRequestReadiness, deriveRequestActions } = await import("./request-readiness-core.ts");
const { buildRecurringPrefill, hasRecurringIntent, isReadyForRecurringCare, isReturnTripExpected, RETURN_TRIP_HINT_TITLE, RETURN_TRIP_HINT_BODY } =
  await import("./request-recurring-prefill-core.ts");
const { requestReadinessLabel } = await import("./presentation.ts");

const base = { state: "accepted", passengerId: "p1", passengerActive: true, hasLinkedTrips: false };

// ------------------------------------------------------------------------------------------------ readiness
test("readiness: a linked arrangement -> arrangement_created ('Recurring care created')", () => {
  assert.equal(deriveRequestReadiness({ ...base, hasLinkedArrangement: true }), "arrangement_created");
  assert.equal(requestReadinessLabel("arrangement_created"), "Recurring care created");
});

test("readiness: Trip + arrangement -> arrangement_created (precedence); cancelled-only Trips + arrangement too", () => {
  assert.equal(deriveRequestReadiness({ ...base, hasLinkedTrips: true, hasActiveTrips: true, hasLinkedArrangement: true }), "arrangement_created");
  assert.equal(deriveRequestReadiness({ ...base, hasLinkedTrips: true, hasActiveTrips: false, hasLinkedArrangement: true }), "arrangement_created");
});

test("readiness: without an arrangement, the R2B values are unchanged", () => {
  assert.equal(deriveRequestReadiness(base), "ready");
  assert.equal(deriveRequestReadiness({ ...base, hasLinkedTrips: true, hasActiveTrips: true }), "trip_created");
  assert.equal(deriveRequestReadiness({ ...base, hasLinkedTrips: true, hasActiveTrips: false }), "trip_cancelled");
  assert.equal(deriveRequestReadiness({ ...base, passengerId: null }), "needs_passenger");
});

test("readiness: declined / cancelled stay not_convertible even with an arrangement; pending unaffected", () => {
  for (const state of ["declined", "cancelled"]) {
    assert.equal(deriveRequestReadiness({ ...base, state, hasLinkedArrangement: true }), "not_convertible", state);
  }
  assert.equal(deriveRequestReadiness({ ...base, state: "pending" }), "awaiting_decision");
});

// ------------------------------------------------------------------------------------------------ actions
test("actions: Create recurring arrangement only for accepted + active Passenger + structured intent (or an existing arrangement)", () => {
  assert.equal(deriveRequestActions({ ...base, hasRecurringIntent: true }).canCreateRecurringArrangement, true);
  assert.equal(deriveRequestActions({ ...base, hasRecurringIntent: false }).canCreateRecurringArrangement, false, "no structured intent");
  assert.equal(deriveRequestActions({ ...base, hasRecurringIntent: false, hasLinkedArrangement: true }).canCreateRecurringArrangement, true, "create another");
  assert.equal(deriveRequestActions({ ...base, state: "pending", hasRecurringIntent: true }).canCreateRecurringArrangement, false, "pending");
  assert.equal(deriveRequestActions({ ...base, passengerId: null, hasRecurringIntent: true }).canCreateRecurringArrangement, false, "no passenger");
  assert.equal(deriveRequestActions({ ...base, passengerActive: false, hasRecurringIntent: true }).canCreateRecurringArrangement, false, "inactive passenger");
  assert.equal(deriveRequestActions({ ...base, state: "declined", hasRecurringIntent: true }).canCreateRecurringArrangement, false, "declined");
});

test("actions: Create Trip stays available beside recurring conversion; cancel / relink are blocked once an arrangement exists", () => {
  const withIntent = deriveRequestActions({ ...base, hasRecurringIntent: true });
  assert.equal(withIntent.canCreateTrip, true);
  const withArrangement = deriveRequestActions({ ...base, hasRecurringIntent: true, hasLinkedArrangement: true });
  assert.equal(withArrangement.canCreateTrip, true);
  assert.equal(withArrangement.canCancel, false);
  assert.equal(withArrangement.cancelBlockedByArrangement, true);
  assert.equal(withArrangement.canLinkPassenger, false);
  const plain = deriveRequestActions(base);
  assert.equal(plain.canCancel, true);
  assert.equal(plain.cancelBlockedByArrangement, false);
});

// ------------------------------------------------------------------------------------------------ prefill
const request = {
  state: "accepted",
  passenger: { id: "p1", status: "active" },
  pickupDescription: "12 Oak Street",
  destinationDescription: "Cascade Dialysis",
  serviceType: "dialysis",
  returnTripNeeded: "no",
  assistanceNotes: "Uses a wheelchair at home",
  additionalNotes: "wheelchair please",
  recurringSchedule: { daysOfWeek: [1, 3, 5], startDate: "2026-10-05", endDate: "2026-12-31", appointmentTime: "10:00:00", returnTripExpected: false },
};

test("prefill: structured facts only; pickup time EMPTY; appointment is context only", () => {
  const p = buildRecurringPrefill("r1", request);
  assert.deepEqual(p, {
    requestId: "r1",
    passengerId: "p1",
    pickupDescription: "12 Oak Street",
    destinationDescription: "Cascade Dialysis",
    pickupTime: "",
    daysOfWeek: [1, 3, 5],
    startDate: "2026-10-05",
    endDate: "2026-12-31",
    wheelchair: "unspecified",
    appointmentTime: "10:00",
    returnTripExpected: false,
  });
  assert.equal(p.pickupTime, "", "never the appointment, never an offset of it");
});

test("prefill: wheelchair Yes ONLY for service_type wheelchair_transportation; free-text mentions never set it", () => {
  assert.equal(buildRecurringPrefill("r1", { ...request, serviceType: "wheelchair_transportation" }).wheelchair, "yes");
  assert.equal(buildRecurringPrefill("r1", request).wheelchair, "unspecified", "wheelchair only in notes");
  assert.equal(buildRecurringPrefill("r1", { ...request, serviceType: null }).wheelchair, "unspecified");
  assert.doesNotMatch(JSON.stringify(buildRecurringPrefill("r1", request)), /Uses a wheelchair|please/, "no free text copied");
});

test("prefill: return expectation from either structured field; hint copy", () => {
  assert.equal(buildRecurringPrefill("r1", { ...request, returnTripNeeded: "yes" }).returnTripExpected, true);
  assert.equal(
    buildRecurringPrefill("r1", { ...request, recurringSchedule: { ...request.recurringSchedule, returnTripExpected: true } }).returnTripExpected,
    true,
  );
  assert.equal(isReturnTripExpected({ returnTripNeeded: "not_sure", recurringSchedule: null }), false);
  assert.equal(RETURN_TRIP_HINT_TITLE, "Return trip expected");
  assert.equal(RETURN_TRIP_HINT_BODY, "This arrangement covers one recurring schedule. Create another arrangement if the return needs its own schedule.");
  // addresses are never swapped for a "return" prefill
  const p = buildRecurringPrefill("r1", { ...request, returnTripNeeded: "yes" });
  assert.equal(p.pickupDescription, "12 Oak Street");
});

test("prefill: not ready (pending / declined / no or inactive Passenger) -> null; intent detection", () => {
  assert.equal(buildRecurringPrefill("r1", { ...request, state: "pending" }), null);
  assert.equal(buildRecurringPrefill("r1", { ...request, state: "declined" }), null);
  assert.equal(buildRecurringPrefill("r1", { ...request, passenger: null }), null);
  assert.equal(buildRecurringPrefill("r1", { ...request, passenger: { id: "p1", status: "inactive" } }), null);
  assert.equal(isReadyForRecurringCare(request), true);
  assert.equal(hasRecurringIntent(request), true);
  assert.equal(hasRecurringIntent({ recurringSchedule: null }), false);
  // an accepted one-time Request can still be prefilled if the operator chooses (the database does not require intent)
  const oneTime = buildRecurringPrefill("r1", { ...request, recurringSchedule: null });
  assert.deepEqual([oneTime.daysOfWeek, oneTime.startDate, oneTime.endDate, oneTime.appointmentTime], [[], "", "", null]);
});
