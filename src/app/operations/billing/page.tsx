import Link from "next/link";
import { CheckCircle, ClockCountdown, FileText, Receipt, Wallet, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { getBillingSummary, getLedgerSummary, listBillableTrips, listInvoices, listReceipts, type BillableTrip, type BillingSummary, type InvoiceListRow, type LedgerSummary, type ReceiptListRow } from "@/lib/billing/billing";
import {
  BILLING_PAGE_SIZE,
  INVOICE_FILTERS,
  INVOICE_FILTER_LABELS,
  RECEIPT_FILTERS,
  RECEIPT_FILTER_LABELS,
  assuranceLabel,
  assuranceTone,
  billingHref,
  formatCents,
  formatInstantDate,
  formatIsoDate,
  invoiceNumberLabel,
  parseBillingParams,
  paymentMethodLabel,
  paymentStateLabel,
  paymentStateTone,
  receiptNumberLabel,
  receiptState,
  receiptStateLabel,
  receiptStateTone,
} from "@/lib/billing/billing-core";
import { BillableTripsTable, InvoicesTable, ReceiptsTable, type BillableTripRow, type InvoiceRow, type ReceiptRow } from "@/components/billing/BillingTables";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile, StatTileGroup } from "@/components/ui/StatTile";
import { ViewSwitch } from "@/components/ui/ViewSwitch";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Billing" };

function tripRow(t: BillableTrip, tz: string): BillableTripRow {
  const facility = t.destinationFacilityName ?? t.pickupFacilityName;
  return {
    tripId: t.tripId,
    passengerName: t.passengerName,
    date: formatInstantDate(t.completedAt ?? t.scheduledPickupAt, tz),
    route: `${t.pickup} → ${t.destination}`,
    linkedTo: [t.requesterName, facility].filter(Boolean).join(" · ") || "—",
  };
}
function invoiceRow(i: InvoiceListRow): InvoiceRow {
  return {
    id: i.id,
    number: invoiceNumberLabel(i.invoiceNumber),
    billTo: i.billToName,
    passenger: i.passengerName,
    issued: formatIsoDate(i.issueDate),
    due: formatIsoDate(i.dueDate),
    total: formatCents(i.totalCents),
    balance: i.status === "issued" ? formatCents(i.balanceCents) : "—",
    stateLabel: paymentStateLabel(i.paymentState),
    stateTone: paymentStateTone(i.paymentState),
    overdue: i.isOverdue,
  };
}

function receiptRow(r: ReceiptListRow): ReceiptRow {
  const state = receiptState({ grossCents: r.grossCents, allocatedCents: r.allocatedCents, refundedCents: r.refundedCents, reversed: r.reversed });
  return {
    id: r.id,
    number: receiptNumberLabel(r.receiptNumber),
    payer: r.payerName,
    received: formatIsoDate(r.receivedOn),
    method: paymentMethodLabel(r.method),
    amount: formatCents(r.grossCents),
    credit: r.reversed ? "—" : formatCents(r.unallocatedCents),
    hasCredit: !r.reversed && r.unallocatedCents > 0,
    stateLabel: receiptStateLabel(state),
    stateTone: receiptStateTone(state),
    assuranceLabel: assuranceLabel(r.assurance),
    assuranceTone: assuranceTone(r.assurance),
  };
}

