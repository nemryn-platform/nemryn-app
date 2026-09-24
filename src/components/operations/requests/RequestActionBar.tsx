"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LinkButton } from "@/components/ui/LinkButton";
import { Button } from "@/components/ui/Button";
import { acceptRequestAction, type RequestLifecycleActionState } from "@/app/operations/requests/[requestId]/actions";
import { requestLifecycleErrorMessage } from "@/lib/operations/request-lifecycle-errors";
import type { RequestActions } from "@/lib/operations/request-readiness-core";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { DeclineRequestDialog } from "./DeclineRequestDialog";
import { CancelRequestDialog } from "./CancelRequestDialog";

const INITIAL_STATE: RequestLifecycleActionState = { status: "idle" };

export interface RequestActionBarProps {
  requestId: string;
  actions: RequestActions;
  createTripHref: string;
}

/**
 * Request Detail's action cluster (P1-E1-S2F-B1/B2, reworked by
 * P1-OPS-R1). One flat row, secondary actions first, the one positive
 * action last and filled:
 *   pending:            [Decline Request] [Accept Request]
 *   accepted, no Trip:  [Cancel Request]  [Create Trip]  (Create Trip only when ready)
 *   accepted, Trips:    [Create Another Trip]            (when the Passenger is still active)
 *   declined/cancelled: nothing
 * Accept is a direct, deliberate action (no confirmation — it is not
 * terminal and changes nothing but the decision state). Decline/Cancel
 * are terminal and open a reason dialog. Every gate is UI convenience
 * only; the RPCs are the authority.
 */
export function RequestActionBar({ requestId, actions, createTripHref }: RequestActionBarProps) {
  const [activeDialog, setActiveDialog] = useState<"decline" | "cancel" | null>(null);
  const [acceptState, acceptAction, accepting] = useActionState(acceptRequestAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (acceptState.status !== "idle") router.refresh();
  }, [acceptState, router]);

  const hasAny =
    actions.canAccept || actions.canDecline || actions.canCancel || actions.canCreateTrip || actions.canCreateAnotherTrip;
  if (!hasAny) return null;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {actions.canDecline && (
          <Button type="button" variant="outline" onClick={() => setActiveDialog("decline")} disabled={accepting}>
            Decline Request
          </Button>
        )}
        {actions.canAccept && (
          <form action={acceptAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <Button type="submit" loading={accepting} disabled={accepting}>
              {accepting ? "Accepting…" : "Accept Request"}
            </Button>
          </form>
        )}
        {actions.canCancel && (
          <Button type="button" variant="outline" onClick={() => setActiveDialog("cancel")}>
            Cancel Request
          </Button>
        )}
        {(actions.canCreateTrip || actions.canCreateAnotherTrip) && (
          <LinkButton href={createTripHref}>{actions.canCreateTrip ? "Create Trip" : "Create Another Trip"}</LinkButton>
        )}
      </div>

      {acceptState.status === "error" && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {requestLifecycleErrorMessage(acceptState.errorCode ?? "UNKNOWN")}
        </p>
      )}

      {activeDialog === "decline" && <DeclineRequestDialog requestId={requestId} onClose={() => setActiveDialog(null)} />}
      {activeDialog === "cancel" && <CancelRequestDialog requestId={requestId} onClose={() => setActiveDialog(null)} />}
    </div>
  );
}
