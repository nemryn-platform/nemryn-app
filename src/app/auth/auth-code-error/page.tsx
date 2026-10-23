import Image from "next/image";
import Link from "next/link";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Link expired" };

/**
 * P1-E4-S0A2 — the restrained failure state for `/auth/confirm` (work
 * item §2's own "on failure: redirect to a restrained auth error/retry
 * state"). Reached only when a confirmation link's token is missing,
 * expired, or already used — never shows a raw Supabase error, matches
 * the calm, minimal shell every other auth surface in this app already
 * uses (same card, same logo, same copy register as `/join/[token]`'s
 * own "Invite not found"/"Invite no longer available" states).
 */
export default function AuthCodeErrorPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-app bg-canvas-glow px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface-elevated p-8 shadow-panel">
        {/* N0-M2-A2-R1: approved Nemryn platform lockup — see SignInPage's own comment for the ratio rationale. */}
        <div className="mb-8 flex justify-center">
          <Image
            src="/brand/nemryn-logo-primary.svg"
            alt="Nemryn"
            width={434}
            height={127}
            priority
            className="h-auto w-60"
          />
        </div>

        <h1 className={cn(typography.displaySection, "mb-2 text-text-primary")}>This link has expired</h1>
        <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>
          This confirmation link is no longer valid — it may have expired or already been used. If you already
          confirmed your account, just sign in. Otherwise, create your account again to get a fresh link.
        </p>

        <div className="flex flex-col gap-zw-md">
          <Link
            href="/sign-in"
            className={cn(
              typography.button,
              "flex h-12 w-full items-center justify-center rounded-sm border border-action-primary-hover bg-action-primary-background bg-action-primary-gradient font-semibold text-action-primary-foreground hover:bg-action-primary-hover hover:bg-none",
            )}
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className={cn(typography.bodySmall, "inline-flex min-h-11 items-center justify-center text-center font-medium text-text-link")}
          >
            Create your account again
          </Link>
        </div>
      </div>
    </main>
  );
}
