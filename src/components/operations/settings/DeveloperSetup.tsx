"use client";

import { useCallback, useState } from "react";
import { CopyValue } from "./CopyValue";
import { ConnectWebsiteFirst, UseMethodForm } from "./ConnectionSetupControls";
import { SoftBreak, ValueRow, type WebsiteRequestsConnectionView } from "./WebsiteConnectionControls";
import { CodeExamples, OriginNote, ServerSideNote, TestConnectionGuide, TurnOnCallout } from "./WebsiteRequestsSetup";
import { Panel } from "@/components/ui/Panel";
import { buildAcquisitionExample } from "@/lib/operations/website-integration-core";
import { buildDeveloperExamples, buildDeveloperPackage } from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const COMMON_ISSUES: { title: string; fix: string }[] = [
  { title: "Connection not turned on", fix: "Turn the connection on in Website Requests. Until then every request is refused." },
  { title: "Origin mismatch", fix: "The Origin header must equal the approved website exactly — same https://, same www, no trailing path." },
  { title: "Integration ID mismatch", fix: "Copy the Integration ID again from this page. A removed connection's ID stops working." },
  { title: "Service not enabled", fix: "serviceType must be one of the services you enabled in Settings → Services & Intake (or leave it out)." },
  { title: "Invalid payload", fix: "A required field is missing, a value is outside its allowed list, an unknown field was sent, or the body is over 8 KB." },
  { title: "Rate limit reached (429)", fix: "A connection accepts up to 120 requests per rolling hour. Wait, then retry with the same idempotencyKey." },
];

/** Developer connection: the technical surface, deliberately its own page (never at the top of Website Requests). */
export function DeveloperSetup({ connection, endpoint }: { connection: WebsiteRequestsConnectionView | null; endpoint: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const onDone = useCallback((message: string) => setNotice(message || null), []);
  if (!connection) {
    return (
      <div className="flex max-w-3xl flex-col gap-zw-lg">
        <ConnectWebsiteFirst />
      </div>
    );
  }
  const pkg = buildDeveloperPackage({ endpoint, integrationId: connection.integrationId, website: connection.website });
  const examples = buildDeveloperExamples({ endpoint, integrationId: connection.integrationId, website: connection.website });
  const acquisition = buildAcquisitionExample();
  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <Panel className="flex flex-col gap-zw-sm">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Developer connection</h2>
        <p className={cn(typography.body, "text-text-secondary")}>
          Connect your website directly using Nemryn&apos;s website intake API. Your website&apos;s server sends each completed request to Nemryn; it appears in your Request Hub as Pending.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyValue value={pkg} label="setup instructions" buttonLabel="Copy setup instructions" size="md" />
          <UseMethodForm handle={connection.handle} method="developer" manager={connection.websiteManager} label="Use this method" />
        </div>
        <p className={cn(typography.metadata, "text-text-muted")}>
          The copied instructions are a complete package for your developer: connection details, headers, fields, examples in four languages, testing and common issues.
        </p>
      </Panel>

      <TurnOnCallout connection={connection} onDone={onDone} />
      {notice && (
        <p role="status" className={cn(typography.bodySmall, "rounded-sm bg-surface-secondary px-3 py-2 text-text-primary")}>
          {notice}
        </p>
      )}

      <ServerSideNote />

      <Panel className="flex flex-col gap-zw-md">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Connection details</h3>
        <dl className="grid grid-cols-1 gap-zw-md">
          <ValueRow label="Endpoint (POST, JSON)" copy={{ value: endpoint }}>
            <SoftBreak text={endpoint} />
          </ValueRow>
          <ValueRow label="Integration ID" copy={{ value: connection.integrationId }}>
            <span className="font-mono">{connection.integrationId}</span>
          </ValueRow>
          <ValueRow label="Required header" copy={connection.website ? { value: `Origin: ${connection.website}` } : undefined}>
            <span className="font-mono">Origin: {connection.website ?? "<your approved website>"}</span>
          </ValueRow>
        </dl>
        <OriginNote website={connection.website} />
        <p className={cn(typography.metadata, "text-text-muted")}>Never share a Nemryn login, database credential or service key. Your website doesn&apos;t need one.</p>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Code examples</h3>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Each example sends one request from your server with the Origin header, the Integration ID and an idempotency key (create it once per submission and reuse it if you retry), and handles the responses.
        </p>
        <CodeExamples examples={examples} />
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <div className="flex items-center justify-between gap-2">
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Optional: where the request came from</h3>
          <CopyValue value={acquisition} label="acquisition example" />
        </div>
        <pre className={cn(typography.metadata, "overflow-x-auto rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{acquisition}</pre>
        <ul className={cn(typography.metadata, "list-disc pl-5 text-text-muted")}>
          <li>Every property is optional, and so is the whole object.</li>
          <li>Send paths like <code className="font-mono">/dialysis-transportation</code> and a host like <code className="font-mono">google.com</code> — not full URLs, query strings or click IDs.</li>
          <li>Don&apos;t send anything about the customer or their answers as attribution.</li>
          <li>A request is still accepted if the acquisition details are missing or can&apos;t be used.</li>
        </ul>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Test your connection</h3>
        <TestConnectionGuide kind="connection" connected={connection.status === "CONNECTED"} />
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Nemryn answers <code className="font-mono">200 {"{"}&quot;ok&quot;:true{"}"}</code> when a request is accepted. A <code className="font-mono">400</code> means it was not accepted — Nemryn deliberately doesn&apos;t say why, so check the list below.
        </p>
      </Panel>

      <Panel className="flex flex-col gap-zw-md" data-testid="common-issues">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Common issues</h3>
        <ul className="flex flex-col gap-2">
          {COMMON_ISSUES.map((issue) => (
            <li key={issue.title} className={cn(typography.bodySmall, "text-text-secondary")}>
              <span className="font-medium text-text-primary">{issue.title}.</span> {issue.fix}
            </li>
          ))}
        </ul>
      </Panel>

      <details className="rounded-sm border border-border-subtle">
        <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>Full setup instructions (copy-ready)</summary>
        <pre className={cn(typography.metadata, "max-h-96 overflow-auto whitespace-pre-wrap border-t border-border-subtle bg-surface-secondary p-3 font-mono text-text-primary")}>{pkg}</pre>
      </details>
    </div>
  );
}
