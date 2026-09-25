// Unit tests for the pure trip extent + overlap core (P1-OPS-PROG4B).
//   node --test src/lib/operations/trip-overlap-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const {
  deriveTripExtent,
  intervalsOverlap,
  deriveResourceOverlap,
  formatTripExtent,
  formatDurationMinutes,
  isValidExpectedDuration,
  assignLanes,
  deriveAxisHours,
  MAX_EXPECTED_DURATION_MINUTES,
  OVERLAP_LOOKBACK_MS,
} = await import("./trip-overlap-core.ts");

const T0 = Date.parse("2026-10-10T13:00:00.000Z"); // 9:00 AM New York (EDT)
const iso = (offsetMin) => new Date(T0 + offsetMin * 60_000).toISOString();
const EARLY = T0 - 7 * 86_400_000; // "now" long before everything
const cand = (tripId, startOff, minutes, extra = {}) => ({
  tripId, state: "scheduled", scheduledPickupAt: startOff === null ? null : iso(startOff), expectedDurationMinutes: minutes,
  activeDriverId: "d1", activeVehicleId: "v1", ...extra,
});
const target = (startOff, minutes, extra = {}) => ({
  tripId: "target", scheduledPickupAt: startOff === null ? null : iso(startOff), expectedDurationMinutes: minutes, driverId: "d1", vehicleId: "v1", ...extra,
});
const run = (t, cs, now = EARLY) => deriveResourceOverlap(t, cs, now, "complete");
const runIncomplete = (t, cs, now = EARLY) => deriveResourceOverlap(t, cs, now, "incomplete");

test("extent: known / no duration / no schedule", () => {
  assert.deepEqual(deriveTripExtent(iso(0), 60), { kind: "known", startMs: T0, endMs: T0 + 3_600_000 });
  assert.equal(deriveTripExtent(iso(0), null).reason, "no_duration");
  assert.equal(deriveTripExtent(null, 60).reason, "no_schedule");
});

test("ceiling: 1..2880 valid; 0 / 2881 / non-integer invalid; look-back is 48 h", () => {
  assert.equal(MAX_EXPECTED_DURATION_MINUTES, 2880);
  assert.equal(OVERLAP_LOOKBACK_MS, 48 * 3_600_000);
  assert.ok(isValidExpectedDuration(1) && isValidExpectedDuration(2880) && isValidExpectedDuration(null));
  assert.ok(!isValidExpectedDuration(0) && !isValidExpectedDuration(2881) && !isValidExpectedDuration(1.5));
});

test("interval semantics: touching = no overlap; partial, containment, identical = overlap", () => {
  assert.equal(intervalsOverlap(0, 10, 10, 20), false);
  assert.equal(intervalsOverlap(0, 10, 5, 15), true);
  assert.equal(intervalsOverlap(0, 30, 10, 20), true);
  assert.equal(intervalsOverlap(0, 10, 0, 10), true);
});

test("boundary-touching trips are clear", () => {
  const r = run(target(60, 60), [cand("a", 0, 60)]);
  assert.equal(r.driver.status, "clear");
});

test("same driver and same vehicle overlap; both reported", () => {
  const r = run(target(30, 60), [cand("a", 0, 60)]);
  assert.equal(r.driver.status, "overlap");
  assert.deepEqual(r.driver.overlaps, ["a"]);
  assert.equal(r.vehicle.status, "overlap");
});

test("driver only / vehicle only / neither / different resources", () => {
  const driverOnly = run(target(30, 60), [cand("a", 0, 60, { activeVehicleId: "v9" })]);
  assert.equal(driverOnly.driver.status, "overlap");
  assert.equal(driverOnly.vehicle.status, "clear");
  const vehicleOnly = run(target(30, 60), [cand("a", 0, 60, { activeDriverId: "d9" })]);
  assert.equal(vehicleOnly.driver.status, "clear");
  assert.equal(vehicleOnly.vehicle.status, "overlap");
  const neither = run(target(30, 60), [cand("a", 0, 60, { activeDriverId: "d9", activeVehicleId: "v9" })]);
  assert.equal(neither.driver.status, "clear");
  assert.equal(neither.vehicle.status, "clear");
});

