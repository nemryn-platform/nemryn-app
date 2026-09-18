import Link from "next/link";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export type RecurringCareListStateFilter = "active" | "paused" | "ended" | "all";

export interface RecurringCareStatusTabsProps {
  active: RecurringCareListStateFilter;
}

const TABS: { value: RecurringCareListStateFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
  { value: "all", label: "All" },
];

/**
 * The status-view control (P1-E2-S1E §5) — mirrors RequestStatusTabs'
 * own exact shape: a plain, shareable-URL `<Link>` segmented control,
 * no client JS required. `state=active` (the default) omits the query
 * param entirely, matching RequestStatusTabs' identical convention.
 * Only 4 tabs (the smallest useful structure, §5's own explicit
 * instruction) — audited RequestStatusTabs before adding this rather
 * than inventing a differently-shaped filter control.
 */
export function RecurringCareStatusTabs({ active }: RecurringCareStatusTabsProps) {
  function buildHref(state: RecurringCareListStateFilter) {
    return state === "active" ? "/operations/recurring-care" : `/operations/recurring-care?state=${state}`;
  }

  return (
    <nav aria-label="Recurring arrangement status" className="inline-flex flex-wrap gap-1 rounded-md border border-border-subtle bg-surface-elevated p-1">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={buildHref(tab.value)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              typography.bodySmall,
              "rounded-sm px-3 py-1.5 font-medium transition-colors duration-base",
              isActive
                ? "bg-surface-secondary text-text-primary"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
