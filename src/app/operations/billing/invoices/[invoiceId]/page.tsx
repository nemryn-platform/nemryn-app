import Link from "next/link";
import { notFound } from "next/navigation";
import { CurrencyDollar, FileText, Path, Receipt, User } from "@phosphor-icons/react/dist/ssr";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getBillingWriteStatus, getInvoice, listInvoiceCreditSources } from "@/lib/billing/billing";
import {
  ASSURANCE_EXPLANATION,
  BILL_TO_KIND_LABELS,
  assuranceLabel,
  assuranceTone,
  centsToInput,
  formatCents,
  formatInstantDate,
  formatIsoDate,
  invoiceNumberLabel,
  paymentMethodLabel,
  paymentStateLabel,
  paymentStateTone,
  providerLabel,
  receiptNumberLabel,
  todayInTimezone,
  type BillToKind,
} from "@/lib/billing/billing-core";
import { DiscardDraftButton, InvoiceDraftEditor, IssueInvoicePanel } from "@/components/billing/InvoiceDraftEditor";
import { IssuedInvoiceActions, ReversePaymentButton, UnapplyPaymentButton } from "@/components/billing/InvoiceActions";
import { BillingWriteNotice } from "@/components/billing/BillingWriteNotice";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Invoice" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Billing -> Invoice (NP-BILL-P1). Organization Admin only; billing_get_invoice re-checks (unknown / foreign -> 404).
 * Draft: edit bill-to, charges, discount, terms; issue or discard. Issued: frozen charges, record / reverse payments,
 * void while nothing is paid, print the invoice and per-payment receipts. Void: read-only history.
 * NP-FIN-P1G: while the organization's financial writes are not enabled the page is read-only (a draft shows its saved
 * contents; no actions). The database refuses the writes regardless.
 */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { invoiceId } = await params;
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname(`/operations/billing/invoices/${invoiceId}`));
  if (!UUID_RE.test(invoiceId)) notFound();
  const inv = await getInvoice(organization.organizationId, invoiceId);
  if (!inv) notFound();
  const query = await searchParams;
  const tz = organization.organizationTimezone;
  const today = todayInTimezone(tz);
  const shared = { organizationId: organization.organizationId, invoiceId: inv.id, version: inv.version };
  const isDraft = inv.status === "draft";
  const writeStatus = await getBillingWriteStatus(organization.organizationId);
  const canWrite = writeStatus.enabled;
  // NP-FIN-P1: the same payer's unapplied money (authoritative identity only), offered as "Apply payer credit"
  const creditSources = canWrite && inv.status === "issued" && inv.balanceCents > 0 ? await listInvoiceCreditSources(organization.organizationId, inv.id) : [];
  const tripLabel = (tripId: string | null) => {
    const t = inv.trips.find((x) => x.tripId === tripId);
    return t ? `Trip ${formatInstantDate(t.scheduledPickupAt ?? t.completedAt, tz)}` : "";
  };

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={isDraft ? "Draft invoice" : invoiceNumberLabel(inv.invoiceNumber)}
        description={`${inv.billToName}${inv.billToName !== inv.passengerName ? ` · for ${inv.passengerName}` : ""}`}
        breadcrumb={[{ label: "Billing", href: "/operations/billing?view=invoices" }, { label: isDraft ? "Draft invoice" : invoiceNumberLabel(inv.invoiceNumber) }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isDraft && (
              <LinkButton href={`/invoice-print/${inv.id}`} variant="outline" data-testid="billing-print-invoice">
                Print invoice
              </LinkButton>
            )}
            {canWrite && inv.status === "issued" && <IssuedInvoiceActions shared={shared} balanceCents={inv.balanceCents} paidCents={inv.paidCents} today={today} creditSources={creditSources} />}
            {canWrite && isDraft && <DiscardDraftButton {...shared} />}
          </div>
        }
      />
      <BillingWriteNotice status={writeStatus} />
      {query.created === "1" && isDraft && canWrite && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-created">
          Draft created. Check the charges and prices, save, then issue the invoice.
        </p>
      )}
      {inv.status === "void" && (
        <AttentionState level="info" title="This invoice is void" description={`Voided ${formatInstantDate(inv.voidedAt, tz)}. Reason: ${inv.voidReason ?? "—"}. Its trips can be invoiced again.`} />
      )}

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-invoice-summary">
        <SectionHeader
          title="Summary"
          icon={<CurrencyDollar />}
          tone="accent"
          actions={
            <div className="flex flex-wrap gap-1">
              <StatusBadge label={paymentStateLabel(inv.paymentState)} category={paymentStateTone(inv.paymentState)} />
              {inv.isOverdue && <StatusBadge label="Overdue" category="critical" />}
            </div>
          }
        />
        <DefinitionList
          columns={2}
          items={[
            { label: "Total", value: <span className="tabular-nums">{formatCents(inv.totalCents)}</span> },
            { label: "Balance due", value: <span className="tabular-nums" data-testid="billing-balance">{inv.status === "issued" ? formatCents(inv.balanceCents) : "—"}</span> },
            { label: "Paid", value: <span className="tabular-nums">{formatCents(inv.paidCents)}</span> },
            { label: "Issued / due", value: isDraft ? "Not issued yet" : `${formatIsoDate(inv.issueDate)} · due ${formatIsoDate(inv.dueDate)}` },
            ...(inv.sourceQuoteNumber !== null
              ? [{ label: "Prices from", value: `${inv.sourceQuoteKind === "estimate" ? "Estimate" : "Quote"} ${inv.sourceQuoteNumber} (copied onto this invoice)` }]
              : []),
          ]}
        />
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-invoice-trips">
        <SectionHeader title="Trips" icon={<Path />} description="Completed trips this invoice bills. A trip can be on only one invoice." />
        <ul className="divide-y divide-border-subtle">
          {inv.trips.map((t) => (
            <li key={t.tripId} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <Link href={`/operations/trips/${t.tripId}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                {formatInstantDate(t.scheduledPickupAt ?? t.completedAt, tz)}
              </Link>
              <span className={cn(typography.bodySmall, "min-w-0 text-text-secondary")}>
                {t.pickup} → {t.destination}
                {t.released ? " · released (invoice void)" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {isDraft && canWrite ? (
        <>
          <Panel surface="raised" className="flex flex-col gap-zw-md">
            <SectionHeader title="Bill to and charges" icon={<FileText />} description={`Billing: ${BILL_TO_KIND_LABELS[inv.billToKind as BillToKind] ?? inv.billToKind}. Prices are entered by you; nothing is sent to anyone.`} />
            <InvoiceDraftEditor
              organizationId={organization.organizationId}
              invoiceId={inv.id}
              version={inv.version}
              billTo={{ name: inv.billToName, address: inv.billToAddress ?? "", email: inv.billToEmail ?? "", phone: inv.billToPhone ?? "" }}
              lines={inv.lines.map((l) => ({ key: l.id, description: l.description, quantity: l.quantity, unitPrice: centsToInput(l.unitCents), tripId: l.tripId, source: l.source }))}
              discount={inv.discountCents > 0 ? centsToInput(inv.discountCents) : ""}
              terms={inv.termsNote ?? ""}
              tripOptions={inv.trips.map((t) => ({ id: t.tripId, label: tripLabel(t.tripId) }))}
            />
          </Panel>
          <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-issue-panel">
            <SectionHeader title="Issue" icon={<Receipt />} description="Issuing assigns the next invoice number and freezes the invoice." />
            <IssueInvoicePanel organizationId={organization.organizationId} invoiceId={inv.id} version={inv.version} today={today} canIssue={inv.lines.length > 0 && inv.totalCents > 0} />
          </Panel>
        </>
      ) : (
        <>
          <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-invoice-billto">
            <SectionHeader title="Bill to" icon={<User />} />
            <DefinitionList
              columns={2}
              items={[
                { label: "Name", value: inv.billToName },
                { label: "Type", value: BILL_TO_KIND_LABELS[inv.billToKind as BillToKind] ?? inv.billToKind },
                { label: "Address", value: inv.billToAddress ? <span className="whitespace-pre-line">{inv.billToAddress}</span> : "—" },
                { label: "Phone / email", value: [inv.billToPhone, inv.billToEmail].filter(Boolean).join(" · ") || "—" },
              ]}
            />
          </Panel>
          <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-invoice-lines">
            <SectionHeader title="Charges" icon={<FileText />} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-secondary">
                    <th scope="col" className="py-2 font-medium">Description</th>
                    <th scope="col" className="py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="py-2 text-right font-medium">Price</th>
                    <th scope="col" className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border-subtle">
                      <td className="py-2">
                        {l.description}
                        {l.tripId && <span className={cn(typography.metadata, "block text-text-muted")}>{tripLabel(l.tripId)}</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCents(l.unitCents)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCents(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {inv.discountCents > 0 && (
                    <tr>
                      <td colSpan={3} className="pt-2 text-right text-text-secondary">Discount</td>
                      <td className="pt-2 text-right tabular-nums">−{formatCents(inv.discountCents)}</td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row" colSpan={3} className="pt-2 text-right font-semibold">Total</th>
                    <td className="pt-2 text-right font-semibold tabular-nums">{formatCents(inv.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {inv.termsNote && <p className={cn(typography.bodySmall, "whitespace-pre-wrap text-text-secondary")}>{inv.termsNote}</p>}
          </Panel>
          <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-invoice-payments">
            <SectionHeader
              title="Payments"
              icon={<Receipt />}
              description="Money your team recorded as received and applied to this invoice. Corrections are added as new entries; nothing is deleted."
            />
            {inv.payments.length === 0 ? (
              <p className={cn(typography.bodySmall, "text-text-secondary")}>No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {inv.payments.map((p) => {
                  const counted = !p.unapplied && !p.receiptReversed;
                  const label = `${formatCents(p.amountCents)} received ${formatIsoDate(p.receivedOn)} (${paymentMethodLabel(p.method)})`;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid="billing-payment-row" data-kind="payment" data-counted={counted ? "true" : "false"}>
                      <div className="min-w-0">
                        <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                          {formatCents(p.amountCents)} · {paymentMethodLabel(p.method)}
                          {providerLabel(p.provider) ? ` via ${providerLabel(p.provider)}` : ""}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </p>
                        <p className={cn(typography.metadata, "text-text-muted")}>
                          Received {formatIsoDate(p.receivedOn)} · {receiptNumberLabel(p.receiptNumber)}
                          {p.note ? ` · ${p.note}` : ""}
                          {p.receiptReversed ? ` · reversed ${formatInstantDate(p.receiptReversedAt, tz)}: ${p.receiptReversalReason ?? ""}` : ""}
                          {p.unapplied && !p.receiptReversed ? ` · removed from this invoice: ${p.unapplyReason ?? ""}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.receiptReversed && <StatusBadge label="Reversed" category="cancelled" />}
                        {p.unapplied && !p.receiptReversed && <StatusBadge label="Removed" category="cancelled" />}
                        {p.differentPayer && <StatusBadge label="Other payer" category="warning" />}
                        {counted && <StatusBadge label={assuranceLabel(p.assurance)} category={assuranceTone(p.assurance)} />}
                        <Link href={`/operations/billing/receipts/${p.receiptId}`} className={cn(typography.bodySmall, "text-text-link hover:underline")} data-testid="billing-receipt-page-link">
                          Payment
                        </Link>
                        <Link href={`/receipt-print/${p.receiptId}`} className={cn(typography.bodySmall, "text-text-link hover:underline")} data-testid="billing-receipt-link">
                          Receipt
                        </Link>
                        {canWrite && counted && inv.status === "issued" && p.simplePayment && <ReversePaymentButton shared={shared} payment={{ id: p.id, label }} />}
                        {canWrite && counted && inv.status === "issued" && <UnapplyPaymentButton shared={shared} payment={{ id: p.id, label }} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={cn(typography.metadata, "text-text-muted")}>{ASSURANCE_EXPLANATION}</p>
          </Panel>
        </>
      )}
    </div>
  );
}
