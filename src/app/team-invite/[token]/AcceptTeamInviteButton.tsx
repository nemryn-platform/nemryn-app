"use client";

import { useActionState } from "react";
import { acceptTeamInviteAction, type TeamJoinActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: TeamJoinActionState = {};

export function AcceptTeamInviteButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptTeamInviteAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-zw-md">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {AUTH_ERROR_MESSAGE[state.error]}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
