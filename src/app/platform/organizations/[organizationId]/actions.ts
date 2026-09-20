"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminAccess } from "@/lib/auth/platform";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateLifecycleInput } from "@/lib/platform/platform-core";

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
