import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deriveRequestReadiness, type RequestReadiness } from "./request-readiness-core";

/**
 * Server-side data access boundary for Operations Request Detail
 * (P1-E1-S2E) — mirrors `trip-detail.ts`'s own established contract
 * shape and discipline as closely as possible, since Trip Detail is the
 * closest existing precedent for a single-record Operations detail page
 * in this codebase.
 *
 * The route parameter (Request id) is untrusted input, exactly like Trip
 * Detail's own `tripId`: a malformed value is rejected BEFORE any query
 * is issued (a raw non-UUID string would otherwise throw a Postgres
 * "invalid input syntax for type uuid" error — a distinguishable signal
 * from "not found" that this module deliberately never lets escape); a
 * well-formed but nonexistent or foreign-org id is indistinguishable
 * from "not found" — RLS returns zero rows for both, and this module
 * maps that to the same `unavailable` result either way. No existence
 * oracle (P1-E1-S2E §6/§26/§33's own explicit instruction).
 *
 * `organization_id` is explicitly filtered on the request query AND
 * independently on the linked-Trips query — never relying on RLS alone,
 * matching every other data-access module in this codebase.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PassengerEmbed {
  display_name: string;
  phone: string | null;
  status: string;
  assistance_notes: string | null;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

interface RequestRow {
  id: string;
  passenger_id: string | null;
  requester_name: string;
  requester_relationship: string;
  requester_phone: string;
  requester_email: string | null;
  pickup_description: string;
  destination_description: string;
  preferred_date: string | null;
  preferred_time: string | null;
  return_trip_needed: string;
  assistance_notes: string | null;
  additional_notes: string | null;
  source: string;
  state: string;
  created_at: string;
  updated_at: string;
  intake_integration_id: string | null;
  service_type: string | null;
  recurring_days_of_week: number[] | null;
  recurring_start_date: string | null;
  recurring_end_date: string | null;
  recurring_appointment_time: string | null;
  recurring_return_trip_expected: boolean | null;
  requested_passenger_name: string | null;
  passengers: PassengerRelation;
}

/** P1-PILOT-S4B-R2 — the REQUESTED recurring schedule, present only when `recurringDaysOfWeek` is non-null. Mirrors `RecurringScheduleInput`'s own shape (website-intake-core.ts) at the read side. */
export interface RequestDetailRecurringSchedule {
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  appointmentTime: string | null;
  returnTripExpected: boolean | null;
}

export interface RequestDetailPassenger {
  id: string;
  displayName: string;
  phone: string | null;
  status: string;
  assistanceNotes: string | null;
}

export interface RequestDetailLinkedTrip {
  id: string;
  state: string;
  scheduledPickupAt: string | null;
  pickupDescription: string;
  destinationDescription: string;
  passengerName: string | null;
}

export interface RequestDetailData {
  id: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  requesterName: string;
  requesterRelationship: string;
  requesterPhone: string;
  requesterEmail: string | null;
  pickupDescription: string;
  destinationDescription: string;
  preferredDate: string | null;
  preferredTime: string | null;
  returnTripNeeded: string;
  source: string;
  /** P1-PILOT-S4A — non-null only for a Request created via the public website-intake path. The authoritative provenance signal Request Detail's own UI keys off; never `source === 'web'` alone (see request-intake-integrations' own migration comment). */
  intakeIntegrationId: string | null;
  assistanceNotes: string | null;
  additionalNotes: string | null;
  /** P1-PILOT-S4B-R2 — optional, closed allow-list; `null` when not sent (most current staff-entered Requests and any pre-R2 website submission). */
  serviceType: string | null;
  /** P1-PILOT-S4B-R2 — the REQUESTED (not confirmed) recurring schedule; `null` for a one-time request. */
  recurringSchedule: RequestDetailRecurringSchedule | null;
  /** P1-PILOT-S4B-R2A — a free-text SNAPSHOT of the passenger name the requester supplied at submission time. NOT the linked Passenger's own `displayName` (see `passenger` below) — the two are independent and may differ; this value persists unchanged even after a real Passenger is linked. `null` for every staff-entered Request and any pre-R2A website submission. */
  requestedPassengerName: string | null;
  passenger: RequestDetailPassenger | null;
  /** Reuses request-readiness-core.ts unmodified (P1-E1-S2E §10) — never re-derived here. Computed from the REAL linked Passenger's own current `status`, never merely `passenger_id !== null`. */
  readiness: RequestReadiness;
  linkedTrips: RequestDetailLinkedTrip[];
}

export type RequestDetailResult = { status: "ok"; request: RequestDetailData } | { status: "unavailable" } | { status: "error" };

const REQUEST_COLUMNS =
  "id, passenger_id, requester_name, requester_relationship, requester_phone, requester_email, " +
  "pickup_description, destination_description, preferred_date, preferred_time, return_trip_needed, " +
  "assistance_notes, additional_notes, source, state, created_at, updated_at, intake_integration_id, " +
  "service_type, recurring_days_of_week, recurring_start_date, recurring_end_date, " +
  "recurring_appointment_time, recurring_return_trip_expected, requested_passenger_name, " +
  // Two FKs exist from transportation_requests to passengers (plain +
  // composite) — the explicit hint is required, not cosmetic; an
  // unqualified `passengers(...)` embed is genuinely ambiguous to
  // PostgREST (PGRST201) and fails closed. Same fix already applied in
  // requests-list.ts (P1-E1-S2D §32) — reused here, not rediscovered.
  "passengers!transportation_requests_passenger_id_organization_id_fkey(display_name, phone, status, assistance_notes)";

