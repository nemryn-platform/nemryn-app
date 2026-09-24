"use client";

import { declineRequestAction } from "@/app/operations/requests/[requestId]/actions";
import { RequestDecisionDialog } from "./RequestDecisionDialog";

export interface DeclineRequestDialogProps {
  requestId: string;
  onClose: () => void;
}

/** Decline = "we reviewed this new Request and will not service it" (pending → declined, terminal). Reason required (P1-OPS-R1). */
export function DeclineRequestDialog({ requestId, onClose }: DeclineRequestDialogProps) {
  return (
    <RequestDecisionDialog
      kind="decline"
      requestId={requestId}
      title="Decline this request?"
      description="This request will be marked as declined and will not move forward to scheduling."
      confirmLabel="Decline Request"
      pendingLabel="Declining…"
      action={declineRequestAction}
      onClose={onClose}
    />
  );
}
