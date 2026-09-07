"use client";

import { useActionState } from "react";
import { signUpAction, type SignUpState } from "@/app/sign-up/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: SignUpState = {};

/**
 * Sign-up form (P1-E3-S9, work item §2/§15) — the same calm, minimal
 * pattern as `SignInForm`, not a "create your account" marketing wizard.
 * Exactly 4 fields, no more: full name, email, password, business name.
 */
export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL_STATE);

  if (state.needsEmailConfirmation) {
    return (
      <div className="flex flex-col gap-zw-md">
        <p className={cn(typography.body, "text-text-primary")}>Check your email to confirm your account.</p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          We sent a confirmation link to the email address you entered. Once you click it, you&apos;ll be signed in
          automatically and we&apos;ll set up your business — no need to sign in separately.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-zw-lg" noValidate>
      <div className="flex w-full flex-col gap-zw-md">
        <Input label="Full name" name="fullName" type="text" autoComplete="name" required disabled={pending} size="lg" />
        <Input label="Email" name="email" type="email" autoComplete="email" required disabled={pending} size="lg" />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
          size="lg"
          helpText="At least 8 characters."
        />
        <Input
          label="Business name"
          name="businessName"
          type="text"
          autoComplete="organization"
          required
          disabled={pending}
          size="lg"
          helpText="You can change this later."
        />
      </div>

      {state.error && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
