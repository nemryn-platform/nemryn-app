import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import type { OrganizationContext } from "@/lib/auth/types";
import { canOpenGrowth, parsePlusAccessState, parsePlusCapability, type PlusAccessState, type PlusCapability } from "./access-core";

export interface PlusAccess {
  state: PlusAccessState;
  /** The caller's capability (NP-P1-S3): Organization Admin, or a Dispatcher's named grant. */
  capability: PlusCapability;
  /** Only for an Organization Admin while a trial is running (`write`); otherwise null. */
  trialEndsAt: string | null;
}

const NO_ACCESS: PlusAccess = { state: "none", capability: "none", trialEndsAt: null };

/**
 * The caller's effective Nemryn Plus state and capability for one organization (NP-P1-S1; grant-aware since NP-P1-S3).
 * Reads `plus_access_state` with the ordinary per-request, cookie-based client -- never the service-role client -- so
 * the database decides from the caller's own live membership and named grant. Any error or unexpected value fails
 * closed to `none`. Deduplicated per request (layout + page).
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
    const capability = parsePlusCapability(data.access);
    return { state, capability, trialEndsAt: state === "write" ? (data.trial_ends_at ?? null) : null };
  } catch {
    console.error("[plus] access state unavailable", "exception");
    return NO_ACCESS;
  }
});

/**
 * Route guard for /operations/growth/* (NP-P1-S1; NP-P1-S3: named staff). Resolves the context exactly like every
 * Operations page (`requireOperationsAccess`: signed-out -> sign-in, Driver -> /driver, no Operations role ->
 * /access-unavailable), so an Organization Admin AND a Dispatcher can pass -- WITHOUT gaining any Admin privilege:
 * the context's role is untouched and Admin-only pages keep their own `requireOrganizationAdminAccess`. Then Plus:
 * the database must report a state that allows entry and a capability for THIS caller (an Admin, or a Dispatcher
 * with an active grant while Plus is writable); anything else goes back to /operations. Hiding navigation is never
 * the control -- this guard and the database are.
 */
export async function requirePlusAccess(currentPath: string): Promise<{ context: OrganizationContext; plus: PlusAccess }> {
  const context = await requireOperationsAccess(currentPath);
  const plus = await getPlusAccessState(context.organizationId);
  if (!canOpenGrowth(plus.state, plus.capability)) {
    redirect("/operations");
  }
  return { context, plus };
}
