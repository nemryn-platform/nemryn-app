"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveOperatingScheduleAction, type OperatingScheduleActionState } from "@/app/operations/settings/operations/actions";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { WEEKDAY_OPTIONS, type OperatingSchedule } from "@/lib/operations/operating-schedule-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: OperatingScheduleActionState = { status: "idle" };

export interface OperatingScheduleFormProps {
  schedule: OperatingSchedule | null;
  timezoneLabel: string;
  business: { phone: string | null; email: string | null; contact: string | null };
}

const timeInputClass = cn(
  typography.body,
  "h-10 w-full rounded-sm border border-border-strong bg-surface-elevated px-3 text-text-primary disabled:cursor-not-allowed disabled:bg-surface-secondary",
);

export function OperatingScheduleForm({ schedule, timezoneLabel, business }: OperatingScheduleFormProps) {
  const [state, action, pending] = useActionState(saveOperatingScheduleAction, IDLE);
  const days = state.days ?? schedule?.days ?? [];
  const opensAt = state.opensAt ?? schedule?.opensAt ?? "";
  const closesAt = state.closesAt ?? schedule?.closesAt ?? "";
  const contactBits = [business.contact, business.phone, business.email].filter(Boolean) as string[];

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-zw-lg" noValidate>
      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader
          title="Operating schedule"
          description="The days and hours your organization operates. This is shown to your team as information; it doesn't block or reject any request or trip."
        />
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className={cn(typography.label, "mb-1 text-text-primary")}>Operating days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((day) => (
              <label
                key={day.value}
                className="flex min-w-14 cursor-pointer items-center justify-center gap-2 rounded-sm border border-border-strong px-3 py-2 has-[:checked]:border-border-strong has-[:checked]:bg-surface-secondary"
              >
                <input type="checkbox" name="day" value={day.value} defaultChecked={days.includes(day.value)} className="size-4" aria-label={day.long} />
                <span className={cn(typography.label, "text-text-primary")}>{day.short}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="opensAt" className={cn(typography.label, "text-text-primary")}>
              Opens
            </label>
            <input id="opensAt" name="opensAt" type="time" defaultValue={opensAt} disabled={pending} className={timeInputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="closesAt" className={cn(typography.label, "text-text-primary")}>
              Closes
            </label>
            <input id="closesAt" name="closesAt" type="time" defaultValue={closesAt} disabled={pending} className={timeInputClass} />
          </div>
        </div>
        <p className={cn(typography.metadata, "text-text-muted")}>
          Times are in your organization&apos;s timezone: <span className="text-text-secondary">{timezoneLabel}</span>. Change it under{" "}
          <Link href="/operations/settings/organization" className="font-medium text-text-link">
            Settings → Organization
          </Link>
          . Leave everything blank and save to clear the schedule.
        </p>
      </Panel>

      <Panel className="flex flex-col gap-2">
        <SectionHeader title="Contact" />
        {contactBits.length > 0 ? (
          <p className={cn(typography.bodySmall, "min-w-0 break-words text-text-secondary")}>{contactBits.join(" · ")}</p>
        ) : (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No business contact details are set.</p>
        )}
        <p className={cn(typography.metadata, "text-text-muted")}>
          Your business phone, email and primary operations contact live in one place —{" "}
          <Link href="/operations/settings/organization" className="font-medium text-text-link">
            Settings → Organization
          </Link>
          .
        </p>
      </Panel>

      <div className="flex items-center gap-zw-md">
        <Button type="submit" loading={pending} disabled={pending}>
          Save changes
        </Button>
        {state.status !== "idle" && state.message && (
          <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
