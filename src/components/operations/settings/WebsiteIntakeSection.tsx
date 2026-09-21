"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GlobeHemisphereWest, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  createWebsiteIntegrationAction,
  setWebsiteIntegrationActiveAction,
  updateWebsiteIntegrationOriginAction,
  type WebsiteIntegrationActionState,
} from "@/app/operations/settings/integrations/actions";
import { CopyValue } from "./CopyValue";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge, type StatusCategory } from "@/components/ui/StatusBadge";
import { buildAcquisitionExample, buildSetupEnvExample, type WebsiteIntegrationStatus } from "@/lib/operations/website-integration-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface WebsiteIntegrationView {
  /** Opaque management handle -- posted back to the server actions, never displayed. */
  handle: string;
  integrationId: string;
  website: string | null;
  isActive: boolean;
  status: WebsiteIntegrationStatus;
  statusLabel: string;
  requestCount: number;
  lastRequestReceived: string | null;
  created: string;
}

export interface WebsiteIntakeSectionProps {
  integrations: WebsiteIntegrationView[];
  endpoint: string;
  /** Informational: the services website intake will accept (Settings -> Services & Intake). null = unavailable. */
  servicesSummary?: { configured: boolean; text: string } | null;
}

const IDLE: WebsiteIntegrationActionState = { status: "idle" };

const STATUS_CATEGORY: Record<WebsiteIntegrationStatus, StatusCategory> = {
  NOT_CONFIGURED: "neutral",
  DISABLED: "neutral",
  READY_TO_TEST: "warning",
  CONNECTED: "positive",
};

/** Lets a long URL wrap at slashes/dots instead of mid-word; `break-words` remains the last-resort fallback so nothing can overflow. */
function SoftBreak({ text }: { text: string }) {
  const parts = text.split(/(?<=[/.])/);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  );
}

