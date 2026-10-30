import type { BillingWriteStatus } from "@/lib/billing/billing";
import { AttentionState } from "@/components/ui/AttentionState";

/**
 * NP-FIN-P1G: shown wherever billing write actions would be, when the organization's financial writes are not enabled.
 * Reading stays available; the database refuses every write regardless of what the page shows.
 */
export function BillingWriteNotice({ status }: { status: BillingWriteStatus }) {
  if (status.enabled) return null;
  return (
    <div data-testid="billing-write-disabled">
      {status.known ? (
        <AttentionState
          level="info"
          title="Billing isn't enabled for this workspace yet"
          description="You can view invoices and payments, but creating invoices or recording payments is turned off until Nemryn enables billing for your workspace."
        />
      ) : (
        <AttentionState
          level="warning"
          title="Billing actions are unavailable right now"
          description="Nemryn couldn't confirm that billing is enabled for this workspace, so actions are hidden. Reload the page to try again."
        />
      )}
    </div>
  );
}
