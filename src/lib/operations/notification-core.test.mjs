// Focused unit tests for pure Notifications helpers (P1-PILOT-S4B-R4D).
//   node --test src/lib/operations/notification-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { NOTIFICATION_EVENT_VALUES, NOTIFICATION_EVENT_OPTIONS, NOTIFICATION_ROLE_VALUES, notificationEventLabel, isNotificationEvent, validateRoleSelection, describeRecipients, deliveryStatusLabel, deliveryStatusTone } =
  await import("./notification-core.ts");

test("only events Nemryn can genuinely fire are offered", () => {
  assert.deepEqual([...NOTIFICATION_EVENT_VALUES], ["website_request", "trip_exception"]);
  for (const notOffered of ["upcoming_unassigned_trip", "recurring_care_gap", "proof_needs_review"]) {
    assert.equal(isNotificationEvent(notOffered), false, notOffered);
  }
});

test("labels are human wording, never codes", () => {
  assert.equal(notificationEventLabel("website_request"), "New website request");
  assert.equal(notificationEventLabel("trip_exception"), "Trip exception");
  for (const option of NOTIFICATION_EVENT_OPTIONS) assert.doesNotMatch(option.label + option.description, /_/);
});

test("recipients are staff roles only -- never Driver or platform roles", () => {
  assert.deepEqual([...NOTIFICATION_ROLE_VALUES], ["organization_admin", "dispatcher"]);
  assert.equal(validateRoleSelection(["driver"]).ok, false);
  assert.equal(validateRoleSelection(["platform_admin"]).ok, false);
  assert.equal(validateRoleSelection(["organization_admin", "viewer"]).ok, false);
});

test("role selection: canonical order, distinct, empty is valid (= off)", () => {
  assert.deepEqual(validateRoleSelection(["dispatcher", "organization_admin", "dispatcher"]), { ok: true, roles: ["organization_admin", "dispatcher"] });
  assert.deepEqual(validateRoleSelection([]), { ok: true, roles: [] });
});

test("recipient descriptions", () => {
  assert.equal(describeRecipients([]), "Off");
  assert.equal(describeRecipients(["organization_admin"]), "Organization Admins");
  assert.equal(describeRecipients(["dispatcher", "organization_admin"]), "Organization Admins and Dispatchers");
});

test("delivery wording never claims success it does not have", () => {
  assert.equal(deliveryStatusLabel("sent"), "Sent");
  assert.equal(deliveryStatusLabel("partial"), "Partly sent");
  assert.equal(deliveryStatusLabel("failed"), "Not delivered");
  assert.equal(deliveryStatusLabel("skipped"), "No recipients");
  assert.equal(deliveryStatusLabel("dispatching"), "Sending");
  assert.equal(deliveryStatusTone("failed"), "critical");
  assert.equal(deliveryStatusTone("partial"), "warning");
  assert.equal(deliveryStatusTone("sent"), "positive");
});