function FormMessage({ state }: { state: WebsiteIntegrationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}
    >
      {state.message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Connect website
// ---------------------------------------------------------------------------
function ConnectDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [state, action, pending] = useActionState(createWebsiteIntegrationAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect website"
      description="Nemryn will associate requests sent from this website with your organization."
    >
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <Input
          label="Website address"
          name="website"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.example.com"
          required
          disabled={pending}
          defaultValue={state.website ?? ""}
          helpText="Use the address visitors see, starting with https:// — no page path."
        />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Create integration
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit website
// ---------------------------------------------------------------------------
function EditDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteIntegrationView;
}) {
  const [state, action, pending] = useActionState(updateWebsiteIntegrationOriginAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog open={open} onClose={onClose} title="Edit website" description="Change the website this connection accepts requests from.">
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        <Input
          label="Website address"
          name="website"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.example.com"
          required
          disabled={pending}
          defaultValue={state.website ?? integration.website ?? ""}
          helpText="Your Integration ID stays the same."
        />
        {integration.isActive && (
          <p className={cn(typography.bodySmall, "rounded-sm bg-warning-bg px-3 py-2 text-warning-text")}>
            This connection is on. Changing the website turns intake off until you review the new address and activate it again.
          </p>
        )}
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Save website
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Activate / Disable
// ---------------------------------------------------------------------------
function ActivateButton({ integration, onDone }: { integration: WebsiteIntegrationView; onDone: (message: string) => void }) {
  const [state, action, pending] = useActionState(setWebsiteIntegrationActiveAction, IDLE);
  useEffect(() => {
    if (state.status === "success") onDone(state.message ?? "");
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="integrationHandle" value={integration.handle} />
      <input type="hidden" name="active" value="true" />
      <Button type="submit" size="sm" loading={pending} disabled={pending}>
        Activate
      </Button>
      {state.status === "error" && <FormMessage state={state} />}
    </form>
  );
}

function DisableDialog({
  open,
  onClose,
  onDone,
  integration,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  integration: WebsiteIntegrationView;
}) {
  const [state, action, pending] = useActionState(setWebsiteIntegrationActiveAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Disable website intake?"
      description="New website requests will stop being accepted. Existing Requests will remain unchanged."
    >
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="integrationHandle" value={integration.handle} />
        <input type="hidden" name="active" value="false" />
        {state.status === "error" && <FormMessage state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep on
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            Disable intake
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A value row: label, value (wraps, never overflows), optional Copy
// ---------------------------------------------------------------------------
function ValueRow({ label, children, copy }: { label: string; children: React.ReactNode; copy?: { value: string } }) {
  return (
    <div className="min-w-0">
      <dt className={cn(typography.label, "text-text-muted")}>{label}</dt>
      <dd className="mt-0.5 flex min-w-0 items-start justify-between gap-2">
        <span className={cn(typography.body, "min-w-0 break-words text-text-primary")}>{children}</span>
        {copy && (
          <span className="shrink-0">
            <CopyValue value={copy.value} label={label} />
          </span>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup instructions
// ---------------------------------------------------------------------------
function SetupInstructions({ integration, endpoint }: { integration: WebsiteIntegrationView; endpoint: string }) {
  const env = buildSetupEnvExample({ endpoint, integrationId: integration.integrationId });
  const acquisitionExample = buildAcquisitionExample();
  return (
    <div className="flex flex-col gap-zw-md border-t border-border-subtle pt-zw-md">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Setup instructions</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          Your website sends each request from its own server to Nemryn, and it appears in your Request Hub.
        </p>
      </div>

      <p className={cn(typography.label, "rounded-sm bg-surface-secondary px-3 py-2 text-text-primary")}>
        Website form <span aria-hidden>→</span> your website server <span aria-hidden>→</span> Nemryn <span aria-hidden>→</span> Request Hub
      </p>

      <dl className="grid grid-cols-1 gap-zw-md">
        <ValueRow label="Endpoint" copy={{ value: endpoint }}>
          <SoftBreak text={endpoint} />
        </ValueRow>
        <ValueRow label="Integration ID" copy={{ value: integration.integrationId }}>
          {integration.integrationId}
        </ValueRow>
        <ValueRow label="Allowed website">{integration.website ? <SoftBreak text={integration.website} /> : "Not set"}</ValueRow>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className={cn(typography.label, "text-text-primary")}>Example server configuration</p>
          <CopyValue value={env} label="server configuration" />
        </div>
        <pre className={cn(typography.metadata, "overflow-x-auto rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{env}</pre>
        <p className={cn(typography.metadata, "text-text-muted")}>
          These variable names are examples for a server implementation — use whatever your website&apos;s server uses to hold settings.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={cn(typography.label, "text-text-primary")}>Send the website address with each request</p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Server-to-server requests must include the header{" "}
          <code className="font-mono text-text-primary">Origin: {integration.website ?? "<your website address>"}</code>. Nemryn only accepts
          requests that name the website configured here. It restricts where requests may come from — it is not a password.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className={cn(typography.label, "text-text-primary")}>Optional: where the request came from</p>
          <CopyValue value={acquisitionExample} label="acquisition example" />
        </div>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Your website can add one optional <code className="font-mono text-text-primary">acquisition</code> object to each request so you can see
          which campaign or page produced it. It appears under Acquisition on the request. Existing connections keep working without it.
        </p>
        <pre className={cn(typography.metadata, "overflow-x-auto rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{acquisitionExample}</pre>
        <ul className={cn(typography.metadata, "list-disc pl-5 text-text-muted")}>
          <li>Every property is optional, and so is the whole object.</li>
          <li>Send paths like <code className="font-mono">/dialysis-transportation</code> and a host like <code className="font-mono">google.com</code> &mdash; not full URLs, query strings or click IDs.</li>
          <li>Don&apos;t send anything about the customer or their answers as attribution.</li>
          <li>A request is still accepted if the acquisition details are missing or can&apos;t be used, so a tracking problem never blocks a customer.</li>
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={cn(typography.label, "text-text-primary")}>Confirm it works</p>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Activate the connection, then submit one clearly labelled test request through your own website form. When it arrives in your Request Hub
          the status changes to Connected.
        </p>
      </div>

      <p className={cn(typography.metadata, "text-text-muted")}>
        You never need to share database credentials, service keys or any Nemryn administrator login with your website. Only the Integration ID above is used.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One connection
// ---------------------------------------------------------------------------
function ConnectionCard({
  integration,
  endpoint,
  servicesSummary,
}: {
  integration: WebsiteIntegrationView;
  endpoint: string;
  servicesSummary?: { configured: boolean; text: string } | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const closeDisable = useCallback(() => setDisableOpen(false), []);
  const onDone = useCallback((message: string) => setNotice(message || null), []);

  return (
    <Panel className="flex flex-col gap-zw-md" aria-label={`Website connection ${integration.website ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(typography.label, "text-text-muted")}>Website</p>
          <p className={cn(typography.subsectionHeading, "min-w-0 break-words text-text-primary")}>{integration.website ?? "Not set"}</p>
        </div>
        <StatusBadge label={integration.statusLabel} category={STATUS_CATEGORY[integration.status]} />
      </div>

      {notice && (
        <p role="status" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary px-3 py-2 text-text-primary")}>
          {notice}
        </p>
      )}

      {integration.status === "DISABLED" && (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>Activate this connection when your website is ready.</p>
      )}
      {integration.status === "READY_TO_TEST" && (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Intake is on. Submit a test request from your website to confirm the connection.
        </p>
      )}

      <dl className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
        <ValueRow label="Integration ID" copy={{ value: integration.integrationId }}>
          <span className="font-mono">{integration.integrationId}</span>
        </ValueRow>
        <ValueRow label="Endpoint" copy={{ value: endpoint }}>
          <SoftBreak text={endpoint} />
        </ValueRow>
        <ValueRow label="Requests received">{integration.requestCount}</ValueRow>
        <ValueRow label="Last request received">{integration.lastRequestReceived ?? "No requests received yet"}</ValueRow>
        <ValueRow label="Created">{integration.created}</ValueRow>
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

      <div className="flex flex-wrap items-start gap-2">
        {integration.isActive ? (
          <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setDisableOpen(true); }}>
            Disable intake
          </Button>
        ) : (
          <ActivateButton integration={integration} onDone={onDone} />
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setEditOpen(true); }}>
          Edit website
        </Button>
        <Button type="button" size="sm" variant="text" onClick={() => setShowSetup((v) => !v)} aria-expanded={showSetup}>
          {showSetup ? "Hide setup instructions" : "Setup instructions"}
        </Button>
      </div>

      {showSetup && <SetupInstructions integration={integration} endpoint={endpoint} />}

      <EditDialog open={editOpen} onClose={closeEdit} onDone={onDone} integration={integration} />
      <DisableDialog open={disableOpen} onClose={closeDisable} onDone={onDone} integration={integration} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------
export function WebsiteIntakeSection({ integrations, endpoint, servicesSummary }: WebsiteIntakeSectionProps) {
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
    <section aria-labelledby="website-intake-heading" className="flex max-w-3xl flex-col gap-zw-md">
      <SectionHeader
        title="Website Intake"
        description="Connect your website to send transportation requests directly into your Nemryn Request Hub."
        actions={
          integrations.length > 0 ? (
            <Button type="button" size="sm" variant="outline" leadingIcon={<Plus className="size-3.5" aria-hidden />} onClick={() => setConnectOpen(true)}>
              Connect another website
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")}>
          {notice}
        </p>
      )}

      {integrations.length === 0 ? (
        <Panel className="flex flex-col items-start gap-zw-md">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-secondary text-text-muted">
              <GlobeHemisphereWest className="size-5" aria-hidden />
            </span>
            <div>
              <div className="mb-1">
                <StatusBadge label="Not configured" category="neutral" />
              </div>
              <p className={cn(typography.bodySmall, "text-text-secondary")}>
                Connect your website to send transportation requests directly into your Nemryn Request Hub.
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => setConnectOpen(true)}>
            Connect website
          </Button>
        </Panel>
      ) : (
        <div className="flex flex-col gap-zw-md">
          {integrations.map((integration) => (
            <ConnectionCard key={integration.handle} integration={integration} endpoint={endpoint} servicesSummary={servicesSummary} />
          ))}
        </div>
      )}

      <ConnectDialog open={connectOpen} onClose={closeConnect} onDone={onConnected} />
    </section>
  );
}
