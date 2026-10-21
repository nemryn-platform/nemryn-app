import { ViewSwitch } from "@/components/ui/ViewSwitch";

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

  // NP-UI-P2: rendered by the shared ViewSwitch (same links, same aria-current, same landmark name).
  return (
    <ViewSwitch
      label="Standing order status"
      activeKey={active}
      items={TABS.map((tab) => ({ key: tab.value, label: tab.label, href: buildHref(tab.value) }))}
    />
  );
}
