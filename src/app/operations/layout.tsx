import type { ReactNode } from "react";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getUser } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/auth/profile";
import { getActiveMemberships } from "@/lib/auth/membership";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { OperationsLayoutClient } from "@/components/operations/OperationsLayoutClient";

/**
 * Server-side authorization gate for every /operations/* route (work item
 * §9/§24) — resolved BEFORE any client component renders, so there is no
 * flash of Operations chrome for a Driver or an unauthenticated visitor.
 * The actual pathname-driven chrome logic (sidebar section highlighting,
 * header title) is unchanged from the pre-auth foundation phase — see
 * OperationsLayoutClient.
 *
 * `dispatcherDisplayName` is real, live-resolved identity (P1-E3-S4,
 * ZD-129) — the raw `user.email` this used to pass straight through as a
 * "name" is gone. P1-UX-R1: `user.email` is still resolved right here
 * (already required for `getDisplayName`'s own fallback) and is now ALSO
 * threaded through separately as `dispatcherEmail` — a restrained,
 * optional personal-identity line in the account menu, never used as a
 * display name anywhere. No new query.
 */
export default async function OperationsLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/operations");
  const organization = await requireOperationsAccess(pathname);
  const user = await getUser();
  const dispatcherDisplayName = await getDisplayName(user?.id ?? "", user?.email ?? null);
  // Real fact, re-derived on every request (P1-E3-S8B1) — never assumed
  // from the resolved `organization` context alone, which only reflects
  // the CURRENT selection, not how many the caller actually holds.
  const memberships = await getActiveMemberships();
  const hasMultipleOrganizations = memberships.length > 1;

  // Owner-Operator Mode (P1-E3-S9, work item §4/§12): a cheap, real check
  // — does THIS person also have a linked, active Driver row in THIS
  // organization? Never inferred from Membership.role (which stays
  // organization_admin/dispatcher, untouched) — resolved the same way
  // every Driver-scoped RLS/RPC already does, via the drivers table
  // itself. Purely a navigation-affordance signal (whether to show
  // "Drive" in the sidebar); requireDriverAccess independently re-checks
  // this exact fact server-side regardless of what this renders.
  const supabase = await createServerSupabaseClient();
  const { data: linkedDriverId } = await supabase.rpc("current_driver_id", {
    p_org_id: organization.organizationId,
  });
  const hasLinkedDriverProfile = Boolean(linkedDriverId);

  return (
    <OperationsLayoutClient
      organization={organization}
      dispatcherDisplayName={dispatcherDisplayName}
      dispatcherEmail={user?.email ?? null}
      hasMultipleOrganizations={hasMultipleOrganizations}
      hasLinkedDriverProfile={hasLinkedDriverProfile}
    >
      {children}
    </OperationsLayoutClient>
  );
}
