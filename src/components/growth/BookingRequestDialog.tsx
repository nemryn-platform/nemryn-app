"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { convertOpportunityAction, rebookContactAction, type BookingActionState } from "@/app/operations/growth/booking/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { AttentionState } from "@/components/ui/AttentionState";
import { BOOKING_LIMITS, BOOKING_PENDING_NOTE } from "@/lib/plus/booking-core";
import { REQUESTER_RELATIONSHIP_OPTIONS, RETURN_TRIP_OPTIONS, SOURCE_OPTIONS, DEFAULT_SOURCE, selectOptionLabel } from "@/lib/operations/log-request-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BookingActionState = { status: "idle" };

export interface BookingCustomer {
  name: string;
  phone: string | null;
  email: string | null;
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  const label = props.mode === "convert" ? "Create transportation request" : "Create another transportation request";
  return (
    <>
      <Button type="button" size="sm" onClick={() => { setInstance((n) => n + 1); setOpen(true); }} data-testid={props.mode === "convert" ? "convert-open" : "rebook-open"}>
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
    requesterRelationship: "self",
    pickupDescription: "",
    destinationDescription: "",
    returnTripNeeded: "no",
    preferredDate: "",
    preferredTime: "",
    assistanceNotes: "",
    additionalNotes: "",
    source: DEFAULT_SOURCE,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const missing = !v.pickupDescription.trim() || !v.destinationDescription.trim();
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
      <form action={action} onSubmit={rememberKey} className="flex flex-col gap-zw-md" noValidate data-testid="booking-form">
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
            <Select label="Who is requesting" options={REQUESTER_RELATIONSHIP_OPTIONS} value={v.requesterRelationship} onChange={set("requesterRelationship")} error={errors.requesterRelationship} data-testid="booking-relationship" />
            <Textarea label="Pickup location" required rows={2} maxLength={BOOKING_LIMITS.location} value={v.pickupDescription} onChange={set("pickupDescription")} error={errors.pickupDescription} data-testid="booking-pickup" />
            <Textarea label="Destination" required rows={2} maxLength={BOOKING_LIMITS.location} value={v.destinationDescription} onChange={set("destinationDescription")} error={errors.destinationDescription} data-testid="booking-destination" />
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
                ["Pickup", v.pickupDescription.trim()],
                ["Destination", v.destinationDescription.trim()],
                ["Preferred", [v.preferredDate, v.preferredTime].filter(Boolean).join(" ") || "No date given"],
                ["Return trip", selectOptionLabel(RETURN_TRIP_OPTIONS, v.returnTripNeeded)],
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
