// NP-P1-S1 -- Nemryn Plus pure access rules. Run with:
//
//   node --test src/lib/plus/access-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { PLUS_ACCESS_STATES, parsePlusAccessState, canEnterGrowth, isPlusReadOnly, trialDaysRemaining, formatTrialEnd } =
  await import("./access-core.ts");

test("the four effective states, and nothing else", () => {
  assert.deepEqual([...PLUS_ACCESS_STATES], ["none", "write", "read_only", "locked"]);
  for (const s of PLUS_ACCESS_STATES) assert.equal(parsePlusAccessState(s), s);
});

test("unknown / malformed states fail closed to none", () => {
  for (const raw of [undefined, null, "", "WRITE", "active", "trial", "admin", 1, true, {}, ["write"]]) {
    assert.equal(parsePlusAccessState(raw), "none", String(raw));
  }
});

test("Growth entry: write and read_only only; locked and none never", () => {
  assert.equal(canEnterGrowth("write"), true);
  assert.equal(canEnterGrowth("read_only"), true);
  assert.equal(canEnterGrowth("locked"), false);
  assert.equal(canEnterGrowth("none"), false);
  assert.equal(canEnterGrowth(parsePlusAccessState("garbage")), false);
});

test("read-only detection", () => {
  assert.equal(isPlusReadOnly("read_only"), true);
  for (const s of ["write", "locked", "none"]) assert.equal(isPlusReadOnly(s), false);
});

test("trial days remaining: rounded up, 0 when elapsed, null when absent or invalid", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  assert.equal(trialDaysRemaining(now, "2026-10-27T12:00:00Z"), 14);
  assert.equal(trialDaysRemaining(now, "2026-10-13T12:00:01Z"), 1);
  assert.equal(trialDaysRemaining(now, "2026-10-14T11:59:59Z"), 1);
  assert.equal(trialDaysRemaining(now, "2026-10-13T12:00:00Z"), 0);
  assert.equal(trialDaysRemaining(now, "2026-10-01T00:00:00Z"), 0);
  assert.equal(trialDaysRemaining(now, null), null);
  assert.equal(trialDaysRemaining(now, "not a date"), null);
});

test("trial end is formatted in the organization's timezone", () => {
  // 03:30 UTC on Oct 27 is still Oct 26 in New York.
  assert.equal(formatTrialEnd("2026-10-27T03:30:00Z", "America/New_York"), "October 26, 2026");
  assert.equal(formatTrialEnd("2026-10-27T03:30:00Z", "UTC"), "October 27, 2026");
  assert.equal(formatTrialEnd(null, "UTC"), null);
  assert.equal(formatTrialEnd("nope", "UTC"), null);
});

test("status summary: one honest message per state; trial shows its end in the org timezone", async () => {
  const { plusStatusSummary } = await import("./access-core.ts");
  const now = new Date("2026-10-13T12:00:00Z");
  const trial = plusStatusSummary("write", "2026-10-27T15:31:00Z", "America/New_York", now);
  assert.equal(trial.label, "Trial");
  assert.equal(trial.trialEnd, "October 27, 2026");
  assert.equal(trial.trialDaysLeft, 15);
  assert.match(trial.message, /^Your Nemryn Plus trial ends October 27, 2026 \(15 days left\)\.$/);
  const active = plusStatusSummary("write", null, "UTC", now);
  assert.deepEqual([active.label, active.tone, active.trialEnd], ["Active", "positive", null]);
  const ro = plusStatusSummary("read_only", "2026-10-01T00:00:00Z", "UTC", now);
  assert.equal(ro.label, "Not active");
  assert.equal(ro.trialEnd, null, "no trial date once read-only");
  assert.match(ro.message, /records are kept/);
  const locked = plusStatusSummary("locked", null, "UTC", now);
  assert.equal(locked.label, "Restricted");
  assert.match(locked.message, /Contact Nemryn/);
  const none = plusStatusSummary("none", null, "UTC", now);
  assert.equal(none.label, "Not enabled");
  for (const s of [trial, active, ro, locked, none]) {
    assert.doesNotMatch(s.message, /lead|revenue|customer|guarantee|grow your/i, "no sales promise or fabricated data");
  }
  assert.match(ro.message, /Operations are not affected/);
  assert.match(locked.message, /Operations are not affected/);
});
