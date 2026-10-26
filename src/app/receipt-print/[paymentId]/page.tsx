import { notFound } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getInvoice } from "@/lib/billing/billing";
import { formatCents, formatInstantDate, formatIsoDate, invoiceNumberLabel, paymentMethodLabel, receiptNumberLabel } from "@/lib/billing/billing-core";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BillingPrintToolbar } from "@/components/billing/BillingPrintToolbar";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Printable payment receipt (NP-BILL-P1, R2 / R4). Same guard as the printable invoice (Organization Admin of the
 * current workspace; RLS on billing_payments). A reversed payment's receipt says so prominently: a reversal corrects the
 * ledger and the payment does not count toward the invoice -- it is not a refund document.
 */
export default async function ReceiptPrintPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const organization = await requireOrganizationAdminAccess(`/receipt-print/${paymentId}`);
  if (!UUID_RE.test(paymentId)) notFound();
  const supabase = await createServerSupabaseClient();
  const { data: row } = await supabase
    .from("billing_payments")
    .select("invoice_id, entry_kind")
    .eq("organization_id", organization.organizationId)
    .eq("id", paymentId)
    .maybeSingle();
  if (!row || row.entry_kind !== "payment") notFound();
  const inv = await getInvoice(organization.organizationId, row.invoice_id);
  const p = inv?.payments.find((x) => x.id === paymentId);
  if (!inv || !p) notFound();
  let business: { phone: string; email: string; address: string } | null = null;
  try {
    const s = await getOrganizationSettings(organization.organizationId);
    business = s ? { phone: s.businessPhone, email: s.businessEmail, address: s.businessAddress } : null;
  } catch {
    business = null;
  }
  const tz = organization.organizationTimezone;

  return (
    <main className="mx-auto max-w-[640px] bg-white px-6 py-8 text-black md:my-zw-xl md:rounded-lg md:border md:border-border-subtle md:px-zw-xl md:shadow-panel print:my-0 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none" data-testid="receipt-print" data-reversed={p.reversedBy ? "true" : "false"}>
      <BillingPrintToolbar backHref={`/operations/billing/invoices/${inv.id}`} backLabel="Back to the invoice" />

      {p.reversedBy && (
        <div role="note" className="mb-6 border-2 border-black px-4 py-3" data-testid="receipt-print-reversed">
          <p className="text-lg font-bold tracking-wide">PAYMENT REVERSED</p>
          <p className="text-sm">
            This payment was reversed on {formatInstantDate(p.reversedBy.recordedAt, tz)} ({p.reversedBy.reason ?? "corrected"}) and does not count toward
            the invoice. This receipt is kept for the record only; it is not proof of payment or of a refund.
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
            {receiptNumberLabel(inv.invoiceNumber, p.sequence ?? 0)}
          </h1>
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm" data-testid="receipt-print-details">
        <dt className="text-black/60">Received from</dt>
        <dd>{inv.billToName}</dd>
        <dt className="text-black/60">Amount</dt>
        <dd className="text-base font-semibold tabular-nums" data-testid="receipt-print-amount">{formatCents(p.amountCents)}</dd>
        <dt className="text-black/60">Date received</dt>
        <dd>{formatIsoDate(p.receivedOn)}</dd>
        <dt className="text-black/60">Method</dt>
        <dd>{paymentMethodLabel(p.method)}</dd>
        {p.reference && (
          <>
            <dt className="text-black/60">Reference</dt>
            <dd>{p.reference}</dd>
          </>
        )}
        <dt className="text-black/60">For invoice</dt>
        <dd>
          {invoiceNumberLabel(inv.invoiceNumber)} · total {formatCents(inv.totalCents)} · balance now {inv.status === "void" ? "—" : formatCents(inv.balanceCents)}
        </dd>
        <dt className="text-black/60">Passenger</dt>
        <dd>{inv.passengerName}</dd>
      </dl>
      <p className="border-t border-black/20 pt-3 text-sm text-black/70">Recorded manually by {organization.organizationName}. Prices in US dollars.</p>
    </main>
  );
}
