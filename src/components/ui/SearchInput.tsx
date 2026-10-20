import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Visually hidden unless `showLabel` is set — search inputs still need an accessible name. */
  label?: string;
  showLabel?: boolean;
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      label = "Search",
      showLabel = false,
      onClear,
      value,
      placeholder = "Search",
      id,
      className,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hasValue = Boolean(value);

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className={cn(typography.label, "text-text-primary", !showLabel && "sr-only")}
        >
          {label}
        </label>
        <div className="relative">
          <MagnifyingGlass
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            ref={ref}
            id={inputId}
            type="search"
            value={value}
            placeholder={placeholder}
            className={cn(
              typography.body,
              "h-10 w-full rounded-sm border border-border-strong bg-surface-elevated pl-9 text-text-primary transition-colors duration-base placeholder:text-text-disabled enabled:hover:border-text-secondary",
              onClear && hasValue ? "pr-9" : "pr-3",
              className,
            )}
            {...props}
          />
          {onClear && hasValue && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-text-muted hover:bg-surface-hover"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
