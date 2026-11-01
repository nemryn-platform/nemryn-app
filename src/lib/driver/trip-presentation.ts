/**
 * Driver-facing presentation derivations for canonical Trip state and time
 * (P1-E3-S2, timezone-corrected P1-E3-S2C). Single source of truth so a
 * later screen (Active Trip, Trips) reuses the same derivation rather than
 * re-deriving it independently (work item §17/§42 of P1-E3-S2, matching
 * ZD-089's "one place to look" principle already applied to the backend's
 * own transition table).
 *
 * These are UI groupings only — never a new stored Trip state (work item
 * §16 of P1-E3-S2). Canonical states remain exactly the 9 in
 * lifecycle-model.md §C.
 */

/**
 * The eligible Driver-location-tracking window (P1-E3-S7A, work item §5)
 * — the same 5 states already established as `ACTIVE_STATES` in
 * `src/lib/operations/presentation.ts`/`dispatch-board.ts` and hardcoded
 * server-side inside `driver_record_location` itself
 * (20260902140000_driver_location_tracking.sql). Deliberately duplicated
 * here rather than imported from the Operations module (this file's own
 * established boundary-keeping convention, see this file's header
 * comment) — the RPC itself remains the actual authority regardless of
 * what this constant says; it only gates whether the Driver page mounts
 * `DriverLocationTracker` at all.
 */
export const ELIGIBLE_LOCATION_TRACKING_STATES = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

const DRIVER_STATE_LABELS: Record<string, string> = {
  scheduled: "Assigned",
  en_route_to_pickup: "Heading to Pickup",
  arrived_at_pickup: "At Pickup",
  passenger_onboard: "Passenger Onboard",
  en_route_to_destination: "Heading to Destination",
  arrived_at_destination: "At Destination",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

/**
 * `state='scheduled'` reads as "Assigned" here (not "Scheduled") because a
 * Driver only ever sees Trips they currently hold an active assignment on —
 * the "unassigned" derivation never applies from this vantage point
 * (confirmed: ui-data-action-map.md §6). Unknown/unexpected values fall
 * back to the raw value rather than guessing.
 */
export function driverTripStateLabel(state: string): string {
  return DRIVER_STATE_LABELS[state] ?? state;
}

/**
 * P1-E3-S2C: every function below takes an explicit IANA `timezone`
 * parameter — there is deliberately no default, no optional parameter, and
 * no fallback to the runtime's own local timezone. `trips.scheduled_pickup_at`/
 * `appointment_at` are `timestamptz` (absolute UTC-normalized instants);
 * "what time is this locally" and "what calendar day is this" both depend
 * entirely on WHERE the organization operates, never on where the Node
 * process happens to be running (P1-E3-S1's original implementation used
 * `Intl` with no `timeZone` override, which is correct only by coincidence
 * when server and organization share a timezone — see decision-register.md
 * ZD-11x and docs/product/operational-timezone.md). A caller that has no
 * timezone to pass has a bug to fix at the call site, not a default to
 * reach for here — TypeScript enforces this by making the parameter
 * required, not optional.
 */

/** "8:30 AM" style formatting, in the given IANA timezone — never a raw ISO string. */
export function formatTripTime(iso: string | null, timezone: string): string {
  if (!iso) return "Time TBD";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
}

/** "Saturday, August 29" style formatting, in the given IANA timezone. */
export function formatLongDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(date);
}

/**
 * The organization-local calendar date (`YYYY-MM-DD`) a given instant falls
 * on, in the given IANA timezone — the standards-based way to answer "what
 * day is this, there" without hand-rolling any DST/offset arithmetic
 * (work item §11). `en-CA` is used purely as a locale that happens to
 * format as `YYYY-MM-DD`, a directly comparable sortable string — not
 * because Canada is relevant here. Exported (P1-E3-S3) for the Driver
 * Trips date-grouping — Driver Today only ever needed the boolean
 * comparison below.
 */
export function operationalDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Same organization-local calendar day, in the given IANA timezone — never the runtime's own local day. */
export function isSameOperationalDay(a: Date, b: Date, timezone: string): boolean {
  return operationalDateKey(a, timezone) === operationalDateKey(b, timezone);
}

/**
 * "Today" / "Tomorrow" / "Tuesday, September 1" — the Driver Trips
 * date-group heading (P1-E3-S3), derived entirely from the organization's
 * own operational calendar, never the runtime's. Adding 24h in
 * milliseconds to `now` to probe "tomorrow" is safe even across a DST
 * transition in `timezone`: the real-world DST shift in any IANA zone is
 * at most a couple of hours, so the probe instant always lands somewhere
 * within the intended next calendar day, never spilling into the day
 * after — `operationalDateKey` (which reads the actual local calendar
 * date via `Intl`) is what actually determines the label, not the ms
 * arithmetic itself.
 */
