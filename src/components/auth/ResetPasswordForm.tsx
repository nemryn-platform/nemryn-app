"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction, type ResetPasswordState } from "@/app/auth/reset-password/actions";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/recovery-core";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: ResetPasswordState = { status: "idle" };

/**
 * The new-password form (P0-S2B) — rendered only once
 * `/auth/reset-password` (the Server Component page) has already
 * confirmed a valid recovery context exists. The Server Action re-checks
 * that same context itself regardless (defense in depth — see that
 * action's own doc comment), so this form never needs to smuggle any
 * recovery-identifying value through hidden fields; the session cookie
 * already carries it.
 *
 * Post-success: the user remains signed in (Supabase's own recovery
 * session becomes their normal session once the password is changed —
 * this is Supabase's documented behavior, not a choice made by this
 * form) — so the success state offers one manual "Continue" action
 * rather than an automatic redirect (predictable over clever), matching
 * `docs/product/password-recovery-model.md`'s own documented decision.
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_STATE);

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-zw-md">
        <p className={cn(typography.body, "text-text-primary")}>Your password has been updated.</p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>You&apos;re still signed in — continue to Zenward.</p>
        <Link
          href="/"
          className={cn(
            typography.button,
            "flex h-12 w-full items-center justify-center rounded-md bg-brand-interactive-teal text-white hover:brightness-95",
          )}
        >
          Continue
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-zw-lg" noValidate>
      <div className="flex w-full flex-col gap-zw-md">
        <PasswordInput
          label="New password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={pending}
          size="lg"
          helpText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <PasswordInput
          label="Confirm new password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={pending}
          size="lg"
        />
      </div>

      {state.status === "error" && state.error ? (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
