"use client";

import { useActionState } from "react";
import {
  updateOrganizationSettingsAction,
  type OrganizationSettingsActionState,
} from "@/app/operations/settings/organization/actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  ORGANIZATION_SETTINGS_LIMITS,
  timezoneOptionsFor,
  type OrganizationSettingsValues,
} from "@/lib/operations/organization-settings-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: OrganizationSettingsActionState = { status: "idle" };

export interface OrganizationSettingsFormProps {
  initialValues: OrganizationSettingsValues;
}

/**
 * Settings -> Organization form. Renders only for an Organization Admin
 * (the page is guarded server-side); the submitted values are re-validated
 * by the Server Action and again by the database. No organization id is
 * ever rendered into or read from this form.
 */
export function OrganizationSettingsForm({ initialValues }: OrganizationSettingsFormProps) {
  const [state, formAction, pending] = useActionState(updateOrganizationSettingsAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};
  // After any submit, show what was submitted (normalized on success, as
  // typed on failure) -- not the page-load values -- so a rejected save
  // never wipes the person's edits.
  const current = state.values ?? initialValues;

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-zw-lg" noValidate>
      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Business profile" />
        <Input
          label="Organization name"
          name="name"
          type="text"
          autoComplete="organization"
          required
          maxLength={ORGANIZATION_SETTINGS_LIMITS.name}
          disabled={pending}
          defaultValue={current.name}
          error={errors.name}
        />
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Input
            label="Business phone"
            name="businessPhone"
            type="tel"
            autoComplete="tel"
            maxLength={ORGANIZATION_SETTINGS_LIMITS.phone}
            disabled={pending}
            defaultValue={current.businessPhone}
            error={errors.businessPhone}
          />
          <Input
            label="Business email"
            name="businessEmail"
            type="email"
            autoComplete="email"
            maxLength={ORGANIZATION_SETTINGS_LIMITS.email}
            disabled={pending}
            defaultValue={current.businessEmail}
            error={errors.businessEmail}
          />
        </div>
        <Textarea
          label="Business address"
          name="businessAddress"
          rows={3}
          maxLength={ORGANIZATION_SETTINGS_LIMITS.address}
          disabled={pending}
          defaultValue={current.businessAddress}
          error={errors.businessAddress}
        />
        <Input
          label="Primary operations contact"
          name="primaryContactName"
          type="text"
          maxLength={ORGANIZATION_SETTINGS_LIMITS.contactName}
          disabled={pending}
          defaultValue={current.primaryContactName}
          error={errors.primaryContactName}
          helpText="The person your team and partners should reach for day-to-day operations."
        />
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Operating timezone" />
        <Select
          label="Timezone"
          name="timezone"
          required
          disabled={pending}
          defaultValue={current.timezone}
          options={timezoneOptionsFor(initialValues.timezone)}
          error={errors.timezone}
          helpText="Determines what counts as today and tomorrow, and how trip and appointment times are scheduled and shown. Trips already scheduled keep their exact time; existing recurring arrangements keep the timezone they were created with."
        />
      </Panel>

      <div className="flex items-center gap-zw-md">
        <Button type="submit" variant="primary" loading={pending} disabled={pending}>
          Save changes
        </Button>
        {state.status !== "idle" && state.message && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
