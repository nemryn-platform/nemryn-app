"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createContactAction, updateContactAction, type ContactFormState } from "@/app/operations/growth/contacts/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import {
  CONTACT_CHANNEL_OPTIONS,
  CONTACT_KIND_OPTIONS,
  CONTACT_LIMITS,
  DO_NOT_CONTACT_HELP,
  NO_MEDICAL_DETAILS_NOTICE,
  describeMatch,
  type ContactFormValues,
} from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: ContactFormState = { status: "idle" };

export interface OwnerChoice {
  handle: string;
  name: string;
  isSelf: boolean;
}

/**
 * New / Edit contact (NP-P1-S4). Server-validated (the action and the database re-check everything); this form only
 * collects. Possible duplicates are listed for review and nothing is created until the person explicitly confirms --
 * contacts are never merged. Only minimum-necessary fields exist: no date of birth, address, health, insurance or
 * passenger fields.
 */
export function ContactForm({
  mode,
  organizationId,
  initial,
  owners,
  contactId,
  expectedVersion,
  cancelHref,
}: {
  mode: "create" | "edit";
  organizationId: string;
  initial: ContactFormValues;
  owners: OwnerChoice[];
  contactId?: string;
  expectedVersion?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createContactAction : updateContactAction, IDLE);
  const values = state.values ?? initial;
  const errors = state.errors ?? {};
  // Re-mount the inputs with the echoed values after each refused submission so typed text is preserved.
  const [submissions, setSubmissions] = useState(0);
  const formKey = `${submissions}:${state.status}`;
  const ownerOptions = [
    { value: "", label: "No owner" },
    ...owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name })),
  ];
  // An existing owner who has since lost write access stays selectable on edit (kept, never silently removed).
  if (values.ownerHandle && !owners.some((o) => o.handle === values.ownerHandle)) {
    ownerOptions.push({ value: values.ownerHandle, label: "Current owner (no longer has write access)" });
  }

  return (
    <form action={formAction} onSubmit={() => setSubmissions((n) => n + 1)} className="flex max-w-3xl flex-col gap-zw-lg" noValidate data-testid="contact-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      {contactId && <input type="hidden" name="contactId" value={contactId} />}
      {expectedVersion && <input type="hidden" name="expectedVersion" value={expectedVersion} />}

      {state.status === "error" && state.message && (
        <AttentionState level="critical" title="Not saved" description={state.message} />
      )}

      {state.status === "duplicates" && (
        <Panel className="flex flex-col gap-zw-md border-warning-border" data-testid="contact-duplicates">
          <AttentionState level="warning" title="Possible duplicate" description={state.message ?? ""} />
          {state.duplicates && state.duplicates.length > 0 && (
            <ul className="flex flex-col gap-2">
              {state.duplicates.map((d) => (
                <li key={d.contactId} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border-subtle px-3 py-2">
                  <span className={cn(typography.bodySmall, "text-text-primary")}>
                    <Link href={`/operations/growth/contacts/${d.contactId}`} className="text-text-link hover:underline">
                      {d.displayName}
                    </Link>
                    {d.status === "archived" && <span className="ml-2 text-text-muted">(archived)</span>}
                  </span>
                  <span className={cn(typography.metadata, "text-text-secondary")}>{describeMatch(d.matchOn)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            Nothing has been created yet. Contacts are never merged automatically: open a match above, or create a separate contact if this is a different person.
          </p>
          <div>
            <Button type="submit" name="confirmDuplicate" value="true" variant="outline" loading={pending} disabled={pending} data-testid="contact-confirm-duplicate">
              Create as a separate contact
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="flex flex-col gap-zw-md" key={formKey}>
        <Input
          name="displayName"
          label="Name"
          required
          maxLength={CONTACT_LIMITS.name}
          defaultValue={values.displayName}
          error={errors.displayName}
          autoComplete="off"
        />
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Input name="phone" label="Phone" type="tel" maxLength={CONTACT_LIMITS.phone} defaultValue={values.phone} error={errors.phone} autoComplete="off" />
          <Input name="email" label="Email" type="email" maxLength={CONTACT_LIMITS.email} defaultValue={values.email} error={errors.email} autoComplete="off" />
        </div>
        <p className={cn(typography.metadata, errors.form ? "text-critical-text" : "text-text-secondary")}>
          A phone number or an email address is required.
        </p>
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Select name="contactKind" label="Contact type" required options={CONTACT_KIND_OPTIONS} defaultValue={values.contactKind} error={errors.contactKind} />
          <Input
            name="jobTitle"
            label="Role or relationship (optional)"
            maxLength={CONTACT_LIMITS.jobTitle}
            defaultValue={values.jobTitle}
            error={errors.jobTitle}
            helpText="For example: discharge planner, daughter, office manager."
          />
        </div>
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Select name="preferredChannel" label="Preferred channel" required options={CONTACT_CHANNEL_OPTIONS} defaultValue={values.preferredChannel} error={errors.preferredChannel} />
          <Select name="ownerHandle" label="Owner (optional)" options={ownerOptions} defaultValue={values.ownerHandle} error={errors.ownerHandle} helpText="Someone in your team with Nemryn Plus write access." />
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-sm border border-border-subtle p-3">
          <input type="checkbox" name="doNotContact" defaultChecked={values.doNotContact} className="mt-1 size-4" />
          <span>
            <span className={cn(typography.label, "block text-text-primary")}>Do not contact</span>
            <span className={cn(typography.metadata, "block text-text-secondary")}>{DO_NOT_CONTACT_HELP}</span>
          </span>
        </label>
        <p className={cn(typography.metadata, "text-text-secondary")} data-testid="contact-privacy-notice">
          {NO_MEDICAL_DETAILS_NOTICE} Only use fictional test data until Nemryn confirms Plus is cleared for real customer records.
        </p>
      </Panel>

      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton href={cancelHref} variant="outline">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending} disabled={pending} data-testid="contact-save">
          {mode === "create" ? "Create contact" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