/**
 * Administration -> Billing (NP-BILL-P1, Core, D1; NP-FIN-P1 payments received + payer credit). Organization Admins only (D2): the page guard redirects anyone else
 * and every billing RPC re-checks. "Ready to invoice" lists completed trips not on a draft / issued invoice;
 * "Invoices" lists invoices with derived balances. Manual payment recording only -- Nemryn never takes card payments.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname("/operations/billing"));
  const raw = await searchParams;
  const params = parseBillingParams(raw);
  const tz = organization.organizationTimezone;

  const [summaryResult, listResult, settingsResult, ledgerResult] = await Promise.allSettled([
    getBillingSummary(organization.organizationId),
    params.view === "ready"
      ? listBillableTrips(organization.organizationId, { page: params.page })
      : params.view === "receipts"
        ? listReceipts(organization.organizationId, { filter: params.receiptFilter, search: params.search, page: params.page })
        : listInvoices(organization.organizationId, { filter: params.filter, search: params.search, page: params.page }),
    getOrganizationSettings(organization.organizationId),
    getLedgerSummary(organization.organizationId),
  ]);
  const ledger: LedgerSummary | null = ledgerResult.status === "fulfilled" ? ledgerResult.value : null;
  // NP-PILOT-P2: invoices / receipts print the business phone and address only when saved -- say so before invoicing.
  // Unknown (failed read) shows nothing rather than a guess.
  const business = settingsResult.status === "fulfilled" ? settingsResult.value : null;
  const businessDetailsMissing = business !== null && (!business.businessPhone.trim() || !business.businessAddress.trim());
  const summary: BillingSummary | null = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const list = listResult.status === "fulfilled" ? listResult.value : null;
  const pages = list ? Math.max(1, Math.ceil(list.total / BILLING_PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Billing"
        description="Invoice completed private-pay trips and record the payments you receive. Nemryn doesn't take card payments or send invoices; print or save them as PDF."
        breadcrumb={[{ label: "Billing" }]}
        actions={
          <LinkButton href="/operations/billing/receipts/new" variant="outline" data-testid="billing-record-receipt">
            Record payment received
          </LinkButton>
        }
      />
      {businessDetailsMissing && (
        <div data-testid="billing-business-details-missing">
          <AttentionState
            level="info"
            title="Add your business phone and address"
            description="They print on your invoices and receipts so customers know how to reach you. Add them in Settings → Organization."
            action={
              <LinkButton href="/operations/settings/organization" size="sm" variant="outline">
                Add business details
              </LinkButton>
            }
          />
        </div>
      )}
      {raw.discarded === "1" && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-flash">
          Draft discarded. Its trips are ready to invoice again.
        </p>
      )}

      {summary ? (
        <StatTileGroup label="Billing at a glance" testId="billing-summary">
          {[
            <StatTile key="out" label={`outstanding · ${summary.outstandingCount} ${summary.outstandingCount === 1 ? "invoice" : "invoices"}`} value={formatCents(summary.outstandingCents)} icon={<Receipt className="size-5" />} tone="info" />,
            <StatTile key="overdue" label={`overdue · ${summary.overdueCount}`} value={formatCents(summary.overdueCents)} icon={<WarningCircle className="size-5" />} tone={summary.overdueCount > 0 ? "attention" : "neutral"} />,
            <StatTile key="collected" label="collected this month" value={formatCents(summary.collectedThisMonthCents)} icon={<CheckCircle className="size-5" />} tone={summary.collectedThisMonthCents > 0 ? "positive" : "neutral"} />,
            <StatTile key="ready" label={summary.readyTripCount === 1 ? "trip ready to invoice" : "trips ready to invoice"} value={summary.readyTripCount} detail={summary.draftCount > 0 ? `${summary.draftCount} draft ${summary.draftCount === 1 ? "invoice" : "invoices"}` : undefined} icon={<ClockCountdown className="size-5" />} tone="neutral" />,
            ...(ledger
              ? [<StatTile key="credit" label={`payer credit · ${ledger.creditReceiptCount} ${ledger.creditReceiptCount === 1 ? "payment" : "payments"}`} value={formatCents(ledger.creditCents)} icon={<Wallet className="size-5" />} tone={ledger.creditCents > 0 ? "info" : "neutral"} />]
              : []),
          ]}
        </StatTileGroup>
      ) : (
        <AttentionState level="critical" title="Billing totals couldn't be loaded" description="The list below is unaffected. Reload the page to try again." />
      )}

      <ViewSwitch
        label="Billing view"
        activeKey={params.view}
        items={[
          { key: "ready", label: "Ready to invoice", href: billingHref(params, { view: "ready", page: 1 }), count: summary?.readyTripCount ?? null, testId: "billing-view-ready" },
          { key: "invoices", label: "Invoices", href: billingHref(params, { view: "invoices", page: 1 }), testId: "billing-view-invoices" },
          { key: "receipts", label: "Payments received", href: billingHref(params, { view: "receipts", page: 1, search: "" }), testId: "billing-view-receipts" },
        ]}
      />

      {params.view === "receipts" && (
        <div className="flex flex-col gap-zw-md">
          <ViewSwitch
            label="Payment status"
            activeKey={params.receiptFilter}
            items={RECEIPT_FILTERS.map((f) => ({ key: f, label: RECEIPT_FILTER_LABELS[f], href: billingHref(params, { receiptFilter: f, page: 1 }), testId: `billing-rfilter-${f}` }))}
          />
          <form method="get" action="/operations/billing" role="search" className="flex flex-wrap items-end gap-zw-md rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm" data-testid="billing-receipt-search">
            <input type="hidden" name="view" value="receipts" />
            {params.receiptFilter !== "all" && <input type="hidden" name="rfilter" value={params.receiptFilter} />}
            <div className="min-w-0 flex-1 basis-60">
              <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Receipt number or payer" maxLength={100} />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>
      )}

      {params.view === "invoices" && (
        <div className="flex flex-col gap-zw-md">
          <ViewSwitch
            label="Invoice status"
            activeKey={params.filter}
            items={INVOICE_FILTERS.map((f) => ({ key: f, label: INVOICE_FILTER_LABELS[f], href: billingHref(params, { filter: f, page: 1 }), testId: `billing-filter-${f}` }))}
          />
          <form method="get" action="/operations/billing" role="search" className="flex flex-wrap items-end gap-zw-md rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm" data-testid="billing-search">
            <input type="hidden" name="view" value="invoices" />
            {params.filter !== "all" && <input type="hidden" name="filter" value={params.filter} />}
            <div className="min-w-0 flex-1 basis-60">
              <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Invoice number, bill-to or passenger" maxLength={100} />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>
      )}

      {list === null ? (
        <AttentionState
          level="critical"
          title={params.view === "ready" ? "Trips couldn't be loaded" : params.view === "receipts" ? "Payments couldn't be loaded" : "Invoices couldn't be loaded"}
          description="Try again in a moment."
          action={
            <LinkButton href={billingHref(params)} variant="outline" size="sm">
              Retry
            </LinkButton>
          }
        />
      ) : list.rows.length === 0 ? (
        <Panel surface="raised" padding="none" data-testid="billing-empty">
          <EmptyState
            icon={<FileText className="size-6" aria-hidden />}
            title={
              params.view === "ready"
                ? "Nothing to invoice"
                : params.view === "receipts"
                  ? params.search || params.receiptFilter !== "all" ? "No payments match." : "No payments recorded yet"
                  : params.search || params.filter !== "all" ? "No invoices match." : "No invoices yet"
            }
            description={
              params.view === "ready"
                ? "Completed trips appear here until they're on an invoice."
                : params.view === "receipts"
                  ? "Record a payment from an invoice, or use Record payment received for money that isn't tied to one invoice."
                  : "Create an invoice from a completed trip in Ready to invoice."
            }
          />
        </Panel>
      ) : (
        <>
          {params.view === "ready" ? (
            <BillableTripsTable rows={(list.rows as BillableTrip[]).map((t) => tripRow(t, tz))} />
          ) : params.view === "receipts" ? (
            <ReceiptsTable rows={(list.rows as ReceiptListRow[]).map(receiptRow)} />
          ) : (
            <InvoicesTable rows={(list.rows as InvoiceListRow[]).map(invoiceRow)} />
          )}
          <nav aria-label="Billing pages" className="flex flex-wrap items-center justify-between gap-2" data-testid="billing-pagination">
            <p className={cn(typography.metadata, "text-text-muted")}>
              {list.total} {params.view === "ready" ? (list.total === 1 ? "trip" : "trips") : params.view === "receipts" ? (list.total === 1 ? "payment" : "payments") : list.total === 1 ? "invoice" : "invoices"}
              {pages > 1 && ` · page ${Math.min(params.page, pages)} of ${pages}`}
            </p>
            {pages > 1 && (
              <div className="flex gap-3">
                {params.page > 1 && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={billingHref(params, { page: params.page - 1 })}>
                    Previous
                  </Link>
                )}
                {params.page < pages && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={billingHref(params, { page: params.page + 1 })}>
                    Next
                  </Link>
                )}
              </div>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