test("no vehicle on either side never matches; no resource selected -> null check", () => {
  const r = run(target(30, 60, { vehicleId: null }), [cand("a", 0, 60, { activeVehicleId: null })]);
  assert.equal(r.vehicle, null);
  const r2 = run(target(30, 60), [cand("a", 0, 60, { activeVehicleId: null })]);
  assert.equal(r2.vehicle.status, "clear");
});

test("target excluded; terminal candidates excluded; unassigned (ended assignment) never matches", () => {
  const r = run(target(0, 60), [
    cand("target", 0, 60),
    cand("done", 0, 60, { state: "completed" }),
    cand("cx", 0, 60, { state: "cancelled" }),
    cand("ns", 0, 60, { state: "no_show" }),
    cand("ended", 0, 60, { activeDriverId: null, activeVehicleId: null }),
  ]);
  assert.equal(r.driver.status, "clear");
  assert.equal(r.vehicle.status, "clear");
});

test("missing target extent -> not checkable (never overlap, never clear when something could matter)", () => {
  const r = run(target(0, null), [cand("a", 30, 60)]);
  assert.equal(r.targetExtent.kind, "unknown");
  assert.equal(r.driver.status, "not_checkable");
  assert.deepEqual(r.driver.overlaps, []);
  const earlier = run(target(120, null), [cand("a", 0, 60)]);
  assert.equal(earlier.driver.status, "clear", "a candidate that ends before the target starts is provably clear");
});

test("missing candidate extent -> not checkable, unless it starts at/after the target ends", () => {
  assert.equal(run(target(0, 60), [cand("a", 30, null)]).driver.status, "not_checkable");
  assert.deepEqual(run(target(0, 60), [cand("a", 30, null)]).driver.missingExtent, ["a"]);
  assert.equal(run(target(0, 60), [cand("a", 60, null)]).driver.status, "clear");
  assert.equal(run(target(0, 60), [cand("a", null, 30)]).driver.status, "not_checkable");
});

test("48-hour crossing and midnight: a 2880-min trip from two days ago still overlaps", () => {
  const r = run(target(0, 30), [cand("long", -2800, 2880)]);
  assert.equal(r.driver.status, "overlap");
  const midnight = run(target(15 * 60 + 30, 60), [cand("late", 15 * 60, 120)]); // 00:00-02:00 next day vs 00:30
  assert.equal(midnight.driver.status, "overlap");
});

test("DST: durations are absolute minutes (fall-back and spring-forward)", () => {
  const fallStart = Date.parse("2026-11-01T05:30:00.000Z"); // 1:30 AM EDT
  const e = deriveTripExtent(new Date(fallStart).toISOString(), 60);
  assert.equal(e.endMs - e.startMs, 3_600_000);
  assert.equal(formatTripExtent(e, "America/New_York"), "1:30 AM – 1:30 AM");
  const springStart = Date.parse("2026-03-08T06:30:00.000Z"); // 1:30 AM EST
  assert.equal(formatTripExtent(deriveTripExtent(new Date(springStart).toISOString(), 60), "America/New_York"), "1:30 AM – 3:30 AM");
});

test("still-open candidate BEFORE its planned end behaves like any known interval", () => {
  const now = T0 + 30 * 60_000; // candidate 9:00-10:00 is in progress, plan not yet expired
  const r = run(target(120, 60), [cand("a", 0, 60, { state: "passenger_onboard" })], now);
  assert.equal(r.driver.status, "clear");
});

