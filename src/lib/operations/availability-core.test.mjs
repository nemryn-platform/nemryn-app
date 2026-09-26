// Unit tests for the pure availability core + local-time-core DST resolution (P1-OPS-PROG5B).
//   node --test src/lib/operations/availability-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const lt = await import("./local-time-core.ts");
const {
  expandShiftInstances, deriveShiftFact, deriveWindowFact, deriveDriverTripAvailability, deriveDriverNowStatus,
  deriveDriverDayFacts, availabilityReadinessReasons, availabilityNotices, availabilityFlags, formatShift, MAX_TRIP_SPAN_MS,
} = await import("./availability-core.ts");
const { deriveTripExtent, OVERLAP_LOOKBACK_MS } = await import("./trip-overlap-core.ts");

const TZ = "America/New_York";
const tools = { resolveLocalBoundary: lt.resolveLocalBoundary, localDateKeyOf: lt.localDateKeyOf, addDaysToDateKey: lt.addDaysToDateKey, isoWeekdayOfDateKey: lt.isoWeekdayOfDateKey };
const at = (iso) => Date.parse(iso);
const known = (startIso, minutes) => deriveTripExtent(startIso, minutes);
const inst = (shifts, fromIso, toIso) => expandShiftInstances(shifts, TZ, at(fromIso), at(toIso), tools);
// 2026-10-12 is a Monday (EDT, UTC-4).
const MON = "2026-10-12";

test("ceiling matches PROG4's overlap look-back", () => {
  assert.equal(MAX_TRIP_SPAN_MS, OVERLAP_LOOKBACK_MS);
});

