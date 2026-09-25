"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, Calendar, MapPin, Flag, NotePencil, ClipboardText, Plus, DownloadSimple, X, SteeringWheel, Clock } from "@phosphor-icons/react/dist/ssr";
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
import { AssignmentFields } from "@/components/operations/dispatch/AssignmentFields";
import type { AssignmentOptions } from "@/lib/operations/assignment-context";
import { deriveAssignmentDefaults } from "@/lib/operations/assignment-defaults-core";
import { createTripNoticeParam } from "@/lib/operations/readiness-actions-core";
import { formatDurationMinutes } from "@/lib/operations/trip-overlap-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: CreateTripActionState = { status: "idle" };

export interface NewTripFormProps {
  passengers: NewTripPassengerOption[];
  facilities: NewTripFacilityOption[];
  requests: NewTripRequestOption[];
  organizationTimezone: string;
  /** P1-E1-S2F-B1 §14 — a validated, already-eligible Request id reached via `?requestId=`, or null for ordinary direct-Trip mode. */
  preselectedRequestId: string | null;
  /** P1-E1-S2F-B1 §13 — true when `?requestId=` was supplied but did not resolve to an eligible Request in this organization (malformed, nonexistent, foreign-org, or currently ineligible — never distinguished). */
  requestUnavailable: boolean;
  /** P1-OPS-PROG2 "Assign now" options (active drivers/vehicles), or null when they could not be loaded. */
  assignmentOptions: AssignmentOptions | null;
  operatorDriverId: string | null;
  canManageDriverSetup: boolean;
  /** P1-OPS-PROG4: the organization's optional default trip duration (placeholder only; null = no default). */
  defaultTripDurationMinutes: number | null;
}

/**
 * The Internal New Trip form (P1-E3-S7) — a single controlled client
 * component (not several independently-uncontrolled sections) because two
 * real, backend-grounded interactions require programmatic cross-field
 * updates: selecting a Facility populates that side's address snapshot
 * (work item §18), and "Import request details" populates
 * pickup/destination/schedule/assistance from a selected TransportationRequest
 * (the real fields the reference's own "Import request details" affordance
 * implies — requester_name/phone/email and a fabricated reference code are
 * NOT imported, since create_trip has no parameter for them — see the data
 * map). All of it still submits as one real `<form>` + Server Action.
 *
 * P1-E1-S2F-B1 §4/§7: when a Request is selected (manually, or via
 * `preselectedRequestId`), the Passenger is DERIVED from that Request,
 * never independently editable — `effectivePassengerId` below is the
 * SINGLE source of truth actually submitted, computed fresh on every
 * render from whichever mode is active, so it can never drift from a
 * selected Request's own resolved Passenger. Clearing the Request
 * (§8) deliberately resets the manual Passenger selection back to
 * empty, rather than silently retaining the Request-derived Passenger
 * as though the operator had chosen them directly.
 */
