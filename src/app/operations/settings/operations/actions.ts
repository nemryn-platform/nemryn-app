"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateOperatingSchedule } from "@/lib/operations/operating-schedule-core";

export interface OperatingScheduleActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Echoed so a rejected save never wipes the form. */
  days?: number[];
  opensAt?: string;
  closesAt?: string;
}

/**
 * Save the weekly operating schedule (Organization Admin only; re-derived per
 * call and enforced by update_organization_operating_schedule). The schedule
 * is interpreted in the organization's timezone (Settings -> Organization) --
 * this action never accepts a timezone. Informational: nothing is rejected or
 * blocked because of it. Submitting with no days and no times clears it.
 */
export async function saveOperatingScheduleAction(
  _prev: OperatingScheduleActionState,
  formData: FormData,
): Promise<OperatingScheduleActionState> {
  const pathname = await getCurrentPathname("/operations/settings/operations");
  const organization = await requireOrganizationAdminAccess(pathname);

  const days = formData
    .getAll("day")
    .map((value) => (typeof value === "string" ? Number(value) : NaN))
    .filter((value) => Number.isInteger(value));
  const opensAt = typeof formData.get("opensAt") === "string" ? (formData.get("opensAt") as string) : "";
  const closesAt = typeof formData.get("closesAt") === "string" ? (formData.get("closesAt") as string) : "";
  const echo = { days, opensAt, closesAt };

  const validation = validateOperatingSchedule(echo);
  if (!validation.ok) {
    return { status: "error", message: validation.error, ...echo };
  }

  const schedule = validation.schedule;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("update_organization_operating_schedule", {
    p_organization_id: organization.organizationId,
    p_days: schedule ? schedule.days : (null as unknown as number[]),
    p_opens_at: schedule ? schedule.opensAt : (null as unknown as string),
    p_closes_at: schedule ? schedule.closesAt : (null as unknown as string),
  });
  if (error) {
    const message =
      error.code === "ZW002"
        ? "Only an Organization Admin can change the operating schedule."
        : error.code === "ZW006"
          ? "Check the days and times and try again."
          : "Something went wrong saving the schedule. Try again.";
    return { status: "error", message, ...echo };
  }

  revalidatePath("/operations", "layout");
  return {
    status: "success",
    message: !data?.changed ? "No changes to save." : schedule ? "Operating schedule saved." : "Operating schedule cleared.",
    ...(schedule ? { days: schedule.days, opensAt: schedule.opensAt, closesAt: schedule.closesAt } : { days: [], opensAt: "", closesAt: "" }),
  };
}
