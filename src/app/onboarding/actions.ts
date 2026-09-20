"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOnboardingAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface OnboardingActionState {
  status: "idle" | "error";
  error?: string;
}

const BUSINESS_STAGES = new Set(["starting", "growing", "established"]);

/**
 * Business Stage (work item §3) — "How are you operating today?" A plain
 * column UPDATE (organizations_update_org_admin + the business_stage
 * column grant), not an RPC — this is descriptive metadata with its own
 * CHECK constraint, not a lifecycle-protected mutation.
 */
export async function setBusinessStageAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const stage = formData.get("businessStage");
  if (typeof stage !== "string" || !BUSINESS_STAGES.has(stage)) {
    return { status: "error", error: "Choose one of the three options to continue." };
  }

  const pathname = await getCurrentPathname("/onboarding");
  const organization = await requireOnboardingAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("organizations")
    .update({ business_stage: stage })
    .eq("id", organization.organizationId);

  if (error) {
    return { status: "error", error: "Something went wrong saving that — please try again." };
  }

  revalidatePath("/onboarding");
  redirect("/onboarding/basics");
}

/**
 * Business Basics (work item §6) — timezone (canonical, since Trip
 * scheduling depends on it — organizations.timezone is already NOT NULL
 * and already validated by is_valid_iana_timezone at the CHECK-constraint
 * level) + a plain free-text service-area description. No geofencing.
 */
export async function setBusinessBasicsAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const timezone = formData.get("timezone");
  const serviceArea = formData.get("serviceArea");

  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    return { status: "error", error: "Choose a timezone to continue." };
  }

  const pathname = await getCurrentPathname("/onboarding/basics");
  const organization = await requireOnboardingAccess(pathname);

  // Timezone goes through the audited, Organization Admin-only
  // `update_organization_settings` (direct UPDATE of organizations.timezone
  // is revoked, P1-PILOT-S4B-R4A) -- the SAME single write path
  // Settings -> Organization uses, so the authoritative timezone has one
  // authority and one audit trail. service_area_description remains a
  // plain descriptive column with its own narrow grant.
  const supabase = await createServerSupabaseClient();
  const { error: timezoneError } = await supabase.rpc("update_organization_settings", {
    p_organization_id: organization.organizationId,
    p_changes: { timezone: timezone.trim() },
  });
  if (timezoneError) {
    return { status: "error", error: "That couldn't be saved — please try again." };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      service_area_description:
        typeof serviceArea === "string" && serviceArea.trim().length > 0 ? serviceArea.trim().slice(0, 1000) : null,
    })
    .eq("id", organization.organizationId);

  if (error) {
    return { status: "error", error: "That couldn't be saved — please try again." };
  }

  revalidatePath("/onboarding");
  redirect("/onboarding/vehicle");
}

/**
 * Owner-Operator Mode (work item §4) — "I also drive." Calls
 * `link_self_as_driver`, the reviewed controlled mutation that links a
 * NEW, SEPARATE Driver row to the caller's own auth identity WITHOUT
 * touching their Membership.role (docs/product/owner-operator-mode.md).
 * Full name is reused as the Driver's own display_name — same identity,
 * one less field to ask for again.
 */
export async function setOwnerAlsoDrivesAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const displayName = formData.get("displayName");
  const phone = formData.get("phone");

  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    return { status: "error", error: "Enter the name drivers/dispatch should see." };
  }

  const pathname = await getCurrentPathname("/onboarding/driver");
  const organization = await requireOnboardingAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("link_self_as_driver", {
    p_organization_id: organization.organizationId,
    p_display_name: displayName.trim(),
    p_phone: typeof phone === "string" && phone.trim().length > 0 ? phone.trim() : undefined,
  });

  if (error) {
    return { status: "error", error: "Couldn't set that up — please try again." };
  }

  revalidatePath("/onboarding");
  redirect("/onboarding/facility");
}
