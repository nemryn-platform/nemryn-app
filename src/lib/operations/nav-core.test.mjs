// NP-UI-P1b -- canonical Operations navigation model. Run with:
//
//   node --test src/lib/operations/nav-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const n = await import("./nav-core.ts");

const shape = (sections) => sections.map((s) => [s.key, s.items.map((i) => `${i.label}=${i.href}`)]);

test("sections in canonical order; every destination is an existing route", () => {
  const all = n.operationsNavSections({ hasLinkedDriverProfile: true, canManageSettings: true, canAccessGrowth: true });
  assert.deepEqual(shape(all), [
    ["today", ["Operations Brief=/operations", "Requests=/operations/requests", "Trips=/operations/trips", "Dispatch=/operations/dispatch", "Tomorrow Readiness=/operations/tomorrow"]],
    ["planning", ["Standing Orders=/operations/recurring-care"]],
    ["records", ["Passengers=/operations/passengers", "Facilities=/operations/facilities", "Drivers=/operations/drivers", "Vehicles=/operations/fleet"]],
    ["growth", []],
    ["administration", ["Drive=/driver", "Settings=/operations/settings"]],
  ]);
  assert.deepEqual(all.map((s) => s.label), ["Today", "Planning", "Records", "Growth", "Administration"]);
});

test("gating: Growth only with canAccessGrowth; Drive only with a linked driver; Settings only for admins; empty Administration omitted", () => {
  const dispatcher = n.operationsNavSections({});
  assert.deepEqual(dispatcher.map((s) => s.key), ["today", "planning", "records"]);
  const driverOnly = n.operationsNavSections({ hasLinkedDriverProfile: true });
  assert.deepEqual(driverOnly.at(-1).items.map((i) => i.key), ["drive"]);
  const adminNoPlus = n.operationsNavSections({ canManageSettings: true });
  assert.deepEqual(adminNoPlus.map((s) => s.key), ["today", "planning", "records", "administration"]);
  assert.deepEqual(adminNoPlus.at(-1).items.map((i) => i.key), ["settings"]);
});

test("no unfinished Billing / Reports entry and no duplicate destinations", () => {
  const hrefs = n.operationsNavSections({ hasLinkedDriverProfile: true, canManageSettings: true, canAccessGrowth: true }).flatMap((s) => s.items.map((i) => i.href));
  assert.equal(hrefs.some((h) => /billing|reports/.test(h)), false);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("isNavItemActive: Operations Brief is exact; others match their sub-tree only", () => {
  assert.equal(n.isNavItemActive("/operations", "/operations"), true);
  assert.equal(n.isNavItemActive("/operations", "/operations/trips"), false);
  assert.equal(n.isNavItemActive("/operations/trips", "/operations/trips/new"), true);
  assert.equal(n.isNavItemActive("/operations/trips", "/operations/tripsx"), false);
  assert.equal(n.isNavItemActive("/operations/settings", "/operations/settings/team"), true);
});

test("operationsContext: section + label for the header's location line", () => {
  assert.deepEqual(n.operationsContext("/operations"), { section: "Today", label: "Operations Brief" });
  assert.deepEqual(n.operationsContext("/operations/fleet"), { section: "Records", label: "Vehicles" });
  assert.deepEqual(n.operationsContext("/operations/recurring-care/abc"), { section: "Planning", label: "Standing Orders" });
  assert.deepEqual(n.operationsContext("/operations/settings/team"), { section: "Administration", label: "Settings" });
  assert.deepEqual(n.operationsContext("/operations/growth/quotes"), { section: "Growth", label: "Estimates & Quotes" });
  assert.deepEqual(n.operationsContext("/operations/growth/inquiries/abc"), { section: "Growth", label: "Inquiries" });
  assert.deepEqual(n.operationsContext("/operations/growth/agent"), { section: "Growth", label: "Growth Agent" });
  assert.deepEqual(n.operationsContext("/operations/growth"), { section: "Growth", label: "Dashboard" });
  assert.deepEqual(n.operationsContext("/operations/proof-of-service"), { section: "Today", label: "Proof of Service" });
  assert.deepEqual(n.operationsContext("/operations/nope"), { section: null, label: "Operations" });
});
