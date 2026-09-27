"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { AttentionState } from "@/components/ui/AttentionState";
import { TripNotesFields, TripPlaceFields, TripScheduleFields, facilityAddressFor } from "@/components/operations/trip-fields/TripDetailFields";
import { OverlapNotes, overlapUnavailableView } from "@/components/operations/overlap/OverlapNotes";
import { assignmentOverlapAction } from "@/app/operations/dispatch/actions";
import { updateTripDetailsAction, type TripEditResult } from "@/app/operations/trips/[tripId]/actions";
import { isFieldEditable, tripEditBanner } from "@/lib/operations/trip-edit-core";
import { tripEditErrorMessage, type TripEditErrorCode } from "@/lib/operations/trip-edit-errors";
import { wallClockFields } from "@/lib/operations/local-time-core";
import type { NewTripFacilityOption } from "@/lib/operations/new-trip-options";
import type { AssignmentOverlapView } from "@/lib/operations/trip-overlap";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface EditableTrip {
  id: string;
  state: string;
  updatedAt: string;
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  pickupDescription: string;
  pickupFacilityId: string | null;
  destinationDescription: string;
  destinationFacilityId: string | null;
  instructions: string | null;
  assistanceNotes: string | null;
  recurringArrangementId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  expectedDurationMinutes: number | null;
  requiresWheelchairAccess: boolean | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> organization-local { date: YYYY-MM-DD, time: HH:MM } (empty strings when absent). */
function localParts(iso: string | null, timezone: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const f = wallClockFields(new Date(iso), timezone);
  return { date: `${f.year}-${pad(f.month)}-${pad(f.day)}`, time: `${pad(f.hour)}:${pad(f.minute)}` };
}

/**
 * P1-PILOT-R2B (PR-01) Edit Trip -- the shared New Trip field groups, the owner-approved lifecycle matrix (locked
 * fields stay visible, read-only), and the SAME overlap / availability notes as assignment, evaluated at the PROPOSED
 * time for the current driver / vehicle (advisory only: Save stays enabled). The trip is never unassigned or
 * reassigned here; duration and wheelchair requirement keep their own panels.
 */
export function EditTripDialog({
  trip,
  facilities,
  organizationTimezone,
  onClose,
  onSaved,
}: {
  trip: EditableTrip;
  facilities: NewTripFacilityOption[];
  organizationTimezone: string;
  onClose: () => void;
  onSaved: (result: Extract<TripEditResult, { ok: true }>) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialPickup = localParts(trip.scheduledPickupAt, organizationTimezone);
  const initialAppointment = localParts(trip.appointmentAt, organizationTimezone);
  const [pickupDate, setPickupDate] = useState(initialPickup.date);
  const [pickupTime, setPickupTime] = useState(initialPickup.time);
  const [appointmentDate, setAppointmentDate] = useState(initialAppointment.date);
  const [appointmentTime, setAppointmentTime] = useState(initialAppointment.time);
  const [pickupFacilityId, setPickupFacilityId] = useState(trip.pickupFacilityId ?? "");
  const [pickupDescription, setPickupDescription] = useState(trip.pickupDescription);
  const [destinationFacilityId, setDestinationFacilityId] = useState(trip.destinationFacilityId ?? "");
  const [destinationDescription, setDestinationDescription] = useState(trip.destinationDescription);
  const [instructions, setInstructions] = useState(trip.instructions ?? "");
  const [assistanceNotes, setAssistanceNotes] = useState(trip.assistanceNotes ?? "");
  const [error, setError] = useState<TripEditErrorCode | null>(null);
  const [noChange, setNoChange] = useState(false);

  const can = (field: Parameters<typeof isFieldEditable>[1]) => isFieldEditable(trip.state, field);
  const hasPickup = trip.scheduledPickupAt !== null;
  // The pickup DATE is fixed for an en-route trip (driver already travelling for that date) and for a recurring
  // occurrence (its identity). The time may still change where the lifecycle allows it.
  const dateFixedReason =
    hasPickup && trip.recurringArrangementId
      ? "A recurring trip keeps its date."
      : hasPickup && trip.state === "en_route_to_pickup"
        ? "The pickup date can't change once the driver is on the way."
        : null;
  const pickupLocked = !can("scheduled_pickup_at") ? "Locked — the driver has arrived at pickup." : null;
  const assistanceLocked = !can("assistance_notes") && can("instructions") ? "Assistance is locked — the passenger is on board." : null;
  const banner = tripEditBanner(trip.state);

  // Overlap / availability preview for the CURRENT assignment at the PROPOSED time (same engine as assignment).
  const [overlap, setOverlap] = useState<{ key: string; view: AssignmentOverlapView | null } | null>(null);
  const target =
    pickupDate && (trip.driverId || trip.vehicleId)
      ? {
          kind: "date" as const,
          dateKey: pickupDate,
          pickupTime: pickupTime || null,
          expectedDurationMinutes: trip.expectedDurationMinutes,
          requiresWheelchairAccess: trip.requiresWheelchairAccess,
          tripId: trip.id,
        }
      : null;
  const overlapKey = JSON.stringify([target, trip.driverId, trip.vehicleId]);
  useEffect(() => {
    if (!target) return;
    let ignore = false;
    const key = overlapKey;
    const timer = setTimeout(() => {
      assignmentOverlapAction(target, trip.driverId, trip.vehicleId).then(
        (view) => {
          if (!ignore) setOverlap({ key, view });
        },
        () => {
          if (!ignore) setOverlap({ key, view: overlapUnavailableView(Boolean(trip.driverId), Boolean(trip.vehicleId)) });
        },
      );
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
    // overlapKey captures target / driver / vehicle by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlapKey]);
  const currentOverlap = overlap && overlap.key === overlapKey ? overlap.view : null;

  function save() {
    setError(null);
    setNoChange(false);
    startTransition(async () => {
      const result = await updateTripDetailsAction({
        tripId: trip.id,
        expectedUpdatedAt: trip.updatedAt,
        pickupDate,
        pickupTime,
        appointmentDate,
        appointmentTime,
        pickupDescription,
        pickupFacilityId,
        destinationDescription,
        destinationFacilityId,
        instructions,
        assistanceNotes,
      });
      if (!result.ok) {
        setError(result.code);
        return;
      }
      if (!result.changed) {
        setNoChange(true);
        return;
      }
      router.refresh();
      onSaved(result);
    });
  }

  return (
    <Dialog open onClose={onClose} title="Edit trip" description="Correct this trip's schedule, addresses and notes.">
      <div className="flex flex-col gap-zw-md" data-testid="edit-trip-form">
        {banner && (
          <p className={cn(typography.bodySmall, "rounded-sm border border-border-subtle bg-surface-secondary px-3 py-2 text-text-secondary")} data-testid="edit-trip-banner">
            {banner}
          </p>
        )}
        <TripScheduleFields
          organizationTimezone={organizationTimezone}
          pickupDate={pickupDate}
          pickupTime={pickupTime}
          appointmentDate={appointmentDate}
          appointmentTime={appointmentTime}
          onPickupDateChange={setPickupDate}
          onPickupTimeChange={setPickupTime}
          onAppointmentDateChange={setAppointmentDate}
          onAppointmentTimeChange={setAppointmentTime}
          pickupDateDisabled={pending || !can("scheduled_pickup_at") || dateFixedReason !== null}
          pickupTimeDisabled={pending || !can("scheduled_pickup_at")}
          appointmentDisabled={pending || !can("appointment_at")}
          pickupLockedNote={pickupLocked ?? (can("scheduled_pickup_at") ? dateFixedReason : null)}
          appointmentLockedNote={!can("appointment_at") ? "Locked at this stage." : null}
        />
        <TripPlaceFields
          kind="pickup"
          facilities={facilities}
          facilityId={pickupFacilityId}
          description={pickupDescription}
          onFacilityChange={(id) => {
            setPickupFacilityId(id);
            const address = facilityAddressFor(facilities, id);
            if (address) setPickupDescription(address);
          }}
          onDescriptionChange={setPickupDescription}
          disabled={pending || !can("pickup_description")}
        />
        <TripPlaceFields
          kind="destination"
          facilities={facilities}
          facilityId={destinationFacilityId}
          description={destinationDescription}
          onFacilityChange={(id) => {
            setDestinationFacilityId(id);
            const address = facilityAddressFor(facilities, id);
            if (address) setDestinationDescription(address);
          }}
          onDescriptionChange={setDestinationDescription}
          disabled={pending || !can("destination_description")}
        />
        <TripNotesFields
          instructions={instructions}
          assistanceNotes={assistanceNotes}
          onInstructionsChange={setInstructions}
          onAssistanceNotesChange={setAssistanceNotes}
          instructionsDisabled={pending || !can("instructions")}
          assistanceDisabled={pending || !can("assistance_notes")}
          assistanceLockedNote={assistanceLocked}
        />
        {(trip.driverId || trip.vehicleId) && <OverlapNotes view={currentOverlap} />}
        {error && (
          <AttentionState
            level={error === "STALE" ? "warning" : "critical"}
            title={error === "STALE" ? "This trip changed" : "Couldn't save the changes"}
            description={tripEditErrorMessage(error)}
            action={
              error === "STALE" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    router.refresh();
                    onClose();
                  }}
                >
                  Refresh
                </Button>
              ) : undefined
            }
          />
        )}
        {noChange && <p className={cn(typography.bodySmall, "text-text-muted")} data-testid="edit-trip-no-change">No changes to save.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={pending} disabled={pending}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
