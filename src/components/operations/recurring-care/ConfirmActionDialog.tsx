"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import type { ButtonVariant } from "@/components/ui/Button";
import { recurringArrangementErrorMessage, type RecurringArrangementErrorCode } from "@/lib/operations/recurring-arrangement-errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

interface ConfirmActionState {
  status: "idle" | "success" | "error";
  errorCode?: RecurringArrangementErrorCode;
}

const INITIAL_STATE: ConfirmActionState = { status: "idle" };

export interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  confirmingLabel: string;
  confirmVariant?: ButtonVariant;
  hiddenFields: Record<string, string>;
  action: (prevState: ConfirmActionState, formData: FormData) => Promise<ConfirmActionState>;
  onClose: () => void;
}

/**
 * Shared lightweight confirmation dialog (P1-E2-S1E §16/§19/§20) — no
 * reason field, just explanatory copy + a confirm button, for actions
 * whose own RPC takes no reason parameter (pause_recurring_arrangement,
 * resume_recurring_arrangement, unskip_recurring_occurrence — all three
 * confirmed reason-less by reading their own S1D signatures). Mirrors
 * CancelTripDialog's `router.refresh()` + close-on-success pattern,
 * minus the Textarea — reused across all three call sites rather than
 * copy-pasting this boilerplate three times.
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  confirmingLabel,
  confirmVariant = "primary",
  hiddenFields,
  action,
  onClose,
}: ConfirmActionDialogProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") onClose();
  }, [state, router, onClose]);

  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <form action={formAction} className="flex flex-col gap-zw-md">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {recurringArrangementErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={confirmVariant} loading={pending} disabled={pending}>
            {pending ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
