/**
 * Pure operating-schedule helpers (P1-PILOT-S4B-R4C) -- no runtime imports,
 * unit-testable under plain Node (operating-schedule-core.test.mjs). The
 * database (update_organization_operating_schedule + column CHECKs) is the
 * authority; the rules here mirror it: ISO weekdays (1=Monday..7=Sunday,
 * ascending, distinct), a single same-day window with opens < closes,
 * interpreted in the organization's timezone.
 */

export const WEEKDAY_OPTIONS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
];

export interface OperatingSchedule {
  days: number[];
  /** "HH:MM" 24-hour */
  opensAt: string;
  closesAt: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ScheduleValidation =
  | { ok: true; schedule: OperatingSchedule | null }
  | { ok: false; error: string };

/** `null` schedule = clear (all fields blank and no days). Anything partial is an error. */
export function validateOperatingSchedule(input: { days: number[]; opensAt: string; closesAt: string }): ScheduleValidation {
  const days = Array.from(new Set(input.days)).sort((a, b) => a - b);
  const opensAt = input.opensAt.trim();
  const closesAt = input.closesAt.trim();

  if (days.length === 0 && opensAt === "" && closesAt === "") {
    return { ok: true, schedule: null };
  }
  if (days.length === 0) return { ok: false, error: "Choose the days your organization operates." };
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return { ok: false, error: "Choose valid days." };
  if (!TIME_PATTERN.test(opensAt) || !TIME_PATTERN.test(closesAt)) return { ok: false, error: "Enter both an opening and a closing time." };
  if (opensAt >= closesAt) return { ok: false, error: "Closing time must be after opening time." };
  return { ok: true, schedule: { days, opensAt, closesAt } };
}

/** Postgres `time` ("06:00:00") -> "06:00". */
export function trimSeconds(time: string): string {
  return time.slice(0, 5);
}

/** "6:00 AM" from "06:00". */
export function formatClock(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day", "Sat–Sun"... consecutive runs of 3+ collapse to a range. */
export function formatDays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const name = (day: number) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.short ?? "";
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    const runLength = j - i + 1;
    if (runLength >= 3) parts.push(`${name(sorted[i])}–${name(sorted[j])}`);
    else for (let k = i; k <= j; k += 1) parts.push(name(sorted[k]));
    i = j + 1;
  }
  return parts.join(", ");
}

export function formatSchedule(schedule: OperatingSchedule): string {
  return `${formatDays(schedule.days)}, ${formatClock(schedule.opensAt)} – ${formatClock(schedule.closesAt)}`;
}
