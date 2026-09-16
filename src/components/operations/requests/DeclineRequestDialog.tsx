"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { declineRequestAction, type RequestLifecycleActionState } from "@/app/operations/requests/[requestId]/actions";
import { requestLifecycleErrorMessage } from "@/lib/operations/request-lifecycle-errors";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: RequestLifecycleActionState = { status: "idle" };

export interface DeclineRequestDialogProps {
  requestId: string;
  onClose: () => void;
}

/**
 * Decline is a deliberate lifecycle action (P1-E1-S2F-B2 §7) — requires
 * an explicit confirm click, never a casual one-click button. Mirrors
 * `CancelTripDialog`'s established pattern exactly: the native `Dialog`
 * primitive (real focus trapping/ESC handling for free), a real
 * `<form>` + Server Action mounted only while open (so `useActionState`
 * is always fresh), `router.refresh()` on any settled state so the
 * page behind the dialog reflects reality even on error, and a
 * `variant="destructive"` confirm button — the SAME visual weight
 * `CancelTripDialog` already uses for an equivalently terminal
 * lifecycle action.
 *
 * The reason field is optional free text (RPC max 500 chars, enforced
 * here via the native `maxLength` attribute) — no reason-category
 * taxonomy, per the locked S2B decision this phase does not revisit.
 */
export function DeclineRequestDialog({ requestId, onClose }: DeclineRequestDialogProps) {
  const [state, formAction, pending] = useActionState(declineRequestAction, INITIAL_STATE);
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
      title="Decline request"
      description="Decline this transportation request? It will remain in Request Hub history and cannot be converted into a trip."
    >
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="requestId" value={requestId} />

        <Textarea
          label="Reason"
          name="reason"
          helpText="Optional. Up to 500 characters."
          placeholder="e.g. Passenger no longer needs transportation"
          maxLength={500}
          disabled={pending}
        />

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
            {pending ? "Declining…" : "Decline Request"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
