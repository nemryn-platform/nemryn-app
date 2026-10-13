"use client";

import { useActionState, useCallback, useState } from "react";
import { changePlusEntitlementAction, type PlusEntitlementState } from "@/app/platform/organizations/[organizationId]/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import {
  PLUS_ACTION_LABELS,
  PLUS_ACTION_NOTES,
  PLUS_CORE_ISOLATION_NOTE,
  PLUS_EXTENSION_MAX_DAYS,
  PLUS_REASON_MAX,
  PLUS_TRIAL_DEFAULT_DAYS,
  PLUS_TRIAL_MAX_DAYS,
  PLUS_TRIAL_MIN_DAYS,
  confirmsOrganization,
  type PlusAdminAction,
} from "@/lib/plus/entitlement-admin-core";

const IDLE: PlusEntitlementState = { status: "idle" };
const RESTRICTIVE: readonly PlusAdminAction[] = ["expire", "cancel", "disable_read_only", "disable_no_access"];

/**
 * NP-P1-S1 -- Nemryn Plus entitlement controls on the Platform organization page. Deliberately separate from the
 * suspension control: these actions change only the Plus entitlement, never organizations.status. Every change needs
 * a reason and is re-validated by the database. Only the actions valid for the current state are offered.
 *
 * NP-P1-S2 targeting safeguards (the S1 smoke granted a trial to the wrong organization): every dialog shows the target
 * organization's name AND id prominently, requires the name to be typed, and submits the version token of the
 * entitlement this panel rendered. The server re-reads the organization by the submitted id and refuses a mismatched
 * name or a stale version -- the client-side check below is only a convenience.
 */
export function PlusEntitlementControl({
  organizationId,
  organizationName,
  actions,
  versionToken,
}: {
  organizationId: string;
  organizationName: string;
  actions: PlusAdminAction[];
  /** entitlementVersionToken(updatedAt) of the entitlement rendered with this control. */
  versionToken: string;
}) {
  const [state, formAction, pending] = useActionState(changePlusEntitlementAction, IDLE);
  const [selected, setSelected] = useState<PlusAdminAction | null>(null);
  const [typedName, setTypedName] = useState("");
  const close = useCallback(() => setSelected(null), []);
  const nameConfirmed = confirmsOrganization(typedName, organizationName);
  // A successful change closes the dialog; the page re-renders and the parent re-mounts this control (key), so the
  // offered actions follow the new state.
  const dialogOpen = selected !== null && state.status !== "done";

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={RESTRICTIVE.includes(action) ? (action === "disable_no_access" ? "destructive" : "outline") : "primary"}
            onClick={() => {
              setTypedName("");
              setSelected(action);
            }}
            data-testid={`plus-action-${action}`}
          >
            {PLUS_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {state.status !== "idle" && state.message && !dialogOpen && (
        <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
          {state.message}
        </p>
      )}
      {selected && (
        <Dialog
          open={dialogOpen}
          onClose={close}
          title={`${PLUS_ACTION_LABELS[selected]} — ${organizationName}`}
          description={`${PLUS_ACTION_NOTES[selected]} ${PLUS_CORE_ISOLATION_NOTE}`}
        >
          <form action={formAction} className="flex flex-col gap-zw-md">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="action" value={selected} />
            <input type="hidden" name="expectedVersion" value={versionToken} />
            <div className="rounded-md border border-border-strong bg-surface-secondary px-3 py-2" data-testid="plus-target-organization">
              <p className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Target organization</p>
              <p className={cn(typography.subsectionHeading, "text-text-primary")}>{organizationName}</p>
              <p className={cn(typography.metadata, "break-all font-mono text-text-secondary")}>{organizationId}</p>
            </div>
            {selected === "start_trial" && (
              <Input
                name="trialDays"
                label="Trial length (days)"
                type="number"
                inputMode="numeric"
                min={PLUS_TRIAL_MIN_DAYS}
                max={PLUS_TRIAL_MAX_DAYS}
                placeholder={String(PLUS_TRIAL_DEFAULT_DAYS)}
                helpText={`${PLUS_TRIAL_MIN_DAYS}–${PLUS_TRIAL_MAX_DAYS} days. Leave blank for the default ${PLUS_TRIAL_DEFAULT_DAYS} days.`}
              />
            )}
            {selected === "extend_trial" && (
              <Input
                name="extraDays"
                label="Extend by (days)"
                type="number"
                inputMode="numeric"
                min={1}
                max={PLUS_EXTENSION_MAX_DAYS}
                required
                helpText={`1–${PLUS_EXTENSION_MAX_DAYS} days. A trial can be extended only once.`}
              />
            )}
            {selected === "activate" && (
              <Input
                name="accessEndsOn"
                label="Access ends after (optional)"
                type="date"
                helpText="Plus stays active through this date (UTC). Leave blank for open-ended access."
              />
            )}
            <Input
              name="confirmOrganizationName"
              label="Type the organization name to confirm"
              autoComplete="off"
              required
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              helpText={`This change applies only to ${organizationName}.`}
              data-testid="plus-confirm-organization"
            />
            <Textarea name="reason" label="Reason" required rows={3} maxLength={PLUS_REASON_MAX} helpText="Recorded in the platform audit log. Not shown to the organization." />
            {state.status === "error" && state.message && (
              <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
                {state.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant={selected === "disable_no_access" ? "destructive" : "primary"} loading={pending} disabled={pending || !nameConfirmed}>
                {PLUS_ACTION_LABELS[selected]}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
