"use client";

import { useActionState, useState } from "react";
import {
  disableWebsiteRequestFormAction,
  publishWebsiteRequestFormAction,
  type FormPublicationActionState,
} from "@/app/operations/settings/website-requests/actions";
import { CopyValue } from "./CopyValue";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import {
  PUBLICATION_STATE_LABEL,
  FORM_CONNECTION_EXPLANATION,
  WEBSITE_REQUESTS_STATUS_LABEL,
  buildEmbedSnippet,
  buildHostedFormUrl,
  buildIframeFallback,
  derivePublicationState,
  embedPlacementGuidance,
  formConnectionStatus,
  formVersionLabel,
  isWebsiteManager,
  publishAction,
  type WebsiteManager,
} from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: FormPublicationActionState = { status: "idle" };

export interface FormPublishPanelProps {
  /** The SAVED form (what a publish would copy); null = never configured. */
  savedForm: { status: string; version: number } | null;
  /** The editor holds changes that are not saved yet: publishing uses the saved form only. */
  dirty: boolean;
  publication: { publicKey: string; status: "published" | "disabled"; publishedVersion: number; requestCount: number; lastRequestReceived: string | null } | null;
  /** This deployment's canonical origin, resolved on the server. */
  origin: string;
  websiteManager: string | null;
}

const ACTION_LABEL = { publish: "Publish form", update: "Publish update", republish: "Publish again" } as const;

/**
 * Publish / update / disable the Nemryn form and hand the operator the two ways to use it: a hosted link and one embed snippet.
 * Three separate concepts are shown separately: the form's authoring state (the editor above), the PUBLICATION state here and the
 * CONNECTION status ("Ready to test" until a real request arrives). Editing never changes a live form -- only "Publish" does.
 * Nothing technical is shown by default: no API, keys, or ids -- only the link and the paste-in code the operator asked for.
 */
