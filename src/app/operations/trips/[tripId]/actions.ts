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