test("still-open candidate AFTER its planned end: not falsely clear, not falsely extended", () => {
  const now = T0 + 105 * 60_000; // 10:45; candidate planned 9:00-10:00, still 'scheduled' with an active assignment
  const r = run(target(120, 60), [cand("a", 0, 60)], now); // target 11:00-12:00
  assert.equal(r.driver.status, "not_fully_checkable");
  assert.deepEqual(r.driver.stillOpenPastPlannedEnd, ["a"]);
  assert.deepEqual(r.driver.overlaps, [], "never an invented overlap");
  const inProgress = run(target(120, 60), [cand("a", 0, 60, { state: "en_route_to_destination" })], now);
  assert.equal(inProgress.driver.status, "not_fully_checkable");
});

test("known overlap is still established inside the planned portion of a still-open trip", () => {
  const now = T0 + 105 * 60_000;
  const r = run(target(30, 60), [cand("a", 0, 60)], now);
  assert.equal(r.driver.status, "overlap");
});

test("a target entirely before the still-open trip's planned end is clear", () => {
  const now = T0 + 300 * 60_000;
  const r = run(target(-120, 60), [cand("a", 0, 60)], now); // target 7:00-8:00, candidate planned 9:00-10:00
  assert.equal(r.driver.status, "clear");
});

test("an old still-open trip outside the 48 h start window is still reported as unresolved", () => {
  const now = T0 + 3 * 86_400_000;
  const r = run(target(3 * 24 * 60, 60), [cand("old", -60, 60)], now);
  assert.equal(r.driver.status, "not_fully_checkable");
});

test("missing and still-open reasons stay distinct", () => {
  const now = T0 + 105 * 60_000;
  const r = run(target(120, 60), [cand("a", 0, 60), cand("b", 150, null)], now);
  assert.equal(r.driver.status, "not_checkable");
  assert.deepEqual(r.driver.missingExtent, ["b"]);
  assert.deepEqual(r.driver.stillOpenPastPlannedEnd, ["a"]);
});

test("formatting: durations and extents incl. next day", () => {
  assert.equal(formatDurationMinutes(45), "45 min");
  assert.equal(formatDurationMinutes(90), "1 h 30 min");
  assert.equal(formatDurationMinutes(2880), "48 h");
  assert.equal(formatTripExtent(deriveTripExtent(iso(0), 45), "America/New_York"), "9:00 AM – 9:45 AM");
  assert.equal(formatTripExtent(deriveTripExtent(iso(14 * 60 + 30), 75), "America/New_York"), "11:30 PM – 12:45 AM (next day)");
  assert.equal(formatTripExtent(deriveTripExtent(iso(0), 2880), "America/New_York"), "9:00 AM – 9:00 AM (+2 days)");
  assert.equal(formatTripExtent(deriveTripExtent(iso(0), null), "America/New_York"), null);
});

test("deterministic lanes", () => {
  const lanes = assignLanes([
    { id: "b", left: 0, width: 100 },
    { id: "a", left: 0, width: 50 },
    { id: "c", left: 50, width: 50 },
    { id: "d", left: 100, width: 10 },
  ]);
  assert.deepEqual(Object.fromEntries(lanes), { a: 0, b: 1, c: 0, d: 0 });
  const again = assignLanes([{ id: "d", left: 100, width: 10 }, { id: "c", left: 50, width: 50 }, { id: "a", left: 0, width: 50 }, { id: "b", left: 0, width: 100 }]);
  assert.deepEqual(Object.fromEntries(again), Object.fromEntries(lanes));
});

test("axis: default 6-20, expanded to cover facts, clamped to 0-24", () => {
  assert.deepEqual(deriveAxisHours([]), { start: 6, end: 20 });
  assert.deepEqual(deriveAxisHours([{ start: 4.5, end: 5.5 }, { start: 21, end: 23.25 }]), { start: 4, end: 24 });
  assert.deepEqual(deriveAxisHours([{ start: 22, end: null }]), { start: 6, end: 23 });
});

