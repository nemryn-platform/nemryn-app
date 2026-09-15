import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "@/lib/cn";

export type IconButtonVariant = "ghost" | "outline" | "primary";

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: "bg-transparent text-text-secondary hover:bg-surface-hover",
  outline:
    "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  primary:
    "bg-action-primary-background text-action-primary-foreground hover:bg-action-primary-hover",
};

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — an icon-only control must still have an accessible name. */
  label: string;
  icon: ReactElement;
  variant?: IconButtonVariant;
}

/**
 * Icon-only control. Always requires `label` for screen readers — icons
 * support comprehension, they do not replace accessible naming.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, variant = "ghost", disabled, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-sm transition-colors duration-base ease-standard disabled:cursor-not-allowed disabled:opacity-50",
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