export function NewTripForm({
  passengers: initialPassengers,
  facilities,
  requests,
  organizationTimezone,
  preselectedRequestId,
  requestUnavailable,
  assignmentOptions,
  operatorDriverId,
  canManageDriverSetup,
  defaultTripDurationMinutes,
}: NewTripFormProps) {
  const [state, formAction, pending] = useActionState(createTripAction, INITIAL_STATE);
  const router = useRouter();

  // Second, defense-in-depth double-submit guard (work item §38/§39) beyond
  // `disabled={pending}` on the submit button — create_trip is deliberately
  // non-idempotent (ZD-102), so a race between a fast double-click and
  // React committing the disabled state is closed here explicitly, not
  // merely assumed away.
  const submittedRef = useRef(false);

  // P1-E1-S2F-B1 §14: a preselected, already-eligible Request (Request
  // Detail's own "Create Trip"/"Create Another Trip" action) should
  // automatically initialize the form from that Request's own details —
  // the SAME field mapping "Import request details" already supports,
  // never a new/invented mapping. Resolved once, here, as a plain
  // value (not a hook) so every initial-state lazy initializer below
  // can read it without an effect — calling several setState functions
  // synchronously inside a mount effect is exactly what the "populate
  // from a prop once" pattern is for lazy useState initializers, not
  // useEffect (react-hooks/set-state-in-effect).
  const preselectedRequest = preselectedRequestId ? (requests.find((r) => r.id === preselectedRequestId) ?? null) : null;

  const [passengerOptions, setPassengerOptions] = useState(initialPassengers);
  // Used ONLY in direct-Trip mode (no Request selected) — while a
  // Request is selected, this is never read for submission (§7); it is
  // still reset (never left stale) on deselection (§8).
  const [manualPassengerId, setManualPassengerId] = useState("");
  const [addPassengerOpen, setAddPassengerOpen] = useState(false);

  const [pickupDate, setPickupDate] = useState(() => preselectedRequest?.preferredDate ?? "");
  const [pickupTime, setPickupTime] = useState(() => preselectedRequest?.preferredTime?.slice(0, 5) ?? "");
  const [appointmentDate, setAppointmentDate] = useState("");
  // P1-OPS-PROG4: empty = not entered (create_trip snapshots the organization default, or the duration stays
  // unknown); a value is this trip's own duration. The default is shown as a placeholder, never pre-typed, so an
  // untouched default is recorded honestly as "organization default".
  const [expectedDuration, setExpectedDuration] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");

  const [pickupFacilityId, setPickupFacilityId] = useState("");
  const [pickupDescription, setPickupDescription] = useState(() => preselectedRequest?.pickupDescription ?? "");
  const [destinationFacilityId, setDestinationFacilityId] = useState("");
  const [destinationDescription, setDestinationDescription] = useState(() => preselectedRequest?.destinationDescription ?? "");

  const [instructions, setInstructions] = useState("");
  const [assistanceNotes, setAssistanceNotes] = useState(() => preselectedRequest?.assistanceNotes ?? "");

  // P1-OPS-PROG2: "Assign now" is OFF by default -- the operator opts in.
  // Inside it, Driver/Vehicle follow the PROG1 prefill rules (only-option
  // prefill, "(you)" ordering). Nothing is assigned until Create Trip.
  const [assignNow, setAssignNow] = useState(false);

  const [requestId, setRequestId] = useState(preselectedRequestId ?? "");
  const selectedRequest = requests.find((r) => r.id === requestId) ?? null;
  // The ONE value ever actually submitted for passengerId — always
  // derived fresh from whichever mode is active, never a separately
  // maintained piece of state that could fall out of sync (§7).
  const effectivePassengerId = selectedRequest ? selectedRequest.passengerId : manualPassengerId;

  // Still used by the MANUAL "Import request details" button (§9) —
  // preserved unchanged as a real click-time state update, never
  // attempting any local→UTC schedule conversion here (the real
  // organization-timezone conversion happens once, server-side, in
  // createTripAction, unchanged).
  function importRequestDetails(request: NewTripRequestOption) {
    setPickupDescription(request.pickupDescription);
    setDestinationDescription(request.destinationDescription);
    if (request.preferredDate) setPickupDate(request.preferredDate);
    if (request.preferredTime) setPickupTime(request.preferredTime.slice(0, 5));
    if (request.assistanceNotes) setAssistanceNotes(request.assistanceNotes);
  }

  useEffect(() => {
    if (state.status === "success" && state.tripId) {
      // Authoritative navigation to the real created Trip (work item §40)
      // — never a fake success page. P1-OPS-PROG2: the "Assign now"
      // outcome travels as a display-only notice; a failed assignment is a
      // PARTIAL success -- the Trip exists, and Trip Detail is where the
      // assignment can be completed. submittedRef stays set, so this form
      // can never submit (and create) a second Trip.
      const notice = createTripNoticeParam(state.assignment ?? "not_requested");
      const query = notice
        ? `?created=${notice}${state.assignment === "failed" ? `&reason=${state.assignmentErrorCode ?? "UNKNOWN"}` : ""}`
        : "";
      router.push(`/operations/trips/${state.tripId}${query}`);
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

  // P1-E1-S2F-B1 §9: manual Request selection preserves the EXISTING
  // two-step "select, then click Import request details" behavior
  // unchanged (only §14's preselection route auto-imports) — this
  // handler's own job is solely the Passenger-binding side: clearing
  // the Request (§8) deliberately resets manualPassengerId back to
  // empty, so a Request-derived Passenger is never silently retained
  // as though manually chosen.
  function handleRequestChange(id: string) {
    setRequestId(id);
    if (id === "") {
      setManualPassengerId("");
    }
  }

  function handleImportRequest() {
    if (!selectedRequest) return;
    importRequestDetails(selectedRequest);
  }

  const selectedManualPassenger = passengerOptions.find((p) => p.id === manualPassengerId) ?? null;
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

      {requestUnavailable && (
        <AttentionState
          level="warning"
          title="Selected request is unavailable for trip creation."
          description="Continue below to create this trip directly, or choose a different request."
        />
      )}

      <form id="new-trip-form" action={formAction} onSubmit={handleSubmit} className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
          <FormSection
            icon={<User className="size-5" aria-hidden />}
            title="Passenger"
            action={
              // P1-E1-S2F-B1 §7: Add New Passenger is never offered while
              // a Request is selected — the Passenger is derived from
              // that Request, not something this screen resolves.
              !selectedRequest && (
                <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setAddPassengerOpen(true)}>
                  Add New Passenger
                </Button>
              )
            }
          >
            <input type="hidden" name="passengerId" value={effectivePassengerId} />
            {selectedRequest ? (
              <div className="flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-secondary px-3 py-2.5">
                <Avatar name={selectedRequest.passengerDisplayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                    {selectedRequest.passengerDisplayName}
                  </p>
                  <p className={cn(typography.metadata, "text-text-muted")}>Linked from transportation request</p>
                </div>
              </div>
            ) : selectedManualPassenger ? (
              <div className="flex items-center gap-3 rounded-sm border border-selection-border bg-brand-calm-mist/40 px-3 py-2.5">
                <Avatar name={selectedManualPassenger.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                    {selectedManualPassenger.displayName}
                  </p>
                  {selectedManualPassenger.phone && (
                    <p className={cn(typography.metadata, "text-text-muted")}>{selectedManualPassenger.phone}</p>
                  )}
                </div>
                <IconButton
                  label="Remove selected passenger"
                  icon={<X className="size-4" aria-hidden />}
                  onClick={() => setManualPassengerId("")}
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
                onSelect={(option) => setManualPassengerId(option.value)}
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

          <FormSection icon={<Clock className="size-5" aria-hidden />} title="Expected duration">
            <div className="sm:w-64">
              <Input
                label="Minutes (optional)"
                name="expectedDurationMinutes"
                type="number"
                min={1}
                max={2880}
                step={1}
                inputMode="numeric"
                placeholder={defaultTripDurationMinutes !== null ? `${defaultTripDurationMinutes} (organization default)` : "Not set"}
                value={expectedDuration}
                onChange={(e) => setExpectedDuration(e.target.value)}
                data-testid="expected-duration"
              />
            </div>
            <p className={cn(typography.metadata, "text-text-muted")} data-testid="expected-duration-help">
              {expectedDuration.trim() !== ""
                ? "This trip's own duration. Used to show when a driver or vehicle has another trip at the same time."
                : defaultTripDurationMinutes !== null
                  ? `Organization default: ${formatDurationMinutes(defaultTripDurationMinutes)} — applied when left empty.`
                  : "Not set. Leave empty if unknown — overlaps simply can't be checked for this trip."}
            </p>
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
              helpText="Optional. Linking an existing request marks it accepted and binds its Passenger — this list only shows requests with a resolved, active Passenger."
              options={requestSelectOptions}
              value={requestId}
              onChange={(e) => handleRequestChange(e.target.value)}
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

          {assignmentOptions ? (
            <FormSection icon={<SteeringWheel className="size-5" aria-hidden />} title="Assignment">
              <label className={cn(typography.bodySmall, "flex items-center gap-2 font-medium text-text-primary")}>
                <input
                  type="checkbox"
                  name="assignNow"
                  checked={assignNow}
                  onChange={(e) => setAssignNow(e.target.checked)}
                  disabled={pending}
                  data-testid="assign-now"
                />
                Assign now
              </label>
              {assignNow ? (
                <>
                  <p className={cn(typography.metadata, "text-text-muted")}>
                    The trip is created first, then assigned to the driver and vehicle below when you click Create Trip.
                  </p>
                  <AssignmentFields
                    driverOptions={assignmentOptions.driverOptions}
                    vehicleOptions={assignmentOptions.vehicleOptions}
                    operatorDriverId={operatorDriverId}
                    canManageDriverSetup={canManageDriverSetup}
                    defaults={deriveAssignmentDefaults({
                      mode: "assign",
                      currentDriverId: null,
                      currentVehicleId: null,
                      driverOptions: assignmentOptions.driverOptions,
                      vehicleOptions: assignmentOptions.vehicleOptions,
                    })}
                    dayTarget={
                      pickupDate
                        ? {
                            kind: "date",
                            dateKey: pickupDate,
                            pickupTime: pickupTime || null,
                            // The duration create_trip will store: the typed value, else the organization default.
                            expectedDurationMinutes: /^\d+$/.test(expectedDuration.trim())
                              ? Number(expectedDuration.trim())
                              : defaultTripDurationMinutes,
                          }
                        : null
                    }
                    disabled={pending}
                  />
                </>
              ) : (
                <p className={cn(typography.metadata, "text-text-muted")}>
                  Optional. Leave off to create the trip unassigned and assign it later from Trip Detail, Tomorrow or Dispatch.
                </p>
              )}
            </FormSection>
          ) : (
            <AttentionState
              level="info"
              title="Assign a driver after creating this trip"
              description="Trip creation and driver assignment are separate steps — assign a driver and vehicle from Trip Detail or Dispatch once this trip is created."
            />
          )}
        </div>
      </form>

      {addPassengerOpen && (
        <AddPassengerDialog
          onClose={() => setAddPassengerOpen(false)}
          onCreated={(passenger) => {
            setPassengerOptions((prev) => [...prev, passenger]);
            setManualPassengerId(passenger.id);
          }}
        />
      )}
    </div>
  );
}
