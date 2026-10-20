"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** When set, a hidden input submits "on" / nothing with the surrounding form, like a checkbox. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * On / off switch (NP-UI-P1a): a <button role="switch" aria-checked> (WAI-ARIA switch pattern; Space / Enter toggle
 * natively through the button). The state is shown by position AND text ("On" / "Off"), never colour alone.
 */
export function Switch({ label, description, checked, defaultChecked = false, onCheckedChange, name, disabled, className }: SwitchProps) {
  const id = useId();
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked ?? internal;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!on);
    onCheckedChange?.(!on);
  };
  return (
    <div className={cn("flex items-start justify-between gap-zw-md", className)}>
      <div className="min-w-0">
        <label id={`${id}-label`} htmlFor={id} className={cn(typography.label, "text-text-primary", disabled && "text-text-disabled")}>
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className={cn(typography.metadata, "text-text-secondary")}>
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
          on ? "border-action-primary-background bg-action-primary-background" : "border-border-strong bg-surface-secondary",
        )}
      >
        <span aria-hidden className={cn("size-4 rounded-full bg-surface-elevated shadow-sm transition-transform duration-150", on ? "translate-x-5" : "translate-x-0")} />
        <span className="sr-only">{on ? "On" : "Off"}</span>
      </button>
      {name && on && <input type="hidden" name={name} value="on" />}
    </div>
  );
}
