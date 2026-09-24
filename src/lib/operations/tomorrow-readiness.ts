import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationDayBoundsUtc } from "./day-bounds";
import { deriveTripReadiness, type TripReadinessFacts } from "./trip-readiness-core";
import { aggregateTomorrowReadiness, type TomorrowReadinessAggregate, type TomorrowReadinessCandidate } from "./tomorrow-readiness-core";

export type { TomorrowReadinessAggregate, TomorrowReadinessItem } from "./tomorrow-readiness-core";

/**
 * The full server result — the pure aggregate (P1-E1-S4C) plus
 * authoritative day metadata (P1-E1-S4C1 §9), so a future UI (S4D) never
 * needs to recompute "what is tomorrow" itself via a second call to
 * `organizationDayBoundsUtc`. Deliberately NOT a formatted/presentation
 * string (e.g. no "Wednesday, September 18") — `timezone` and the two
 * raw UTC boundary instants are the authoritative facts; formatting them
 * for display is a presentation-layer concern for S4D, matching this
 * codebase's own established "state separate from presentation"
 * discipline (`request-readiness-core.ts`/`trip-readiness-core.ts` both
 * already draw this same line).
 */
export interface TomorrowReadinessData extends TomorrowReadinessAggregate {
  timezone: string;
  tomorrowStartUtc: string;
  tomorrowEndUtc: string;
  /**
   * P1-OPS-PROG2: per-Trip facts the inline Assign action needs to open the
   * SAME PROG1 AssignmentDialog (keyed by trip id). Additive -- readiness
   * itself is still derived only by `deriveTripReadiness`.
   */
  assignmentTargets: Record<string, TomorrowAssignmentTarget>;
}

export interface TomorrowAssignmentTarget {
  id: string;
  state: string;
  scheduledPickupAt: string;
  passengerName: string;
  pickupDescription: string;
  destinationDescription: string;
  recurringArrangementId: string | null;
  activeAssignmentId: string | null;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
}

/**
 * Server-side data-access boundary for Tomorrow Readiness (P1-E1-S4C).
 * Answers: "which scheduled Trips belong to tomorrow in this
 * organization, and which of them are READY vs NEEDS_PREPARATION?"
 * DATA ONLY — no UI, no Operations Brief integration, no Trip Detail
 * change (S4C's own explicit boundary).
 *
 * AUTHORIZATION PATTERN (S4C §4 — audited, not invented): every existing
 * Operations data-access module in this codebase
 * (`todays-operations.ts`, `dispatch-board.ts`, `trip-detail.ts`,
 * `operations-brief.ts`, and S4B's own `trip-readiness.ts`) takes
 * `organizationId`/`timezone` as PLAIN PARAMETERS — none of them call
 * `requireOperationsAccess` internally. The established, consistent
 * convention across this entire codebase is: the CALLING PAGE resolves
 * organization access via `requireOperationsAccess` and passes the
 * result down; the data-access function itself is never the trust
 * boundary. This function follows that exact same convention, for
 * consistency and because inventing a second pattern here (this
 * function calling `requireOperationsAccess` itself) would create two
 * different trust models across otherwise-identical modules — a future
 * maintainer copying whichever pattern they saw most recently could
 * easily get it wrong. `organizationId` is NEVER to be sourced from a
 * browser-supplied query param/form field by any future caller of this
 * function — that discipline is enforced by the SAME code-review/
 * architectural convention already relied on everywhere else in this
 * codebase, not by a new mechanism invented here.
 */

