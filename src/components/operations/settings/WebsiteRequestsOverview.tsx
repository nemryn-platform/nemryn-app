"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, GlobeHemisphereWest, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  ActivateButton,
  ConnectDialog,
  DeleteConnectionDialog,
  DisableDialog,
  EditDialog,
  RemoveConnectionDialog,
  SoftBreak,
  STATUS_CATEGORY,
  ValueRow,
  type PreviousConnectionView,
  type WebsiteRequestsConnectionView,
} from "./WebsiteConnectionControls";
import { connectionMethodLabel } from "@/lib/operations/website-requests-core";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  CONNECTION_METHOD_CARDS,
  FORM_STATE_LABEL,
  PUBLICATION_STATE_LABEL,
  FORM_CONNECTION_EXPLANATION,
  WEBSITE_REQUESTS_STATUS_LABEL,
  derivePublicationState,
  formConnectionStatus,
  type FormState,
} from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface WebsiteRequestsOverviewProps {
  connections: WebsiteRequestsConnectionView[];
  endpoint: string;
  formState: FormState;
  formVersionLabel: string | null;
  servicesSummary: { configured: boolean; text: string } | null;
  /** P1-COMM-D2: the published Nemryn form (null = never published). */
  publication: { status: "published" | "disabled"; versionLabel: string; requestCount: number; lastRequestReceived: string | null } | null;
  /** P1-COMM-D2A: retired connections (history only -- a deleted, never-used connection no longer exists anywhere). */
  previousConnections: PreviousConnectionView[];
}

