/**
 * Pure driver / vehicle availability derivation (P1-OPS-PROG5B; spec §4, §5, §6, §10, §13, amended §0A).
 *
 * ONE model for every surface (Assign / Reassign, New Trip "Assign now", Trip Detail, Dispatch Today / Tomorrow,
 * Tomorrow readiness, capacity rail). No runtime imports: organization-local time helpers are INJECTED (TimeTools --
 * callers pass local-time-core's functions), and commitments come from PROG4 (trip extents, candidate sets, resource
 * checks). This module never builds a second commitment model.
 *
 * Honesty rules:
 *   - No schedule configuration row = SCHEDULE NOT SET: never "off shift", never "available".
 *   - Weekly shifts are organization-LOCAL wall-clock times. Each instance has a CERTAIN core [start.latest,
 *     end.earliest) -- possibly EMPTY across a fall-back ambiguity, never inverted -- and a POSSIBLE extent
 *     [start.earliest, end.latest). Certainly on shift only inside a core; certainly off shift only outside every
 *     possible extent; anything between is "can't fully check".
 *   - Time off / out of service windows are half-open [starts_at, ends_at); touching boundaries do not intersect.
 *   - Unknown trip duration: only what is provable at pickup is claimed.
 *   - "Available" (now) means free RIGHT NOW only, and only when every fact proves it.
 */
import type { TripExtent } from "./trip-overlap-core";
import type { CapabilityMatch } from "./capability-core";

/** Same integrity ceiling as trip-overlap-core's MAX_EXPECTED_DURATION_MINUTES (asserted equal by a unit test). */
export const MAX_TRIP_SPAN_MS = 2880 * 60_000;

export interface TimeTools {
  resolveLocalBoundary(date: string, time: string, timezone: string): { earliest: number; latest: number } | null;
  localDateKeyOf(ms: number, timezone: string): string;
  addDaysToDateKey(dateKey: string, days: number): string;
  isoWeekdayOfDateKey(dateKey: string): number;
}

export interface WeeklyShift {
  weekday: number; // ISO 1..7
  start: string; // "HH:MM" organization-local
  end: string; // "HH:MM"; end <= start = ends on the next local day
}

export interface ShiftInstance {
  /** Certain core; EMPTY when coreStart >= coreEnd (never treated as an inverted interval). */
  coreStart: number;
  coreEnd: number;
  /** Possible extent (always non-empty). */
  possStart: number;
  possEnd: number;
}

export interface TimeWindow {
  startsAt: number;
  endsAt: number;
  /** Row id when loaded from the database (management UIs only). */
  id?: string;
}

// ---------------------------------------------------------------------------
// Shift expansion + interval helpers
// ---------------------------------------------------------------------------

/** Shift instances overlapping [fromMs, toMs), expanded per organization-local date (previous-day overnight included). */
export function expandShiftInstances(shifts: WeeklyShift[], timezone: string, fromMs: number, toMs: number, t: TimeTools): ShiftInstance[] {
  if (shifts.length === 0) return [];
  const out: ShiftInstance[] = [];
  const firstKey = t.addDaysToDateKey(t.localDateKeyOf(fromMs, timezone), -1);
  const lastKey = t.addDaysToDateKey(t.localDateKeyOf(toMs, timezone), 1);
  for (let key = firstKey; key <= lastKey; key = t.addDaysToDateKey(key, 1)) {
    const weekday = t.isoWeekdayOfDateKey(key);
    for (const shift of shifts) {
      if (shift.weekday !== weekday) continue;
      const endKey = shift.end <= shift.start ? t.addDaysToDateKey(key, 1) : key;
      const s = t.resolveLocalBoundary(key, shift.start, timezone);
      const e = t.resolveLocalBoundary(endKey, shift.end, timezone);
      if (!s || !e) continue;
      const instance = { coreStart: s.latest, coreEnd: e.earliest, possStart: s.earliest, possEnd: e.latest };
      if (instance.possEnd <= fromMs || instance.possStart >= toMs) continue;
      out.push(instance);
    }
  }
  return out.sort((a, b) => a.possStart - b.possStart);
}

