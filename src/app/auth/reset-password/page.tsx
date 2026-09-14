import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth/session";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Reset password — Zenward Mobility" };

/**
 * The password-reset landing page (P0-S2B) — reached only via
 * `/auth/confirm?type=recovery`'s redirect. Renders the reset form ONLY
 * when BOTH are true:
 *   - a real Supabase session exists (`getUser()`), AND
 *   - this application's own short-lived recovery marker cookie is
 *     present (`src/lib/auth/recovery.ts` — set by `/auth/confirm` at
 *     the exact moment it verified the recovery token).
 *
 * Requiring both, not either alone, is deliberate: a session alone could
 * belong to someone who is simply already signed in for an unrelated
 * reason (this page must not become an undocumented "change my password
 * while logged in" feature — out of this phase's scope) and the marker
 * cookie alone is not a credential and grants nothing by itself (see
 * that module's own doc comment). Neither condition, on its own, is
 * treated as authorization to show the form.
 *
 * Every other case (an expired/invalid/already-used recovery link,
 * someone bookmarking or guessing this URL directly, a missing session)
 * renders the same restrained inline failure state below — visually
 * consistent with `/auth/auth-code-error` (same shell, same tone)
 * without importing it directly here (a distinct route with its own
 * small amount of JSX, not worth a shared component for two short call
 * sites — see this phase's own completion report for the tradeoff).
 */
export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const hasRecoveryMarker = cookieStore.get(RECOVERY_COOKIE_NAME)?.value === "1";
  const user = hasRecoveryMarker ? await getUser() : null;
  const canReset = hasRecoveryMarker && Boolean(user);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/images/zenward-mobility-logo.png"
            alt="Zenward Mobility"
            width={240}
            height={80}
            priority
            className="h-auto w-60"
          />
        </div>

        {canReset ? (
          <>
            <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Set a new password</h1>
            <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>Choose a new password for your account.</p>
            <ResetPasswordForm />
          </>
        ) : (
          <>
            <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>This link has expired</h1>
            <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>
              This password reset link is no longer valid — it may have expired or already been used. Request a new
              one to continue.
            </p>
            <div className="flex flex-col gap-zw-md">
              <Link
                href="/forgot-password"
                className={cn(
                  typography.button,
                  "flex h-12 w-full items-center justify-center rounded-md bg-brand-interactive-teal text-white hover:brightness-95",
                )}
              >
                Request a new link
              </Link>
              <Link href="/sign-in" className={cn(typography.bodySmall, "text-center font-medium text-brand-interactive-teal")}>
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
