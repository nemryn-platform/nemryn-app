"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapTripDetailError, type TripDetailErrorCode } from "@/lib/operations/trip-detail-errors";
import { isValidExpectedDuration } from "@/lib/operations/trip-overlap-core";
import { triStateToBoolean } from "@/lib/operations/capability-core";
import { mapTripExceptionError, type TripExceptionErrorCode, EXCEPTION_TYPE_VALUES } from "@/lib/operations/trip-exception-errors";
import { mapTripEditError, type TripEditErrorCode } from "@/lib/operations/trip-edit-errors";
import { checkServiceDate } from "@/lib/operations/trip-edit-core";
import { organizationLocalToUtc } from "@/lib/operations/local-time";
import { localDateKeyOf } from "@/lib/operations/local-time-core";

export interface TripDetailActionState {
  status: "idle" | "success" | "error";
  errorCode?: TripDetailErrorCode;
}

async function revalidateTripDetailRoutes(tripId: string) {
  revalidatePath(`/operations/trips/${tripId}`);
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations");
}

/**
 * Cancel Trip — the real `cancel_trip` RPC only, never a direct
 * `trips.state` write (work item §21). Re-derives Operations
 * authorization fresh on every call, exactly like the Dispatch Server
 * Action (`src/app/operations/dispatch/actions.ts`) — an inactive
 * Membership, a role change, or a foreign-org attempt is caught HERE,
 * not assumed from how the page happened to render.
 */
export async function cancelTripAction(
  _prevState: TripDetailActionState,
  formData: FormData,
): Promise<TripDetailActionState> {
  const tripId = formData.get("tripId");
  const reason = formData.get("reason");

  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("cancel_trip", { p_trip_id: tripId, p_reason: reason.trim() });

  if (error) {
    return { status: "error", errorCode: mapTripDetailError(error.code) };
  }

  await revalidateTripDetailRoutes(tripId);
  return { status: "success" };
}

/**
 * Record No-Show — the real `record_no_show` RPC only. Backend remains
 * authoritative on eligibility (en_route_to_pickup/arrived_at_pickup
 * only, lifecycle-model.md §J) — this action does not itself gate on
 * state beyond what the RPC already enforces (work item §23/§24: no
 * client-side classification from time/location, ever).
 */
export async function recordNoShowAction(
  _prevState: TripDetailActionState,
  formData: FormData,
): Promise<TripDetailActionState> {
  const tripId = formData.get("tripId");
  const reason = formData.get("reason");

  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("record_no_show", { p_trip_id: tripId, p_reason: reason.trim() });

  if (error) {
    return { status: "error", errorCode: mapTripDetailError(error.code) };
  }

  await revalidateTripDetailRoutes(tripId);
  return { status: "success" };
}

const NOTE_VISIBILITIES = new Set(["operations_only", "driver_visible"]);

/**
 * Add Note — a direct, RLS-protected `trip_notes` INSERT, not an RPC
 * (component-inventory.md's own pre-existing note: "write action ('Add
 * Note') is a direct-table INSERT per the data-action map, not an RPC —
 * no special mutation-layer dependency"). Legitimate and safe:
 * `trip_notes_insert_operations` grants Organization Admin/Dispatcher
 * INSERT for either visibility value, scoped by RLS to their own
 * organization — confirmed by reading the actual policy, not assumed
 * because the table exists (work item §33's own explicit caution).
 */
export async function addNoteAction(
  _prevState: TripDetailActionState,
  formData: FormData,
): Promise<TripDetailActionState> {
  const tripId = formData.get("tripId");
  const body = formData.get("body");
  const visibility = formData.get("visibility");

  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof body !== "string" || body.trim().length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (typeof visibility !== "string" || !NOTE_VISIBILITIES.has(visibility)) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  const organization = await requireOperationsAccess(pathname);
  const user = await getUser();
  if (!user) {
    return { status: "error", errorCode: "UNAUTHORIZED" };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("trip_notes").insert({
    organization_id: organization.organizationId,
    trip_id: tripId,
    author_user_id: user.id,
    visibility,
    body: body.trim(),
  });

  if (error) {
    // A raw table INSERT surfaces a Postgres/PostgREST error, not one of
    // the ZW codes — RLS denial (wrong org, wrong role) is the only
    // realistic failure mode here (input is already validated above), so
    // it maps to the same safe NOT_FOUND/UNKNOWN treatment rather than
    // ever showing the raw Postgres message.
    return { status: "error", errorCode: "UNKNOWN" };
  }

  await revalidateTripDetailRoutes(tripId);
  return { status: "success" };
}

export interface TripExceptionActionState {
  status: "idle" | "success" | "error";
  errorCode?: TripExceptionErrorCode;
}

/**
 * Report Issue — the real `report_trip_exception` RPC only, never a
 * direct `trip_exceptions` INSERT (work item §19/§24 of P1-E3-S8; see
 * that migration's own header for why the pre-existing direct-INSERT
 * policy was not narrow enough for the Operations population — it did
 * not force `created_by`/`status`, unlike the Driver policy). Re-derives
 * Operations authorization fresh on every call, exactly like every other
 * action in this file.
 */
export async function reportExceptionAction(
  _prevState: TripExceptionActionState,
  formData: FormData,
): Promise<TripExceptionActionState> {
  const tripId = formData.get("tripId");
  const exceptionType = formData.get("exceptionType");
  const description = formData.get("description");

  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof exceptionType !== "string" || !EXCEPTION_TYPE_VALUES.has(exceptionType)) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data: reported, error } = await supabase.rpc("report_trip_exception", {
    p_trip_id: tripId,
    p_exception_type: exceptionType,
    p_description: description.trim(),
  });

  if (error) {
    return { status: "error", errorCode: mapTripExceptionError(error.code) };
  }

  // P1-PILOT-S4B-R4D: the exception and its notification event committed
  // together; the email goes out AFTER, best-effort (see dispatchNotification) --
  // it can never fail or slow this action, and a provider outage is recorded,
  // not surfaced as a failed report.
  const notificationEventId = reported?.notification_event_id;
  if (notificationEventId) {
    after(() => dispatchNotification(notificationEventId));
  }

  await revalidateTripDetailRoutes(tripId);
  revalidatePath("/operations/dispatch");
  return { status: "success" };
}

