import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationDayBoundsUtc } from "./day-bounds";
import { operationsTripStatusLabel } from "./presentation";
import { getLatestLocationsByTrip, type DispatchTripLocation } from "./live-location";
import { getOverlapCandidates } from "./trip-overlap";
import { deriveResourceOverlap, deriveTripExtent, type ResourceCheckStatus } from "./trip-overlap-core";

/**
 * Server-side data access boundary for the Dispatch Board (P1-E3-S5, work
 * item §41) — organization-scoped, explicit columns, timezone-aware, no
 * service role, no presentation JSX. A dedicated module, not a reuse of
 * `todays-operations.ts`: Dispatch needs Driver/Vehicle assignment OPTIONS
 * (never queried by Today's Operations) and excludes terminal-state Trips
 * entirely (Today's Operations is where completed/cancelled/no_show
 * visibility already lives — work item §20).
 *
 * Bounded to the organization's local "today", same as Today's Operations
 * (`organizationDayBoundsUtc`) — the reference's own day navigator implies
 * a day-scoped board, and the center grid is inherently a TODAY time axis;
 * an in-progress Trip whose `scheduled_pickup_at` fell outside today's
 * window has no meaningful place on that axis, unlike Today's Operations'
 * flat Active Trips list (ZD-131), which deliberately has no day bound.
 * This is a genuine architectural difference between a list and a spatial
 * time-grid, not an inconsistency — recorded in decision-register.md.
 */

