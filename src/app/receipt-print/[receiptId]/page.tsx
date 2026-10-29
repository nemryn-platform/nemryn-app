import { notFound } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getReceipt } from "@/lib/billing/billing";
import { REVERSAL_REASON_LABELS, formatCents, formatInstantDate, formatIsoDate, invoiceNumberLabel, paymentMethodLabel, providerLabel, receiptNumberLabel, type ReversalReasonCode } from "@/lib/billing/billing-core";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { BillingPrintToolbar } from "@/components/billing/BillingPrintToolbar";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Printable payment receipt (NP-BILL-P1 R2 / R4; NP-FIN-P1 RCPT- numbers). Organization Admin of the current workspace;
 * read through billing_get_receipt (organization-scoped, permission catalogue). Lists the invoices the payment was
 * applied to, any payer credit kept, and recorded refunds. A reversed payment says so prominently: a reversal corrects
 * the record -- the payment does not count and the receipt is neither proof of payment nor of a refund.
 */
export default async function ReceiptPrintPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const organization = await requireOrganizationAdminAccess(`/receipt-print/${receiptId}`);
  if (!UUID_RE.test(receiptId)) notFound();
  const r = await getReceipt(organization.organizationId, receiptId);
  if (!r) notFound();
  let business: { phone: string; email: string; address: string } | null = null;
  try {
    const s = await getOrganizationSettings(organization.organizationId);
    business = s ? { phone: s.businessPhone, email: s.businessEmail, address: s.businessAddress } : null;
  } catch {
    business = null;
  }
  const tz = organization.organizationTimezone;
  const applied = r.allocations.filter((a) => !a.unapplied);
  const refunds = r.refunds.filter((f) => !f.reversed);
  const backHref = r.reversal === null && applied.length === 1 ? `/operations/billing/invoices/${applied[0].invoiceId}` : `/operations/billing/receipts/${r.id}`;

  return (
    <main className="mx-auto max-w-[640px] bg-white px-6 py-8 text-black md:my-zw-xl md:rounded-lg md:border md:border-border-subtle md:px-zw-xl md:shadow-panel print:my-0 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none" data-testid="receipt-print" data-reversed={r.reversal ? "true" : "false"}>
      <BillingPrintToolbar backHref={backHref} backLabel={applied.length === 1 && !r.reversal ? "Back to the invoice" : "Back to the payment"} />

      {r.reversal && (
        <div role="note" className="mb-6 border-2 border-black px-4 py-3" data-testid="receipt-print-reversed">
          <p className="text-lg font-bold tracking-wide">PAYMENT REVERSED</p>
          <p className="text-sm">
            This payment was reversed on {formatInstantDate(r.reversal.reversedAt, tz)} ({REVERSAL_REASON_LABELS[r.reversal.reasonCode as ReversalReasonCode] ?? "corrected"}: {r.reversal.reason}) and does
            not count toward any invoice. This receipt is kept for the record only; it is not proof of payment or of a refund.
          </p>
        </div>
      )}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-black/20 pb-4">
        <div className="min-w-0">
          <p className="text-xl font-semibold">{organization.organizationName}</p>
          {business && (
            <div className="text-sm text-black/70">
              {business.address && <p className="whitespace-pre-line">{business.address}</p>}
              {business.phone && <p>{business.phone}</p>}
              {business.email && <p>{business.email}</p>}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Payment receipt</p>
          <h1 className="text-xl font-semibold tabular-nums" data-testid="receipt-print-number">
            {receiptNumberLabel(r.receiptNumber)}
          </h1>
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm" data-testid="receipt-print-details">
        <dt className="text-black/60">Received from</dt>
        <dd>{r.payerName}</dd>
        <dt className="text-black/60">Amount</dt>
        <dd className="text-base font-semibold tabular-nums" data-testid="receipt-print-amount">{formatCents(r.grossCents)}</dd>
        <dt className="text-black/60">Date received</dt>
        <dd>{formatIsoDate(r.receivedOn)}</dd>
        <dt className="text-black/60">Method</dt>
        <dd>
          {paymentMethodLabel(r.method)}
          {providerLabel(r.provider) ? ` via ${providerLabel(r.provider)}` : ""}
        </dd>
        {r.reference && (
          <>
            <dt className="text-black/60">Reference</dt>
            <dd>{r.reference}</dd>
          </>
        )}
        <dt className="text-black/60">Applied to</dt>
        <dd data-testid="receipt-print-applied">
          {applied.length === 0 ? "—" : applied.map((a) => `Payment on ${invoiceNumberLabel(a.invoiceNumber)} · ${formatCents(a.amountCents)}`).join("; ")}
        </dd>
        {!r.reversal && r.unallocatedCents > 0 && (
          <>
            <dt className="text-black/60">Credit kept</dt>
            <dd className="tabular-nums" data-testid="receipt-print-credit">{formatCents(r.unallocatedCents)} (for future invoices)</dd>
          </>
        )}
        {refunds.length > 0 && (
          <>
            <dt className="text-black/60">Refunded</dt>
            <dd data-testid="receipt-print-refunds">{refunds.map((f) => `${formatCents(f.amountCents)} on ${formatIsoDate(f.refundedOn)}`).join("; ")}</dd>
          </>
        )}
      </dl>
      <p className="border-t border-black/20 pt-3 text-sm text-black/70">Recorded manually by {organization.organizationName}. Prices in US dollars.</p>
    </main>
  );
}
