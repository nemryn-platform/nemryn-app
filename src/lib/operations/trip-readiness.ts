import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deriveTripReadiness, type TripReadinessFacts, type TripReadinessResult } from "./trip-readiness-core";

export type { TripReadinessState, TripReadinessReasonCode, TripReadinessResult } from "./trip-readiness-core";

/**
 * Server-side data-access boundary for Trip Readiness (P1-E1-S4B),
 * mirroring `trip-detail.ts`'s own established shape: organization-
 * scoped, explicit columns (never `select("*")`), no service role, no
 * presentation JSX. This is the SMALLEST wrapper that derives Readiness
 * for exactly one Trip — a small-set (multiple Trips) variant is
 * deliberately NOT built here; S4C owns tomorrow's own day-range query
 * and aggregation (S4B's own explicit boundary).
 *
 * organization_id is explicitly filtered on every query, never left to
 * RLS alone to narrow — the same defense-in-depth convention every
 * other Operations data-access module in this codebase already follows.
 *
 * A malformed/nonexistent/foreign-org `tripId` all resolve to `null`
 * (no existence oracle) — the caller decides what to do with that (this
 * module is not itself a page, so it never renders an "unavailable"
 * state directly).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StatusEmbed {
  status: string;
}
type StatusRelation = StatusEmbed | StatusEmbed[] | null;

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
  passengers: StatusRelation;
  trip_assignments: AssignmentEmbed[] | null;
}

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

const TRIP_READINESS_COLUMNS =
  "id, state, scheduled_pickup_at, " +
  "passengers!trips_passenger_id_organization_id_fkey(status), " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey(id, ended_at, vehicle_id, " +
  "drivers!trip_assignments_driver_id_organization_id_fkey(status), " +
  "vehicles!trip_assignments_vehicle_id_organization_id_fkey(status))";

/**
 * Fetches the exact minimal fact set `deriveTripReadiness` needs for
 * one Trip, then evaluates it. Returns `null` when the Trip does not
 * exist, belongs to a different organization, or `tripId` is malformed
 * — all three deliberately indistinguishable (no existence oracle),
 * matching `trip-detail.ts`'s own established convention.
 *
 * Two round trips: the Trip row itself (with its active assignment and
 * Passenger status embedded in the same query — one round trip, not
 * three), then a small head-only count of open `trip_exceptions` for
 * this one Trip (mirroring `operations-brief.ts`'s own
 * `getRequestSummary` head-count pattern). No N+1 — every query is
 * scoped to exactly this one Trip id.
 */
export async function getTripReadiness(tripId: string, organizationId: string): Promise<TripReadinessResult | null> {
  if (!UUID_RE.test(tripId)) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  const { data: tripRow, error: tripError } = await supabase
    .from("trips")
    .select(TRIP_READINESS_COLUMNS)
    .eq("id", tripId)
    .eq("organization_id", organizationId)
    .maybeSingle()
    .returns<TripRow>();

  if (tripError || !tripRow) {
    return null;
  }

  const { count: openExceptionCount, error: exceptionsError } = await supabase
    .from("trip_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .eq("organization_id", organizationId)
    .eq("status", "open");

  if (exceptionsError || openExceptionCount === null) {
    throw new Error(`Failed to load open exception count for trip readiness: ${exceptionsError?.message ?? "unknown"}`);
  }

  const activeAssignment = (tripRow.trip_assignments ?? []).find((a) => a.ended_at === null) ?? null;
  const driver = unwrapOne(activeAssignment?.drivers);
  const vehicle = unwrapOne(activeAssignment?.vehicles);
  const passenger = unwrapOne(tripRow.passengers);

  const facts: TripReadinessFacts = {
    state: tripRow.state,
    scheduledPickupAt: tripRow.scheduled_pickup_at,
    hasActiveAssignment: activeAssignment !== null,
    assignedVehicleId: activeAssignment?.vehicle_id ?? null,
    driverStatus: activeAssignment ? (driver?.status ?? null) : null,
    vehicleStatus: activeAssignment?.vehicle_id ? (vehicle?.status ?? null) : null,
    // trips.passenger_id is NOT NULL by schema — every Trip always has a
    // Passenger row; a missing embed here would indicate a genuine data
    // integrity problem, not a legitimate "no passenger" case, so this
    // deliberately does not silently default to "active".
    passengerStatus: passenger?.status ?? "inactive",
    openExceptionCount,
  };

  return deriveTripReadiness(facts);
}