test("local-time-core: ISO weekday, date arithmetic, local date key", () => {
  assert.equal(lt.isoWeekdayOfDateKey(MON), 1);
  assert.equal(lt.isoWeekdayOfDateKey("2026-10-18"), 7);
  assert.equal(lt.addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(lt.localDateKeyOf(at("2026-10-13T03:30:00Z"), TZ), "2026-10-12");
});

test("DST spring-forward: a boundary inside the gap resolves to the first instant after the gap", () => {
  // 2026-03-08 02:30 America/New_York does not exist; clocks jump 02:00 EST -> 03:00 EDT at 07:00Z.
  const r = lt.resolveLocalBoundary("2026-03-08", "02:30", TZ);
  assert.deepEqual(r, { earliest: at("2026-03-08T07:00:00Z"), latest: at("2026-03-08T07:00:00Z") });
  const ok = lt.resolveLocalBoundary("2026-03-08", "04:00", TZ);
  assert.equal(ok.earliest, at("2026-03-08T08:00:00Z"));
  // a 01:00–04:00 shift that night lasts 2 real hours
  const [i] = inst([{ weekday: 7, start: "01:00", end: "04:00" }], "2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z");
  assert.equal(i.coreEnd - i.coreStart, 2 * 3_600_000);
});

test("DST fall-back: an ambiguous boundary keeps both instants (earliest = first, latest = second occurrence)", () => {
  const r = lt.resolveLocalBoundary("2026-11-01", "01:30", TZ);
  assert.deepEqual(r, { earliest: at("2026-11-01T05:30:00Z"), latest: at("2026-11-01T06:30:00Z") });
  // Sun 01:30–06:00: certain core starts at the LATER 01:30, possible extent at the earlier one
  const [i] = inst([{ weekday: 7, start: "01:30", end: "06:00" }], "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z");
  assert.equal(i.coreStart, at("2026-11-01T06:30:00Z"));
  assert.equal(i.possStart, at("2026-11-01T05:30:00Z"));
  // a pickup in the uncertain band is neither on shift nor off shift
  assert.equal(deriveShiftFact(known("2026-11-01T06:00:00Z", null), true, [i]), "partly_unknown");
  assert.equal(deriveDriverNowStatus({ nowMs: at("2026-11-01T06:00:00Z"), onTrip: false, configured: true, instances: [i], windows: [], commitments: [], coverage: "complete" }), "NOT_FULLY_CHECKABLE");
});

test("DST fall-back: the certain core can be EMPTY -- never inverted, and nothing inside it is claimed", () => {
  // Sun 01:10–01:50 on the fall-back night: both boundaries ambiguous -> core [06:10Z, 05:50Z) is empty.
  const [i] = inst([{ weekday: 7, start: "01:10", end: "01:50" }], "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z");
  assert.ok(i.coreStart >= i.coreEnd, "core is empty");
  assert.ok(i.possEnd > i.possStart, "possible extent exists");
  assert.equal(deriveShiftFact(known("2026-11-01T05:20:00Z", 10), true, [i]), "partly_unknown");
  assert.equal(deriveDriverNowStatus({ nowMs: at("2026-11-01T05:40:00Z"), onTrip: false, configured: true, instances: [i], windows: [], commitments: [], coverage: "complete" }), "NOT_FULLY_CHECKABLE");
  // certainly outside the possible extent -> off shift
  assert.equal(deriveShiftFact(known("2026-11-01T08:00:00Z", 10), true, [i]), "outside_start");
});

test("schedule not set: never off shift, never available", () => {
  const e = known(`${MON}T13:00:00Z`, 60);
  assert.equal(deriveShiftFact(e, false, []), "schedule_not_set");
  const a = deriveDriverTripAvailability({ extent: e, configured: false, instances: [], windows: [], commitmentStatus: "clear" });
  assert.equal(a.availableForTrip, false);
  assert.equal(deriveDriverNowStatus({ nowMs: at(`${MON}T13:00:00Z`), onTrip: false, configured: false, instances: [], windows: [], commitments: [], coverage: "complete" }), "SCHEDULE_NOT_SET");
});

test("on shift / off shift / split shift / trip ends after working hours", () => {
  const shifts = [{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "17:00" }];
  const i = inst(shifts, `${MON}T00:00:00Z`, "2026-10-14T00:00:00Z");
  assert.equal(deriveShiftFact(known(`${MON}T13:00:00Z`, 60), true, i), "covered"); // 9–10 AM
  assert.equal(deriveShiftFact(known(`${MON}T11:00:00Z`, 30), true, i), "outside_start"); // 7 AM
  assert.equal(deriveShiftFact(known(`${MON}T16:15:00Z`, 30), true, i), "outside_start"); // 12:15 in the split gap
  assert.equal(deriveShiftFact(known(`${MON}T15:30:00Z`, 120), true, i), "outside_end"); // 11:30–13:30 crosses the gap
  assert.equal(deriveShiftFact(known(`${MON}T20:30:00Z`, 60), true, i), "outside_end"); // 16:30–17:30
  const a = deriveDriverTripAvailability({ extent: known(`${MON}T13:00:00Z`, 60), configured: true, instances: i, windows: [], commitmentStatus: "clear" });
  assert.equal(a.availableForTrip, true);
});

test("overnight shift and Sunday -> Monday week wrap", () => {
  const i = inst([{ weekday: 5, start: "22:00", end: "06:00" }, { weekday: 7, start: "22:00", end: "02:00" }], "2026-10-16T00:00:00Z", `2026-10-20T00:00:00Z`);
  // Sat 02:00–03:00 local (Fri overnight)
  assert.equal(deriveShiftFact(known("2026-10-17T06:00:00Z", 60), true, i), "covered");
  // Mon 01:00–01:30 local (Sun overnight)
  assert.equal(deriveShiftFact(known("2026-10-19T05:00:00Z", 30), true, i), "covered");
  // Mon 01:30–02:30 local ends after 02:00
  assert.equal(deriveShiftFact(known("2026-10-19T05:30:00Z", 60), true, i), "outside_end");
});

test("end at midnight covers until 00:00", () => {
  const i = inst([{ weekday: 2, start: "18:00", end: "00:00" }], "2026-10-13T00:00:00Z", "2026-10-15T00:00:00Z");
  assert.equal(deriveShiftFact(known("2026-10-14T03:00:00Z", 60), true, i), "covered"); // Tue 23:00–24:00
  assert.equal(deriveShiftFact(known("2026-10-14T03:30:00Z", 60), true, i), "outside_end");
});

test("unknown trip duration: only what is provable at pickup", () => {
  const i = inst([{ weekday: 1, start: "08:00", end: "12:00" }], `${MON}T00:00:00Z`, "2026-10-14T00:00:00Z");
  assert.equal(deriveShiftFact(known(`${MON}T13:00:00Z`, null), true, i), "on_shift_at_pickup");
  assert.equal(deriveShiftFact(known(`${MON}T18:00:00Z`, null), true, i), "outside_start"); // provable at pickup
  const a = deriveDriverTripAvailability({ extent: known(`${MON}T13:00:00Z`, null), configured: true, instances: i, windows: [], commitmentStatus: "clear" });
  assert.equal(a.availableForTrip, false, "unknown duration never becomes available");
  assert.equal(deriveShiftFact(known(null, 60), true, i), "unknown_target");
});

test("time off: overlap / touching boundary / unknown duration / precedence over shift", () => {
  const trip = known(`${MON}T13:00:00Z`, 60); // 13:00–14:00Z
  assert.equal(deriveWindowFact(trip, [{ startsAt: at(`${MON}T13:30:00Z`), endsAt: at(`${MON}T20:00:00Z`) }]), "overlaps");
  assert.equal(deriveWindowFact(trip, [{ startsAt: at(`${MON}T14:00:00Z`), endsAt: at(`${MON}T20:00:00Z`) }]), "clear"); // touching
  assert.equal(deriveWindowFact(trip, [{ startsAt: at(`${MON}T10:00:00Z`), endsAt: at(`${MON}T13:00:00Z`) }]), "clear"); // touching before
  const unk = known(`${MON}T13:00:00Z`, null);
  assert.equal(deriveWindowFact(unk, [{ startsAt: at(`${MON}T12:00:00Z`), endsAt: at(`${MON}T13:30:00Z`) }]), "overlaps");
  assert.equal(deriveWindowFact(unk, [{ startsAt: at(`${MON}T15:00:00Z`), endsAt: at(`${MON}T16:00:00Z`) }]), "not_checkable");
  assert.equal(deriveWindowFact(unk, [{ startsAt: at("2026-10-20T15:00:00Z"), endsAt: at("2026-10-20T16:00:00Z") }]), "clear"); // beyond 48 h
  const i = inst([{ weekday: 1, start: "08:00", end: "12:00" }], `${MON}T00:00:00Z`, "2026-10-14T00:00:00Z");
  const now = at(`${MON}T13:00:00Z`);
  assert.equal(deriveDriverNowStatus({ nowMs: now, onTrip: false, configured: true, instances: i, windows: [{ startsAt: now - 1, endsAt: now + 1 }], commitments: [], coverage: "complete" }), "TIME_OFF");
  // time off is a fact even when the schedule is not set
  assert.equal(deriveDriverNowStatus({ nowMs: now, onTrip: false, configured: false, instances: [], windows: [{ startsAt: now - 1, endsAt: now + 1 }], commitments: [], coverage: "complete" }), "TIME_OFF");
});

test("NOW status precedence and every uncertainty source", () => {
  const i = inst([{ weekday: 1, start: "08:00", end: "18:00" }], `${MON}T00:00:00Z`, "2026-10-14T00:00:00Z");
  const now = at(`${MON}T16:00:00Z`); // noon local, on shift
  const base = { nowMs: now, onTrip: false, configured: true, instances: i, windows: [], commitments: [], coverage: "complete" };
  assert.equal(deriveDriverNowStatus(base), "AVAILABLE");
  assert.equal(deriveDriverNowStatus({ ...base, onTrip: true, windows: [{ startsAt: now - 1, endsAt: now + 1 }] }), "ON_TRIP");
  assert.equal(deriveDriverNowStatus({ ...base, nowMs: at(`${MON}T23:30:00Z`) }), "OFF_SHIFT");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: now - 600_000, endMs: now + 600_000 }] }), "COMMITTED");
  assert.equal(deriveDriverNowStatus({ ...base, coverage: "incomplete" }), "NOT_FULLY_CHECKABLE", "PROG4 R1 incomplete candidate set");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: null, endMs: null }] }), "NOT_FULLY_CHECKABLE", "R2 pickup-less commitment");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: now - 7_200_000, endMs: now - 3_600_000 }] }), "NOT_FULLY_CHECKABLE", "Q7 still open past planned end");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: now - 3_600_000, endMs: null }] }), "NOT_FULLY_CHECKABLE", "missing-duration commitment that could cover now");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: now + 3_600_000, endMs: null }] }), "AVAILABLE", "a later missing-duration trip does not cover now");
  assert.equal(deriveDriverNowStatus({ ...base, commitments: [{ startMs: now + 600_000, endMs: now + 3_600_000 }] }), "AVAILABLE", "a later known trip: free right now");
});

