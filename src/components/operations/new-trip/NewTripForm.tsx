"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, Calendar, MapPin, Flag, NotePencil, ClipboardText, Plus, DownloadSimple, X } from "@phosphor-icons/react/dist/ssr";
import { Select } from "@/components/ui/Select";
import { Combobox } from "@/components/ui/Combobox";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { AttentionState } from "@/components/ui/AttentionState";
import { FormSection } from "./FormSection";
import { AddPassengerDialog } from "./AddPassengerDialog";
import { createTripAction, type CreateTripActionState } from "@/app/operations/trips/new/actions";
import { newTripErrorMessage } from "@/lib/operations/new-trip-errors";
import {
  formatFacilityAddress,
  formatFacilityOptionLabel,
  formatRequestOptionLabel,
  type NewTripFacilityOption,
  type NewTripPassengerOption,
  type NewTripRequestOption,
} from "@/lib/operations/new-trip-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: CreateTripActionState = { status: "idle" };

export interface NewTripFormProps {
  passengers: NewTripPassengerOption[];
  facilities: NewTripFacilityOption[];
  requests: NewTripRequestOption[];
  organizationTimezone: string;
}

/**
 * The Internal New Trip form (P1-E3-S7) — a single controlled client
 * component (not several independently-uncontrolled sections) because two
 * real, backend-grounded interactions require programmatic cross-field
 * updates: selecting a Facility populates that side's address snapshot
 * (work item §18), and "Import request details" populates Passenger/
 * pickup/destination/schedule/assistance from a selected TransportationRequest
 * (the real fields the reference's own "Import request details" affordance
 * implies — requester_name/phone/email and a fabricated reference code are
 * NOT imported, since create_trip has no parameter for them — see the data
 * map). All of it still submits as one real `<form>` + Server Action.
 */
