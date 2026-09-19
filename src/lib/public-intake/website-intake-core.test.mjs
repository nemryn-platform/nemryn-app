// Focused unit tests for the pure public tenant-website intake helpers
// (P1-PILOT-S4A). Run with:
//
//   node --test src/lib/public-intake/website-intake-core.test.mjs
//
// Tests the pure module only, which has no runtime import of any kind,
// matching operations-brief-core.test.mjs's/recurring-care-bulk-
// core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { validateWebsiteIntakePayload, publicIntakeErrorMessage, requestProvenanceLabel, SERVICE_TYPE_LABELS, formatRecurringDaysOfWeek } =
  await import("./website-intake-core.ts");

function validPayload(overrides = {}) {
  return {
    integrationExternalId: "acme-clinic-website",
    idempotencyKey: "11111111-1111-1111-1111-111111111111",
    requesterName: "Jordan Rivera",
    requesterRelationship: "self",
    requesterPhone: "555-0100",
    pickupDescription: "123 Main St",
    destinationDescription: "456 Oak Ave",
    returnTripNeeded: "no",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A. VALID PAYLOADS
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — minimal valid payload (only required fields) -> ok", () => {
  const result = validateWebsiteIntakePayload(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.value.requesterName, "Jordan Rivera");
  assert.equal(result.value.requesterEmail, null);
  assert.equal(result.value.preferredDate, null);
  assert.equal(result.value.preferredTime, null);
  assert.equal(result.value.assistanceNotes, null);
  assert.equal(result.value.additionalNotes, null);
});

test("validateWebsiteIntakePayload — full valid payload with every optional field -> ok, trimmed", () => {
  const result = validateWebsiteIntakePayload(
    validPayload({
      requesterEmail: "  jordan@example.test  ",
      preferredDate: "2026-10-01",
      preferredTime: "09:30",
      assistanceNotes: "  Needs a wheelchair-accessible vehicle  ",
      additionalNotes: "Prefers morning appointments",
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.requesterEmail, "jordan@example.test");
  assert.equal(result.value.preferredDate, "2026-10-01");
  assert.equal(result.value.preferredTime, "09:30");
  assert.equal(result.value.assistanceNotes, "Needs a wheelchair-accessible vehicle");
});

test("validateWebsiteIntakePayload — leading/trailing whitespace trimmed on required fields", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterName: "  Jordan Rivera  " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requesterName, "Jordan Rivera");
});

// ---------------------------------------------------------------------
// B. MISSING / BLANK REQUIRED FIELDS
// ---------------------------------------------------------------------

for (const field of [
  "integrationExternalId",
  "idempotencyKey",
  "requesterName",
  "requesterRelationship",
  "requesterPhone",
  "pickupDescription",
  "destinationDescription",
  "returnTripNeeded",
]) {
  test(`validateWebsiteIntakePayload — missing required field "${field}" -> invalid_request`, () => {
    const payload = validPayload();
    delete payload[field];
    const result = validateWebsiteIntakePayload(payload);
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_request");
  });

  test(`validateWebsiteIntakePayload — blank/whitespace-only "${field}" -> invalid_request`, () => {
    const payload = validPayload({ [field]: "   " });
    const result = validateWebsiteIntakePayload(payload);
    assert.equal(result.ok, false);
  });
}

// ---------------------------------------------------------------------
// C. ENUM VALIDATION
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — invalid requesterRelationship -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterRelationship: "neighbor" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — every real requesterRelationship value accepted", () => {
  for (const value of ["self", "family", "caregiver", "facility_coordinator", "other"]) {
    const result = validateWebsiteIntakePayload(validPayload({ requesterRelationship: value }));
    assert.equal(result.ok, true, `expected ${value} to be accepted`);
  }
});

test("validateWebsiteIntakePayload — invalid returnTripNeeded -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ returnTripNeeded: "maybe" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — every real returnTripNeeded value accepted", () => {
  for (const value of ["yes", "no", "not_sure"]) {
    const result = validateWebsiteIntakePayload(validPayload({ returnTripNeeded: value }));
    assert.equal(result.ok, true, `expected ${value} to be accepted`);
  }
});

// ---------------------------------------------------------------------
// D. LENGTH BOUNDS
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — requesterName over 200 chars -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterName: "x".repeat(201) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — requesterName exactly 200 chars -> ok", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterName: "x".repeat(200) }));
  assert.equal(result.ok, true);
});

test("validateWebsiteIntakePayload — pickupDescription over 2000 chars -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ pickupDescription: "x".repeat(2001) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — assistanceNotes over 4000 chars -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ assistanceNotes: "x".repeat(4001) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — requesterEmail over 320 chars -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterEmail: "x".repeat(321) }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------
// E. TYPE / SHAPE REJECTION
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — null payload -> invalid_request", () => {
  assert.equal(validateWebsiteIntakePayload(null).ok, false);
});

test("validateWebsiteIntakePayload — array payload -> invalid_request", () => {
  assert.equal(validateWebsiteIntakePayload([]).ok, false);
});

