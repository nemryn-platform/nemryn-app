// Focused unit tests for pure operating-schedule helpers (P1-PILOT-S4B-R4C).
//   node --test src/lib/operations/operating-schedule-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { validateOperatingSchedule, formatDays, formatClock, formatSchedule, trimSeconds, WEEKDAY_OPTIONS } = await import("./operating-schedule-core.ts");

test("weekdays are ISO 1..7 starting Monday", () => {
  assert.deepEqual(WEEKDAY_OPTIONS.map((d) => d.value), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(WEEKDAY_OPTIONS[0].long, "Monday");
  assert.equal(WEEKDAY_OPTIONS[6].long, "Sunday");
});

test("valid schedule: days sorted + distinct", () => {
  assert.deepEqual(validateOperatingSchedule({ days: [5, 1, 3, 3], opensAt: "06:00", closesAt: "18:30" }), {
    ok: true,
    schedule: { days: [1, 3, 5], opensAt: "06:00", closesAt: "18:30" },
  });
});

test("all blank clears the schedule; anything partial or invalid is an error", () => {
  assert.deepEqual(validateOperatingSchedule({ days: [], opensAt: "", closesAt: "" }), { ok: true, schedule: null });
  const bad = [
    { days: [], opensAt: "06:00", closesAt: "18:00" },
    { days: [1], opensAt: "", closesAt: "18:00" },
    { days: [1], opensAt: "06:00", closesAt: "" },
    { days: [8], opensAt: "06:00", closesAt: "18:00" },
    { days: [0], opensAt: "06:00", closesAt: "18:00" },
    { days: [1], opensAt: "18:00", closesAt: "06:00" },
    { days: [1], opensAt: "09:00", closesAt: "09:00" },
    { days: [1], opensAt: "22:00", closesAt: "06:00" },
    { days: [1], opensAt: "24:00", closesAt: "25:00" },
    { days: [1], opensAt: "6:00", closesAt: "18:00" },
  ];
  for (const input of bad) assert.equal(validateOperatingSchedule(input).ok, false, JSON.stringify(input));
});

test("formatting: ranges, lists, every day, 12-hour clock", () => {
  assert.equal(formatDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(formatDays([1, 3, 5]), "Mon, Wed, Fri");
  assert.equal(formatDays([6, 7]), "Sat, Sun");
  assert.equal(formatDays([1, 2, 3, 4, 5, 6, 7]), "Every day");
  assert.equal(formatDays([1, 2, 3, 5, 6, 7]), "Mon–Wed, Fri–Sun");
  assert.equal(formatClock("06:00"), "6:00 AM");
  assert.equal(formatClock("12:00"), "12:00 PM");
  assert.equal(formatClock("00:30"), "12:30 AM");
  assert.equal(formatClock("18:30"), "6:30 PM");
  assert.equal(formatSchedule({ days: [1, 2, 3, 4, 5], opensAt: "06:00", closesAt: "18:30" }), "Mon–Fri, 6:00 AM – 6:30 PM");
  assert.equal(trimSeconds("06:00:00"), "06:00");
});

test("no timezone anywhere in the schedule model (the Organization timezone is the single source)", () => {
  const result = validateOperatingSchedule({ days: [1], opensAt: "06:00", closesAt: "18:00" });
  assert.deepEqual(Object.keys(result.schedule).sort(), ["closesAt", "days", "opensAt"]);
});
