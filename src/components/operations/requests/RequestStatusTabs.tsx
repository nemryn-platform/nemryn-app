import type { RequestsListStateFilter } from "@/lib/operations/requests-list";
import { ViewSwitch } from "@/components/ui/ViewSwitch";

export interface RequestStatusTabsProps {
  active: RequestsListStateFilter;
  /** Preserved across a tab switch — matches Trips/Passengers' own established filter-form conventions (a status change should not silently discard an in-progress search). */
  search: string;
  /** NP-UI-P2: the organization's true total of pending requests (independent of the open view), shown on the Pending view. */
  pendingCount?: number | null;
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
export function RequestStatusTabs({ active, search, pendingCount }: RequestStatusTabsProps) {
  function buildHref(state: RequestsListStateFilter) {
    const qp = new URLSearchParams();
    if (state !== "pending") qp.set("state", state);
    if (search) qp.set("q", search);
    const qs = qp.toString();
    return qs ? `/operations/requests?${qs}` : "/operations/requests";
  }

  // NP-UI-P2: rendered by the shared ViewSwitch (same links, same aria-current, same landmark name). The Pending view
  // carries the organization's real pending total (previously a separate one-item summary strip).
  return (
    <ViewSwitch
      label="Request status"
      activeKey={active}
      items={TABS.map((tab) => ({ key: tab.value, label: tab.label, href: buildHref(tab.value), count: tab.value === "pending" ? pendingCount : undefined }))}
    />
  );
}
