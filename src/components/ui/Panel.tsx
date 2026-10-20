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
  children: ReactNode;
}

const paddingClasses: Record<NonNullable<PanelProps["padding"]>, string> = {
  standard: "p-zw-lg",
  dense: "p-zw-md",
  none: "p-0",
};

/**
 * Standard operational panel: white surface, 1px subtle border, 8px radius (radius.md), no shadow by default. Not
 * every grouping needs to be a Panel — see the card rule in interface-principles.md §1 before reaching for this.
 * Callers that already pass a padding class (`p-0`, `p-zw-md`) keep working: `padding` defaults to "standard" only
 * when `className` sets no padding of its own.
 */
export function Panel({ elevated = false, padding, className, children, ...props }: PanelProps) {
  const callerPadding = typeof className === "string" && /(^|\s)p-/.test(className);
  return (
    <div
      className={cn(
        "rounded-md border border-border-subtle bg-surface-elevated",
        !callerPadding && paddingClasses[padding ?? "standard"],
        elevated && "shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type PanelTone = "neutral" | "info" | "positive" | "attention" | "critical";

/**
 * NP-UI-P1b icon-tile tones, shared by PanelHeader, StatTile and the Brief blocks: the status `*-bg` wash plus a faint
 * inset ring in the same family (existing semantic tokens only). Decorative — the text beside the tile carries the
 * meaning; "attention" / "critical" only for something that needs it.
 */
export const iconToneClasses: Record<PanelTone, string> = {
  neutral: "bg-surface-secondary text-text-secondary ring-1 ring-inset ring-border-subtle",
  info: "bg-info-bg text-info-text ring-1 ring-inset ring-info-border/25",
  positive: "bg-success-bg text-success-text ring-1 ring-inset ring-success-border/25",
  attention: "bg-warning-bg text-warning-text ring-1 ring-inset ring-warning-border/30",
  critical: "bg-critical-bg text-critical-text ring-1 ring-inset ring-critical-border/25",
};

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
}

/**
 * NP-UI-P1b premium card anatomy: optional icon tile, title, one-line description, right-aligned actions. Pure
 * presentation; the heading level is the caller's choice so the page outline never skips a level.
 */
export function PanelHeader({ title, description, icon, tone = "neutral", actions, as: Heading = "h3", titleId, className }: PanelHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", iconToneClasses[tone])} aria-hidden>
            {icon}
          </span>
        )}
        <div className={cn("min-w-0", icon && "pt-0.5")}>
          <Heading id={titleId} className={cn(typography.subsectionHeading, "text-text-primary")}>
            {title}
          </Heading>
          {description && <p className={cn(typography.bodySmall, "mt-0.5 text-text-secondary")}>{description}</p>}
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
        part === "footer" && "mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-surface-app/60 px-zw-lg py-zw-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
