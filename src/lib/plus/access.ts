import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import type { OrganizationContext } from "@/lib/auth/types";
import { canEnterGrowth, parsePlusAccessState, type PlusAccessState } from "./access-core";

export interface PlusAccess {
  state: PlusAccessState;
  /** Only while a trial is running (`write`); otherwise null. */
  trialEndsAt: string | null;
}

const NO_ACCESS: PlusAccess = { state: "none", trialEndsAt: null };

/**
 * The caller's effective Nemryn Plus state for one organization (NP-P1-S1). Reads `plus_access_state` with the
 * ordinary per-request, cookie-based client -- never the service-role client -- so the database decides from the
 * caller's own live Organization Admin membership. Any error or unexpected value fails closed to `none`.
 * Deduplicated per request (layout + page).
 */
export const getPlusAccessState = cache(async (organizationId: string): Promise<PlusAccess> => {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("plus_access_state", { p_organization_id: organizationId });
    if (error || !data) {
      console.error("[plus] access state unavailable", error?.code ?? "no_data");
      return NO_ACCESS;
    }
    const state = parsePlusAccessState(data.state);
    return { state, trialEndsAt: state === "write" ? (data.trial_ends_at ?? null) : null };
  } catch {
    console.error("[plus] access state unavailable", "exception");
    return NO_ACCESS;
  }
});

/**
 * Route guard for /operations/growth/* (NP-P1-S1). Organization Admin only for now (named-staff grants arrive in
 * NP-P1-S3): the existing guard already sends signed-out users to sign-in, Drivers to /driver and Dispatchers to
 * /operations. Then the Plus entitlement: `none` and `locked` go back to /operations (the restricted notice arrives
 * in NP-P1-S2). Hiding navigation is never the control -- this guard and the database are.
 */
export async function requirePlusAccess(currentPath: string): Promise<{ context: OrganizationContext; plus: PlusAccess }> {
  const context = await requireOrganizationAdminAccess(currentPath);
  const plus = await getPlusAccessState(context.organizationId);
  if (!canEnterGrowth(plus.state)) {
    redirect("/operations");
  }
  return { context, plus };
}
