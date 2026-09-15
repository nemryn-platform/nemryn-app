"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOut, UserSwitch } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { signOutAction } from "@/lib/auth/sign-out-action";

export interface AccountMenuProps {
  avatarName: string;
  organizationName: string;
  roleLabel: string;
  /** Only offered when the signed-in user genuinely holds more than one active Membership (work item §27: "ONLY where meaningful / user has multiple organizations") — never shown merely because the UI has room for it. */
  showSwitchOrganization: boolean;
}

/**
 * A real, accessible account menu (P1-E3-S8B1, work item §27/§30) —
 * replaces the static, non-interactive Avatar the Operations header
 * previously rendered with no way to sign out. Reuses the existing,
 * already-correct `signOutAction` (session invalidation via Supabase's
 * own `auth.signOut()`, org-context cookie cleared, redirect to
 * /sign-in — already wired into the Driver header since P1-E3-S2/§28)
 * rather than inventing a second sign-out mechanism.
 *
 * Deliberately no fake profile/settings links (work item §27's own
 * explicit prohibition) — only real, working content: the current
 * organization name, the current role, an optional Switch Organization
 * link (only when genuinely meaningful), and Sign Out.
 */
export function AccountMenu({ avatarName, organizationName, roleLabel, showSwitchOrganization }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = "account-menu-popup";

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu — ${avatarName}, ${roleLabel} at ${organizationName}`}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <Avatar name={avatarName} size="sm" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-20 mt-2 w-56 rounded-sm border border-border-subtle bg-surface-elevated py-1 shadow-md"
        >
          <div className="min-w-0 border-b border-border-subtle px-3 py-2.5">
            {/* P1-E3-S8C1 (work item §2): `title` restores the full value
                on hover/focus for anything long enough to truncate — the
                popup itself stays compact (w-56) rather than growing to
                fit a long organization name. */}
            <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={organizationName}>
              {organizationName}
            </p>
            <p className={cn(typography.metadata, "truncate text-text-muted")} title={roleLabel}>
              {roleLabel}
            </p>
          </div>

          {showSwitchOrganization && (
            <Link
              href="/select-organization"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                typography.bodySmall,
                "flex items-center gap-2.5 px-3 py-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary",
              )}
            >
              <UserSwitch className="size-4" aria-hidden />
              Switch Organization
            </Link>
          )}

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className={cn(
                typography.bodySmall,
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary",
              )}
            >
              <SignOut className="size-4" aria-hidden />
              Sign Out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