test("Tomorrow row facts: shifts + time off, not an exclusive status", () => {
  const day0 = at("2026-10-13T04:00:00Z"), day1 = at("2026-10-14T04:00:00Z"); // Tue local day
  const i = inst([{ weekday: 2, start: "08:00", end: "17:00" }], "2026-10-13T04:00:00Z", "2026-10-14T04:00:00Z");
  const f = deriveDriverDayFacts(true, i, [{ startsAt: at("2026-10-13T17:00:00Z"), endsAt: at("2026-10-13T19:00:00Z") }], day0, day1);
  assert.equal(f.shifts.length, 1);
  assert.equal(f.timeOff.length, 1, "hours AND partial time off can coexist");
});

test("readiness reasons: KNOWN problems only; unknowns never become reasons", () => {
  const reasons = (driver, vehicle) => availabilityReadinessReasons({ driver, vehicle });
  assert.deepEqual(reasons({ shift: "outside_start", timeOff: "overlaps" }, { outOfService: "overlaps", capability: "KNOWN_MISMATCH" }), ["DRIVER_TIME_OFF", "DRIVER_OFF_SHIFT", "VEHICLE_OUT_OF_SERVICE", "VEHICLE_WHEELCHAIR_MISMATCH"]);
  assert.deepEqual(reasons({ shift: "outside_end", timeOff: "clear" }, null), ["DRIVER_OFF_SHIFT"]);
  assert.deepEqual(reasons({ shift: "schedule_not_set", timeOff: "not_checkable" }, { outOfService: "not_checkable", capability: "NOT_CHECKABLE" }), []);
  assert.deepEqual(reasons({ shift: "on_shift_at_pickup", timeOff: "clear" }, { outOfService: "clear", capability: "REQUIREMENT_UNKNOWN" }), []);
  assert.deepEqual(reasons({ shift: "partly_unknown", timeOff: "clear" }, null), []);
});

