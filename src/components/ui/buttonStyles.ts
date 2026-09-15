import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export type ButtonVariant = "primary" | "secondary" | "outline" | "text" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * N0-M2-A4: `secondary` previously rendered as a solid Deep Graphite fill
 * (`bg-brand-care-navy text-white`) — visually indistinguishable from
 * `primary`, and in direct conflict with the LOCKED design-token spec's
 * own definition of `action.secondary` (transparent/outline — "one
 * primary action per view", 12-design-token-specification.md §2.4).
 * Corrected to the same transparent/border/text-primary composition
 * `outline` already uses (the spec defines no separate `action-
 * secondary-*` custom properties — `outline` already is that role
 * under a different name). Had exactly one call site anywhere in the
 * app (the internal foundation/page.tsx demo), so this carries zero
 * production visual change.
 */
export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: "bg-action-primary-background text-action-primary-foreground hover:bg-action-primary-hover",
  secondary: "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  outline: "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  text: "bg-transparent text-text-link hover:bg-surface-hover",
  destructive: "bg-action-destructive-background text-action-destructive-foreground hover:bg-action-destructive-hover",
};

export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 rounded-xs gap-1.5",
  md: "h-10 px-4 rounded-sm gap-2",
  lg: "h-12 px-6 rounded-md gap-2",
};

export function buttonClassNames(
  variant: ButtonVariant,
  size: ButtonSize,
  disabled: boolean | undefined,
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-base ease-standard",
    disabled && "cursor-not-allowed opacity-50",
    typography.button,
    buttonVariantClasses[variant],
    buttonSizeClasses[size],
    className,
  );
}
