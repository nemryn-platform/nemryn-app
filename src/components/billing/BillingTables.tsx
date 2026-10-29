"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { LinkButton } from "@/components/ui/LinkButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface BillableTripRow {
  tripId: string;
  passengerName: string;
  date: string;
  route: string;
  linkedTo: string;
}

/** Billing -> Ready to invoice (NP-BILL-P1): completed trips not yet on a draft or issued invoice. */
export function BillableTripsTable({ rows }: { rows: BillableTripRow[] }) {
  const columns: DataTableColumn<BillableTripRow>[] = [
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (r) => (
        <Link href={`/operations/trips/${r.tripId}`} className={cn(typography.bodySmall, "font-medium text-text-primary hover:underline")}>
          {r.passengerName}
        </Link>
      ),
    },
    { key: "date", header: "Completed", render: (r) => r.date },
    { key: "route", header: "Route", render: (r) => <span className="line-clamp-2">{r.route}</span> },
    { key: "linked", header: "Requested by / facility", render: (r) => r.linkedTo },
    {
      key: "action",
      header: "",
      align: "right",
      render: (r) => (
        <LinkButton href={`/operations/billing/new?trip=${r.tripId}`} size="sm" variant="outline" data-testid="billing-create-invoice">
          Create invoice
        </LinkButton>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.tripId} />;
}

export interface InvoiceRow {
  id: string;
  number: string;
  billTo: string;
  passenger: string;
  issued: string;
  due: string;
  total: string;
  balance: string;
  stateLabel: string;
  stateTone: "neutral" | "informational" | "warning" | "positive" | "cancelled";
  overdue: boolean;
}

/** Billing -> Invoices. The invoice number is the row's one real link (DataTable navigableRows). */
export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      primary: true,
      render: (r) => (
        <Link href={`/operations/billing/invoices/${r.id}`} onClick={(e) => e.stopPropagation()} className={cn(typography.bodySmall, "font-medium tabular-nums text-text-primary hover:underline")} data-testid="billing-invoice-link" data-row-link>
          {r.number}
        </Link>
      ),
    },
    {
      key: "billTo",
      header: "Bill to",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.billTo}</p>
          {r.passenger !== r.billTo && <p className={cn(typography.metadata, "truncate text-text-secondary")}>For {r.passenger}</p>}
        </div>
      ),
    },
    { key: "issued", header: "Issued", render: (r) => r.issued },
    { key: "due", header: "Due", render: (r) => r.due },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="tabular-nums">{r.total}</span> },
    { key: "balance", header: "Balance", align: "right", render: (r) => <span className="tabular-nums">{r.balance}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge label={r.stateLabel} category={r.stateTone} />
          {r.overdue && <StatusBadge label="Overdue" category="critical" />}
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} navigableRows />;
}

export interface ReceiptRow {
  id: string;
  number: string;
  payer: string;
  received: string;
  method: string;
  amount: string;
  credit: string;
  hasCredit: boolean;
  stateLabel: string;
  stateTone: "neutral" | "informational" | "warning" | "positive" | "cancelled";
  assuranceLabel: string;
  assuranceTone: "neutral" | "informational" | "positive";
}

/** Billing -> Payments received (NP-FIN-P1): receipts with what is applied and the payer credit left. */
export function ReceiptsTable({ rows }: { rows: ReceiptRow[] }) {
  const columns: DataTableColumn<ReceiptRow>[] = [
    {
      key: "number",
      header: "Receipt",
      primary: true,
      render: (r) => (
        <Link href={`/operations/billing/receipts/${r.id}`} onClick={(e) => e.stopPropagation()} className={cn(typography.bodySmall, "font-medium tabular-nums text-text-primary hover:underline")} data-testid="billing-receipt-row-link" data-row-link>
          {r.number}
        </Link>
      ),
    },
    { key: "payer", header: "Paid by", render: (r) => <span className="truncate">{r.payer}</span> },
    { key: "received", header: "Received", render: (r) => r.received },
    { key: "method", header: "Method", render: (r) => r.method },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="tabular-nums">{r.amount}</span> },
    { key: "credit", header: "Payer credit", align: "right", render: (r) => <span className={cn("tabular-nums", !r.hasCredit && "text-text-muted")}>{r.credit}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge label={r.stateLabel} category={r.stateTone} />
          <StatusBadge label={r.assuranceLabel} category={r.assuranceTone} />
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} navigableRows />;
}
