import Link from "next/link";
import { Receipt } from "@phosphor-icons/react/dist/ssr";
import type { TripBillingStatus } from "@/lib/billing/billing";
import { formatCents, invoiceNumberLabel, paymentStateLabel, paymentStateTone } from "@/lib/billing/billing-core";
import { LinkButton } from "@/components/ui/LinkButton";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Trip Detail -> Billing (NP-BILL-P1). Rendered only for Organization Admins on a COMPLETED trip (the page decides);
 * billing_trip_status re-checks. Either the invoice the trip is on, or "Create invoice". Nothing else on Trip Detail
 * changes, and the trip itself is never modified by billing.
 */
export function TripBillingPanel({ tripId, status }: { tripId: string; status: TripBillingStatus | null }) {
  return (
    <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="trip-billing-panel">
      <SectionHeader title="Billing" icon={<Receipt />} />
      {status === null ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>Billing status couldn&apos;t be loaded. Reload the page to try again.</p>
      ) : status.invoiceId ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/operations/billing/invoices/${status.invoiceId}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")} data-testid="trip-billing-invoice">
            {invoiceNumberLabel(status.invoiceNumber)}
          </Link>
          <div className="flex items-center gap-2">
            {status.status === "issued" && status.balanceCents !== null && status.balanceCents > 0 && (
              <span className={cn(typography.metadata, "tabular-nums text-text-secondary")}>Balance {formatCents(status.balanceCents)}</span>
            )}
            <StatusBadge label={paymentStateLabel(status.paymentState ?? "draft")} category={paymentStateTone(status.paymentState ?? "draft")} />
          </div>
        </div>
      ) : status.billable ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Not invoiced yet.</p>
          <LinkButton href={`/operations/billing/new?trip=${tripId}`} size="sm" variant="outline" data-testid="trip-billing-create">
            Create invoice
          </LinkButton>
        </div>
      ) : (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>This trip can&apos;t be invoiced.</p>
      )}
    </Panel>
  );
}
