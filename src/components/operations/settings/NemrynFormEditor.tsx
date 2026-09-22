"use client";

import { useActionState, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveWebsiteRequestFormAction, type WebsiteRequestFormActionState } from "@/app/operations/settings/website-requests/actions";
import { FormPreview } from "./FormPreview";
import { UseMethodForm } from "./ConnectionSetupControls";
import { FormPublishPanel, type FormPublishPanelProps } from "./FormPublishPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Panel } from "@/components/ui/Panel";
import {
  FORM_LIMITS,
  FORM_SERVICE_LABELS,
  FORM_SERVICE_VALUES,
  FORM_STATE_LABEL,
  buildFormPreview,
  deriveFormState,
  effectiveFormServices,
  formServicesNeedAttention,
  formVersionLabel,
  isWebsiteManager,
  type FormConfig,
  type WebsiteManager,
} from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: WebsiteRequestFormActionState = { status: "idle" };

export interface NemrynFormEditorProps {
  organizationName: string;
  /** null = never configured (defaults are shown as a starting point). */
  saved: (FormConfig & { version: number }) | null;
  initial: FormConfig;
  /** What the organization currently offers under Settings -> Services & Intake (empty = never configured = all). */
  orgServices: string[];
  connectionHandle: string | null;
  websiteManager: string | null;
  /** P1-COMM-D2: publication state of the SAVED form (null = never published) and this deployment's origin. */
  publication: FormPublishPanelProps["publication"];
  origin: string;
}

