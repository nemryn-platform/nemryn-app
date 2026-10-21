import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface SummaryItem {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "critical";
  /** Small colored status dot preceding the value — only meaningful with `inline` (P1-E3-S4). */
  dot?: boolean;
}

export interface SummaryStripProps {
  items: SummaryItem[];
  className?: string;
  /**
   * Single flowing row — bold value immediately followed by its lowercase
   * label, divided by a vertical rule (matches
   * docs/design/stitch/references/01-todays-operations.png's compact
   * metric strip). Default `false` keeps the original stacked
   * value-over-label block (src/app/foundation's showcase usage).
   */
  inline?: boolean;
}

const toneClasses: Record<NonNullable<SummaryItem["tone"]>, string> = {
  default: "text-text-primary",
  warning: "text-warning-text",
  critical: "text-critical-text",
};

const dotClasses: Record<NonNullable<SummaryItem["tone"]>, string> = {
  default: "bg-success-strong",
  warning: "bg-warning-strong",
  critical: "bg-critical-strong",
};

/**
 * A row of real operational figures — never decorative KPI cards. Each item
 * is a caller-supplied count (e.g. today's scheduled trips), not a fabricated
 * statistic. No per-item card wrapper; a single divided row instead.
 */
export function SummaryStrip({ items, className, inline = false }: SummaryStripProps) {
  if (inline) {
    return (
      <div
        className={cn(
          // NP-UI-P2: the approved subtle raise and a more prominent, tabular value (the same real figures).
          "flex flex-wrap items-center divide-x divide-border-subtle rounded-md border border-border-subtle bg-surface-elevated shadow-sm",
          className,
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 px-zw-lg py-zw-md">
            {item.dot && <span className={cn("size-2 rounded-full", dotClasses[item.tone ?? "default"])} aria-hidden />}
            <span className={cn(typography.sectionHeading, "tabular-nums", toneClasses[item.tone ?? "default"])}>
              {item.value}
            </span>
            <span className={cn(typography.bodySmall, "text-text-secondary")}>{item.label}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap divide-x divide-border-subtle rounded-md border border-border-subtle bg-surface-elevated",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex-1 px-zw-lg py-zw-md">
          <p className={cn(typography.sectionHeading, toneClasses[item.tone ?? "default"])}>
            {item.value}
          </p>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>{item.label}</p>
        </div>
      ))}
    </div>
  );
}
