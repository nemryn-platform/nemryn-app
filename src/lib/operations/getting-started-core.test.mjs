// NP-PILOT-P2 -- Getting started checklist rules. Run with:
//
//   node --test src/lib/operations/getting-started-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const g = await import("./getting-started-core.ts");

const empty = {
  isAdmin: true,
  growth: false,
  business: { phone: null, address: null },
  services: 0,
  vehicles: 0,
  activeDrivers: 0,
  facilities: 0,
  passengers: 0,
  trips: 0,
  requests: 0,
  otherActiveStaff: 0,
  pendingStaffInvites: 0,
  growthContacts: null,
  growthQuotes: null,
};
// the four business-setup essentials, and NOTHING else
const setUp = { ...empty, business: { phone: "(404) 555-0100", address: "1 Fictional Way" }, services: 3, vehicles: 1, activeDrivers: 1 };

test("a brand-new workspace has 0 of 4 business-setup essentials -- nothing is assumed done", () => {
  const r = g.buildGettingStarted(empty);
  assert.equal(r.totalCount, 4);
  assert.equal(r.completedCount, 0);
  assert.equal(r.remaining, 4);
  assert.equal(r.isComplete, false);
  assert.deepEqual(r.essentials.map((s) => s.key), ["business", "services", "vehicle", "driver"]);
  assert.deepEqual(r.milestones.map((s) => s.key), ["facility", "passenger", "trip", "team"]);
});

test("business details need BOTH phone and address (blank / whitespace does not count)", () => {
  const b = (business) => g.buildGettingStarted({ ...empty, business }).steps.find((s) => s.key === "business").complete;
  assert.equal(b({ phone: "(404) 555-0100", address: null }), false);
  assert.equal(b({ phone: "   ", address: "1 Fictional Way" }), false);
  assert.equal(b({ phone: "(404) 555-0100", address: "1 Fictional Way" }), true);
  assert.equal(b(null), null);
});

test("the four essentials alone complete setup: no facility, passenger, request, trip, team or Growth needed", () => {
  const r = g.buildGettingStarted(setUp);
  assert.equal(r.isComplete, true);
  assert.equal(r.remaining, 0);
  assert.ok(r.milestones.every((m) => m.complete === false));
  assert.equal(r.steps.some((s) => s.group === "growth"), false);
});

test("each essential is required: missing any one keeps setup incomplete", () => {
  for (const missing of [{ business: { phone: "(404) 555-0100", address: "" } }, { services: 0 }, { vehicles: 0 }, { activeDrivers: 0 }]) {
    const r = g.buildGettingStarted({ ...setUp, ...missing });
    assert.equal(r.isComplete, false, JSON.stringify(missing));
    assert.equal(r.remaining, 1);
  }
});

test("first request OR trip completes the milestone; unknown only when neither count is known to be > 0", () => {
  const trip = (f) => g.buildGettingStarted({ ...setUp, ...f }).steps.find((s) => s.key === "trip").complete;
  assert.equal(trip({ trips: 0, requests: 1 }), true);
  assert.equal(trip({ trips: 1, requests: 0 }), true);
  assert.equal(trip({ trips: 0, requests: 0 }), false);
  assert.equal(trip({ trips: null, requests: 2 }), true);
  assert.equal(trip({ trips: null, requests: 0 }), null);
});

test("team: another active staff member OR a pending invitation; unknown for non-admins (no claim, no link)", () => {
  const team = (f) => g.buildGettingStarted({ ...setUp, ...f }).steps.find((s) => s.key === "team");
  assert.equal(team({ otherActiveStaff: 1 }).complete, true);
  assert.equal(team({ pendingStaffInvites: 1 }).complete, true);
  const dispatcher = team({ isAdmin: false, otherActiveStaff: null, pendingStaffInvites: null });
  assert.equal(dispatcher.complete, null);
  assert.equal(dispatcher.href, null);
  assert.match(dispatcher.note, /Organization Admin/);
  assert.equal(g.setupStatusText(dispatcher), "Managed by an Organization Admin");
});

test("admin-only steps link to Settings only for an Organization Admin", () => {
  const admin = g.buildGettingStarted(empty).steps;
  const staff = g.buildGettingStarted({ ...empty, isAdmin: false }).steps;
  for (const key of ["business", "services", "team"]) {
    assert.match(admin.find((s) => s.key === key).href, /^\/operations\/settings\//);
    assert.equal(staff.find((s) => s.key === key).href, null);
    assert.equal(staff.find((s) => s.key === key).adminOnly, true);
  }
  assert.equal(staff.find((s) => s.key === "trip").href, "/operations/trips/new");
  assert.equal(staff.find((s) => s.key === "vehicle").href, "/onboarding/vehicle");
});

test("unknown essential facts never count as complete; status text says so", () => {
  const r = g.buildGettingStarted({ ...setUp, vehicles: null });
  assert.equal(r.isComplete, false);
  assert.equal(r.completedCount, 3);
  const v = r.steps.find((s) => s.key === "vehicle");
  assert.equal(v.complete, null);
  assert.equal(g.setupStatusText(v), "Couldn't check right now");
});

test("Growth steps appear only with Growth access and never block setup completion", () => {
  const r = g.buildGettingStarted({ ...setUp, growth: true, growthContacts: 0, growthQuotes: 0 });
  assert.deepEqual(r.steps.filter((s) => s.group === "growth").map((s) => s.key), ["growth_contact", "growth_quote"]);
  assert.equal(r.isComplete, true);
  assert.equal(g.buildGettingStarted({ ...setUp, growth: true, growthContacts: 2, growthQuotes: 1 }).steps.find((s) => s.key === "growth_quote").complete, true);
});

test("notes never imply compliance or authorization to process real patient information", () => {
  assert.match(g.GETTING_STARTED_SCOPE_NOTE, /does not make your organization HIPAA compliant/);
  assert.match(g.MILESTONES_NOTE, /do not mean your organization is approved or ready to handle real patient information/);
  assert.match(g.MILESTONES_NOTE, /fictional practice records/);
});
