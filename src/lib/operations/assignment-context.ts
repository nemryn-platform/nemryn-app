import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDaysToDateKey, localMidnightUtc, organizationDayBoundsUtc } from "./day-bounds";
import { formatOperationsLongDate, formatOperationsTime, operationsTripStatusLabel } from "./presentation";
import { deriveTripExtent, formatTripExtent } from "./trip-overlap-core";
import {
  deriveDriverDayFacts,
  IN_PROGRESS_TRIP_STATES,
  selectRecurringAssignmentHint,
  type DriverTripFact,
  type RecurringAssignmentHint,
  type RecurringHistoryRow,
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
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTEXT_ROW_LIMIT = 50;

const DRIVER_TRIP_COLUMNS =
  "id, state, scheduled_pickup_at, expected_duration_minutes, pickup_description, destination_description, " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey!inner(id)";

interface DriverTripRow {
  id: string;
  state: string;
  scheduled_pickup_at: string | null;
  expected_duration_minutes: number | null;
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
  /** P1-OPS-PROG4: the planned extent ("9:30 AM – 10:15 AM") when the trip's duration is known, else null. */
  extentLabel: string | null;
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

/**
 * Which day the driver-day context is for: an existing Trip's own org-local day, or (New Trip) a chosen org-local
 * date. P1-OPS-PROG4: a New Trip target may also carry the entered pickup time and expected duration, used only
 * by the overlap read (the day list itself is keyed on the date).
 */
export type DriverDayTarget =
  | { kind: "trip"; tripId: string }
  | { kind: "date"; dateKey: string; pickupTime?: string | null; expectedDurationMinutes?: number | null; requiresWheelchairAccess?: boolean | null };

export async function getDriverDayContext(
  organizationId: string,
  timezone: string,
  target: DriverDayTarget,
  driverId: string,
): Promise<DriverDayContext> {
  if (!UUID_PATTERN.test(driverId)) return { status: "unavailable" };

  const supabase = await createServerSupabaseClient();

  let excludeTripId: string | null = null;
  let bounds: { startUtc: Date; endUtc: Date } | null = null;
  let dayLabel: string | null = null;
  if (target.kind === "trip") {
    if (!UUID_PATTERN.test(target.tripId)) return { status: "unavailable" };
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, scheduled_pickup_at")
      .eq("organization_id", organizationId)
      .eq("id", target.tripId)
      .maybeSingle();
    if (tripError || !trip) return { status: "unavailable" };
    excludeTripId = trip.id;
    if (trip.scheduled_pickup_at) {
      bounds = organizationDayBoundsUtc(new Date(trip.scheduled_pickup_at), timezone);
      dayLabel = formatOperationsLongDate(new Date(trip.scheduled_pickup_at), timezone);
    }
  } else {
    if (!DATE_KEY_PATTERN.test(target.dateKey)) return { status: "unavailable" };
    const startUtc = localMidnightUtc(target.dateKey, timezone);
    bounds = { startUtc, endUtc: localMidnightUtc(addDaysToDateKey(target.dateKey, 1), timezone) };
    dayLabel = formatOperationsLongDate(startUtc, timezone);
  }

  const base = () => {
    const query = supabase
      .from("trips")
      .select(DRIVER_TRIP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("trip_assignments.driver_id", driverId)
      .is("trip_assignments.ended_at", null);
    return excludeTripId ? query.neq("id", excludeTripId) : query;
  };

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

  const durations = new Map(
    [...(dayResult.data ?? []), ...(currentResult.data ?? [])].map((row) => [row.id, row.expected_duration_minutes] as const),
  );
  const facts = deriveDriverDayFacts({
    targetTripId: excludeTripId ?? "",
    dayStartUtc: bounds ? bounds.startUtc.toISOString() : null,
    dayEndUtc: bounds ? bounds.endUtc.toISOString() : null,
    trips: [...(dayResult.data ?? []), ...(currentResult.data ?? [])].map(toFact),
  });

  return {
    status: "ok",
    dayLabel,
    otherTrips: facts.otherTrips.map((trip) => ({
      tripId: trip.tripId,
      timeLabel: formatOperationsTime(trip.scheduledPickupAt, timezone),
      extentLabel: formatTripExtent(deriveTripExtent(trip.scheduledPickupAt, durations.get(trip.tripId) ?? null), timezone),
      statusLabel: operationsTripStatusLabel(trip.state, true),
      pickupDescription: trip.pickupDescription,
      destinationDescription: trip.destinationDescription,
    })),
    currentTripStatusLabel: facts.currentTrip ? operationsTripStatusLabel(facts.currentTrip.state, true) : null,
  };
}

/** A Trip that may be assigned, with the recurring linkage needed to look up its history. */
export interface RecurringHintTarget {
  tripId: string;
  recurringArrangementId: string | null;
  scheduledPickupAt: string | null;
}

/** How far back a completed occurrence may be and still prefill (a documented bound, not a product concept). */
const RECURRING_HISTORY_WINDOW_DAYS = 90;
const RECURRING_HISTORY_ROW_LIMIT = 500;

interface RecurringHistoryTripRow {
  id: string;
  recurring_arrangement_id: string | null;
  state: string;
  scheduled_pickup_at: string | null;
  trip_assignments: { driver_id: string; vehicle_id: string | null; ended_at: string | null; end_reason: string | null }[] | null;
}

/**
 * P1-OPS-PROG2 recurring-history prefill hints for any number of Trips in
 * ONE bounded, organization-filtered, session-client (RLS) query: the
 * COMPLETED Trips of the same arrangements (explicit
 * `trips.recurring_arrangement_id` linkage) within the history window,
 * with their assignment rows. The completing assignment is the one closed
 * with `end_reason='trip_completed'` (driver_complete_trip), or one still
 * open. `selectRecurringAssignmentHint` then picks the nearest earlier
 * occurrence per target. Only Driver/Vehicle ids ever leave the server --
 * no historical Trip or Passenger details.
 */
export async function getRecurringAssignmentHints(
  organizationId: string,
  targets: RecurringHintTarget[],
): Promise<Record<string, RecurringAssignmentHint>> {
  const eligible = targets.filter((t) => t.recurringArrangementId && t.scheduledPickupAt && !Number.isNaN(Date.parse(t.scheduledPickupAt)));
  if (eligible.length === 0) return {};
  const arrangementIds = [...new Set(eligible.map((t) => t.recurringArrangementId as string))];
  const times = eligible.map((t) => Date.parse(t.scheduledPickupAt as string));
  const latest = new Date(Math.max(...times)).toISOString();
  const earliest = new Date(Math.min(...times) - RECURRING_HISTORY_WINDOW_DAYS * 86_400_000).toISOString();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, recurring_arrangement_id, state, scheduled_pickup_at, " +
        "trip_assignments!trip_assignments_trip_id_organization_id_fkey(driver_id, vehicle_id, ended_at, end_reason)",
    )
    .eq("organization_id", organizationId)
    .in("recurring_arrangement_id", arrangementIds)
    .eq("state", "completed")
    .gte("scheduled_pickup_at", earliest)
    .lt("scheduled_pickup_at", latest)
    .order("scheduled_pickup_at", { ascending: false })
    .limit(RECURRING_HISTORY_ROW_LIMIT)
    .returns<RecurringHistoryTripRow[]>();
  // A hint is a convenience: a failed read simply means no recurring prefill.
  if (error) return {};

  const history: RecurringHistoryRow[] = (data ?? []).map((row) => {
    const assignments = row.trip_assignments ?? [];
    const completing =
      assignments.find((a) => a.end_reason === "trip_completed") ?? assignments.find((a) => a.ended_at === null) ?? null;
    return {
      tripId: row.id,
      recurringArrangementId: row.recurring_arrangement_id ?? "",
      state: row.state,
      scheduledPickupAt: row.scheduled_pickup_at,
      completedBy: completing ? { driverId: completing.driver_id, vehicleId: completing.vehicle_id } : null,
    };
  });

  const hints: Record<string, RecurringAssignmentHint> = {};
  for (const target of eligible) {
    const hint = selectRecurringAssignmentHint(target, history);
    if (hint) hints[target.tripId] = hint;
  }
  return hints;
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

/** Single-Trip convenience over `getRecurringAssignmentHints` (Trip Detail): one small lookup, then the same bounded history read. */
export async function getRecurringAssignmentHintForTrip(
  organizationId: string,
  tripId: string,
): Promise<RecurringAssignmentHint | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .select("id, recurring_arrangement_id, scheduled_pickup_at")
    .eq("organization_id", organizationId)
    .eq("id", tripId)
    .maybeSingle();
  if (error || !data?.recurring_arrangement_id) return null;
  const hints = await getRecurringAssignmentHints(organizationId, [
    { tripId: data.id, recurringArrangementId: data.recurring_arrangement_id, scheduledPickupAt: data.scheduled_pickup_at },
  ]);
  return hints[data.id] ?? null;
}