/** Nemryn form configuration: the operator chooses wording and which offered services appear. Fields required by intake can't be hidden. */
export function NemrynFormEditor({ organizationName, saved, initial, orgServices, connectionHandle, websiteManager, publication, origin }: NemrynFormEditorProps) {
  const [state, action, pending] = useActionState(saveWebsiteRequestFormAction, IDLE);
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [introText, setIntroText] = useState(initial.introText ?? "");
  const [submitLabel, setSubmitLabel] = useState(initial.submitLabel);
  const [confirmation, setConfirmation] = useState(initial.confirmationMessage);
  const [allServices, setAllServices] = useState(initial.offeredServiceTypes === null);
  const [subset, setSubset] = useState<string[]>(initial.offeredServiceTypes ?? []);
  const [allowRecurring, setAllowRecurring] = useState(initial.allowRecurring);
  const [requireService, setRequireService] = useState(initial.requireServiceChoice);
  const [status, setStatus] = useState<"draft" | "ready">(initial.status);
  const manager: WebsiteManager | "" = isWebsiteManager(websiteManager) ? websiteManager : "";

  const orgOffered = useMemo(() => effectiveFormServices(orgServices, null), [orgServices]);
  const offeredNow = effectiveFormServices(orgServices, allServices ? null : subset);
  const needsAttention = saved ? formServicesNeedAttention(orgServices, saved.offeredServiceTypes) : false;

  const draftConfig: FormConfig = {
    status,
    title,
    introText: introText.trim() === "" ? null : introText,
    submitLabel,
    confirmationMessage: confirmation,
    offeredServiceTypes: allServices ? null : subset,
    allowRecurring,
    requireServiceChoice: requireService,
  };
  const previewVersion = saved ? saved.version : 1;
  const preview = buildFormPreview({ organizationName, config: draftConfig, services: offeredNow, version: previewVersion });
  const formState = deriveFormState(saved);
  const fieldError = (field: string) => (state.status === "error" && state.field === field ? state.message : undefined);
  const dirty = saved
    ? saved.status !== draftConfig.status || saved.title !== draftConfig.title || (saved.introText ?? null) !== draftConfig.introText || saved.submitLabel !== draftConfig.submitLabel
      || saved.confirmationMessage !== draftConfig.confirmationMessage || saved.allowRecurring !== draftConfig.allowRecurring || saved.requireServiceChoice !== draftConfig.requireServiceChoice
      || JSON.stringify(saved.offeredServiceTypes === null ? null : [...saved.offeredServiceTypes].sort()) !== JSON.stringify(draftConfig.offeredServiceTypes === null ? null : [...draftConfig.offeredServiceTypes].sort())
    : false;

  // Submitted through a handler instead of <form action>: React resets an action form's DOM after it runs, which would
  // desynchronise these controlled radios/checkboxes from their state and make the next save silently change the form.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  function toggleService(value: string) {
    setSubset((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  }

  return (
    <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-2">
      <div className="flex flex-col gap-zw-lg">
        <Panel className="flex flex-col gap-zw-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Nemryn form</h2>
            <span data-testid="form-state" className={cn(typography.label, "rounded-sm bg-surface-secondary px-2 py-0.5 text-text-secondary")}>
              {FORM_STATE_LABEL[formState]}
            </span>
            {saved && <span className={cn(typography.metadata, "text-text-muted")}>Version {formVersionLabel(saved.version)}</span>}
          </div>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            Set up the form your passengers and families will see. Nemryn always asks for the details dispatch needs to schedule a trip, so those questions can&apos;t be removed.
          </p>
          <p className={cn(typography.metadata, "text-text-muted")}>
            Editing the form never changes what is live: publish below when you&apos;re ready. Publishing is separate from whether a website is connected.
          </p>
        </Panel>

        <form onSubmit={onSubmit} className="flex flex-col gap-zw-lg" noValidate>
          <Panel className="flex flex-col gap-zw-md">
            <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Wording</h3>
            <Input label="Form title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={FORM_LIMITS.title} required error={fieldError("title")} />
            <Textarea label="Introduction (optional)" name="introText" rows={3} value={introText} onChange={(e) => setIntroText(e.target.value)} maxLength={FORM_LIMITS.intro} error={fieldError("introText")} />
            <Input label="Submit button text" name="submitLabel" value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} maxLength={FORM_LIMITS.submitLabel} required error={fieldError("submitLabel")} />
            <Textarea label="Confirmation message" name="confirmationMessage" rows={3} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} maxLength={FORM_LIMITS.confirmation} required helpText="Shown after a request is sent." error={fieldError("confirmationMessage")} />
          </Panel>

          <Panel className="flex flex-col gap-zw-md">
            <fieldset className="flex flex-col gap-zw-sm">
              <legend className={cn(typography.subsectionHeading, "text-text-primary")}>Services shown on the form</legend>
              <p className={cn(typography.bodySmall, "text-text-secondary")}>
                Only services your organization offers can appear. Manage what you offer in{" "}
                <a href="/operations/settings/services" className="text-text-link underline">Services &amp; Intake</a>.
              </p>
              <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
                <input type="radio" name="serviceMode" value="all" checked={allServices} onChange={() => setAllServices(true)} /> Every service we offer
              </label>
              <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
                <input type="radio" name="serviceMode" value="subset" checked={!allServices} onChange={() => setAllServices(false)} /> Only the services I choose
              </label>
              {!allServices && (
                <div className="flex flex-col gap-1 pl-6">
                  {FORM_SERVICE_VALUES.map((value) => {
                    const offered = orgOffered.includes(value);
                    return (
                      <label key={value} className={cn(typography.bodySmall, "flex items-center gap-2", offered ? "text-text-primary" : "text-text-muted")}>
                        <input
                          type="checkbox"
                          name="service"
                          value={value}
                          checked={subset.includes(value) && offered}
                          disabled={!offered}
                          onChange={() => toggleService(value)}
                        />
                        {FORM_SERVICE_LABELS[value]}
                        {!offered && <span className={typography.metadata}>(not offered by your organization)</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              {fieldError("services") && <p role="alert" className={cn(typography.metadata, "text-critical-text")}>{fieldError("services")}</p>}
              {needsAttention && (
                <p role="status" data-testid="services-attention" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary p-2 text-text-primary")}>
                  One or more services you chose are no longer offered by your organization, so the form is showing fewer services. Review Services &amp; Intake or update your choices here.
                </p>
              )}
              {offeredNow.length === 0 && (
                <p className={cn(typography.metadata, "text-text-muted")}>No service list will be shown; requests will be reviewed as general transportation requests.</p>
              )}
            </fieldset>
            <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
              <input type="checkbox" name="requireServiceChoice" checked={requireService} onChange={(e) => setRequireService(e.target.checked)} /> Ask people to choose a service
            </label>
            <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
              <input type="checkbox" name="allowRecurring" checked={allowRecurring} onChange={(e) => setAllowRecurring(e.target.checked)} /> Let people say a trip repeats regularly
            </label>
          </Panel>

          <Panel className="flex flex-col gap-zw-sm">
            <fieldset className="flex flex-col gap-zw-sm">
              <legend className={cn(typography.subsectionHeading, "text-text-primary")}>Form status</legend>
              <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
                <input type="radio" name="status" value="draft" checked={status === "draft"} onChange={() => setStatus("draft")} /> Draft — still working on it
              </label>
              <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
                <input type="radio" name="status" value="ready" checked={status === "ready"} onChange={() => setStatus("ready")} /> Ready — I&apos;m happy with this form
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" size="md" loading={pending} disabled={pending}>
                Save form
              </Button>
              {state.status !== "idle" && state.message && (
                <span role={state.status === "error" ? "alert" : "status"} data-testid="form-save-message" className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
                  {state.message}
                </span>
              )}
            </div>
          </Panel>
        </form>

        <FormPublishPanel
          savedForm={saved ? { status: saved.status, version: saved.version } : null}
          dirty={dirty}
          publication={publication}
          origin={origin}
          websiteManager={websiteManager}
        />

        {connectionHandle && (
          <Panel className="flex flex-col gap-zw-sm">
            <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Your website connection</h3>
            <p className={cn(typography.bodySmall, "text-text-secondary")}>Note on your website connection that you use a Nemryn form. This only changes the instructions Nemryn shows you.</p>
            <UseMethodForm handle={connectionHandle} method="nemryn_form" manager={manager || null} label="Use a Nemryn form for my website" />
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-zw-sm lg:sticky lg:top-4 lg:self-start">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Preview</h3>
        <FormPreview preview={preview} />
      </div>
    </div>
  );
}
