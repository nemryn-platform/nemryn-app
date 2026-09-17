// Focused tests for organizationDayBoundsUtc's EXACT organization-local
// calendar-day boundary contract (P1-E1-S4C1), and for the "tomorrow"
// day-boundary COMPOSITION strategy built on top of it (P1-E1-S4C §2):
// `organizationDayBoundsUtc(organizationDayBoundsUtc(now, tz).endUtc,
// tz)` — NEVER `now.getTime() + 24*60*60*1000`.
//
// P1-E1-S4C1 CORRECTNESS FIX: the previous version of this file
// documented and ACCEPTED a ±1 hour tolerance on DST transition days
// (`organizationDayBoundsUtc` used to compute `endUtc = startUtc + 24h`
// unconditionally). That tolerance is NO LONGER accepted after this
// phase — every boundary below is asserted EXACTLY: a spring-forward
// local calendar day is asserted to be EXACTLY 23 hours; a fall-back
// local calendar day is asserted to be EXACTLY 25 hours; an ordinary
// day is asserted to be EXACTLY 24 hours. No tolerance, no rounding.
//
// `day-bounds.ts` (and the `local-time.ts` module it now uses as its
// own DST-exact engine) both carry `import "server-only"`, which plain
// Node cannot resolve directly (the real `server-only` npm package is
// not installed at all — Next's own bundler special-cases the literal
// specifier), and `day-bounds.ts` imports `local-time.ts` via a real,
// non-type-only, extensionless relative specifier (this project's own
// "moduleResolution": "bundler" convention), which Node's native ESM
// resolver also cannot resolve directly (no automatic `.ts`-appending
// the way a bundler does). This file registers a small, permanent,
// tracked loader hook (server-only-stub-loader.mjs, alongside this test
// file) that resolves both of those PURELY MECHANICAL module-resolution
// gaps — it fakes NOTHING about timezone/date logic; `organizationDay
// BoundsUtc` and `organizationLocalToUtc` are both imported and
// exercised completely unmodified, exactly as required ("Do not write a
// fake timezone implementation just for the test. Use the actual
// day-boundary helper.").
//
// Run with:
//   node --test src/lib/operations/day-bounds-tomorrow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// `register`'s second argument is the PARENT URL relative paths resolve
// against, not this test file's own location -- these test files are
// always invoked with the project root as the working directory
// (matching `npm test`'s own established convention), so `./` here
// means the project root, and the loader path below is root-relative.
register("./src/lib/operations/server-only-stub-loader.mjs", pathToFileURL("./"));

const { organizationDayBoundsUtc } = await import("./day-bounds.ts");

const HOUR_MS = 60 * 60 * 1000;

function tomorrowBoundsUtc(now, timezone) {
  const today = organizationDayBoundsUtc(now, timezone);
  return organizationDayBoundsUtc(today.endUtc, timezone);
}

// ---------------------------------------------------------------------
// EXACT BOUNDS — organizationDayBoundsUtc itself, ordinary days
// ---------------------------------------------------------------------

test("organizationDayBoundsUtc — normal day, America/New_York — exactly 24h, exact start/end instants", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-06-14T15:00:00.000Z"), "America/New_York");
  assert.equal(bounds.startUtc.toISOString(), "2026-06-14T04:00:00.000Z"); // midnight EDT June 14
  assert.equal(bounds.endUtc.toISOString(), "2026-06-15T04:00:00.000Z"); // midnight EDT June 15
  assert.equal(bounds.endUtc.getTime() - bounds.startUtc.getTime(), 24 * HOUR_MS);
});

test("organizationDayBoundsUtc — UTC (no DST at all) — exactly 24h", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-06-14T15:00:00.000Z"), "UTC");
  assert.equal(bounds.startUtc.toISOString(), "2026-06-14T00:00:00.000Z");
  assert.equal(bounds.endUtc.toISOString(), "2026-06-15T00:00:00.000Z");
  assert.equal(bounds.endUtc.getTime() - bounds.startUtc.getTime(), 24 * HOUR_MS);
});