type Span = [number, number];
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged: Span[] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
const cores = (instances: ShiftInstance[]) => mergeSpans(instances.map((i) => [i.coreStart, i.coreEnd] as Span));
const possibles = (instances: ShiftInstance[]) => mergeSpans(instances.map((i) => [i.possStart, i.possEnd] as Span));
const spanCovers = (spans: Span[], s: number, e: number) => spans.some(([a, b]) => a <= s && e <= b);
const pointIn = (spans: Span[], p: number) => spans.some(([a, b]) => a <= p && p < b);

// ---------------------------------------------------------------------------
// Facts versus a TARGET trip
// ---------------------------------------------------------------------------

export type ShiftFact =
  | "schedule_not_set" // no configuration: no claim either way
  | "covered" // the whole known interval lies inside certain shift cores
  | "outside_start" // the pickup is certainly outside working hours
  | "outside_end" // the pickup is inside working hours but part of the known trip is certainly outside
  | "on_shift_at_pickup" // duration unknown: certainly on shift at pickup, the rest can't be proven
  | "partly_unknown" // DST-uncertain boundary band
  | "unknown_target"; // no pickup time: nothing can be placed

export function deriveShiftFact(extent: TripExtent, configured: boolean, instances: ShiftInstance[]): ShiftFact {
  if (!configured) return "schedule_not_set";
  if (extent.startMs === null) return "unknown_target";
  const core = cores(instances);
  const poss = possibles(instances);
  if (extent.kind === "known") {
    if (spanCovers(core, extent.startMs, extent.endMs)) return "covered";
    if (!pointIn(poss, extent.startMs)) return "outside_start";
    if (!spanCovers(poss, extent.startMs, extent.endMs)) return "outside_end";
    return "partly_unknown";
  }
  const p = extent.startMs;
  if (!pointIn(poss, p)) return "outside_start";
  if (pointIn(core, p)) return "on_shift_at_pickup";
  return "partly_unknown";
}

export type WindowFact = "clear" | "overlaps" | "not_checkable" | "unknown_target";

/** Time off (driver) or out of service (vehicle) versus the target trip. */
export function deriveWindowFact(extent: TripExtent, windows: TimeWindow[]): WindowFact {
  if (extent.startMs === null) return windows.length > 0 ? "unknown_target" : "clear";
  if (extent.kind === "known") {
    return windows.some((w) => w.startsAt < extent.endMs && extent.startMs < w.endsAt) ? "overlaps" : "clear";
  }
  const p = extent.startMs;
  if (windows.some((w) => w.startsAt <= p && p < w.endsAt)) return "overlaps";
  if (windows.some((w) => w.startsAt > p && w.startsAt < p + MAX_TRIP_SPAN_MS)) return "not_checkable";
  return "clear";
}

export interface DriverTripAvailability {
  scheduleConfigured: boolean;
  shift: ShiftFact;
  timeOff: WindowFact;
  /** True ONLY when every fact proves it (schedule configured, known extent covered, no time off, PROG4 commitments clear). */
  availableForTrip: boolean;
}

export function deriveDriverTripAvailability(input: {
  extent: TripExtent;
  configured: boolean;
  instances: ShiftInstance[];
  windows: TimeWindow[];
  /** PROG4 resource-check status for this driver versus the target ("clear" only from a complete candidate set). */
  commitmentStatus: "overlap" | "clear" | "not_checkable" | "not_fully_checkable" | null;
}): DriverTripAvailability {
  const shift = deriveShiftFact(input.extent, input.configured, input.instances);
  const timeOff = deriveWindowFact(input.extent, input.windows);
  return {
    scheduleConfigured: input.configured,
    shift,
    timeOff,
    availableForTrip: input.configured && input.extent.kind === "known" && shift === "covered" && timeOff === "clear" && input.commitmentStatus === "clear",
  };
}

export interface VehicleTripAvailability {
  outOfService: WindowFact;
  capability: CapabilityMatch;
}

// ---------------------------------------------------------------------------
// Driver status NOW (capacity rail, Dispatch Today row header)
// ---------------------------------------------------------------------------

export type DriverNowStatus = "ON_TRIP" | "TIME_OFF" | "OFF_SHIFT" | "COMMITTED" | "NOT_FULLY_CHECKABLE" | "SCHEDULE_NOT_SET" | "AVAILABLE";

