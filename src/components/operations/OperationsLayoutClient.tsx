"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Plus, CaretLeft, CaretRight, Gear } from "@phosphor-icons/react/dist/ssr";
import { OperationsShell } from "@/components/operations/OperationsShell";
import { SearchInput } from "@/components/ui/SearchInput";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { formatOperationsLongDate } from "@/lib/operations/presentation";
import type { AppHeaderProps } from "@/components/operations/AppHeader";
import type { OrganizationContext } from "@/lib/auth/types";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const SECTION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/operations/tomorrow", label: "Tomorrow" },
  { prefix: "/operations/trips", label: "Trips" },
  { prefix: "/operations/dispatch", label: "Dispatch" },
  { prefix: "/operations/passengers", label: "Passengers" },
  { prefix: "/operations/facilities", label: "Facilities" },
  { prefix: "/operations/drivers", label: "Drivers" },
  { prefix: "/operations/fleet", label: "Fleet" },
  { prefix: "/operations/billing", label: "Billing" },
  { prefix: "/operations/reports", label: "Reports" },
];

function getContextLabel(pathname: string) {
  if (pathname === "/operations") return "Overview";
  return SECTION_LABELS.find((section) => pathname.startsWith(section.prefix))?.label ?? "Operations";
}

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
/**
 * The Overview route's header is the one place (so far) that needs more
 * than a bare `contextLabel` — its title/date/search/Export/New-Trip row
 * lives in the PERSISTENT header per the reference (01-todays-operations.png),
 * not the scrollable PageHeader below it (P1-E3-S4). Built here, from data
 * this component already has (`organization.organizationTimezone`) plus
 * static content, rather than a new cross-tree state channel for the page
 * to reach back into its own layout chrome — every action below is
 * genuinely static/inert (Search has no wiring this phase, Export Day
 * Sheet is disabled per GAP-9, New Trip is a plain link), so nothing here
 * actually needs to come from the page itself. A future route that DOES
 * need page-driven header content is a real reason to revisit this.
 */
/** Same `hidden lg:block` wrapper fix as ZD-135 — SearchInput's own `className` only reaches its inner `<input>`. Reused as-is by both the Overview and Dispatch headers rather than duplicated inline twice. */
function HeaderSearch() {
  return (
    <div className="hidden lg:block">
      <SearchInput
        label="Search trips, passengers, drivers"
        placeholder="Search trips, passengers, drivers…"
        className="w-64"
        disabled
        title="Search is not wired up yet."
      />
    </div>
  );
}

function buildHeaderProps(
  pathname: string,
  organization: OrganizationContext,
  avatarName: string,
  dispatcherEmail: string | null,
  hasMultipleOrganizations: boolean,
): AppHeaderProps {
  const identity = {
    avatarName,
    dispatcherEmail,
    organizationName: organization.organizationName,
    roleLabel: ROLE_LABEL[organization.role],
    hasMultipleOrganizations,
  };

  if (pathname === "/operations") {
    return {
      title: "Today's Operations",
      description: formatOperationsLongDate(new Date(), organization.organizationTimezone),
      ...identity,
      actions: (
        <>
          <HeaderSearch />
          <Button variant="outline" size="md" disabled title="Export is not available yet (see ui-backend-gap-register.md GAP-9).">
            Export Day Sheet
          </Button>
          <LinkButton href="/operations/trips/new" size="md" leadingIcon={<Plus className="size-4" aria-hidden />}>
            New Trip
          </LinkButton>
        </>
      ),
    };
  }

  if (pathname === "/operations/dispatch") {
    return {
      title: "Dispatch",
      description: formatOperationsLongDate(new Date(), organization.organizationTimezone),
      ...identity,
      actions: (
        <>
          {/* Day navigator — real, visible, disabled (matching the Export
              Day Sheet / ZD-134 treatment): the board only ever queries the
              organization's own "today" (work item's own day-scoping),
              there is no other-day query built this phase, so a live
              navigator would be a fake affordance. "Today" is a static
              label, not a button. */}
          <div className="hidden items-center gap-1 rounded-sm border border-border-strong px-1 py-1 md:flex">
            <Button
              variant="text"
              size="sm"
              disabled
              aria-label="Previous day (not available yet)"
              title="Day navigation is not available yet — the board shows today only."
            >
              <CaretLeft className="size-4" aria-hidden />
            </Button>
            <span className={cn(typography.bodySmall, "px-1 font-medium text-text-secondary")}>Today</span>
            <Button
              variant="text"
              size="sm"
              disabled
              aria-label="Next day (not available yet)"
              title="Day navigation is not available yet — the board shows today only."
            >
              <CaretRight className="size-4" aria-hidden />
            </Button>
          </div>
          <HeaderSearch />
          <Button
            variant="outline"
            size="md"
            disabled
            leadingIcon={<Gear className="size-4" aria-hidden />}
            title="Dispatch Settings has no defined behavior yet."
          >
            Dispatch Settings
          </Button>
          <LinkButton href="/operations/trips/new" size="md" leadingIcon={<Plus className="size-4" aria-hidden />}>
            New Trip
          </LinkButton>
        </>
      ),
    };
  }

  // Trip Detail (P1-E3-S6) — a bare "Trip Detail" title in the persistent
  // header, matching the reference exactly (docs/design/stitch/references/
  // 02-trip-detail.png): no search/settings/New-Trip cluster here, unlike
  // Overview/Dispatch — the page's own breadcrumb, title, and action bar
  // live in the scrollable content below. Excludes `/operations/trips/new`
  // (its own future screen) and the bare `/operations/trips` list.
  if (/^\/operations\/trips\/[^/]+$/.test(pathname) && !pathname.endsWith("/new")) {
    return { title: "Trip Detail", ...identity };
  }

  // New Trip (P1-E3-S7) — the reference's own fixed top bar (05-internal-
  // new-trip.png) shows no bold chrome title, only the breadcrumb + icons;
  // the real "New Trip" heading lives in the page's own scrollable content
  // as its `<h1>` (no `title` here, so AppHeader renders none — avoids the
  // same two-`<h1>` mistake S6 found and fixed for Trip Detail, this time
  // by not introducing a second h1 in the first place).
  if (pathname === "/operations/trips/new") {
    return { contextLabel: "New Trip", ...identity };
  }

  return { contextLabel: getContextLabel(pathname), ...identity };
}

export function OperationsLayoutClient({
  organization,
  dispatcherDisplayName,
  dispatcherEmail,
  hasMultipleOrganizations,
  hasLinkedDriverProfile,
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
      }}
      header={buildHeaderProps(pathname, organization, dispatcherDisplayName, dispatcherEmail, hasMultipleOrganizations)}
    >
      {children}
    </OperationsShell>
  );
}
