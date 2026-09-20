"use client";

import { useActionState, useCallback, useState } from "react";
import { setOrganizationStatusAction, type LifecycleState } from "@/app/platform/organizations/[organizationId]/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { REASON_MAX } from "@/lib/platform/platform-core";

const IDLE: LifecycleState = { status: "idle" };

const SUSPEND_WARNING =
  "Suspending this organization will stop staff and drivers from operating the workspace and stop new website requests. Existing records will remain unchanged.";
const REACTIVATE_NOTE =
  "Reactivating restores workspace access for staff and drivers and lets the existing website integration accept requests again. Nothing needs to be set up again.";

/**
 * The single lifecycle control on the organization page. There is no delete,
 * purge or "sign in as" here -- only suspend / reactivate, always with a reason.
 */
export function OrganizationLifecycleControl({ organizationId, organizationName, status }: { organizationId: string; organizationName: string; status: string }) {
  const [state, action, pending] = useActionState(setOrganizationStatusAction, IDLE);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const suspending = status === "active";
  // A successful change closes the dialog; the page re-renders with the new
  // status and the parent re-mounts this control (key = status), so it is ready
  // for the opposite action.
  const dialogOpen = open && state.status !== "done";

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant={suspending ? "destructive" : "primary"} onClick={() => setOpen(true)}>
        {suspending ? "Suspend organization" : "Reactivate organization"}
      </Button>
      {state.status !== "idle" && state.message && !dialogOpen && (
        <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
          {state.message}
        </p>
      )}
      <Dialog open={dialogOpen} onClose={close} title={suspending ? `Suspend ${organizationName}?` : `Reactivate ${organizationName}?`} description={suspending ? SUSPEND_WARNING : REACTIVATE_NOTE}>
        <form action={action} className="flex flex-col gap-zw-md">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="status" value={suspending ? "inactive" : "active"} />
          <Textarea name="reason" label="Reason" required rows={3} maxLength={REASON_MAX} helpText="Recorded in the platform activity log. Not shown to the organization." />
          {state.status === "error" && state.message && (
            <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
              {state.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant={suspending ? "destructive" : "primary"} loading={pending} disabled={pending}>
              {suspending ? "Suspend organization" : "Reactivate organization"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
