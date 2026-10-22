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
  // Brand Lock v2 (D-2): the teal primary with the Concept B gradient over the solid token; hover drops the gradient
  // to the darker solid hover token (white text 6.1:1 → 7.4:1 in every state).
  primary:
    "border border-action-primary-hover bg-action-primary-background bg-action-primary-gradient text-action-primary-foreground hover:bg-action-primary-hover hover:bg-none",
  secondary: "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  outline: "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-hover",
  text: "bg-transparent text-text-link hover:bg-surface-hover",
  destructive: "bg-action-destructive-background text-action-destructive-foreground hover:bg-action-destructive-hover",
};

// NP-UI-P1b: one control radius for every size (rounded-sm = 8px, the same as inputs and nav items) and one height
// scale: sm 32 · md 40 (the unified header / page-action height) · lg 48.
// Brand Lock v2 §3: the standard action is 42px (Concept B .btn min-height 42, padding 17, radius 9 = rounded-sm).
export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 rounded-sm gap-1.5",
  md: "h-[2.625rem] px-[1.0625rem] rounded-sm gap-2",
  lg: "h-12 px-6 rounded-sm gap-2",
};

/** Brand Lock v2: the restrained Concept B hover lift — enabled controls only, and none under reduced motion. */
export const buttonHoverLift =
  "hover:-translate-y-px hover:shadow-button-hover motion-reduce:hover:translate-y-0 motion-reduce:hover:shadow-none";

export function buttonClassNames(
  variant: ButtonVariant,
  size: ButtonSize,
  disabled: boolean | undefined,
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-base ease-standard motion-reduce:transition-none",
    disabled ? "cursor-not-allowed opacity-50" : variant !== "text" && buttonHoverLift,
    typography.button,
    buttonVariantClasses[variant],
    buttonSizeClasses[size],
    className,
  );
}
