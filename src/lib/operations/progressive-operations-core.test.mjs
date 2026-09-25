// Unit tests for the pure fact-signal composition (P1-OPS-PROG3B).
//   node --test src/lib/operations/progressive-operations-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { composeOperationsBrief, isFreshOrganization } = await import("./progressive-operations-core.ts");

// A calm, established, fully-loaded baseline: an active day with nothing waiting.
function signals(overrides = {}) {
  return {
    dayState: "ACTIVE_DAY",
    attentionCount: 0,
    todayUnassignedCount: 0,
    activeNowCount: 0,
    nextDepartureCount: 0,
    nextTodayPickupAt: null,
    pendingRequestCount: 0,
    tomorrowTripCount: 0,
    tomorrowNeedsPreparationCount: 0,
    activeRecurringCount: 0,
    recurringMissingCount: 0,
    proofCompletedCount: 0,
    proofReviewCount: 0,
    activeDriverCount: 1,
    hasEverHadTrip: true,
    checklistComplete: true,
    ...overrides,
  };
}
const calmKeys = (c) => c.calm.map((l) => (l.key === "unavailable" ? `unavailable:${l.section}` : `${l.key}:${l.state}`));

test("P0: attention > 0 -> Attention first; no calm headline line", () => {
  const c = composeOperationsBrief(signals({ attentionCount: 1 }));
  assert.deepEqual(c.work, ["attention"]);
  assert.equal(c.headline, "attention_present");
});

test("attention = 0 -> no Attention panel; 'Nothing needs attention' headline", () => {
  const c = composeOperationsBrief(signals());
  assert.equal(c.work.includes("attention"), false);
  assert.equal(c.headline, "nothing_needs_attention");
});

test("P1..P5 individually", () => {
  assert.deepEqual(composeOperationsBrief(signals({ pendingRequestCount: 2 })).work, ["requests"]);
  assert.deepEqual(composeOperationsBrief(signals({ activeNowCount: 1 })).work, ["today"]);
  assert.deepEqual(composeOperationsBrief(signals({ nextDepartureCount: 1 })).work, ["today"]);
  assert.deepEqual(composeOperationsBrief(signals({ tomorrowTripCount: 4, tomorrowNeedsPreparationCount: 2 })).work, ["tomorrow"]);
  assert.deepEqual(composeOperationsBrief(signals({ activeRecurringCount: 3, recurringMissingCount: 1 })).work, ["recurring"]);
  assert.deepEqual(composeOperationsBrief(signals({ proofCompletedCount: 5, proofReviewCount: 2 })).work, ["proof"]);
});

test("dispatch-heavy facts -> P0, P1, P2, P3, P4, P5, then calm", () => {
  const c = composeOperationsBrief(
    signals({
      attentionCount: 4, todayUnassignedCount: 2, activeNowCount: 6, nextDepartureCount: 8, pendingRequestCount: 5,
      tomorrowTripCount: 30, tomorrowNeedsPreparationCount: 6, activeRecurringCount: 12, recurringMissingCount: 3,
      proofCompletedCount: 20, proofReviewCount: 4, activeDriverCount: 12,
    }),
  );
  assert.deepEqual(c.work, ["attention", "requests", "today", "tomorrow", "recurring", "proof"]);
  assert.deepEqual(calmKeys(c), ["drivers:snapshot"]);
});

test("one-person composition (1 driver, 3 today, 1 pending, tomorrow 4 ready, no recurring)", () => {
  const c = composeOperationsBrief(
    signals({ activeNowCount: 1, nextDepartureCount: 1, pendingRequestCount: 1, tomorrowTripCount: 4, proofCompletedCount: 2, activeDriverCount: 1 }),
  );
  assert.equal(c.headline, "nothing_needs_attention");
  assert.deepEqual(c.work, ["requests", "today"]);
  assert.deepEqual(calmKeys(c), ["tomorrow:ready", "proof:ready"]);
});

test("small-fleet composition", () => {
  const c = composeOperationsBrief(
    signals({
      attentionCount: 2, todayUnassignedCount: 2, activeNowCount: 2, nextDepartureCount: 3, pendingRequestCount: 2,
      tomorrowTripCount: 6, tomorrowNeedsPreparationCount: 2, activeRecurringCount: 1, proofCompletedCount: 5, activeDriverCount: 3,
    }),
  );
  assert.deepEqual(c.work, ["attention", "requests", "today", "tomorrow"]);
  assert.deepEqual(calmKeys(c), ["recurring:covered", "proof:ready", "drivers:snapshot"]);
});

test("all-clear composition", () => {
  const c = composeOperationsBrief(
    signals({ dayState: "ALL_COMPLETE", tomorrowTripCount: 5, activeRecurringCount: 2, proofCompletedCount: 3, activeDriverCount: 2 }),
  );
  assert.equal(c.headline, "all_clear");
  assert.deepEqual(c.work, []);
  assert.deepEqual(calmKeys(c), ["tomorrow:ready", "requests:none", "recurring:covered", "proof:ready", "drivers:snapshot"]);
});

test("today complete but other work waiting -> 'all_complete', not 'all_clear'", () => {
  assert.equal(composeOperationsBrief(signals({ dayState: "ALL_COMPLETE", pendingRequestCount: 1 })).headline, "all_complete");
});

