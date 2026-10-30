import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getBillingWriteStatus, listOpenInvoices, listPayers } from "@/lib/billing/billing";
import { BILL_TO_KIND_LABELS, formatCents, todayInTimezone, type BillToKind } from "@/lib/billing/billing-core";
import { BillingWriteNotice } from "@/components/billing/BillingWriteNotice";
import { RecordReceiptForm } from "@/components/billing/ReceiptActions";
import { AttentionState } from "@/components/ui/AttentionState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Record payment received" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Billing -> Record payment received (NP-FIN-P1). Organization Admin only. For money that isn't tied to one invoice:
 * one payment covering several invoices, or a prepayment kept as payer credit. Step 1 chooses the payer -- a party with
 * an organization-scoped identity (from open invoices) or "someone else" (typed, never matched by name); step 2 records
 * the amount and applies it to that payer's invoices, oldest first. The database re-checks everything.
 * NP-FIN-P1G: no form while the organization's financial writes are not enabled.
 */
export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname("/operations/billing/receipts/new"));
  const raw = await searchParams;
  const payerParam = typeof raw.payer === "string" ? raw.payer : "";
  const tz = organization.organizationTimezone;
  const writeStatus = await getBillingWriteStatus(organization.organizationId);
  if (!writeStatus.enabled) {
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader
          title="Record payment received"
          breadcrumb={[{ label: "Billing", href: "/operations/billing?view=receipts" }, { label: "Record payment received" }]}
        />
        <BillingWriteNotice status={writeStatus} />
        <Link href="/operations/billing?view=receipts" className="text-text-link hover:underline">
          Back to payments
        </Link>
      </div>
    );
  }
  const payers = await listPayers(organization.organizationId);
  const options = payers.map((p) => ({ value: `${p.kind}:${p.id}`, label: `${p.name} · ${BILL_TO_KIND_LABELS[p.kind as BillToKind] ?? p.kind}` }));
  const [kind, id = ""] = payerParam.split(":");
  const known = options.some((o) => o.value === payerParam);
  const chosen = known ? payerParam : payerParam === "other" ? "other" : "";
  const header = (
    <PageHeader
      title="Record payment received"
      description="Money you already received that pays several invoices, or that you keep as credit for later rides. Nemryn doesn't charge cards."
      breadcrumb={[{ label: "Billing", href: "/operations/billing?view=receipts" }, { label: "Record payment received" }]}
    />
  );

  if (!chosen) {
    return (
      <div className="flex flex-col gap-zw-lg">
        {header}
        <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="billing-receipt-new-payers">
          <SectionHeader title="Who paid?" description="Payers with open invoices are listed by their record in Nemryn, so their credit is matched by that record, never by name." />
          {payers.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>No payer has an open invoice right now.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {payers.map((p) => (
                <li key={`${p.kind}:${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <Link href={`/operations/billing/receipts/new?payer=${p.kind}:${p.id}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")} data-testid="billing-receipt-new-payer-option">
                    {p.name}
                  </Link>
                  <span className={cn(typography.metadata, "text-text-muted")}>
                    {BILL_TO_KIND_LABELS[p.kind as BillToKind] ?? p.kind} · {p.openInvoiceCount} open · {formatCents(p.balanceCents)} due
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/operations/billing/receipts/new?payer=other" className={cn(typography.bodySmall, "text-text-link hover:underline")} data-testid="billing-receipt-new-payer-other">
            Someone else (type their name)
          </Link>
        </Panel>
      </div>
    );
  }

  const invoices =
    chosen === "other"
      ? await listOpenInvoices(organization.organizationId, { payerKind: "other" })
      : UUID_RE.test(id)
        ? await listOpenInvoices(organization.organizationId, { payerKind: kind, payerId: id })
        : [];
  return (
    <div className="flex flex-col gap-zw-lg">
      {header}
      {chosen === "other" && (
        <AttentionState
          level="info"
          title="Payer not verified"
          description="A typed name isn't linked to a record in Nemryn. Its credit isn't matched to anyone's invoices automatically; applying it needs your confirmation and a reason."
        />
      )}
      <Panel surface="raised" className="flex flex-col gap-zw-md">
        <RecordReceiptForm
          organizationId={organization.organizationId}
          idempotencyKey={`rcpt-${randomUUID()}`}
          today={todayInTimezone(tz)}
          payers={options}
          payer={chosen}
          invoices={invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, billToName: i.billToName, passengerName: i.passengerName, issueDate: i.issueDate, balanceCents: i.balanceCents, version: i.version, samePayer: i.samePayer }))}
        />
      </Panel>
      <Link href="/operations/billing/receipts/new" className={cn(typography.bodySmall, "text-text-link hover:underline")}>
        Choose a different payer
      </Link>
    </div>
  );
}
