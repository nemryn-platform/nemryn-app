// NP-P1-S1 -- Platform Admin Nemryn Plus panel rules. Run with:
//
//   node --test src/lib/plus/entitlement-admin-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./entitlement-admin-core.ts");
const { availablePlusActions, validatePlusAdminInput, accessEndInstant, plusStatusLabel, plusEffectiveStateLabel, plusEffectiveStateCategory } = core;

const NOW = new Date("2026-10-13T12:00:00Z");
const base = { provisioned: true, restriction: null, trialStartedAt: null, trialEndsAt: null, trialExtensionCount: 0, accessEndsAt: null, effectiveState: "write", statusReason: "x", updatedAt: null };

test("defaults match the database: 14-day trial, 7-30, one extension of up to 30 days", () => {
  assert.equal(core.PLUS_TRIAL_DEFAULT_DAYS, 14);
  assert.equal(core.PLUS_TRIAL_MIN_DAYS, 7);
  assert.equal(core.PLUS_TRIAL_MAX_DAYS, 30);
  assert.equal(core.PLUS_EXTENSION_MAX_DAYS, 30);
});

test("not provisioned: only start trial or activate (nothing to end or restrict)", () => {
  assert.deepEqual(availablePlusActions({ ...base, provisioned: false, status: null, effectiveState: "none" }), ["start_trial", "activate"]);
});

test("running trial: extend once, activate, end or restrict; never restart the trial", () => {
  const trial = { ...base, status: "trial", trialStartedAt: "2026-10-01T00:00:00Z", trialEndsAt: "2026-10-15T00:00:00Z" };
  const a = availablePlusActions(trial);
  assert.ok(!a.includes("start_trial"));
  assert.ok(a.includes("extend_trial"));
  for (const x of ["activate", "expire", "cancel", "disable_read_only", "disable_no_access"]) assert.ok(a.includes(x), x);
  assert.ok(!availablePlusActions({ ...trial, trialExtensionCount: 1 }).includes("extend_trial"), "only one extension");
});

test("a consumed trial is never offered again; an organization that never trialled may still start one", () => {
  const expiredAfterTrial = { ...base, status: "expired", trialStartedAt: "2026-09-01T00:00:00Z", trialEndsAt: "2026-09-15T00:00:00Z", effectiveState: "read_only" };
  assert.ok(!availablePlusActions(expiredAfterTrial).includes("start_trial"));
  assert.ok(availablePlusActions({ ...base, status: "active" }).includes("start_trial"));
});

test("the current state's own action is not offered as a no-op", () => {
  assert.ok(!availablePlusActions({ ...base, status: "expired", effectiveState: "read_only" }).includes("expire"));
  assert.ok(!availablePlusActions({ ...base, status: "cancelled", effectiveState: "read_only" }).includes("cancel"));
  const ro = availablePlusActions({ ...base, status: "disabled", restriction: "read_only", effectiveState: "read_only" });
  assert.ok(!ro.includes("disable_read_only") && ro.includes("disable_no_access"));
  const na = availablePlusActions({ ...base, status: "disabled", restriction: "no_access", effectiveState: "locked" });
  assert.ok(!na.includes("disable_no_access") && na.includes("disable_read_only"));
  assert.ok(!availablePlusActions({ ...base, status: "active" }).includes("extend_trial"));
});

test("validation: reason required (3-500), unknown action refused", () => {
  assert.equal(validatePlusAdminInput({ action: "expire", reason: "  " }, NOW).ok, false);
  assert.equal(validatePlusAdminInput({ action: "expire", reason: "ab" }, NOW).ok, false);
  assert.equal(validatePlusAdminInput({ action: "expire", reason: "x".repeat(501) }, NOW).ok, false);
  assert.equal(validatePlusAdminInput({ action: "delete", reason: "valid reason" }, NOW).ok, false);
  assert.equal(validatePlusAdminInput({ action: undefined, reason: "valid reason" }, NOW).ok, false);
});

test("validation: trial days blank = database default, else 7-30 whole days", () => {
  const blank = validatePlusAdminInput({ action: "start_trial", reason: "Pilot eval", trialDays: "" }, NOW);
  assert.deepEqual(blank, { ok: true, value: { kind: "set", status: "trial", trialDays: null, accessEndsAt: null, restriction: null, reason: "Pilot eval" } });
  assert.equal(validatePlusAdminInput({ action: "start_trial", reason: "Pilot eval", trialDays: "7" }, NOW).value.trialDays, 7);
  assert.equal(validatePlusAdminInput({ action: "start_trial", reason: "Pilot eval", trialDays: "30" }, NOW).value.trialDays, 30);
  for (const bad of ["6", "31", "0", "-5", "10.5", "ten", "1e1"]) {
    assert.equal(validatePlusAdminInput({ action: "start_trial", reason: "Pilot eval", trialDays: bad }, NOW).ok, false, bad);
  }
});

test("validation: extension 1-30 days, required", () => {
  assert.equal(validatePlusAdminInput({ action: "extend_trial", reason: "More time", extraDays: "1" }, NOW).value.extraDays, 1);
  assert.equal(validatePlusAdminInput({ action: "extend_trial", reason: "More time", extraDays: "30" }, NOW).value.extraDays, 30);
  for (const bad of ["", "0", "31", "x"]) assert.equal(validatePlusAdminInput({ action: "extend_trial", reason: "More time", extraDays: bad }, NOW).ok, false, bad);
});

test("validation: activation end date is optional, inclusive (next midnight UTC) and must be in the future", () => {
  assert.equal(validatePlusAdminInput({ action: "activate", reason: "Paid", accessEndsOn: "" }, NOW).value.accessEndsAt, null);
  assert.equal(validatePlusAdminInput({ action: "activate", reason: "Paid", accessEndsOn: "2026-11-30" }, NOW).value.accessEndsAt, "2026-12-01T00:00:00.000Z");
  assert.equal(accessEndInstant("2026-10-13", NOW), "2026-10-14T00:00:00.000Z", "today counts: access through end of today");
  assert.equal(accessEndInstant("2026-10-12", NOW), "invalid", "yesterday is in the past");
  assert.equal(accessEndInstant("2026-02-30", NOW), "invalid");
  assert.equal(accessEndInstant("13/10/2026", NOW), "invalid");
});

test("validation: each status action maps to exactly one database request", () => {
  const m = (action) => validatePlusAdminInput({ action, reason: "Reason here" }, NOW).value;
  assert.deepEqual(m("expire"), { kind: "set", status: "expired", trialDays: null, accessEndsAt: null, restriction: null, reason: "Reason here" });
  assert.equal(m("cancel").status, "cancelled");
  assert.deepEqual([m("disable_read_only").status, m("disable_read_only").restriction], ["disabled", "read_only"]);
  assert.deepEqual([m("disable_no_access").status, m("disable_no_access").restriction], ["disabled", "no_access"]);
});

test("labels distinguish stored status from effective access", () => {
  assert.equal(plusStatusLabel({ provisioned: false, status: null }), "Not provisioned");
  assert.equal(plusStatusLabel({ provisioned: true, status: "disabled" }), "Disabled");
  assert.equal(plusEffectiveStateLabel("locked"), "Locked (no access)");
  assert.equal(plusEffectiveStateLabel("none"), "Not provisioned (Core only)");
  assert.equal(plusEffectiveStateCategory("write"), "positive");
  assert.equal(plusEffectiveStateCategory("locked"), "critical");
});