function PreviousConnectionsSection({ connections }: { connections: PreviousConnectionView[] }) {
  if (connections.length === 0) return null;
  return (
    <details className="rounded-sm border border-border-subtle">
      <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>
        Previous connections ({connections.length})
      </summary>
      <div className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
        {connections.map((connection, index) => (
          <div key={`${connection.website ?? "connection"}-${index}`} className="flex flex-col gap-1 p-3">
            <p className={cn(typography.body, "min-w-0 break-words text-text-primary")}>{connection.website ?? "Website not set"}</p>
            <p className={cn(typography.metadata, "text-text-muted")}>
              {connectionMethodLabel(connection.connectionMethod)} · retired {connection.retiredAt} · {connection.requestCount} request{connection.requestCount === 1 ? "" : "s"} received
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function FormPublicationCard({ publication }: { publication: NonNullable<WebsiteRequestsOverviewProps["publication"]> }) {
  const connection = formConnectionStatus(publication);
  return (
    <Panel className="flex flex-col gap-zw-sm" data-testid="form-publication-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={cn(typography.metadata, "text-text-muted")}>Nemryn form</span>
          <span className={cn(typography.subsectionHeading, "text-text-primary")}>
            {PUBLICATION_STATE_LABEL[derivePublicationState(publication)]} · {publication.versionLabel}
          </span>
        </div>
        <StatusBadge label={WEBSITE_REQUESTS_STATUS_LABEL[connection]} category={STATUS_CATEGORY[connection]} />
      </div>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>{FORM_CONNECTION_EXPLANATION[connection]}</p>
      <p className={cn(typography.metadata, "text-text-muted")}>
        Requests received: {publication.requestCount}
        {publication.lastRequestReceived ? ` · last ${publication.lastRequestReceived}` : ""}
      </p>
      <Link href="/operations/settings/website-requests/form" className={cn(typography.label, "inline-flex items-center gap-1 text-text-link")}>
        Manage your form, link and embed code
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </Panel>
  );
}

function FlowStrip() {
  const steps = ["Customer submits a request", "Your website", "Nemryn Request Hub"];
  return (
    <ol className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-secondary p-zw-md sm:flex-row sm:items-center sm:gap-3" aria-label="How website requests reach Nemryn">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-3">
          <span className={cn(typography.label, "rounded-sm bg-surface-elevated px-3 py-1.5 text-text-primary")}>{step}</span>
          {index < steps.length - 1 && <ArrowRight className="hidden size-4 shrink-0 text-text-muted sm:block" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function ConnectionCard({
  connection,
  endpoint,
  servicesSummary,
  onGone,
}: {
  connection: WebsiteRequestsConnectionView;
  endpoint: string;
  servicesSummary: { configured: boolean; text: string } | null;
  /** Delete/Remove make this card disappear -- the confirmation message is shown at the PAGE level, not inside the card. */
  onGone: (message: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const closeDisable = useCallback(() => setDisableOpen(false), []);
  const closeDelete = useCallback(() => setDeleteOpen(false), []);
  const closeRemove = useCallback(() => setRemoveOpen(false), []);
  const onDone = useCallback((message: string) => setNotice(message || null), []);
  const isUnused = connection.requestCount === 0;

  return (
    <Panel className="flex flex-col gap-zw-md" aria-label={`Website connection ${connection.website ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(typography.label, "text-text-muted")}>Website</p>
          <p className={cn(typography.subsectionHeading, "min-w-0 break-words text-text-primary")}>{connection.website ?? "Not set"}</p>
        </div>
        <StatusBadge label={connection.statusLabel} category={STATUS_CATEGORY[connection.status]} />
      </div>

      <p className={cn(typography.bodySmall, "text-text-secondary")}>{connection.statusExplanation}</p>

      {notice && (
        <p role="status" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary px-3 py-2 text-text-primary")}>
          {notice}
        </p>
      )}

      <dl className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
        <ValueRow label="Requests received">{connection.requestCount}</ValueRow>
        <ValueRow label="Last request">{connection.lastRequestReceived ?? "Never"}</ValueRow>
        <ValueRow label="Connected through">{connection.methodLabel}</ValueRow>
        {servicesSummary && (
          <ValueRow label="Services accepted">
            {servicesSummary.text}
            {!servicesSummary.configured && (
              <span className={cn(typography.metadata, "block text-text-muted")}>
                Not set yet — <Link href="/operations/settings/services" className="font-medium text-text-link">choose your services</Link>
              </span>
            )}
          </ValueRow>
        )}
      </dl>

      <div className="flex flex-col gap-1.5 rounded-sm bg-surface-secondary px-3 py-2">
        <p className={cn(typography.label, "text-text-primary")}>Test your connection</p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          After turning this on, submit one test transportation request through your website. When Nemryn receives it, the connection will show Connected.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        {connection.isActive ? (
          <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setDisableOpen(true); }}>
            Turn off
          </Button>
        ) : (
          <ActivateButton integration={connection} onDone={onDone} />
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setEditOpen(true); }}>
          Change website
        </Button>
        {isUnused ? (
          <Button type="button" size="sm" variant="text" className="ml-auto text-critical-text" onClick={() => { setNotice(null); setDeleteOpen(true); }}>
            Delete connection
          </Button>
        ) : (
          <Button type="button" size="sm" variant="text" className="ml-auto text-critical-text" onClick={() => { setNotice(null); setRemoveOpen(true); }}>
            Remove connection
          </Button>
        )}
      </div>

      <details className="group rounded-sm border border-border-subtle">
        <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>Technical details</summary>
        <div className="flex flex-col gap-zw-md border-t border-border-subtle p-3">
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            Only needed by whoever sets up your website. The{" "}
            <Link href={`/operations/settings/website-requests/developer?connection=${encodeURIComponent(connection.handle)}`} className="font-medium text-text-link">
              developer setup
            </Link>{" "}
            page has a complete, copy-ready set of instructions.
          </p>
          <dl className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <ValueRow label="Integration ID" copy={{ value: connection.integrationId }}>
              <span className="font-mono">{connection.integrationId}</span>
            </ValueRow>
            <ValueRow label="Endpoint" copy={{ value: endpoint }}>
              <SoftBreak text={endpoint} />
            </ValueRow>
            <ValueRow label="Approved website">{connection.website ? <SoftBreak text={connection.website} /> : "Not set"}</ValueRow>
            <ValueRow label="Connected on">{connection.created}</ValueRow>
          </dl>
        </div>
      </details>

      <EditDialog open={editOpen} onClose={closeEdit} onDone={onDone} integration={connection} />
      <DisableDialog open={disableOpen} onClose={closeDisable} onDone={onDone} integration={connection} />
      <DeleteConnectionDialog open={deleteOpen} onClose={closeDelete} onDone={onGone} integration={connection} />
      <RemoveConnectionDialog open={removeOpen} onClose={closeRemove} onDone={onGone} integration={connection} />
    </Panel>
  );
}

export function WebsiteRequestsOverview({ connections, endpoint, formState, formVersionLabel, servicesSummary, publication, previousConnections }: WebsiteRequestsOverviewProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const onConnected = useCallback((message: string) => setNotice(message || null), []);
  const onGone = useCallback((message: string) => setNotice(message || null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <FlowStrip />

      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")}>
          {notice}
        </p>
      )}

      <section aria-labelledby="wr-connection-heading" className="flex flex-col gap-zw-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="wr-connection-heading" className={cn(typography.subsectionHeading, "text-text-primary")}>
            Your website
          </h2>
          {(connections.length > 0 || publication) && (
            <Button type="button" size="sm" variant="outline" leadingIcon={<Plus className="size-3.5" aria-hidden />} onClick={() => setConnectOpen(true)}>
              Connect another website
            </Button>
          )}
        </div>
        {publication && <FormPublicationCard publication={publication} />}
        {connections.length === 0 && publication ? null : connections.length === 0 ? (
          <Panel className="flex flex-col items-start gap-zw-md">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-secondary text-text-muted">
                <GlobeHemisphereWest className="size-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <div>
                  <StatusBadge label="No active website connection" category="neutral" />
                </div>
                <p className={cn(typography.bodySmall, "text-text-secondary")}>
                  Connect your website to receive transportation requests directly in Nemryn.
                </p>
              </div>
            </div>
            <Button type="button" onClick={() => setConnectOpen(true)}>
              Connect website
            </Button>
          </Panel>
        ) : (
          <div className="flex flex-col gap-zw-md">
            {connections.map((connection) => (
              <ConnectionCard key={connection.handle} connection={connection} endpoint={endpoint} servicesSummary={servicesSummary} onGone={onGone} />
            ))}
          </div>
        )}
        <PreviousConnectionsSection connections={previousConnections} />
      </section>

      <section aria-labelledby="wr-methods-heading" className="flex flex-col gap-zw-md">
        <div>
          <h2 id="wr-methods-heading" className={cn(typography.subsectionHeading, "text-text-primary")}>
            How do you want to receive requests?
          </h2>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Not sure which to choose? Start with a Nemryn form — it is the easiest.</p>
        </div>
        <ul className="grid grid-cols-1 gap-zw-md md:grid-cols-3">
          {CONNECTION_METHOD_CARDS.map((card) => (
            <li key={card.value} className="flex">
              <Panel className="flex w-full flex-col gap-zw-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{card.title}</h3>
                  {card.badge && <StatusBadge label={card.badge} category="positive" />}
                </div>
                <p className={cn(typography.bodySmall, "flex-1 text-text-secondary")}>{card.description}</p>
                {card.value === "nemryn_form" && (
                  <p className={cn(typography.metadata, "text-text-muted")}>
                    Form: {FORM_STATE_LABEL[formState]}
                    {formVersionLabel ? ` · ${formVersionLabel}` : ""}
                  </p>
                )}
                <Link
                  href={card.href}
                  className={cn(typography.label, "inline-flex items-center gap-1 text-text-link")}
                  aria-label={`${card.action}: ${card.title}`}
                >
                  {card.value === "nemryn_form" && formState !== "NOT_CONFIGURED" ? "Edit form" : card.action}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Panel>
            </li>
          ))}
        </ul>
      </section>

      <ConnectDialog open={connectOpen} onClose={closeConnect} onDone={onConnected} />
    </div>
  );
}
