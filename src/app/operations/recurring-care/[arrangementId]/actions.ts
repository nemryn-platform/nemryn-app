"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { triStateToBoolean } from "@/lib/operations/capability-core";
import { mapRecurringArrangementError, type RecurringArrangementErrorCode } from "@/lib/operations/recurring-arrangement-errors";

export interface RecurringArrangementActionState {
  status: "idle" | "success" | "error";
  errorCode?: RecurringArrangementErrorCode;
}

export interface CreateOccurrenceTripActionState {
  status: "idle" | "success" | "error";
  errorCode?: RecurringArrangementErrorCode;
  tripId?: string;
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function revalidateArrangementRoutes(arrangementId: string) {
  revalidatePath(`/operations/recurring-care/${arrangementId}`);
  revalidatePath("/operations/recurring-care");
}

/**
 * Edit Arrangement — the real `edit_recurring_arrangement` RPC only.
 * Passenger/timezone/organization/status are never accepted as form
 * fields at all (P1-E2-S1E §18) — structurally unreachable, not merely
 * unused.
 */
export async function editRecurringArrangementAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  const pickupDescription = stringField(formData, "pickupDescription");
  const destinationDescription = stringField(formData, "destinationDescription");
  const pickupTime = stringField(formData, "pickupTime");
  const startDate = stringField(formData, "startDate");
  const endDate = stringField(formData, "endDate");
  const daysOfWeek = formData
    .getAll("daysOfWeek")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  if (!arrangementId) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (!pickupDescription || !destinationDescription || !pickupTime || !startDate || daysOfWeek.length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("edit_recurring_arrangement", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
    p_pickup_description: pickupDescription,
    p_destination_description: destinationDescription,
    p_pickup_time: pickupTime,
    p_days_of_week: daysOfWeek,
    p_start_date: startDate,
    p_end_date: endDate ?? undefined,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  // P1-OPS-PROG5B (Q4): the wheelchair requirement has its own audited setter (edit_recurring_arrangement's contract is
  // unchanged); called only when the operator actually changed it. Affects occurrence trips created afterwards only.
  const requirement = stringField(formData, "requiresWheelchairAccess");
  const original = stringField(formData, "requiresWheelchairAccessOriginal");
  if ((requirement === "yes" || requirement === "no" || requirement === "unspecified") && requirement !== original) {
    const { error: requirementError } = await supabase.rpc("set_recurring_wheelchair_requirement", {
      p_organization_id: organization.organizationId,
      p_arrangement_id: arrangementId,
      // null clears it (the generated type does not model the nullable argument).
      p_requires_wheelchair_access: triStateToBoolean(requirement) as boolean,
    });
    if (requirementError) {
      await revalidateArrangementRoutes(arrangementId);
      return { status: "error", errorCode: mapRecurringArrangementError(requirementError.code) };
    }
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/** Pause — the real `pause_recurring_arrangement` RPC only. No reason parameter exists (P1-E2-S1D §11's own deliberately minimal design). */
export async function pauseRecurringArrangementAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  if (!arrangementId) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("pause_recurring_arrangement", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/** Resume — the real `resume_recurring_arrangement` RPC only. */
export async function resumeRecurringArrangementAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  if (!arrangementId) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("resume_recurring_arrangement", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/** End — the real `end_recurring_arrangement` RPC only. Terminal; reason required (P1-E2-S1D §13). */
export async function endRecurringArrangementAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  const reason = stringField(formData, "reason");

  if (!arrangementId) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (!reason) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("end_recurring_arrangement", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
    p_reason: reason,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/** Skip — the real `skip_recurring_occurrence` RPC only. Reason required (P1-E2-S1E §15). */
export async function skipRecurringOccurrenceAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  const serviceDate = stringField(formData, "serviceDate");
  const reason = stringField(formData, "reason");

  if (!arrangementId || !serviceDate) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (!reason) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("skip_recurring_occurrence", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
    p_service_date: serviceDate,
    p_reason: reason,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/** Unskip — the real `unskip_recurring_occurrence` RPC only. No reason required (P1-E2-S1D §18). */
export async function unskipRecurringOccurrenceAction(
  _prevState: RecurringArrangementActionState,
  formData: FormData,
): Promise<RecurringArrangementActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  const serviceDate = stringField(formData, "serviceDate");

  if (!arrangementId || !serviceDate) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("unskip_recurring_occurrence", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
    p_service_date: serviceDate,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  return { status: "success" };
}

/**
 * Create Trip for a Missing occurrence — the real
 * `create_trip_for_recurring_occurrence` RPC only (P1-E2-S1E §23-§28).
 * Idempotent server-side; this action itself adds no additional
 * double-submit protection beyond the RPC's own row-lock serialization
 * (the RPC's own idempotent no-op path already makes a duplicate
 * submission safe by construction — see that migration's own comment).
 * Also revalidates the Trip's own detail route once created, so
 * navigating straight there shows fresh data.
 */
export async function createTripForRecurringOccurrenceAction(
  _prevState: CreateOccurrenceTripActionState,
  formData: FormData,
): Promise<CreateOccurrenceTripActionState> {
  const arrangementId = stringField(formData, "arrangementId");
  const serviceDate = stringField(formData, "serviceDate");

  if (!arrangementId || !serviceDate) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("create_trip_for_recurring_occurrence", {
    p_organization_id: organization.organizationId,
    p_arrangement_id: arrangementId,
    p_service_date: serviceDate,
  });

  if (error) {
    return { status: "error", errorCode: mapRecurringArrangementError(error.code) };
  }

  await revalidateArrangementRoutes(arrangementId);
  revalidatePath("/operations");
  revalidatePath("/operations/dispatch");
  if (data?.trip_id) {
    revalidatePath(`/operations/trips/${data.trip_id}`);
  }

  return { status: "success", tripId: data?.trip_id ?? undefined };
}