export function NewTripForm({ passengers: initialPassengers, facilities, requests, organizationTimezone }: NewTripFormProps) {
  const [state, formAction, pending] = useActionState(createTripAction, INITIAL_STATE);
  const router = useRouter();

  // Second, defense-in-depth double-submit guard (work item §38/§39) beyond
  // `disabled={pending}` on the submit button — create_trip is deliberately
  // non-idempotent (ZD-102), so a race between a fast double-click and
  // React committing the disabled state is closed here explicitly, not
  // merely assumed away.
  const submittedRef = useRef(false);

  const [passengerOptions, setPassengerOptions] = useState(initialPassengers);
  const [passengerId, setPassengerId] = useState("");
  const [addPassengerOpen, setAddPassengerOpen] = useState(false);

  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");

  const [pickupFacilityId, setPickupFacilityId] = useState("");
  const [pickupDescription, setPickupDescription] = useState("");
  const [destinationFacilityId, setDestinationFacilityId] = useState("");
  const [destinationDescription, setDestinationDescription] = useState("");

  const [instructions, setInstructions] = useState("");
  const [assistanceNotes, setAssistanceNotes] = useState("");

  const [requestId, setRequestId] = useState("");
  const selectedRequest = requests.find((r) => r.id === requestId) ?? null;

  useEffect(() => {
    if (state.status === "success" && state.tripId) {
      // Authoritative navigation to the real created Trip (work item §40)
      // — never a fake success page.
      router.push(`/operations/trips/${state.tripId}`);
    }
    if (state.status === "error") {
      submittedRef.current = false;
    }
  }, [state, router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
  }

  function handlePickupFacilityChange(id: string) {
    setPickupFacilityId(id);
    const facility = facilities.find((f) => f.id === id);
    if (facility) setPickupDescription(formatFacilityAddress(facility));
  }

  function handleDestinationFacilityChange(id: string) {
    setDestinationFacilityId(id);
    const facility = facilities.find((f) => f.id === id);
    if (facility) setDestinationDescription(formatFacilityAddress(facility));
  }

  function handleImportRequest() {
    if (!selectedRequest) return;
    setPickupDescription(selectedRequest.pickupDescription);
    setDestinationDescription(selectedRequest.destinationDescription);
    if (selectedRequest.preferredDate) setPickupDate(selectedRequest.preferredDate);
    if (selectedRequest.preferredTime) setPickupTime(selectedRequest.preferredTime.slice(0, 5));
    if (selectedRequest.assistanceNotes) setAssistanceNotes(selectedRequest.assistanceNotes);
    if (selectedRequest.passengerId && passengerOptions.some((p) => p.id === selectedRequest.passengerId)) {
      setPassengerId(selectedRequest.passengerId);
    }
  }

  const selectedPassenger = passengerOptions.find((p) => p.id === passengerId) ?? null;
  const passengerComboboxOptions = passengerOptions.map((p) => ({
    value: p.id,
    label: p.displayName,
    secondaryLabel: p.phone ?? undefined,
  }));
  const facilitySelectOptions = facilities.map((f) => ({ value: f.id, label: formatFacilityOptionLabel(f) }));
  const requestSelectOptions = requests.map((r) => ({ value: r.id, label: formatRequestOptionLabel(r) }));

  // Non-blocking, informational only — purely a same-timezone wall-clock
  // string comparison (no UTC conversion, no DST resolution attempted
  // here); the Server Action re-checks the actual converted instants, and
  // create_trip re-checks again regardless (work item §24).
  const appointmentBeforePickup =
    pickupDate && pickupTime && appointmentDate && appointmentTime
      ? `${appointmentDate}T${appointmentTime}` < `${pickupDate}T${pickupTime}`
      : false;

  return (
    <div className="flex flex-col gap-zw-lg">
      <nav aria-label="Breadcrumb" className={cn(typography.bodySmall, "text-text-muted")}>
        <Link href="/operations/trips" className="hover:text-text-secondary hover:underline">
          Trips
        </Link>
        <span className="mx-2" aria-hidden>
          ›
        </span>
        <span className="text-text-secondary">New Trip</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-zw-md">
        <div>
          <h1 className={cn(typography.pageTitleOperational, "text-text-primary")}>New Trip</h1>
          <p className={cn(typography.body, "mt-1 text-text-secondary")}>Create and coordinate a transportation trip.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/operations" variant="outline">
            Cancel
          </LinkButton>
          <Button type="submit" form="new-trip-form" loading={pending} disabled={pending}>
            {pending ? "Creating…" : "Create Trip"}
          </Button>
        </div>
      </div>

      {state.status === "error" && (
        <p role="alert" className={cn(typography.bodySmall, "rounded-md border border-critical-border bg-critical-bg px-zw-lg py-zw-md text-critical-text")}>
          {newTripErrorMessage(state.errorCode ?? "UNKNOWN")}
        </p>
      )}

      <form id="new-trip-form" action={formAction} onSubmit={handleSubmit} className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
          <FormSection
            icon={<User className="size-5" aria-hidden />}
            title="Passenger"
            action={
              <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setAddPassengerOpen(true)}>
                Add New Passenger
              </Button>
            }
          >
            <input type="hidden" name="passengerId" value={passengerId} />
            {selectedPassenger ? (
              <div className="flex items-center gap-3 rounded-sm border border-selection-border bg-brand-calm-mist/40 px-3 py-2.5">
                <Avatar name={selectedPassenger.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                    {selectedPassenger.displayName}
                  </p>
                  {selectedPassenger.phone && (
                    <p className={cn(typography.metadata, "text-text-muted")}>{selectedPassenger.phone}</p>
                  )}
                </div>
                <IconButton
                  label="Remove selected passenger"
                  icon={<X className="size-4" aria-hidden />}
                  onClick={() => setPassengerId("")}
                />
              </div>
            ) : (
              <Combobox
                label="Passenger"
                required
                placeholder={passengerOptions.length > 0 ? "Search by name or phone number" : "No passengers yet — add one"}
                noResultsText="No passenger matches that search."
                disabled={passengerOptions.length === 0}
                options={passengerComboboxOptions}
                onSelect={(option) => setPassengerId(option.value)}
              />
            )}
          </FormSection>

          <FormSection icon={<Calendar className="size-5" aria-hidden />} title="Trip Schedule">
            <p className={cn(typography.metadata, "text-text-muted")}>
              All times are in the organization&apos;s timezone ({organizationTimezone}).
            </p>
            <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
              <Input label="Pickup Date" name="pickupDate" type="date" required value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
              <Input label="Pickup Time" name="pickupTime" type="time" required value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
              <Input label="Appointment Date" name="appointmentDate" type="date" helpText="Optional" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
              <Input
                label="Appointment Time"
                name="appointmentTime"
                type="time"
                helpText="Optional"
                error={appointmentBeforePickup ? "Appointment is before pickup — double-check this." : undefined}
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
              />
            </div>
          </FormSection>

          <FormSection icon={<MapPin className="size-5" aria-hidden />} title="Pickup">
            <Select
              label="Pickup Facility"
              name="pickupFacilityId"
              placeholder="No facility — manual address"
              helpText="Optional. Selecting a facility fills in its address below — you can still edit it."
              options={facilitySelectOptions}
              value={pickupFacilityId}
              onChange={(e) => handlePickupFacilityChange(e.target.value)}
            />
            <Textarea
              label="Pickup Address"
              name="pickupDescription"
              required
              rows={2}
              placeholder="e.g. 123 Main St, Atlanta, GA"
              value={pickupDescription}
              onChange={(e) => setPickupDescription(e.target.value)}
            />
          </FormSection>

          <FormSection icon={<Flag className="size-5" aria-hidden />} title="Destination">
            <Select
              label="Destination Facility"
              name="destinationFacilityId"
              placeholder="No facility — manual address"
              helpText="Optional. Selecting a facility fills in its address below — you can still edit it."
              options={facilitySelectOptions}
              value={destinationFacilityId}
              onChange={(e) => handleDestinationFacilityChange(e.target.value)}
            />
            <Textarea
              label="Destination Address"
              name="destinationDescription"
              required
              rows={2}
              placeholder="e.g. Emory Dialysis, 456 Clifton Rd, Atlanta, GA"
              value={destinationDescription}
              onChange={(e) => setDestinationDescription(e.target.value)}
            />
          </FormSection>

          <FormSection icon={<NotePencil className="size-5" aria-hidden />} title="Instructions & Assistance">
            <Textarea
              label="Instructions"
              name="instructions"
              helpText="Optional. Shown to the Driver for this trip — e.g. gate codes, entrance notes."
              placeholder="e.g. Call passenger on arrival, use the side entrance."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <Textarea
              label="Assistance Requirements"
              name="assistanceNotes"
              helpText="Optional. This trip's own execution snapshot — not the passenger's saved profile notes."
              placeholder="e.g. Wheelchair accessible vehicle required."
              value={assistanceNotes}
              onChange={(e) => setAssistanceNotes(e.target.value)}
            />
          </FormSection>
        </div>

        <div className="flex flex-col gap-zw-lg">
          <FormSection icon={<ClipboardText className="size-5" aria-hidden />} title="Related Request">
            <Select
              label="Transportation Request"
              name="requestId"
              placeholder="No linked request"
              helpText="Optional. Linking an existing request marks it accepted."
              options={requestSelectOptions}
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              leadingIcon={<DownloadSimple className="size-4" aria-hidden />}
              disabled={!selectedRequest}
              onClick={handleImportRequest}
            >
              Import request details
            </Button>
          </FormSection>

          <AttentionState
            level="info"
            title="Assign a driver after creating this trip"
            description="Trip creation and driver assignment are separate steps — assign a driver and vehicle from Dispatch once this trip is created."
          />
        </div>
      </form>

      {addPassengerOpen && (
        <AddPassengerDialog
          onClose={() => setAddPassengerOpen(false)}
          onCreated={(passenger) => {
            setPassengerOptions((prev) => [...prev, passenger]);
            setPassengerId(passenger.id);
          }}
        />
      )}
    </div>
  );
}
