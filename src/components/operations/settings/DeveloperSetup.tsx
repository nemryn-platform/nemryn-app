"use client";

import { CopyValue } from "./CopyValue";
import { ConnectWebsiteFirst, UseMethodForm } from "./ConnectionSetupControls";
import { SoftBreak, ValueRow, type WebsiteRequestsConnectionView } from "./WebsiteConnectionControls";
import { Panel } from "@/components/ui/Panel";
import { buildAcquisitionExample, buildSetupEnvExample } from "@/lib/operations/website-integration-core";
import { buildDeveloperPackage } from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** Developer connection: the technical surface, deliberately its own page (never at the top of Website Requests). */
export function DeveloperSetup({ connection, endpoint }: { connection: WebsiteRequestsConnectionView | null; endpoint: string }) {
  if (!connection) {
    return (
      <div className="flex max-w-3xl flex-col gap-zw-lg">
        <ConnectWebsiteFirst />
      </div>
    );
  }
  const pkg = buildDeveloperPackage({ endpoint, integrationId: connection.integrationId, website: connection.website });
  const env = buildSetupEnvExample({ endpoint, integrationId: connection.integrationId });
  const acquisition = buildAcquisitionExample();
  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <Panel className="flex flex-col gap-zw-sm">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Developer connection</h2>
        <p className={cn(typography.body, "text-text-secondary")}>
          Connect your website directly using Nemryn&apos;s website intake API. Your website&apos;s server sends each completed request to Nemryn; it appears in your Request Hub.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyValue value={pkg} label="setup instructions" buttonLabel="Copy setup instructions" size="md" />
          <UseMethodForm handle={connection.handle} method="developer" manager={connection.websiteManager} label="Use this method" />
        </div>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Connection details</h3>
        <dl className="grid grid-cols-1 gap-zw-md">
          <ValueRow label="Endpoint (POST, JSON)" copy={{ value: endpoint }}>
            <SoftBreak text={endpoint} />
          </ValueRow>
          <ValueRow label="Integration ID" copy={{ value: connection.integrationId }}>
            <span className="font-mono">{connection.integrationId}</span>
          </ValueRow>
          <ValueRow label="Approved website">{connection.website ? <SoftBreak text={connection.website} /> : "Not set"}</ValueRow>
        </dl>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Each request must include the header <code className="font-mono text-text-primary">Origin: {connection.website ?? "<your approved website>"}</code>. Nemryn only accepts requests that name the approved website; it restricts where requests may come from and is not a password. Never share a Nemryn login, database credential or service key.
        </p>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <div className="flex items-center justify-between gap-2">
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Example server configuration</h3>
          <CopyValue value={env} label="server configuration" />
        </div>
        <pre className={cn(typography.metadata, "overflow-x-auto rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{env}</pre>
        <p className={cn(typography.metadata, "text-text-muted")}>These variable names are examples for a server implementation — use whatever your website&apos;s server uses to hold settings.</p>
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

      <Panel className="flex flex-col gap-zw-sm">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Test your connection</h3>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          After activating this connection, submit one test transportation request through your website. When Nemryn receives it, the connection will show Connected.
        </p>
      </Panel>

      <details className="rounded-sm border border-border-subtle">
        <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>Full setup instructions (copy-ready)</summary>
        <pre className={cn(typography.metadata, "max-h-96 overflow-auto whitespace-pre-wrap border-t border-border-subtle bg-surface-secondary p-3 font-mono text-text-primary")}>{pkg}</pre>
      </details>
    </div>
  );
}
