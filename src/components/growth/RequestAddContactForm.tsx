"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { RequestContactFormState } from "@/app/operations/growth/attribution/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ADD_CONTACT_NOTICE, REQUESTER_NOT_PASSENGER_NOTICE } from "@/lib/plus/attribution-core";
import {
  CONTACT_CHANNEL_OPTIONS,
  CONTACT_KIND_OPTIONS,
  CONTACT_LIMITS,
  DO_NOT_CONTACT_HELP,
  describeMatch,
  type ContactFormValues,
} from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface OwnerChoice {
  handle: string;
  name: string;
  isSelf: boolean;
}

/**
 * NP-CORE-PLUS-REQUEST-02B: the inline "Add contact" form of the Request Growth panel. Prefilled from the REQUESTER
 * (never the passenger); every field is editable and nothing is sent until the person submits. Same fields, defaults
 * and validation as Growth -> Contacts -> New (minus the optional role), with no consent fields: the request is not
 * consent. Possible duplicates are listed first -- link an active match (the existing link action) or create a
 * separate contact; contacts are never merged. State lives in RequestGrowthControls so the outcome survives the refresh.
 *
 * NP-CORE-PLUS-REQUEST-02C-R1 (A2 / A4): after a refused submission focus moves to what needs attention -- the first
 * invalid field (its error is tied by aria-describedby), the server error or the duplicate explanation (focusable
 * messages, not live regions, so each is announced once, on focus). Pending and success are announced by the persistent
 * status region in RequestGrowthControls. Fields sit in two columns when the panel is wide enough (a container query,
 * so the narrow desktop column stays single-column); DOM order stays the reading and Tab order.
 */
