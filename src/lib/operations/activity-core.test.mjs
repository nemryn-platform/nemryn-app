// Focused unit tests for the pure Activity projection (P1-PILOT-S4B-R4D).
//   node --test src/lib/operations/activity-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { describeActivity, actorLabel, groupActivityByDay, encodeCursor, decodeCursor, ACTIVITY_PAGE_SIZE } = await import("./activity-core.ts");

const helpers = {
  formatSchedule: (days, o, c) => `days=${days.join("")} ${o}-${c}`,
  serviceLabel: (v) => ({ dialysis: "Dialysis", medical_appointment: "Medical appointments" })[v] ?? "Other",
};
const ACTIONS = [
  "organization_created", "organization_settings_updated", "organization_operating_schedule_updated",
  "organization_services_configured", "organization_service_offerings_updated",
  "website_integration_created", "website_integration_activated", "website_integration_disabled", "website_integration_origin_updated",
  "staff_invitation_created", "staff_invitation_resent", "staff_invitation_cancelled", "staff_invitation_accepted",
  "membership_role_changed", "membership_deactivated", "membership_reactivated", "notification_preferences_updated",
  "platform_organization_suspended", "platform_organization_reactivated",
];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

test("every whitelisted administrative action has a human mapping", () => {
  for (const action of ACTIONS) {
    const d = describeActivity({ action, actorName: "Victor", before: {}, after: {} }, helpers);
    assert.ok(d && d.title.length > 0, action);
    assert.doesNotMatch(d.title, /_/, action);
  }
});

test("unknown / operational actions are omitted, never shown as a raw code", () => {
  assert.equal(describeActivity({ action: "trip_reassigned", actorName: "V", before: null, after: null }, helpers), null);
  assert.equal(describeActivity({ action: "driver_invite_created", actorName: "V", before: null, after: null }, helpers), null);
});

test("organization details: lists WHICH fields changed, never their values", () => {
  const d = describeActivity({ action: "organization_settings_updated", actorName: "V", before: { name: "Old Name", business_phone: "111" }, after: { name: "New Name Co", business_phone: "(404) 555-0100" } }, helpers);
  assert.equal(d.title, "Organization details updated");
  assert.equal(d.summary, "Changed: Name, Business phone");
  assert.doesNotMatch(d.summary, /555|Old Name|New Name/);
});

test("staff events: role in the title, email in the summary, role change shows both roles", () => {
  assert.equal(describeActivity({ action: "staff_invitation_created", actorName: "V", before: null, after: { email: "a@b.example", role: "dispatcher" } }, helpers).title, "Dispatcher invitation sent");
  assert.equal(describeActivity({ action: "staff_invitation_created", actorName: "V", before: null, after: { email: "a@b.example", role: "organization_admin" } }, helpers).title, "Organization Admin invitation sent");
  assert.equal(describeActivity({ action: "membership_role_changed", actorName: "V", before: { role: "dispatcher" }, after: { role: "organization_admin", email: "d@x.example" } }, helpers).summary, "d@x.example: Dispatcher → Organization Admin");
  assert.equal(describeActivity({ action: "staff_invitation_accepted", actorName: "d", before: null, after: { email: "d@x.example", role: "dispatcher" } }, helpers).summary, "d@x.example joined as Dispatcher");
});

test("services, schedule, website and notification summaries are readable", () => {
  assert.equal(describeActivity({ action: "organization_service_offerings_updated", actorName: "V", before: { service_types: [] }, after: { service_types: ["dialysis", "medical_appointment"] } }, helpers).summary, "Now: Dialysis, Medical appointments");
  assert.equal(describeActivity({ action: "organization_operating_schedule_updated", actorName: "V", before: {}, after: { days: [1, 2, 3], opens_at: "06:00:00", closes_at: "18:30:00" } }, helpers).summary, "days=123 06:00-18:30");
  assert.equal(describeActivity({ action: "organization_operating_schedule_updated", actorName: "V", before: {}, after: { days: null, opens_at: null, closes_at: null } }, helpers).summary, "Schedule cleared");
  assert.equal(describeActivity({ action: "website_integration_created", actorName: "V", before: null, after: { external_id: "web_ABC", allowed_origins: ["https://www.example.com"], is_active: false } }, helpers).summary, "https://www.example.com");
  assert.equal(describeActivity({ action: "website_integration_origin_updated", actorName: "V", before: {}, after: { allowed_origins: ["https://new.example.com"], auto_disabled: true } }, helpers).summary, "Now https://new.example.com. Intake was turned off until reactivated.");
  assert.equal(describeActivity({ action: "notification_preferences_updated", actorName: "V", before: {}, after: { event_type: "website_request", recipient_roles: ["organization_admin", "dispatcher"] } }, helpers).summary, "New website request: Organization Admins and Dispatchers");
  assert.equal(describeActivity({ action: "notification_preferences_updated", actorName: "V", before: {}, after: { event_type: "trip_exception", recipient_roles: [] } }, helpers).summary, "Trip exception: Off");
});

