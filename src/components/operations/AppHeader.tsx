import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { AccountMenu } from "@/components/operations/AccountMenu";
import { NotificationsBell } from "@/components/operations/header/NotificationsBell";
import { HelpMenu } from "@/components/operations/header/HelpMenu";
import { canViewNotificationHistory, type HelpRole } from "@/lib/operations/header-help-core";

export interface AppHeaderProps {
  /** The page's area (e.g. "Trips", "Vehicles") — from nav-core's operationsContext. */
  contextLabel?: string;
  /** The sidebar section the area belongs to (e.g. "Today", "Records"); omitted for unknown routes. */
  contextSection?: string | null;
  /** Real resolved identity (never a placeholder) — omit entirely on a route with nothing real to show yet. */
  avatarName?: string;
  /** P1-UX-R1: the signed-in user's own auth email — already resolved server-side, no new query. Purely personal-identity context for the account menu popup; never shown in the sidebar. */
  dispatcherEmail?: string | null;
  /** Account menu context (P1-E3-S8B1) — required alongside `avatarName` for the menu to render. Also the workspace name on the context line (Brand Lock §12: Nemryn mark + current workspace name). */
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
 * The slim global context header (NP-UI-P1b), always visible above the scrolling content. It carries CONTEXT and
 * global utilities only — workspace, where you are (section › area), notifications, help and the account menu. It
 * never renders a heading: every page's one <h1> lives in its PageHeader inside <main>, together with that page's
 * own actions (New Trip, Export Day Sheet, …). Every control is 40px tall.
 */
export function AppHeader({
  contextLabel,
  contextSection,
  avatarName,
  dispatcherEmail,
  organizationName,
  roleLabel,
  hasMultipleOrganizations,
  role,
}: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-elevated px-4 lg:px-6" data-testid="app-header">
      <p className={cn(typography.bodySmall, "flex min-w-0 items-center gap-1.5 text-text-secondary")} data-testid="app-header-context">
        {organizationName && (
          <>
            <span className="truncate font-medium text-text-primary" title={organizationName}>
              {organizationName}
            </span>
            <span className="text-text-disabled" aria-hidden>
              /
            </span>
          </>
        )}
        {contextSection && (
          <>
            <span className="hidden shrink-0 sm:inline">{contextSection}</span>
            <CaretRight className="hidden size-3 shrink-0 text-text-disabled sm:inline" aria-hidden />
          </>
        )}
        <span className="truncate">{contextLabel ?? "Operations"}</span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {role && canViewNotificationHistory(role) && <NotificationsBell />}
        {role && <HelpMenu role={role} />}
        {avatarName && organizationName && roleLabel && (
          <div className="ml-1">
            <AccountMenu
              avatarName={avatarName}
              dispatcherEmail={dispatcherEmail ?? null}
              organizationName={organizationName}
              roleLabel={roleLabel}
              showSwitchOrganization={hasMultipleOrganizations ?? false}
            />
          </div>
        )}
      </div>
    </header>
  );
}
