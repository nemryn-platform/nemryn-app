import type { ReactNode } from "react";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getUser } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/auth/profile";
import { getActiveMemberships } from "@/lib/auth/membership";
import { getOperatorLinkedDriverId } from "@/lib/operations/assignment-context";
import { OperationsLayoutClient } from "@/components/operations/OperationsLayoutClient";
import { getPlusAccessState } from "@/lib/plus/access";
import { countNewInquiries } from "@/lib/plus/inquiries";
import { canOpenGrowth } from "@/lib/plus/access-core";

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
  // P1-OPS-PROG3B: the same request-cached current_driver_id read the
  // Overview composition and assignment surfaces use (one call per request).
  const hasLinkedDriverProfile = (await getOperatorLinkedDriverId(organization.organizationId)) !== null;

  // NP-P1-S2 / S3: whether to show "Growth" -- the request-cached plus_access_state read the Growth guard itself uses.
  // An Organization Admin (write / read_only) or a Dispatcher with an active named grant while Plus is writable;
  // locked / none / no grant hide it. Navigation only: every Growth route re-checks requirePlusAccess, and the
  // database re-checks independently.
  const plus = await getPlusAccessState(organization.organizationId);
  const canAccessGrowth = canOpenGrowth(plus.state, plus.capability);
  // NP-P2-S7-C: the NEW website-inquiry count beside Growth -> Inquiries (Plus READ, re-checked in the database). A
  // failed read shows no badge -- never an error page.
  const newInquiryCount = canAccessGrowth ? await countNewInquiries(organization.organizationId) : null;

  return (
    <OperationsLayoutClient
      organization={organization}
      dispatcherDisplayName={dispatcherDisplayName}
      dispatcherEmail={user?.email ?? null}
      hasMultipleOrganizations={hasMultipleOrganizations}
      hasLinkedDriverProfile={hasLinkedDriverProfile}
      canAccessGrowth={canAccessGrowth}
      newInquiryCount={newInquiryCount}
    >
      {children}
    </OperationsLayoutClient>
  );
}