const TRIP_COLUMNS =
  "id, state, scheduled_pickup_at, appointment_at, pickup_description, destination_description, recurring_arrangement_id, expected_duration_minutes, " +
  "passengers!trips_passenger_id_organization_id_fkey(display_name), " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey(id, ended_at, " +
  "drivers!trip_assignments_driver_id_organization_id_fkey(id, display_name), " +
  "vehicles!trip_assignments_vehicle_id_organization_id_fkey(id, label))";

/** Every non-terminal canonical state (lifecycle-model.md §C) — completed/cancelled/no_show are deliberately excluded (work item §20). */
const NON_TERMINAL_STATES = [
  "scheduled",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
];

const ACTIVE_STATES = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

interface NameEmbed {
  id: string;
  display_name: string;
}
type NameRelation = NameEmbed | NameEmbed[] | null;

interface LabelEmbed {
  id: string;
  label: string;
}
type LabelRelation = LabelEmbed | LabelEmbed[] | null;

interface TripAssignmentEmbed {
  id: string;
  ended_at: string | null;
  drivers: NameRelation;
  vehicles: LabelRelation;
}

interface TripRow {
  id: string;
  state: string;
  scheduled_pickup_at: string | null;
  appointment_at: string | null;
  pickup_description: string;
  destination_description: string;
  recurring_arrangement_id: string | null;
  expected_duration_minutes: number | null;
  passengers: NameRelation;
  trip_assignments: TripAssignmentEmbed[] | null;
}

/** Same defensive to-one-embed unwrap `todays-operations.ts`/`getActiveMemberships()` already established — PostgREST can return either shape depending on inference. */
function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

export interface DispatchTrip {
  id: string;
  state: string;
  statusLabel: string;
  isActiveState: boolean;
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  passengerName: string;
  pickupDescription: string;
  destinationDescription: string;
  /** The active `trip_assignments.id` (null when unassigned) — P1-E3-S5A: this is the `p_expected_assignment_id` the Reassign dialog must submit, so the RPC can verify the Dispatcher is acting on the assignment they actually reviewed, not a since-superseded one. */
  activeAssignmentId: string | null;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  /** P1-E3-S7A — the Driver's latest known position, ONLY when it belongs to the CURRENT active assignment (never a stale former Driver's last-known position after reassignment, work item §51). Null whenever no location has been recorded yet, or the only recorded location belongs to a superseded assignment. */
  driverLocation: DispatchTripLocation | null;
  /** P1-OPS-PROG2 — the recurring arrangement this Trip was generated from, if any (recurring-history prefill lookup only). */
  recurringArrangementId: string | null;
  /** P1-OPS-PROG4 — planned duration (null = unknown; drawn as a "Duration not set" chip, never a made-up width). */
  expectedDurationMinutes: number | null;
  /** P1-OPS-PROG4 — overlap facts for the trip's CURRENT driver / vehicle (canonical trip-overlap-core); null when unassigned / no vehicle. */
  overlap: {
    driver: ResourceCheckStatus | null;
    vehicle: ResourceCheckStatus | null;
    /** P1-OPS-PROG4B-R2 — the driver or vehicle also holds an active assigned trip with NO pickup time (never drawn on the board). */
    unknownTimeCommitment: boolean;
  };
  /** P1-OPS-PROG4 — still non-terminal although its known planned end has passed (a fact, not a lateness claim). */
  pastPlannedEnd: boolean;
  /** P1-E3-S8 — a real open TripException exists for this Trip. Restrained use only (work item §31): a small indicator on the grid block, never a second full location-style panel. */
  hasOpenException: boolean;
}

function mapTripRow(
  row: TripRow,
  locationsByTrip: Map<string, DispatchTripLocation>,
  openExceptionTripIds: Set<string>,
): DispatchTrip {
  const activeAssignment = (row.trip_assignments ?? []).find((assignment) => assignment.ended_at === null) ?? null;
  const driver = unwrapOne(activeAssignment?.drivers);
  const vehicle = unwrapOne(activeAssignment?.vehicles);
  const passenger = unwrapOne(row.passengers);

  // Assignment-scoped latest location (work item §51): the latest row
  // recorded for this Trip is only ever shown when it actually belongs to
  // the CURRENT active assignment — a location row left over from a
  // former Driver, pre-reassignment, is discarded here rather than
  // displayed as if it were current.
  const latestLocation = locationsByTrip.get(row.id) ?? null;
  const driverLocation =
    latestLocation && activeAssignment && latestLocation.assignmentId === activeAssignment.id ? latestLocation : null;

  return {
    id: row.id,
    state: row.state,
    statusLabel: operationsTripStatusLabel(row.state, activeAssignment !== null),
    isActiveState: ACTIVE_STATES.has(row.state),
    scheduledPickupAt: row.scheduled_pickup_at,
    appointmentAt: row.appointment_at,
    passengerName: passenger?.display_name ?? "Unknown Passenger",
    pickupDescription: row.pickup_description,
    destinationDescription: row.destination_description,
    activeAssignmentId: activeAssignment?.id ?? null,
    driverId: driver?.id ?? null,
    driverName: driver?.display_name ?? null,
    vehicleId: vehicle?.id ?? null,
    vehicleLabel: vehicle?.label ?? null,
    driverLocation,
    recurringArrangementId: row.recurring_arrangement_id,
    expectedDurationMinutes: row.expected_duration_minutes,
    overlap: { driver: null, vehicle: null, unknownTimeCommitment: false },
    pastPlannedEnd: false,
    hasOpenException: openExceptionTripIds.has(row.id),
  };
}

export interface DispatchDriverOption {
  id: string;
  displayName: string;
}

export interface DispatchVehicleOption {
  id: string;
  label: string;
}

export interface DispatchDriverRow {
  driver: DispatchDriverOption;
  trips: DispatchTrip[];
}

export type DispatchDay = "today" | "tomorrow";

export interface DispatchBoardData {
  /** P1-OPS-PROG4 — which org-local day this board shows (same engine for both). */
  day: DispatchDay;
  dayBoundsUtc: { startUtc: string; endUtc: string };
  /** Every non-terminal Trip scheduled today, assigned or not — the full working set the board is built from. */
  trips: DispatchTrip[];
  /** `state='scheduled'` with no active assignment — the left-column queue. */
  unassignedTrips: DispatchTrip[];
  /** Has an active assignment (any non-terminal state) — feeds the center grid. */
  assignedTrips: DispatchTrip[];
  /** Every `status='active'` Driver in the organization, each with today's assigned Trips (possibly none) — feeds the center grid rows and the right-column capacity rail. */
  driverRows: DispatchDriverRow[];
  /** `status='active'` Drivers/Vehicles, for the assignment dialog's option lists — the ONLY status filter applied; no Available/Break/Unavailable taxonomy exists (GAP-6) and none is invented here. */
  driverOptions: DispatchDriverOption[];
  vehicleOptions: DispatchVehicleOption[];
  summary: {
    todayCount: number;
    unassignedCount: number;
    activeCount: number;
    /** Today's board Trips with a real open TripException — reuses
     * openExceptionTripIds, already fetched for the per-block marker
     * (P1-E3-S8), rather than a second query. Deliberately excludes
     * unassignedCount from this figure's own meaning: "needs assignment"
     * and "has an open issue" are different attention reasons, shown as
     * two separate honest counts, never merged into one ambiguous
     * number (P1-E3-S8B, work item §28). */
    attentionCount: number;
  };
}

export async function getDispatchBoardData(organizationId: string, timezone: string, day: DispatchDay = "today"): Promise<DispatchBoardData> {
  const now = new Date();
  const today = organizationDayBoundsUtc(now, timezone);
  // Tomorrow = the same helper composed on today's end (DST-safe), exactly as Tomorrow readiness does.
  const { startUtc, endUtc } = day === "tomorrow" ? organizationDayBoundsUtc(today.endUtc, timezone) : today;
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const supabase = await createServerSupabaseClient();

  const [tripsResult, driversResult, vehiclesResult] = await Promise.all([
    supabase
      .from("trips")
      .select(TRIP_COLUMNS)
      .eq("organization_id", organizationId)
      .gte("scheduled_pickup_at", startIso)
      .lt("scheduled_pickup_at", endIso)
      .in("state", NON_TERMINAL_STATES)
      .order("scheduled_pickup_at", { ascending: true })
      .returns<TripRow[]>(),
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

  if (tripsResult.error) {
    throw new Error(`Failed to load dispatch trips: ${tripsResult.error.message}`);
  }
  if (driversResult.error) {
    throw new Error(`Failed to load dispatch driver options: ${driversResult.error.message}`);
  }
  if (vehiclesResult.error) {
    throw new Error(`Failed to load dispatch vehicle options: ${vehiclesResult.error.message}`);
  }

  // Only Trips currently in the eligible tracking window (ACTIVE_STATES —
  // en_route_to_pickup through arrived_at_destination) could plausibly
  // have a location row at all (driver_record_location itself rejects
  // every other state) — a small, deliberate filter before the location
  // query, not a security boundary (the query is already organization-
  // scoped and RLS-backed regardless).
  const activeStateTripIds = (tripsResult.data ?? [])
    .filter((row) => ACTIVE_STATES.has(row.state))
    .map((row) => row.id);
  const allTripIds = (tripsResult.data ?? []).map((row) => row.id);

  const [locationsByTrip, exceptionsResult] = await Promise.all([
    getLatestLocationsByTrip(organizationId, activeStateTripIds),
    allTripIds.length > 0
      ? supabase
          .from("trip_exceptions")
          .select("trip_id")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .in("trip_id", allTripIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (exceptionsResult.error) {
    throw new Error(`Failed to load dispatch open exceptions: ${exceptionsResult.error.message}`);
  }
  const openExceptionTripIds = new Set((exceptionsResult.data ?? []).map((row) => row.trip_id));

  const trips = (tripsResult.data ?? []).map((row) => mapTripRow(row, locationsByTrip, openExceptionTripIds));

  // P1-OPS-PROG4 — overlap facts for every assigned trip from ONE candidate set (three paginated families: the day
  // window with the 48 h look-back, older still-open assigned trips, and assigned trips with no pickup time),
  // derived in memory by the canonical pure model. No per-trip query.
  const nowMs = now.getTime();
  const candidateSet = await getOverlapCandidates(organizationId, startUtc.getTime(), endUtc.getTime());
  for (const trip of trips) {
    const extent = deriveTripExtent(trip.scheduledPickupAt, trip.expectedDurationMinutes);
    trip.pastPlannedEnd = extent.kind === "known" && extent.endMs < nowMs;
    if (!trip.driverId && !trip.vehicleId) continue;
    const result = deriveResourceOverlap(
      { tripId: trip.id, scheduledPickupAt: trip.scheduledPickupAt, expectedDurationMinutes: trip.expectedDurationMinutes, driverId: trip.driverId, vehicleId: trip.vehicleId },
      candidateSet.candidates,
      nowMs,
      candidateSet.coverage,
    );
    trip.overlap = {
      driver: result.driver?.status ?? null,
      vehicle: result.vehicle?.status ?? null,
      unknownTimeCommitment: (result.driver?.missingSchedule.length ?? 0) + (result.vehicle?.missingSchedule.length ?? 0) > 0,
    };
  }
  const unassignedTrips = trips.filter((trip) => trip.state === "scheduled" && trip.driverId === null);
  const assignedTrips = trips.filter((trip) => trip.driverId !== null);

  const driverOptions: DispatchDriverOption[] = (driversResult.data ?? []).map((d) => ({
    id: d.id,
    displayName: d.display_name,
  }));
  const vehicleOptions: DispatchVehicleOption[] = (vehiclesResult.data ?? []).map((v) => ({
    id: v.id,
    label: v.label,
  }));

  const driverRows: DispatchDriverRow[] = driverOptions.map((driver) => ({
    driver,
    trips: assignedTrips.filter((trip) => trip.driverId === driver.id),
  }));

  return {
    day,
    dayBoundsUtc: { startUtc: startIso, endUtc: endIso },
    trips,
    unassignedTrips,
    assignedTrips,
    driverRows,
    driverOptions,
    vehicleOptions,
    summary: {
      // P1-E3-S8C1 (work item §3): deliberately NOT the same count as
      // Today's Operations' own `todayCount` — `trips` here is already
      // filtered to `NON_TERMINAL_STATES` (line ~205 above), so this is
      // "how many of today's trips still need dispatch attention," not
      // "how many trips are scheduled today" (which includes trips
      // already completed/cancelled/no-show — Today's Operations' own
      // scope). Rendered as "open trips today" (not "trips today") on
      // the Dispatch screen specifically so the two screens never show
      // the same label for two different numbers — see
      // docs/product/dispatch-board-data-map.md and
      // docs/product/todays-operations-data-map.md for the full
      // side-by-side definition.
      todayCount: trips.length,
      unassignedCount: unassignedTrips.length,
      activeCount: trips.filter((trip) => trip.isActiveState).length,
      attentionCount: trips.filter((trip) => trip.hasOpenException).length,
    },
  };
}
