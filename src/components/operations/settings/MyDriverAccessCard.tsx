"use client";

import { useActionState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { setUpMyDriverAccessAction, type MyAccessActionState } from "@/app/operations/settings/my-access/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import type { DriverAccessState } from "@/lib/operations/self-driver-core";

const IDLE: MyAccessActionState = { status: "idle" };

export interface MyDriverAccessCardProps {
  state: DriverAccessState;
  suggestedName: string;
  suggestedPhone: string;
}

/**
 * The Driver-access card on Settings -> My Access. Owner-operator empty state,
 * setup form, restore-after-inactive, and the active state. The form posts only
 * the two typed fields; who the person is and which organization it applies to are
 * resolved on the server.
 */
export function MyDriverAccessCard({ state, suggestedName, suggestedPhone }: MyDriverAccessCardProps) {
  const [result, formAction, pending] = useActionState(setUpMyDriverAccessAction, IDLE);
  const justEnabled = result.status === "success";
  const showActive = state === "active" || justEnabled;

  if (showActive) {
    return (
      <div className="flex flex-col gap-zw-sm">
        <div className="flex items-center gap-2">
          <StatusBadge label="Active" category="positive" />
        </div>
        {justEnabled && (
          <p role="status" className={cn(typography.body, "flex items-center gap-2 text-text-primary")}>
            <CheckCircle className="size-5 text-positive-text" aria-hidden />
            Driver access is ready.
          </p>
        )}
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          You can use this account for Nemryn Driver. Your Organization Admin access is unchanged. Trips assigned to you appear in
          Driver.
        </p>
        <div className="flex flex-col items-start gap-2">
          <LinkButton href="/driver" variant="primary" size="md">
            Open Driver
          </LinkButton>
          <p className={cn(typography.metadata, "text-text-muted")}>You can install Nemryn Driver from your Driver Profile.</p>
        </div>
      </div>
    );
  }

  if (state === "needs_support") {
    return (
      <div className="flex flex-col gap-zw-sm">
        <StatusBadge label="Needs attention" category="warning" />
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          We found more than one Driver record for your account in this organization, so we can&apos;t choose the right one
          automatically. Please contact Nemryn support.
        </p>
      </div>
    );
  }

  const inactive = state === "inactive";
  return (
    <form action={formAction} className="flex flex-col gap-zw-md">
      <div className="flex flex-col gap-zw-sm">
        <StatusBadge label={inactive ? "Inactive" : "Not set up"} category={inactive ? "neutral" : "neutral"} />
        {inactive ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            Driver access for your account is turned off. You can turn it back on. Your Organization Admin access is unchanged and your
            earlier Driver history is kept.
          </p>
        ) : (
          <>
            <p className={cn(typography.body, "text-text-primary")}>
              You manage this organization. If you also drive trips, set up Driver access for this same account.
            </p>
            <ul className={cn(typography.bodySmall, "list-disc pl-5 text-text-secondary")}>
              <li>You don&apos;t need a second account or a second email.</li>
              <li>Your Organization Admin access stays exactly as it is.</li>
              <li>Driver access lets you use Nemryn Driver for trips assigned to you.</li>
              <li>You&apos;ll still need trips assigned to you before work appears in Driver.</li>
            </ul>
          </>
        )}
      </div>

      {!inactive && (
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Input label="Name dispatch and drivers will see" name="displayName" required defaultValue={suggestedName} disabled={pending} />
          <Input label="Phone (optional)" name="phone" type="tel" placeholder="e.g. (404) 555-0100" defaultValue={suggestedPhone} disabled={pending} />
        </div>
      )}
      {inactive && <input type="hidden" name="displayName" value={suggestedName} />}
      {inactive && <input type="hidden" name="phone" value={suggestedPhone} />}

      {result.status === "error" && result.message && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
          {result.message}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" size="md" loading={pending} disabled={pending}>
          {pending ? "Setting this up…" : inactive ? "Turn my Driver access back on" : "Set up my Driver access"}
        </Button>
      </div>
    </form>
  );
}
