"use client";

import { useActionState } from "react";
import { teamJoinSignUpAction, type TeamJoinActionState } from "./actions";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: TeamJoinActionState = {};

export function TeamJoinSignUpForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(teamJoinSignUpAction, INITIAL_STATE);

  if (state.needsEmailConfirmation) {
    return (
      <p className={cn(typography.body, "text-text-primary")}>
        Check your email to confirm your account. Once you click the confirmation link, you&apos;ll be signed in
        automatically and this invitation will be accepted for you.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-zw-md">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      <Input label="Email" name="emailDisplay" type="email" value={email} disabled readOnly size="lg" />
      <Input label="Full name" name="fullName" type="text" autoComplete="name" required disabled={pending} size="lg" />
      <PasswordInput label="Password" name="password" autoComplete="new-password" required disabled={pending} size="lg" helpText="At least 8 characters." />

      {state.error && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Setting up your account…" : "Create account & join"}
      </Button>
    </form>
  );
}