test("validateWebsiteIntakePayload — string payload -> invalid_request", () => {
  assert.equal(validateWebsiteIntakePayload("not an object").ok, false);
});

test("validateWebsiteIntakePayload — numeric requesterName -> invalid_request (wrong type)", () => {
  const result = validateWebsiteIntakePayload(validPayload({ requesterName: 12345 }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — malformed preferredDate -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ preferredDate: "10/01/2026" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — malformed preferredTime -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ preferredTime: "9:30am" }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------
// F. UNEXPECTED PROPERTIES — the "closed field set" guarantee
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — unexpected top-level key -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ extraField: "surprise" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — an attempt to smuggle organizationId is rejected, never silently ignored", () => {
  const result = validateWebsiteIntakePayload(validPayload({ organizationId: "10000000-0000-0000-0000-0000000000b1" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — an attempt to smuggle passengerId is rejected, never silently ignored", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerId: "40000000-0000-0000-0000-0000000000a1" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — an attempt to smuggle state is rejected, never silently ignored", () => {
  const result = validateWebsiteIntakePayload(validPayload({ state: "accepted" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — an attempt to smuggle source is rejected (source is always hard-coded server-side)", () => {
  const result = validateWebsiteIntakePayload(validPayload({ source: "phone" }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------
// G. SAFE ERROR MESSAGE — no raw internals ever
// ---------------------------------------------------------------------

test("publicIntakeErrorMessage — never contains a ZW code, SQL, or stack-trace shape", () => {
  const message = publicIntakeErrorMessage("invalid_request");
  assert.equal(/ZW\d{3}|SQLSTATE|PGRST|at Object\.|\.tsx:\d+/i.test(message), false);
  assert.equal(typeof message, "string");
  assert.ok(message.length > 0);
});

// ---------------------------------------------------------------------
// H. REQUEST HUB PROVENANCE LABEL
// ---------------------------------------------------------------------

test("requestProvenanceLabel — null intakeIntegrationId -> null (no badge for staff-entered Requests)", () => {
  assert.equal(requestProvenanceLabel(null), null);
});

test("requestProvenanceLabel — non-null intakeIntegrationId -> 'Website'", () => {
  assert.equal(requestProvenanceLabel("30000000-0000-0000-0000-0000000000a1"), "Website");
});

// ---------------------------------------------------------------------
// I. SERVICE TYPE (P1-PILOT-S4B-R2)
// ---------------------------------------------------------------------

const SERVICE_TYPES = [
  "medical_appointment",
  "dialysis",
  "rehabilitation",
  "hospital_discharge",
  "recurring_care",
  "senior_medical",
  "wheelchair_transportation",
  "other",
];

for (const value of SERVICE_TYPES) {
  test(`validateWebsiteIntakePayload — serviceType "${value}" is accepted`, () => {
    const result = validateWebsiteIntakePayload(validPayload({ serviceType: value }));
    assert.equal(result.ok, true);
    assert.equal(result.value.serviceType, value);
  });
}

test("validateWebsiteIntakePayload — missing serviceType is accepted (optional, backward compatible)", () => {
  const result = validateWebsiteIntakePayload(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.value.serviceType, null);
});

test("validateWebsiteIntakePayload — null serviceType is accepted, normalized to null", () => {
  const result = validateWebsiteIntakePayload(validPayload({ serviceType: null }));
  assert.equal(result.ok, true);
  assert.equal(result.value.serviceType, null);
});

test("validateWebsiteIntakePayload — unknown serviceType value -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ serviceType: "not_a_real_service" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — wrong-type serviceType (number) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ serviceType: 123 }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — organizationId injection is still rejected even alongside a valid serviceType", () => {
  const result = validateWebsiteIntakePayload(validPayload({ serviceType: "dialysis", organizationId: "some-org-id" }));
  assert.equal(result.ok, false);
});

test("SERVICE_TYPE_LABELS — has a human-readable label for every allowed value", () => {
  for (const value of SERVICE_TYPES) {
    assert.equal(typeof SERVICE_TYPE_LABELS[value], "string");
    assert.ok(SERVICE_TYPE_LABELS[value].length > 0);
  }
});

// ---------------------------------------------------------------------
// J. RECURRING SCHEDULE (P1-PILOT-S4B-R2)
// ---------------------------------------------------------------------

function validRecurring(overrides = {}) {
  return {
    daysOfWeek: ["monday"],
    startDate: "2026-10-01",
    ...overrides,
  };
}

test("validateWebsiteIntakePayload — absent recurringSchedule -> null (one-time request, unchanged default)", () => {
  const result = validateWebsiteIntakePayload(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule, null);
});

test("validateWebsiteIntakePayload — null recurringSchedule -> null", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: null }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule, null);
});

test("validateWebsiteIntakePayload — one weekday -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ daysOfWeek: ["monday"] }) }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recurringSchedule.daysOfWeek, ["monday"]);
});

test("validateWebsiteIntakePayload — multiple weekdays -> accepted, canonically ordered", () => {
  const result = validateWebsiteIntakePayload(
    validPayload({ recurringSchedule: validRecurring({ daysOfWeek: ["friday", "monday", "wednesday"] }) }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recurringSchedule.daysOfWeek, ["monday", "wednesday", "friday"]);
});

test("validateWebsiteIntakePayload — all seven weekdays -> accepted", () => {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ daysOfWeek: days }) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.daysOfWeek.length, 7);
});

test("validateWebsiteIntakePayload — duplicate weekday -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ daysOfWeek: ["monday", "monday"] }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — invalid weekday string -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ daysOfWeek: ["someday"] }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — empty daysOfWeek array -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ daysOfWeek: [] }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — recurringSchedule as an array (invalid object type) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: ["monday"] }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — recurringSchedule as a string (invalid object type) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: "monday" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — recurringSchedule with an unknown key -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ extraField: "nope" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — a genuinely tampered protected field inside recurringSchedule is still rejected", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ organizationId: "some-org-id" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — valid startDate -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ startDate: "2026-10-01" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.startDate, "2026-10-01");
});

test("validateWebsiteIntakePayload — impossible calendar date (Feb 30) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ startDate: "2026-02-30" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — impossible calendar date (month 13) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ startDate: "2026-13-01" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — endDate before startDate -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(
    validPayload({ recurringSchedule: validRecurring({ startDate: "2026-10-10", endDate: "2026-10-01" }) }),
  );
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — endDate equal to startDate -> accepted", () => {
  const result = validateWebsiteIntakePayload(
    validPayload({ recurringSchedule: validRecurring({ startDate: "2026-10-01", endDate: "2026-10-01" }) }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.endDate, "2026-10-01");
});

test("validateWebsiteIntakePayload — endDate after startDate -> accepted", () => {
  const result = validateWebsiteIntakePayload(
    validPayload({ recurringSchedule: validRecurring({ startDate: "2026-10-01", endDate: "2026-12-01" }) }),
  );
  assert.equal(result.ok, true);
});

test("validateWebsiteIntakePayload — missing startDate -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: { daysOfWeek: ["monday"] } }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — valid 24-hour appointmentTime -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ appointmentTime: "09:15" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.appointmentTime, "09:15");
});

test("validateWebsiteIntakePayload — invalid appointmentTime (25:00) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ appointmentTime: "25:00" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — invalid appointmentTime (12:60) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ appointmentTime: "12:60" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — strict boolean returnTripExpected=true -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ returnTripExpected: true }) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.returnTripExpected, true);
});

test("validateWebsiteIntakePayload — strict boolean returnTripExpected=false -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ returnTripExpected: false }) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.recurringSchedule.returnTripExpected, false);
});

