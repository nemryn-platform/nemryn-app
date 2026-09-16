"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { User, MapPin, ClipboardText, NotePencil, Plus, X, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Select } from "@/components/ui/Select";
import { Combobox } from "@/components/ui/Combobox";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { FormSection } from "@/components/operations/new-trip/FormSection";
import { AddPassengerDialog } from "@/components/operations/new-trip/AddPassengerDialog";
import type { NewTripPassengerOption } from "@/lib/operations/new-trip-options";
import { logRequestAction, type LogRequestActionState } from "@/app/operations/requests/new/actions";
import { logRequestErrorMessage } from "@/lib/operations/log-request-errors";
import { REQUESTER_RELATIONSHIP_OPTIONS, RETURN_TRIP_OPTIONS, SOURCE_OPTIONS, DEFAULT_SOURCE } from "@/lib/operations/log-request-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: LogRequestActionState = { status: "idle" };

export interface LogRequestFormProps {
  passengers: NewTripPassengerOption[];
}

/**
 * Log Request (P1-E1-S2C) — fast demand capture, not a Trip form. A
 * single controlled client component submitting one real `<form>` +
 * Server Action, mirroring `NewTripForm`'s own established structure
 * (P1-E3-S7) at a deliberately smaller scale: no Facility/Request
 * pickers (Log Request has neither), single-column layout (this form is
 * meant to be visibly simpler/faster than New Trip, not a second copy of
 * it), and a "log another" loop instead of a redirect to a Trip.
 *
 * Passenger linking reuses `AddPassengerDialog`/`addPassengerAction`
 * directly from New Trip (imported, not duplicated) — the exact same
 * already-twice-reused pattern (New Trip's own inline dialog, and the
 * standalone Passengers page's "Add Passenger" button both already call
 * this same action). See docs/reports/p1-e1-s2c-internal-log-request.txt
 * §9 for the full reuse-vs-reimplement reasoning.
 */
