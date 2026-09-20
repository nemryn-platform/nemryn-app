"use client";

import { useActionState } from "react";
import { saveNotificationSettingsAction, type NotificationActionState } from "@/app/operations/settings/notifications/actions";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { NOTIFICATION_ROLE_OPTIONS, describeRecipients } from "@/lib/operations/notification-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: NotificationActionState = { status: "idle" };

export interface NotificationSettingsFormProps {
  event: string;
  label: string;
  description: string;
  recipientRoles: string[];
  isDefault: boolean;
}

/** One notification event: which staff roles receive it. Empty selection = off. */
export function NotificationSettingsForm({ event, label, description, recipientRoles, isDefault }: NotificationSettingsFormProps) {
  const [state, action, pending] = useActionState(saveNotificationSettingsAction, IDLE);

  return (
    <Panel>
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <input type="hidden" name="event" value={event} />
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{label}</h3>
          <p className={cn(typography.bodySmall, "mt-0.5 text-text-secondary")}>{description}</p>
        </div>
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className={cn(typography.label, "mb-1 text-text-primary")}>Email these people</legend>
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_ROLE_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-strong px-3 py-2">
                <input type="checkbox" name="role" value={option.value} defaultChecked={recipientRoles.includes(option.value)} className="size-4" />
                <span className={cn(typography.label, "text-text-primary")}>{option.label}</span>
              </label>
            ))}
          </div>
          <p className={cn(typography.metadata, "text-text-muted")}>
            Currently: {describeRecipients(recipientRoles)}
            {isDefault ? " (default)" : ""}. Only active team members are emailed. Leave both unchecked to turn this off.
          </p>
        </fieldset>
        <div className="flex items-center gap-zw-md">
          <Button type="submit" size="sm" loading={pending} disabled={pending}>
            Save
          </Button>
          {state.status !== "idle" && state.message && (
            <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </Panel>
  );
}
