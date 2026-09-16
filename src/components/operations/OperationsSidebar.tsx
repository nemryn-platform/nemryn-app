"use client";

import { useState, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Buildings, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { navIcons } from "@/design/icons";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";

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

// P1-E3-S8B1 (work item §26/§32): Billing and Reports are removed from
// visible navigation — both routes remain real Next.js pages on disk
// (still reachable directly if ever needed for internal testing), but
// neither has real product behavior yet, and a visible sidebar entry
// leading to it would be exactly the "convincing-looking dead
// navigation" this phase exists to close. Restore once each has a real
// screen, not merely to fill this list back out.
//
// P1-E1-S2D: "Requests" is placed immediately after Overview, before
// Trips — locked position, matching the S2A audit's own workflow-order
// justification (demand arrives → request reviewed → trip created →
// dispatch → execution): Requests is the first real operational stage,
// so it reads left-to-right before the Trips/Dispatch pair it feeds,
// rather than being buried after reference-data sections
// (Passengers/Facilities/Drivers/Fleet).
const NAV_ITEMS: { key: keyof typeof navIcons; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/operations" },
  { key: "requests", label: "Requests", href: "/operations/requests" },
  { key: "trips", label: "Trips", href: "/operations/trips" },
  { key: "dispatch", label: "Dispatch", href: "/operations/dispatch" },
  { key: "passengers", label: "Passengers", href: "/operations/passengers" },
  { key: "facilities", label: "Facilities", href: "/operations/facilities" },
  { key: "drivers", label: "Drivers", href: "/operations/drivers" },
  { key: "fleet", label: "Fleet", href: "/operations/fleet" },
];

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
}

/**
 * The one OperationsSidebar. Do not fork per-route copies (TripsSidebar,
 * DispatchSidebar, etc.) — the active route changes state, the shell doesn't.
 * Full labels at lg+, icon-only rail at md–lg (tablet). Hidden below md — see
 * OperationsShell for the narrow-width guard state that replaces it there.
 *
 * P1-UX-R2: desktop (lg+) can ALSO be manually collapsed to the same
 * narrow rail tablet already uses — see `collapsed` below. This is a
 * pure client-side UI preference (localStorage only, see
 * SIDEBAR_COLLAPSED_STORAGE_KEY's own doc comment), never a database
 * column or per-user profile field, and never synced across devices or
 * organizations. Tablet's own icon-only presentation is completely
 * unaffected by this — every `lg:`-scoped class below only ever changes
 * behavior at lg+ (1024px+); nothing here alters what renders at md–lg,
 * so resizing between tablet and desktop still behaves exactly as it did
 * before this phase, and the desktop preference simply reapplies
 * whenever the viewport crosses back into lg+ (no extra logic needed —
 * this falls out for free from CSS media queries alone, since `collapsed`
 * never reads or depends on viewport width itself).
 */
