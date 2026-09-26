import { Select } from "@/components/ui/Select";
import type { TriState } from "@/lib/operations/capability-core";

export const WHEELCHAIR_REQUIREMENT_OPTIONS: { value: TriState; label: string }[] = [
  { value: "unspecified", label: "Not specified" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * P1-OPS-PROG5B -- the one tri-state "Wheelchair transport equipment needed?" control (New Trip, Recurring Care,
 * Trip Detail). Submits "yes" | "no" | "unspecified" (stored as true / false / NULL). Factual copy only: it is used to
 * compare against a vehicle's RECORDED equipment, never a certification claim, and never inferred from notes.
 */
export function WheelchairRequirementField({
  name = "requiresWheelchairAccess",
  value,
  onChange,
  disabled,
  helpText = "Used to check whether the assigned vehicle has recorded wheelchair transport equipment.",
}: {
  name?: string;
  value: TriState;
  onChange: (value: TriState) => void;
  disabled?: boolean;
  helpText?: string;
}) {
  return (
    <Select
      label="Wheelchair transport equipment needed?"
      name={name}
      options={WHEELCHAIR_REQUIREMENT_OPTIONS}
      value={value}
      onChange={(event) => onChange(event.target.value as TriState)}
      helpText={helpText}
      disabled={disabled}
      data-testid="wheelchair-requirement"
    />
  );
}
