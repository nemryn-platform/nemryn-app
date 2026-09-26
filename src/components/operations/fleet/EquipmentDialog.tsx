"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { saveVehicleCapabilitiesAction } from "@/app/operations/fleet/actions";
import type { VehicleCapabilities } from "@/lib/operations/capability-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const YES_NO_UNKNOWN = [
  { value: "", label: "Not recorded" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const toSelect = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");
const fromSelect = (v: string) => (v === "yes" ? true : v === "no" ? false : null);
const toText = (v: number | null) => (v === null ? "" : String(v));

export function equipmentSummary(c: VehicleCapabilities): string {
  const parts: string[] = [];
  if (c.wheelchairRamp === true) parts.push("Ramp");
  if (c.wheelchairLift === true) parts.push("Lift");
  if (c.wheelchairPositions !== null) parts.push(`${c.wheelchairPositions} wheelchair position${c.wheelchairPositions === 1 ? "" : "s"}`);
  if (c.seatedCapacity !== null) parts.push(`${c.seatedCapacity} seat${c.seatedCapacity === 1 ? "" : "s"}`);
  if (c.wheelchairRamp === false && c.wheelchairLift === false) parts.push("No ramp or lift");
  return parts.length > 0 ? parts.join(" · ") : "Not recorded";
}

/**
 * P1-OPS-PROG5B -- "Equipment on this vehicle": RECORDED facts only (ramp, lift, wheelchair positions, seats), each of
 * which can stay "Not recorded". Organization Admin edits (set_vehicle_capabilities re-checks); a Dispatcher sees the
 * same facts read-only. No certification / compliance wording anywhere.
 */
export function EquipmentDialog({
  vehicleId,
  vehicleLabel,
  capabilities,
  canEdit,
  onClose,
}: {
  vehicleId: string;
  vehicleLabel: string;
  capabilities: VehicleCapabilities;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ramp, setRamp] = useState(toSelect(capabilities.wheelchairRamp));
  const [lift, setLift] = useState(toSelect(capabilities.wheelchairLift));
  const [positions, setPositions] = useState(toText(capabilities.wheelchairPositions));
  const [seats, setSeats] = useState(toText(capabilities.seatedCapacity));
  const num = (v: string) => (v.trim() === "" ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

  return (
    <Dialog open onClose={onClose} title={`Equipment on this vehicle · ${vehicleLabel}`} description="Recorded equipment facts. Used to check trips that need wheelchair transport equipment.">
      <form
        className="flex flex-col gap-zw-md"
        data-testid="equipment-form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = num(positions);
          const s = num(seats);
          if (Number.isNaN(p) || Number.isNaN(s)) {
            setError("Use whole numbers, or leave a field empty if it isn't recorded.");
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await saveVehicleCapabilitiesAction(vehicleId, { wheelchairRamp: fromSelect(ramp), wheelchairLift: fromSelect(lift), wheelchairPositions: p, seatedCapacity: s });
            if (result.ok) {
              router.refresh();
              onClose();
            } else {
              setError(result.message);
            }
          });
        }}
      >
        <div className="grid grid-cols-1 gap-zw-sm sm:grid-cols-2">
          <Select label="Wheelchair ramp" name="wheelchairRamp" options={YES_NO_UNKNOWN} value={ramp} onChange={(e) => setRamp(e.target.value)} disabled={!canEdit || pending} />
          <Select label="Wheelchair lift" name="wheelchairLift" options={YES_NO_UNKNOWN} value={lift} onChange={(e) => setLift(e.target.value)} disabled={!canEdit || pending} />
          <Input label="Wheelchair positions" name="wheelchairPositions" type="number" min={0} max={20} inputMode="numeric" placeholder="Not recorded" value={positions} onChange={(e) => setPositions(e.target.value)} disabled={!canEdit || pending} />
          <Input label="Seated passenger capacity" name="seatedCapacity" type="number" min={0} max={60} inputMode="numeric" placeholder="Not recorded" value={seats} onChange={(e) => setSeats(e.target.value)} disabled={!canEdit || pending} />
        </div>
        {!canEdit && <p className={cn(typography.metadata, "text-text-muted")}>Only an organization admin can change recorded equipment.</p>}
        {error && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button type="submit" loading={pending} disabled={pending}>
              Save
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
