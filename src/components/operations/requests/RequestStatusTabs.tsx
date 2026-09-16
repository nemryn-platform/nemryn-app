import Link from "next/link";
import type { RequestsListStateFilter } from "@/lib/operations/requests-list";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestStatusTabsProps {
  active: RequestsListStateFilter;
  /** Preserved across a tab switch — matches Trips/Passengers' own established filter-form conventions (a status change should not silently discard an in-progress search). */
  search: string;
}

const TABS: { value: RequestsListStateFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

/**
 * The status-view control (P1-E1-S2D §7) — a restrained, plain-`<Link>`
 * segmented control, not a client-side JS tab widget. Every tab is a
 * real, shareable, reload-safe URL (`?state=accepted`, etc.) — no
 * client JS is required for this control to work at all, matching the
 * same "plain GET query params" philosophy TripsListPage's own filter
 * bar already established. `state=pending` (the default) omits the
 * query param entirely for the cleanest possible default URL
 * (`/operations/requests`, not `/operations/requests?state=pending`).
 */
export function RequestStatusTabs({ active, search }: RequestStatusTabsProps) {
  function buildHref(state: RequestsListStateFilter) {
    const qp = new URLSearchParams();
    if (state !== "pending") qp.set("state", state);
    if (search) qp.set("q", search);
    const qs = qp.toString();
    return qs ? `/operations/requests?${qs}` : "/operations/requests";
  }

  return (
    <nav aria-label="Request status" className="inline-flex flex-wrap gap-1 rounded-md border border-border-subtle bg-surface-elevated p-1">
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
