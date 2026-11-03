"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  contactOpportunitiesAction,
  correctAttributionAction,
  createContactForRequestAction,
  linkRequestAction,
  searchLinkContactsAction,
  type AttributionActionState,
  type LinkOption,
  type RequestContactFormState,
} from "@/app/operations/growth/attribution/actions";
import { RequestAddContactForm, type OwnerChoice } from "@/components/growth/RequestAddContactForm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ATTRIBUTION_REASON_LIMITS, contactLinkId } from "@/lib/plus/attribution-core";
import type { ContactFormValues } from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: AttributionActionState = { status: "idle" };
const ADD_IDLE: RequestContactFormState = { status: "idle" };

/**
 * Write controls of the Request Growth panel (NP-P2-S3): "Link existing contact" (link this existing Request to an
 * existing contact and, optionally, one of that contact's opportunities) or "Correct link" (with a required reason).
 * NP-CORE-PLUS-REQUEST-02B adds "Add contact" (create a contact from the reviewed requester details and link it in one
 * database transaction), passed in as `addContact` only when it may be offered (ZD-300). Rendered only for Plus
 * WRITERS; the server re-checks everything. Never merges contacts, never changes the Request. One component for every
 * mode, so the outcome notice survives the server refresh that follows a save.
 *
 * NP-CORE-PLUS-REQUEST-02C-R1 (A1 / A3 / A4): Cancel on the Add contact form returns focus to "Add contact"; a
 * successful add or link moves focus to the linked contact (the panel's contact link, `contactLinkId`) instead of
 * leaving it on <body>; pending and success text go into ONE status region that is always present, so screen readers
 * announce each change once. Errors are not in it: the form moves focus to them (RequestAddContactForm).
 */
