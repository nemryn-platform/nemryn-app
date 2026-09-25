/**
 * Pure trip time extent + overlap derivation (P1-OPS-PROG4B,
 * docs/reports/p1-ops-prog4a-trip-time-extent-overlap-spec.txt §6, §8, §8a).
 *
 * ONE canonical model used by every surface (New Trip, Assign / Reassign,
 * Trip Detail, Dispatch Today / Tomorrow, Tomorrow). No runtime imports --
 * unit-testable with Node's test runner.
 *
 * Honesty rules:
 *   - A planned interval is [scheduled_pickup_at, + expected_duration_minutes)
 *     (half-open, absolute minutes). It is KNOWN only when both exist.
 *   - An overlap is claimed ONLY between two known planned intervals.
 *   - Unknown extent never becomes "clear" and never becomes "overlap".
 *   - A still-open trip (non-terminal, active assignment) whose planned end
 *     is already in the past makes the time AFTER that planned end
 *     unresolved: it is neither extended to an invented end nor treated as
 *     free. This is an uncertainty rule, not a lateness rule.
 *   - A candidate set the loader could not prove complete (coverage
 *     "incomplete", P1-OPS-PROG4B-R1) never yields "clear": trips that were
 *     not read cannot be ruled out. Known overlaps found in it still stand.
 *   - An ACTIVE assignment to a non-terminal trip with no pickup time is a
 *     real commitment with unknown timing (P1-OPS-PROG4B-R2): it makes its
 *     own driver / vehicle "not_checkable" (reason: pickup time missing,
 *     kept distinct from a missing duration). A target with no pickup time
 *     cannot be placed at all, so nothing can be checked for it.
 * Overlap is a warning only; nothing here blocks or changes an assignment.
 */

/** The integrity ceiling for a duration (minutes) and therefore the overlap look-back. Never a default. */
export const MAX_EXPECTED_DURATION_MINUTES = 2880;
export const OVERLAP_LOOKBACK_MS = MAX_EXPECTED_DURATION_MINUTES * 60_000;

export const TERMINAL_STATES: ReadonlySet<string> = new Set(["completed", "cancelled", "no_show"]);

export type TripExtent =
  | { kind: "known"; startMs: number; endMs: number }
  | { kind: "unknown"; reason: "no_schedule" | "no_duration"; startMs: number | null };

export function isValidExpectedDuration(minutes: number | null): boolean {
  return minutes === null || (Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_EXPECTED_DURATION_MINUTES);
}

export function deriveTripExtent(scheduledPickupAt: string | null, expectedDurationMinutes: number | null): TripExtent {
  const startMs = scheduledPickupAt ? Date.parse(scheduledPickupAt) : NaN;
  if (Number.isNaN(startMs)) return { kind: "unknown", reason: "no_schedule", startMs: null };
  if (expectedDurationMinutes === null || !isValidExpectedDuration(expectedDurationMinutes)) {
    return { kind: "unknown", reason: "no_duration", startMs };
  }
  return { kind: "known", startMs, endMs: startMs + expectedDurationMinutes * 60_000 };
}

/** Half-open interval intersection: touching boundaries do NOT overlap. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface OverlapCandidate {
  tripId: string;
  state: string;
  scheduledPickupAt: string | null;
  expectedDurationMinutes: number | null;
  /** Resources of the trip's ACTIVE assignment only (ended assignments never count). */
  activeDriverId: string | null;
  activeVehicleId: string | null;
}

export interface OverlapTarget {
  /** Excluded from its own candidates (also excludes its current, to-be-ended assignment on reassign). Null for a trip not yet created. */
  tripId: string | null;
  scheduledPickupAt: string | null;
  expectedDurationMinutes: number | null;
  /** The resources being checked: the selected (or current) driver / vehicle; null = not checked. */
  driverId: string | null;
  vehicleId: string | null;
}

export type ResourceCheckStatus =
  | "overlap" // at least one known planned interval intersects
  | "clear" // every same-resource candidate is provably outside the target's known interval
  | "not_checkable" // an extent is missing (target or candidate), so a claim cannot be made
  | "not_fully_checkable"; // a still-open assigned trip passed its planned end, or the candidate set is incomplete

/** Whether the loader proved it read every relevant candidate. Anything but "complete" is treated as incomplete. */
export type CandidateCoverage = "complete" | "incomplete";

export interface ResourceCheck {
  status: ResourceCheckStatus;
  /** Known overlaps (both intervals known and intersecting). */
  overlaps: string[];
  /** Same-resource candidates that might matter but have no extent (or the target has none). = missingSchedule ∪ missingDuration ∪ target-caused. */
  missingExtent: string[];
  /** Of missingExtent: candidates whose own pickup time is not set (unknown timing, never placeable). */
  missingSchedule: string[];
  /** Of missingExtent: candidates whose own duration is not set (start known, end unknown). */
  missingDuration: string[];
  /** Same-resource candidates still open past their planned end, whose later commitment is unresolved. */
  stillOpenPastPlannedEnd: string[];
  /** The candidate set was not proven complete, so this resource cannot be fully checked (never "clear"). */
  candidateSetIncomplete: boolean;
}

