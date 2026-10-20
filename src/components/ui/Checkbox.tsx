"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** Supporting text under the label (linked with aria-describedby). */
  description?: ReactNode;
  error?: string;
}

/**
 * Native checkbox with a visible label (NP-UI-P1a). A real <input type="checkbox"> -- forms, keyboard (Space), and
 * screen readers work natively; the label is the click target. Focus ring comes from the global :focus-visible rule.
 */
export function Checkbox({ label, description, error, id, className, disabled, ...props }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = description ? `${inputId}-desc` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <input
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={[descId, errId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-action-primary-background disabled:cursor-not-allowed"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className={cn(typography.label, "cursor-pointer text-text-primary", disabled && "cursor-not-allowed text-text-disabled")}>
          {label}
        </label>
        {description && (
          <p id={descId} className={cn(typography.metadata, "text-text-secondary")}>
            {description}
          </p>
        )}
        {error && (
          <p id={errId} className={cn(typography.metadata, "text-critical-text")}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}