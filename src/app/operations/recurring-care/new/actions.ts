"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapRecurringArrangementError, type RecurringArrangementErrorCode } from "@/lib/operations/recurring-arrangement-errors";

export interface CreateRecurringArrangementActionState {
  status: "idle" | "success" | "error";
  errorCode?: RecurringArrangementErrorCode;
  arrangementId?: string;
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Create Recurring Arrangement — the real `create_recurring_arrangement`
 * RPC only. Re-derives Operations authorization fresh on every call
 * (never trusts how the page happened to render). Never accepts
 * organization_id/timezone/created_by/status/paused_at/ended_at from the
 * form at all (P1-E2-S1E §8) — those fields simply have no FormData key
 * anywhere in this action, so there is no code path through which a
 * forged value could ever reach the RPC call below.
 */
export async function createRecurringArrangementAction(
  _prevState: CreateRecurringArrangementActionState,
  formData: FormData,
): Promise<CreateRecurringArrangementActionState> {
  const passengerId = stringField(formData, "passengerId");
  const pickupDescription = stringField(formData, "pickupDescription");
  const destinationDescription = stringField(formData, "destinationDescription");
  const pickupTime = stringField(formData, "pickupTime");
  const startDate = stringField(formData, "startDate");
  const endDate = stringField(formData, "endDate");
  const daysOfWeek = formData
    .getAll("daysOfWeek")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  if (!passengerId) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!pickupDescription || !destinationDescription) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!pickupTime) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!startDate) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (daysOfWeek.length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname("/operations/recurring-care/new");
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("create_recurring_arrangement", {
    p_organization_id: organization.organizationId,
    p_passenger_id: passengerId,
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

  revalidatePath("/operations/recurring-care");
  if (data?.arrangement_id) {
    revalidatePath(`/operations/recurring-care/${data.arrangement_id}`);
  }

  return { status: "success", arrangementId: data?.arrangement_id ?? undefined };
}
