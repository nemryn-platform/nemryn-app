"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatFacilityAddress, formatFacilityOptionLabel, type NewTripFacilityOption } from "@/lib/operations/new-trip-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Shared Trip detail field groups (P1-PILOT-R2B): the SAME controls, names, labels, help text and client-side hints
 * for New Trip and Edit Trip -- one field implementation, never a divergent second form. Server Actions + the
 * database (create_trip / update_trip_details) remain the validation authority.
 */

/** Plain wall-clock string comparison (no UTC conversion); the server re-checks the converted instants. */
export function isAppointmentBeforePickup(pickupDate: string, pickupTime: string, appointmentDate: string, appointmentTime: string): boolean {
  return pickupDate && pickupTime && appointmentDate && appointmentTime ? `${appointmentDate}T${appointmentTime}` < `${pickupDate}T${pickupTime}` : false;
}

/** Selecting a facility fills that side's address snapshot (still editable). */
export function facilityAddressFor(facilities: NewTripFacilityOption[], id: string): string | null {
  const facility = facilities.find((f) => f.id === id);
  return facility ? formatFacilityAddress(facility) : null;
}

export function facilitySelectOptions(facilities: NewTripFacilityOption[]) {
  return facilities.map((f) => ({ value: f.id, label: formatFacilityOptionLabel(f) }));
}

function LockedNote({ text }: { text: string | null | undefined }) {
  return text ? <p className={cn(typography.metadata, "text-text-muted")}>{text}</p> : null;
}

export function TripScheduleFields({
  organizationTimezone,
  pickupDate,
  pickupTime,
  appointmentDate,
  appointmentTime,
  onPickupDateChange,
  onPickupTimeChange,
  onAppointmentDateChange,
  onAppointmentTimeChange,
  pickupDateDisabled = false,
  pickupTimeDisabled = false,
  appointmentDisabled = false,
  pickupLockedNote,
  appointmentLockedNote,
  pickupDateHelp,
}: {
  organizationTimezone: string;
  pickupDate: string;
  pickupTime: string;
  appointmentDate: string;
  appointmentTime: string;
  onPickupDateChange: (v: string) => void;
  onPickupTimeChange: (v: string) => void;
  onAppointmentDateChange: (v: string) => void;
  onAppointmentTimeChange: (v: string) => void;
  pickupDateDisabled?: boolean;
  pickupTimeDisabled?: boolean;
  appointmentDisabled?: boolean;
  pickupLockedNote?: string | null;
  appointmentLockedNote?: string | null;
  pickupDateHelp?: string;
}) {
  const appointmentBeforePickup = isAppointmentBeforePickup(pickupDate, pickupTime, appointmentDate, appointmentTime);
  return (
    <>
      <p className={cn(typography.metadata, "text-text-muted")}>All times are in the organization&apos;s timezone ({organizationTimezone}).</p>
      <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
        <Input label="Pickup Date" name="pickupDate" type="date" required value={pickupDate} onChange={(e) => onPickupDateChange(e.target.value)} disabled={pickupDateDisabled} helpText={pickupDateHelp} />
        <Input label="Pickup Time" name="pickupTime" type="time" required value={pickupTime} onChange={(e) => onPickupTimeChange(e.target.value)} disabled={pickupTimeDisabled} />
        <Input label="Appointment Date" name="appointmentDate" type="date" helpText="Optional" value={appointmentDate} onChange={(e) => onAppointmentDateChange(e.target.value)} disabled={appointmentDisabled} />
        <Input
          label="Appointment Time"
          name="appointmentTime"
          type="time"
          helpText="Optional"
          error={appointmentBeforePickup ? "Appointment is before pickup — double-check this." : undefined}
          value={appointmentTime}
          onChange={(e) => onAppointmentTimeChange(e.target.value)}
          disabled={appointmentDisabled}
        />
      </div>
      <LockedNote text={pickupLockedNote} />
      <LockedNote text={appointmentLockedNote} />
    </>
  );
}

export function TripPlaceFields({
  kind,
  facilities,
  facilityId,
  description,
  onFacilityChange,
  onDescriptionChange,
  disabled = false,
  lockedNote,
}: {
  kind: "pickup" | "destination";
  facilities: NewTripFacilityOption[];
  facilityId: string;
  description: string;
  /** Receives the facility id; callers fill the address via `facilityAddressFor`. */
  onFacilityChange: (id: string) => void;
  onDescriptionChange: (v: string) => void;
  disabled?: boolean;
  lockedNote?: string | null;
}) {
  const isPickup = kind === "pickup";
  return (
    <>
      <Select
        label={isPickup ? "Pickup Facility" : "Destination Facility"}
        name={isPickup ? "pickupFacilityId" : "destinationFacilityId"}
        placeholder="No facility — manual address"
        helpText="Optional. Selecting a facility fills in its address below — you can still edit it."
        options={facilitySelectOptions(facilities)}
        value={facilityId}
        onChange={(e) => onFacilityChange(e.target.value)}
        disabled={disabled}
      />
      <Textarea
        label={isPickup ? "Pickup Address" : "Destination Address"}
        name={isPickup ? "pickupDescription" : "destinationDescription"}
        required
        rows={2}
        placeholder={isPickup ? "e.g. 123 Main St, Atlanta, GA" : "e.g. Emory Dialysis, 456 Clifton Rd, Atlanta, GA"}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        disabled={disabled}
      />
      <LockedNote text={lockedNote} />
    </>
  );
}

export function TripNotesFields({
  instructions,
  assistanceNotes,
  onInstructionsChange,
  onAssistanceNotesChange,
  instructionsDisabled = false,
  assistanceDisabled = false,
  assistanceLockedNote,
}: {
  instructions: string;
  assistanceNotes: string;
  onInstructionsChange: (v: string) => void;
  onAssistanceNotesChange: (v: string) => void;
  instructionsDisabled?: boolean;
  assistanceDisabled?: boolean;
  assistanceLockedNote?: string | null;
}) {
  return (
    <>
      <Textarea
        label="Instructions"
        name="instructions"
        helpText="Optional. Shown to the Driver for this trip — e.g. gate codes, entrance notes."
        placeholder="e.g. Call passenger on arrival, use the side entrance."
        value={instructions}
        onChange={(e) => onInstructionsChange(e.target.value)}
        disabled={instructionsDisabled}
      />
      <Textarea
        label="Assistance Requirements"
        name="assistanceNotes"
        helpText="Optional. This trip's own execution snapshot — not the passenger's saved profile notes."
        placeholder="e.g. Wheelchair accessible vehicle required."
        value={assistanceNotes}
        onChange={(e) => onAssistanceNotesChange(e.target.value)}
        disabled={assistanceDisabled}
      />
      <LockedNote text={assistanceLockedNote} />
    </>
  );
}
