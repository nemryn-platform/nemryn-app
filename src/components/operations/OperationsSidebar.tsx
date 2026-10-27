"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowsLeftRight, Buildings, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { navIcons } from "@/design/icons";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { GrowthNavGroup } from "@/components/operations/GrowthNavGroup";
import { isNavItemActive, operationsNavSections } from "@/lib/operations/nav-core";
import { navItemActive, navItemBase, navItemIdle } from "@/components/operations/nav-styles";

// P1-UX-R2: local-only UI preference — never a database column, never a
// per-user profile field, never synced across devices (see this file's
// own doc comment below for the full reasoning).
const SIDEBAR_COLLAPSED_STORAGE_KEY = "nemryn.sidebar.collapsed";

// P1-UX-R2: runs the read-from-localStorage effect BEFORE the browser
// paints (useLayoutEffect), rather than after (useEffect) — this is what
// prevents a visible expanded→collapsed flash on every reload for a
// caller with a saved "collapsed" preference. useLayoutEffect is a no-op
// during server rendering; falling back to useEffect there (rather than
// calling useLayoutEffect directly, which merely warns without doing
// anything different) is the standard, well-known ~1-line
// "isomorphic layout effect" pattern — not a new library, not new
// infrastructure.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface OperationsSidebarProps {
  /**
   * P1-UX-R1: the active tenant/workspace name (`organization
   * .organizationName`) — never the signed-in user's own identity, and
   * never paired with a membership role (that role belongs to the user,
   * not to the organization itself — see the bottom `dispatcherRole`
   * row below, and docs/reports/p1-ux-r1-workspace-user-identity-
   * clarification.txt for the full before/after reasoning).
   */
  location: string;
  dispatcherName: string;
  dispatcherRole?: string;
  /** P1-E3-S9 (Owner-Operator Mode, work item §4/§12) — real fact from a live `current_driver_id()` check, never inferred from role. Gates the conditional "Drive" nav item only; the actual /driver/* access decision is independently re-checked by `requireDriverAccess`. */
  hasLinkedDriverProfile?: boolean;
  /** P1-PILOT-S4B-R4A: true only for an Organization Admin of the active workspace -- gates the "Settings" nav item. Navigation convenience only; every /operations/settings route and mutation independently enforces Organization Admin. */
  canManageSettings?: boolean;
  /** NP-P1-S2: true only when the server resolved Nemryn Plus entry (Organization Admin + write / read_only entitlement) -- gates the "Growth" nav item. Navigation convenience only; every /operations/growth route re-checks requirePlusAccess and the database re-checks plus_access_state. Never shown while Plus is locked or absent. */
  canAccessGrowth?: boolean;
  /** NP-P2-S7-C: NEW website inquiries shown beside Growth -> Inquiries (null / 0 = no badge). Navigation only. */
  newInquiryCount?: number | null;
  /** NP-PILOT-P2: essential setup steps still to do (null = complete or unknown -> no "Getting started" item). */
  setupRemaining?: number | null;
  /** NP-UI-P1b: real fact from `getActiveMemberships()` (> 1) — adds a "Switch workspace" link to the workspace row (the same `/select-organization?switch=1` destination as the account menu). */
  hasMultipleOrganizations?: boolean;
}

/**
 * The one OperationsSidebar. Do not fork per-route copies (TripsSidebar,
 * DispatchSidebar, etc.) — the active route changes state, the shell doesn't.
 * Full labels at lg+ (256px), icon-only 64px rail at md–lg (tablet). Hidden below md — see
 * OperationsShell for the narrow-width guard state that replaces it there.
 *
 * P1-UX-R2: desktop (lg+) can ALSO be manually collapsed to the same
 * narrow rail tablet already uses — see `collapsed` below. This is a
 * pure client-side UI preference (localStorage only, see
 * SIDEBAR_COLLAPSED_STORAGE_KEY's own doc comment), never a database
 * column or per-user profile field, and never synced across devices or
 * organizations. Every `lg:`-scoped class below only ever changes
 * behavior at lg+ (1024px+); nothing here alters what renders at md–lg.
 *
 * NP-UI-P1b: items are grouped under quiet section labels (nav-core.ts). Each section is a `<ul>` named by its label,
 * so the grouping is announced; in the rail the labels become visually hidden and a hairline separates the groups.
 * Rail items keep their `aria-label` (the accessible name never depends on a tooltip) and show a visual label beside
 * the rail on hover AND keyboard focus (aria-hidden: it repeats the name, it adds nothing to it).
 */