export const DRIVER_NOW_STATUS_ORDER: DriverNowStatus[] = ["AVAILABLE", "ON_TRIP", "COMMITTED", "TIME_OFF", "OFF_SHIFT", "NOT_FULLY_CHECKABLE", "SCHEDULE_NOT_SET"];

export const DRIVER_NOW_STATUS_LABEL: Record<DriverNowStatus, string> = {
  ON_TRIP: "On trip",
  TIME_OFF: "Time off",
  OFF_SHIFT: "Off shift",
  COMMITTED: "Committed",
  NOT_FULLY_CHECKABLE: "Can't fully check",
  SCHEDULE_NOT_SET: "Schedule not set",
  AVAILABLE: "Available",
};

/** A non-terminal trip actively assigned to this driver (from the PROG4 candidate set). */
export interface DriverCommitment {
  startMs: number | null; // null = pickup-less (R2)
  endMs: number | null; // null = duration unknown
}

export function deriveDriverNowStatus(input: {
  nowMs: number;
  onTrip: boolean;
  configured: boolean;
  instances: ShiftInstance[];
  windows: TimeWindow[];
  commitments: DriverCommitment[];
  /** PROG4 R1 coverage of the candidate set the commitments came from. */
  coverage: "complete" | "incomplete";
}): DriverNowStatus {
  const { nowMs } = input;
  if (input.onTrip) return "ON_TRIP";
  if (input.windows.some((w) => w.startsAt <= nowMs && nowMs < w.endsAt)) return "TIME_OFF";
  const poss = possibles(input.instances);
  const core = cores(input.instances);
  if (input.configured && !pointIn(poss, nowMs)) return "OFF_SHIFT";
  if (input.commitments.some((c) => c.startMs !== null && c.endMs !== null && c.startMs <= nowMs && nowMs < c.endMs)) return "COMMITTED";
  const uncertain =
    input.coverage !== "complete" ||
    input.commitments.some(
      (c) =>
        c.startMs === null || // pickup-less commitment (R2)
        (c.endMs !== null && c.endMs <= nowMs) || // still open past its planned end (Q7)
        (c.endMs === null && c.startMs <= nowMs && c.startMs > nowMs - MAX_TRIP_SPAN_MS), // missing duration that could cover now
    ) ||
    (input.configured && !pointIn(core, nowMs)); // inside a DST-uncertain band
  if (uncertain) return "NOT_FULLY_CHECKABLE";
  if (!input.configured) return "SCHEDULE_NOT_SET";
  return "AVAILABLE";
}

// ---------------------------------------------------------------------------
// Tomorrow row facts (no mutually exclusive status -- amended §11)
// ---------------------------------------------------------------------------

export interface DriverDayFacts {
  configured: boolean;
  /** Shift instances (possible extents) touching the day, for a working-hours summary. */
  shifts: { startMs: number; endMs: number }[];
  /** Time-off windows touching the day. */
  timeOff: TimeWindow[];
}

export function deriveDriverDayFacts(configured: boolean, instances: ShiftInstance[], windows: TimeWindow[], dayStartMs: number, dayEndMs: number): DriverDayFacts {
  return {
    configured,
    shifts: instances.filter((i) => i.possStart < dayEndMs && dayStartMs < i.possEnd).map((i) => ({ startMs: i.possStart, endMs: i.possEnd })),
    timeOff: windows.filter((w) => w.startsAt < dayEndMs && dayStartMs < w.endsAt),
  };
}

// ---------------------------------------------------------------------------
// Readiness reasons (KNOWN problems only -- spec §13)
// ---------------------------------------------------------------------------

export type AvailabilityReadinessReason = "DRIVER_TIME_OFF" | "DRIVER_OFF_SHIFT" | "VEHICLE_OUT_OF_SERVICE" | "VEHICLE_WHEELCHAIR_MISMATCH";

export function availabilityReadinessReasons(input: {
  driver: DriverTripAvailability | null;
  vehicle: VehicleTripAvailability | null;
}): AvailabilityReadinessReason[] {
  const reasons: AvailabilityReadinessReason[] = [];
  if (input.driver?.timeOff === "overlaps") reasons.push("DRIVER_TIME_OFF");
  if (input.driver && (input.driver.shift === "outside_start" || input.driver.shift === "outside_end")) reasons.push("DRIVER_OFF_SHIFT");
  if (input.vehicle?.outOfService === "overlaps") reasons.push("VEHICLE_OUT_OF_SERVICE");
  if (input.vehicle?.capability === "KNOWN_MISMATCH") reasons.push("VEHICLE_WHEELCHAIR_MISMATCH");
  return reasons;
}

