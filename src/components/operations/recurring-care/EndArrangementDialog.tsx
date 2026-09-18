"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { endRecurringArrangementAction, type RecurringArrangementActionState } from "@/app/operations/recurring-care/[arrangementId]/actions";
import { recurringArrangementErrorMessage } from "@/lib/operations/recurring-arrangement-errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: RecurringArrangementActionState = { status: "idle" };

export interface EndArrangementDialogProps {
  arrangementId: string;
  passengerName: string;
  onClose: () => void;
}

/**
 * End Arrangement confirmation (P1-E2-S1E §21) — mirrors CancelTripDialog's
 * own established shape exactly (required reason, destructive submit
 * button, `router.refresh()` + close on success). Terminal, never framed
 * as "delete" — existing Trips are explicitly stated as unaffected, and
 * no "reopen" affordance is offered anywhere (there is none — ending is
 * terminal, matching end_recurring_arrangement's own locked contract).
 */
export function EndArrangementDialog({ arrangementId, passengerName, onClose }: EndArrangementDialogProps) {
  const [state, formAction, pending] = useActionState(endRecurringArrangementAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") onClose();
  }, [state, router, onClose]);

  return (
    <Dialog
      open
      onClose={onClose}
      title="End recurring arrangement"
      description={`Nemryn will stop expecting future recurring transportation from ${passengerName}'s arrangement. Existing trips are not changed. This cannot be undone.`}
    >
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="arrangementId" value={arrangementId} />
        <Textarea label="Reason for ending" name="reason" required disabled={pending} />
        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {recurringArrangementErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-zw-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep arrangement
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            {pending ? "Ending…" : "End arrangement"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
