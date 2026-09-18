/**
 * Operations-facing presentation derivations for Today's Operations
 * (P1-E3-S4). Parallels src/lib/driver/trip-presentation.ts's role for the
 * Driver surface — a single place to look for how a canonical Trip state
 * becomes a screen label, not logic re-derived per component. Kept as its
 * own module rather than imported from the Driver module: the two are
 * different bounded contexts (Operations sees every Trip in the
 * organization and needs an "unassigned" concept the Driver surface never
 * encounters — a Driver only ever sees Trips they hold an assignment on),
 * and the small time-formatting helpers below are deliberately duplicated
 * rather than reached-into from `driver/` to keep that boundary clean (see
 * ZD-129). Neither module is a stored Trip state — see lifecycle-model.md
 * §C; both remain UI groupings over the same 9 canonical states.
 *
 * P1-E1-S2D also added the Request-facing helpers at the bottom of this
 * file (requestStatusLabel/Category, requestReadinessLabel/TextClass,
 * formatRequestAge, formatRequestServiceDate) — same "state → screen
 * label, one place to look" discipline, extended to
 * transportation_requests rather than duplicated into a parallel module.
 *
 * P1-E1-S4D added `tripReadinessReasonLabel` at the bottom — the same
 * discipline again, extended to `TripReadinessReasonCode`
 * (trip-readiness-core.ts, P1-E1-S4B). The underlying reason vocabulary
 * itself is never changed or extended here — this is presentation only.
 */

import type { StatusCategory } from "@/components/ui/StatusBadge";
import type { TripReadinessReasonCode } from "./trip-readiness-core";
import type { RequestReadiness } from "./request-readiness-core";

/**
 * The exact label strings TRIP_STATUS_MAP (src/components/ui/TripStatus.tsx)
 * already anticipates for Operations surfaces — component-inventory.md
 * confirmed this mapping exists before any of this phase's code was
 * written, not coincidentally matching it after the fact. `state='scheduled'`
 * is genuinely ambiguous without assignment context (unlike the Driver
 * surface, where it always means "Assigned" — a Driver never sees an
 * unassigned Trip) — hence the second `hasActiveAssignment` parameter.
 *
 * This is the plain lifecycle status (matches the reference's Upcoming
 * Trips STATUS column: an assigned-but-not-started Trip reads "Assigned",
 * an unassigned one reads "Scheduled") — distinct from the "Needs
 * Assignment" ISSUE label used only in the Needs Attention panel
 * (`needsAssignmentIssueLabel` below). Conflating the two into one column
 * would duplicate a warning badge as the primary status everywhere a Trip
 * appears; the reference itself keeps them visually and lexically separate.
 */
export function operationsTripStatusLabel(state: string, hasActiveAssignment: boolean): string {
  if (state === "scheduled") return hasActiveAssignment ? "Assigned" : "Scheduled";
  if (state === "en_route_to_pickup" || state === "en_route_to_destination") return "En Route";
  if (state === "arrived_at_pickup" || state === "arrived_at_destination") return "Arrived";
  if (state === "passenger_onboard") return "Passenger Onboard";
  if (state === "completed") return "Completed";
  if (state === "cancelled") return "Cancelled";
  if (state === "no_show") return "No Show";
  return state;
}

/** The 5 non-terminal, non-"scheduled" states — a Trip in one of these is, by construction, structurally guaranteed to carry an active assignment (lifecycle-model.md §C: nothing progresses past `scheduled` without one). */
const ACTIVE_STATES = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

export function isActiveTripState(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

/** "8:30 AM" style formatting, in the given IANA timezone. Deliberately duplicated from src/lib/driver/trip-presentation.ts — see this module's own doc comment. */
export function formatOperationsTime(iso: string | null, timezone: string): string {
  if (!iso) return "Time TBD";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
}

/** "Saturday, August 29" style formatting, in the given IANA timezone. */
export function formatOperationsLongDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(date);
}

