"use client";

import { useActionState, useId, useState } from "react";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { inquiryFormAction, type InquiryFormActionState } from "@/app/operations/settings/plus/actions";
import { CopyValue } from "@/components/operations/settings/CopyValue";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { FORM_LIMITS, buildInquiryEmbedSnippet, buildInquiryHostedUrl, inquiryFormStatusLabel } from "@/lib/plus/inquiries-core";
import type { InquiryFormSettings } from "@/lib/plus/inquiries";
import { SERVICE_LABELS } from "@/lib/plus-inquiry/inquiry-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: InquiryFormActionState = { status: "idle" };

const serviceLabel = (s: string) => SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s;

/**
 * Settings -> Nemryn Plus -> Inquiry form (NP-P2-S7-C). Admins write the headline, the short introduction and the
 * services the form offers, save a draft, publish and turn the form off. Public submissions need BOTH Nemryn's
 * activation for this workspace and the server's public-inquiry switch; neither can be changed here, and the page says
 * plainly when either is off. Edits to a published form apply live, so saving one asks first.
 */
export function InquiryFormSection({
  organizationId,
  form,
  canEdit,
  submissionsSwitchOn,
  origin,
}: {
  organizationId: string;
  form: InquiryFormSettings;
  /** Plus write (an Organization Admin is the only viewer of Settings). False while Plus is read-only. */
  canEdit: boolean;
  submissionsSwitchOn: boolean;
  /** null when the app's address couldn't be determined: the link and code are not shown. */
  origin: string | null;
}) {
  const [state, action, pending] = useActionState(inquiryFormAction, IDLE);
  const [confirmLive, setConfirmLive] = useState(false);
  const formId = useId();
  const status = inquiryFormStatusLabel(form.status);
  const published = form.status === "published";
  const live = published && form.publicAccessEnabled && submissionsSwitchOn;
  const version = form.version === null ? "" : String(form.version);
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="plus-inquiry-form">
      <SectionHeader
        title="Inquiry form"
        icon={<ChatCircleText />}
        tone="accent"
        description="A short form for your website where people can ask a question. Answers arrive in Growth → Inquiries. It never creates a booking request."
        actions={<StatusBadge label={status.label} category={status.tone} />}
      />

      {!form.publicAccessEnabled || !submissionsSwitchOn ? (
        <div data-testid="plus-inquiry-form-activation">
          <AttentionState
            level="info"
            title="Public inquiries aren't turned on yet"
            description={
              "You can prepare and save the form now. People can send inquiries only after Nemryn turns public inquiries on " +
              "for this workspace and on the Nemryn servers. Until then the form's link and website code show that it isn't available."
            }
          />
          <ul className={cn(typography.metadata, "mt-2 list-disc pl-5 text-text-muted")}>
            <li>This workspace: {form.publicAccessEnabled ? "turned on by Nemryn" : "not turned on yet"}</li>
            <li>Nemryn servers: {submissionsSwitchOn ? "accepting public inquiries" : "not accepting public inquiries yet"}</li>
          </ul>
        </div>
      ) : null}

      {!canEdit && (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>Nemryn Plus is not active, so the form can be viewed but not changed.</p>
      )}

      <form id={formId} action={action} className="flex flex-col gap-zw-md" data-testid="plus-inquiry-form-settings">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <Input
          name="headline"
          label="Headline"
          required
          maxLength={FORM_LIMITS.headline}
          defaultValue={form.headline ?? "Ask us a question"}
          error={errors?.headline}
          disabled={!canEdit || pending}
          data-testid="plus-inquiry-form-headline"
        />
        <Textarea
          name="introText"
          label="Introduction (optional)"
          rows={3}
          maxLength={FORM_LIMITS.intro}
          defaultValue={form.introText ?? ""}
          helpText="One or two sentences shown above the form."
          error={errors?.introText}
          disabled={!canEdit || pending}
        />
        <fieldset className="flex flex-col gap-2" disabled={!canEdit || pending} data-testid="plus-inquiry-form-services">
          <legend className={cn(typography.label, "mb-1 text-text-primary")}>Services people can choose</legend>
          {form.serviceOptions.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>No services are set up for this workspace. The form won&apos;t ask about a service.</p>
          ) : (
            form.serviceOptions.map((s) => <Checkbox key={s} name="services" value={s} label={serviceLabel(s)} defaultChecked={form.offeredServiceTypes.includes(s)} />)
          )}
          <p className={cn(typography.metadata, "text-text-muted")}>Only the services your workspace offers are listed. Leave all unticked to skip the question.</p>
          {errors?.services && <p className={cn(typography.bodySmall, "text-critical-text")}>{errors.services}</p>}
        </fieldset>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {published ? (
              <Button type="button" onClick={() => setConfirmLive(true)} loading={pending} disabled={pending} data-testid="plus-inquiry-form-save">
                Save changes
              </Button>
            ) : (
              <Button type="submit" name="intent" value="save" loading={pending} disabled={pending} data-testid="plus-inquiry-form-save">
                {form.formId ? "Save draft" : "Create draft"}
              </Button>
            )}
            {form.formId && !published && (
              <Button type="submit" name="intent" value="publish" variant="outline" disabled={pending} data-testid="plus-inquiry-form-publish">
                Publish
              </Button>
            )}
            {published && (
              <Button type="submit" name="intent" value="disable" variant="destructive-outline" disabled={pending} data-testid="plus-inquiry-form-disable">
                Turn off
              </Button>
            )}
          </div>
        )}
        {state.status !== "idle" && state.message && (
          <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")} data-testid="plus-inquiry-form-message">
            {state.message}
          </p>
        )}
      </form>

      {confirmLive && (
        <Dialog open onClose={() => setConfirmLive(false)} title="Save changes to the live form?" description="The form is published, so these changes show on your website as soon as you save.">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmLive(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} name="intent" value="save" onClick={() => setConfirmLive(false)} data-testid="plus-inquiry-form-save-confirm">
              Save changes
            </Button>
          </div>
        </Dialog>
      )}

      {form.publicKey && (published || form.status === "disabled") && (
        <div className="flex flex-col gap-zw-md border-t border-border-subtle pt-zw-md" data-testid="plus-inquiry-form-share">
          <p className={cn(typography.subsectionHeading, "text-text-primary")}>Add it to your website</p>
          {origin === null ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="plus-inquiry-form-share-unavailable">
              The link and website code can&apos;t be shown right now. Reload the page, or contact Nemryn if this continues.
            </p>
          ) : (
            <>
              {!live && (
                <p className={cn(typography.bodySmall, "text-text-secondary")}>
                  {published ? "The link and code are ready, but people can't send inquiries until public inquiries are turned on." : "The form is turned off. The link and code show that it isn't available until you publish again."}
                </p>
              )}
              <div className="flex flex-col gap-1">
                <p className={cn(typography.label, "text-text-primary")}>Link to the form</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className={cn(typography.bodySmall, "min-w-0 break-all rounded-sm bg-surface-secondary px-2 py-1")} data-testid="plus-inquiry-form-link">
                    {buildInquiryHostedUrl(origin, form.publicKey)}
                  </code>
                  <CopyValue value={buildInquiryHostedUrl(origin, form.publicKey)} label="Inquiry form link" buttonLabel="Copy link" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <p className={cn(typography.label, "text-text-primary")}>Website code</p>
                <p className={cn(typography.metadata, "text-text-muted")}>Paste this where the form should appear on your website.</p>
                <pre className={cn(typography.bodySmall, "overflow-x-auto whitespace-pre rounded-sm bg-surface-secondary p-3")} data-testid="plus-inquiry-form-snippet">
                  {buildInquiryEmbedSnippet(origin, form.publicKey)}
                </pre>
                <div>
                  <CopyValue value={buildInquiryEmbedSnippet(origin, form.publicKey)} label="Inquiry form website code" buttonLabel="Copy code" />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