export function RequestGrowthControls({
  organizationId,
  requestId,
  current,
  addContact = null,
}: {
  organizationId: string;
  requestId: string;
  /** The current attribution (correction mode), or null (link mode). */
  current: { contactId: string | null; contactName: string | null; opportunityId: string | null; version: string } | null;
  /** Requester prefill + owner choices when "Add contact" may be offered (unlinked, writer, enabled); null otherwise. */
  addContact?: { initial: ContactFormValues; owners: OwnerChoice[] } | null;
}) {
  const mode = current ? "correct" : "link";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<LinkOption[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [opportunities, setOpportunities] = useState<LinkOption[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [state, action, pending] = useActionState(mode === "link" ? linkRequestAction : correctAttributionAction, IDLE);
  const [adding, setAdding] = useState(false);
  const [addState, addAction, addPending] = useActionState(createContactForRequestAction, ADD_IDLE);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const focusAddButton = useRef(false);
  const [focusLinkedContact, setFocusLinkedContact] = useState(false);

  // a successful save closes the form (the server re-renders the panel with the new link)
  const [handled, setHandled] = useState<AttributionActionState | null>(null);
  if (state !== handled && state.status === "success") {
    setHandled(state);
    setOpen(false);
    setAdding(false);
    setFocusLinkedContact(true);
  }
  const [addHandled, setAddHandled] = useState<RequestContactFormState | null>(null);
  if (addState !== addHandled && addState.status === "success") {
    setAddHandled(addState);
    setAdding(false);
    setFocusLinkedContact(true);
  }

  // A1: Cancel closes the form; focus goes back to the button that opened it
  useEffect(() => {
    if (adding || !focusAddButton.current) return;
    focusAddButton.current = false;
    addButtonRef.current?.focus();
  }, [adding]);

  // A3: after a save the panel re-renders with the link; focus its contact once it is there, but only if focus was
  // lost (the closed form took it with it) -- never steal it from somewhere the person has since moved
  useEffect(() => {
    if (!focusLinkedContact) return;
    let frames = 0;
    let handle = 0;
    const attempt = () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      const target = document.getElementById(contactLinkId(requestId));
      if (target && lost) target.focus();
      if (target || !lost || ++frames > 60) setFocusLinkedContact(false);
      else handle = window.requestAnimationFrame(attempt);
    };
    handle = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(handle);
  }, [focusLinkedContact, requestId]);

  const loadOpportunities = (cid: string, keep: string) =>
    startSearch(async () => {
      setOpportunities([]);
      setOpportunityId(keep);
      if (!cid) return;
      const r = await contactOpportunitiesAction(organizationId, cid);
      setLookupError(r.error ?? null);
      setOpportunities(r.options);
    });

  // correction: start from the current link
  useEffect(() => {
    if (!open || !current) return;
    startSearch(async () => {
      const cid = current.contactId ?? "";
      setContacts(cid ? [{ value: cid, label: current.contactName ?? "Current contact" }] : []);
      setContactId(cid);
      setOpportunityId(current.opportunityId ?? "");
      if (cid) {
        const r = await contactOpportunitiesAction(organizationId, cid);
        setLookupError(r.error ?? null);
        setOpportunities(r.options);
      }
    });
  }, [open, current, organizationId]);

  const search = () =>
    startSearch(async () => {
      const r = await searchLinkContactsAction(organizationId, query);
      setLookupError(r.error ?? null);
      setContacts(r.options);
      const first = r.options[0]?.value ?? "";
      setContactId(first);
      setOpportunities([]);
      setOpportunityId("");
      if (first) {
        const o = await contactOpportunitiesAction(organizationId, first);
        setOpportunities(o.options);
      }
    });

  return (
    <div className="flex flex-col gap-zw-md">
      {/* A4: always present (so changes are announced); the negative margin cancels the column gap while it shows nothing */}
      <div role="status" className="flex flex-col gap-zw-md [&:not(:has(>p))]:-mb-zw-md" data-testid="growth-status">
        {(addPending || pending) && <span className="sr-only">{addPending ? "Adding the contact…" : mode === "link" ? "Linking the request…" : "Saving the correction…"}</span>}
        {!addPending && !pending && addState.status === "success" && state.status === "idle" && addState.message && (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="growth-add-notice">
            {addState.message}
          </p>
        )}
        {!pending && state.status === "success" && state.message && (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="growth-link-notice">
            {state.message}
          </p>
        )}
      </div>
      {state.status === "error" && state.message && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="growth-link-notice">
          {state.message}
        </p>
      )}
      {adding && addContact && mode === "link" ? (
        <RequestAddContactForm
          organizationId={organizationId}
          requestId={requestId}
          initial={addContact.initial}
          owners={addContact.owners}
          state={addState}
          action={addAction}
          pending={addPending}
          linkAction={action}
          linkPending={pending}
          onCancel={() => {
            focusAddButton.current = true;
            setAdding(false);
          }}
        />
      ) : !open ? (
        <div className="flex flex-wrap gap-2">
          {addContact && mode === "link" && (
            <Button ref={addButtonRef} type="button" size="sm" onClick={() => setAdding(true)} data-testid="growth-add-contact">
              Add contact
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={mode === "link" ? "growth-track" : "growth-correct"}>
            {mode === "link" ? "Link existing contact" : "Correct link"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-zw-md rounded-md border border-border-subtle p-3" data-testid="growth-link-editor">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Find a contact"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                placeholder="Name, phone or email"
                maxLength={200}
                data-testid="growth-contact-search"
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={search} loading={searching} disabled={searching} data-testid="growth-contact-find">
              Find
            </Button>
          </div>
          {lookupError && (
            <p role="alert" className={cn(typography.metadata, "text-critical-text")}>
              {lookupError}
            </p>
          )}
          <form action={action} className="flex flex-col gap-zw-md" data-testid="growth-link-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="requestId" value={requestId} />
            {current && <input type="hidden" name="expectedVersion" value={current.version} />}
            {contacts !== null && contacts.length === 0 ? (
              <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="growth-no-contacts">
                {addContact && mode === "link"
                  ? "No active contact matches. Cancel and use “Add contact” to add the requester; linking never creates a contact."
                  : "No active contact matches. Add the person in Growth → Contacts first; nothing is created from here."}
              </p>
            ) : contacts !== null ? (
              <Select
                name="contactId"
                label="Contact"
                options={contacts}
                value={contactId}
                onChange={(e) => {
                  setContactId(e.target.value);
                  loadOpportunities(e.target.value, "");
                }}
                disabled={pending}
                data-testid="growth-contact-select"
              />
            ) : (
              <p className={cn(typography.metadata, "text-text-muted")}>Search for the contact this request belongs to.</p>
            )}
            {contactId && (
              <Select
                name="opportunityId"
                label="Opportunity (optional)"
                options={[{ value: "", label: "No opportunity" }, ...opportunities]}
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                disabled={pending || searching}
                data-testid="growth-opportunity-select"
              />
            )}
            {mode === "correct" && (
              <Textarea
                name="reason"
                label="Reason for the correction"
                helpText="Describe the linking mistake only. Don't include medical or health details."
                required
                minLength={ATTRIBUTION_REASON_LIMITS.min}
                maxLength={ATTRIBUTION_REASON_LIMITS.max}
                rows={2}
                disabled={pending}
                data-testid="growth-reason"
              />
            )}
            <p className={cn(typography.metadata, "text-text-muted")}>
              Linking records the relationship only. It doesn&apos;t change this request, its decision or its trips, and it doesn&apos;t mark the
              opportunity converted.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={pending} disabled={pending || !contactId} data-testid="growth-link-save">
                {mode === "link" ? "Link request" : "Save correction"}
              </Button>
              <Button type="button" size="sm" variant="text" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
