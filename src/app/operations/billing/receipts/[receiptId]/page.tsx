import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowCounterClockwise, CurrencyDollar, Receipt, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getReceipt, listOpenInvoices } from "@/lib/billing/billing";
import {
  ASSURANCE_EXPLANATION,
  REVERSAL_REASON_LABELS,
  assuranceLabel,
  assuranceTone,
  formatCents,
  formatInstantDate,
  formatIsoDate,
  invoiceNumberLabel,
  paymentMethodLabel,
  providerLabel,
  receiptNumberLabel,
  receiptState,
  receiptStateLabel,
  receiptStateTone,
  todayInTimezone,
  type ReversalReasonCode,
} from "@/lib/billing/billing-core";
import { AddEvidenceButton, ApplyCreditButton, RefundButton, ReverseReceiptButton, ReverseRefundButton } from "@/components/billing/ReceiptActions";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Payment" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYER_KIND_LABELS: Record<string, string> = { passenger: "Passenger", requester: "Person who requested the ride", facility: "Facility", other: "Someone else (not verified)" };

/**
 * Billing -> Payment (NP-FIN-P1). Organization Admin only; billing_get_receipt re-checks (unknown / foreign -> 404).
 * One receipt = money received: where it was applied, the payer credit left, refunds recorded from it, and its
 * assurance facts (recorded / evidence -- never "provider confirmed" from a typed reference). Corrections are new
 * entries (unapply, refund correction, reversal); nothing is edited or deleted.
 */
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ receiptId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { receiptId } = await params;
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname(`/operations/billing/receipts/${receiptId}`));
  if (!UUID_RE.test(receiptId)) notFound();
  const r = await getReceipt(organization.organizationId, receiptId);
  if (!r) notFound();
  const query = await searchParams;
  const tz = organization.organizationTimezone;
  const today = todayInTimezone(tz);
  const reversed = r.reversal !== null;
  const state = receiptState({ grossCents: r.grossCents, allocatedCents: r.allocatedCents, refundedCents: r.refundedCents, reversed });
  const open = !reversed && r.unallocatedCents > 0 ? await listOpenInvoices(organization.organizationId, { receiptId: r.id }) : [];
  const invoices = open.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, billToName: i.billToName, passengerName: i.passengerName, issueDate: i.issueDate, balanceCents: i.balanceCents, version: i.version, samePayer: i.samePayer }));
  const activeRefunds = r.refunds.filter((f) => !f.reversed);
  const reverseBlocked = reversed
    ? "Already reversed."
    : r.allocatedCents !== 0
      ? "Remove it from its invoices first."
      : activeRefunds.length > 0
        ? "Correct its refunds first."
        : null;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={receiptNumberLabel(r.receiptNumber)}
        description={`Paid by ${r.payerName} · ${formatCents(r.grossCents)} received ${formatIsoDate(r.receivedOn)}`}
        breadcrumb={[{ label: "Billing", href: "/operations/billing?view=receipts" }, { label: receiptNumberLabel(r.receiptNumber) }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={`/receipt-print/${r.id}`} variant="outline" data-testid="billing-receipt-print">
              Print receipt
            </LinkButton>
            {!reversed && <ApplyCreditButton organizationId={organization.organizationId} receiptId={r.id} availableCents={r.unallocatedCents} invoices={invoices} />}
            {!reversed && <RefundButton organizationId={organization.organizationId} receiptId={r.id} refundableCents={r.unallocatedCents} today={today} receivedOn={r.receivedOn} />}
            <ReverseReceiptButton organizationId={organization.organizationId} receiptId={r.id} disabledReason={reverseBlocked} />
          </div>
        }
      />
      {query.recorded === "1" && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-receipt-recorded">
          Payment recorded{r.unallocatedCents > 0 ? `. ${formatCents(r.unallocatedCents)} is kept as payer credit.` : "."}
        </p>
      )}
      {reversed && r.reversal && (
        <AttentionState
          level="info"
          title="This payment was reversed"
          description={`${REVERSAL_REASON_LABELS[r.reversal.reasonCode as ReversalReasonCode] ?? r.reversal.reasonCode} on ${formatInstantDate(r.reversal.reversedAt, tz)}: ${r.reversal.reason}. It doesn't count toward any invoice and isn't a refund.`}
        />
      )}

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-receipt-summary">
        <SectionHeader
          title="Summary"
          icon={<CurrencyDollar />}
          tone="accent"
          actions={
            <div className="flex flex-wrap gap-1">
              <StatusBadge label={receiptStateLabel(state)} category={receiptStateTone(state)} />
              <StatusBadge label={assuranceLabel(r.assurance)} category={assuranceTone(r.assurance)} />
            </div>
          }
        />
        <DefinitionList
          columns={2}
          items={[
            { label: "Amount received", value: <span className="tabular-nums">{formatCents(r.grossCents)}</span> },
            { label: "Payer credit (not applied)", value: <span className="tabular-nums" data-testid="billing-receipt-credit">{reversed ? "—" : formatCents(r.unallocatedCents)}</span> },
            { label: "Applied to invoices", value: <span className="tabular-nums">{formatCents(r.allocatedCents)}</span> },
            { label: "Refunded (recorded)", value: <span className="tabular-nums">{formatCents(r.refundedCents)}</span> },
            { label: "Paid by", value: `${r.payerName} · ${PAYER_KIND_LABELS[r.payerKind] ?? r.payerKind}` },
            { label: "Method", value: `${paymentMethodLabel(r.method)}${providerLabel(r.provider) ? ` via ${providerLabel(r.provider)}` : ""}` },
            { label: "Reference", value: r.reference ?? "—" },
            { label: "Processing fee (your cost)", value: r.feeCents > 0 ? <span className="tabular-nums">{formatCents(r.feeCents)} · net {formatCents(r.netCents)}</span> : "—" },
            ...(r.note ? [{ label: "Note", value: <span className="whitespace-pre-wrap">{r.note}</span> }] : []),
          ]}
        />
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-receipt-allocations">
        <SectionHeader title="Applied to" icon={<Receipt />} description="Each invoice this payment pays. Removing it from an invoice keeps the money as payer credit." />
        {r.allocations.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Not applied to any invoice yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {r.allocations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid="billing-receipt-allocation" data-unapplied={a.unapplied ? "true" : "false"}>
                <div className="min-w-0">
                  <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                    <Link href={`/operations/billing/invoices/${a.invoiceId}`} className="text-text-link hover:underline">
                      {invoiceNumberLabel(a.invoiceNumber)}
                    </Link>{" "}
                    · {formatCents(a.amountCents)}
                  </p>
                  <p className={cn(typography.metadata, "text-text-muted")}>
                    Applied {formatInstantDate(a.createdAt, tz)}
                    {a.differentPayer ? ` · other payer, confirmed: ${a.differentPayerReason ?? ""}` : ""}
                    {a.unapplied ? ` · removed ${formatInstantDate(a.unappliedAt, tz)}: ${a.unapplyReason ?? ""}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.unapplied && <StatusBadge label="Removed" category="cancelled" />}
                  {a.differentPayer && <StatusBadge label="Other payer" category="warning" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-receipt-refunds">
        <SectionHeader title="Refunds" icon={<ArrowCounterClockwise />} description="Refunds your team recorded from this payment's unapplied money. Recording a refund doesn't send money." />
        {r.refunds.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No refunds recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {r.refunds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid="billing-receipt-refund" data-reversed={f.reversed ? "true" : "false"}>
                <div className="min-w-0">
                  <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                    {formatCents(f.amountCents)} · {paymentMethodLabel(f.method)}
                    {providerLabel(f.provider) ? ` via ${providerLabel(f.provider)}` : ""}
                    {f.reference ? ` · ${f.reference}` : ""}
                  </p>
                  <p className={cn(typography.metadata, "text-text-muted")}>
                    Refunded {formatIsoDate(f.refundedOn)} · {f.reason}
                    {f.reversed ? ` · corrected ${formatInstantDate(f.reversedAt, tz)}: ${f.reversalReason ?? ""}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {f.reversed ? <StatusBadge label="Corrected" category="cancelled" /> : <StatusBadge label={assuranceLabel(f.assurance)} category={assuranceTone(f.assurance)} />}
                  {!f.reversed && !reversed && (
                    <ReverseRefundButton organizationId={organization.organizationId} receiptId={r.id} refundId={f.id} label={`${formatCents(f.amountCents)} refunded ${formatIsoDate(f.refundedOn)}`} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-receipt-assurance">
        <SectionHeader title="Verification" icon={<ShieldCheck />} description={ASSURANCE_EXPLANATION} />
        <ul className="flex flex-col gap-1" data-testid="billing-receipt-events">
          <li className={cn(typography.bodySmall, "text-text-secondary")}>Recorded by staff {formatInstantDate(r.recordedAt, tz)}</li>
          {r.events.map((e) => (
            <li key={`${e.kind}-${e.occurredAt}`} className={cn(typography.bodySmall, "text-text-secondary")}>
              {assuranceLabel(e.kind)} · {formatInstantDate(e.occurredAt, tz)}
            </li>
          ))}
        </ul>
        {!reversed && !r.events.some((e) => e.kind === "evidence_document_held") && <AddEvidenceButton organizationId={organization.organizationId} receiptId={r.id} />}
        <p className={cn(typography.metadata, "text-text-muted")}>Provider confirmation and bank reconciliation are added only by a provider connection or a statement match; they can&apos;t be entered by hand.</p>
      </Panel>
    </div>
  );
}
