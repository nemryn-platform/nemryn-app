"use client";

import { useActionState } from "react";
import { completeSignupManualAction, type CompleteSignupState } from "@/app/complete-signup/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: CompleteSignupState = {};

export interface CompleteSignupFormProps {
  defaultFullName?: string;
  defaultBusinessName?: string;
}

/**
 * The first-run "Set up your organization" form: an authenticated account
 * with no Membership and no traceable pending-signup metadata (P1-E4-S0A1
 * §9's recovery case, presented as an intentional first-run experience by
 * P1-PILOT-S4B-R4A). Same calm, minimal shape as SignUpForm, deliberately
 * smaller (no email/password — this person is already authenticated).
 * The submit control is disabled while pending, and the server-side gate
 * (complete_pending_signup_manual) makes a double submit safe regardless.
 */
export function CompleteSignupForm({ defaultFullName = "", defaultBusinessName = "" }: CompleteSignupFormProps) {
  const [state, formAction, pending] = useActionState(completeSignupManualAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full flex-col gap-zw-lg" noValidate>
      <div className="flex w-full flex-col gap-zw-md">
        <Input
          label="Your name"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          maxLength={200}
          disabled={pending}
          size="lg"
          defaultValue={defaultFullName}
        />
        <Input
          label="Organization name"
          name="businessName"
          type="text"
          autoComplete="organization"
          required
          maxLength={200}
          disabled={pending}
          size="lg"
          helpText="You can change this later."
          defaultValue={defaultBusinessName}
        />
      </div>

      {state.error && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Creating your organization…" : "Create organization"}
      </Button>
    </form>
  );
}
