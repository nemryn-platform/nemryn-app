"use client";

import { useActionState, useState } from "react";
import { createOpportunityAction, updateOpportunityAction, type OpportunityFormState } from "@/app/operations/growth/pipeline/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { FormSection } from "@/components/operations/new-trip/FormSection";
import { GuidancePanel } from "@/components/growth/GuidancePanel";
import { CurrencyDollar, Funnel, Handshake } from "@phosphor-icons/react/dist/ssr";
import { Select } from "@/components/ui/Select";
import {
  ESTIMATE_NOTE,
  INQUIRY_OPTIONS,
  OPPORTUNITY_LIMITS,
  PAYMENT_OPTIONS,
  PAYMENT_REPORTED_NOTE,
  SERVICE_OPTIONS,
  SOURCE_OPTIONS,
  type OpportunityFormValues,
} from "@/lib/plus/opportunities-core";
import { NO_MEDICAL_DETAILS_NOTICE } from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: OpportunityFormState = { status: "idle" };

export interface ChoiceOption {
  value: string;
  label: string;
}

/**
 * New / Edit private-pay opportunity (NP-P2-S1). Server-validated: the action and the database re-check the contact
 * (an active contact of this organization), every value, the owner and -- on edit -- the version. Only minimum,
 * non-medical sales fields exist. Saving never creates a booking, Passenger or Trip.
 */
export function OpportunityForm({
  mode,
  organizationId,
  initial,
  contactOptions,
  owners,
  opportunityId,
  expectedVersion,
  cancelHref,
}: {
  mode: "create" | "edit";
  organizationId: string;
  initial: OpportunityFormValues;
  /** The contact is fixed on create (chosen in the previous step); on edit, active contacts (plus the current one). */
  contactOptions: ChoiceOption[];
  owners: ChoiceOption[];
  opportunityId?: string;
  expectedVersion?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(mode === "create" ? createOpportunityAction : updateOpportunityAction, IDLE);
  const values = state.values ?? initial;
  const errors = state.errors ?? {};
  const [submissions, setSubmissions] = useState(0);
  const formKey = `${submissions}:${state.status}`;
  const ownerOptions = [{ value: "", label: "No owner" }, ...owners];
  if (values.ownerHandle && !owners.some((o) => o.value === values.ownerHandle)) {
    ownerOptions.push({ value: values.ownerHandle, label: "Current owner (no longer has write access)" });
  }

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmissions((n) => n + 1)}
      className="grid grid-cols-1 items-start gap-zw-lg xl:grid-cols-[minmax(0,1fr)_360px]"
      noValidate
      data-testid="opportunity-form"
    >
      <div className="flex min-w-0 flex-col gap-zw-lg">
      <input type="hidden" name="organizationId" value={organizationId} />
      {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
      {expectedVersion && <input type="hidden" name="expectedVersion" value={expectedVersion} />}

      {state.status === "error" && (state.message || Object.keys(errors).length > 0) && (
        <AttentionState level="critical" title="Not saved" description={state.message ?? "Check the highlighted fields."} />
      )}

      {/* NP-UI-V2-3 final polish: the established form anatomy (FormSection) -- the same fields, names, defaults and
          validation as before, grouped into three sections. */}
      <div className="flex flex-col gap-zw-lg" key={formKey}>
        <FormSection icon={<Handshake className="size-5" aria-hidden />} title="Opportunity">
          {mode === "create" ? (
            <>
              <input type="hidden" name="contactId" value={values.contactId} />
              <div>
                <p className={cn(typography.label, "text-text-primary")}>Contact</p>
                <p className={cn(typography.body, "text-text-primary")} data-testid="opportunity-contact">
                  {contactOptions.find((c) => c.value === values.contactId)?.label ?? "—"}
                </p>
              </div>
            </>
          ) : (
            <Select name="contactId" label="Contact" required options={contactOptions} defaultValue={values.contactId} error={errors.contactId} />
          )}
          <Input
            name="title"
            label="Title"
            required
            maxLength={OPPORTUNITY_LIMITS.title}
            defaultValue={values.title}
            error={errors.title}
            helpText="A short label for this sales conversation, e.g. 'Weekly rides to dialysis'."
            autoComplete="off"
          />
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Select name="inquiryType" label="They asked about" required options={INQUIRY_OPTIONS} defaultValue={values.inquiryType} error={errors.inquiryType} />
            <Select name="serviceType" label="Service (optional)" options={[{ value: "", label: "Not specified" }, ...SERVICE_OPTIONS]} defaultValue={values.serviceType} error={errors.serviceType} />
          </div>
        </FormSection>

        <FormSection icon={<Funnel className="size-5" aria-hidden />} title="Source & ownership">
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Select name="source" label="How they found you" required options={SOURCE_OPTIONS} defaultValue={values.source} error={errors.source} />
            <Input name="sourceDetail" label="Source detail (optional)" maxLength={OPPORTUNITY_LIMITS.sourceDetail} defaultValue={values.sourceDetail} error={errors.sourceDetail} helpText="For example: who referred them." />
          </div>
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Select name="ownerHandle" label="Owner (optional)" options={ownerOptions} defaultValue={values.ownerHandle} error={errors.ownerHandle} />
            <Input name="campaignCode" label="Campaign code (optional)" maxLength={OPPORTUNITY_LIMITS.campaign} defaultValue={values.campaignCode} error={errors.campaignCode} helpText="Lowercase, e.g. spring_2026." autoComplete="off" />
          </div>
        </FormSection>

        <FormSection icon={<CurrencyDollar className="size-5" aria-hidden />} title="Value">
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Input name="estimate" label="Estimated value, USD (optional)" inputMode="decimal" defaultValue={values.estimate} error={errors.estimate} helpText={ESTIMATE_NOTE} autoComplete="off" />
            {mode === "edit" && (
              <Select name="paymentReportedStatus" label="Payment (reported by staff)" options={PAYMENT_OPTIONS} defaultValue={values.paymentReportedStatus} error={errors.paymentReportedStatus} helpText={PAYMENT_REPORTED_NOTE} />
            )}
          </div>
        </FormSection>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton href={cancelHref} variant="outline">
          Cancel
        </LinkButton>
        <Button type="submit" loading={pending} disabled={pending} data-testid="opportunity-save">
          {mode === "create" ? "Create opportunity" : "Save changes"}
        </Button>
      </div>
      </div>

      <GuidancePanel testId="opportunity-privacy-notice">
        {NO_MEDICAL_DETAILS_NOTICE} Saving an opportunity doesn&apos;t create a booking.
      </GuidancePanel>
    </form>
  );
}
