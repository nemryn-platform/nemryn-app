"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { ManagedWindow, WindowFormInput } from "@/lib/operations/availability";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

type Result = { ok: true } | { ok: false; message: string };

/**
 * P1-OPS-PROG5B -- list + add / edit / delete of time windows (driver time off, vehicle out of service). Timing only:
 * there is deliberately no reason / note field. Times are organization-local; conversion happens server-side.
 */
export function WindowsDialog({
  title,
  description,
  emptyText,
  windows,
  timezone,
  onSave,
  onDelete,
  onClose,
  testId,
}: {
  title: string;
  description: string;
  emptyText: string;
  windows: ManagedWindow[];
  timezone: string;
  onSave: (windowId: string | null, input: WindowFormInput) => Promise<Result>;
  onDelete: (windowId: string) => Promise<Result>;
  onClose: () => void;
  testId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  function reset() {
    setEditingId(null);
    setAllDay(true);
    setStartDate("");
    setEndDate("");
    setStartTime("09:00");
    setEndTime("17:00");
  }
  function edit(w: ManagedWindow) {
    setEditingId(w.id);
    setAllDay(w.allDay);
    setStartDate(w.startDate);
    setEndDate(w.endDate);
    setStartTime(w.startTime);
    setEndTime(w.endTime);
    setError(null);
  }
  function run(task: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        reset();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <div className="flex flex-col gap-zw-md" data-testid={testId}>
        {windows.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-muted")}>{emptyText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle" data-testid={`${testId}-list`}>
            {windows.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 py-2" data-testid={`${testId}-item`}>
                <span className={cn(typography.bodySmall, "text-text-primary")}>{w.label}</span>
                <span className="flex gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => edit(w)}>
                    Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => onDelete(w.id))}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-zw-sm rounded-sm border border-border-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onSave(editingId, { startDate, endDate, allDay, startTime, endTime }));
          }}
        >
          <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>{editingId ? "Edit entry" : "Add entry"}</p>
          <label className={cn(typography.bodySmall, "flex items-center gap-2 text-text-primary")}>
            <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={pending} />
            All day
          </label>
          <div className="grid grid-cols-1 gap-zw-sm sm:grid-cols-2">
            <Input label="From date" name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={pending} />
            {!allDay && <Input label="From time" name="startTime" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={pending} />}
            <Input label={allDay ? "Through date" : "To date"} name="endDate" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={pending} />
            {!allDay && <Input label="To time" name="endTime" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={pending} />}
          </div>
          <p className={cn(typography.metadata, "text-text-muted")}>Times are in the organization&apos;s timezone ({timezone}).</p>
          {error && (
            <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {editingId && (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={reset}>
                Cancel edit
              </Button>
            )}
            <Button type="submit" size="sm" loading={pending} disabled={pending}>
              {editingId ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