/**
 * Humanized Activity Log label for a `trip_events.event_type` value — the
 * exact allow-listed vocabulary from the trip_events CHECK constraint
 * (supabase/migrations/20260830131200_trip_events.sql), not a guessed or
 * partial set. An unrecognized value falls back to the raw string rather
 * than guessing, matching the same convention as driverTripStateLabel.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  trip_scheduled: "Trip scheduled",
  en_route_to_pickup: "Driver en route to pickup",
  arrived_at_pickup: "Driver arrived at pickup",
  passenger_onboard: "Passenger onboard",
  en_route_to_destination: "Driver en route to destination",
  arrived_at_destination: "Driver arrived at destination",
  trip_completed: "Trip completed",
  trip_cancelled: "Trip cancelled",
  no_show_recorded: "No-show recorded",
  driver_assigned: "Driver assigned",
  driver_reassigned: "Driver reassigned",
  assignment_ended: "Assignment ended",
  note_added: "Note added",
  exception_flagged: "Exception flagged",
  exception_resolved: "Exception resolved",
  request_converted_to_trip: "Request converted to trip",
};

export function operationsEventLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

/**
 * `trip_exceptions.exception_type` is deliberately unconstrained free
 * text (its own migration comment: "taxonomy not yet finalized") — there
 * is no fixed vocabulary to map, unlike `trip_events.event_type`'s
 * allow-listed values above. A generic snake_case → Title Case
 * reformatting is always accurate for whatever value is actually stored
 * (never guesses at meaning, never invents a label for a value that
 * doesn't exist) — used for display only; the raw value is what's
 * actually stored and read back.
 */
export function humanizeExceptionType(exceptionType: string): string {
  return exceptionType
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * `TripAssuranceCode` → `StatusBadge` visual category (P1-E3-S8, work
 * item §60). Deliberately uniform "warning" tone for every active
 * attention condition — never escalating a category to "critical"/red
 * merely because it's an OPEN_EXCEPTION, which would start turning this
 * screen into an alarm panel (work item §59/§60's own explicit caution).
 * Severity is communicated by the real label/explanation text, never by
 * color alone or by color intensity.
 */
export function assuranceStatusCategory(code: string): "warning" | "positive" | "neutral" {
  if (code === "ON_TRACK") return "positive";
  if (code === "TERMINAL") return "neutral";
  return "warning";
}

/**
 * transportation_requests.state → label/StatusBadge category (P1-E1-S2D).
 * The exact 4-value CHECK constraint vocabulary
 * (20260830130900_transportation_requests.sql) — no fifth "converted"
 * value exists (S2A §4: conversion is represented by accepted + linked
 * Trips, never a stored state). `pending` reuses the "warning" (amber)
 * tone already established by Operations Brief's own "Needs Attention"
 * language for exactly the same underlying concept — real, unresolved
 * work waiting on a person — rather than inventing a new tone.
 * `declined`/`cancelled` both read as a plain closed/muted disposition
 * (the `cancelled` StatusBadge category), matching TripStatus's own
 * "cancelled" treatment; there is no reason for a Request decline to
 * look more alarming than a cancellation.
 */
export function requestStatusLabel(state: string): string {
  if (state === "pending") return "Pending";
  if (state === "accepted") return "Accepted";
  if (state === "declined") return "Declined";
  if (state === "cancelled") return "Cancelled";
  return state;
}

export function requestStatusCategory(state: string): StatusCategory {
  if (state === "pending") return "warning";
  if (state === "accepted") return "positive";
  return "cancelled";
}

/**
 * `RequestReadiness` (request-readiness-core.ts) → label/tone —
 * deliberately kept in THIS presentation module, separate from the pure
 * core, per that module's own doc comment ("keep the underlying state
 * separate from presentation labels"). Rendered as restrained colored
 * TEXT in the queue (never a second StatusBadge pill) specifically so
 * Readiness reads as visually distinct from Status — P1-E1-S2D §18's
 * own explicit instruction that the two concepts must never be merged
 * or made to look like the same kind of thing.
 */
export function requestReadinessLabel(readiness: RequestReadiness): string {
  if (readiness === "ready") return "Ready";
  if (readiness === "needs_passenger") return "Passenger needed";
  if (readiness === "not_convertible") return "Not convertible";
  return "Accepted";
}

/** Maps to an existing semantic TEXT color token only (never a new color) — used as a plain `text-*` class, not a badge background. */
export function requestReadinessTextClass(readiness: RequestReadiness): string {
  if (readiness === "ready") return "text-success-text";
  if (readiness === "needs_passenger") return "text-warning-text";
  return "text-text-muted";
}

/**
 * "Just now" / "12 min" / "2 hr" / "1 day" / "3 days" — the exact
 * granularity P1-E1-S2D §19 asks for. `now` is always an explicit
 * parameter (never `new Date()` internally), matching
 * location-freshness.ts's own established determinism/testability
 * discipline. Server-rendered once per request — deliberately NOT a
 * client-side ticking interval (§19's own explicit instruction).
 */
export function formatRequestAge(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const ageMs = Math.max(0, now.getTime() - created.getTime());
  const ageMinutes = Math.floor(ageMs / 60000);
  if (ageMinutes < 1) return "Just now";
  if (ageMinutes < 60) return `${ageMinutes} min`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours} hr`;
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays} day${ageDays === 1 ? "" : "s"}`;
}

/**
 * "No date given" / "Sep 20" / "Sep 20 · 8:30 AM" (P1-E1-S2D §20).
 * `preferred_date`/`preferred_time` are plain `date`/`time` columns
 * (not `timestamptz`) — unlike `formatOperationsTime` above, there is
 * no timezone conversion to perform; the stored calendar value is
 * rendered exactly as given, never reinterpreted through any IANA zone.
 * Never substitutes `created_at` (when the request was LOGGED) for the
 * service date (when transportation is actually WANTED) — an absent
 * preferred date renders as an honest "No date given", not a fabricated
 * one.
 */
export function formatRequestServiceDate(preferredDate: string | null, preferredTime: string | null): string {
  if (!preferredDate) return "No date given";
  const [year, month, day] = preferredDate.split("-").map(Number);
  // Formatted with timeZone: "UTC" explicitly, matching the UTC instant
  // this Date was deliberately constructed with (Date.UTC) — without
  // this, Intl.DateTimeFormat would reinterpret the instant through the
  // SERVER's own local timezone, which could shift the displayed
  // day/hour depending on where this code happens to run. There is no
  // real timezone conversion happening here at all (these are plain
  // date/time columns, not timestamptz) — UTC is used purely as a
  // neutral, fixed calendar to format calendar-value components
  // through, never as the request's actual timezone.
  const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  if (!preferredTime) return dateLabel;
  const [hour, minute] = preferredTime.split(":").map(Number);
  const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, 0, 1, hour, minute)),
  );
  return `${dateLabel} · ${timeLabel}`;
}

