import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helpText?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { label, helpText, error, required, disabled, rows = 4, id, className, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helpId = helpText ? `${inputId}-help` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className={cn(typography.label, "text-text-primary")}>
          {label}
          {required && (
            <span className="text-critical-text" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          required={required}
          disabled={disabled}
          aria-describedby={cn(helpId, errorId) || undefined}
          aria-invalid={Boolean(error) || undefined}
          className={cn(
            typography.body,
            "resize-y rounded-sm border bg-surface-elevated px-3 py-2 text-text-primary placeholder:text-text-disabled disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-disabled",
            // NP-UI-P1b: a quiet hover affordance on enabled, valid fields; the error border never changes on hover.
            error ? "border-critical-strong" : "border-border-strong transition-colors duration-base enabled:hover:border-text-secondary",
            className,
          )}
          {...props}
        />
        {helpText && !error && (
          <p id={helpId} className={cn(typography.metadata, "text-text-muted")}>
            {helpText}
          </p>
        )}
        {error && (
          <p id={errorId} className={cn(typography.metadata, "text-critical-text")}>
            {error}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
