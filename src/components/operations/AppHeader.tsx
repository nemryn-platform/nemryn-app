import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { AccountMenu } from "@/components/operations/AccountMenu";
import { NotificationsBell } from "@/components/operations/header/NotificationsBell";
import { HelpMenu } from "@/components/operations/header/HelpMenu";
import { canViewNotificationHistory, type HelpRole } from "@/lib/operations/header-help-core";

export interface AppHeaderProps {
  /** Short current-context label (e.g. the active nav section) — used as a fallback title on routes that don't yet supply a richer `title`/`description` pair. */
  contextLabel?: string;
  /**
   * Richer title (P1-E3-S4) for a screen whose own persistent header carries
   * its title/date directly — matching the "Today's Operations" reference,
   * where the title lives in the sticky chrome, not the scrollable
   * PageHeader below it. Falls back to `contextLabel` when omitted, so
   * every other not-yet-built Operations route is unaffected.
   */
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Real resolved identity (never a placeholder) — omit entirely on a route with nothing real to show yet. */
  avatarName?: string;
  /** P1-UX-R1: the signed-in user's own auth email — already resolved server-side, no new query. Purely personal-identity context for the account menu popup; never shown in the sidebar. */
  dispatcherEmail?: string | null;
  /** Account menu context (P1-E3-S8B1) — required alongside `avatarName` for the menu to render; kept optional as a pair so a route with no real identity yet (none currently) can still omit both cleanly. */
  organizationName?: string;
  roleLabel?: string;
  hasMultipleOrganizations?: boolean;
  /**
   * P1-PILOT-UX1: the viewer's role in the current organization -- decides which header controls exist at all (the
   * notification history is Admin-only in the database; Help shows only routes the role can open). Omitted = neither
   * control is rendered (never an inert button).
   */
  role?: HelpRole;
}

/**
 * Persistent chrome header, always visible above PageContent. Distinct from
 * PageHeader, which lives inside the scrollable content area per page.
 */
export function AppHeader({
  contextLabel,
  title,
  description,
  actions,
  avatarName,
  dispatcherEmail,
  organizationName,
  roleLabel,
  hasMultipleOrganizations,
  role,
}: AppHeaderProps) {
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-elevated px-4 py-3 lg:px-6">
      <div>
        {title ? (
          <>
            <h1 className={cn(typography.subsectionHeading, "text-text-primary")}>{title}</h1>
            {description && <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>{description}</p>}
          </>
        ) : (
          <p className={cn(typography.bodySmall, "font-medium text-text-secondary")}>{contextLabel}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {role && canViewNotificationHistory(role) && <NotificationsBell />}
        {role && <HelpMenu role={role} />}
        {avatarName && organizationName && roleLabel && (
          <AccountMenu
            avatarName={avatarName}
            dispatcherEmail={dispatcherEmail ?? null}
            organizationName={organizationName}
            roleLabel={roleLabel}
            showSwitchOrganization={hasMultipleOrganizations ?? false}
          />
        )}
      </div>
    </header>
  );
}