test("no output ever contains a UUID, role code, function name or raw JSON", () => {
  const raw = { id: "11111111-2222-3333-4444-555555555555", organization_id: "11111111-2222-3333-4444-555555555555", role: "organization_admin", email: "a@b.example", external_id: "web_ABCDEFGH2345", service_types: ["dialysis"], allowed_origins: ["https://x.example.com"], days: [1], opens_at: "06:00:00", closes_at: "07:00:00", event_type: "website_request", recipient_roles: ["dispatcher"] };
  for (const action of ACTIONS) {
    const d = describeActivity({ action, actorName: "V", before: { ...raw, role: "dispatcher" }, after: raw }, helpers);
    const text = `${d.title} ${d.summary ?? ""}`;
    assert.doesNotMatch(text, UUID, action);
    assert.doesNotMatch(text, /organization_admin|organization_id|set_|_updated|[{}\[\]"]/, `${action}: ${text}`);
  }
});

test("actor resolution: display name, else a neutral System", () => {
  assert.equal(actorLabel("Victor"), "Victor");
  assert.equal(actorLabel(null), "System");
  assert.equal(actorLabel("   "), "System");
});

test("grouping: Today / Yesterday / dated, in the organization's timezone, newest first", () => {
  const now = new Date("2026-09-20T15:00:00Z"); // 11:00 AM in New York
  const items = [
    { key: "1", occurredAt: "2026-09-20T14:42:00Z", title: "A", summary: null, actor: "V" }, // 10:42 AM today NY
    { key: "2", occurredAt: "2026-09-20T03:30:00Z", title: "B", summary: null, actor: "V" }, // 11:30 PM Sep 19 NY -> Yesterday
    { key: "3", occurredAt: "2026-09-18T20:20:00Z", title: "C", summary: null, actor: "V" },
  ];
  const groups = groupActivityByDay(items, "America/New_York", now);
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "Sep 18, 2026"]);
  assert.equal(groups[0].items[0].time, "10:42 AM");
  assert.equal(groups[1].items[0].time, "11:30 PM");
});

test("cursor round-trips; tampered or malformed cursors are ignored", () => {
  const at = "2026-09-20T05:12:33.123456+00:00";
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const cursor = encodeCursor(at, id);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(cursor), { occurredAt: at, id });
  for (const bad of [null, undefined, "", "not-a-cursor", "AAAA", "a".repeat(300), encodeCursor("x", "y"), encodeCursor(at, "'; drop table audit_events;--")]) {
    assert.equal(decodeCursor(bad), null, String(bad));
  }
  assert.equal(ACTIVITY_PAGE_SIZE, 30);
});

test("platform lifecycle actions read as Nemryn actions and never expose a reason, id or internal identity", () => {
  const suspended = describeActivity({ action: "platform_organization_suspended", actorName: "Nemryn", before: { status: "active" }, after: { status: "inactive", reason: "SECRET REASON" } }, helpers);
  const reactivated = describeActivity({ action: "platform_organization_reactivated", actorName: "Nemryn", before: { status: "inactive" }, after: { status: "active" } }, helpers);
  assert.equal(suspended.title, "Organization suspended by Nemryn");
  assert.equal(reactivated.title, "Organization reactivated by Nemryn");
  for (const d of [suspended, reactivated]) {
    assert.doesNotMatch(`${d.title} ${d.summary}`, /SECRET|_|inactive|[0-9a-f]{8}-/);
  }
  assert.equal(actorLabel("Nemryn"), "Nemryn");
});
