"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Visible group label (rendered as the fieldset legend). */
  legend: ReactNode;
  name: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** "list" = compact rows; "card" = bordered option cards (e.g. request source selection). */
  variant?: "list" | "card";
  orientation?: "vertical" | "horizontal";
  required?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
}

/**
 * Radio group on native radios inside a <fieldset>/<legend> (NP-UI-P1a). Native radios already give one tab stop and
 * arrow-key selection within the group, so no custom roving logic is needed. Works in plain forms (name/value) and as a
 * controlled input (value + onChange).
 */
export function RadioGroup({ legend, name, options, value, defaultValue, onChange, variant = "list", orientation = "vertical", required, disabled, error, className }: RadioGroupProps) {
  const groupId = useId();
  const errId = error ? `${groupId}-err` : undefined;
  return (
    <fieldset className={cn("flex flex-col gap-2", className)} disabled={disabled} aria-describedby={errId} aria-invalid={error ? true : undefined}>
      <legend className={cn(typography.label, "mb-1 text-text-primary")}>
        {legend}
        {required && <span aria-hidden> *</span>}
      </legend>
      <div className={cn("flex gap-2", orientation === "vertical" ? "flex-col" : "flex-wrap")}>
        {options.map((option, i) => {
          const id = `${groupId}-${i}`;
          const descId = option.description ? `${id}-desc` : undefined;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-2",
                variant === "card" && "rounded-md border border-border-strong bg-surface-elevated px-3 py-2 has-[:checked]:border-selection-border has-[:checked]:bg-selection-background",
                option.disabled && "cursor-not-allowed opacity-70",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                required={required}
                disabled={option.disabled}
                aria-describedby={descId}
                {...(value !== undefined ? { checked: value === option.value, onChange: () => onChange?.(option.value) } : { defaultChecked: defaultValue === option.value, onChange: () => onChange?.(option.value) })}
                className="mt-0.5 size-4 shrink-0 accent-action-primary-background"
              />
              <span className="min-w-0">
                <span className={cn(typography.label, "block text-text-primary")}>{option.label}</span>
                {option.description && (
                  <span id={descId} className={cn(typography.metadata, "block text-text-secondary")}>
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errId} className={cn(typography.metadata, "text-critical-text")}>
          {error}
        </p>
      )}
    </fieldset>
  );
}