/**
 * Resolve — the real `resolve_trip_exception` RPC only. Idempotent
 * (a stale/duplicate resolve attempt is a safe no-op, see the RPC's own
 * comment for why — never a corrupted double-transition).
 */
export async function resolveExceptionAction(
  _prevState: TripExceptionActionState,
  formData: FormData,
): Promise<TripExceptionActionState> {
  const tripId = formData.get("tripId");
  const exceptionId = formData.get("exceptionId");
  const resolutionNote = formData.get("resolutionNote");

  if (typeof tripId !== "string" || tripId.length === 0 || typeof exceptionId !== "string" || exceptionId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("resolve_trip_exception", {
    p_exception_id: exceptionId,
    p_resolution_note: typeof resolutionNote === "string" && resolutionNote.trim().length > 0 ? resolutionNote.trim() : undefined,
  });

  if (error) {
    return { status: "error", errorCode: mapTripExceptionError(error.code) };
  }

  await revalidateTripDetailRoutes(tripId);
  revalidatePath("/operations/dispatch");
  return { status: "success" };
}

/**
 * P1-OPS-PROG4 -- set or clear ONLY a trip's expected duration, through the
 * set_trip_expected_duration RPC (Organization Admin / Dispatcher, non-terminal
 * trips; the RPC re-validates everything). Empty clears it to UNKNOWN (the
 * organization default is not re-applied). General trip editing stays out of
 * scope.
 */
/** P1-OPS-PROG5B: set / clear the trip's wheelchair transport equipment requirement (audited RPC; non-terminal trips only). */
export async function setTripWheelchairRequirementAction(
  _prevState: TripDetailActionState,
  formData: FormData,
): Promise<TripDetailActionState> {
  const tripId = formData.get("tripId");
  const raw = formData.get("requiresWheelchairAccess");
  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (raw !== "yes" && raw !== "no" && raw !== "unspecified") {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_trip_wheelchair_requirement", {
    p_trip_id: tripId,
    // null clears the requirement (the generated type does not model the nullable argument).
    p_requires_wheelchair_access: triStateToBoolean(raw) as boolean,
  });
  if (error) {
    return { status: "error", errorCode: mapTripDetailError(error.code) };
  }
  await revalidateTripDetailRoutes(tripId);
  revalidatePath("/operations/tomorrow");
  return { status: "success" };
}

export async function setTripDurationAction(
  _prevState: TripDetailActionState,
  formData: FormData,
): Promise<TripDetailActionState> {
  const tripId = formData.get("tripId");
  const raw = formData.get("expectedDurationMinutes");
  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  const minutes = text === "" ? null : /^\d+$/.test(text) ? Number(text) : NaN;
  if (minutes !== null && !isValidExpectedDuration(minutes)) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_trip_expected_duration", {
    p_trip_id: tripId,
    // null clears the value (the generated type does not model the nullable argument).
    p_expected_duration_minutes: minutes as number,
  });
  if (error) {
    return { status: "error", errorCode: mapTripDetailError(error.code) };
  }

  await revalidateTripDetailRoutes(tripId);
  revalidatePath("/operations/tomorrow");
  return { status: "success" };
}

/**
 * P1-PILOT-R2B (PR-01) -- correct a Trip's own planning details through the audited update_trip_details RPC ONLY
 * (authenticated has no direct UPDATE on trips). Organization-local date / time are converted with the same
 * DST-honest organizationLocalToUtc New Trip uses (nonexistent / ambiguous -> refused, never guessed). The service-date
 * rules are pre-checked here with the shared pure core purely for a precise message; the RPC re-checks everything.
 * Never touches assignment, duration, wheelchair requirement, passenger, request or recurring links.
 */
