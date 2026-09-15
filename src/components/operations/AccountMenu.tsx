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
  /** P1-UX-R1: the signed-in user's own auth email — already resolved server-side, no new query. Optional restrained third line under name/role; omitted entirely when null rather than rendering an empty line. */
  dispatcherEmail: string | null;
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
 * explicit prohibition) — only real, working content.
 *
 * P1-UX-R1: the popup header now headlines with the signed-in PERSON
 * (`avatarName` + `roleLabel`, optionally `dispatcherEmail`) — it
 * previously headlined with `organizationName` first, which made the
 * popup read as "this is a second organization," not "this is your
 * account." `organizationName` is no longer rendered anywhere in this
 * popup's visible body (it remains in the trigger button's own
 * `aria-label` only, for screen-reader context — that announcement
 * never creates the same visual ambiguity a rendered heading would).
 * The active workspace name is already shown persistently in the
 * sidebar, at all times this menu could be open, so no context is lost
 * by not repeating it here. ACCOUNT (this identity block) and WORKSPACE
 * (the "Switch Organization" action below) remain visually separated by
 * the existing `border-b` divider — the same section-break convention
 * this codebase already uses throughout (Panel/SectionHeader), not a
 * new pattern introduced for this fix.
 */
export function AccountMenu({ avatarName, dispatcherEmail, organizationName, roleLabel, showSwitchOrganization }: AccountMenuProps) {
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
                fit a long name/email. P1-UX-R1: headlines with the
                signed-in PERSON, never the organization — see this
                component's own doc comment. */}
            <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={avatarName}>
              {avatarName}
            </p>
            <p className={cn(typography.metadata, "truncate text-text-muted")} title={roleLabel}>
              {roleLabel}
            </p>
            {/* Omitted when it would just repeat the line above — the
                display name itself falls back to the raw email whenever
                no real profile name has been set yet (getDisplayName's
                own established behavior), which would otherwise render
                the identical string twice in a 2-line-tall popup. */}
            {dispatcherEmail && dispatcherEmail !== avatarName && (
              <p className={cn(typography.metadata, "truncate text-text-muted")} title={dispatcherEmail}>
                {dispatcherEmail}
              </p>
            )}
          </div>

          {showSwitchOrganization && (
            <Link
              // P1-UX-R1A: `?switch=1` is required here — without it, a
              // caller who already has a valid organization selected (the
              // normal case, since they're looking at this menu from
              // inside an already-resolved workspace) would immediately
              // bounce straight back from /select-organization, and this
              // link would do nothing. `?switch=1` carries no organization
              // id; it only tells that route to show the picker instead
              // of auto-redirecting — see resolveOrganizationContext's own
              // `forceSelection` option and that route's doc comment.
              href="/select-organization?switch=1"
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