// ---------------------------------------------------------------------------
// Operator copy (one source; factual, never "unavailable" / "best" / scores)
// ---------------------------------------------------------------------------

export interface AvailabilityNoticeInput {
  driver: Pick<DriverTripAvailability, "shift" | "timeOff"> | null;
  vehicle: VehicleTripAvailability | null;
  /** Q2: "working hours aren't set" only once the organization has configured at least one driver schedule. */
  organizationUsesSchedules: boolean;
}

export interface AvailabilityNotice {
  kind: "availability" | "cannot_check" | "not_set";
  text: string;
}

export function availabilityNotices(input: AvailabilityNoticeInput): AvailabilityNotice[] {
  const notes: AvailabilityNotice[] = [];
  const d = input.driver;
  if (d) {
    if (d.timeOff === "overlaps") notes.push({ kind: "availability", text: "This driver has time off during this trip." });
    else if (d.timeOff === "not_checkable") notes.push({ kind: "cannot_check", text: "This driver has time off starting after pickup; the whole trip can't be checked because its duration isn't set." });
    if (d.shift === "outside_start") notes.push({ kind: "availability", text: "This trip is outside this driver's working hours." });
    else if (d.shift === "outside_end") notes.push({ kind: "availability", text: "This trip ends after this driver's working hours." });
    else if (d.shift === "on_shift_at_pickup") notes.push({ kind: "cannot_check", text: "On shift at pickup; the whole trip can't be checked because its duration isn't set." });
    else if (d.shift === "partly_unknown") notes.push({ kind: "cannot_check", text: "This driver's working hours can't be fully checked for this trip (daylight-saving change)." });
    else if (d.shift === "schedule_not_set" && input.organizationUsesSchedules) notes.push({ kind: "not_set", text: "This driver's working hours aren't set." });
  }
  const v = input.vehicle;
  if (v) {
    if (v.outOfService === "overlaps") notes.push({ kind: "availability", text: "This vehicle is out of service during this trip." });
    else if (v.outOfService === "not_checkable") notes.push({ kind: "cannot_check", text: "This vehicle is out of service starting after pickup; the whole trip can't be checked because its duration isn't set." });
    if (v.capability === "KNOWN_MISMATCH") notes.push({ kind: "availability", text: "This trip needs wheelchair transport equipment; this vehicle's recorded equipment doesn't match." });
    else if (v.capability === "NOT_CHECKABLE") notes.push({ kind: "cannot_check", text: "This trip needs wheelchair transport equipment; this vehicle's wheelchair equipment isn't recorded." });
  }
  return notes;
}

/** Short Dispatch block flags for facts about THAT trip (no flag merely because a schedule is not set). */
export function availabilityFlags(driver: Pick<DriverTripAvailability, "shift" | "timeOff"> | null, vehicle: VehicleTripAvailability | null): string[] {
  const flags: string[] = [];
  if (driver?.timeOff === "overlaps") flags.push("Driver time off");
  if (driver && (driver.shift === "outside_start" || driver.shift === "outside_end")) flags.push("Outside working hours");
  if (vehicle?.outOfService === "overlaps") flags.push("Vehicle out of service");
  if (vehicle?.capability === "KNOWN_MISMATCH") flags.push("Wheelchair equipment doesn't match");
  else if (vehicle?.capability === "NOT_CHECKABLE") flags.push("Wheelchair equipment not recorded");
  return flags;
}

/** "Mon 8:00 AM – 12:00 PM" style formatting for a weekly shift (display only). */
export const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
export function formatShift(shift: WeeklyShift): string {
  const overnight = shift.end <= shift.start;
  const endLabel = shift.end === "00:00" ? "midnight" : formatClock(shift.end);
  return `${WEEKDAY_SHORT[shift.weekday]} ${formatClock(shift.start)} – ${endLabel}${overnight && shift.end !== "00:00" ? " (next day)" : ""}`;
}
