"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import type { RequestLifecycleActionState } from "@/app/operations/requests/[requestId]/actions";
import { requestLifecycleErrorMessage } from "@/lib/operations/request-lifecycle-errors";
import { REQUEST_REASON_NOTE_MAX_LENGTH, requestReasonCodes, requestReasonLabel, type RequestDecisionKind } from "@/lib/operations/request-decision-reasons";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: RequestLifecycleActionState = { status: "idle" };

export interface RequestDecisionDialogProps {
  kind: RequestDecisionKind;
  requestId: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  action: (state: RequestLifecycleActionState, formData: FormData) => Promise<RequestLifecycleActionState>;
  onClose: () => void;
}

/**
 * Shared confirmation for the two terminal Request decisions (P1-OPS-R1):
 * Decline (pending) and Cancel (accepted). Both require a reason from a
 * closed set; `Other` additionally requires a short explanation. Same
 * mechanics as CancelTripDialog: native Dialog, a real <form> + Server
 * Action mounted only while open, router.refresh() on any settled state,
 * destructive confirm button with a loading state (the action's own
 * `pending` disables it, so a double click submits once; the RPC is
 * idempotent regardless).
 */
export function RequestDecisionDialog({
  kind,
  requestId,
  title,
  description,
  confirmLabel,
  pendingLabel,
  action,
  onClose,
}: RequestDecisionDialogProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [reasonCode, setReasonCode] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") {
      onClose();
    }
  }, [state, router, onClose]);

  const noteRequired = reasonCode === "other";
  const options = requestReasonCodes(kind).map((code) => ({ value: code, label: requestReasonLabel(code) }));

  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="requestId" value={requestId} />

        <Select
          label="Reason"
          name="reasonCode"
          options={options}
          placeholder="Select a reason"
          required
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          disabled={pending}
        />

        <Textarea
          label={noteRequired ? "Explanation" : "Note"}
          name="reasonNote"
          helpText={noteRequired ? `Required for Other. Up to ${REQUEST_REASON_NOTE_MAX_LENGTH} characters.` : `Optional. Up to ${REQUEST_REASON_NOTE_MAX_LENGTH} characters.`}
          maxLength={REQUEST_REASON_NOTE_MAX_LENGTH}
          required={noteRequired}
          rows={3}
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
          <Button type="submit" variant="destructive" loading={pending} disabled={pending || reasonCode === ""}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
