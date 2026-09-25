"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOnboardingAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { enableSelfDriverAccess } from "@/lib/operations/self-driver";

export interface OnboardingActionState {
  status: "idle" | "error";
  error?: string;
}

// P1-OPS-PROG3B: the "How are you operating today?" size question and its
// business_stage writer were retired -- onboarding captures facts only.
// organizations.business_stage itself is untouched (nullable, kept for
// historical Platform Admin display; no tenant behaviour reads it).

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

  // Timezone AND service area go through the audited, Organization Admin-only
  // `update_organization_settings` in ONE call (direct UPDATE of
  // organizations is revoked entirely, P1-PILOT-S4B-R4C) -- the same single
  // write path Settings -> Organization uses, so each setting has one
  // authority and one audit trail.
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("update_organization_settings", {
    p_organization_id: organization.organizationId,
    p_changes: {
      timezone: timezone.trim(),
      service_area_description:
        typeof serviceArea === "string" && serviceArea.trim().length > 0 ? serviceArea.trim().slice(0, 1000) : null,
    },
  });

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
  const pathname = await getCurrentPathname("/onboarding/driver");
  const organization = await requireOnboardingAccess(pathname);

  // S5A1: the SAME server-side primitive Settings -> My Access uses (one
  // `link_self_as_driver` call site, one set of rules). Onboarding is a shortcut
  // into the owner-driver capability, not a second implementation.
  const result = await enableSelfDriverAccess(organization, formData.get("displayName"), formData.get("phone"));
  if (!result.ok) {
    return { status: "error", error: result.message };
  }

  revalidatePath("/onboarding");
  redirect("/onboarding/facility");
}
