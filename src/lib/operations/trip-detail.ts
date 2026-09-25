import "server-only";
import type { AttributionAssignment } from "./assignment-attribution-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { operationsTripStatusLabel } from "./presentation";
import { operationsEventLabel } from "./presentation";

/**
 * Server-side data access boundary for Operations Trip Detail (P1-E3-S6,
 * work item §11) — organization-scoped, explicit columns, no service
 * role, no presentation JSX. A single-Trip lookup, unlike Today's
 * Operations/the Dispatch Board — no day-window bound applies here (a
 * Dispatcher can open any Trip's detail regardless of what day it falls
 * on).
 *
 * The route parameter (Trip id) is untrusted input (work item §8): a
 * malformed value is rejected BEFORE any query is issued (a raw
 * non-UUID string would otherwise throw a Postgres "invalid input syntax
 * for type uuid" error, a distinguishable signal from "not found" that
 * this module deliberately never lets escape); a well-formed but
 * nonexistent or foreign-org id is indistinguishable from "not found" —
 * RLS returns zero rows for both, and this module maps that to the same
 * `unavailable` result either way. No existence oracle.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NON_TERMINAL_STATES = new Set([
  "scheduled",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);
const NO_SHOW_ELIGIBLE_STATES = new Set(["en_route_to_pickup", "arrived_at_pickup"]);
const ACTIVE_STATES = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

/** The Driver's own next lifecycle action, from the SAME table Driver Trips/Active Trip already use — shown here as READ-ONLY information ("what will the Driver do next"), never as an Operations-triggerable button (work item §20 explicitly forbids Operations driving Driver progression). */
const DRIVER_NEXT_ACTION_LABEL: Record<string, string> = {
  scheduled: "Start to Pickup",
  en_route_to_pickup: "Arrive at Pickup",
  arrived_at_pickup: "Mark Passenger Onboard",
  passenger_onboard: "Start to Destination",
  en_route_to_destination: "Arrive at Destination",
  arrived_at_destination: "Complete Trip",
};

interface NameEmbed {
  id: string;
  display_name: string;
  phone: string | null;
}
type NameRelation = NameEmbed | NameEmbed[] | null;

interface LabelEmbed {
  id: string;
  label: string;
}
type LabelRelation = LabelEmbed | LabelEmbed[] | null;

interface FacilityEmbed {
  name: string;
  city: string;
  state: string;
}
type FacilityRelation = FacilityEmbed | FacilityEmbed[] | null;

function formatFacility(facility: FacilityEmbed | null): string | null {
  if (!facility) return null;
  return `${facility.name} · ${facility.city}, ${facility.state}`;
}

interface RequesterEmbed {
  requester_name: string;
  requester_relationship: string;
  requester_phone: string;
  requester_email: string | null;
}
type RequesterRelation = RequesterEmbed | RequesterEmbed[] | null;

interface AssignmentEmbed {
  id: string;
  ended_at: string | null;
  assigned_by: string | null;
  assigned_at: string;
  end_reason: string | null;
  drivers: NameRelation;
  vehicles: LabelRelation;
}

interface TripRow {
  id: string;
  organization_id: string;
  state: string;
  scheduled_pickup_at: string | null;
  appointment_at: string | null;
  pickup_description: string;
  destination_description: string;
  instructions: string | null;
  expected_duration_minutes: number | null;
  expected_duration_source: string | null;
  assistance_notes: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  no_show_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  passengers: NameRelation;
  transportation_requests: RequesterRelation;
  pickup_facility: FacilityRelation;
  destination_facility: FacilityRelation;
  trip_assignments: AssignmentEmbed[] | null;
}

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

