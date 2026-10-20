import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  helpText?: string;
  error?: string;
  size?: "md" | "lg";
}

/**
 * Labeled text input. Placeholder text is never a substitute for the visible
 * label. Error state is always paired with a text message, never color alone.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, helpText, error, required, disabled, size = "md", id, className, ...props },
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
        <input
          ref={ref}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-describedby={cn(helpId, errorId) || undefined}
          aria-invalid={Boolean(error) || undefined}
          className={cn(
            typography.body,
            "w-full rounded-sm border bg-surface-elevated text-text-primary placeholder:text-text-disabled disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-disabled",
            size === "lg" ? "h-12 px-4" : "h-10 px-3",
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
Input.displayName = "Input";
