"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Buildings } from "@phosphor-icons/react/dist/ssr";
import { navIcons } from "@/design/icons";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Avatar } from "@/components/ui/Avatar";

// P1-E3-S8B1 (work item §26/§32): Billing and Reports are removed from
// visible navigation — both routes remain real Next.js pages on disk
// (still reachable directly if ever needed for internal testing), but
// neither has real product behavior yet, and a visible sidebar entry
// leading to it would be exactly the "convincing-looking dead
// navigation" this phase exists to close. Restore once each has a real
// screen, not merely to fill this list back out.
const NAV_ITEMS: { key: keyof typeof navIcons; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/operations" },
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

  return (
    <aside className="hidden shrink-0 flex-col bg-chrome-background md:flex md:w-16 lg:w-64">
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
          that decision). width/height reflect the SVG's own viewBox
          (0 0 434 127); h-auto derives the correct non-distorted
          height at each breakpoint's fixed width.
        */}
        <Image
          src="/brand/nemryn-logo-inverse.svg"
          alt="Nemryn"
          width={434}
          height={127}
          priority
          className="h-auto w-7 lg:w-24"
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
                  <span className="hidden lg:inline">{item.label}</span>
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
        */}
        <div className="hidden items-center gap-2 px-1 pb-3 text-chrome-text-secondary lg:flex">
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
          */}
          <div className="hidden min-w-0 flex-1 lg:block">
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
