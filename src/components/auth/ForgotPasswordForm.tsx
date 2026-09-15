"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, type ForgotPasswordState } from "@/app/forgot-password/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: ForgotPasswordState = { status: "idle" };

/**
 * Forgot-password request form (P0-S2B). On `"sent"`, the form itself is
 * replaced by a static confirmation message — deliberately the SAME
 * message every time (work item's own "no email enumeration"
 * requirement), never conditioned on whether an account existed.
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL_STATE);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-zw-md">
        <p className={cn(typography.body, "text-text-primary")}>
          If an account exists for that email, we&apos;ve sent password reset instructions.
        </p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Check your inbox (and spam folder). The link is valid for a limited time.
        </p>
        <Link
          href="/sign-in"
          className={cn(typography.bodySmall, "text-center font-medium text-text-link")}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-zw-lg" noValidate>
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={pending}
        size="lg"
        helpText="We'll send a link to reset your password."
      />

      {state.status === "error" && state.error ? (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
