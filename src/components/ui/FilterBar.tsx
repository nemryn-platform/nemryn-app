import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface FilterBarProps {
  /** Usually a SearchInput (label kept for screen readers). */
  search?: ReactNode;
  /** Selects, a SegmentedControl, filter links… Keep URL filters as real links / GET forms. */
  filters?: ReactNode;
  /** Trailing actions, e.g. "Clear filters" or "Apply" for a GET form. */
  actions?: ReactNode;
  /** The live result count, e.g. "24 trips" — announced politely when it changes. */
  resultCount?: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * NP-UI-P1b FilterBar foundation: one consistent frame for list filters (search · filters · actions · result count).
 * Layout only — it owns no state and does not change how a list filters (instant or "Apply"; that model is a
 * per-screen decision, roadmap D4). No list is migrated in P1b.
 */
export function FilterBar({ search, filters, actions, resultCount, className, testId }: FilterBarProps) {
  return (
    <div className={cn("flex flex-col gap-zw-sm rounded-md border border-border-subtle bg-surface-elevated p-zw-md", className)} data-testid={testId}>
      <div className="flex flex-wrap items-end gap-zw-sm">
        {search && <div className="min-w-56 flex-1">{search}</div>}
        {filters && <div className="flex flex-wrap items-end gap-zw-sm">{filters}</div>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {resultCount !== undefined && (
        <p className={cn(typography.metadata, "text-text-secondary")} aria-live="polite">
          {resultCount}
        </p>
      )}
    </div>
  );
}
