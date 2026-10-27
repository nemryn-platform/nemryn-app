"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { convertOpportunityAction, rebookContactAction, type BookingActionState } from "@/app/operations/growth/booking/actions";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { AttentionState } from "@/components/ui/AttentionState";
import { BOOKING_LIMITS, BOOKING_PENDING_NOTE, doNotContactNotice } from "@/lib/plus/booking-core";
import { PASSENGER_MATCH_LABELS, RIDER_NAME_MAX, type HandoffPrefill, type PassengerChoice } from "@/lib/plus/handoff-core";
import { REQUESTER_RELATIONSHIP_OPTIONS, RETURN_TRIP_OPTIONS, SOURCE_OPTIONS, DEFAULT_SOURCE, SERVICE_NOT_SPECIFIED_LABEL, SERVICE_OPTIONS_UNAVAILABLE_NOTE, selectOptionLabel, type SelectOption } from "@/lib/operations/log-request-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BookingActionState = { status: "idle" };

export interface BookingCustomer {
  name: string;
  phone: string | null;
  email: string | null;
  /** the contact's STORED do_not_contact preference; omitted when not available (OD-6, NP-P2-S4-R3) */
  doNotContact?: boolean | null;
}

/**
 * "Create transportation request" (conversion, from an Opportunity) and "Create another transportation request"
 * (rebooking, from a Contact) -- NP-P2-S4. A deliberate two-step form: enter the transport details Core needs, review,
 * then confirm. The requester's name / phone / email come from the Growth contact; everything else is staff input and
 * is stored ONLY in Core. One idempotency key per opened form: a double click or a retry after a timeout returns the
 * same Request, never a second one. The result is a PENDING Request for Operations -- no ride, driver, payment or trip.
 */