test("notices: factual copy; clear shows nothing; reasons never mixed up", async () => {
  const { overlapNotices } = await import("./trip-overlap-core.ts");
  const clear = { status: "clear", missingExtentCount: 0, stillOpenCount: 0 };
  assert.deepEqual(overlapNotices({ targetUnknownReason: null, driver: clear, vehicle: clear }), []);
  const ov = overlapNotices({ targetUnknownReason: null, driver: { status: "overlap", missingExtentCount: 0, stillOpenCount: 0 }, vehicle: clear });
  assert.deepEqual(ov.map((n) => n.text), ["This driver has another trip during this time."]);
  const target = overlapNotices({ targetUnknownReason: "no_duration", driver: { status: "not_checkable", missingExtentCount: 1, stillOpenCount: 0 }, vehicle: null });
  assert.deepEqual(target.map((n) => n.text), ["Can't check for other trips at this time: this trip's duration isn't set."]);
  const mixed = overlapNotices({ targetUnknownReason: null, driver: { status: "not_checkable", missingExtentCount: 2, stillOpenCount: 1 }, vehicle: { status: "not_fully_checkable", missingExtentCount: 0, stillOpenCount: 1 } });
  assert.deepEqual(mixed.map((n) => n.kind), ["cannot_check", "cannot_fully_check", "cannot_fully_check"]);
  assert.ok(mixed[0].text.includes("2 of this driver's trips: duration not set"));
  assert.ok(mixed[2].text.startsWith("Can't fully check this vehicle"));
  for (const n of [...ov, ...target, ...mixed]) assert.doesNotMatch(n.text, /conflict|late|unavailable|impossible|score|recommend/i);
});

// ---------------------------------------------------------------------------
// P1-OPS-PROG4B-R1: candidate-set completeness
// ---------------------------------------------------------------------------

test("R1-H: incomplete candidate set with no known overlap is not_fully_checkable, never clear", () => {
  const empty = runIncomplete(target(0, 60), []);
  assert.equal(empty.driver.status, "not_fully_checkable");
  assert.equal(empty.vehicle.status, "not_fully_checkable");
  assert.equal(empty.driver.candidateSetIncomplete, true);
  // A provably separate trip in the returned subset still cannot make it clear.
  const separate = runIncomplete(target(120, 60), [cand("a", 0, 60)]);
  assert.equal(separate.driver.status, "not_fully_checkable");
  assert.deepEqual(separate.driver.overlaps, []);
  // The same facts with a complete set are clear.
  assert.equal(run(target(120, 60), [cand("a", 0, 60)]).driver.status, "clear");
});

test("R1-I: incomplete set + known overlap keeps the overlap and the incomplete flag", () => {
  const r = runIncomplete(target(30, 60), [cand("a", 0, 60)]);
  assert.equal(r.driver.status, "overlap");
  assert.deepEqual(r.driver.overlaps, ["a"]);
  assert.equal(r.driver.candidateSetIncomplete, true);
});

test("R1-K: missing-duration behaviour unchanged by coverage (reasons not collapsed)", () => {
  for (const runner of [run, runIncomplete]) {
    const r = runner(target(0, 60), [cand("a", 30, null)]);
    assert.equal(r.driver.status, "not_checkable");
    assert.deepEqual(r.driver.missingExtent, ["a"]);
    const unknownTarget = runner(target(0, null), [cand("a", 30, 60)]);
    assert.equal(unknownTarget.driver.status, "not_checkable");
  }
  assert.equal(run(target(0, 60), [cand("a", 30, null)]).driver.candidateSetIncomplete, false);
});

test("R1-L: still-open-past-planned-end behaviour unchanged; incomplete is an additional reason", () => {
  const now = T0 + 5 * 3_600_000;
  const complete = run(target(6 * 60, 60), [cand("open", 0, 60)], now);
  const incomplete = runIncomplete(target(6 * 60, 60), [cand("open", 0, 60)], now);
  for (const r of [complete, incomplete]) {
    assert.equal(r.driver.status, "not_fully_checkable");
    assert.deepEqual(r.driver.stillOpenPastPlannedEnd, ["open"]);
    assert.deepEqual(r.driver.overlaps, []);
  }
  assert.equal(complete.driver.candidateSetIncomplete, false);
  assert.equal(incomplete.driver.candidateSetIncomplete, true);
});

