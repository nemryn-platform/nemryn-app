"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OperationsShell } from "@/components/operations/OperationsShell";
import { operationsContext } from "@/lib/operations/nav-core";
import type { AppHeaderProps } from "@/components/operations/AppHeader";
import type { OrganizationContext } from "@/lib/auth/types";

const ROLE_LABEL: Record<OrganizationContext["role"], string> = {
  organization_admin: "Organization Admin",
  dispatcher: "Dispatcher",
  driver: "Driver",
};

export interface OperationsLayoutClientProps {
  organization: OrganizationContext;
  dispatcherDisplayName: string;
  /** P1-UX-R1: the signed-in user's own auth email — already resolved server-side by the parent layout (`getUser()`), no new query. Optional/nullable purely because `user.email` itself is nullable on the auth type; threaded through to AccountMenu's popup as a restrained, secondary personal-identity line, never shown in place of the display name. */
  dispatcherEmail: string | null;
  /** Real fact from a live `getActiveMemberships()` call (P1-E3-S8B1) — gates the account menu's "Switch Organization" item, never assumed. */
  hasMultipleOrganizations: boolean;
  /** Real fact from a live `current_driver_id()` call (P1-E3-S9, Owner-Operator Mode) — gates the sidebar's conditional "Drive" item. Never inferred from Membership.role. */
  hasLinkedDriverProfile: boolean;
  /** NP-P1-S2: server-resolved Nemryn Plus entry (see OperationsSidebar.canAccessGrowth). */
  canAccessGrowth: boolean;
  /** NP-P2-S7-C: NEW website inquiries (null = unknown or no Growth access -> no badge). */
  newInquiryCount: number | null;
  /** NP-PILOT-P2: essential Getting started steps still to do (null = complete / unknown). */
  setupRemaining: number | null;
  children: ReactNode;
}

/**
 * The pathname-driven chrome logic extracted unchanged from the original
 * (pre-auth) layout.tsx — this component's own behavior is identical to
 * before, only its inputs changed: `organization`/`dispatcherDisplayName`
 * now come from the live-resolved session (via the new server-side
 * OperationsLayout parent) instead of the P0-E2-S3-era hardcoded sample
 * data ("Sample Dispatcher"), and, as of P1-E3-S4/ZD-129, a real resolved
 * `user_profiles.display_name` (falling back to email) rather than the raw
 * email address itself. Multi-org role-per-organization is preserved —
 * `organization.role` reflects the CURRENT organization context only,
 * never a global role.
 */
/*
 * P1-PILOT-UX1: the header's permanently disabled placeholders (Search -- "not wired up yet"; Dispatch Settings -- "no
 * defined behavior yet") were REMOVED rather than left as dead controls; Export Day Sheet is real (Overview = today,
 * Dispatch = the selected day).
 *
 * NP-UI-P1b canonical title system: the persistent AppHeader is a slim CONTEXT bar (workspace / section › area,
 * notifications, help, account) and never renders a heading. Every page has exactly one <h1>, in a PageHeader that the
 * PAGE renders inside <main> (Overview / Dispatch / Trip Detail / Request Detail use
 * components/operations/OperationsPageHeaders.tsx). The layout renders no h1, so an in-shell error boundary that
 * replaces a failing page never leaves two h1s.
 */
function buildHeaderProps(
  pathname: string,
  organization: OrganizationContext,
  avatarName: string,
  dispatcherEmail: string | null,
  hasMultipleOrganizations: boolean,
): AppHeaderProps {
  const context = pathname === "/operations/trips/new" ? { section: "Today", label: "New Trip" } : operationsContext(pathname);
  return {
    contextLabel: context.label,
    contextSection: context.section,
    avatarName,
    dispatcherEmail,
    organizationName: organization.organizationName,
    roleLabel: ROLE_LABEL[organization.role],
    hasMultipleOrganizations,
    role: organization.role,
  };
}

export function OperationsLayoutClient({
  organization,
  dispatcherDisplayName,
  dispatcherEmail,
  hasMultipleOrganizations,
  hasLinkedDriverProfile,
  canAccessGrowth,
  newInquiryCount,
  setupRemaining,
  children,
}: OperationsLayoutClientProps) {
  const pathname = usePathname();

  return (
    <OperationsShell
      sidebar={{
        location: organization.organizationName,
        dispatcherName: dispatcherDisplayName,
        dispatcherRole: ROLE_LABEL[organization.role],
        hasLinkedDriverProfile,
        canManageSettings: organization.role === "organization_admin",
        canAccessGrowth,
        newInquiryCount,
        setupRemaining,
        hasMultipleOrganizations,
      }}
      header={buildHeaderProps(pathname, organization, dispatcherDisplayName, dispatcherEmail, hasMultipleOrganizations)}
    >
      {children}
    </OperationsShell>
  );
}