/** `request_events.event_type` (P1-E1-S2B's own closed, allow-listed set) → restrained human label, for Request Detail's Activity panel (P1-E1-S2F-B2 §16). Never exposes the raw event_type string; an unrecognized value falls through to itself rather than crashing, matching every other label lookup in this file. */
const REQUEST_EVENT_LABEL: Record<string, string> = {
  request_logged: "Request logged",
  passenger_linked: "Passenger linked",
  request_declined: "Request declined",
  request_cancelled: "Request cancelled",
};

export function requestEventLabel(eventType: string): string {
  return REQUEST_EVENT_LABEL[eventType] ?? eventType;
}

/**
 * `TripReadinessReasonCode` (trip-readiness-core.ts, P1-E1-S4B) → concise
 * operator language (P1-E1-S4D §8) — the exact closed 7-value vocabulary,
 * never a raw enum value, never an invented reason. Used by both Tomorrow
 * Readiness (P1-E1-S4D) and Trip Detail's own Preparation panel — one
 * mapping, not two independently-drifting copies.
 */
const TRIP_READINESS_REASON_LABEL: Record<TripReadinessReasonCode, string> = {
  NO_SCHEDULE: "Pickup time needed",
  NEEDS_DRIVER: "Driver needed",
  NEEDS_VEHICLE: "Vehicle needed",
  DRIVER_INACTIVE: "Assigned driver is inactive",
  VEHICLE_INACTIVE: "Assigned vehicle is inactive",
  PASSENGER_INACTIVE: "Passenger is inactive",
  OPEN_EXCEPTION: "Open issue",
};

export function tripReadinessReasonLabel(code: TripReadinessReasonCode): string {
  return TRIP_READINESS_REASON_LABEL[code];
}