export function LogRequestForm({ passengers: initialPassengers }: LogRequestFormProps) {
  const [state, formAction, pending] = useActionState(logRequestAction, INITIAL_STATE);

  // Double-submit guard (log_transportation_request is deliberately
  // non-idempotent, same reasoning as create_trip/ZD-102 — see
  // NewTripForm's own identical guard) — a second, defense-in-depth
  // layer beyond `disabled={pending}` on the submit button.
  const submittedRef = useRef(false);

  const [formKey, setFormKey] = useState(0);
  const [passengerOptions, setPassengerOptions] = useState(initialPassengers);
  const [passengerId, setPassengerId] = useState("");
  const [addPassengerOpen, setAddPassengerOpen] = useState(false);

  const [requesterName, setRequesterName] = useState("");
  const [requesterRelationship, setRequesterRelationship] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [pickupDescription, setPickupDescription] = useState("");
  const [destinationDescription, setDestinationDescription] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [returnTripNeeded, setReturnTripNeeded] = useState("");
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [assistanceNotes, setAssistanceNotes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  useEffect(() => {
    if (state.status === "error") {
      submittedRef.current = false;
    }
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
  }

  // "Log another request" — resets every field back to its own initial
  // value and remounts the form (via `formKey`, which also resets
  // `useActionState`'s own internal state back to idle) rather than
  // navigating anywhere. Deliberately does NOT redirect into a Request
  // Hub/Detail experience that doesn't exist yet (S2D/S2E) — see
  // docs/reports/p1-e1-s2c-internal-log-request.txt §15 for the full
  // reasoning and the explicit note for S2D/S2E to replace this.
  function handleLogAnother() {
    submittedRef.current = false;
    setPassengerId("");
    setRequesterName("");
    setRequesterRelationship("");
    setRequesterPhone("");
    setRequesterEmail("");
    setPickupDescription("");
    setDestinationDescription("");
    setPreferredDate("");
    setPreferredTime("");
    setReturnTripNeeded("");
    setSource(DEFAULT_SOURCE);
    setAssistanceNotes("");
    setAdditionalNotes("");
    setFormKey((k) => k + 1);
  }

  const selectedPassenger = passengerOptions.find((p) => p.id === passengerId) ?? null;
  const passengerComboboxOptions = passengerOptions.map((p) => ({
    value: p.id,
    label: p.displayName,
    secondaryLabel: p.phone ?? undefined,
  }));

  if (state.status === "success") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-zw-lg">
        <div className="flex flex-col items-start gap-zw-md rounded-md border border-success-border bg-success-bg px-zw-lg py-zw-lg">
          <div className="flex items-center gap-2 text-success-text">
            <CheckCircle className="size-6" aria-hidden />
            <h1 className={cn(typography.subsectionHeading, "text-success-text")}>Request logged</h1>
          </div>
          <p className={cn(typography.body, "text-text-secondary")}>
            {requesterName || "This request"} has been recorded and is ready for review.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={handleLogAnother}>
              Log another request
            </Button>
            <LinkButton href="/operations" variant="outline">
              Back to Overview
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-zw-lg" key={formKey}>
      <nav aria-label="Breadcrumb" className={cn(typography.bodySmall, "text-text-muted")}>
        <Link href="/operations" className="hover:text-text-secondary hover:underline">
          Overview
        </Link>
        <span className="mx-2" aria-hidden>
          ›
        </span>
        <span className="text-text-secondary">Log Request</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-zw-md">
        <div>
          <h1 className={cn(typography.pageTitleOperational, "text-text-primary")}>Log Request</h1>
          <p className={cn(typography.body, "mt-1 text-text-secondary")}>
            Record transportation demand so it can be reviewed and converted into one or more trips.
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/operations" variant="outline">
            Cancel
          </LinkButton>
          <Button type="submit" form="log-request-form" loading={pending} disabled={pending}>
            {pending ? "Logging…" : "Log Request"}
          </Button>
        </div>
      </div>

      {state.status === "error" && (
        <p role="alert" className={cn(typography.bodySmall, "rounded-md border border-critical-border bg-critical-bg px-zw-lg py-zw-md text-critical-text")}>
          {logRequestErrorMessage(state.errorCode ?? "UNKNOWN")}
        </p>
      )}

      <form id="log-request-form" action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-zw-lg">
        <FormSection icon={<User className="size-5" aria-hidden />} title="Requester">
          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            <Input
              label="Requester Name"
              name="requesterName"
              required
              placeholder="e.g. Maria Alvarez"
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
            />
            <Select
              label="Relationship to Passenger"
              name="requesterRelationship"
              required
              placeholder="Select relationship"
              options={REQUESTER_RELATIONSHIP_OPTIONS}
              value={requesterRelationship}
              onChange={(e) => setRequesterRelationship(e.target.value)}
            />
            <Input
              label="Requester Phone"
              name="requesterPhone"
              type="tel"
              required
              placeholder="e.g. (404) 555-0184"
              value={requesterPhone}
              onChange={(e) => setRequesterPhone(e.target.value)}
            />
            <Input
              label="Requester Email"
              name="requesterEmail"
              type="email"
              helpText="Optional"
              placeholder="e.g. maria@example.com"
              value={requesterEmail}
              onChange={(e) => setRequesterEmail(e.target.value)}
            />
          </div>
        </FormSection>

        <FormSection icon={<MapPin className="size-5" aria-hidden />} title="Transportation">
          <Textarea
            label="Pickup"
            name="pickupDescription"
            required
            rows={2}
            placeholder="e.g. 123 Main St, Atlanta, GA"
            value={pickupDescription}
            onChange={(e) => setPickupDescription(e.target.value)}
          />
          <Textarea
            label="Destination"
            name="destinationDescription"
            required
            rows={2}
            placeholder="e.g. Emory Dialysis, 456 Clifton Rd, Atlanta, GA"
            value={destinationDescription}
            onChange={(e) => setDestinationDescription(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            <Input
              label="Preferred Date"
              name="preferredDate"
              type="date"
              helpText="Optional"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
            />
            <Input
              label="Preferred Time"
              name="preferredTime"
              type="time"
              helpText="Optional"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            />
          </div>
          <Select
            label="Return Transportation Needed"
            name="returnTripNeeded"
            required
            placeholder="Select an answer"
            options={RETURN_TRIP_OPTIONS}
            value={returnTripNeeded}
            onChange={(e) => setReturnTripNeeded(e.target.value)}
          />
        </FormSection>

        <FormSection
          icon={<User className="size-5" aria-hidden />}
          title="Passenger"
          action={
            <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setAddPassengerOpen(true)}>
              Add New Passenger
            </Button>
          }
        >
          <p className={cn(typography.metadata, "text-text-muted")}>
            Optional. Link a known passenger now, or leave this for later — the request can be saved either way.
          </p>
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
              placeholder={passengerOptions.length > 0 ? "Search by name or phone number" : "No passengers yet — add one"}
              noResultsText="No passenger matches that search."
              disabled={passengerOptions.length === 0}
              options={passengerComboboxOptions}
              onSelect={(option) => setPassengerId(option.value)}
            />
          )}
        </FormSection>

        <FormSection icon={<ClipboardText className="size-5" aria-hidden />} title="Details">
          <Select
            label="Source"
            name="source"
            required
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </FormSection>

        <FormSection icon={<NotePencil className="size-5" aria-hidden />} title="Notes">
          <Textarea
            label="Assistance Notes"
            name="assistanceNotes"
            helpText="Optional. Mobility/assistance needs mentioned by the requester."
            placeholder="e.g. Uses a wheelchair; needs ramp access."
            value={assistanceNotes}
            onChange={(e) => setAssistanceNotes(e.target.value)}
          />
          <Textarea
            label="Additional Notes"
            name="additionalNotes"
            helpText="Optional. Anything else worth recording about this request."
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
          />
        </FormSection>
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