export function OperationsSidebar({
  location,
  dispatcherName,
  dispatcherRole,
  hasLinkedDriverProfile,
  canManageSettings,
  canAccessGrowth,
  newInquiryCount,
  setupRemaining = null,
  hasMultipleOrganizations,
}: OperationsSidebarProps) {
  const pathname = usePathname();
  const sections = operationsNavSections({ hasLinkedDriverProfile, canManageSettings, canAccessGrowth, setupRemaining });
  const sectionIdPrefix = useId();

  // P1-UX-R2: defaults to expanded (`false`) so the very first render —
  // both the server-rendered HTML and React's first client commit during
  // hydration — always match exactly, with zero hydration mismatch.
  // The real stored preference (if any) is only ever applied afterward,
  // in the layout effect below, which runs before the browser paints.
  const [collapsed, setCollapsed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {
      // Storage can throw (private-browsing quota, disabled storage,
      // etc.) — fall through to the already-set expanded default rather
      // than crash the whole Operations shell over a UI preference.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Same reasoning as above — a failed write just means the
        // preference won't survive reload this session, not a crash.
      }
      return next;
    });
  }

  const { tip, onShow, onHide, asideRef } = useRailTooltip(collapsed);

  // Hidden while the labels are visible (lg+ expanded); visually hidden (still announced) in the rail.
  const labelVisibility = collapsed ? "sr-only" : "sr-only lg:not-sr-only";
  const textVisibility = collapsed ? "hidden" : "hidden lg:inline";

  return (
    <aside
      ref={asideRef}
      data-testid="operations-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "chrome-surface hidden shrink-0 flex-col bg-chrome-background bg-chrome-gradient md:flex md:w-16",
        "transition-[width] duration-base ease-standard motion-reduce:transition-none",
        !collapsed && "lg:w-64",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center justify-center border-b border-chrome-border px-4", !collapsed && "lg:justify-start lg:px-5")}>
        {/*
          N0-M2-A3: the authenticated shell is PLATFORM chrome — it carries the approved Nemryn mark, never the tenant
          asset. The approved masters are consumed directly, never redrawn or re-derived; width/height reflect each
          file's own viewBox so h-auto/w-auto never distorts it. P1-UX-R2: the full inverse logo only at lg+ while
          expanded; every rail state uses the approved inverse symbol (public/brand/README.txt — no stretching).
        */}
        <Image
          src="/brand/nemryn-symbol-inverse.svg"
          alt="Nemryn"
          width={128}
          height={139}
          priority
          className={cn("h-8 w-auto", !collapsed && "lg:hidden")}
        />
        <Image
          src="/brand/nemryn-logo-inverse.svg"
          alt="Nemryn"
          width={434}
          height={127}
          priority
          className={cn("hidden h-auto w-28", !collapsed && "lg:block")}
        />
      </div>

      {/* P1-UX-R2: the manual collapse / expand control (lg+ only); tablet always uses the automatic rail. */}
      <div className={cn("hidden border-b border-chrome-border lg:flex lg:items-center lg:py-1", collapsed ? "lg:justify-center" : "lg:justify-end lg:px-2")}>
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          icon={collapsed ? <CaretRight className="size-4" aria-hidden /> : <CaretLeft className="size-4" aria-hidden />}
          onClick={toggleCollapsed}
          variant="chrome"
          size="sm"
          data-testid="sidebar-collapse-toggle"
        />
      </div>

      <nav
        aria-label="Primary"
        className={cn("sidebar-scroll flex-1 overflow-y-auto px-2 py-3", !collapsed && "lg:px-3")}
        onMouseOver={onShow}
        onMouseLeave={onHide}
        onFocus={onShow}
        onBlur={onHide}
      >
        {sections.map((section, index) => {
          const labelId = `${sectionIdPrefix}-${section.key}`;
          return (
            <div key={section.key} data-nav-section={section.key} className={cn(index > 0 && "mt-3", index > 0 && !collapsed && "lg:mt-5")}>
              {/* Rail: a hairline between groups stands in for the hidden label. */}
              {index > 0 && <div className={cn("mx-2 mb-3 border-t border-chrome-border", !collapsed && "lg:hidden")} aria-hidden />}
              <p
                id={labelId}
                className={cn(typography.metadata, "px-3 pb-1.5 font-medium text-chrome-text-muted", section.key === "growth" ? "sr-only" : labelVisibility)}
              >
                {section.label}
              </p>
              <ul aria-labelledby={labelId} className="flex flex-col gap-[3px]">
                {section.key === "growth" ? (
                  <GrowthNavGroup key="growth-group" pathname={pathname} collapsed={collapsed} newInquiryCount={newInquiryCount ?? null} />
                ) : (
                  section.items.map((item) => {
                    const Icon = navIcons[item.key];
                    const isActive = isNavItemActive(item.href, pathname);
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          aria-label={item.key === "setup" && setupRemaining ? `${item.label}, ${setupRemaining} ${setupRemaining === 1 ? "step" : "steps"} left` : item.label}
                          data-nav-label={item.label}
                          data-testid={`nav-item-${item.key}`}
                          className={cn(typography.bodySmall, navItemBase, "justify-center", !collapsed && "lg:justify-start", isActive ? navItemActive : navItemIdle)}
                        >
                          <Icon className="size-5 shrink-0" weight={isActive ? "fill" : "regular"} aria-hidden />
                          {/* The accessible name is the aria-label above; this span is visual only and hides in the rail. */}
                          <span className={cn("truncate", textVisibility)}>{item.label}</span>
                          {item.key === "setup" && setupRemaining ? (
                            <span
                              className={cn(typography.metadata, "ml-auto rounded-full bg-chrome-item-active-marker px-1.5 py-px font-semibold leading-4 text-chrome-background tabular-nums", textVisibility)}
                              aria-hidden
                              data-testid="nav-setup-remaining"
                            >
                              {setupRemaining}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className={cn("flex flex-col gap-1 border-t border-chrome-border px-2 py-3", !collapsed && "lg:px-3")}>
        {/*
          P1-UX-R1: the WORKSPACE row — the active tenant's own name, labeled with the plain word "Workspace", never a
          membership role (the role belongs to the person: the user row below). Buildings is the icon
          OrganizationSelector.tsx already uses for this concept. Hidden in every rail state (as before P1b).
          NP-UI-P1b: a quiet card (icon tile · name over "Workspace" · Switch workspace when the person really holds
          more than one workspace — the account menu's existing destination), then the person below it.
        */}
        <div
          className={cn("items-center gap-2.5 rounded-sm bg-chrome-item-hover px-2.5 py-2.5 ring-1 ring-inset ring-chrome-border", collapsed ? "hidden" : "hidden lg:flex")}
          data-testid="sidebar-workspace"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-chrome-workspace-tile text-chrome-workspace-tile-text" aria-hidden>
            <Buildings className="size-4" />
          </span>
          {/* min-w-0: lets `truncate` clip a long organization name (editable in Settings -> Organization) instead of overflowing the fixed-width sidebar. */}
          <div className="min-w-0 flex-1">
            <p className={cn(typography.bodySmall, "truncate font-semibold text-chrome-text-primary")} title={location}>
              {location}
            </p>
            <p className={cn(typography.metadata, "text-chrome-text-muted")}>Workspace</p>
          </div>
          {hasMultipleOrganizations && (
            <Link
              href="/select-organization?switch=1"
              aria-label="Switch workspace"
              title="Switch workspace"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-chrome-text-primary"
              data-testid="sidebar-switch-workspace"
            >
              <ArrowsLeftRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>

        <div className={cn("flex items-center justify-center gap-2.5 py-1.5", !collapsed && "lg:justify-start lg:px-2.5")} data-testid="sidebar-user">
          <Avatar name={dispatcherName} size="sm" tone="chrome" />
          {/*
            P1-E3-S8C1: `min-w-0` lets the name / role truncate inside the fixed-width sidebar (title restores the full
            value). P1-UX-R2: the Avatar stays visible in every rail state; the real account menu is the header's
            AccountMenu, reachable regardless of sidebar state.
          */}
          <div className={cn("min-w-0 flex-1", collapsed ? "hidden" : "hidden lg:block")}>
            <p className={cn(typography.bodySmall, "truncate font-semibold text-chrome-text-primary")} title={dispatcherName}>
              {dispatcherName}
            </p>
            {dispatcherRole && (
              <p className={cn(typography.metadata, "truncate text-chrome-text-muted")} title={dispatcherRole}>
                {dispatcherRole}
              </p>
            )}
          </div>
        </div>
      </div>

      {tip && (
        <div
          aria-hidden
          data-testid="sidebar-rail-tooltip"
          style={{ position: "fixed", top: tip.top, left: tip.left }}
          className={cn(typography.metadata, "pointer-events-none z-50 -translate-y-1/2 rounded-sm bg-chrome-background px-2 py-1 font-medium text-chrome-text-primary shadow-md ring-1 ring-chrome-border")}
        >
          {tip.label}
        </div>
      )}
    </aside>
  );
}

/**
 * Visual label for rail items (the 64px tablet rail, or the collapsed desktop rail). One fixed-position element —
 * the nav scrolls, so an absolutely-positioned child would be clipped. Shown on hover and keyboard focus of any
 * `[data-nav-label]` control, hidden on leave / blur / Escape / scroll / resize, never while the labels are visible.
 */
function useRailTooltip(collapsed: boolean) {
  const asideRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const isRail = useCallback(() => collapsed || !window.matchMedia("(min-width: 1024px)").matches, [collapsed]);

  const onShow = useCallback(
    (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-label]");
      if (!target || !isRail()) {
        if (event.type === "focus" || !target) setTip(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const asideRight = asideRef.current?.getBoundingClientRect().right ?? rect.right;
      setTip({ label: target.dataset.navLabel ?? "", top: rect.top + rect.height / 2, left: asideRight + 8 });
    },
    [isRail],
  );

  const onHide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", close);
    };
  }, [tip]);

  return { tip, onShow, onHide, asideRef };
}
