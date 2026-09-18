"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { skipRecurringOccurrenceAction, type RecurringArrangementActionState } from "@/app/operations/recurring-care/[arrangementId]/actions";
import { recurringArrangementErrorMessage } from "@/lib/operations/recurring-arrangement-errors";
import { formatServiceDateLabel } from "@/lib/operations/presentation";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: RecurringArrangementActionState = { status: "idle" };

export interface SkipOccurrenceDialogProps {
  arrangementId: string;
  serviceDate: string;
  onClose: () => void;
}

/** Skip occurrence (P1-E2-S1E §15) — a concise required reason, never a one-click destructive-looking action with no context. */
export function SkipOccurrenceDialog({ arrangementId, serviceDate, onClose }: SkipOccurrenceDialogProps) {
  const [state, formAction, pending] = useActionState(skipRecurringOccurrenceAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") onClose();
  }, [state, router, onClose]);

  return (
    <Dialog open onClose={onClose} title={`Skip ${formatServiceDateLabel(serviceDate)}`}>
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="arrangementId" value={arrangementId} />
        <input type="hidden" name="serviceDate" value={serviceDate} />
        <Textarea label="Reason" name="reason" required disabled={pending} placeholder="e.g. Facility closed" />
        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {recurringArrangementErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending} disabled={pending}>
            {pending ? "Skipping…" : "Skip date"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
