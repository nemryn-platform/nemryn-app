import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "@/lib/cn";

export type IconButtonVariant = "ghost" | "outline" | "primary" | "chrome";
export type IconButtonSize = "sm" | "md";

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: "bg-transparent text-text-secondary hover:bg-surface-hover",
  outline:
    "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  primary:
    "bg-action-primary-background bg-action-primary-gradient text-action-primary-foreground hover:bg-action-primary-hover hover:bg-none",
  // NP-UI-P1b: on the dark shell chrome (sidebar) -- chrome.text tokens, never body-text greys on graphite.
  chrome: "bg-transparent text-chrome-text-secondary hover:bg-chrome-item-hover hover:text-chrome-text-primary",
};

// NP-UI-P1b: md = 44px (the default, touch-sized); sm = 40px, the unified header-control height (Button md).
const sizeClasses: Record<IconButtonSize, string> = {
  sm: "size-10",
  md: "size-11",
};

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — an icon-only control must still have an accessible name. */
  label: string;
  icon: ReactElement;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

/**
 * Icon-only control. Always requires `label` for screen readers — icons
 * support comprehension, they do not replace accessible naming.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, variant = "ghost", size = "md", disabled, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-sm transition-colors duration-base ease-standard disabled:cursor-not-allowed disabled:opacity-50",
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
