import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  options: SelectOption[];
  helpText?: string;
  error?: string;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      options,
      helpText,
      error,
      placeholder,
      required,
      disabled,
      id,
      className,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const helpId = helpText ? `${selectId}-help` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className={cn(typography.label, "text-text-primary")}>
          {label}
          {required && (
            <span className="text-critical-text" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            required={required}
            disabled={disabled}
            aria-describedby={cn(helpId, errorId) || undefined}
            aria-invalid={Boolean(error) || undefined}
            {...(props.value === undefined
              ? { defaultValue: props.defaultValue ?? (placeholder ? "" : undefined) }
              : {})}
            className={cn(
              typography.body,
              "h-10 w-full appearance-none rounded-sm border bg-surface-elevated pl-3 pr-9 text-text-primary disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-disabled",
              // NP-UI-P1b: a quiet hover affordance on enabled, valid fields; the error border never changes on hover.
            error ? "border-critical-strong" : "border-border-strong transition-colors duration-base enabled:hover:border-text-secondary",
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <CaretDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
        </div>
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
Select.displayName = "Select";
