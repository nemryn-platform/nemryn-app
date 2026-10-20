"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { firstEnabled, nextIndex } from "@/lib/ui/ui-core";

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Optional count shown after the label (text, never colour-only). */
  count?: number;
  disabled?: boolean;
  panel: ReactNode;
}

/**
 * Tabs with panels (NP-UI-P1a; WAI-ARIA tabs pattern, automatic activation): role=tablist / tab / tabpanel, one tab
 * stop (roving tabindex), Left / Right / Home / End move between enabled tabs. For URL-driven filters that navigate
 * between pages, use links with aria-current instead (navigation, not tabs).
 */
export function Tabs({ items, value, defaultValue, onValueChange, label, className }: { items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; label: string; className?: string }) {
  const baseId = useId();
  const disabled = items.map((t) => Boolean(t.disabled));
  const initial = defaultValue ?? items[firstEnabled(disabled)]?.value;
  const [internal, setInternal] = useState(initial);
  const current = value ?? internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (i: number) => {
    const v = items[i].value;
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
    refs.current[i]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, i: number) => {
    const n = nextIndex(event.key, i, disabled, "horizontal");
    if (n === null) return;
    event.preventDefault();
    select(n);
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border-subtle">
        {items.map((t, i) => {
          const selected = t.value === current;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${baseId}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => select(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                typography.label,
                "-mb-px border-b-2 px-3 py-2 disabled:cursor-not-allowed disabled:text-text-disabled",
                selected ? "border-text-primary text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 tabular-nums text-text-secondary">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {items.map((t, i) => (
        <div key={t.value} id={`${baseId}-panel-${i}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${i}`} hidden={t.value !== current} tabIndex={0} className="pt-zw-md">
          {t.panel}
        </div>
      ))}
    </div>
  );
}

export interface SegmentOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Segmented control for one choice among a few in-place views (NP-UI-P1a): role=radiogroup with role=radio buttons,
 * one tab stop, arrow keys move AND select (radio semantics). Not for page navigation.
 */
export function SegmentedControl({ options, value, onValueChange, label, size = "md", className }: { options: SegmentOption[]; value: string; onValueChange: (value: string) => void; label: string; size?: "sm" | "md"; className?: string }) {
  const disabled = options.map((o) => Boolean(o.disabled));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const choose = (i: number) => {
    onValueChange(options[i].value);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border border-border-subtle bg-surface-elevated p-0.5", className)}>
      {options.map((o, i) => {
        const selected = i === currentIndex;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            onClick={() => choose(i)}
            onKeyDown={(e) => {
              const n = nextIndex(e.key, i, disabled, "horizontal") ?? nextIndex(e.key, i, disabled, "vertical");
              if (n === null) return;
              e.preventDefault();
              choose(n);
            }}
            className={cn(
              typography.label,
              "rounded-sm px-3 disabled:cursor-not-allowed disabled:text-text-disabled",
              size === "sm" ? "py-1" : "py-1.5",
              selected ? "bg-surface-secondary text-text-primary" : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