export function operationalDayLabel(date: Date, now: Date, timezone: string): string {
  const dateKey = operationalDateKey(date, timezone);
  if (dateKey === operationalDateKey(now, timezone)) return "Today";
  const tomorrowProbe = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dateKey === operationalDateKey(tomorrowProbe, timezone)) return "Tomorrow";
  return formatLongDate(date, timezone);
}

/**
 * Canonical Driver lifecycle progression (P1-E3-S3) — the single source of
 * truth mapping a Trip's current canonical state to the ONE next legal
 * Driver action, its RPC name, and its button label. Verified against
 * lifecycle-model.md §N ("Trip transitions") and docs/data/mutation-api.md
 * before writing this table, not assumed from the work item's own
 * conceptual sketch alone — both agree exactly. `completed`/`cancelled`/
 * `no_show` intentionally have no entry: no progression action exists from
 * a terminal state, for anyone, ever (lifecycle-model.md §C).
 */
export const DRIVER_NEXT_ACTION: Record<string, { rpc: DriverLifecycleRpc; label: string; targetState: string }> = {
  scheduled: { rpc: "driver_start_to_pickup", label: "Start to Pickup", targetState: "en_route_to_pickup" },
  en_route_to_pickup: { rpc: "driver_arrive_at_pickup", label: "I'VE ARRIVED", targetState: "arrived_at_pickup" },
  arrived_at_pickup: {
    rpc: "driver_mark_passenger_onboard",
    label: "Passenger Onboard",
    targetState: "passenger_onboard",
  },
  passenger_onboard: {
    rpc: "driver_start_to_destination",
    label: "Start to Destination",
    targetState: "en_route_to_destination",
  },
  en_route_to_destination: {
    rpc: "driver_arrive_at_destination",
    label: "I'VE ARRIVED",
    targetState: "arrived_at_destination",
  },
  arrived_at_destination: { rpc: "driver_complete_trip", label: "Complete Trip", targetState: "completed" },
};

export type DriverLifecycleRpc =
  | "driver_start_to_pickup"
  | "driver_arrive_at_pickup"
  | "driver_mark_passenger_onboard"
  | "driver_start_to_destination"
  | "driver_arrive_at_destination"
  | "driver_complete_trip";

/**
 * Which leg of the trip is currently "live" for Navigate/Call Passenger
 * purposes — pickup while heading to/at pickup, destination from the
 * moment the passenger is onboard. Not a stored concept, purely a
 * presentation derivation (work item §35 — no invented telemetry, just
 * grouping an already-known state into "which address matters right now").
 */
export function currentLeg(state: string): "pickup" | "destination" | "none" {
  if (state === "scheduled" || state === "en_route_to_pickup" || state === "arrived_at_pickup") return "pickup";
  if (state === "passenger_onboard" || state === "en_route_to_destination" || state === "arrived_at_destination") {
    return "destination";
  }
  return "none";
}

/** Shown in place of a stop that has no usable address (NP-DRIVER-UX-02). Navigate is never offered for it. */
export const ADDRESS_MISSING_MESSAGE = "Address missing — contact dispatch.";

/**
 * A Trip the Driver has started and not finished (NP-DRIVER-UX-02): any state between "Start to Pickup" and
 * "Complete Trip". Same five states as `ELIGIBLE_LOCATION_TRACKING_STATES`, kept under its own name because the two
 * answer different questions.
 */
export const DRIVER_IN_PROGRESS_STATES: ReadonlySet<string> = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

export function isTripInProgress(state: string): boolean {
  return DRIVER_IN_PROGRESS_STATES.has(state);
}

/**
 * Driver Today's trips in display order (NP-DRIVER-UX-02). A Trip already IN PROGRESS always appears and always comes
 * first — whatever day it was scheduled for, and even with no scheduled time — so the dominant "next trip" card never
 * points past a ride the Driver is still on. Every other Trip appears only when scheduled for TODAY in the
 * organization's timezone (a Trip with no time has no honest "is this today" answer and stays on the Trips tab).
 * Within each group: earliest scheduled pickup first, untimed last, original order otherwise (stable).
 */
export function selectTodayTrips<T extends { state: string; scheduledPickupAt: string | null }>(
  trips: readonly T[],
  now: Date,
  timezone: string,
): T[] {
  const time = (t: T) => {
    const ms = t.scheduledPickupAt ? new Date(t.scheduledPickupAt).getTime() : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return trips
    .map((trip, index) => ({ trip, index }))
    .filter(({ trip }) => {
      if (isTripInProgress(trip.state)) return true;
      if (!trip.scheduledPickupAt) return false;
      const at = new Date(trip.scheduledPickupAt);
      return !Number.isNaN(at.getTime()) && isSameOperationalDay(at, now, timezone);
    })
    .sort((a, b) => {
      const progress = Number(isTripInProgress(b.trip.state)) - Number(isTripInProgress(a.trip.state));
      if (progress !== 0) return progress;
      const ta = time(a.trip), tb = time(b.trip);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ trip }) => trip);
}
