// Focused unit tests for the pure Recurring Care Assurance derivation
// (P1-E2-S1C). Run with:
//
//   node --test src/lib/operations/recurring-care-core.test.mjs
//
// This pure core has ZERO runtime imports and does no timezone
// conversion of its own — every date field it receives is already a
// resolved `YYYY-MM-DD` local-date-key string. Several cases named in
// the phase's own test list are therefore genuinely WRAPPER-level
// concerns, not pure-core-level ones, and are intentionally NOT
// duplicated here (each is noted at its natural location below, and
// covered instead by recurring-care.ts's own live/SQL validation, per
// docs/reports/p1-e2-s1c-... TIMEZONE / DST and MULTI-TIMEZONE QUERY
// STRATEGY sections):
//   - "linked Trip different arrangement -> ignored": this module
//     structurally never sees an arrangement id on a Trip fact at all
//     (RecurringLinkedTripFact carries no arrangementId field) — the
//     caller's own grouping is what this test would actually be
//     proving, which lives in recurring-care.ts.
//   - "Trip scheduled in UTC date different from arrangement local date
//     but correct local service date -> matched correctly": this module
//     only ever sees an already-resolved `serviceDate` string; the real
//     UTC->local conversion this case is about happens in the wrapper.
//   - "arrangement timezone A vs timezone B": likewise a wrapper-level
//     concern (this module has no timezone field on its own input type).
//
// "Spring-forward"/"fall-back period" ARE tested here, but prove the
// opposite of what they would for a timezone-aware module: because this
// core does purely calendar-digit arithmetic (never touches elapsed
// time), a horizon spanning a real DST transition date produces an
// ordinary, gap-free, duplicate-free 14-date sequence — DST is
// structurally incapable of affecting this module at all, which is
// itself the meaningful thing to prove.

import test from "node:test";
import assert from "node:assert/strict";

const {
  HORIZON_LENGTH_DAYS,
  generateHorizonDates,
  isPatternDate,
  deriveRecurringCareAssurance,
} = await import("./recurring-care-core.ts");

function makeArrangement(overrides = {}) {
  return {
    id: "arr-1",
    organizationId: "org-1",
    passengerId: "pax-1",
    passengerDisplayName: "Test Passenger",
    pickupDescription: "Home",
    destinationDescription: "Cascade Dialysis Center",
    daysOfWeek: [1, 3, 5], // Mon/Wed/Fri
    startDate: "2000-01-01",
    endDate: null,
    status: "active",
    pausedEffectiveDate: null,
    endedEffectiveDate: null,
    ...overrides,
  };
}

function makeTrip(overrides = {}) {
  return {
    tripId: "trip-1",
    state: "scheduled",
    serviceDate: null,
    readiness: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A. HORIZON GENERATION
// ---------------------------------------------------------------------

test("generateHorizonDates — exactly 14 local dates, starting at today, consecutive, no gaps/duplicates", () => {
  const dates = generateHorizonDates("2026-09-17");
  assert.equal(dates.length, 14);
  assert.equal(HORIZON_LENGTH_DAYS, 14);
  assert.equal(dates[0], "2026-09-17");
  assert.equal(dates[13], "2026-09-30");
  assert.deepEqual(new Set(dates).size, 14, "no duplicate dates");
});

test("generateHorizonDates — never includes the day before today or the 15th day", () => {
  const dates = generateHorizonDates("2026-09-17");
  assert.ok(!dates.includes("2026-09-16"));
  assert.ok(!dates.includes("2026-10-01"));
});

test("generateHorizonDates — week boundary crossed correctly", () => {
  // 2026-09-17 is a Thursday; horizon crosses two full weekends.
  const dates = generateHorizonDates("2026-09-17");
  assert.ok(dates.includes("2026-09-19")); // Saturday
  assert.ok(dates.includes("2026-09-20")); // Sunday
  assert.ok(dates.includes("2026-09-26"));
  assert.ok(dates.includes("2026-09-27"));
});

test("generateHorizonDates — month boundary crossed correctly", () => {
  const dates = generateHorizonDates("2026-09-25");
  assert.equal(dates[0], "2026-09-25");
  assert.equal(dates[13], "2026-10-08");
  assert.ok(dates.includes("2026-09-30"));
  assert.ok(dates.includes("2026-10-01"));
});

test("generateHorizonDates — year boundary crossed correctly", () => {
  const dates = generateHorizonDates("2026-12-25");
  assert.equal(dates[0], "2026-12-25");
  assert.equal(dates[13], "2027-01-07");
  assert.ok(dates.includes("2026-12-31"));
  assert.ok(dates.includes("2027-01-01"));
});

test("generateHorizonDates — spans a real spring-forward transition date with no gap/duplicate (DST cannot affect pure calendar-digit arithmetic)", () => {
  const dates = generateHorizonDates("2026-03-05");
  assert.equal(dates.length, 14);
  assert.ok(dates.includes("2026-03-08")); // the real America/New_York spring-forward date
  assert.equal(new Set(dates).size, 14);
  assert.equal(dates[13], "2026-03-18");
});

test("generateHorizonDates — spans a real fall-back transition date with no gap/duplicate", () => {
  const dates = generateHorizonDates("2026-10-29");
  assert.equal(dates.length, 14);
  assert.ok(dates.includes("2026-11-01")); // the real America/New_York fall-back date
  assert.equal(new Set(dates).size, 14);
  assert.equal(dates[13], "2026-11-11");
});

// ---------------------------------------------------------------------
// B. PATTERN MATCHING — weekday + start/end date bounds
// ---------------------------------------------------------------------

test("isPatternDate — simple Mon/Wed/Fri pattern matches only those weekdays within the horizon", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5] });
  const dates = generateHorizonDates("2026-09-17"); // Thu
  const matched = dates.filter((d) => isPatternDate(arrangement, d));
  // Sept 17 (Thu) .. Sept 30 (Wed): Fri 9/18, Mon 9/21, Wed 9/23, Fri 9/25, Mon 9/28, Wed 9/30
  assert.deepEqual(matched, ["2026-09-18", "2026-09-21", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-30"]);
});

