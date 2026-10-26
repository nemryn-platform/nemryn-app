import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getInvoice } from "@/lib/billing/billing";
import { formatCents, formatIsoDate, invoiceNumberLabel, paymentMethodLabel, receiptNumberLabel } from "@/lib/billing/billing-core";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { BillingPrintToolbar } from "@/components/billing/BillingPrintToolbar";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Invoice", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Printable invoice (NP-BILL-P1, R4). Outside /operations (no shell) but behind the same guard as Billing: a signed-in
 * Organization Admin of the CURRENT workspace (requireOrganizationAdminAccess); the invoice is read through the RPC on
 * the per-request client, so unknown / foreign ids are the same 404. No public link, token, email or share action.
 * Drafts are not printable (they are not invoices yet).
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const organization = await requireOrganizationAdminAccess(`/invoice-print/${invoiceId}`);
  if (!UUID_RE.test(invoiceId)) notFound();
  const inv = await getInvoice(organization.organizationId, invoiceId);
  if (!inv) notFound();
  if (inv.status === "draft") redirect(`/operations/billing/invoices/${inv.id}`);
  let business: { phone: string; email: string; address: string } | null = null;
  try {
    const s = await getOrganizationSettings(organization.organizationId);
    business = s ? { phone: s.businessPhone, email: s.businessEmail, address: s.businessAddress } : null;
  } catch {
    business = null;
  }
  const payments = inv.payments.filter((p) => p.entryKind === "payment");

  return (
    <main className="mx-auto max-w-[800px] bg-white px-6 py-8 text-black md:my-zw-xl md:rounded-lg md:border md:border-border-subtle md:px-zw-xl md:shadow-panel print:my-0 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none" data-testid="invoice-print" data-status={inv.status}>
      <BillingPrintToolbar backHref={`/operations/billing/invoices/${inv.id}`} backLabel="Back to the invoice" />

      {inv.status === "void" && (
        <div role="note" className="mb-6 border-2 border-black px-4 py-3" data-testid="invoice-print-void">
          <p className="text-lg font-bold tracking-wide">VOID</p>
          <p className="text-sm">This invoice was voided and is not payable. Reason: {inv.voidReason}</p>
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
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Invoice</p>
          <h1 className="text-2xl font-semibold tabular-nums" data-testid="invoice-print-number">
            {invoiceNumberLabel(inv.invoiceNumber)}
          </h1>
          <p className="text-sm">Issued {formatIsoDate(inv.issueDate)}</p>
          <p className="text-sm font-medium">Due {formatIsoDate(inv.dueDate)}</p>
        </div>
      </header>

      <section className="mb-6 grid gap-4 sm:grid-cols-2" aria-label="Bill to">
        <div>
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Bill to</p>
          <p className="text-base font-medium" data-testid="invoice-print-billto">{inv.billToName}</p>
          {inv.billToAddress && <p className="whitespace-pre-line text-sm">{inv.billToAddress}</p>}
          {inv.billToPhone && <p className="text-sm">{inv.billToPhone}</p>}
          {inv.billToEmail && <p className="text-sm">{inv.billToEmail}</p>}
        </div>
        <div>
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Passenger</p>
          <p className="text-base">{inv.passengerName}</p>
        </div>
      </section>

      <table className="mb-6 w-full border-collapse text-sm" data-testid="invoice-print-lines">
        <thead>
          <tr>
            <th scope="col" className="border-b-2 border-black/60 py-1 text-left font-semibold">Description</th>
            <th scope="col" className="border-b-2 border-black/60 py-1 pl-4 text-right font-semibold">Qty</th>
            <th scope="col" className="border-b-2 border-black/60 py-1 pl-4 text-right font-semibold">Price</th>
            <th scope="col" className="border-b-2 border-black/60 py-1 pl-4 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="break-inside-avoid border-b border-black/15">
              <td className="py-1 pr-2">{l.description}</td>
              <td className="py-1 pl-4 text-right tabular-nums">{Number(l.quantity)}</td>
              <td className="py-1 pl-4 text-right tabular-nums">{formatCents(l.unitCents)}</td>
              <td className="py-1 pl-4 text-right tabular-nums">{formatCents(l.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-2 text-right">Subtotal</td>
            <td className="pt-2 pl-4 text-right tabular-nums">{formatCents(inv.subtotalCents)}</td>
          </tr>
          {inv.discountCents > 0 && (
            <tr>
              <td colSpan={3} className="text-right">Discount</td>
              <td className="pl-4 text-right tabular-nums">−{formatCents(inv.discountCents)}</td>
            </tr>
          )}
          <tr>
            <th scope="row" colSpan={3} className="pt-1 text-right text-base font-semibold">Total (USD)</th>
            <td className="pt-1 pl-4 text-right text-base font-semibold tabular-nums" data-testid="invoice-print-total">{formatCents(inv.totalCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="text-right">Paid</td>
            <td className="pl-4 text-right tabular-nums">{formatCents(inv.paidCents)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={3} className="text-right font-semibold">Balance due</th>
            <td className="pl-4 text-right font-semibold tabular-nums" data-testid="invoice-print-balance">{inv.status === "void" ? "—" : formatCents(inv.balanceCents)}</td>
          </tr>
        </tfoot>
      </table>

      {payments.length > 0 && (
        <section className="mb-6 break-inside-avoid" aria-label="Payments" data-testid="invoice-print-payments">
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Payments</p>
          <ul className="text-sm">
            {payments.map((p) => (
              <li key={p.id}>
                {formatIsoDate(p.receivedOn)} · {paymentMethodLabel(p.method)} · {formatCents(p.amountCents)} · receipt {receiptNumberLabel(inv.invoiceNumber, p.sequence ?? 0)}
                {p.reversedBy ? ` · REVERSED (${p.reversedBy.reason ?? "corrected"}) — not counted` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inv.termsNote && (
        <section className="mb-6 break-inside-avoid" aria-label="Terms">
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Terms</p>
          <p className="whitespace-pre-wrap break-words text-sm">{inv.termsNote}</p>
        </section>
      )}
      <p className="border-t border-black/20 pt-3 text-sm text-black/70">Prices in US dollars. Please include the invoice number with your payment.</p>
    </main>
  );
}
