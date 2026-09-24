"use client";

import { cancelRequestAction } from "@/app/operations/requests/[requestId]/actions";
import { RequestDecisionDialog } from "./RequestDecisionDialog";

export interface CancelRequestDialogProps {
  requestId: string;
  onClose: () => void;
}

/**
 * Cancel = "this Request was accepted, but transportation will no longer
 * proceed" (accepted → cancelled, terminal). Only offered while no Trip
 * exists — it never cancels a Trip (P1-OPS-R1). Reason required.
 */
export function CancelRequestDialog({ requestId, onClose }: CancelRequestDialogProps) {
  return (
    <RequestDecisionDialog
      kind="cancel"
      requestId={requestId}
      title="Cancel this request?"
      description="This accepted request will no longer move forward. Previous request history will remain available."
      confirmLabel="Cancel Request"
      pendingLabel="Cancelling…"
      action={cancelRequestAction}
      onClose={onClose}
    />
  );
}
