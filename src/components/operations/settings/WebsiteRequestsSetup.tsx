"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Circle, Lifebuoy, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { CopyValue } from "./CopyValue";
import { ActivateButton, type WebsiteRequestsConnectionView } from "./WebsiteConnectionControls";
import {
  BUILDER_OPTIONS,
  SETUP_OPTIONS,
  builderGuide,
  type Builder,
  type DiagnosticItem,
  type SetupProgress,
} from "@/lib/operations/website-requests-setup-core";
import type { DeveloperExamples } from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * P1-COMM-D3 building blocks for the Website Requests setup experience. Presentation only: every fact shown is derived
 * from existing connection / form / publication data (website-requests-setup-core.ts); nothing here persists state.
 */

const METHOD_HREF: Record<"nemryn_form" | "existing_form" | "developer", string> = {
  nemryn_form: "/operations/settings/website-requests/form",
  existing_form: "/operations/settings/website-requests/existing-form",
  developer: "/operations/settings/website-requests/developer",
};

export function SetupProgressList({ progress, label = "Setup progress" }: { progress: SetupProgress; label?: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid="setup-progress">
      <p className={cn(typography.label, "text-text-primary")}>
        {label}{" "}
        <span className={cn(typography.metadata, "text-text-muted")}>
          {progress.complete ? "· Complete" : `· ${progress.doneCount} of ${progress.steps.length}`}
        </span>
      </p>
      <ol className="flex flex-col gap-1.5">
        {progress.steps.map((step, index) => {
          const isNext = progress.next?.key === step.key;
          return (
            <li key={step.key} className="flex items-center gap-2" data-step={step.key} data-done={step.done ? "true" : "false"}>
              {step.done ? (
                <CheckCircle weight="fill" className="size-4 shrink-0 text-success-text" aria-hidden />
              ) : (
                <Circle className={cn("size-4 shrink-0", isNext ? "text-text-primary" : "text-text-muted")} aria-hidden />
              )}
              <span className={cn(typography.bodySmall, step.done ? "text-text-secondary" : isNext ? "font-medium text-text-primary" : "text-text-muted")}>
                {index + 1}. {step.label}
                <span className="sr-only">{step.done ? " (done)" : isNext ? " (next step)" : " (not yet)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DiagnosticsList({ items }: { items: DiagnosticItem[] }) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid="connection-diagnostics">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-2">
          {item.ok ? (
            <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
          ) : (
            <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          )}
          <span className={cn(typography.bodySmall, "text-text-secondary")}>
            <span className="font-medium text-text-primary">{item.label}</span>
            <span className="sr-only">{item.ok ? " (ok)" : " (needs attention)"}</span> — {item.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Impossible-to-miss activation step (P1-COMM-D3 §9): a connection that exists but is OFF refuses every request. */
export function TurnOnCallout({ connection, onDone }: { connection: WebsiteRequestsConnectionView; onDone: (message: string) => void }) {
  if (connection.isActive) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg px-4 py-3" role="status" data-testid="turn-on-callout">
      <p className={cn(typography.label, "text-text-primary")}>Next step: turn on this connection</p>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>Your website cannot send requests until this connection is turned on.</p>
      <div className="self-start">
        <ActivateButton integration={connection} onDone={onDone} />
      </div>
    </div>
  );
}

export function TestConnectionGuide({ kind, connected }: { kind: "connection" | "form"; connected: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm bg-surface-secondary px-3 py-2" data-testid="test-connection-guide">
      <p className={cn(typography.label, "text-text-primary")}>Test your {kind === "form" ? "form" : "connection"}</p>
      <ol className={cn(typography.bodySmall, "list-decimal pl-5 text-text-secondary")}>
        {kind === "connection" && <li>Make sure the connection is turned on.</li>}
        <li>
          Submit one request {kind === "form" ? "through your form" : "from your website"} with <span className="font-medium text-text-primary">TEST</span> in the requester name.
        </li>
        <li>It appears in your Request Hub as Pending — you can decline it afterwards.</li>
      </ol>
      <p className={cn(typography.metadata, "text-text-muted")}>
        {connected
          ? "Nemryn has already received a request, so this is working. Test again any time after a website change."
          : "A successful test proves your website and Nemryn are talking. The status changes to Connected when the first request arrives."}
      </p>
    </div>
  );
}

export function ServerSideNote() {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border-subtle px-3 py-2" data-testid="server-side-note">
      <p className={cn(typography.label, "text-text-primary")}>Send requests from your website&apos;s server, not directly from the visitor&apos;s browser.</p>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>This protects your connection setup and gives you control over validation and retries.</p>
    </div>
  );
}

export function OriginNote({ website }: { website: string | null }) {
  const site = website ?? "https://www.your-website.example";
  return (
    <div className="flex flex-col gap-1" data-testid="origin-note">
      <p className={cn(typography.bodySmall, "text-text-secondary")}>
        <span className="font-medium text-text-primary">Approved website: </span>
        <span className="break-all">{site}</span> — Nemryn accepts requests that identify this website as the source.
      </p>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>
        Your server must send the header <code className="font-mono text-text-primary">Origin: {site}</code> with every request. Server code does not add it
        automatically, and it must match exactly (including <code className="font-mono">https://</code> and <code className="font-mono">www</code>). It identifies
        your website; it is not a password.
      </p>
    </div>
  );
}

const EXAMPLE_TABS: { key: keyof DeveloperExamples; label: string }[] = [
  { key: "node", label: "Node / JavaScript" },
  { key: "nextjs", label: "Next.js" },
  { key: "curl", label: "cURL" },
  { key: "php", label: "PHP" },
];

export function CodeExamples({ examples }: { examples: DeveloperExamples }) {
  const [active, setActive] = useState<keyof DeveloperExamples>("node");
  const current = EXAMPLE_TABS.find((t) => t.key === active) ?? EXAMPLE_TABS[0];
  return (
    <div className="flex flex-col gap-zw-sm" data-testid="code-examples">
      <div role="tablist" aria-label="Code examples" className="flex flex-wrap gap-1">
        {EXAMPLE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active}
            onClick={() => setActive(tab.key)}
            className={cn(
              typography.label,
              "rounded-sm px-3 py-1.5",
              tab.key === active ? "bg-surface-secondary text-text-primary" : "text-text-secondary hover:bg-surface-hover",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(typography.metadata, "text-text-muted")}>{current.label} example</span>
        <CopyValue value={examples[current.key]} label={`${current.label} example`} buttonLabel={`Copy ${current.label} example`} />
      </div>
      <pre role="tabpanel" data-example={current.key} className={cn(typography.metadata, "max-h-[28rem] overflow-auto rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>
        {examples[current.key]}
      </pre>
    </div>
  );
}

/** "Which setup should I use?" -- guidance per website builder; no native plugin/app is claimed anywhere. */
export function BuilderChooser() {
  const [builder, setBuilder] = useState<Builder | null>(null);
  const guide = builder ? builderGuide(builder) : null;
  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="builder-chooser">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Which setup should I use?</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Tell us how your website is built.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How your website is built">
        {BUILDER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={builder === option.value}
            onClick={() => setBuilder(option.value)}
            className={cn(
              typography.bodySmall,
              "rounded-sm border px-3 py-1.5",
              builder === option.value ? "border-border-strong bg-surface-secondary text-text-primary" : "border-border-subtle text-text-secondary hover:bg-surface-hover",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {guide && (
        <div className="flex flex-col gap-2 rounded-sm bg-surface-secondary px-3 py-3" aria-live="polite" data-testid="builder-guide">
          <p className={cn(typography.label, "text-text-primary")}>
            Recommended: {guide.methodLabel} <span className={cn(typography.bodySmall, "font-normal text-text-secondary")}>— {guide.why}</span>
          </p>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            <span className="font-medium text-text-primary">Where it goes: </span>
            {guide.where}
          </p>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            <span className="font-medium text-text-primary">Then test: </span>
            {guide.test}
          </p>
          <Link href={METHOD_HREF[guide.method]} className={cn(typography.label, "text-text-link")}>
            Continue with {guide.methodLabel}
          </Link>
        </div>
      )}
    </Panel>
  );
}

/**
 * "Need help installing this?" -- a restrained assistance handoff (P1-COMM-D3 §13-15). Self setup stays fully available;
 * nothing is priced or billed. The mailto carries setup context only (see buildSetupHelpMailto). With no support address
 * configured for the deployment, the panel still explains the options and says how to reach Nemryn.
 */
export function SetupHelpPanel({ mailto }: { mailto: string | null }) {
  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="setup-help">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-secondary text-text-muted">
          <Lifebuoy className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Need help installing this?</h3>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Nemryn can help connect your website. Setting it up yourself is always included.</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {SETUP_OPTIONS.map((option) => (
          <li key={option.key} className="flex flex-col gap-1 rounded-sm border border-border-subtle px-3 py-2">
            <span className={cn(typography.label, "text-text-primary")}>{option.title}</span>
            <span className={cn(typography.metadata, "text-text-secondary")}>{option.description}</span>
          </li>
        ))}
      </ul>
      {mailto ? (
        <div>
          <a
            href={mailto}
            className={cn(typography.label, "inline-flex items-center rounded-sm border border-border-strong px-3 py-1.5 text-text-primary hover:bg-surface-hover")}
          >
            Request setup help
          </a>
        </div>
      ) : (
        <p className={cn(typography.metadata, "text-text-muted")}>To request setup help, contact your Nemryn representative.</p>
      )}
    </Panel>
  );
}
