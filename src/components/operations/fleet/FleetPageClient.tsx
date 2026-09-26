"use client";

import { useState } from "react";
import { Car, Plus } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { VehicleFormDialog } from "./VehicleFormDialog";
import type { VehiclesListRow } from "@/lib/operations/vehicles-list";
import type { VehicleAvailabilityOverview } from "@/lib/operations/availability";
import { EquipmentDialog, equipmentSummary } from "./EquipmentDialog";
import { WindowsDialog } from "@/components/operations/availability/WindowsDialog";
import { saveVehicleOutOfServiceAction, deleteVehicleOutOfServiceAction } from "@/app/operations/fleet/actions";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface FleetPageClientProps {
  rows: VehiclesListRow[];
  /** P1-OPS-PROG5B */
  availability: Record<string, VehicleAvailabilityOverview>;
  /** Organization Admin: vehicle create / edit and equipment edits (matching RLS). Dispatcher: read + out-of-service only. */
  isAdmin: boolean;
  timezone: string;
}

/**
 * Client wrapper for Fleet's own Add/Edit affordances (P1-E3-S9, work
 * item §7 — closes GAP-14). The list itself stays server-rendered
 * (`getVehiclesList`, unchanged) — only the interactive "Add Vehicle"
 * button and click-a-row-to-edit dialog live here.
 */
export function FleetPageClient({ rows, availability, isAdmin, timezone }: FleetPageClientProps) {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; vehicle: { id: string; label: string; status: string } } | null>(null);
  const [equipmentFor, setEquipmentFor] = useState<VehiclesListRow | null>(null);
  const [outOfServiceFor, setOutOfServiceFor] = useState<VehiclesListRow | null>(null);

  const columns: DataTableColumn<VehiclesListRow>[] = [
    { key: "label", header: "Vehicle", primary: true, render: (row) => row.label },
    {
      key: "current",
      header: "Current Driver",
      render: (row) => row.currentDriverName ?? <span className="text-text-muted">Unassigned</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge label={row.status === "active" ? "Active" : "Inactive"} category={row.status === "active" ? "positive" : "neutral"} />
      ),
    },
    {
      key: "equipment",
      header: "Equipment",
      render: (row) => (
        <div className="flex flex-col items-start gap-1" data-testid="vehicle-equipment" data-vehicle-id={row.id}>
          <span className={cn(typography.metadata, "text-text-secondary")}>{equipmentSummary(availability[row.id]?.capabilities ?? { wheelchairRamp: null, wheelchairLift: null, wheelchairPositions: null, seatedCapacity: null })}</span>
          <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setEquipmentFor(row); }}>
            {isAdmin ? "Edit equipment" : "View equipment"}
          </Button>
        </div>
      ),
    },
    {
      key: "oos",
      header: "Out of service",
      render: (row) => {
        const count = availability[row.id]?.outOfService.length ?? 0;
        return (
          <div className="flex flex-col items-start gap-1" data-testid="vehicle-out-of-service" data-vehicle-id={row.id}>
            <span className={cn(typography.metadata, count ? "text-text-secondary" : "text-text-muted")}>{count ? `${count} upcoming` : "None recorded"}</span>
            <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setOutOfServiceFor(row); }}>
              Manage
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      {isAdmin && (
        <div className="flex justify-end">
          <Button type="button" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setDialog({ mode: "create" })}>
            Add Vehicle
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={isAdmin ? (row) => setDialog({ mode: "edit", vehicle: { id: row.id, label: row.label, status: row.status } }) : undefined}
        emptyState={
          <EmptyState icon={<Car className="size-8" aria-hidden />} title="No vehicles yet" description="Vehicles in your fleet will appear here." />
        }
      />

      {dialog?.mode === "create" && <VehicleFormDialog mode="create" onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && <VehicleFormDialog mode="edit" vehicle={dialog.vehicle} onClose={() => setDialog(null)} />}
      {equipmentFor && (
        <EquipmentDialog
          vehicleId={equipmentFor.id}
          vehicleLabel={equipmentFor.label}
          capabilities={availability[equipmentFor.id]?.capabilities ?? { wheelchairRamp: null, wheelchairLift: null, wheelchairPositions: null, seatedCapacity: null }}
          canEdit={isAdmin}
          onClose={() => setEquipmentFor(null)}
        />
      )}
      {outOfServiceFor && (
        <WindowsDialog
          title={`Out of service · ${outOfServiceFor.label}`}
          description="When this vehicle shouldn't be used. Timing only -- this is not a maintenance record."
          emptyText="No out-of-service time recorded."
          windows={availability[outOfServiceFor.id]?.outOfService ?? []}
          timezone={timezone}
          onSave={(windowId, input) => saveVehicleOutOfServiceAction(outOfServiceFor.id, windowId, input)}
          onDelete={(windowId) => deleteVehicleOutOfServiceAction(windowId)}
          onClose={() => setOutOfServiceFor(null)}
          testId="out-of-service"
        />
      )}
    </div>
  );
}