export interface TripDetailData {
  id: string;
  state: string;
  statusLabel: string;
  isActiveState: boolean;
  isTerminal: boolean;
  eligibleForCancel: boolean;
  eligibleForNoShow: boolean;
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  pickupDescription: string;
  destinationDescription: string;
  pickupFacilityName: string | null;
  destinationFacilityName: string | null;
  instructions: string | null;
  assistanceNotes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  noShowAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** P1-OPS-PROG4: planned duration in minutes (null = unknown) and where it came from. */
  expectedDurationMinutes: number | null;
  expectedDurationSource: "trip" | "organization_default" | null;
  passengerId: string | null;
  passengerName: string;
  passengerPhone: string | null;
  requesterName: string | null;
  requesterRelationship: string | null;
  requesterPhone: string | null;
  activeAssignmentId: string | null;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  /** Read-only — see DRIVER_NEXT_ACTION_LABEL's own doc comment. Null once terminal (nothing left to progress). */
  driverNextActionLabel: string | null;
}

export interface TripDetailEvent {
  id: string;
  label: string;
  occurredAt: string;
}

export interface TripDetailNote {
  id: string;
  body: string;
  visibility: "operations_only" | "driver_visible";
  createdAt: string;
}

export interface TripDetailException {
  id: string;
  exceptionType: string | null;
  description: string | null;
  createdAt: string;
}

export type TripDetailResult =
  | {
      status: "ok";
      trip: TripDetailData;
      events: TripDetailEvent[];
      notes: TripDetailNote[];
      openExceptions: TripDetailException[];
      /** P1-OPS-PROG3B: every assignment row of this Trip (history included) -- facts for the attribution line. */
      assignments: AttributionAssignment[];
    }
  | { status: "unavailable" }
  | { status: "error" };

