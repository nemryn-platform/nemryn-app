"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { cancelRequestAction, type RequestLifecycleActionState } from "@/app/operations/requests/[requestId]/actions";
import { requestLifecycleErrorMessage } from "@/lib/operations/request-lifecycle-errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: RequestLifecycleActionState = { status: "idle" };

export interface CancelRequestDialogProps {
  requestId: string;
  onClose: () => void;
}

/**
 * Cancel WITHDRAWS the transportation Request itself before conversion
 * — NOT the same action as Trip cancellation, which remains a
 * completely separate Trip-lifecycle action this component never
 * touches (P1-E1-S2F-B2 §4/§10). The description copy says so
 * explicitly, deliberately, so an operator can never confuse the two.
 *
 * No reason field: `cancel_transportation_request` has no reason
 * parameter (S2B, locked) — one is NOT added here merely for visual
 * symmetry with Decline (§10's own explicit instruction).
 */
export function CancelRequestDialog({ requestId, onClose }: CancelRequestDialogProps) {
  const [state, formAction, pending] = useActionState(cancelRequestAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") {
      onClose();
    }
  }, [state, router, onClose]);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancel request"
      description="Cancel this transportation request? This does not cancel any trip."
    >
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="requestId" value={requestId} />

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {requestLifecycleErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-zw-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep Request
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel Request"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
