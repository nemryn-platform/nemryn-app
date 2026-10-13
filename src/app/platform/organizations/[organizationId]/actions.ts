"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminAccess } from "@/lib/auth/platform";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateLifecycleInput } from "@/lib/platform/platform-core";
import { validatePlusAdminInput } from "@/lib/plus/entitlement-admin-core";

export interface LifecycleState {
  status: "idle" | "done" | "error";
  message?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ONE tenant-affecting Platform Admin mutation: suspend / reactivate an
 * organization. Authority is re-checked here (PlatformAdminGrant) and again in
 * the database (set_platform_organization_status). The acting identity is never
 * taken from the browser -- the database records auth.uid(). Nothing about the
 * organization's Memberships, Drivers, Requests, Trips or integrations is
 * changed or deleted; only organizations.status.
 */
export async function setOrganizationStatusAction(_previous: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const pathname = await getCurrentPathname(`/platform/organizations/${organizationId}`);
  await requirePlatformAdminAccess(pathname);

  if (!UUID_PATTERN.test(organizationId)) {
    return { status: "error", message: "That organization could not be found." };
  }
  const input = validateLifecycleInput(formData.get("status"), formData.get("reason"));
  if (!input.ok) {
    return { status: "error", message: input.message };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_platform_organization_status", {
    p_organization_id: organizationId,
    p_status: input.value.status,
    p_reason: input.value.reason,
  });
  if (error) {
    // ZW002 (unknown organization / not a Platform Admin) and ZW006 (rejected input) both read as a generic failure.
    console.error("[platform] lifecycle change failed", error.code);
    return { status: "error", message: "The status could not be changed. Check the reason and try again." };
  }

  revalidatePath("/platform", "layout");
  const verb = input.value.status === "inactive" ? "suspended" : "reactivated";
  if (data?.changed === false) {
    return { status: "error", message: `The organization was already ${input.value.status === "inactive" ? "suspended" : "active"}. Nothing was changed.` };
  }
  return { status: "done", message: `Organization ${verb}.` };
}

export interface PlusEntitlementState {
  status: "idle" | "done" | "error";
  message?: string;
}

/**
 * NP-P1-S1 -- Nemryn Plus entitlement changes (start / extend trial, activate, expire, cancel, disable). Separate from
 * the suspension action above and never touching organizations.status: no Plus state can affect Core operations.
 * Authority is re-checked here (PlatformAdminGrant) and again in the database (platform_set_organization_module /
 * platform_extend_plus_trial), which records auth.uid() and the reason in an audit event.
 */
export async function changePlusEntitlementAction(_previous: PlusEntitlementState, formData: FormData): Promise<PlusEntitlementState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const pathname = await getCurrentPathname(`/platform/organizations/${organizationId}`);
  await requirePlatformAdminAccess(pathname);

  if (!UUID_PATTERN.test(organizationId)) {
    return { status: "error", message: "That organization could not be found." };
  }
  const input = validatePlusAdminInput({
    action: formData.get("action"),
    reason: formData.get("reason"),
    trialDays: formData.get("trialDays"),
    extraDays: formData.get("extraDays"),
    accessEndsOn: formData.get("accessEndsOn"),
  });
  if (!input.ok) {
    return { status: "error", message: input.message };
  }

  const supabase = await createServerSupabaseClient();
  const request = input.value;
  const { data, error } =
    request.kind === "extend"
      ? await supabase.rpc("platform_extend_plus_trial", {
          p_organization_id: organizationId,
          p_extra_days: request.extraDays,
          p_reason: request.reason,
        })
      : await supabase.rpc("platform_set_organization_module", {
          p_organization_id: organizationId,
          p_module: "plus",
          p_status: request.status,
          // NULL = not applicable / database default (14-day trial); the generated Args type has no nullability.
          p_trial_days: request.trialDays as number,
          p_access_ends_at: request.accessEndsAt as string,
          p_restriction: request.restriction as string,
          p_reason: request.reason,
        });
  if (error) {
    console.error("[platform] plus entitlement change failed", error.code);
    if (error.code === "ZW004") {
      return { status: "error", message: "That change is not allowed for the current Nemryn Plus state (a trial can be started only once and extended only once)." };
    }
    if (error.code === "ZW006") {
      return { status: "error", message: "The change was rejected. Check the values and the reason." };
    }
    return { status: "error", message: "Nemryn Plus could not be changed for this organization." };
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  if (data?.changed === false) {
    return { status: "error", message: "Nemryn Plus already had that state. Nothing was changed." };
  }
  return { status: "done", message: "Nemryn Plus updated." };
}
