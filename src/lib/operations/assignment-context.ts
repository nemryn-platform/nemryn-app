import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationDayBoundsUtc } from "./day-bounds";
import { formatOperationsLongDate, formatOperationsTime, operationsTripStatusLabel } from "./presentation";
import {
  deriveDriverDayFacts,
  IN_PROGRESS_TRIP_STATES,
  type DriverTripFact,
} from "./assignment-defaults-core";

/**
 * Tenant-scoped server reads behind the Progressive Assignment dialog
 * (P1-OPS-PROG1). Session client only (RLS applies) -- no service role,
 * nothing privileged reaches the browser, and every query is also
 * explicitly filtered by the server-resolved organization id.
 *
 * Driver-day context is loaded ON DEMAND for the one Driver the operator
 * has selected (never pre-fetched for every Driver on the board): one
 * lookup of the target Trip's schedule, then two small bounded queries in
 * parallel. The Dispatch board's own render is unchanged.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_ROW_LIMIT = 50;

const DRIVER_TRIP_COLUMNS =
  "id, state, scheduled_pickup_at, pickup_description, destination_description, " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey!inner(id)";

interface DriverTripRow {
  id: string;
  state: string;
  scheduled_pickup_at: string | null;
  pickup_description: string;
  destination_description: string;
}

/**
 * The signed-in operator's own active linked Driver in this organization
 * (owner-as-driver), resolved exactly the way every Driver-scoped RPC
 * resolves it -- `current_driver_id` -- never from Membership.role.
 * Presentation input only (option ordering / "(you)" / empty-state copy).
 */
export const getOperatorLinkedDriverId = cache(async (organizationId: string): Promise<string | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("current_driver_id", { p_org_id: organizationId });
  if (error) return null;
  return typeof data === "string" && data.length > 0 ? data : null;
});

export interface DriverDayTripView {
  tripId: string;
  timeLabel: string;
  statusLabel: string;
  pickupDescription: string;
  destinationDescription: string;
}

export type DriverDayContext =
  | {
      status: "ok";
      /** The target Trip's organization-local date ("Tuesday, September 29"), or null when the Trip has no scheduled pickup. */
      dayLabel: string | null;
      otherTrips: DriverDayTripView[];
      /** Status label of a Trip the Driver is provably on right now, or null. */
      currentTripStatusLabel: string | null;
    }
  | { status: "unavailable" };

function toFact(row: DriverTripRow): DriverTripFact {
  return {
    tripId: row.id,
    state: row.state,
    scheduledPickupAt: row.scheduled_pickup_at,
    pickupDescription: row.pickup_description,
    destinationDescription: row.destination_description,
  };
}

export async function getDriverDayContext(
  organizationId: string,
  timezone: string,
  tripId: string,
  driverId: string,
): Promise<DriverDayContext> {
  if (!UUID_PATTERN.test(tripId) || !UUID_PATTERN.test(driverId)) return { status: "unavailable" };

  const supabase = await createServerSupabaseClient();

  const { data: target, error: targetError } = await supabase
    .from("trips")
    .select("id, scheduled_pickup_at")
    .eq("organization_id", organizationId)
    .eq("id", tripId)
    .maybeSingle();
  if (targetError || !target) return { status: "unavailable" };

  const bounds = target.scheduled_pickup_at
    ? organizationDayBoundsUtc(new Date(target.scheduled_pickup_at), timezone)
    : null;

  const base = () =>
    supabase
      .from("trips")
      .select(DRIVER_TRIP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("trip_assignments.driver_id", driverId)
      .is("trip_assignments.ended_at", null)
      .neq("id", tripId);

  const [dayResult, currentResult] = await Promise.all([
    bounds
      ? base()
          .gte("scheduled_pickup_at", bounds.startUtc.toISOString())
          .lt("scheduled_pickup_at", bounds.endUtc.toISOString())
          .in("state", ["scheduled", ...IN_PROGRESS_TRIP_STATES])
          .order("scheduled_pickup_at", { ascending: true })
          .limit(CONTEXT_ROW_LIMIT)
          .returns<DriverTripRow[]>()
      : Promise.resolve({ data: [] as DriverTripRow[], error: null }),
    base()
      .in("state", [...IN_PROGRESS_TRIP_STATES])
      .order("scheduled_pickup_at", { ascending: true })
      .limit(5)
      .returns<DriverTripRow[]>(),
  ]);
  if (dayResult.error || currentResult.error) return { status: "unavailable" };

  const facts = deriveDriverDayFacts({
    targetTripId: tripId,
    dayStartUtc: bounds ? bounds.startUtc.toISOString() : null,
    dayEndUtc: bounds ? bounds.endUtc.toISOString() : null,
    trips: [...(dayResult.data ?? []), ...(currentResult.data ?? [])].map(toFact),
  });

  return {
    status: "ok",
    dayLabel: target.scheduled_pickup_at ? formatOperationsLongDate(new Date(target.scheduled_pickup_at), timezone) : null,
    otherTrips: facts.otherTrips.map((trip) => ({
      tripId: trip.tripId,
      timeLabel: formatOperationsTime(trip.scheduledPickupAt, timezone),
      statusLabel: operationsTripStatusLabel(trip.state, true),
      pickupDescription: trip.pickupDescription,
      destinationDescription: trip.destinationDescription,
    })),
    currentTripStatusLabel: facts.currentTrip ? operationsTripStatusLabel(facts.currentTrip.state, true) : null,
  };
}

export interface AssignmentOptions {
  driverOptions: { id: string; displayName: string }[];
  vehicleOptions: { id: string; label: string }[];
}

/**
 * The same eligible-option lists the Dispatch board offers (`status='active'`,
 * this organization) for the Trip Detail entry point of the SAME dialog and
 * the SAME Server Action. UI filtering only -- assign_trip / reassign_trip
 * re-validate every choice.
 */
export async function getAssignmentOptions(organizationId: string): Promise<AssignmentOptions> {
  const supabase = await createServerSupabaseClient();
  const [driversResult, vehiclesResult] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, display_name")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("display_name", { ascending: true }),
    supabase
      .from("vehicles")
      .select("id, label")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("label", { ascending: true }),
  ]);
  if (driversResult.error) throw new Error(`Failed to load driver options: ${driversResult.error.message}`);
  if (vehiclesResult.error) throw new Error(`Failed to load vehicle options: ${vehiclesResult.error.message}`);
  return {
    driverOptions: (driversResult.data ?? []).map((d) => ({ id: d.id, displayName: d.display_name })),
    vehicleOptions: (vehiclesResult.data ?? []).map((v) => ({ id: v.id, label: v.label })),
  };
}