/**
 * Recurring Care (P1-E2-S1E) presentation helpers — same "state → screen
 * label, one place to look" discipline, extended to
 * RecurringArrangementStatus and RecurringOccurrenceState
 * (recurring-care-core.ts, P1-E2-S1B/S1C). Never a new vocabulary of its
 * own — these are pure label/category lookups over the already-locked
 * domain states, never re-derived or duplicated logic.
 */
export function recurringArrangementStatusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "ended") return "Ended";
  return status;
}

export function recurringArrangementStatusCategory(status: string): StatusCategory {
  if (status === "active") return "active";
  if (status === "paused") return "neutral";
  if (status === "ended") return "cancelled";
  return "neutral";
}

/**
 * Human language for the 3 occurrence states (P1-E2-S1E §13) — never the
 * raw enum string. MISSING reads as "Not yet scheduled" (an
 * attention-level, preparation-oriented framing, never alarming red —
 * §36) rather than a clinical/negative-sounding label.
 */
export function recurringOccurrenceStateLabel(state: string): string {
  if (state === "SCHEDULED") return "Scheduled";
  if (state === "MISSING") return "Not yet scheduled";
  if (state === "SKIPPED") return "Skipped";
  return state;
}

/**
 * Visual priority (§36): MISSING is attention-level (warning/amber), never
 * critical-red by default — this is planning/assurance work, not an
 * active incident. SKIPPED is neutral/informational (a deliberate,
 * already-resolved operator decision). SCHEDULED is a quiet positive
 * confirmation, matching TripReadinessPanel's own "Prepared" treatment.
 */
export function recurringOccurrenceStateCategory(state: string): StatusCategory {
  if (state === "SCHEDULED") return "positive";
  if (state === "MISSING") return "warning";
  if (state === "SKIPPED") return "neutral";
  return "neutral";
}

const WEEKDAY_SHORT_LABEL: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

const WEEKDAY_FULL_LABEL: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export function recurringWeekdayShortLabel(day: number): string {
  return WEEKDAY_SHORT_LABEL[day] ?? String(day);
}

export function recurringWeekdayFullLabel(day: number): string {
  return WEEKDAY_FULL_LABEL[day] ?? String(day);
}

/** "Mon / Wed / Fri" style pattern summary — daysOfWeek is already ascending (canonical storage order, P1-E2-S1A1), never re-sorted here. */
export function formatRecurringPattern(daysOfWeek: number[]): string {
  return daysOfWeek.map(recurringWeekdayShortLabel).join(" / ");
}

/**
 * "Friday, September 25" style formatting for an already-resolved local
 * date-key string (`YYYY-MM-DD`, e.g. from RecurringOccurrence.serviceDate)
 * — NEVER re-interpreted through any timezone (the date-key is already
 * the arrangement-local calendar date; formatting it via `Intl` with
 * `timeZone: 'UTC'` against a synthetic UTC-midnight instant is a pure
 * calendar-label operation, not a second timezone conversion — mirrors
 * the "Date.UTC as scratch calendar calculator" technique already
 * established in recurring-care-core.ts itself).
 */
export function formatServiceDateLabel(dateKey: string): string {
  const instant = new Date(`${dateKey}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(instant);
}

/** Short "Fri, Sep 25" style formatting, for tighter list rows. */
export function formatServiceDateShortLabel(dateKey: string): string {
  const instant = new Date(`${dateKey}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(instant);
}

/**
 * "8:00 AM" style formatting for a bare wall-clock `time` column value
 * (`HH:mm:ss`, e.g. `recurring_arrangements.pickup_time`) — NOT an
 * instant, so never passed through `formatOperationsTime` (which expects
 * a real UTC timestamp + a real IANA zone to resolve against). Formats
 * against a synthetic UTC-midnight anchor date purely as a calendar-math
 * scratch value (mirrors formatServiceDateShortLabel's own identical
 * technique) — the wall-clock hour/minute are preserved exactly since
 * both the anchor and the formatter use UTC.
 */
export function formatWallClockTime(time: string): string {
  const instant = new Date(`1970-01-01T${time}Z`);
  if (Number.isNaN(instant.getTime())) return time;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(instant);
}