export interface TripEditInput {
  tripId: string;
  expectedUpdatedAt: string;
  pickupDate: string;
  pickupTime: string;
  appointmentDate: string;
  appointmentTime: string;
  pickupDescription: string;
  pickupFacilityId: string;
  destinationDescription: string;
  destinationFacilityId: string;
  instructions: string;
  assistanceNotes: string;
}

export type TripEditResult =
  | { ok: true; changed: boolean; changedFields: string[]; driverMayBeTravelling: boolean }
  | { ok: false; code: TripEditErrorCode };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateTripDetailsAction(input: TripEditInput): Promise<TripEditResult> {
  if (!input || typeof input.tripId !== "string" || !UUID_RE.test(input.tripId) || typeof input.expectedUpdatedAt !== "string") {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const pathname = await getCurrentPathname(`/operations/trips/${input.tripId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, state, scheduled_pickup_at, request_id, recurring_arrangement_id, recurring_arrangements!trips_recurring_arrangement_id_org_fkey(timezone), trip_assignments!trip_assignments_trip_id_organization_id_fkey(ended_at)")
    .eq("id", input.tripId)
    .eq("organization_id", organization.organizationId)
    .maybeSingle();
  if (tripError) return { ok: false, code: "UNKNOWN" };
  if (!trip) return { ok: false, code: "NOT_FOUND" };

  const toUtc = (date: string, time: string): { ok: true; iso: string | null } | { ok: false; code: TripEditErrorCode } => {
    const d = (date ?? "").trim();
    const t = (time ?? "").trim();
    if (!d && !t) return { ok: true, iso: null };
    if (!d || !t) return { ok: false, code: "INVALID_INPUT" };
    const conversion = organizationLocalToUtc({ date: d, time: t }, organization.organizationTimezone);
    if (conversion.status === "invalid") return { ok: false, code: "INVALID_INPUT" };
    if (conversion.status !== "ok") return { ok: false, code: "SCHEDULE_UNRESOLVABLE" };
    return { ok: true, iso: conversion.utc.toISOString() };
  };
  const pickup = toUtc(input.pickupDate, input.pickupTime);
  if (!pickup.ok) return { ok: false, code: pickup.code };
  const appointment = toUtc(input.appointmentDate, input.appointmentTime);
  if (!appointment.ok) return { ok: false, code: appointment.code };

  const recurringRelation = trip.recurring_arrangements as { timezone: string } | { timezone: string }[] | null;
  const recurringTimezone = Array.isArray(recurringRelation) ? (recurringRelation[0]?.timezone ?? null) : (recurringRelation?.timezone ?? null);
  const dateCheck = checkServiceDate({
    state: trip.state,
    currentPickupAt: trip.scheduled_pickup_at,
    proposedPickupAt: pickup.iso,
    organizationTimezone: organization.organizationTimezone,
    recurringTimezone: trip.recurring_arrangement_id ? recurringTimezone : null,
    localDateKeyOf,
  });
  if (dateCheck === "recurring_date_change") return { ok: false, code: "RECURRING_DATE" };
  if (dateCheck === "en_route_date_change") return { ok: false, code: "EN_ROUTE_DATE" };

  const facility = (value: string) => (typeof value === "string" && UUID_RE.test(value) ? value : null);
  const { data, error } = await supabase.rpc("update_trip_details", {
    p_trip_id: input.tripId,
    p_expected_updated_at: input.expectedUpdatedAt,
    // Nullable RPC arguments are modelled as non-nullable by the generated types (same documented cast as PROG4/5).
    p_scheduled_pickup_at: pickup.iso as string,
    p_appointment_at: appointment.iso as string,
    p_pickup_description: input.pickupDescription ?? "",
    p_pickup_facility_id: facility(input.pickupFacilityId) as string,
    p_destination_description: input.destinationDescription ?? "",
    p_destination_facility_id: facility(input.destinationFacilityId) as string,
    p_instructions: (input.instructions ?? "") as string,
    p_assistance_notes: (input.assistanceNotes ?? "") as string,
  });
  if (error) return { ok: false, code: mapTripEditError(error.code) };

  const changed = data?.changed === true;
  if (changed) {
    await revalidateTripDetailRoutes(input.tripId);
    revalidatePath("/operations/tomorrow");
    if (trip.recurring_arrangement_id) {
      revalidatePath("/operations/recurring-care");
      revalidatePath(`/operations/recurring-care/${trip.recurring_arrangement_id}`);
    }
    if (trip.request_id) revalidatePath(`/operations/requests/${trip.request_id}`);
    revalidatePath("/driver", "layout");
  }
  const assignments = (trip.trip_assignments ?? []) as { ended_at: string | null }[];
  const activelyAssigned = assignments.some((a) => a.ended_at === null);
  return {
    ok: true,
    changed,
    changedFields: data?.changed_fields ?? [],
    driverMayBeTravelling: changed && activelyAssigned && trip.state !== "scheduled",
  };
}
