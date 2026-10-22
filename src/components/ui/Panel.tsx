import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds shadow-sm. Panels default to no shadow — hierarchy should come from borders/spacing first. */
  elevated?: boolean;
  /**
   * NP-UI-P1b card padding: "standard" 24px (the default, unchanged), "dense" 16px for compact rows / side rails,
   * "none" when the panel's header and body manage their own padding (tables, lists with dividers).
   */
  padding?: "standard" | "dense" | "none";
  /**
   * Brand Lock v2 (§4, D-8) panel surfaces:
   * - "default": the white card (12px radius; `elevated` adds the soft card shadow) — unchanged for every existing caller;
   * - "raised": a major white panel (14px radius, panel shadow) — dashboard panels;
   * - "mint": the teal-tinted panel for get started / positive guidance;
   * - "sand": the warm panel for work awaiting review.
   * Tints are decorative: the icon and text carry the meaning. Never used on print views.
   */
  surface?: PanelSurface;
  children: ReactNode;
}

export type PanelSurface = "default" | "raised" | "mint" | "sand";

const surfaceClasses: Record<PanelSurface, string> = {
  default: "rounded-md border border-border-subtle bg-surface-elevated",
  raised: "rounded-lg border border-border-subtle bg-surface-elevated shadow-panel",
  mint: "rounded-lg border border-accent-border bg-surface-elevated bg-panel-mint shadow-panel",
  sand: "rounded-lg border border-accent-sand-border bg-accent-sand bg-panel-sand shadow-panel",
};

const paddingClasses: Record<NonNullable<PanelProps["padding"]>, string> = {
  standard: "p-zw-lg",
  dense: "p-zw-md",
  none: "p-0",
};

/**
 * Standard operational panel: white surface, 1px subtle border, 12px radius (radius.md, Brand Lock v2), no shadow by default. Not
 * every grouping needs to be a Panel — see the card rule in interface-principles.md §1 before reaching for this.
 * Callers that already pass a padding class (`p-0`, `p-zw-md`) keep working: `padding` defaults to "standard" only
 * when `className` sets no padding of its own.
 */
export function Panel({ elevated = false, padding, surface = "default", className, children, ...props }: PanelProps) {
  const callerPadding = typeof className === "string" && /(^|\s)p-/.test(className);
  return (
    <div
      className={cn(
        surfaceClasses[surface],
        !callerPadding && paddingClasses[padding ?? "standard"],
        elevated && surface === "default" && "shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type PanelTone = "neutral" | "accent" | "info" | "positive" | "attention" | "critical";

/**
 * Icon-circle tones, shared by PanelHeader, StatTile and the Brief blocks (Brand Lock v2 §4: Concept B's soft circular
 * icon tiles). "accent" is the brand teal on mint (guidance, today, setup); the status tones keep their v1 meanings.
 * Decorative — the text beside the circle carries the meaning; "attention" / "critical" only for something that
 * needs it.
 */
export const iconToneClasses: Record<PanelTone, string> = {
  neutral: "bg-surface-secondary text-text-secondary",
  accent: "bg-accent-soft-strong text-text-link",
  info: "bg-info-bg text-info-text",
  positive: "bg-success-bg text-success-text",
  attention: "bg-warning-bg text-warning-text",
  critical: "bg-critical-bg text-critical-text",
};

/** Brand Lock v2: the circular icon tile. "md" 40px (cards), "lg" 45px (Overview panels, Concept B .panel-icon). */
export const iconCircleClasses = {
  md: "flex size-10 shrink-0 items-center justify-center rounded-full",
  lg: "flex size-[2.8125rem] shrink-0 items-center justify-center rounded-full",
} as const;

export interface PanelHeaderProps {
  title: string;
  description?: ReactNode;
  /** A Phosphor icon (aria-hidden) shown in a 40px tinted tile — the Concept B card anatomy. Decorative only. */
  icon?: ReactNode;
  /** Semantic tint of the icon tile. Status colours keep their meaning: "attention" only for something that needs attention. */
  tone?: PanelTone;
  /** Right-aligned meta / actions (a StatusBadge count, a LinkButton). */
  actions?: ReactNode;
  /** Heading level inside the page's outline (default h3: panels usually sit under a section h2). */
  as?: "h2" | "h3";
  titleId?: string;
  className?: string;
  /**
   * Brand Lock v2: "display" = an Overview dashboard panel title (Newsreader 22px, 45px icon circle, Concept B
   * `.panel-head`); "standard" (default) = the 15px card title used across the app, unchanged.
   */
  variant?: "standard" | "display";
}

/**
 * Card anatomy: optional circular icon, title, one-line description, right-aligned actions. Pure presentation; the
 * heading level is the caller's choice so the page outline never skips a level.
 */
export function PanelHeader({ title, description, icon, tone = "neutral", actions, as: Heading = "h3", titleId, className, variant = "standard" }: PanelHeaderProps) {
  const display = variant === "display";
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className={cn("flex min-w-0 items-start", display ? "gap-[0.8125rem]" : "gap-3")}>
        {icon && (
          <span className={cn(iconCircleClasses[display ? "lg" : "md"], iconToneClasses[tone])} aria-hidden>
            {icon}
          </span>
        )}
        <div className={cn("min-w-0", icon && (display ? "pt-[3px]" : "pt-0.5"))}>
          <Heading id={titleId} className={cn(display ? typography.displayCard : typography.subsectionHeading, "text-text-primary")}>
            {title}
          </Heading>
          {description && <p className={cn(typography.bodySmall, display ? "mt-1 leading-normal text-text-secondary" : "mt-0.5 text-text-secondary")}>{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * NP-UI-P1b card rhythm for a `padding="none"` Panel: "header" (24px sides / top, 16px bottom), "body" (24px, set off
 * by a hairline when it follows a header), "footer" (a quiet hairline-separated action row, actions right-aligned).
 */
export function PanelSection({ part, className, children }: { part: "header" | "body" | "footer"; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        part === "header" && "px-zw-lg pb-zw-md pt-zw-lg",
        part === "body" && "border-t border-border-subtle px-zw-lg py-zw-md",
        part === "footer" && "mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-zw-lg py-zw-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