test("null != zero: every null summary becomes an unavailable line, never omitted, never a zero line", () => {
  const c = composeOperationsBrief(
    signals({ pendingRequestCount: null, tomorrowTripCount: null, tomorrowNeedsPreparationCount: null, activeRecurringCount: null, recurringMissingCount: null, proofCompletedCount: null, proofReviewCount: null, activeDriverCount: null }),
  );
  assert.deepEqual(calmKeys(c), ["unavailable:tomorrow", "unavailable:requests", "unavailable:recurring", "unavailable:proof", "unavailable:drivers"]);
  assert.deepEqual(c.work, []);
});

test("today unavailable -> headline today_unavailable; no Attention/Today sections", () => {
  const c = composeOperationsBrief(signals({ dayState: "UNAVAILABLE", attentionCount: null, activeNowCount: null, nextDepartureCount: null, todayUnassignedCount: null }));
  assert.equal(c.headline, "today_unavailable");
  assert.equal(c.work.includes("attention") || c.work.includes("today"), false);
});

test("Driver Snapshot: 0 with trips -> work row; 0 without trips -> nothing; 1 -> omitted; 2+ -> calm line", () => {
  assert.ok(composeOperationsBrief(signals({ activeDriverCount: 0 })).work.includes("noActiveDrivers"));
  const noTrips = composeOperationsBrief(signals({ activeDriverCount: 0, hasEverHadTrip: false, checklistComplete: true }));
  assert.equal(noTrips.kind, "standard");
  assert.equal(noTrips.work.includes("noActiveDrivers"), false);
  assert.equal(calmKeys(composeOperationsBrief(signals({ activeDriverCount: 1 }))).includes("drivers:snapshot"), false);
  assert.ok(calmKeys(composeOperationsBrief(signals({ activeDriverCount: 2 }))).includes("drivers:snapshot"));
});

test("Recurring: 0 arrangements -> omitted; covered -> calm; missing -> P4", () => {
  assert.equal(calmKeys(composeOperationsBrief(signals())).some((k) => k.startsWith("recurring")), false);
  assert.ok(calmKeys(composeOperationsBrief(signals({ activeRecurringCount: 2 }))).includes("recurring:covered"));
  assert.ok(composeOperationsBrief(signals({ activeRecurringCount: 2, recurringMissingCount: 1 })).work.includes("recurring"));
});

test("Proof: always present -- review -> P5; completed -> calm ready; none -> calm none", () => {
  assert.ok(composeOperationsBrief(signals({ proofCompletedCount: 3, proofReviewCount: 1 })).work.includes("proof"));
  assert.ok(calmKeys(composeOperationsBrief(signals({ proofCompletedCount: 3 }))).includes("proof:ready"));
  assert.ok(calmKeys(composeOperationsBrief(signals())).includes("proof:none"));
});

test("Tomorrow: needs prep -> P3; ready -> calm ready; none -> calm none", () => {
  assert.ok(composeOperationsBrief(signals({ tomorrowTripCount: 2, tomorrowNeedsPreparationCount: 1 })).work.includes("tomorrow"));
  assert.ok(calmKeys(composeOperationsBrief(signals({ tomorrowTripCount: 2 }))).includes("tomorrow:ready"));
  assert.ok(calmKeys(composeOperationsBrief(signals())).includes("tomorrow:none"));
});

test("Today block: collapsed line when nothing live; Next Departures shown alongside Active Now", () => {
  const later = composeOperationsBrief(signals({ nextTodayPickupAt: "2026-09-25T20:15:00.000Z" }));
  assert.equal(later.work.includes("today"), false);
  assert.equal(later.todayDetail, "next_trip_later_today");
  assert.equal(composeOperationsBrief(signals()).todayDetail, "nothing_departing_soon");
  const live = composeOperationsBrief(signals({ activeNowCount: 1 }));
  assert.equal(live.todayShowsActiveNow, true);
  assert.equal(live.todayShowsNextDepartures, true);
  const depOnly = composeOperationsBrief(signals({ nextDepartureCount: 2 }));
  assert.equal(depOnly.todayShowsActiveNow, false);
});

test("fresh-org predicate: only never-had-trip AND checklist incomplete; unknown is never fresh", () => {
  assert.equal(isFreshOrganization({ hasEverHadTrip: false, checklistComplete: false }), true);
  assert.equal(isFreshOrganization({ hasEverHadTrip: true, checklistComplete: false }), false);
  assert.equal(isFreshOrganization({ hasEverHadTrip: null, checklistComplete: null }), false);
  const fresh = composeOperationsBrief(signals({ hasEverHadTrip: false, checklistComplete: false, pendingRequestCount: 0 }));
  assert.deepEqual(fresh, { kind: "fresh", showRequests: false, requestsUnavailable: false });
  assert.equal(composeOperationsBrief(signals({ hasEverHadTrip: false, checklistComplete: false, pendingRequestCount: 1 })).showRequests, true);
});

test("business_stage / size inputs have no effect (not part of the signal contract)", () => {
  const base = composeOperationsBrief(signals({ pendingRequestCount: 1 }));
  for (const stage of ["starting", "growing", "established", null]) {
    assert.deepEqual(composeOperationsBrief({ ...signals({ pendingRequestCount: 1 }), business_stage: stage, vehicleCount: 40, hasDispatcher: true }), base);
  }
});
