"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminAccess } from "@/lib/auth/platform";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateLifecycleInput } from "@/lib/platform/platform-core";
import { confirmsOrganization, isStaleEntitlementToken, validatePlusAdminInput } from "@/lib/plus/entitlement-admin-core";
import { getOrganizationDetail, getPlusEntitlement } from "@/lib/platform/platform";

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

  // NP-P1-S2 organization-targeting safeguards. The change is bound to the organization id in THIS request: its name
  // and current entitlement are re-read here (Platform-Admin-gated RPCs), the typed confirmation must equal THAT name,
  // and the entitlement must still be the one the panel showed. A stale tab, a tampered / mismatched hidden id or a
  // concurrent change is refused before anything is written.
  const [targetOrganization, currentEntitlement] = await Promise.all([
    getOrganizationDetail(organizationId),
    getPlusEntitlement(organizationId),
  ]);
  if (!targetOrganization || !currentEntitlement) {
    return { status: "error", message: "That organization could not be found." };
  }
  if (!confirmsOrganization(formData.get("confirmOrganizationName"), targetOrganization.name)) {
    return {
      status: "error",
      message: `Type the organization's name exactly as shown ("${targetOrganization.name}") to confirm this change is for that organization.`,
    };
  }
  if (isStaleEntitlementToken(formData.get("expectedVersion"), currentEntitlement.updatedAt)) {
    return {
      status: "error",
      message: "Nemryn Plus changed for this organization since this page was loaded. Reload the page and review it before trying again.",
    };
  }

  // NP-P1-S2-R1: the version check above gives a friendly early answer, but the AUTHORITATIVE check is in the database:
  // the versioned RPCs compare updated_at under the organization + module row locks (ZW003 when stale), so a change
  // committed by another Platform Admin after the check above can never be silently overwritten.
  const expectedVersion = String(formData.get("expectedVersion") ?? "");
  // NULL = "no entitlement row expected"; the generated Args types have no nullability (repository convention: cast).
  const expectedUpdatedAt = (expectedVersion === "none" ? null : expectedVersion) as string;
  const supabase = await createServerSupabaseClient();
  const request = input.value;
  const { data, error } =
    request.kind === "extend"
      ? await supabase.rpc("platform_extend_plus_trial", {
          p_organization_id: organizationId,
          p_extra_days: request.extraDays,
          p_reason: request.reason,
          p_expected_updated_at: expectedUpdatedAt,
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
          p_expected_updated_at: expectedUpdatedAt,
        });
  if (error) {
    console.error("[platform] plus entitlement change failed", error.code);
    if (error.code === "ZW003") {
      return {
        status: "error",
        message: "Nemryn Plus changed for this organization since this page was loaded. Reload the page and review it before trying again.",
      };
    }
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