export function RequestAddContactForm({
  organizationId,
  requestId,
  initial,
  owners,
  state,
  action,
  pending,
  linkAction,
  linkPending,
  onCancel,
}: {
  organizationId: string;
  requestId: string;
  initial: ContactFormValues;
  owners: OwnerChoice[];
  state: RequestContactFormState;
  action: (formData: FormData) => void;
  pending: boolean;
  /** The released "Link existing contact" action, for linking a listed match instead. */
  linkAction: (formData: FormData) => void;
  linkPending: boolean;
  onCancel: () => void;
}) {
  const values = state.values ?? initial;
  const errors = state.errors ?? {};
  const busy = pending || linkPending;
  // Re-mount the inputs with the echoed values after each refused submission so typed text is preserved.
  const [submissions, setSubmissions] = useState(0);
  const formKey = `${submissions}:${state.status}`;
  const ownerOptions = [{ value: "", label: "No owner" }, ...owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }))];
  const hintId = useId();
  // "A phone number or an email address is required": no single field is wrong, so both carry it as their error
  const contactMissing = Boolean(errors.form) && !errors.phone && !errors.email;
  const contactMissingProps = contactMissing ? { "aria-invalid": true, "aria-describedby": hintId } : {};

  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const duplicatesRef = useRef<HTMLParagraphElement>(null);
  // each submission returns a new state object; move focus once per result (the fields re-mount, which drops focus)
  useEffect(() => {
    if (state.status === "error") {
      const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (invalid ?? errorRef.current)?.focus();
    } else if (state.status === "duplicates") {
      duplicatesRef.current?.focus();
    }
  }, [state]);

  return (
    <div className="@container flex flex-col gap-zw-sm rounded-md border border-border-subtle p-3" data-testid="growth-add-contact-editor">
      <p className={cn(typography.label, "text-text-primary")} data-testid="growth-add-requester-notice">
        {REQUESTER_NOT_PASSENGER_NOTICE}
      </p>

      {state.status === "error" && state.message && !Object.keys(errors).some((k) => k !== "form") && !contactMissing && (
        <p ref={errorRef} tabIndex={-1} className={cn(typography.bodySmall, "text-critical-text outline-none")} data-testid="growth-add-error">
          {state.message}
        </p>
      )}

      {state.status === "duplicates" && (
        <div className="flex flex-col gap-zw-sm rounded-md border border-warning-border p-3" data-testid="growth-add-duplicates">
          <p ref={duplicatesRef} tabIndex={-1} className={cn(typography.bodySmall, "text-text-primary outline-none")} data-testid="growth-add-duplicates-message">
            {state.message}
          </p>
          {state.duplicates && state.duplicates.length > 0 && (
            <ul className="flex flex-col gap-2">
              {state.duplicates.map((d) => (
                <li key={d.contactId} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border-subtle px-3 py-2" data-testid="growth-add-duplicate">
                  <span className={cn(typography.bodySmall, "min-w-0 break-words text-text-primary")}>
                    <Link href={`/operations/growth/contacts/${d.contactId}`} className="text-text-link hover:underline">
                      {d.displayName}
                    </Link>
                    {d.status === "archived" && <span className="ml-2 text-text-muted">(archived — can&apos;t be linked)</span>}
                    <span className={cn(typography.metadata, "block text-text-secondary")}>{describeMatch(d.matchOn)}</span>
                  </span>
                  {d.status === "active" && (
                    <form action={linkAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="requestId" value={requestId} />
                      <input type="hidden" name="contactId" value={d.contactId} />
                      <Button type="submit" size="sm" variant="outline" loading={linkPending} disabled={busy} data-testid="growth-add-link-match">
                        Link this contact
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form ref={formRef} action={action} onSubmit={() => setSubmissions((n) => n + 1)} className="flex flex-col gap-zw-sm" noValidate data-testid="growth-add-contact-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="requestId" value={requestId} />
        <div className="grid grid-cols-1 gap-x-zw-md gap-y-zw-sm @lg:grid-cols-2" key={formKey}>
          <div className="@lg:col-span-2">
            <Input
              name="displayName"
              label="Name"
              required
              maxLength={CONTACT_LIMITS.name}
              defaultValue={values.displayName}
              error={errors.displayName}
              autoComplete="off"
              autoFocus={state.status === "idle"}
              disabled={busy}
              data-testid="growth-add-name"
            />
          </div>
          <Input name="phone" label="Phone" type="tel" maxLength={CONTACT_LIMITS.phone} defaultValue={values.phone} error={errors.phone} autoComplete="off" disabled={busy} data-testid="growth-add-phone" {...contactMissingProps} />
          <Input name="email" label="Email" type="email" maxLength={CONTACT_LIMITS.email} defaultValue={values.email} error={errors.email} autoComplete="off" disabled={busy} data-testid="growth-add-email" {...contactMissingProps} />
          <p id={hintId} className={cn(typography.metadata, "@lg:col-span-2", errors.form ? "text-critical-text" : "text-text-secondary")} data-testid="growth-add-contact-hint">
            A phone number or an email address is required.
          </p>
          <Select name="contactKind" label="Contact type" required options={CONTACT_KIND_OPTIONS} defaultValue={values.contactKind} error={errors.contactKind} disabled={busy} data-testid="growth-add-kind" />
          <Select name="preferredChannel" label="Preferred channel" required options={CONTACT_CHANNEL_OPTIONS} defaultValue={values.preferredChannel} error={errors.preferredChannel} disabled={busy} data-testid="growth-add-channel" />
          <div className="@lg:col-span-2">
            <Select name="ownerHandle" label="Owner (optional)" options={ownerOptions} defaultValue={values.ownerHandle} error={errors.ownerHandle} helpText="Someone in your team with Nemryn Plus write access." disabled={busy} data-testid="growth-add-owner" />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle bg-surface-app p-zw-md @lg:col-span-2">
            <input type="checkbox" name="doNotContact" defaultChecked={values.doNotContact} disabled={busy} className="mt-1 size-4 accent-[var(--color-text-link)]" data-testid="growth-add-dnc" />
            <span>
              <span className={cn(typography.label, "block text-text-primary")}>Do not contact</span>
              <span className={cn(typography.metadata, "mt-0.5 block text-text-secondary")}>{DO_NOT_CONTACT_HELP}</span>
            </span>
          </label>
        </div>
        <p className={cn(typography.metadata, "text-text-muted")}>{ADD_CONTACT_NOTICE}</p>
        <div className="flex flex-wrap gap-2">
          {state.status === "duplicates" ? (
            <Button type="submit" name="confirmDuplicate" value="true" size="sm" variant="outline" loading={pending} disabled={busy} data-testid="growth-add-confirm-duplicate">
              Create a separate contact
            </Button>
          ) : (
            <Button type="submit" size="sm" loading={pending} disabled={busy} data-testid="growth-add-save">
              Add and link contact
            </Button>
          )}
          <Button type="button" size="sm" variant="text" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