export function BookingRequestDialog(props: {
  mode: "convert" | "rebook";
  organizationId: string;
  customer: BookingCustomer;
  opportunityId?: string;
  opportunityTitle?: string;
  expectedVersion?: string;
  contactId?: string;
  /** conversion: the Core source the Request will record (mapped from the opportunity) */
  sourceLabel?: string;
  /** conversion: the opportunity's own service label, shown read-only in Review (null = Not specified; NP-P2-S4.1-S2) */
  opportunityServiceLabel?: string | null;
  /** rebooking: "Service requested (optional)" options -- "Not specified" first, then the organization's Services */
  serviceOptions?: SelectOption[];
  /** rebooking: the organization's Services could not be loaded (only "Not specified" is offered, with a short note) */
  serviceOptionsUnavailable?: boolean;
  /**
   * NP-PILOT-P1 handoff hints: suggested (editable) "Who is requesting" / "Return trip" from data Growth already holds,
   * and the organization's active passengers for an OPTIONAL "Who will ride?" choice (null = list unavailable).
   */
  handoff?: { prefill: HandoffPrefill; passengers: PassengerChoice[] | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  const label = props.mode === "convert" ? "Create transportation request" : "Create another transportation request";
  return (
    <>
      <Button type="button" onClick={() => { setInstance((n) => n + 1); setOpen(true); }} data-testid={props.mode === "convert" ? "convert-open" : "rebook-open"}>
        {label}
      </Button>
      {open && (
        <BookingForm
          key={instance}
          {...props}
          title={label}
          onClose={(created) => {
            setOpen(false);
            // show the new linked Request (and, after a conversion, the converted opportunity) once the person is done
            if (created) router.refresh();
          }}
        />
      )}
    </>
  );
}

function BookingForm({
  mode,
  organizationId,
  customer,
  opportunityId,
  opportunityTitle,
  expectedVersion,
  contactId,
  sourceLabel,
  opportunityServiceLabel,
  serviceOptions,
  serviceOptionsUnavailable = false,
  handoff,
  title,
  onClose: close,
}: Parameters<typeof BookingRequestDialog>[0] & { title: string; onClose: (created: boolean) => void }) {
  // ONE key per intended request. A retry of this submit reuses it (the database returns the same Request). The key is
  // also kept in sessionStorage from submit until a confirmed success, so a page RELOAD after an ambiguous timeout
  // reopens the form with the SAME key -- never a second Request (NP-P2-S4-R1). Storage failures fall back to a fresh key.
  const storageKey = `nemryn.plus.booking.${mode}.${opportunityId ?? contactId ?? "none"}`;
  const [{ idempotencyKey, restored }] = useState(() => {
    try {
      const prior = window.sessionStorage.getItem(storageKey);
      if (prior && /^[A-Za-z0-9._:-]{8,200}$/.test(prior)) return { idempotencyKey: prior, restored: true };
    } catch {}
    return { idempotencyKey: `${mode}-${crypto.randomUUID()}`, restored: false };
  });
  const rememberKey = () => {
    try {
      window.sessionStorage.setItem(storageKey, idempotencyKey);
    } catch {}
  };
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [state, action, pending] = useActionState(mode === "convert" ? convertOpportunityAction : rebookContactAction, IDLE);
  const [v, setV] = useState({
    requesterRelationship: (handoff?.prefill.requesterRelationship ?? "self") as string,
    pickupDescription: "",
    destinationDescription: "",
    returnTripNeeded: handoff?.prefill.returnTripNeeded ?? "no",
    preferredDate: "",
    preferredTime: "",
    assistanceNotes: "",
    additionalNotes: "",
    source: DEFAULT_SOURCE,
    // rebooking only: "" = Not specified (posted as a hidden field; the conversion action never reads it)
    serviceType: "",
    // NP-PILOT-P1: "" = decide on the request page (the existing flow); a chosen passenger needs explicit confirmation
    passengerId: "",
    passengerConfirmed: "",
    // NP-PILOT-P1 D1/D3: OR the name of a rider who isn't a passenger yet (recorded on the request for Add New Passenger).
    // The requester's name is only suggested when staff tick "the requester is the person who will ride".
    riderName: "",
    riderIsRequester: "",
  });
  const chosenPassenger = handoff?.passengers?.find((p) => p.id === v.passengerId) ?? null;
  const rebookServiceOptions = serviceOptions ?? [{ value: "", label: SERVICE_NOT_SPECIFIED_LABEL }];
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const setRiderIsRequester = (on: boolean) =>
    setV((x) => ({
      ...x,
      riderIsRequester: on ? "yes" : "",
      requesterRelationship: on ? "self" : x.requesterRelationship,
      // suggest the contact's name (editable); unticking removes it only if it is still exactly the suggestion
      riderName: on ? (x.riderName.trim() || customer.name) : x.riderName === customer.name ? "" : x.riderName,
    }));
  const missing = !v.pickupDescription.trim() || !v.destinationDescription.trim() || (v.passengerId !== "" && v.passengerConfirmed !== "yes");
  const errors = state.errors ?? {};
  // a server-side validation error sends the person back to the fields
  const [seen, setSeen] = useState<BookingActionState>(IDLE);
  // A double click submits twice with the SAME key: the second is a replay of the first, and React may render only that
  // final result. So "already created" is shown only for a genuine RETRY -- after this form displayed an error (e.g. a
  // timeout) -- never for a double click.
  const [hadError, setHadError] = useState(false);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "error") setHadError(true);
    if (state.status === "error" && state.errors) setStep("edit");
    // a refused passenger (inactive / not in this workspace) is not offered again as if still chosen
    if (state.status === "error" && state.errors?.passenger) setV((x) => ({ ...x, passengerId: "", passengerConfirmed: "" }));
  }
  const onClose = () => close(state.status === "success");
  // a confirmed result ends this intended request: the next opened form is a NEW request with a new key
  useEffect(() => {
    if (state.status !== "success") return;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {}
  }, [state, storageKey]);

  if (state.status === "success" && state.requestId) {
    return (
      <Dialog open onClose={onClose} title={title}>
        <div className="flex flex-col gap-zw-md" data-testid="booking-success">
          <AttentionState level="info" title={state.message ?? ""} description={BOOKING_PENDING_NOTE} />
          {state.passengerNote && (
            <p className={cn(typography.bodySmall, state.replayed ? "text-warning-text" : "text-text-secondary")} data-testid="booking-passenger-result">
              {state.passengerNote}
            </p>
          )}
          {state.replayed && (hadError || restored) && (
            <p className={cn(typography.metadata, "text-text-secondary")} data-testid="booking-replayed">
              This request had already been created; nothing new was added.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/operations/requests/${state.requestId}`} className={cn(typography.button, "text-text-link hover:underline")} data-testid="booking-open-request">
              Open the request in Operations
            </Link>
            <Button type="button" size="sm" variant="outline" onClick={onClose} data-testid="booking-close">
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={title} description={BOOKING_PENDING_NOTE}>
      {/* dispatched by hand: a <form action> is reset by React after every submit, which would show the selects' first
          options while the form state still holds the person's choices */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          rememberKey();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
        className="flex flex-col gap-zw-md" noValidate data-testid="booking-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
        {expectedVersion && <input type="hidden" name="expectedVersion" value={expectedVersion} />}
        {contactId && <input type="hidden" name="contactId" value={contactId} />}
        {Object.entries(v).map(([k, val]) => (
          <input key={k} type="hidden" name={k} value={val} />
        ))}

        <div className="rounded-md bg-surface-secondary p-3" data-testid="booking-customer">
          <p className={cn(typography.label, "text-text-primary")}>Requester (from the contact)</p>
          <p className={cn(typography.bodySmall, "text-text-primary")}>
            {customer.name}
            {customer.phone ? ` · ${customer.phone}` : ""}
            {customer.email ? ` · ${customer.email}` : ""}
          </p>
          {opportunityTitle && <p className={cn(typography.metadata, "text-text-secondary")}>Opportunity: {opportunityTitle}</p>}
          {!customer.phone && (
            <p className={cn(typography.metadata, "text-critical-text")} data-testid="booking-no-phone">
              Add a phone number to the contact first. Operations needs one to review the request.
            </p>
          )}
        </div>

        {/* OD-6: from the stored preference only; a reminder, never a block, and nothing is sent */}
        {(() => {
          const notice = doNotContactNotice(customer.doNotContact);
          if (!notice) return null;
          return notice.kind === "do_not_contact" ? (
            <div data-testid="booking-do-not-contact">
              <AttentionState level="warning" title={notice.title} description={notice.description} />
            </div>
          ) : (
            <p className={cn(typography.metadata, "text-text-secondary")} data-testid="booking-preference-reminder">
              {notice.description}
            </p>
          );
        })()}

        {restored && state.status === "idle" && (
          <p className={cn(typography.metadata, "text-text-secondary")} data-testid="booking-restored">
            Continuing an earlier attempt. If that request was already created, you&apos;ll be shown it instead of creating a second one.
          </p>
        )}
        {state.status === "error" && state.message && (
          <AttentionState level="critical" title="Not created" description={state.message} />
        )}

        {step === "edit" ? (
          <div className="flex flex-col gap-zw-md" data-testid="booking-edit">
            <Select
              label="Who is requesting"
              options={REQUESTER_RELATIONSHIP_OPTIONS}
              value={v.requesterRelationship}
              // someone requesting for another person can't also be the rider
              onChange={(e) => {
                const value = e.target.value;
                if (value !== "self" && v.riderIsRequester === "yes") setRiderIsRequester(false);
                setV((x) => ({ ...x, requesterRelationship: value }));
              }}
              error={errors.requesterRelationship}
              data-testid="booking-relationship"
            />
            {handoff && handoff.prefill.notes.length > 0 && (
              <ul className={cn(typography.metadata, "-mt-2 text-text-muted")} data-testid="booking-prefill-notes">
                {handoff.prefill.notes.map((n) => (
                  <li key={n}>Suggested — {n} Check before continuing.</li>
                ))}
              </ul>
            )}
            {handoff && (
              <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3" data-testid="booking-passenger">
                {handoff.passengers === null ? (
                  <p className={cn(typography.bodySmall, "text-text-secondary")}>The passenger list couldn&apos;t be loaded. Link or add the passenger on the request page.</p>
                ) : (
                  <>
                    <Select
                      label="Who will ride? (optional)"
                      options={[
                        { value: "", label: "Decide on the request page" },
                        ...handoff.passengers.map((p) => ({
                          value: p.id,
                          label: `${p.displayName}${p.phone ? ` · ${p.phone}` : ""}${p.match ? ` — ${PASSENGER_MATCH_LABELS[p.match]}` : ""}`,
                        })),
                      ]}
                      value={v.passengerId}
                      onChange={(e) => setV((x) => ({ ...x, passengerId: e.target.value, passengerConfirmed: "", ...(e.target.value ? { riderName: "", riderIsRequester: "" } : {}) }))}
                      helpText="Choose an existing passenger to link to the new request. Suggestions are hints only — the requester and the rider may be different people."
                      error={errors.passenger}
                      data-testid="booking-passenger-select"
                    />
                    {chosenPassenger && (
                      <Checkbox
                        label={`I've checked that ${chosenPassenger.displayName} is the person who will ride`}
                        checked={v.passengerConfirmed === "yes"}
                        onChange={(e) => setV((x) => ({ ...x, passengerConfirmed: e.target.checked ? "yes" : "" }))}
                        data-testid="booking-passenger-confirm"
                      />
                    )}
                  </>
                )}
                {!chosenPassenger && (
                  <>
                    <Checkbox
                      label={`${customer.name} (the requester) is the person who will ride`}
                      checked={v.riderIsRequester === "yes"}
                      onChange={(e) => setRiderIsRequester(e.target.checked)}
                      data-testid="booking-rider-is-requester"
                    />
                    <Input
                      label="New rider's name (optional)"
                      value={v.riderName}
                      maxLength={RIDER_NAME_MAX}
                      onChange={set("riderName")}
                      error={errors.riderName}
                      helpText="If the rider isn't in the list. Recorded on the request so Operations can add them as a new passenger — no passenger is created here."
                      data-testid="booking-rider-name"
                    />
                  </>
                )}
              </div>
            )}
            <Textarea label="Pickup location" required rows={2} maxLength={BOOKING_LIMITS.location} value={v.pickupDescription} onChange={set("pickupDescription")} error={errors.pickupDescription}
              helpText={handoff ? "Not stored in Growth — enter where the passenger is picked up." : undefined} data-testid="booking-pickup" />
            <Textarea label="Destination" required rows={2} maxLength={BOOKING_LIMITS.location} value={v.destinationDescription} onChange={set("destinationDescription")} error={errors.destinationDescription}
              helpText={handoff ? "Not stored in Growth — enter the appointment or drop-off address." : undefined} data-testid="booking-destination" />
            {mode === "rebook" && (
              <Select
                label="Service requested (optional)"
                options={rebookServiceOptions}
                value={v.serviceType}
                onChange={set("serviceType")}
                error={errors.serviceType}
                helpText={serviceOptionsUnavailable ? SERVICE_OPTIONS_UNAVAILABLE_NOTE : undefined}
                data-testid="booking-service"
              />
            )}
            <div className="grid grid-cols-1 gap-zw-md md:grid-cols-3">
              <Input label="Preferred date (optional)" type="date" value={v.preferredDate} onChange={set("preferredDate")} error={errors.preferredDate} data-testid="booking-date" />
              <Input label="Preferred time (optional)" type="time" value={v.preferredTime} onChange={set("preferredTime")} error={errors.preferredTime} data-testid="booking-time" />
              <Select label="Return trip needed" options={RETURN_TRIP_OPTIONS} value={v.returnTripNeeded} onChange={set("returnTripNeeded")} error={errors.returnTripNeeded} data-testid="booking-return" />
            </div>
            {mode === "rebook" && (
              <Select label="How the request came in" options={SOURCE_OPTIONS} value={v.source} onChange={set("source")} error={errors.source} data-testid="booking-source" />
            )}
            <Textarea label="Assistance needs (optional)" rows={2} maxLength={BOOKING_LIMITS.notes} value={v.assistanceNotes} onChange={set("assistanceNotes")} error={errors.assistanceNotes}
              helpText="Stored with the Operations request only. Keep to what's needed for the ride." data-testid="booking-assistance" />
            <Textarea label="Other notes for Operations (optional)" rows={2} maxLength={BOOKING_LIMITS.notes} value={v.additionalNotes} onChange={set("additionalNotes")} error={errors.additionalNotes} data-testid="booking-notes" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setStep("review")} disabled={missing || !customer.phone} data-testid="booking-review">
                Review
              </Button>
              <Button type="button" size="sm" variant="text" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-zw-md" data-testid="booking-summary">
            <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {[
                ["Who is requesting", selectOptionLabel(REQUESTER_RELATIONSHIP_OPTIONS, v.requesterRelationship)],
                ...(handoff
                  ? [[
                      "Passenger",
                      chosenPassenger
                        ? `${chosenPassenger.displayName} (will be linked)`
                        : v.riderName.trim()
                          ? `${v.riderName.trim()} (new — added on the request page)`
                          : "Not chosen — link or add on the request page",
                    ]]
                  : []),
                ["Pickup", v.pickupDescription.trim()],
                ["Destination", v.destinationDescription.trim()],
                ["Preferred", [v.preferredDate, v.preferredTime].filter(Boolean).join(" ") || "No date given"],
                ["Return trip", selectOptionLabel(RETURN_TRIP_OPTIONS, v.returnTripNeeded)],
                // NP-P2-S4.1-S2: conversion shows the opportunity's own service (read-only); rebooking shows the choice
                [
                  "Service requested",
                  mode === "convert"
                    ? (opportunityServiceLabel ?? SERVICE_NOT_SPECIFIED_LABEL)
                    : v.serviceType
                      ? selectOptionLabel(rebookServiceOptions, v.serviceType)
                      : SERVICE_NOT_SPECIFIED_LABEL,
                ],
                ["Source", mode === "rebook" ? selectOptionLabel(SOURCE_OPTIONS, v.source) : (sourceLabel ?? "From the opportunity")],
              ].map(([k, val]) => (
                <div key={k}>
                  <dt className={cn(typography.metadata, "text-text-muted")}>{k}</dt>
                  <dd className={cn(typography.bodySmall, "break-words text-text-primary")}>{val}</dd>
                </div>
              ))}
            </dl>
            <p className={cn(typography.bodySmall, "text-text-secondary")}>
              {mode === "convert"
                ? "Confirming creates one pending request in Operations, links it to this opportunity and marks the opportunity converted."
                : "Confirming creates one new pending request in Operations for this contact. Earlier requests and opportunities are not changed."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={pending} disabled={pending} data-testid="booking-confirm">
                Create request
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setStep("edit")} disabled={pending}>
                Back
              </Button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
