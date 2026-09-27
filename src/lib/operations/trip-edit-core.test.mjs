// Unit tests for the pure Trip-correction policy (P1-PILOT-R2B, PR-01).
//   node --test src/lib/operations/trip-edit-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./trip-edit-core.ts");
const { editableFields, canEditTrip, isFieldEditable, tripEditBanner, changedFields, normalizeText, checkServiceDate, serviceDateMessage, tripEditFieldLabels, TRIP_EDIT_FIELDS } = core;
const { localDateKeyOf } = await import("./local-time-core.ts");

test("editableFields: the owner-approved lifecycle matrix, state by state", () => {
  assert.deepEqual([...editableFields("scheduled")], [...TRIP_EDIT_FIELDS]);
  assert.deepEqual([...editableFields("en_route_to_pickup")], [...TRIP_EDIT_FIELDS]);
  assert.deepEqual([...editableFields("arrived_at_pickup")], ["appointment_at", "destination_description", "destination_facility_id", "instructions", "assistance_notes"]);
  for (const s of ["passenger_onboard", "en_route_to_destination"]) {
    assert.deepEqual([...editableFields(s)], ["appointment_at", "destination_description", "destination_facility_id", "instructions"], s);
  }
  for (const s of ["arrived_at_destination", "completed", "cancelled", "no_show", "bogus"]) {
    assert.deepEqual([...editableFields(s)], [], s);
    assert.equal(canEditTrip(s), false, s);
  }
  assert.equal(isFieldEditable("arrived_at_pickup", "scheduled_pickup_at"), false);
  assert.equal(isFieldEditable("arrived_at_pickup", "pickup_description"), false);
  assert.equal(isFieldEditable("passenger_onboard", "assistance_notes"), false);
  assert.equal(isFieldEditable("en_route_to_destination", "destination_description"), true);
});

test("banners: en route + on board only; no database terminology", () => {
  assert.equal(tripEditBanner("en_route_to_pickup"), "The driver may already be on the way to pickup.");
  assert.equal(tripEditBanner("passenger_onboard"), "The passenger is on board. Changes are recorded as in-trip corrections.");
  assert.equal(tripEditBanner("en_route_to_destination"), "The passenger is on board. Changes are recorded as in-trip corrections.");
  assert.equal(tripEditBanner("scheduled"), null);
  assert.deepEqual(tripEditFieldLabels(["scheduled_pickup_at", "instructions", "nonsense"]), ["Pickup time", "Instructions"]);
});

const base = {
  scheduledPickupAt: "2026-10-01T14:00:00.000Z",
  appointmentAt: null,
  pickupDescription: "12 Main St",
  pickupFacilityId: null,
  destinationDescription: "Clinic",
  destinationFacilityId: null,
  instructions: null,
  assistanceNotes: "Walker",
};

test("changedFields: normalizes both sides (trim, blank -> null, same instant in another notation)", () => {
  assert.deepEqual(changedFields(base, { ...base }), []);
  assert.deepEqual(changedFields(base, { ...base, pickupDescription: "  12 Main St  ", instructions: "   ", scheduledPickupAt: "2026-10-01T10:00:00-04:00" }), []);
  assert.deepEqual(changedFields(base, { ...base, instructions: "Gate code 12" }), ["instructions"]);
  assert.deepEqual(changedFields(base, { ...base, assistanceNotes: "" }), ["assistance_notes"]);
  assert.deepEqual(changedFields(base, { ...base, scheduledPickupAt: "2026-10-01T15:00:00.000Z", destinationFacilityId: "f1" }), ["scheduled_pickup_at", "destination_facility_id"]);
  assert.equal(normalizeText("  x "), "x");
  assert.equal(normalizeText(" "), null);
});

const NY = "America/New_York";
const check = (state, cur, next, recurringTimezone = null) =>
  checkServiceDate({ state, currentPickupAt: cur, proposedPickupAt: next, organizationTimezone: NY, recurringTimezone, localDateKeyOf });

test("service date: en_route_to_pickup may move the TIME within the same organization-local date only", () => {
  // 2026-10-01 10:00 NY = 14:00Z. 23:30 NY the same day = 03:30Z next UTC day -- still the same LOCAL date.
  assert.equal(check("en_route_to_pickup", "2026-10-01T14:00:00Z", "2026-10-02T03:30:00Z"), "ok");
  assert.equal(check("en_route_to_pickup", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z"), "en_route_date_change");
  assert.equal(check("scheduled", "2026-10-01T14:00:00Z", "2026-10-05T14:00:00Z"), "ok", "a scheduled trip may change date");
  assert.equal(check("en_route_to_pickup", null, "2026-10-05T14:00:00Z"), "ok", "a first pickup has no date to keep");
  assert.match(serviceDateMessage("en_route_date_change"), /pickup date can't change/);
});

test("service date: recurring occurrence keeps its ARRANGEMENT-local date in every state; DST day handled by the real timezone", () => {
  assert.equal(check("scheduled", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", NY), "recurring_date_change");
  assert.equal(check("scheduled", "2026-10-01T14:00:00Z", "2026-10-01T20:00:00Z", NY), "ok");
  // Fall-back day 2026-11-01 (NY): 00:30 EDT (04:30Z) and 23:30 EST (04:30Z next day) are the SAME local date.
  assert.equal(check("scheduled", "2026-11-01T04:30:00Z", "2026-11-02T04:30:00Z", NY), "ok");
  assert.match(serviceDateMessage("recurring_date_change"), /keeps its date/);
  assert.equal(serviceDateMessage("ok"), null);
});