test("R1: coverage is conservative -- anything but \"complete\" is incomplete", () => {
  assert.equal(deriveResourceOverlap(target(0, 60), [], EARLY, undefined).driver.status, "not_fully_checkable");
  assert.equal(deriveResourceOverlap(target(0, 60), [], EARLY, "truncated").driver.status, "not_fully_checkable");
  assert.equal(deriveResourceOverlap(target(0, 60), [], EARLY, "complete").driver.status, "clear");
});

test("R1: incomplete coverage notice -- factual, one line, no technical wording, overlaps kept", async () => {
  const { overlapNotices } = await import("./trip-overlap-core.ts");
  const incomplete = { status: "not_fully_checkable", missingExtentCount: 0, stillOpenCount: 0, candidateSetIncomplete: true };
  const only = overlapNotices({ targetUnknownReason: null, driver: incomplete, vehicle: incomplete });
  assert.deepEqual(only.map((n) => n.text), ["Can't fully check this assignment right now."]);
  assert.equal(only[0].kind, "cannot_fully_check");
  const withOverlap = overlapNotices({
    targetUnknownReason: null,
    driver: { status: "overlap", missingExtentCount: 0, stillOpenCount: 0, candidateSetIncomplete: true },
    vehicle: null,
  });
  assert.deepEqual(withOverlap.map((n) => n.text), ["This driver has another trip during this time.", "Can't fully check this assignment right now."]);
  for (const n of [...only, ...withOverlap]) {
    assert.doesNotMatch(n.text, /error|database|limit|rows|truncat|query|conflict|late|unavailable|clear/i);
  }
});

// ---------------------------------------------------------------------------
// P1-OPS-PROG4B-R2: active assigned trips with NO pickup time
// ---------------------------------------------------------------------------

test("R2-1/2/3: same driver / same vehicle / both with a pickup-less assigned trip -> not_checkable, never clear", () => {
  const driverOnly = run(target(0, 60), [cand("s", null, null, { activeVehicleId: "v9" })]);
  assert.equal(driverOnly.driver.status, "not_checkable");
  assert.deepEqual(driverOnly.driver.missingSchedule, ["s"]);
  assert.deepEqual(driverOnly.driver.missingDuration, []);
  assert.equal(driverOnly.vehicle.status, "clear");
  const vehicleOnly = run(target(0, 60), [cand("s", null, 45, { activeDriverId: "d9" })]);
  assert.equal(vehicleOnly.vehicle.status, "not_checkable");
  assert.deepEqual(vehicleOnly.vehicle.missingSchedule, ["s"]);
  assert.equal(vehicleOnly.driver.status, "clear");
  const both = run(target(0, 60), [cand("s", null, null)]);
  assert.equal(both.driver.status, "not_checkable");
  assert.equal(both.vehicle.status, "not_checkable");
});

test("R2-4/5: a pickup-less trip on ANOTHER driver / vehicle leaves the target's resources clear", () => {
  const r = run(target(0, 60), [cand("s", null, null, { activeDriverId: "d9", activeVehicleId: "v9" }), cand("far", 600, 30)]);
  assert.equal(r.driver.status, "clear");
  assert.equal(r.vehicle.status, "clear");
  assert.deepEqual(r.driver.missingSchedule, []);
});

test("R2-6: pickup-less trip with NULL vehicle affects the driver only", () => {
  const r = run(target(0, 60), [cand("s", null, null, { activeVehicleId: null })]);
  assert.equal(r.driver.status, "not_checkable");
  assert.equal(r.vehicle.status, "clear");
});