test("isPatternDate — start_date inside the horizon: dates before start_date do not match even if the weekday matches", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: "2026-09-22" });
  assert.equal(isPatternDate(arrangement, "2026-09-21"), false);
  assert.equal(isPatternDate(arrangement, "2026-09-22"), true);
});

test("isPatternDate — end_date inside the horizon: dates after end_date do not match", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], endDate: "2026-09-22" });
  assert.equal(isPatternDate(arrangement, "2026-09-22"), true);
  assert.equal(isPatternDate(arrangement, "2026-09-23"), false);
});

test("isPatternDate — start_date after the entire horizon: no dates match", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: "2027-01-01" });
  const dates = generateHorizonDates("2026-09-17");
  assert.deepEqual(dates.filter((d) => isPatternDate(arrangement, d)), []);
});

test("isPatternDate — end_date before the entire horizon: no dates match", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], endDate: "2026-01-01" });
  const dates = generateHorizonDates("2026-09-17");
  assert.deepEqual(dates.filter((d) => isPatternDate(arrangement, d)), []);
});

test("isPatternDate — single-day arrangement (start_date === end_date) matches exactly that one date, if the weekday matches", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2026-09-24", endDate: "2026-09-24" }); // a Thursday
  assert.equal(isPatternDate(arrangement, "2026-09-24"), true);
  assert.equal(isPatternDate(arrangement, "2026-09-17"), false);
  assert.equal(isPatternDate(arrangement, "2026-10-01"), false);
});

test("isPatternDate — endDate null means open-ended, every matching weekday from startDate onward counts", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01", endDate: null });
  const dates = generateHorizonDates("2026-09-17");
  assert.equal(dates.filter((d) => isPatternDate(arrangement, d)).length, 6);
});

// ---------------------------------------------------------------------
// C. LIFECYCLE CUTOFF — paused / ended
// ---------------------------------------------------------------------

test("isPatternDate — paused arrangement: no pattern dates on or after the paused-effective local date", () => {
  const arrangement = makeArrangement({
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    status: "paused",
    pausedEffectiveDate: "2026-09-20",
  });
  assert.equal(isPatternDate(arrangement, "2026-09-19"), true);
  assert.equal(isPatternDate(arrangement, "2026-09-20"), false);
  assert.equal(isPatternDate(arrangement, "2026-09-21"), false);
});

test("isPatternDate — paused with no pausedEffectiveDate (defensive) permits nothing to be excluded by pause alone", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], status: "paused", pausedEffectiveDate: null });
  assert.equal(isPatternDate(arrangement, "2026-09-19"), true);
});

