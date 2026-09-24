"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Combobox } from "@/components/ui/Combobox";
import { AddPassengerDialog } from "@/components/operations/new-trip/AddPassengerDialog";
import { linkPassengerAction, type LinkPassengerActionState } from "@/app/operations/requests/[requestId]/actions";
import { linkPassengerErrorMessage } from "@/lib/operations/link-passenger-errors";
import type { NewTripPassengerOption } from "@/lib/operations/new-trip-options";
import type { RequestDetailPassenger } from "@/lib/operations/request-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: LinkPassengerActionState = { status: "idle" };

export interface RequestPassengerPanelProps {
  requestId: string;
  /** P1-OPS-R1: link_request_passenger's own rule — pending or accepted, until the first Trip exists. Linking never changes the decision state. */
  canLinkPassenger: boolean;
  passenger: RequestDetailPassenger | null;
  candidatePassengers: NewTripPassengerOption[];
  /** True only if the active-Passenger option list itself failed to load — a soft-degrade of the search/link sub-feature, never a reason to fail the whole Detail page (that list is not part of the Request's own authoritative data). */
  candidatesUnavailable: boolean;
  /** P1-PILOT-S4B-R2A — a free-text SNAPSHOT of the passenger name the requester supplied at submission time (website intake only). NOT the same entity as `passenger` below — the two are independent and may name different people (or the requester may have mistyped/nicknamed the actual Passenger). Shown alongside, never merged into, the linked-Passenger display. Persists unchanged even after linking. */
  requestedPassengerName: string | null;
}

/**
 * Request Detail's Passenger section (P1-E1-S2E §12-§19, extended by
 * P1-E1-S2E-R1 §3-§9 to close a real dead-end: a pending Request whose
 * linked Passenger has since gone inactive had a visible "Passenger
 * needed" readiness with no way for an operator to actually resolve
 * it). Four states, mutually exclusive:
 *   - Linked + active: a read-only card — NO replacement control.
 *     First-release Nemryn still does not support casual Passenger
 *     reassignment (S2E-R1 §8) — this is the one case with genuinely no
 *     action available here.
 *   - Linked + inactive, while still pending (S2E-R1 §3/§4): the SAME
 *     read-only card, PLUS a restrained recovery notice and a
 *     "Select active Passenger" action. This is remediation of an
 *     invalid readiness condition, not ordinary record editing — the
 *     search/add UI stays collapsed behind that explicit click (S2E-R1
 *     §6: replacing an existing relationship deserves one more
 *     deliberate step than starting from nothing does), then reuses the
 *     exact same search/add/confirm mechanism as the unlinked case
 *     below once opened.
 *   - Unresolved + pending: explicit "Search existing Passenger"
 *     (Combobox, selection alone never mutates anything — §14) +
 *     "Add New Passenger" (reuses AddPassengerDialog unmodified) +  an
 *     explicit "Link Passenger" confirm step.
 *   - Not linkable (declined/cancelled, or a Trip already exists), OR
 *     linked+active: plain read-only presentation, no actions at all —
 *     the RPC itself rejects linking there (P1-OPS-R1: linking is legal
 *     while pending or accepted, until the first Trip exists).
 */