export function FormPublishPanel({ savedForm, dirty, publication, origin, websiteManager }: FormPublishPanelProps) {
  const [publishState, publishAct, publishing] = useActionState(publishWebsiteRequestFormAction, IDLE);
  const [disableState, disableAct, disabling] = useActionState(disableWebsiteRequestFormAction, IDLE);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [manager, setManager] = useState<WebsiteManager | "">(isWebsiteManager(websiteManager) ? websiteManager : "");

  const state = derivePublicationState(publication);
  const action = publishAction(savedForm, publication);
  const connection = formConnectionStatus(publication);
  const live = publication?.status === "published";
  const hostedUrl = publication ? buildHostedFormUrl(origin, publication.publicKey) : null;
  const embed = publication ? buildEmbedSnippet(origin, publication.publicKey) : null;
  const iframe = publication ? buildIframeFallback(origin, publication.publicKey) : null;
  const placement = manager ? embedPlacementGuidance(manager) : null;
  const message = [publishState, disableState].find((s) => s.status !== "idle" && s.message);

  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="form-publish-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Publish</h3>
        <span data-testid="publication-state" className={cn(typography.label, "rounded-sm bg-surface-secondary px-2 py-0.5 text-text-secondary")}>
          {PUBLICATION_STATE_LABEL[state]}
        </span>
        {publication && live && <span className={cn(typography.metadata, "text-text-muted")}>Live: {formVersionLabel(publication.publishedVersion)}</span>}
      </div>

      {!publication && (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Publishing gives you a link to a hosted form and a snippet to paste into your website. Nothing is public until you publish, and editing the form never changes what is live.
        </p>
      )}
      {action === "not_ready" && (
        <p data-testid="publish-not-ready" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary p-2 text-text-primary")}>
          {publication && live
            ? "Your published form keeps running its last published version. To publish new changes, save the form and mark it Ready."
            : "To publish, save the form and mark it Ready first."}
        </p>
      )}
      {dirty && action !== "not_ready" && (
        <p className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary p-2 text-text-primary")}>You have unsaved changes. Save the form first — publishing uses the saved form.</p>
      )}
      {live && action === "update" && !dirty && (
        <p data-testid="publish-update-available" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary p-2 text-text-primary")}>
          You&apos;ve saved changes ({formVersionLabel(savedForm?.version ?? 1)}) that aren&apos;t live yet. The public form still shows {formVersionLabel(publication?.publishedVersion ?? 1)}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {action !== "not_ready" && action !== "up_to_date" && (
          <form action={publishAct}>
            <Button type="submit" variant="primary" size="md" loading={publishing} disabled={publishing || dirty}>
              {ACTION_LABEL[action]}
            </Button>
          </form>
        )}
        {live && !confirmDisable && (
          <Button type="button" variant="outline" size="md" onClick={() => setConfirmDisable(true)}>
            Disable public form
          </Button>
        )}
        {live && confirmDisable && (
          <form action={disableAct} className="flex flex-wrap items-center gap-2">
            <span className={cn(typography.bodySmall, "text-text-primary")}>The link and the embedded form will stop accepting requests. Requests you already received are kept.</span>
            <Button type="submit" variant="destructive" size="sm" loading={disabling} disabled={disabling}>
              Disable
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisable(false)}>
              Keep it published
            </Button>
          </form>
        )}
      </div>
      {message && (
        <p role={message.status === "error" ? "alert" : "status"} data-testid="publish-message" className={cn(typography.bodySmall, message.status === "error" ? "text-critical-text" : "text-text-secondary")}>
          {message.message}
        </p>
      )}

      {publication && (
        <div className="flex flex-col gap-1" data-testid="form-connection">
          <p className={cn(typography.label, "text-text-primary")}>
            Connection: <span data-testid="form-connection-status">{WEBSITE_REQUESTS_STATUS_LABEL[connection]}</span>
          </p>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            {FORM_CONNECTION_EXPLANATION[connection]}
            {publication.requestCount > 0 && ` ${publication.requestCount} received${publication.lastRequestReceived ? `, most recently ${publication.lastRequestReceived}` : ""}.`}
          </p>
        </div>
      )}

      {live && hostedUrl && embed && iframe && (
        <>
          <div className="flex flex-col gap-2" data-testid="hosted-form">
            <p className={cn(typography.label, "text-text-primary")}>Hosted form</p>
            <p className={cn(typography.bodySmall, "text-text-secondary")}>Share this link, or add it as a button on your website.</p>
            <p className={cn(typography.bodySmall, "break-all font-mono text-text-primary")}>{hostedUrl}</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={hostedUrl} target="_blank" rel="noopener noreferrer" className={cn(typography.label, "rounded-sm border border-border-strong px-3 py-2 text-text-primary")}>
                Open form
              </a>
              <CopyValue value={hostedUrl} label="hosted form link" buttonLabel="Copy link" size="md" />
            </div>
          </div>

          <div className="flex flex-col gap-2" data-testid="website-embed">
            <p className={cn(typography.label, "text-text-primary")}>Website embed</p>
            <p className={cn(typography.bodySmall, "text-text-secondary")}>Paste this code into the page of your website where the form should appear.</p>
            <div className="flex flex-wrap items-center gap-2">
              <CopyValue value={embed} label="embed code" buttonLabel="Copy embed code" size="md" />
            </div>
            <label className={cn(typography.bodySmall, "flex flex-col gap-1 text-text-primary")}>
              Who manages your website?
              <select
                value={manager}
                onChange={(e) => setManager(isWebsiteManager(e.target.value) ? e.target.value : "")}
                className="w-full max-w-xs rounded-sm border border-border-subtle bg-surface-primary px-3 py-2 text-text-primary"
              >
                <option value="">Choose…</option>
                <option value="wordpress">WordPress</option>
                <option value="wix">Wix</option>
                <option value="squarespace">Squarespace</option>
                <option value="webflow">Webflow</option>
                <option value="developer">A developer or agency</option>
                <option value="other_builder">Another website builder</option>
                <option value="self">I edit the HTML myself</option>
                <option value="not_sure">I&apos;m not sure</option>
              </select>
            </label>
            {placement && (
              <div data-testid="embed-guidance" className="flex flex-col gap-1">
                <p className={cn(typography.bodySmall, "text-text-secondary")}>{placement.where}</p>
                {placement.limits && <p className={cn(typography.bodySmall, "text-text-secondary")}>{placement.limits}</p>}
              </div>
            )}
            <details className="rounded-sm border border-border-subtle">
              <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>Show the embed code</summary>
              <pre className={cn(typography.metadata, "overflow-x-auto whitespace-pre-wrap border-t border-border-subtle bg-surface-secondary p-3 font-mono text-text-primary")}>{embed}</pre>
            </details>
            <details className="rounded-sm border border-border-subtle">
              <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>My website removes scripts</summary>
              <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
                <p className={cn(typography.bodySmall, "text-text-secondary")}>
                  Use this simpler version. It works without scripts, but it can&apos;t resize itself to fit the form and Nemryn can&apos;t see which page or campaign a visitor came from.
                </p>
                <pre className={cn(typography.metadata, "overflow-x-auto whitespace-pre-wrap rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{iframe}</pre>
                <CopyValue value={iframe} label="simple embed code" buttonLabel="Copy simple embed code" size="md" />
              </div>
            </details>
          </div>

          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            To test it, open the hosted form and send a test request. It appears in your Request Hub, and the connection above changes to Connected.
          </p>
        </>
      )}
    </Panel>
  );
}
