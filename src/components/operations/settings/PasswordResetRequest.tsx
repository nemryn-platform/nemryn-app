"use client";

import { useActionState } from "react";
import { sendOwnPasswordResetAction, type OwnPasswordResetState } from "@/app/operations/settings/security/actions";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: OwnPasswordResetState = { status: "idle" };

export function PasswordResetRequest() {
  const [state, action, pending] = useActionState(sendOwnPasswordResetAction, IDLE);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" size="sm" loading={pending} disabled={pending}>
        Send password reset email
      </Button>
      {state.status !== "idle" && state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