test("R2-7: pickup-less commitment + known overlap -> overlap stays known, missing-schedule reason preserved", () => {
  const r = run(target(30, 60), [cand("a", 0, 60), cand("s", null, null)]);
  assert.equal(r.driver.status, "overlap");
  assert.deepEqual(r.driver.overlaps, ["a"]);
  assert.deepEqual(r.driver.missingSchedule, ["s"]);
});

test("R2-8/9: missing duration and still-open stay distinct reasons from missing pickup time", () => {
  const now = T0 + 105 * 60_000;
  const r = run(target(120, 60), [cand("open", 0, 60), cand("nodur", 150, null), cand("nopick", null, 30)], now);
  assert.equal(r.driver.status, "not_checkable");
  assert.deepEqual(r.driver.missingDuration, ["nodur"]);
  assert.deepEqual(r.driver.missingSchedule, ["nopick"]);
  assert.deepEqual(r.driver.missingExtent.sort(), ["nodur", "nopick"]);
  assert.deepEqual(r.driver.stillOpenPastPlannedEnd, ["open"]);
  // A pickup-less trip is never "still open past planned end": it has no planned end.
  const onlyPickupless = run(target(120, 60), [cand("nopick", null, 30, { state: "passenger_onboard" })], now);
  assert.deepEqual(onlyPickupless.driver.stillOpenPastPlannedEnd, []);
});

test("R2-10: target with no pickup time -> not_checkable for every checked resource (never clear), even with no other trips", () => {
  const r = run(target(null, 60), []);
  assert.equal(r.targetExtent.reason, "no_schedule");
  assert.equal(r.driver.status, "not_checkable");
  assert.equal(r.vehicle.status, "not_checkable");
  const noBoth = run(target(null, null), []);
  assert.equal(noBoth.targetExtent.reason, "no_schedule", "pickup time is the more fundamental missing fact");
  const noResources = run(target(null, 60, { driverId: null, vehicleId: null }), []);
  assert.equal(noResources.driver, null);
});

test("R2 notices: pickup-time copy is distinct from duration copy; pluralized; target copy; nothing alarmist", async () => {
  const { overlapNotices } = await import("./trip-overlap-core.ts");
  const clear = { status: "clear", missingExtentCount: 0, missingScheduleCount: 0, stillOpenCount: 0 };
  const one = overlapNotices({ targetUnknownReason: null, driver: { status: "not_checkable", missingExtentCount: 1, missingScheduleCount: 1, stillOpenCount: 0 }, vehicle: clear });
  assert.deepEqual(one.map((n) => n.text), ["Can't check 1 of this driver's assigned trips: pickup time not set."]);
  const mixed = overlapNotices({
    targetUnknownReason: null,
    driver: { status: "overlap", missingExtentCount: 3, missingScheduleCount: 2, stillOpenCount: 0 },
    vehicle: { status: "not_checkable", missingExtentCount: 1, missingScheduleCount: 1, stillOpenCount: 0 },
  });
  assert.deepEqual(mixed.map((n) => n.text), [
    "This driver has another trip during this time.",
    "Can't check 2 of this driver's assigned trips: pickup time not set.",
    "Can't check 1 of this driver's trips: duration not set.",
    "Can't check 1 of this vehicle's assigned trips: pickup time not set.",
  ]);
  const target = overlapNotices({ targetUnknownReason: "no_schedule", driver: { status: "not_checkable", missingExtentCount: 0, missingScheduleCount: 0, stillOpenCount: 0 }, vehicle: null });
  assert.deepEqual(target.map((n) => n.text), ["Can't check for other trips: this trip's pickup time isn't set."]);
  for (const n of [...one, ...mixed, ...target]) assert.doesNotMatch(n.text, /conflict|late|risk|error|invalid|double-?booked|unavailable/i);
  for (const n of [...one, ...target]) assert.doesNotMatch(n.text, /duration/i);
});
