"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** One directory row, already formatted on the server (labels, money, dates). */
export interface QuotesDirectoryRow {
  id: string;
  reference: string;
  kindLabel: string;
  opportunityId: string;
  opportunityTitle: string;
  contactName: string;
  serviceLabel: string;
  amount: string;
  currency: string;
  statusLabel: string;
  statusTone: "neutral" | "informational" | "active" | "positive" | "warning" | "critical" | "completed" | "cancelled";
  storedStatus: string;
  validUntil: string;
  created: string;
}

export const opportunityQuotesHref = (opportunityId: string) => `/operations/growth/pipeline/${opportunityId}#quotes`;

/**
 * Growth -> Estimates & Quotes rows (NP-P2-S5-S3A). Display only: a row opens its opportunity at the Estimates & quotes
 * panel, where the existing draft workflow lives; the reference is also a real link (keyboard / new tab). No quote is
 * created, edited or withdrawn from this table.
 */
export function QuotesDirectoryTable({ rows }: { rows: QuotesDirectoryRow[] }) {
  const router = useRouter();
  const columns: DataTableColumn<QuotesDirectoryRow>[] = [
    {
      key: "reference",
      header: "Reference",
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={opportunityQuotesHref(row.opportunityId)}
            onClick={(e) => e.stopPropagation()}
            className={cn(typography.bodySmall, "font-medium text-text-primary hover:underline")}
            data-testid="quote-directory-link"
          >
            {row.reference}
          </Link>
          <p className={cn(typography.metadata, "text-text-secondary")}>{row.kindLabel}</p>
        </div>
      ),
    },
    {
      key: "opportunity",
      header: "Opportunity",
      render: (row) => (
        <div className={cn(typography.bodySmall, "min-w-0")}>
          <p className="break-words text-text-primary">{row.opportunityTitle}</p>
          <p className={cn(typography.metadata, "text-text-secondary")}>{row.contactName}</p>
        </div>
      ),
    },
    { key: "service", header: "Service", render: (row) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{row.serviceLabel}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <span className={cn(typography.bodySmall, "whitespace-nowrap tabular-nums text-text-primary")}>
          {row.amount} <span className={cn(typography.metadata, "text-text-muted")}>{row.currency}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span data-testid="quote-directory-status" data-status={row.storedStatus}>
          <StatusBadge label={row.statusLabel} category={row.statusTone} />
        </span>
      ),
    },
    { key: "valid", header: "Valid until", render: (row) => <span className={cn(typography.bodySmall, "whitespace-nowrap text-text-secondary")}>{row.validUntil}</span> },
    { key: "created", header: "Created", render: (row) => <span className={cn(typography.bodySmall, "whitespace-nowrap text-text-secondary")}>{row.created}</span> },
  ];
  return (
    <div data-testid="quotes-directory-table">
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} onRowClick={(r) => router.push(opportunityQuotesHref(r.opportunityId))} />
    </div>
  );
}
