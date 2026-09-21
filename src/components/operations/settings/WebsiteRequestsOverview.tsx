"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, GlobeHemisphereWest, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  ActivateButton,
  ConnectDialog,
  DisableDialog,
  EditDialog,
  SoftBreak,
  STATUS_CATEGORY,
  ValueRow,
  type WebsiteRequestsConnectionView,
} from "./WebsiteConnectionControls";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CONNECTION_METHOD_CARDS, FORM_STATE_LABEL, type FormState } from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface WebsiteRequestsOverviewProps {
  connections: WebsiteRequestsConnectionView[];
  endpoint: string;
  formState: FormState;
  formVersionLabel: string | null;
  servicesSummary: { configured: boolean; text: string } | null;
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
}: {
  connection: WebsiteRequestsConnectionView;
  endpoint: string;
  servicesSummary: { configured: boolean; text: string } | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const closeDisable = useCallback(() => setDisableOpen(false), []);
  const onDone = useCallback((message: string) => setNotice(message || null), []);

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
    </Panel>
  );
}

export function WebsiteRequestsOverview({ connections, endpoint, formState, formVersionLabel, servicesSummary }: WebsiteRequestsOverviewProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const onConnected = useCallback((message: string) => setNotice(message || null), []);
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
          {connections.length > 0 && (
            <Button type="button" size="sm" variant="outline" leadingIcon={<Plus className="size-3.5" aria-hidden />} onClick={() => setConnectOpen(true)}>
              Connect another website
            </Button>
          )}
        </div>
        {connections.length === 0 ? (
          <Panel className="flex flex-col items-start gap-zw-md">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-secondary text-text-muted">
                <GlobeHemisphereWest className="size-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <div>
                  <StatusBadge label="Not connected" category="neutral" />
                </div>
                <p className={cn(typography.bodySmall, "text-text-secondary")}>
                  No website is connected yet. Connect your website to start receiving transportation requests in your Nemryn Request Hub.
                </p>
              </div>
            </div>
            <Button type="button" onClick={() => setConnectOpen(true)}>
              Connect your website
            </Button>
          </Panel>
        ) : (
          <div className="flex flex-col gap-zw-md">
            {connections.map((connection) => (
              <ConnectionCard key={connection.handle} connection={connection} endpoint={endpoint} servicesSummary={servicesSummary} />
            ))}
          </div>
        )}
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
