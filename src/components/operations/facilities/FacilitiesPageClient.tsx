"use client";

import { useState } from "react";
import { Buildings, Plus } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FacilityFormDialog } from "./FacilityFormDialog";
import type { FacilitiesListRow } from "@/lib/operations/facilities-list";

export interface FacilitiesPageClientProps {
  rows: FacilitiesListRow[];
}

export function FacilitiesPageClient({ rows }: FacilitiesPageClientProps) {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; facility: FacilitiesListRow } | null>(null);

  const columns: DataTableColumn<FacilitiesListRow>[] = [
    { key: "name", header: "Name", primary: true, render: (row) => row.name },
    {
      key: "location",
      header: "Location",
      render: (row) => [row.city, row.state].filter(Boolean).join(", ") || <span className="text-text-muted">Not on file</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge label={row.status === "active" ? "Active" : "Inactive"} category={row.status === "active" ? "positive" : "neutral"} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      {/* NP-UI-P2: one page header with the page's primary action (moved from a separate row above the table). */}
      <PageHeader
        title="Facilities"
        description="Clinics and other referring locations your trips connect to."
        actions={
          <Button type="button" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setDialog({ mode: "create" })}>
            Add Facility
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => setDialog({ mode: "edit", facility: row })}
        rowActionLabel={() => "Edit"}
        emptyState={
          <EmptyState
            icon={<Buildings className="size-8" aria-hidden />}
            title="No facilities yet"
            description="Facilities linked to your trips will appear here."
          />
        }
      />

      {dialog?.mode === "create" && <FacilityFormDialog mode="create" onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && (
        <FacilityFormDialog
          mode="edit"
          facility={{ ...dialog.facility }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