export interface OverlapResult {
  targetExtent: TripExtent;
  driver: ResourceCheck | null;
  vehicle: ResourceCheck | null;
}

type PairOutcome = "overlap" | "clear" | "missing_schedule" | "missing_duration" | "missing_target" | "still_open";

function classifyPair(target: TripExtent, candidate: OverlapCandidate, nowMs: number): PairOutcome {
  const c = deriveTripExtent(candidate.scheduledPickupAt, candidate.expectedDurationMinutes);
  // A candidate with no scheduled start can never be placed in time.
  if (c.kind === "unknown" && c.startMs === null) return "missing_schedule";
  if (target.kind === "unknown" && target.startMs === null) return "missing_target";

  const stillOpen = c.kind === "known" && !TERMINAL_STATES.has(candidate.state) && c.endMs < nowMs;

  if (target.kind === "known" && c.kind === "known") {
    if (intervalsOverlap(target.startMs, target.endMs, c.startMs, c.endMs)) return "overlap";
    // Target lies (at least partly) after the candidate's expired planned end -> that time is unresolved.
    if (stillOpen && target.endMs > c.endMs) return "still_open";
    return "clear";
  }
  if (target.kind === "known" && c.kind === "unknown") {
    // The candidate starts at or after the target ends: it cannot intersect, whatever its duration.
    return (c.startMs as number) >= target.endMs ? "clear" : "missing_duration";
  }
  // Target extent unknown (start known, duration missing): never an overlap claim.
  const ts = target.startMs as number;
  if (c.kind === "known") {
    if (c.endMs <= ts) return stillOpen ? "still_open" : "clear";
    return "missing_target";
  }
  return "missing_target";
}

function checkResource(target: TripExtent, candidates: OverlapCandidate[], nowMs: number, candidateSetIncomplete: boolean): ResourceCheck {
  const overlaps: string[] = [];
  const missingExtent: string[] = [];
  const missingSchedule: string[] = [];
  const missingDuration: string[] = [];
  const stillOpenPastPlannedEnd: string[] = [];
  for (const candidate of candidates) {
    const outcome = classifyPair(target, candidate, nowMs);
    if (outcome === "overlap") overlaps.push(candidate.tripId);
    else if (outcome === "still_open") stillOpenPastPlannedEnd.push(candidate.tripId);
    else if (outcome !== "clear") {
      missingExtent.push(candidate.tripId);
      if (outcome === "missing_schedule") missingSchedule.push(candidate.tripId);
      else if (outcome === "missing_duration") missingDuration.push(candidate.tripId);
    }
  }
  let status: ResourceCheckStatus;
  if (overlaps.length > 0) status = "overlap";
  // No pickup time on the target: it cannot be placed, so nothing can be checked for it (never "clear").
  else if (target.kind === "unknown" && target.startMs === null) status = "not_checkable";
  else if (target.kind === "unknown" && (missingExtent.length > 0 || stillOpenPastPlannedEnd.length > 0)) status = "not_checkable";
  else if (missingExtent.length > 0) status = "not_checkable";
  else if (stillOpenPastPlannedEnd.length > 0) status = "not_fully_checkable";
  else if (candidateSetIncomplete) status = "not_fully_checkable";
  else status = "clear";
  return { status, overlaps, missingExtent, missingSchedule, missingDuration, stillOpenPastPlannedEnd, candidateSetIncomplete };
}

/**
 * Overlap facts for one target against a candidate set. Candidates are
 * filtered here (same active resource, not the target itself, not
 * terminal), so every surface gets identical answers from identical facts.
 * `coverage` is required: only a loader-proven "complete" set may yield "clear".
 */
export function deriveResourceOverlap(
  target: OverlapTarget,
  candidates: OverlapCandidate[],
  nowMs: number,
  coverage: CandidateCoverage,
): OverlapResult {
  const incomplete = coverage !== "complete";
  const targetExtent = deriveTripExtent(target.scheduledPickupAt, target.expectedDurationMinutes);
  const relevant = candidates.filter((c) => c.tripId !== target.tripId && !TERMINAL_STATES.has(c.state));
  const seen = new Set<string>();
  const unique = relevant.filter((c) => (seen.has(c.tripId) ? false : (seen.add(c.tripId), true)));
  const driver = target.driverId
    ? checkResource(targetExtent, unique.filter((c) => c.activeDriverId === target.driverId), nowMs, incomplete)
    : null;
  const vehicle = target.vehicleId
    ? checkResource(targetExtent, unique.filter((c) => c.activeVehicleId !== null && c.activeVehicleId === target.vehicleId), nowMs, incomplete)
    : null;
  return { targetExtent, driver, vehicle };
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure; organization timezone passed in)
// ---------------------------------------------------------------------------

