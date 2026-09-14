"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type SignInState } from "@/app/sign-in/actions";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: SignInState = {};

export interface SignInFormProps {
  /** Pre-validated by the server component that renders this form — never re-trusted blindly, only carried through as a hidden field for the Server Action to re-validate itself. */
  next?: string;
}

/**
 * Email + password sign-in (work item §11-13): safe loading state (button
 * disabled + label swap while `pending`, preventing double submission),
 * generic failure copy (never distinguishes "no such account" from "wrong
 * password"), accessible labels/autocomplete (via the existing Input
 * primitive), keyboard-submittable (a native `<form>`, no `onKeyDown`
 * hijacking needed).
 */
export function SignInForm({ next }: SignInFormProps) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full flex-col gap-zw-lg" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex w-full flex-col gap-zw-md">
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          size="lg"
        />
        <PasswordInput
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          disabled={pending}
          size="lg"
        />
        <Link
          href="/forgot-password"
          className={cn(typography.bodySmall, "self-end font-medium text-brand-interactive-teal")}
        >
          Forgot password?
        </Link>
      </div>

      {state.error ? (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
