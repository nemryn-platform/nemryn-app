"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface InquiriesTableRow {
  id: string;
  name: string;
  reach: string;
  received: string;
  topic: string;
  service: string;
  statusLabel: string;
  statusTone: "informational" | "positive" | "neutral";
  statusNote: string | null;
}

/**
 * Growth -> Inquiries list (NP-P2-S7-C). The whole row opens the inquiry through DataTable's navigableRows (the
 * Contacts / Estimates & Quotes / Requests pattern): the person's name is the row's one real link (tab stop, Enter).
 */
export function InquiriesTable({ rows }: { rows: InquiriesTableRow[] }) {
  const columns: DataTableColumn<InquiriesTableRow>[] = [
    {
      key: "name",
      header: "From",
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/operations/growth/inquiries/${r.id}`} onClick={(e) => e.stopPropagation()} className={cn(typography.bodySmall, "font-medium text-text-primary hover:underline")} data-testid="inquiry-row-link" data-row-link>
            {r.name}
          </Link>
          <p className={cn(typography.metadata, "text-text-secondary")}>{r.reach}</p>
        </div>
      ),
    },
    { key: "topic", header: "About", render: (r) => r.topic },
    { key: "service", header: "Service", render: (r) => r.service },
    { key: "received", header: "Received", render: (r) => r.received },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge label={r.statusLabel} category={r.statusTone} />
          {r.statusNote && <span className={cn(typography.metadata, "text-text-muted")}>{r.statusNote}</span>}
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} navigableRows />;
}
