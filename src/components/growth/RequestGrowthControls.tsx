"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  contactOpportunitiesAction,
  correctAttributionAction,
  linkRequestAction,
  searchLinkContactsAction,
  type AttributionActionState,
  type LinkOption,
} from "@/app/operations/growth/attribution/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ATTRIBUTION_REASON_LIMITS } from "@/lib/plus/attribution-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: AttributionActionState = { status: "idle" };

/**
 * Write controls of the Request Growth panel (NP-P2-S3): "Track in Plus" (link this existing Request to an existing
 * contact and, optionally, one of that contact's opportunities) or "Correct link" (with a required reason). Rendered
 * only for Plus WRITERS; the server re-checks everything. Never creates or merges contacts, never changes the Request.
 * One component for both modes, so the outcome notice survives the server refresh that follows a save.
 */
export function RequestGrowthControls({
  organizationId,
  requestId,
  current,
}: {
  organizationId: string;
  requestId: string;
  /** The current attribution (correction mode), or null (link mode). */
  current: { contactId: string | null; contactName: string | null; opportunityId: string | null; version: string } | null;
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

  // a successful save closes the form (the server re-renders the panel with the new link)
  const [handled, setHandled] = useState<AttributionActionState | null>(null);
  if (state !== handled && state.status === "success") {
    setHandled(state);
    setOpen(false);
  }

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
      {state.status !== "idle" && state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}
          data-testid="growth-link-notice"
        >
          {state.message}
        </p>
      )}
      {!open ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={mode === "link" ? "growth-track" : "growth-correct"}>
            {mode === "link" ? "Track in Plus" : "Correct link"}
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
                No active contact matches. Add the person in Growth → Contacts first; nothing is created from here.
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
