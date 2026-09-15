import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export type StatusCategory =
  | "neutral"
  | "informational"
  | "active"
  | "positive"
  | "warning"
  | "critical"
  | "completed"
  | "cancelled";

const categoryClasses: Record<StatusCategory, string> = {
  neutral: "bg-surface-secondary text-text-secondary",
  informational: "bg-info-bg text-info-text",
  active: "bg-info-bg text-info-text",
  positive: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  critical: "bg-critical-bg text-critical-text",
  completed: "bg-success-bg text-success-text",
  cancelled: "bg-surface-secondary text-text-muted",
};

const dotClasses: Record<StatusCategory, string> = {
  neutral: "bg-text-muted",
  informational: "bg-info-strong",
  active: "bg-info-strong",
  positive: "bg-success-strong",
  warning: "bg-warning-strong",
  critical: "bg-critical-strong",
  completed: "bg-success-strong",
  cancelled: "bg-text-disabled",
};

export interface StatusBadgeProps {
  /** Always required — status is never communicated by color/dot alone. */
  label: string;
  category: StatusCategory;
  className?: string;
}

/**
 * Visual status presentation only (see interface-principles.md §4). This is
 * not a state machine — `label`/`category` pairs are supplied by callers,
 * never hard-coded workflow logic here.
 */
export function StatusBadge({ label, category, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        typography.metadata,
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
        categoryClasses[category],
        className,
      )}
    >
      {category === "completed" ? (
        <CheckCircle className="size-3.5" weight="fill" aria-hidden />
      ) : (
        <span className={cn("size-1.5 rounded-full", dotClasses[category])} aria-hidden />
      )}
      {label}
    </span>
  );
}
