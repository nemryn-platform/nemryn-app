import Link from "next/link";
import type { ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { iconToneClasses, type PanelTone } from "./Panel";

export interface StatTileProps {
  /** The fact's label, e.g. "trips today". Always shown — a value never stands alone. */
  label: string;
  /**
   * A REAL, caller-supplied value. `null` = could not be loaded: the tile says "Unavailable", never 0 (unknown is never
   * shown as zero). Never a fabricated or illustrative number.
   */
  value: string | number | null;
  /** Optional supporting line (e.g. the oldest request date). */
  detail?: ReactNode;
  /** Decorative Phosphor icon in a tinted tile. */
  icon?: ReactNode;
  tone?: PanelTone;
  /** Only when an existing destination exists for this fact; otherwise the tile is static text. */
  href?: string;
  testId?: string;
}

/**
 * NP-UI-P1b StatTile: one compact operational fact (Concept B "Operations Brief" tile anatomy). Top row: the icon
 * tile and, only when a real destination exists, a chevron; then the value (metricValue, tabular) over its label and
 * optional detail. Status tone is never the only signal: the label always says what the number means. Not a KPI card
 * wall: use a handful, for facts that already exist.
 */
export function StatTile({ label, value, detail, icon, tone = "neutral", href, testId }: StatTileProps) {
  const unavailable = value === null;
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        {icon ? (
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", iconToneClasses[unavailable ? "neutral" : tone])} aria-hidden>
            {icon}
          </span>
        ) : (
          <span />
        )}
        {href && <CaretRight className="mt-1 size-4 shrink-0 text-text-muted transition-transform duration-base group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />}
      </span>
      <span className="mt-zw-sm block min-w-0">
        <span className={cn("block", unavailable ? cn(typography.body, "font-medium text-text-muted") : cn(typography.metricValue, "text-text-primary"))}>
          {unavailable ? "Unavailable" : value}
        </span>
        <span className={cn(typography.bodySmall, "mt-0.5 block font-medium text-text-secondary")}>{label}</span>
        {detail && <span className={cn(typography.metadata, "mt-0.5 block text-text-muted")}>{detail}</span>}
      </span>
    </>
  );
  const frame = "group flex min-w-0 flex-col rounded-md border border-border-subtle bg-surface-elevated px-zw-md py-zw-md shadow-sm";
  if (href) {
    return (
      <Link href={href} className={cn(frame, "transition-colors duration-base hover:border-border-strong motion-reduce:transition-none")} data-testid={testId}>
        {body}
      </Link>
    );
  }
  return (
    <div className={frame} data-testid={testId}>
      {body}
    </div>
  );
}

/** A responsive row of StatTiles: 1 column on narrow, 2 at sm, up to 4 at xl. A <ul> so the count is announced. */
export function StatTileGroup({ children, label, className, testId }: { children: ReactNode[]; label: string; className?: string; testId?: string }) {
  return (
    <ul aria-label={label} className={cn("grid grid-cols-1 gap-zw-sm sm:grid-cols-2 xl:grid-cols-4", className)} data-testid={testId}>
      {children.map((child, index) => (
        <li key={index} className="min-w-0 [&>*]:h-full">
          {child}
        </li>
      ))}
    </ul>
  );
}