test("organizationDayBoundsUtc — America/Phoenix (never observes DST) — exactly 24h year-round", () => {
  // Checked during a date that IS DST-active elsewhere, to prove
  // Phoenix's own fixed -7:00 offset is genuinely unaffected.
  const bounds = organizationDayBoundsUtc(new Date("2026-06-14T15:00:00.000Z"), "America/Phoenix");
  assert.equal(bounds.startUtc.toISOString(), "2026-06-14T07:00:00.000Z"); // midnight MST (-7) June 14
  assert.equal(bounds.endUtc.toISOString(), "2026-06-15T07:00:00.000Z");
  assert.equal(bounds.endUtc.getTime() - bounds.startUtc.getTime(), 24 * HOUR_MS);
});

// ---------------------------------------------------------------------
// EXACT BOUNDS — the DST transition days THEMSELVES (not "tomorrow" —
// organizationDayBoundsUtc queried directly for the transition date)
// ---------------------------------------------------------------------

test("organizationDayBoundsUtc — spring-forward day itself (America/New_York, 2026-03-08) — EXACTLY 23 hours, no tolerance", () => {
  // `now` supplied as a moment already ON March 8 (post-transition, 10am
  // EDT) -- proves the exact-bounds fix is correct regardless of which
  // side of the transition `now` itself falls on, unlike the old
  // +24h-from-a-possibly-wrong-offset implementation.
  const bounds = organizationDayBoundsUtc(new Date("2026-03-08T14:00:00.000Z"), "America/New_York");
  assert.equal(bounds.startUtc.toISOString(), "2026-03-08T05:00:00.000Z"); // midnight EST (still -5, pre-2am-transition)
  assert.equal(bounds.endUtc.toISOString(), "2026-03-09T04:00:00.000Z"); // midnight EDT March 9 (-4)
  assert.equal(bounds.endUtc.getTime() - bounds.startUtc.getTime(), 23 * HOUR_MS, "spring-forward local day must be EXACTLY 23 hours");
});

test("organizationDayBoundsUtc — fall-back day itself (America/New_York, 2026-11-01) — EXACTLY 25 hours, no tolerance", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-11-01T20:00:00.000Z"), "America/New_York"); // post-transition, 3pm EST
  assert.equal(bounds.startUtc.toISOString(), "2026-11-01T04:00:00.000Z"); // midnight EDT (-4, pre-2am-transition)
  assert.equal(bounds.endUtc.toISOString(), "2026-11-02T05:00:00.000Z"); // midnight EST Nov 2 (-5)
  assert.equal(bounds.endUtc.getTime() - bounds.startUtc.getTime(), 25 * HOUR_MS, "fall-back local day must be EXACTLY 25 hours");
});

// ---------------------------------------------------------------------
// TOMORROW COMPOSITION — spring-forward and fall-back, composed via
// today.endUtc, exactly as Tomorrow Readiness itself does
// ---------------------------------------------------------------------

