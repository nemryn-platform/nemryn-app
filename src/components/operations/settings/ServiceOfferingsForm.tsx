"use client";

import { useActionState } from "react";
import { saveServiceOfferingsAction, type ServiceOfferingsActionState } from "@/app/operations/settings/services/actions";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SERVICE_OFFERING_OPTIONS } from "@/lib/operations/organization-services-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: ServiceOfferingsActionState = { status: "idle" };

export interface ServiceOfferingsFormProps {
  /** Enabled canonical service ids. Empty = the organization has not configured its services yet. */
  enabled: string[];
}

export function ServiceOfferingsForm({ enabled }: ServiceOfferingsFormProps) {
  const [state, action, pending] = useActionState(saveServiceOfferingsAction, IDLE);
  const configured = enabled.length > 0;
  // After a submit, show what was submitted (normalized on success, as chosen on failure).
  const current = state.selected ?? enabled;
  const initiallyChecked = (value: string) => (configured || state.selected ? current.includes(value) : false);

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-zw-lg" noValidate>
      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Services we provide" />
        <p className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary px-3 py-2 text-text-secondary")}>
          {configured
            ? "Website requests for a service you haven't selected will be declined. Requests already received are not affected."
            : "You haven't chosen your services yet, so your website currently accepts requests for any service type. Once you save, only the services you select will be accepted."}
        </p>
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="sr-only">Services we provide</legend>
          {SERVICE_OFFERING_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-sm border border-border-subtle px-3 py-2.5 hover:bg-surface-hover">
              <input type="checkbox" name="service" value={option.value} defaultChecked={initiallyChecked(option.value)} className="size-4" />
              <span className={cn(typography.body, "text-text-primary")}>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </Panel>

      <div className="flex items-center gap-zw-md">
        <Button type="submit" loading={pending} disabled={pending}>
          Save changes
        </Button>
        {state.status !== "idle" && state.message && (
          <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