export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function localDateKey(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function localTime(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(ms));
}

/** "9:30 AM – 10:15 AM", or "11:30 PM – 12:45 AM (next day)", or "… (+2 days)". Null when the extent is unknown. */
export function formatTripExtent(extent: TripExtent, timezone: string): string | null {
  if (extent.kind !== "known") return null;
  const startDay = localDateKey(extent.startMs, timezone);
  const endDay = localDateKey(extent.endMs, timezone);
  const base = `${localTime(extent.startMs, timezone)} – ${localTime(extent.endMs, timezone)}`;
  if (startDay === endDay) return base;
  const days = Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000);
  return `${base} ${days === 1 ? "(next day)" : `(+${days} days)`}`;
}

// ---------------------------------------------------------------------------
// Grid geometry (pure pixel math for the Dispatch time axis)
// ---------------------------------------------------------------------------

export interface LaneInput {
  id: string;
  left: number;
  width: number;
}

/** Deterministic lanes: sort by left then id; each block goes to the first lane whose last right edge is <= its left. */
export function assignLanes(blocks: LaneInput[]): Map<string, number> {
  const sorted = [...blocks].sort((a, b) => a.left - b.left || a.id.localeCompare(b.id));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const block of sorted) {
    let lane = laneEnds.findIndex((end) => end <= block.left);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = block.left + block.width;
    lanes.set(block.id, lane);
  }
  return lanes;
}

/**
 * Axis hours for a day: the default [6, 20] expanded to cover the earliest
 * start and latest KNOWN end that fall inside the day (fractional local
 * hours from day start, clamped to [0, 24]). Fact-derived; never shrinks
 * below the default.
 */
export function deriveAxisHours(
  localHours: { start: number; end: number | null }[],
  defaults: { start: number; end: number } = { start: 6, end: 20 },
): { start: number; end: number } {
  let start = defaults.start;
  let end = defaults.end;
  for (const h of localHours) {
    start = Math.min(start, Math.max(0, Math.floor(h.start)));
    end = Math.max(end, Math.min(24, Math.ceil(h.end ?? h.start + 0.5)));
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// Warning copy (one source for every surface; factual, never alarmist)
// ---------------------------------------------------------------------------

interface NoticeResource {
  status: ResourceCheckStatus;
  missingExtentCount: number;
  /** Of missingExtentCount: other assigned trips with no pickup time (the rest are missing a duration). */
  missingScheduleCount?: number;
  stillOpenCount: number;
  candidateSetIncomplete?: boolean;
}

export interface OverlapNoticeInput {
  targetUnknownReason: "no_schedule" | "no_duration" | null;
  driver: NoticeResource | null;
  vehicle: NoticeResource | null;
}

export interface OverlapNotice {
  kind: "overlap" | "cannot_check" | "cannot_fully_check";
  text: string;
}

/**
 * The notices to show for one overlap result, in a fixed order. A clear
 * result shows nothing. Never uses "conflict", "late", "unavailable" or any
 * score; never says an assignment is impossible.
 */
export function overlapNotices(input: OverlapNoticeInput): OverlapNotice[] {
  const notices: OverlapNotice[] = [];
  for (const [label, check] of [["driver", input.driver], ["vehicle", input.vehicle]] as const) {
    if (check?.status === "overlap") notices.push({ kind: "overlap", text: `This ${label} has another trip during this time.` });
  }
  const anyRelevant = [input.driver, input.vehicle].some((c) => c && c.status !== "clear");
  if (input.targetUnknownReason && anyRelevant) {
    notices.push({
      kind: "cannot_check",
      text:
        input.targetUnknownReason === "no_duration"
          ? "Can't check for other trips at this time: this trip's duration isn't set."
          : "Can't check for other trips: this trip's pickup time isn't set.",
    });
    return notices;
  }
  for (const [label, check] of [["driver", input.driver], ["vehicle", input.vehicle]] as const) {
    if (!check) continue;
    const missingSchedule = check.missingScheduleCount ?? 0;
    const missingDuration = check.missingExtentCount - missingSchedule;
    if (missingSchedule > 0) {
      notices.push({
        kind: "cannot_check",
        text: `Can't check ${missingSchedule} of this ${label}'s assigned trips: pickup time not set.`,
      });
    }
    if (missingDuration > 0) {
      notices.push({
        kind: "cannot_check",
        text: `Can't check ${missingDuration} of this ${label}'s trips: duration not set.`,
      });
    }
    if (check.stillOpenCount > 0) {
      notices.push({
        kind: "cannot_fully_check",
        text: `Can't fully check this ${label}: an assigned trip has passed its planned end and is still open.`,
      });
    }
  }
  if (input.driver?.candidateSetIncomplete || input.vehicle?.candidateSetIncomplete) {
    notices.push({ kind: "cannot_fully_check", text: "Can't fully check this assignment right now." });
  }
  return notices;
}