test("tomorrow composition — spring-forward: 'today'=Mar 7 -> 'tomorrow'=Mar 8, EXACTLY 23 hours", () => {
  const now = new Date("2026-03-07T15:00:00.000Z"); // Mar 7, 10am EST
  const tomorrow = tomorrowBoundsUtc(now, "America/New_York");
  assert.equal(tomorrow.startUtc.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(tomorrow.endUtc.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(tomorrow.endUtc.getTime() - tomorrow.startUtc.getTime(), 23 * HOUR_MS);
});

test("tomorrow composition — fall-back: 'today'=Oct 31 -> 'tomorrow'=Nov 1, EXACTLY 25 hours", () => {
  const now = new Date("2026-10-31T14:00:00.000Z"); // Oct 31, 10am EDT
  const tomorrow = tomorrowBoundsUtc(now, "America/New_York");
  assert.equal(tomorrow.startUtc.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(tomorrow.endUtc.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(tomorrow.endUtc.getTime() - tomorrow.startUtc.getTime(), 25 * HOUR_MS);
});

test("tomorrow composition — proves the composition is NOT equivalent to a naive 24h-later Date on a DST transition day", () => {
  const now = new Date("2026-03-07T15:00:00.000Z");
  const correctTomorrow = tomorrowBoundsUtc(now, "America/New_York");
  const naive24hLater = new Date(now.getTime() + 24 * HOUR_MS);
  assert.notEqual(naive24hLater.toISOString(), correctTomorrow.startUtc.toISOString());
});

// ---------------------------------------------------------------------
// PREVIOUSLY-BROKEN ONE-HOUR EDGE — the exact instants that used to leak
// in/out incorrectly under the old +24h implementation
// ---------------------------------------------------------------------

test("spring-forward edge — an instant in the FIRST hour of March 9 (04:00-05:00Z) must NOT be inside March 8's window (old bug: it was)", () => {
  const now = new Date("2026-03-07T15:00:00.000Z");
  const march8 = tomorrowBoundsUtc(now, "America/New_York");
  const firstHourOfMarch9 = new Date("2026-03-09T04:30:00.000Z"); // 00:30 EDT March 9 -- genuinely March 9, not March 8
  assert.ok(firstHourOfMarch9.getTime() >= march8.endUtc.getTime(), "this instant must be AT OR AFTER March 8's own endUtc, i.e. excluded from March 8's [start,end) window");
});

test("fall-back edge — an instant in the LAST legitimate hour of Nov 1 (04:00-05:00Z Nov 2, i.e. 23:00-24:00 EST Nov 1) MUST remain included in Nov 1's window (old bug: it was excluded)", () => {
  const now = new Date("2026-10-31T14:00:00.000Z");
  const nov1 = tomorrowBoundsUtc(now, "America/New_York");
  const lastHourOfNov1 = new Date("2026-11-02T04:30:00.000Z"); // 23:30 EST Nov 1 -- genuinely still Nov 1
  assert.ok(lastHourOfNov1.getTime() >= nov1.startUtc.getTime() && lastHourOfNov1.getTime() < nov1.endUtc.getTime(), "this instant must be INSIDE Nov 1's own [start,end) window");
});

// ---------------------------------------------------------------------
// [start, end) INCLUSION/EXCLUSION — start included, just-before-end
// included, exactly-end excluded
// ---------------------------------------------------------------------

test("[start, end) semantics — start instant included, 1ms before end included, exactly end excluded (normal day)", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-06-14T15:00:00.000Z"), "America/New_York");
  const isInWindow = (instant) => instant.getTime() >= bounds.startUtc.getTime() && instant.getTime() < bounds.endUtc.getTime();
  assert.equal(isInWindow(bounds.startUtc), true, "start instant itself must be included");
  assert.equal(isInWindow(new Date(bounds.endUtc.getTime() - 1)), true, "1ms before end must be included");
  assert.equal(isInWindow(bounds.endUtc), false, "the end instant itself must be EXCLUDED (half-open interval)");
});

test("[start, end) semantics hold identically on the spring-forward (23h) day", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-03-08T14:00:00.000Z"), "America/New_York");
  const isInWindow = (instant) => instant.getTime() >= bounds.startUtc.getTime() && instant.getTime() < bounds.endUtc.getTime();
  assert.equal(isInWindow(bounds.startUtc), true);
  assert.equal(isInWindow(new Date(bounds.endUtc.getTime() - 1)), true);
  assert.equal(isInWindow(bounds.endUtc), false);
});

test("[start, end) semantics hold identically on the fall-back (25h) day", () => {
  const bounds = organizationDayBoundsUtc(new Date("2026-11-01T20:00:00.000Z"), "America/New_York");
  const isInWindow = (instant) => instant.getTime() >= bounds.startUtc.getTime() && instant.getTime() < bounds.endUtc.getTime();
  assert.equal(isInWindow(bounds.startUtc), true);
  assert.equal(isInWindow(new Date(bounds.endUtc.getTime() - 1)), true);
  assert.equal(isInWindow(bounds.endUtc), false);
});