export function OperationsSidebar({
  location,
  dispatcherName,
  dispatcherRole,
  hasLinkedDriverProfile,
}: OperationsSidebarProps) {
  const pathname = usePathname();
  // P1-E3-S9 (work item §4/§12, "progressive complexity" — "a 1-2 vehicle
  // operator should quickly reach... Drive"): appended, never replacing
  // any existing item — Operations nav stays the same 7 items for
  // everyone, plus this one additional, conditional item for a genuine
  // dual-hat owner-operator. Same platform, no forked nav structure.
  const navItems = hasLinkedDriverProfile ? [...NAV_ITEMS, { key: "drive" as const, label: "Drive", href: "/driver" }] : NAV_ITEMS;

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

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col bg-chrome-background md:flex md:w-16",
        "transition-[width] duration-base ease-standard motion-reduce:transition-none",
        !collapsed && "lg:w-64",
      )}
    >
      <div className="flex h-16 items-center border-b border-chrome-border px-4 lg:px-6">
        {/*
          N0-M2-A3: the authenticated shell is PLATFORM chrome — it
          carries the Nemryn mark, not the Zenward Mobility tenant
          asset (that PNG is still used elsewhere as tenant identity,
          see public/images/zenward-mobility-logo.png). The approved
          nemryn-logo-inverse.svg (Mineral White, same geometry as the
          Deep Graphite primary lockup) is purpose-built for a dark
          background and is rendered directly against the sidebar's own
          Deep Graphite chrome — no badge/wrapper needed, unlike the
          prior PNG asset this replaced (which required a white badge
          chip because it had an opaque white background baked in; see
          docs/reports/n0-m2-a3-authenticated-shell-and-favicon.txt for
          that decision).

          P1-UX-R2: the full wordmark only ever renders at lg+ while
          expanded — every other width (tablet, or desktop collapsed)
          now uses the approved nemryn-symbol-inverse.svg mark instead
          of squeezing the wordmark down to a sliver, per the locked
          brand-asset rule (docs: public/brand/README.txt — "do not
          stretch... do not alter proportions"). Both are the approved
          master files consumed directly, never redrawn or re-derived;
          width/height on each reflect that file's own real viewBox so
          h-auto/w-auto never distorts it.
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
          className={cn("hidden h-auto w-24", !collapsed && "lg:block")}
        />
      </div>

      {/*
        P1-UX-R2: the manual collapse/expand control — its own thin row,
        separate from the brand row above, so it never has to compete
        with the logo for space at the 64px collapsed/tablet rail width
        (there isn't room for both a legible mark and a button side by
        side at that width). `hidden lg:flex` means this row — and the
        ability to manually collapse/expand at all — only ever exists at
        lg+; tablet keeps its existing single-purpose brand-only header
        exactly as before, unchanged, with no toggle exposed (§18/§20 of
        the phase spec: tablet always uses the automatic compact rail,
        never a manually-chosen state).
      */}
      <div className="hidden border-b border-chrome-border lg:flex lg:items-center lg:justify-center lg:py-1">
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          icon={collapsed ? <CaretRight className="size-4" aria-hidden /> : <CaretLeft className="size-4" aria-hidden />}
          onClick={toggleCollapsed}
        />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 py-3 lg:px-3">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = navIcons[item.key];
            const isActive =
              item.href === "/operations" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    typography.bodySmall,
                    "flex items-center gap-3 rounded-sm px-3 py-2 font-medium transition-colors duration-base",
                    isActive
                      ? "bg-chrome-item-active-background text-chrome-item-active-text"
                      : "text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-white",
                  )}
                >
                  <Icon className="size-5 shrink-0" weight={isActive ? "fill" : "regular"} aria-hidden />
                  {/*
                    P1-UX-R2: explicit `aria-label` above (not just this
                    visible span + `title`) guarantees every nav item
                    still has a well-defined accessible name once this
                    span is hidden in collapsed/tablet rails — `title`
                    alone remains a real, working hover tooltip (no new
                    tooltip component needed, per the phase's own
                    "smallest accessible solution" instruction — no
                    Tooltip primitive exists anywhere in this codebase),
                    but the accessible NAME itself no longer depends on
                    it.
                  */}
                  <span className={cn("hidden", !collapsed && "lg:inline")}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-chrome-border px-3 py-3 lg:px-4">
        {/*
          P1-UX-R1: the WORKSPACE row — the active tenant's own name,
          labeled with the plain, static word "Workspace," never a
          membership role. Previously showed the signed-in user's role
          here (e.g. "Organization Admin"), which visually read as a
          second organization/account rather than "this platform account
          belongs to this tenant." The role belongs to the person, not
          the organization — it now appears exactly once, in the user
          row directly below. Buildings (not a location pin) is the
          same icon OrganizationSelector.tsx already uses for this exact
          workspace/organization concept — reused, not newly introduced.

          P1-UX-R2: this row already only ever appeared at lg+ (it was
          `hidden` at tablet width, before this phase even existed) —
          collapsing at lg+ now reuses that exact same pre-existing
          `hidden` treatment: no `lg:flex` is added when `collapsed`,
          so the row simply behaves exactly as it always has at tablet
          widths, just also applied at lg+ while collapsed.
        */}
        <div className={cn("items-center gap-2 px-1 pb-3 text-chrome-text-secondary", collapsed ? "hidden" : "hidden lg:flex")}>
          <Buildings className="size-4 shrink-0" aria-hidden />
          <div className={typography.metadata}>
            <p className="truncate font-medium" title={location}>
              {location}
            </p>
            <p>Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-1">
          <Avatar name={dispatcherName} size="sm" />
          {/*
            P1-E3-S8C1 (work item §2): `min-w-0` is required here — without
            it, a flex child with no explicit width never actually shrinks
            below its content's natural size, so `truncate` on the <p>s
            below had nothing to truncate AGAINST and a long identity value
            (a full email address, in Harmony's own case before real
            `user_profiles.display_name` rows existed — see supabase/
            seed.sql) simply overflowed the fixed-width sidebar instead of
            ellipsizing cleanly. `title` restores the full value on hover
            for anyone who needs it, since the visible text itself is now
            deliberately allowed to clip.

            P1-UX-R2: the Avatar itself (this compact circular
            initials badge) was ALREADY unconditionally visible at every
            supported width, including tablet — only this text block
            beside it was breakpoint-gated. Collapsing at lg+ reuses that
            same pre-existing compact affordance with zero new code; the
            REAL account menu this avatar visually echoes lives entirely
            in AppHeader/AccountMenu (untouched by this phase, still
            reachable via the header's own avatar trigger regardless of
            sidebar state).
          */}
          <div className={cn("min-w-0 flex-1", collapsed ? "hidden" : "hidden lg:block")}>
            <p className={cn(typography.bodySmall, "truncate font-medium text-white")} title={dispatcherName}>
              {dispatcherName}
            </p>
            {dispatcherRole && (
              <p className={cn(typography.metadata, "truncate text-chrome-text-secondary")} title={dispatcherRole}>
                {dispatcherRole}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
