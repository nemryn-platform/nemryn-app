// Focused unit tests for the pure Organization Settings helpers
// (P1-PILOT-S4B-R4A). Run with:
//
//   node --test src/lib/operations/organization-settings-core.test.mjs
//
// Pure module, no runtime imports -- same pattern as
// recurring-care-bulk-core.test.mjs. The database
// (update_organization_settings) is the authority; these pin the friendly
// first-line validation and that it stays in step with the DB limits.

import test from "node:test";
import assert from "node:assert/strict";

const { validateOrganizationSettings, toSettingsPatch, timezoneOptionsFor, TIMEZONE_OPTIONS, ORGANIZATION_SETTINGS_LIMITS } =
  await import("./organization-settings-core.ts");

const valid = {
  name: "Harmony Medical Transport",
  timezone: "America/New_York",
  businessPhone: "(404) 555-0100",
  businessEmail: "Dispatch@Harmony.example",
  businessAddress: "1 Test Way\nAtlanta, GA 30301",
  primaryContactName: "Pat Operator",
};

test("valid input normalizes: trims, lowercases email", () => {
  const result = validateOrganizationSettings({ ...valid, name: "  Harmony Medical Transport  ", businessEmail: " Dispatch@Harmony.example " });
  assert.equal(result.ok, true);
  assert.equal(result.values.name, "Harmony Medical Transport");
  assert.equal(result.values.businessEmail, "dispatch@harmony.example");
});

test("optional fields may be blank", () => {
  const result = validateOrganizationSettings({ ...valid, businessPhone: "", businessEmail: "", businessAddress: "", primaryContactName: "" });
  assert.equal(result.ok, true);
});

test("name is required and bounded", () => {
  assert.equal(validateOrganizationSettings({ ...valid, name: "   " }).ok, false);
  assert.ok(validateOrganizationSettings({ ...valid, name: "   " }).fieldErrors.name);
  assert.equal(validateOrganizationSettings({ ...valid, name: "n".repeat(ORGANIZATION_SETTINGS_LIMITS.name) }).ok, true);
  assert.ok(validateOrganizationSettings({ ...valid, name: "n".repeat(ORGANIZATION_SETTINGS_LIMITS.name + 1) }).fieldErrors.name);
});

test("timezone is required", () => {
  assert.ok(validateOrganizationSettings({ ...valid, timezone: "" }).fieldErrors.timezone);
});

test("email must look like an email when present", () => {
  for (const bad of ["not-an-email", "a@b", "a b@c.d", "@c.d"]) {
    assert.ok(validateOrganizationSettings({ ...valid, businessEmail: bad }).fieldErrors?.businessEmail, bad);
  }
});

test("phone needs 7-20 digits when present", () => {
  for (const bad of ["123", "call me", "1".repeat(21)]) {
    assert.ok(validateOrganizationSettings({ ...valid, businessPhone: bad }).fieldErrors?.businessPhone, bad);
  }
  for (const good of ["4045550100", "(404) 555-0100", "+1 404 555 0100 x22"]) {
    assert.equal(validateOrganizationSettings({ ...valid, businessPhone: good }).ok, true, good);
  }
});

test("address and contact name are bounded", () => {
  assert.ok(validateOrganizationSettings({ ...valid, businessAddress: "a".repeat(501) }).fieldErrors.businessAddress);
  assert.ok(validateOrganizationSettings({ ...valid, primaryContactName: "a".repeat(201) }).fieldErrors.primaryContactName);
});

test("patch uses the database's snake_case keys and includes every editable field", () => {
  assert.deepEqual(Object.keys(toSettingsPatch(valid)).sort(), [
    "business_address",
    "business_email",
    "business_phone",
    "name",
    "primary_contact_name",
    "timezone",
  ]);
});

test("patch can never carry a privileged or tenancy key", () => {
  const keys = Object.keys(toSettingsPatch(valid));
  for (const forbidden of ["id", "organization_id", "status", "business_stage", "user_id", "role"]) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});

test("timezone options always contain the current value, never duplicate it", () => {
  assert.equal(timezoneOptionsFor("America/New_York"), TIMEZONE_OPTIONS);
  const unusual = timezoneOptionsFor("Europe/London");
  assert.equal(unusual[0].value, "Europe/London");
  assert.equal(unusual.length, TIMEZONE_OPTIONS.length + 1);
});

test("timezone options are IANA Area/Location values only (no offsets or abbreviations)", () => {
  for (const option of TIMEZONE_OPTIONS) {
    assert.match(option.value, /^[A-Za-z]+\/[A-Za-z_]+$/);
  }
});