export async function getRequestDetail(requestId: string, organizationId: string): Promise<RequestDetailResult> {
  if (!UUID_RE.test(requestId)) {
    return { status: "unavailable" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: row, error: requestError } = await supabase
    .from("transportation_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle()
    .returns<RequestRow>();

  if (requestError) {
    return { status: "error" };
  }
  if (!row) {
    return { status: "unavailable" };
  }

  // Linked Trips (P1-E1-S2E §20/§21) — every Trip whose request_id is
  // this Request, org-scoped independently of RLS. A genuine 1:N
  // relationship: zero, one, or multiple rows are all valid outcomes,
  // never assumed to be exactly one. This query is treated as an
  // AUTHORITATIVE part of the page (§27.E) — its own failure fails the
  // whole detail load rather than silently rendering "No linked trips".
  const { data: tripsData, error: tripsError } = await supabase
    .from("trips")
    .select(
      "id, state, scheduled_pickup_at, pickup_description, destination_description, " +
        "passengers!trips_passenger_id_organization_id_fkey(display_name)",
    )
    .eq("request_id", requestId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        state: string;
        scheduled_pickup_at: string | null;
        pickup_description: string;
        destination_description: string;
        passengers: { display_name: string } | { display_name: string }[] | null;
      }[]
    >();

  if (tripsError) {
    return { status: "error" };
  }

  const passenger = unwrapOne(row.passengers);
  const passengerActive = passenger?.status === "active";

  const readiness = deriveRequestReadiness({
    state: row.state,
    passengerId: row.passenger_id,
    passengerActive,
  });

  const linkedTrips: RequestDetailLinkedTrip[] = (tripsData ?? []).map((t) => ({
    id: t.id,
    state: t.state,
    scheduledPickupAt: t.scheduled_pickup_at,
    pickupDescription: t.pickup_description,
    destinationDescription: t.destination_description,
    passengerName: unwrapOne(t.passengers)?.display_name ?? null,
  }));

  const request: RequestDetailData = {
    id: row.id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requesterName: row.requester_name,
    requesterRelationship: row.requester_relationship,
    requesterPhone: row.requester_phone,
    requesterEmail: row.requester_email,
    pickupDescription: row.pickup_description,
    destinationDescription: row.destination_description,
    preferredDate: row.preferred_date,
    preferredTime: row.preferred_time,
    returnTripNeeded: row.return_trip_needed,
    source: row.source,
    intakeIntegrationId: row.intake_integration_id,
    assistanceNotes: row.assistance_notes,
    additionalNotes: row.additional_notes,
    serviceType: row.service_type,
    recurringSchedule: row.recurring_days_of_week
      ? {
          daysOfWeek: row.recurring_days_of_week,
          startDate: row.recurring_start_date as string,
          endDate: row.recurring_end_date,
          appointmentTime: row.recurring_appointment_time,
          returnTripExpected: row.recurring_return_trip_expected,
        }
      : null,
    requestedPassengerName: row.requested_passenger_name,
    passenger: passenger
      ? {
          id: row.passenger_id as string,
          displayName: passenger.display_name,
          phone: passenger.phone,
          status: passenger.status,
          assistanceNotes: passenger.assistance_notes,
        }
      : null,
    readiness,
    linkedTrips,
  };

  return { status: "ok", request };
}

export interface RequestActivityEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  /** Only ever populated for `request_declined` (S2B's own `metadata.reason`, when supplied) — null for every other event_type and for a declined event with no reason given. */
  reason: string | null;
}

/**
 * Request Activity (P1-E1-S2E deliberately deferred this display until
 * lifecycle actions made it useful — P1-E1-S2F-B2 §16). Reads
 * `request_events` directly — append-only, no client write grant of
 * any kind (S2B), already RLS-scoped to organization_admin/dispatcher.
 * `organization_id` is explicitly filtered here too, never relying on
 * RLS alone, matching every other query in this module.
 *
 * P1-E1-S2F-B2 §17 (documented, not an oversight): `create_trip`'s own
 * Request-conversion event lives on `trip_events`, not here — this
 * function deliberately does NOT join or duplicate it. Request
 * conversion is already visible through Request state (Accepted) and
 * the Linked Trips panel; this is a small, focused
 * `request_events`-only activity list, never a fabricated unified
 * cross-table timeline.
 *
 * Deliberately NOT integrated into `getRequestDetail`'s own
 * discriminated result (§18/§20): this is supplementary information, a
 * SEPARATE best-effort fetch (matching the established
 * `getLogRequestFormData`/candidate-Passengers pattern already used
 * elsewhere on this same page) — throws on failure, and the CALLER
 * (page.tsx) is the one that decides a failure here degrades only the
 * Activity panel, never the whole Request Detail page. This keeps the
 * "Linked Trips failure fails the whole page" contract (§20, actually
 * authoritative Request data) cleanly distinct from "Activity failure
 * degrades only its own panel" (supplementary, not authoritative).
 */
export async function getRequestActivity(requestId: string, organizationId: string): Promise<RequestActivityEvent[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("request_events")
    .select("id, event_type, occurred_at, metadata")
    .eq("request_id", requestId)
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load request activity: ${error.message}`);
  }

  return (data ?? []).map((event) => {
    const metadata = event.metadata as Record<string, unknown> | null;
    const reason = typeof metadata?.reason === "string" ? metadata.reason : null;
    return {
      id: event.id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      reason,
    };
  });
}
