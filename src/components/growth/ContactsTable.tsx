"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface ContactsTableRow {
  id: string;
  name: string;
  kind: string;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  channel: string;
  doNotContact: boolean;
  archived: boolean;
  owner: string | null;
}

/** Contacts list rows (NP-P1-S4). A row opens the contact; the name is also a real link (keyboard / new tab). */
export function ContactsTable({ rows }: { rows: ContactsTableRow[] }) {
  const router = useRouter();
  const columns: DataTableColumn<ContactsTableRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/operations/growth/contacts/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(typography.bodySmall, "font-medium text-text-primary hover:underline")}
            data-testid="contact-row-link"
          >
            {row.name}
          </Link>
          <p className={cn(typography.metadata, "text-text-secondary")}>
            {row.kind}
            {row.jobTitle ? ` · ${row.jobTitle}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "reach",
      header: "Phone / email",
      render: (row) => (
        <div className={cn(typography.bodySmall, "min-w-0 text-text-primary")}>
          {row.phone && <p className="whitespace-nowrap">{row.phone}</p>}
          {row.email && <p className="break-all text-text-secondary">{row.email}</p>}
        </div>
      ),
    },
    { key: "channel", header: "Prefers", render: (row) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{row.channel}</span> },
    { key: "owner", header: "Owner", render: (row) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{row.owner ?? "—"}</span> },
    {
      key: "flags",
      header: "Status",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.doNotContact && <StatusBadge label="Do not contact" category="critical" />}
          {row.archived && <StatusBadge label="Archived" category="cancelled" />}
          {!row.doNotContact && !row.archived && <StatusBadge label="Active" category="neutral" />}
        </div>
      ),
    },
  ];
  return (
    <div data-testid="contacts-table">
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/operations/growth/contacts/${r.id}`)} />
    </div>
  );
}