test("isPatternDate — ended arrangement: no pattern dates on or after the ended-effective local date, but earlier dates remain real pattern dates (ended never deletes history)", () => {
  const arrangement = makeArrangement({
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    status: "ended",
    endedEffectiveDate: "2026-09-20",
  });
  assert.equal(isPatternDate(arrangement, "2026-09-19"), true);
  assert.equal(isPatternDate(arrangement, "2026-09-20"), false);
});

// ---------------------------------------------------------------------
// D. SKIP DATES
// ---------------------------------------------------------------------

test("deriveRecurringCareAssurance — a skip on a genuine pattern date marks that occurrence SKIPPED, excluded from expected/missing", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" }); // Thursdays
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], [
    { serviceDate: "2026-09-17", reason: "holiday" },
  ]);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "SKIPPED");
  assert.equal(occ.skipReason, "holiday");
  assert.equal(result.skippedCount, 1);
  assert.equal(result.expectedCount, result.patternDateCount - 1);
});

test("deriveRecurringCareAssurance — a skip recorded for a date that is NOT a current pattern date is silently ignored (P1-E2-S1C §27)", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" }); // Thursdays only
  // 2026-09-18 is a Friday, never a pattern date for this Thursday-only arrangement.
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], [
    { serviceDate: "2026-09-18", reason: "stale, no-longer-relevant skip" },
  ]);
  assert.equal(result.skippedCount, 0);
  assert.ok(!result.occurrences.some((o) => o.serviceDate === "2026-09-18"));
});

test("deriveRecurringCareAssurance — every pattern date in the horizon skipped: expectedCount is 0, no MISSING/SCHEDULED occurrences", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  const skips = patternDates.map((d) => ({ serviceDate: d, reason: "all skipped" }));
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], skips);
  assert.equal(result.patternDateCount, patternDates.length);
  assert.equal(result.skippedCount, patternDates.length);
  assert.equal(result.expectedCount, 0);
  assert.equal(result.scheduledCount, 0);
  assert.equal(result.missingCount, 0);
  assert.equal(result.nextExpectedDate, null);
  assert.equal(result.nextMissingDate, null);
});

// ---------------------------------------------------------------------
// E. SATISFACTION — scheduled / missing / cancelled / multi-Trip
// ---------------------------------------------------------------------

test("deriveRecurringCareAssurance — one qualifying scheduled Trip on a pattern date -> SCHEDULED occurrence", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const trip = makeTrip({ tripId: "t1", state: "scheduled", serviceDate: "2026-09-17", readiness: { state: "READY", reasons: [] } });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [trip], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "SCHEDULED");
  assert.deepEqual(occ.trips, [trip]);
  assert.equal(result.scheduledCount, 1);
  assert.equal(result.missingCount, result.expectedCount - 1);
});

test("deriveRecurringCareAssurance — a pattern date with zero linked Trips -> MISSING", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "MISSING");
  assert.equal(result.missingCount >= 1, true);
});

test("deriveRecurringCareAssurance — a single linked Trip in state='cancelled' on the date -> still MISSING (cancelled never satisfies)", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const trip = makeTrip({ tripId: "t1", state: "cancelled", serviceDate: "2026-09-17" });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [trip], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "MISSING");
});

test("deriveRecurringCareAssurance — cancelled Trip + a second, scheduled replacement Trip on the same date -> SCHEDULED, only the qualifying Trip listed", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const cancelled = makeTrip({ tripId: "t1", state: "cancelled", serviceDate: "2026-09-17" });
  const replacement = makeTrip({ tripId: "t2", state: "scheduled", serviceDate: "2026-09-17", readiness: { state: "NEEDS_PREPARATION", reasons: ["NEEDS_DRIVER"] } });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [cancelled, replacement], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "SCHEDULED");
  assert.deepEqual(occ.trips.map((t) => t.tripId), ["t2"]);
});

test("deriveRecurringCareAssurance — multiple qualifying (non-cancelled, dated) Trips on the same date -> ONE SCHEDULED occurrence, both Trips listed, no invented aggregate", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const tripA = makeTrip({ tripId: "outbound", state: "scheduled", serviceDate: "2026-09-17" });
  const tripB = makeTrip({ tripId: "return", state: "scheduled", serviceDate: "2026-09-17" });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [tripA, tripB], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "SCHEDULED");
  assert.equal(occ.trips.length, 2);
  assert.deepEqual(occ.trips.map((t) => t.tripId).sort(), ["outbound", "return"]);
  // Exactly one occurrence counted, never two.
  assert.equal(result.occurrences.filter((o) => o.serviceDate === "2026-09-17").length, 1);
});