test("notices: factual copy, Q2 gating, no alarm / ranking words; flags per trip fact", () => {
  const n = (driver, vehicle, uses = true) => availabilityNotices({ driver, vehicle, organizationUsesSchedules: uses }).map((x) => x.text);
  assert.deepEqual(n({ shift: "schedule_not_set", timeOff: "clear" }, null, false), [], "no noise before the organization adopts scheduling");
  assert.deepEqual(n({ shift: "schedule_not_set", timeOff: "clear" }, null, true), ["This driver's working hours aren't set."]);
  const all = n({ shift: "outside_end", timeOff: "overlaps" }, { outOfService: "overlaps", capability: "KNOWN_MISMATCH" });
  assert.deepEqual(all, [
    "This driver has time off during this trip.",
    "This trip ends after this driver's working hours.",
    "This vehicle is out of service during this trip.",
    "This trip needs wheelchair transport equipment; this vehicle's recorded equipment doesn't match.",
  ]);
  assert.ok(n(null, { outOfService: "clear", capability: "NOT_CHECKABLE" })[0].includes("isn't recorded"));
  for (const text of [...all, ...n({ shift: "on_shift_at_pickup", timeOff: "not_checkable" }, { outOfService: "not_checkable", capability: "NOT_CHECKABLE" })]) {
    assert.doesNotMatch(text, /unavailable|best|recommend|score|conflict|late\b|overlap|double-?booked|certif|ADA|approved|authoriz/i);
  }
  assert.deepEqual(availabilityFlags({ shift: "schedule_not_set", timeOff: "clear" }, null), [], "no flag merely because a schedule is not set");
  assert.deepEqual(availabilityFlags({ shift: "outside_start", timeOff: "overlaps" }, { outOfService: "overlaps", capability: "NOT_CHECKABLE" }), ["Driver time off", "Outside working hours", "Vehicle out of service", "Wheelchair equipment not recorded"]);
});

test("formatShift", () => {
  assert.equal(formatShift({ weekday: 1, start: "08:00", end: "12:30" }), "Mon 8:00 AM – 12:30 PM");
  assert.equal(formatShift({ weekday: 5, start: "22:00", end: "06:00" }), "Fri 10:00 PM – 6:00 AM (next day)");
  assert.equal(formatShift({ weekday: 2, start: "18:00", end: "00:00" }), "Tue 6:00 PM – midnight");
});