test("validateWebsiteIntakePayload — non-boolean returnTripExpected (string 'true') -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ returnTripExpected: "true" }) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — non-boolean returnTripExpected (number 1) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ recurringSchedule: validRecurring({ returnTripExpected: 1 }) }));
  assert.equal(result.ok, false);
});

test("formatRecurringDaysOfWeek — renders canonical ISO weekday numbers as short labels", () => {
  assert.equal(formatRecurringDaysOfWeek([1, 3, 5]), "Mon, Wed, Fri");
  assert.equal(formatRecurringDaysOfWeek([1, 2, 3, 4, 5, 6, 7]), "Mon, Tue, Wed, Thu, Fri, Sat, Sun");
});

// ---------------------------------------------------------------------
// K. REQUESTED PASSENGER NAME (P1-PILOT-S4B-R2A)
// ---------------------------------------------------------------------

test("validateWebsiteIntakePayload — absent passengerName -> null (backward compatible)", () => {
  const result = validateWebsiteIntakePayload(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName, null);
});

test("validateWebsiteIntakePayload — null passengerName -> null", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: null }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName, null);
});

test("validateWebsiteIntakePayload — valid passengerName is accepted and trimmed", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "  PILOT PASSENGER QA  " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName, "PILOT PASSENGER QA");
});

test("validateWebsiteIntakePayload — empty-string passengerName normalizes to null (matches requesterEmail/additionalNotes' own optional-string convention)", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "" }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName, null);
});

test("validateWebsiteIntakePayload — whitespace-only passengerName normalizes to null", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "   " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName, null);
});

test("validateWebsiteIntakePayload — wrong-type passengerName (number) -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: 12345 }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — passengerName over 200 chars -> invalid_request", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "x".repeat(201) }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — passengerName exactly 200 chars -> accepted", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "x".repeat(200) }));
  assert.equal(result.ok, true);
  assert.equal(result.value.requestedPassengerName.length, 200);
});

test("validateWebsiteIntakePayload — passengerName never affects passenger_id/protected-field rejection: organizationId injection alongside a valid passengerName is still rejected", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "PILOT PASSENGER QA", organizationId: "some-org-id" }));
  assert.equal(result.ok, false);
});

test("validateWebsiteIntakePayload — a direct attempt to smuggle passengerId (the entity FK, not the name snapshot) is rejected, never silently ignored", () => {
  const result = validateWebsiteIntakePayload(validPayload({ passengerName: "PILOT PASSENGER QA", passengerId: "10000000-0000-0000-0000-000000000000" }));
  assert.equal(result.ok, false);
});