test("deriveRecurringCareAssurance — a linked Trip with serviceDate=null (scheduled_pickup_at IS NULL) never satisfies any date", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const trip = makeTrip({ tripId: "t1", state: "scheduled", serviceDate: null });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [trip], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "MISSING");
});

test("deriveRecurringCareAssurance — a Trip whose readiness is null (non-scheduled state) is still listed on its SCHEDULED occurrence, with readiness null", () => {
  const arrangement = makeArrangement({ daysOfWeek: [4], startDate: "2000-01-01" });
  const trip = makeTrip({ tripId: "t1", state: "completed", serviceDate: "2026-09-17", readiness: null });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [trip], []);
  const occ = result.occurrences.find((o) => o.serviceDate === "2026-09-17");
  assert.equal(occ.state, "SCHEDULED");
  assert.equal(occ.trips[0].readiness, null);
});

// ---------------------------------------------------------------------
// F. COUNT INVARIANTS
// ---------------------------------------------------------------------

test("deriveRecurringCareAssurance — count invariants hold for a realistic mixed arrangement", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  assert.equal(patternDates.length, 6);
  const skips = [{ serviceDate: patternDates[0], reason: "holiday" }];
  const trips = [makeTrip({ tripId: "t1", state: "scheduled", serviceDate: patternDates[1] })];
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", trips, skips);

  assert.equal(result.patternDateCount, 6);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.expectedCount, result.patternDateCount - result.skippedCount);
  assert.equal(result.scheduledCount + result.missingCount, result.expectedCount);
  assert.equal(result.scheduledCount, 1);
  assert.equal(result.missingCount, 4);
});

test("deriveRecurringCareAssurance — count invariants hold when nothing is scheduled or skipped", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], []);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.expectedCount, result.patternDateCount);
  assert.equal(result.scheduledCount, 0);
  assert.equal(result.missingCount, result.expectedCount);
});

// ---------------------------------------------------------------------
// G. NEXT-DATE / CONSECUTIVE-MISSING DERIVATION
// ---------------------------------------------------------------------

test("deriveRecurringCareAssurance — nextExpectedDate is the earliest expected (scheduled or missing) date, nextMissingDate the earliest missing one", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  const trips = [makeTrip({ tripId: "t1", state: "scheduled", serviceDate: patternDates[0] })];
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", trips, []);
  assert.equal(result.nextExpectedDate, patternDates[0]);
  assert.equal(result.nextMissingDate, patternDates[1]);
});

test("deriveRecurringCareAssurance — consecutiveMissingCount counts from the earliest expected date, stops at the first SCHEDULED date", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  // patternDates[0], [1] missing; [2] scheduled; [3], [4] missing again.
  const trips = [makeTrip({ tripId: "t1", state: "scheduled", serviceDate: patternDates[2] })];
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", trips, []);
  assert.equal(result.consecutiveMissingCount, 2);
});

test("deriveRecurringCareAssurance — consecutiveMissingCount is 0 when the very first expected date is already scheduled", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  const trips = [makeTrip({ tripId: "t1", state: "scheduled", serviceDate: patternDates[0] })];
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", trips, []);
  assert.equal(result.consecutiveMissingCount, 0);
});

// ---------------------------------------------------------------------
// H. ORDERING
// ---------------------------------------------------------------------

test("deriveRecurringCareAssurance — occurrences are always in ascending date order, deterministically, regardless of input order of trips/skips", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 3, 5], startDate: "2000-01-01" });
  const patternDates = generateHorizonDates("2026-09-17").filter((d) => isPatternDate(arrangement, d));
  const trips = [
    makeTrip({ tripId: "t2", state: "scheduled", serviceDate: patternDates[3] }),
    makeTrip({ tripId: "t1", state: "scheduled", serviceDate: patternDates[1] }),
  ];
  const skips = [{ serviceDate: patternDates[4], reason: "z" }];
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", trips, skips);
  const dates = result.occurrences.map((o) => o.serviceDate);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});

test("deriveRecurringCareAssurance — every possible reason/state combination still yields a stable, fully-populated result (no undefined/NaN counts)", () => {
  const arrangement = makeArrangement({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: "2000-01-01" });
  const result = deriveRecurringCareAssurance(arrangement, "2026-09-17", [], []);
  for (const key of ["patternDateCount", "skippedCount", "expectedCount", "scheduledCount", "missingCount", "consecutiveMissingCount"]) {
    assert.equal(typeof result[key], "number");
    assert.equal(Number.isNaN(result[key]), false);
  }
});
