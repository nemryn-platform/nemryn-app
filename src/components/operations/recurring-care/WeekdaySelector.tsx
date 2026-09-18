"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { recurringWeekdayShortLabel, recurringWeekdayFullLabel } from "@/lib/operations/presentation";

const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 7];

export interface WeekdaySelectorProps {
  name: string;
  /** ISO weekday numbers (1=Monday..7=Sunday) already selected — never exposed to the operator as raw integers, only as day labels. */
  defaultValue?: number[];
  disabled?: boolean;
  error?: string;
}

/**
 * A simple seven-day toggle-group (P1-E2-S1E §10) — no multi-select
 * primitive existed in the design system before this (confirmed by
 * search), so this is a small, purpose-built control rather than a
 * forced fit into `Select`/`Combobox` (both single-value). Monday →
 * Sunday ordering always, regardless of the underlying ISO weekday
 * numbering's own storage order. Real `<button>` elements (not styled
 * `<input type="checkbox">`) for full native keyboard operability
 * (Tab/Space/Enter) without fighting default checkbox appearance;
 * `aria-pressed` communicates toggle state to assistive tech, and the
 * visible label text itself (not color alone) also changes weight/
 * background — never a color-only signal (§38).
 *
 * Submits as ordinary `FormData` under `name` — one hidden input per
 * SELECTED day, so `formData.getAll(name)` on the server yields exactly
 * the selected ISO weekday numbers as strings, in NO particular
 * guaranteed order (the RPC itself normalizes/dedupes/sorts — the UI
 * never needs to pre-sort what it sends, matching "Do not require UI
 * clients to understand canonical storage ordering," P1-E2-S1D §7).
 */
export function WeekdaySelector({ name, defaultValue = [], disabled = false, error }: WeekdaySelectorProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set(defaultValue));

  function toggle(day: number) {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn(typography.label, "text-text-primary")}>
        Days of week
        <span className="text-critical-text" aria-hidden>
          {" "}
          *
        </span>
      </span>
      <div role="group" aria-label="Days of week" className="inline-flex flex-wrap gap-1 rounded-md border border-border-subtle bg-surface-elevated p-1">
        {WEEKDAYS_MONDAY_FIRST.map((day) => {
          const isSelected = selected.has(day);
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={recurringWeekdayFullLabel(day)}
              onClick={() => toggle(day)}
              className={cn(
                typography.bodySmall,
                "rounded-sm px-3 py-1.5 font-medium transition-colors duration-base disabled:cursor-not-allowed disabled:opacity-60",
                isSelected
                  ? "bg-surface-secondary text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
              )}
            >
              {recurringWeekdayShortLabel(day)}
            </button>
          );
        })}
      </div>
      {selected.size === 0 && !error && (
        <p className={cn(typography.metadata, "text-text-muted")}>Select at least one day.</p>
      )}
      {error && <p className={cn(typography.metadata, "text-critical-text")}>{error}</p>}
      {[...selected].map((day) => (
        <input key={day} type="hidden" name={name} value={day} />
      ))}
    </div>
  );
}
