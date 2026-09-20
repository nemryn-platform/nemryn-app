// Focused unit tests for the pure Platform helpers (P1-PILOT-S4B-R4E).
//   node --test src/lib/platform/platform-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./platform-core.ts");

test("stored status vocabulary is presented accurately", () => {
  assert.equal(core.organizationStatusLabel("active"), "Active");
  assert.equal(core.organizationStatusLabel("inactive"), "Suspended");
  assert.equal(core.organizationStatusCategory("active"), "positive");
  assert.equal(core.organizationStatusCategory("inactive"), "warning");
});

test("query parsing is defensive", () => {
  assert.equal(core.parseStatusFilter("active"), "active");
  assert.equal(core.parseStatusFilter("inactive"), "inactive");
  assert.equal(core.parseStatusFilter("suspended"), null);
  assert.equal(core.parseStatusFilter(["active", "inactive"]), "active");
  assert.equal(core.parseStatusFilter(undefined), null);
  assert.equal(core.parseSearch("  Harmony "), "Harmony");
  assert.equal(core.parseSearch("   "), null);
  assert.equal(core.parseSearch("x".repeat(500)).length, 100);
  assert.equal(core.parsePage("3"), 3);
  for (const bad of [undefined, "", "0", "-1", "abc", "1.5", "99999", "4001", "1e3"]) assert.equal(core.parsePage(bad), 1, String(bad));
});

test("lifecycle input validation mirrors the database rules", () => {
  assert.deepEqual(core.validateLifecycleInput("inactive", "  Pilot pause  "), { ok: true, value: { status: "inactive", reason: "Pilot pause" } });
  assert.equal(core.validateLifecycleInput("active", "ok!").ok, true);
  assert.equal(core.validateLifecycleInput("archived", "Pilot pause").ok, false);
  assert.equal(core.validateLifecycleInput(undefined, "Pilot pause").ok, false);
  assert.equal(core.validateLifecycleInput("inactive", "ab").ok, false);
  assert.equal(core.validateLifecycleInput("inactive", "   ").ok, false);
  assert.equal(core.validateLifecycleInput("inactive", null).ok, false);
  assert.equal(core.validateLifecycleInput("inactive", "x".repeat(501)).ok, false);
  assert.equal(core.validateLifecycleInput("inactive", "x".repeat(500)).ok, true);
});

test("notification labels use only the fixed vocabulary and never leak provider text", () => {
  assert.equal(core.failureReasonLabel(null), null);
  assert.equal(core.failureReasonLabel("provider_error"), "Email provider error");
  assert.equal(core.failureReasonLabel("not_configured"), "Email not configured");
  assert.equal(core.failureReasonLabel("build_failed"), "Message could not be built");
  assert.equal(core.failureReasonLabel("Resend 401: bad key re_live_123"), "Unknown");
  assert.equal(core.notificationStatusLabel("dispatching", true), "Stuck dispatching");
  assert.equal(core.notificationStatusLabel("pending", true), "Pending too long");
  assert.equal(core.notificationStatusLabel("failed", false), "Failed");
  assert.equal(core.notificationStatusLabel("partial", false), "Partly sent");
  assert.equal(core.notificationEventLabel("website_request"), "New website request");
  assert.equal(core.notificationEventLabel("trip_exception"), "Trip exception");
});

test("platform activity titles are limited to the two lifecycle actions", () => {
  assert.equal(core.platformActionTitle("platform_organization_suspended"), "Organization suspended");
  assert.equal(core.platformActionTitle("platform_organization_reactivated"), "Organization reactivated");
  assert.equal(core.platformActionTitle("membership_deactivated"), null);
});

test("timestamps are explicit about being UTC and tolerate bad input", () => {
  assert.match(core.formatPlatformTimestamp("2026-09-20T14:05:00Z"), /Sep 20, 2026.*2:05 PM UTC$/);
  assert.equal(core.formatPlatformTimestamp(null), "—");
  assert.equal(core.formatPlatformTimestamp("nope"), "—");
  assert.equal(core.formatPlatformDate("2026-09-20T23:59:00Z"), "Sep 20, 2026");
  assert.equal(core.pluralize(1, "organization"), "1 organization");
  assert.equal(core.pluralize(2, "organization"), "2 organizations");
});
