"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveConnectionSetupAction, type ConnectionSetupActionState } from "@/app/operations/settings/website-requests/actions";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: ConnectionSetupActionState = { status: "idle" };

/** "Not connected yet" guard shown on the sub-screens when the organization has no website connection. */
export function ConnectWebsiteFirst() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-border-subtle bg-surface-elevated p-zw-md">
      <p className={cn(typography.body, "text-text-primary")}>Connect your website first.</p>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>
        Nemryn needs to know which website is approved to send requests. It only takes a website address.
      </p>
      <Link href="/operations/settings/website-requests" className={cn(typography.label, "text-text-link")}>
        Go to Website Requests
      </Link>
    </div>
  );
}

/**
 * Remembers how the operator chose to connect (a guidance preference -- one intake engine underneath). The website manager
 * currently chosen is passed through unchanged so this button never clobbers it.
 */
export function UseMethodForm({
  handle,
  method,
  manager,
  label,
}: {
  handle: string;
  method: "nemryn_form" | "existing_form" | "developer";
  manager: string | null;
  label: string;
}) {
  const [state, action, pending] = useActionState(saveConnectionSetupAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="integrationHandle" value={handle} />
      <input type="hidden" name="connectionMethod" value={method} />
      <input type="hidden" name="websiteManager" value={manager ?? ""} />
      <Button type="submit" size="sm" variant="outline" loading={pending} disabled={pending}>
        {label}
      </Button>
      {state.status !== "idle" && state.message && (
        <span role={state.status === "error" ? "alert" : "status"} className={cn(typography.metadata, state.status === "error" ? "text-critical-text" : "text-text-muted")}>
          {state.message}
        </span>
      )}
    </form>
  );
}
