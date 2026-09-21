"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyValue } from "./CopyValue";
import { ConnectWebsiteFirst, UseMethodForm } from "./ConnectionSetupControls";
import { Panel } from "@/components/ui/Panel";
import { LinkButton } from "@/components/ui/LinkButton";
import type { WebsiteRequestsConnectionView } from "./WebsiteConnectionControls";
import {
  WEBSITE_MANAGER_OPTIONS,
  buildDeveloperPackage,
  existingFormGuidance,
  isWebsiteManager,
  type WebsiteManager,
} from "@/lib/operations/website-requests-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * "Connect my existing form": keep the request form already on the website; the website sends completed requests
 * securely to Nemryn. The manager choice selects guidance only (persisted as a preference); the developer package is the
 * same for everyone and stays behind "Technical details" until requested.
 */
export function ExistingFormSetup({ connection, endpoint }: { connection: WebsiteRequestsConnectionView | null; endpoint: string }) {
  const [manager, setManager] = useState<WebsiteManager | null>(isWebsiteManager(connection?.websiteManager) ? (connection?.websiteManager as WebsiteManager) : null);
  const guidance = manager ? existingFormGuidance(manager) : null;
  const managerLabel = manager ? (WEBSITE_MANAGER_OPTIONS.find((o) => o.value === manager)?.label ?? null) : null;
  const pkg = connection
    ? buildDeveloperPackage({ endpoint, integrationId: connection.integrationId, website: connection.website, websiteManagerLabel: managerLabel })
    : "";

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <Panel className="flex flex-col gap-zw-sm">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Keep your existing form</h2>
        <p className={cn(typography.body, "text-text-secondary")}>
          Keep the request form already on your website. Your website sends completed requests securely to Nemryn.
        </p>
      </Panel>

      {!connection ? (
        <ConnectWebsiteFirst />
      ) : (
        <>
          <Panel className="flex flex-col gap-zw-md">
            <fieldset className="flex flex-col gap-zw-sm">
              <legend className={cn(typography.subsectionHeading, "text-text-primary")}>Who manages your website?</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {WEBSITE_MANAGER_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2",
                      manager === option.value ? "border-border-strong bg-surface-secondary" : "border-border-subtle",
                    )}
                  >
                    <input type="radio" name="websiteManagerChoice" value={option.value} checked={manager === option.value} onChange={() => setManager(option.value)} />
                    <span className={cn(typography.bodySmall, "text-text-primary")}>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {manager && <UseMethodForm handle={connection.handle} method="existing_form" manager={manager} label="Save my choice" />}
          </Panel>

          {guidance && (
            <Panel className="flex flex-col gap-zw-md" aria-live="polite">
              <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{guidance.headline}</h3>
              {guidance.paragraphs.map((paragraph) => (
                <p key={paragraph} className={cn(typography.bodySmall, "text-text-secondary")}>
                  {paragraph}
                </p>
              ))}
              {guidance.offerNextSteps ? (
                <div className="flex flex-wrap items-center gap-2">
                  <LinkButton href="/operations/settings/website-requests/form" variant="primary" size="sm">
                    Use a Nemryn form
                  </LinkButton>
                  <CopyValue value={pkg} label="setup instructions for my website provider" buttonLabel="Copy instructions for my website provider" size="md" />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <CopyValue
                    value={pkg}
                    label="setup instructions"
                    buttonLabel={manager === "developer" ? "Send instructions to my developer (copy)" : "Copy setup instructions"}
                    size="md"
                  />
                  {guidance.developerLikelyNeeded && (
                    <Link href="/operations/settings/website-requests/form" className={cn(typography.label, "text-text-link")}>
                      Or use a Nemryn form instead
                    </Link>
                  )}
                </div>
              )}
              <p className={cn(typography.metadata, "text-text-muted")}>
                You don&apos;t need to share any Nemryn login or database credential with your website. The instructions contain everything your website needs.
              </p>
            </Panel>
          )}

          <details className="rounded-sm border border-border-subtle">
            <summary className={cn(typography.label, "cursor-pointer select-none px-3 py-2 text-text-secondary")}>Technical details (for your developer)</summary>
            <div className="flex flex-col gap-zw-sm border-t border-border-subtle p-3">
              <p className={cn(typography.bodySmall, "text-text-secondary")}>
                This is the exact text that the copy buttons above place on your clipboard.
              </p>
              <pre className={cn(typography.metadata, "max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-secondary p-3 font-mono text-text-primary")}>{pkg}</pre>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