const TOMORROW_CANDIDATE_COLUMNS =
  "id, state, scheduled_pickup_at, pickup_description, destination_description, recurring_arrangement_id, " +
  "passengers!trips_passenger_id_organization_id_fkey(display_name, status), " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey(id, ended_at, vehicle_id, " +
  "drivers!trip_assignments_driver_id_organization_id_fkey(id, display_name, status), " +
  "vehicles!trip_assignments_vehicle_id_organization_id_fkey(id, label, status))";

interface StatusEmbed {
  status: string;
  id?: string;
  display_name?: string;
  label?: string;
}
type StatusRelation = StatusEmbed | StatusEmbed[] | null;

interface PassengerEmbed {
  display_name: string;
  status: string;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

interface AssignmentEmbed {
  id: string;
  ended_at: string | null;
  vehicle_id: string | null;
  drivers: StatusRelation;
  vehicles: StatusRelation;
}

interface TripRow {
  id: string;
  state: string;
  scheduled_pickup_at: string | null;
  pickup_description: string;
  destination_description: string;
  recurring_arrangement_id: string | null;
  passengers: PassengerRelation;
  trip_assignments: AssignmentEmbed[] | null;
}

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

/**
 * "Tomorrow" is the organization-local calendar day immediately
 * following `now`'s own organization-local calendar day — resolved
 * entirely via the existing `organizationDayBoundsUtc` helper, composed
 * twice (S4C §2, verified against the actual helper implementation
 * before use, see day-bounds-tomorrow.test.mjs): today's own [start,end)
 * is computed first, and today's `endUtc` — the exact instant that
 * belongs to the next organization-local day — is fed back into the
 * SAME helper to get tomorrow's own [start,end). This is NEVER computed
 * as `now.getTime() + 24*60*60*1000`, which is not guaranteed to land
 * on the correct calendar date across a DST transition.
 */
function computeTomorrowBoundsUtc(now: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const today = organizationDayBoundsUtc(now, timezone);
  return organizationDayBoundsUtc(today.endUtc, timezone);
}

/**
 * Fetches every `state='scheduled'` Trip whose `scheduled_pickup_at`
 * falls within tomorrow's own organization-local window, evaluates each
 * one via the real, unmodified `deriveTripReadiness` (P1-E1-S4B — never
 * re-implemented), and aggregates the results via
 * `aggregateTomorrowReadiness` (never a second "tomorrow readiness"
 * definition).
 *
 * QUERY ROUND TRIPS — exactly 2, both explicitly `organization_id`-
 * scoped, neither ever a `select("*")`:
 *   1. The Trip candidate query itself, with `passengers` and the
 *      active-assignment's `drivers`/`vehicles` status embedded in the
 *      SAME round trip (the same composite-FK-hint convention already
 *      proven in S4B's own `trip-readiness.ts` and in
 *      `trip-detail.ts`/`dispatch-board.ts`).
 *   2. One small, scoped `trip_exceptions` query against exactly the
 *      resulting candidate Trip ids (never one query per Trip — grouped
 *      into a per-trip count in memory), mirroring
 *      `todays-operations.ts`'s own established two-phase pattern.
 * No third query is needed.
 *
 * ACTIVE-ASSIGNMENT QUERY HARDENING (P1-E1-S4C1 §7): the embedded
 * `trip_assignments` relation is filtered directly, in the SAME query,
 * to `ended_at IS NULL` via `.is("trip_assignments.ended_at", null)` —
 * deliberately `.is()`, never `.eq()` (supabase-js's own documented
 * behavior: "Using the eq() filter doesn't work when filtering for
 * null. Instead, you need to use is()" — confirmed directly against the
 * installed `@supabase/postgrest-js` source before relying on it, not
 * assumed). Empirically confirmed against this project's own local
 * PostgREST instance before relying on it: filtering an embedded
 * (LEFT-JOINed)
 * relation this way narrows which rows of the embed are returned
 * WITHOUT excluding the parent Trip when zero rows match (verified live
 * — a Trip with no assignment at all still comes back with
 * `trip_assignments: []`, never dropped from the result). This is
 * option A from S4C1's own choice — never `!inner` (which WOULD turn
 * this into an inner join and silently drop every unassigned Trip, the
 * exact Trips this query most needs to surface as NEEDS_DRIVER). Given
 * the schema's own partial unique index already guarantees at most one
 * `ended_at IS NULL` row per Trip, the embedded array now contains
 * at most one historical-assignment-free row — Tomorrow Readiness never
 * fetches or transmits any ENDED (historical) assignment row for any
 * Trip, regardless of how much reassignment history that Trip
 * eventually accumulates.
 *
 * A Trip with `scheduled_pickup_at IS NULL` can never appear here — the
 * `.gte()`/`.lt()` range filter itself excludes it at the SQL level (a
 * NULL column value never satisfies either comparison), matching S4C
 * §3's own locked rule without any special-case code.
 */
export async function getTomorrowReadiness(
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<TomorrowReadinessData> {
  const { startUtc, endUtc } = computeTomorrowBoundsUtc(now, timezone);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const supabase = await createServerSupabaseClient();

  const { data: tripRows, error: tripsError } = await supabase
    .from("trips")
    .select(TOMORROW_CANDIDATE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("state", "scheduled")
    .gte("scheduled_pickup_at", startIso)
    .lt("scheduled_pickup_at", endIso)
    // Narrows the embedded trip_assignments relation to the active row
    // only (see this function's own doc comment above) — never
    // `!inner`, which would wrongly exclude unassigned Trips entirely.
    .is("trip_assignments.ended_at", null)
    .order("scheduled_pickup_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<TripRow[]>();

  if (tripsError) {
    throw new Error(`Failed to load tomorrow's candidate trips: ${tripsError.message}`);
  }

  const candidateIds = (tripRows ?? []).map((row) => row.id);

  const { data: exceptionRows, error: exceptionsError } =
    candidateIds.length > 0
      ? await supabase
          .from("trip_exceptions")
          .select("trip_id")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .in("trip_id", candidateIds)
      : { data: [], error: null };

  if (exceptionsError) {
    throw new Error(`Failed to load open exception counts for tomorrow readiness: ${exceptionsError.message}`);
  }

  const openExceptionCountByTrip = new Map<string, number>();
  for (const row of exceptionRows ?? []) {
    openExceptionCountByTrip.set(row.trip_id, (openExceptionCountByTrip.get(row.trip_id) ?? 0) + 1);
  }

  const assignmentTargets: Record<string, TomorrowAssignmentTarget> = {};
  const candidates: TomorrowReadinessCandidate[] = (tripRows ?? []).map((row) => {
    // The embedded relation is already filtered to `ended_at IS NULL`
    // (see the query above) and the schema's own partial unique index
    // guarantees at most one such row per Trip — `[0]` is therefore
    // always either the one true active assignment or nothing; no
    // in-memory `.find()` over historical rows is needed (P1-E1-S4C1
    // §7 — this array can never contain an ended/historical row at
    // all, regardless of how much reassignment history a Trip has
    // accumulated).
    const activeAssignment = (row.trip_assignments ?? [])[0] ?? null;
    const driver = unwrapOne(activeAssignment?.drivers);
    const vehicle = unwrapOne(activeAssignment?.vehicles);
    const passenger = unwrapOne(row.passengers);

    const facts: TripReadinessFacts = {
      state: row.state,
      scheduledPickupAt: row.scheduled_pickup_at,
      hasActiveAssignment: activeAssignment !== null,
      assignedVehicleId: activeAssignment?.vehicle_id ?? null,
      driverStatus: activeAssignment ? (driver?.status ?? null) : null,
      vehicleStatus: activeAssignment?.vehicle_id ? (vehicle?.status ?? null) : null,
      // trips.passenger_id is NOT NULL by schema -- every Trip always
      // has a Passenger row; a missing embed here would indicate a
      // genuine data integrity problem, never a legitimate "no
      // passenger" case (matches trip-readiness.ts's own S4B
      // discipline exactly).
      passengerStatus: passenger?.status ?? "inactive",
      openExceptionCount: openExceptionCountByTrip.get(row.id) ?? 0,
    };

    assignmentTargets[row.id] = {
      id: row.id,
      state: row.state,
      scheduledPickupAt: row.scheduled_pickup_at as string,
      passengerName: passenger?.display_name ?? "Unknown Passenger",
      pickupDescription: row.pickup_description,
      destinationDescription: row.destination_description,
      recurringArrangementId: row.recurring_arrangement_id,
      activeAssignmentId: activeAssignment?.id ?? null,
      driverId: activeAssignment ? (driver?.id ?? null) : null,
      driverName: activeAssignment ? (driver?.display_name ?? null) : null,
      vehicleId: activeAssignment?.vehicle_id ?? null,
      vehicleLabel: activeAssignment?.vehicle_id ? (vehicle?.label ?? null) : null,
    };

    return {
      tripId: row.id,
      // Non-null by construction: the SQL range filter above already
      // excludes any row with a null scheduled_pickup_at (S4C §3).
      scheduledPickupAt: row.scheduled_pickup_at as string,
      passengerDisplayName: passenger?.display_name ?? "Unknown Passenger",
      readiness: deriveTripReadiness(facts),
    };
  });

  return {
    ...aggregateTomorrowReadiness(candidates),
    timezone,
    tomorrowStartUtc: startIso,
    tomorrowEndUtc: endIso,
    assignmentTargets,
  };
}
