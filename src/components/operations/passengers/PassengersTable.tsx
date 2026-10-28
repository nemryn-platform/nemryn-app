"use client";

import { useState } from "react";
import { UsersThree } from "@phosphor-icons/react/dist/ssr";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { GettingStartedLink } from "@/components/operations/GettingStartedLink";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EditPassengerDialog } from "./EditPassengerDialog";
import type { PassengersListRow } from "@/lib/operations/passengers-list";

export interface PassengersTableProps {
  rows: PassengersListRow[];
  search: string;
}

/** Row-click-to-edit wrapper (P1-E3-S9, work item §9). List rendering unchanged from P1-E3-S8B1. */
export function PassengersTable({ rows, search }: PassengersTableProps) {
  const [editing, setEditing] = useState<PassengersListRow | null>(null);

  const columns: DataTableColumn<PassengersListRow>[] = [
    { key: "name", header: "Name", primary: true, render: (row) => row.displayName },
    { key: "phone", header: "Phone", render: (row) => row.phone ?? <span className="text-text-muted">Not on file</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge label={row.status === "active" ? "Active" : "Inactive"} category={row.status === "active" ? "positive" : "neutral"} />,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => setEditing(row)}
        rowActionLabel={() => "Edit"}
        emptyState={
          <EmptyState
            icon={<UsersThree className="size-8" aria-hidden />}
            title={search ? "No passengers match that search" : "No passengers yet"}
            description={search ? "Try a different name or phone number." : "Passengers you add will appear here."}
            action={search ? undefined : <GettingStartedLink />}
          />
        }
      />
      {editing && <EditPassengerDialog passenger={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
