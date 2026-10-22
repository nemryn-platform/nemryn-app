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
 * StatTile: one compact operational fact — Brand Lock v2 / Concept B `.metric` anatomy (D-6 hybrid): a 42px circular
 * icon, then the fact (a NUMBER leads, at the display weight, followed by its label on the same line; a text value —
 * e.g. today's date — is a bold line), the optional detail beneath, and a chevron only when a real destination exists.
 * Status tone is never the only signal: the label always says what the number means. Not a KPI wall: a handful of
 * facts that already exist.
 */
export function StatTile({ label, value, detail, icon, tone = "neutral", href, testId }: StatTileProps) {
  const unavailable = value === null;
  const numeric = typeof value === "number";
  const body = (
    <>
      {icon && (
        <span className={cn("flex size-[2.625rem] shrink-0 items-center justify-center rounded-full", iconToneClasses[unavailable ? "neutral" : tone])} aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        {unavailable ? (
          <span className="block">
            <span className={cn(typography.bodySmall, "font-semibold text-text-muted")}>Unavailable</span>{" "}
            <span className={cn(typography.bodySmall, "font-medium text-text-secondary")}>{label}</span>
          </span>
        ) : numeric ? (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={cn(typography.metricValue, "text-[1.375rem] text-text-primary")}>{value}</span>{" "}
            <span className={cn(typography.bodySmall, "font-semibold text-text-primary")}>{label}</span>
          </span>
        ) : (
          <span className="block">
            <span className={cn(typography.bodySmall, "block font-semibold text-text-primary")}>{value}</span>
            <span className={cn(typography.metadata, "mt-0.5 block text-text-secondary")}>{label}</span>
          </span>
        )}
        {detail && <span className={cn(typography.metadata, "mt-1 block text-text-muted")}>{detail}</span>}
      </span>
      {href && <CaretRight className="size-4 shrink-0 text-text-muted transition-transform duration-base group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />}
    </>
  );
  const frame = "group flex min-h-[4.8125rem] min-w-0 items-center gap-[0.8125rem] rounded-md border border-border-subtle bg-surface-elevated px-zw-md py-3.5 shadow-sm";
  if (href) {
    return (
      <Link href={href} className={cn(frame, "transition-colors duration-base hover:border-accent-hover-border motion-reduce:transition-none")} data-testid={testId}>
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

/** A responsive row of StatTiles: 1 column on narrow, 2 at sm, 4 at xl (Concept B: 4 ≥ 1100px content, 2 below). A <ul> so the count is announced. */
export function StatTileGroup({
  children,
  label,
  className,
  testId,
  columns = 4,
}: {
  children: ReactNode[];
  label: string;
  className?: string;
  testId?: string;
  /** NP-UI-V2-2: wide-screen column count -- 3 when a row holds three real facts (no empty fourth slot). */
  columns?: 3 | 4;
}) {
  return (
    <ul aria-label={label} className={cn("grid grid-cols-1 gap-[0.8125rem] sm:grid-cols-2", columns === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4", className)} data-testid={testId}>
      {children.map((child, index) => (
        <li key={index} className="min-w-0 [&>*]:h-full">
          {child}
        </li>
      ))}
    </ul>
  );
}