const TRIP_COLUMNS =
  "id, organization_id, state, scheduled_pickup_at, appointment_at, pickup_description, destination_description, " +
  "instructions, assistance_notes, cancelled_at, cancellation_reason, no_show_at, completed_at, created_at, updated_at, " +
  "expected_duration_minutes, expected_duration_source, " +
  "passengers!trips_passenger_id_organization_id_fkey(id, display_name, phone), " +
  "transportation_requests!trips_request_id_organization_id_fkey(requester_name, requester_relationship, requester_phone, requester_email), " +
  "pickup_facility:facilities!trips_pickup_facility_id_organization_id_fkey(name, city, state), " +
  "destination_facility:facilities!trips_destination_facility_id_organization_id_fkey(name, city, state), " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey(id, ended_at, assigned_by, assigned_at, end_reason, " +
  "drivers!trip_assignments_driver_id_organization_id_fkey(id, display_name, phone), " +
  "vehicles!trip_assignments_vehicle_id_organization_id_fkey(id, label))";

export async function getTripDetail(tripId: string, organizationId: string): Promise<TripDetailResult> {
  if (!UUID_RE.test(tripId)) {
    // Malformed input never reaches the database — indistinguishable from
    // "not found" to the caller, exactly like a genuinely nonexistent or
    // foreign-org id (work item §8).
    return { status: "unavailable" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: tripRow, error: tripError } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("id", tripId)
    .eq("organization_id", organizationId)
    .maybeSingle()
    .returns<TripRow>();

  if (tripError) {
    return { status: "error" };
  }
  if (!tripRow) {
    return { status: "unavailable" };
  }

  const [eventsResult, notesResult, exceptionsResult] = await Promise.all([
    supabase
      .from("trip_events")
      .select("id, event_type, occurred_at")
      .eq("trip_id", tripId)
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("trip_notes")
      .select("id, body, visibility, created_at")
      .eq("trip_id", tripId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("trip_exceptions")
      .select("id, exception_type, description, created_at")
      .eq("trip_id", tripId)
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
  ]);

  if (eventsResult.error || notesResult.error || exceptionsResult.error) {
    return { status: "error" };
  }

  const activeAssignment = (tripRow.trip_assignments ?? []).find((a) => a.ended_at === null) ?? null;
  const driver = unwrapOne(activeAssignment?.drivers);
  const vehicle = unwrapOne(activeAssignment?.vehicles);
  const passenger = unwrapOne(tripRow.passengers);
  const requester = unwrapOne(tripRow.transportation_requests);
  const pickupFacility = unwrapOne(tripRow.pickup_facility);
  const destinationFacility = unwrapOne(tripRow.destination_facility);

  const trip: TripDetailData = {
    id: tripRow.id,
    state: tripRow.state,
    statusLabel: operationsTripStatusLabel(tripRow.state, activeAssignment !== null),
    isActiveState: ACTIVE_STATES.has(tripRow.state),
    isTerminal: !NON_TERMINAL_STATES.has(tripRow.state),
    eligibleForCancel: NON_TERMINAL_STATES.has(tripRow.state),
    eligibleForNoShow: NO_SHOW_ELIGIBLE_STATES.has(tripRow.state),
    scheduledPickupAt: tripRow.scheduled_pickup_at,
    appointmentAt: tripRow.appointment_at,
    pickupDescription: tripRow.pickup_description,
    destinationDescription: tripRow.destination_description,
    pickupFacilityName: formatFacility(pickupFacility),
    destinationFacilityName: formatFacility(destinationFacility),
    instructions: tripRow.instructions,
    assistanceNotes: tripRow.assistance_notes,
    cancelledAt: tripRow.cancelled_at,
    cancellationReason: tripRow.cancellation_reason,
    noShowAt: tripRow.no_show_at,
    completedAt: tripRow.completed_at,
    createdAt: tripRow.created_at,
    updatedAt: tripRow.updated_at,
    expectedDurationMinutes: tripRow.expected_duration_minutes,
    expectedDurationSource:
      tripRow.expected_duration_source === "trip" || tripRow.expected_duration_source === "organization_default"
        ? tripRow.expected_duration_source
        : null,
    passengerId: passenger?.id ?? null,
    passengerName: passenger?.display_name ?? "Unknown Passenger",
    passengerPhone: passenger?.phone ?? null,
    requesterName: requester?.requester_name ?? null,
    requesterRelationship: requester?.requester_relationship ?? null,
    requesterPhone: requester?.requester_phone ?? null,
    activeAssignmentId: activeAssignment?.id ?? null,
    driverId: driver?.id ?? null,
    driverName: driver?.display_name ?? null,
    driverPhone: driver?.phone ?? null,
    vehicleId: vehicle?.id ?? null,
    vehicleLabel: vehicle?.label ?? null,
    driverNextActionLabel: DRIVER_NEXT_ACTION_LABEL[tripRow.state] ?? null,
  };

  const events: TripDetailEvent[] = (eventsResult.data ?? []).map((e) => ({
    id: e.id,
    label: operationsEventLabel(e.event_type),
    occurredAt: e.occurred_at,
  }));

  const notes: TripDetailNote[] = (notesResult.data ?? []).map((n) => ({
    id: n.id,
    body: n.body,
    visibility: n.visibility as "operations_only" | "driver_visible",
    createdAt: n.created_at,
  }));

  const openExceptions: TripDetailException[] = (exceptionsResult.data ?? []).map((x) => ({
    id: x.id,
    exceptionType: x.exception_type,
    description: x.description,
    createdAt: x.created_at,
  }));

  const assignments: AttributionAssignment[] = (tripRow.trip_assignments ?? []).map((a) => ({
    id: a.id,
    assignedBy: a.assigned_by,
    assignedAt: a.assigned_at,
    endedAt: a.ended_at,
    endReason: a.end_reason,
  }));

  return { status: "ok", trip, events, notes, openExceptions, assignments };
}

/**
 * P1-OPS-PROG3B: display names of assigners the VIEWER may already see
 * under the existing `user_profiles` RLS (their own profile; an
 * Organization Admin also sees their organization members'). Rows the
 * policy withholds simply do not come back -- nothing is widened here, no
 * service role, no new policy -- and the attribution then says "a team
 * member".
 */
export async function getVisibleAssignerNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("user_profiles").select("id, display_name").in("id", ids);
  if (error) return new Map();
  return new Map((data ?? []).filter((row) => row.display_name).map((row) => [row.id, row.display_name as string]));
}
