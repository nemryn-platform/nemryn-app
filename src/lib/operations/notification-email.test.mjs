// Focused tests for the notification email privacy posture (P1-PILOT-S4B-R4D).
//   node --test src/lib/operations/notification-email.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./src/lib/operations/server-only-stub-loader.mjs", pathToFileURL("./"));
const { buildNotificationEmail } = await import("../email/notification-email.ts");

const base = { recipient: "staff@example.test", organizationName: "Harmony Medical Transport", appOrigin: "https://app.nemryn.com", timezone: "America/New_York" };
const FORBIDDEN = /(SECRET|555-01|@example\.test.*requester|assistance|additional notes|supabase|service_role|resend|api[_ ]?key|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|integration|web_[A-Z0-9]{8})/i;

test("website request email: date + service category + a link; nothing else about the request", () => {
  const m = buildNotificationEmail({ ...base, eventType: "website_request", requestedDate: "2026-10-12", serviceLabel: "Dialysis" });
  assert.equal(m.to, "staff@example.test");
  assert.match(m.subject, /^New transportation request — Harmony Medical Transport$/);
  assert.match(m.text, /A new transportation request was received through your website\./);
  assert.match(m.text, /Requested date: Mon, Oct 12, 2026/);
  assert.match(m.text, /Service: Dialysis/);
  assert.match(m.text, /Open Request Hub: https:\/\/app\.nemryn\.com\/operations\/requests/);
  assert.doesNotMatch(m.text + m.html, FORBIDDEN);
});

test("website request email without a date or service still works and stays minimal", () => {
  const m = buildNotificationEmail({ ...base, eventType: "website_request" });
  assert.doesNotMatch(m.text, /Requested date|Service:/);
  assert.match(m.text, /Open Request Hub/);
});

test("trip exception email: pickup time in the org timezone + a link; no exception type or description", () => {
  const m = buildNotificationEmail({ ...base, eventType: "trip_exception", pickupAt: "2026-10-12T13:30:00Z" });
  assert.match(m.subject, /^Trip issue reported — Harmony Medical Transport$/);
  assert.match(m.text, /An issue was reported on a trip\./);
  assert.match(m.text, /Scheduled pickup: Mon, Oct 12, 2026, 9:30 AM/);
  assert.match(m.text, /Open Trips: https:\/\/app\.nemryn\.com\/operations\/trips/);
  assert.doesNotMatch(m.text + m.html, FORBIDDEN);
});

test("links go to list pages: no record identifiers in any URL", () => {
  for (const eventType of ["website_request", "trip_exception"]) {
    const m = buildNotificationEmail({ ...base, eventType, requestedDate: "2026-10-12", pickupAt: "2026-10-12T13:30:00Z" });
    const urls = (m.text + m.html).match(/https?:\/\/[^\s"<]+/g) ?? [];
    assert.ok(urls.length > 0);
    for (const url of urls) assert.doesNotMatch(url, /[0-9a-f]{8}-[0-9a-f]{4}|\?|#/);
  }
});

test("html escapes the organization name", () => {
  const m = buildNotificationEmail({ ...base, organizationName: `<script>alert("x")</script> & Co`, eventType: "website_request" });
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /&lt;script&gt;/);
});