export function RequestPassengerPanel({
  requestId,
  canLinkPassenger,
  passenger,
  candidatePassengers: initialCandidates,
  candidatesUnavailable,
  requestedPassengerName,
}: RequestPassengerPanelProps) {
  const [state, formAction, pending] = useActionState(linkPassengerAction, INITIAL_STATE);
  const submittedRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const autoSubmitRef = useRef(false);

  const [candidates, setCandidates] = useState(initialCandidates);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [addPassengerOpen, setAddPassengerOpen] = useState(false);
  // P1-E1-S2E-R1 §6 — the recovery search/add UI stays collapsed behind
  // this explicit gate until the operator deliberately opts into
  // replacing the inactive linkage; the ordinary unlinked case has no
  // such gate (there is nothing to replace).
  const [recoveryFlowOpen, setRecoveryFlowOpen] = useState(false);

  useEffect(() => {
    if (state.status === "error") {
      submittedRef.current = false;
    }
  }, [state]);

  // Fires only after the DOM has actually committed the new
  // selectedCandidateId into the hidden `passengerId` input — submitting
  // one render tick earlier (e.g. from inside the onCreated callback
  // directly) would race React's own state-update batching and could
  // submit the PREVIOUS (empty) value.
  useEffect(() => {
    if (autoSubmitRef.current && selectedCandidateId) {
      autoSubmitRef.current = false;
      formRef.current?.requestSubmit();
    }
  }, [selectedCandidateId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
  }

  const comboboxOptions = candidates.map((p) => ({ value: p.id, label: p.displayName, secondaryLabel: p.phone ?? undefined }));
  const selectedCandidate = candidates.find((p) => p.id === selectedCandidateId) ?? null;

  const comboboxPlaceholder = candidatesUnavailable
    ? "Passenger search unavailable"
    : candidates.length > 0
      ? "Search by name or phone number"
      : "No passengers yet — add one";

  // Link eligibility (P1-E1-S2E §16, extended by S2E-R1 §3/§8/§9). A UI
  // convenience only — link_request_passenger itself remains the
  // authoritative enforcement (a forged action attempt against a
  // non-pending Request, or one whose linked Passenger is already
  // active, is still rejected/ignored the same way server-side; the RPC
  // itself permits linking a different Passenger while pending
  // regardless of the current one's status — confirmed directly against
  // the S2B migration, S2E-R1 §2 — this component is the one that
  // chooses NOT to expose that for an already-active linkage).
  const isUnlinkedPending = canLinkPassenger && passenger === null;
  // The ONE recovery-eligible condition (S2E-R1 §3): a linkable Request
  // (pending, or accepted with no Trip yet — P1-OPS-R1) whose linked
  // Passenger is no longer active. Never eligible for a linked ACTIVE
  // Passenger (§8 — no casual reassignment), and never once declined/
  // cancelled or once a Trip exists — `canLinkPassenger` gates both
  // branches here.
  const isInactiveLinkedPending = canLinkPassenger && passenger !== null && passenger.status !== "active";
  const canShowLinkUi = isUnlinkedPending || (isInactiveLinkedPending && recoveryFlowOpen);

  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Passenger</h3>

      {/*
       * P1-PILOT-S4B-R2A — a website-submitted Request may carry a
       * REQUESTED passenger name (a free-text snapshot the requester
       * typed) with no relationship to any real Passenger record. Shown
       * ONLY when present (the overwhelmingly common staff-entered case
       * has none, and keeps its exact pre-R2A copy below unchanged) —
       * when it IS present, the existing linked-Passenger display is
       * explicitly relabeled "Linked passenger" so the two concepts are
       * never mistaken for one another, exactly like the example in the
       * phase brief this implements.
       */}
      {requestedPassengerName && (
        <div className="mt-zw-md">
          <p className={cn(typography.label, "text-text-muted")}>Requested passenger</p>
          <p className={cn(typography.bodySmall, "mt-0.5 text-text-primary")}>{requestedPassengerName}</p>
        </div>
      )}

      <div className="mt-zw-md">
        {requestedPassengerName && <p className={cn(typography.label, "mb-1 text-text-muted")}>Linked passenger</p>}
        {passenger ? (
          <div className="flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-secondary px-3 py-2.5">
            <Avatar name={passenger.displayName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>{passenger.displayName}</p>
              {passenger.phone && <p className={cn(typography.metadata, "text-text-muted")}>{passenger.phone}</p>}
              {passenger.assistanceNotes && (
                <p className={cn(typography.metadata, "mt-1 text-text-secondary")}>{passenger.assistanceNotes}</p>
              )}
            </div>
            <StatusBadge
              label={passenger.status === "active" ? "Active" : "Inactive"}
              category={passenger.status === "active" ? "positive" : "neutral"}
            />
          </div>
        ) : (
          <p className={cn(typography.bodySmall, "text-text-muted")}>{requestedPassengerName ? "Not linked." : "No passenger linked."}</p>
        )}
      </div>

      {isInactiveLinkedPending && !recoveryFlowOpen && (
        <div className="mt-zw-sm flex flex-wrap items-center gap-zw-sm">
          <p className={cn(typography.bodySmall, "text-warning-text")}>
            This passenger is inactive and cannot be used to create a trip.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setRecoveryFlowOpen(true)}>
            Select active Passenger
          </Button>
        </div>
      )}

      {canShowLinkUi && (
        <div className="mt-zw-md flex flex-col gap-zw-sm">
          {state.status === "error" && (
            <p
              role="alert"
              className={cn(
                typography.bodySmall,
                "rounded-sm border border-critical-border bg-critical-bg px-3 py-2 text-critical-text",
              )}
            >
              {linkPassengerErrorMessage(state.errorCode ?? "UNKNOWN")}
            </p>
          )}

          <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-zw-sm">
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="passengerId" value={selectedCandidateId} />

            {selectedCandidate ? (
              <div className="flex items-center gap-3 rounded-sm border border-selection-border bg-brand-calm-mist/40 px-3 py-2.5">
                <Avatar name={selectedCandidate.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                    {selectedCandidate.displayName}
                  </p>
                  {selectedCandidate.phone && (
                    <p className={cn(typography.metadata, "text-text-muted")}>{selectedCandidate.phone}</p>
                  )}
                </div>
                <IconButton
                  label="Clear selected passenger"
                  icon={<X className="size-4" aria-hidden />}
                  onClick={() => setSelectedCandidateId("")}
                  disabled={pending}
                />
              </div>
            ) : (
              <Combobox
                label="Search existing Passenger"
                placeholder={comboboxPlaceholder}
                noResultsText="No passenger matches that search."
                disabled={candidates.length === 0}
                options={comboboxOptions}
                onSelect={(option) => setSelectedCandidateId(option.value)}
              />
            )}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!selectedCandidateId || pending} loading={pending}>
                {pending ? "Linking…" : "Link Passenger"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                leadingIcon={<Plus className="size-4" aria-hidden />}
                onClick={() => setAddPassengerOpen(true)}
                disabled={pending}
              >
                Add New Passenger
              </Button>
            </div>
          </form>

          {candidatesUnavailable && (
            <p className={cn(typography.metadata, "text-text-muted")}>
              Couldn&apos;t load existing passengers right now — you can still add a new one.
            </p>
          )}
        </div>
      )}

      {addPassengerOpen && (
        <AddPassengerDialog
          onClose={() => setAddPassengerOpen(false)}
          onCreated={(created) => {
            setCandidates((prev) => [...prev, created]);
            autoSubmitRef.current = true;
            setSelectedCandidateId(created.id);
          }}
        />
      )}
    </Panel>
  );
}
