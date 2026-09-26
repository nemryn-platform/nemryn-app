"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { clearDriverScheduleAction, saveDriverScheduleAction } from "@/app/operations/drivers/actions";
import type { WeeklyShift } from "@/lib/operations/availability-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

type Row = { key: number; weekday: string; start: string; end: string };

/**
 * P1-OPS-PROG5B -- per-driver weekly working hours (organization-local). Several ranges per day are allowed (split
 * shifts); an end time at or before the start time ends on the next day (overnight). Saving replaces the whole set;
 * "Clear working hours" returns the driver to "Schedule not set". The database re-validates everything (including
 * overlaps across the week, Sunday night into Monday included).
 */
export function WorkingHoursDialog({
  driverId,
  driverName,
  configured,
  shifts,
  timezone,
  onClose,
}: {
  driverId: string;
  driverName: string;
  configured: boolean;
  shifts: WeeklyShift[];
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    shifts.length > 0
      ? shifts.map((s, i) => ({ key: i, weekday: String(s.weekday), start: s.start, end: s.end }))
      : [{ key: 0, weekday: "1", start: "09:00", end: "17:00" }],
  );
  const nextKey = () => Math.max(0, ...rows.map((r) => r.key)) + 1;

  function run(task: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title={`Working hours · ${driverName}`} description={`Regular weekly hours, in the organization's timezone (${timezone}).`}>
      <form
        className="flex flex-col gap-zw-md"
        data-testid="working-hours-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveDriverScheduleAction(driverId, rows.map((r) => ({ weekday: Number(r.weekday), start: r.start, end: r.end }))));
        }}
      >
        <ul className="flex flex-col gap-zw-sm">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[10rem_8rem_8rem_auto]" data-testid="working-hours-row">
              <Select
                label="Day"
                name="weekday"
                options={WEEKDAYS}
                value={row.weekday}
                onChange={(e) => setRows(rows.map((r) => (r.key === row.key ? { ...r, weekday: e.target.value } : r)))}
                disabled={pending}
              />
              <Input label="Start" name="start" type="time" required value={row.start} onChange={(e) => setRows(rows.map((r) => (r.key === row.key ? { ...r, start: e.target.value } : r)))} disabled={pending} />
              <Input
                label="End"
                name="end"
                type="time"
                required
                value={row.end}
                onChange={(e) => setRows(rows.map((r) => (r.key === row.key ? { ...r, end: e.target.value } : r)))}
                helpText={row.end && row.start && row.end <= row.start ? "Ends the next day" : undefined}
                disabled={pending}
              />
              <Button type="button" variant="outline" size="sm" disabled={pending || rows.length === 1} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={pending || rows.length >= 28} onClick={() => setRows([...rows, { key: nextKey(), weekday: "1", start: "09:00", end: "17:00" }])}>
            Add hours
          </Button>
        </div>
        {error && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          {configured ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => clearDriverScheduleAction(driverId))}>
              Clear working hours
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
