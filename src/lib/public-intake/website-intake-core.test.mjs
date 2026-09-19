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

const { validateWebsiteIntakePayload, publicIntakeErrorMessage, requestProvenanceLabel } = await import("./website-intake-core.ts");

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
