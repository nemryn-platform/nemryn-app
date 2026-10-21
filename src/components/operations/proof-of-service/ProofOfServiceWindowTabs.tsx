import { ViewSwitch } from "@/components/ui/ViewSwitch";
import { proofOfServiceWindowLabel } from "@/lib/operations/presentation";
import type { ProofOfServiceReviewWindow } from "@/lib/operations/trip-proof-of-service";

export interface ProofOfServiceWindowTabsProps {
  active: ProofOfServiceReviewWindow;
}

/** The `?window=` URL value for each internal window — kebab-case, distinct from the internal UPPER_SNAKE union (P1-E3-S1D §5). */
const WINDOW_QUERY_VALUE: Record<ProofOfServiceReviewWindow, string> = {
  YESTERDAY: "yesterday",
  TODAY: "today",
  LAST_7_DAYS: "last-7-days",
};

const TABS: ProofOfServiceReviewWindow[] = ["YESTERDAY", "TODAY", "LAST_7_DAYS"];

/**
 * The review-window control (P1-E3-S1D §5/§20) — mirrors
 * `RecurringCareStatusTabs`' own exact shape: a plain, shareable-URL
 * `<Link>` segmented control, no client JS required, keyboard-accessible
 * by construction (real links, `aria-current="page"` on the active one).
 * `window=yesterday` (the default) omits the query param entirely,
 * matching that same established convention exactly. Switching windows
 * deliberately does NOT carry the current `page` forward — a different
 * window is a different result set, so landing back on page 1 is the
 * only truthful behavior.
 */
export function ProofOfServiceWindowTabs({ active }: ProofOfServiceWindowTabsProps) {
  function buildHref(window: ProofOfServiceReviewWindow) {
    return window === "YESTERDAY" ? "/operations/proof-of-service" : `/operations/proof-of-service?window=${WINDOW_QUERY_VALUE[window]}`;
  }

  // NP-UI-P2: rendered by the shared ViewSwitch (same links, same aria-current, same landmark name).
  return (
    <ViewSwitch
      label="Proof-of-service review window"
      activeKey={active}
      items={TABS.map((window) => ({ key: window, label: proofOfServiceWindowLabel(window), href: buildHref(window) }))}
    />
  );
}

/** Parses the `?window=` search param into the internal union, falling back safely to `"YESTERDAY"` for any missing/unrecognized value (P1-E3-S1D §5/§34 — URL input is never trusted as authority beyond this one narrow, closed choice). */
export function parseProofOfServiceWindowParam(value: string | string[] | undefined): ProofOfServiceReviewWindow {
  if (value === "today") return "TODAY";
  if (value === "last-7-days") return "LAST_7_DAYS";
  return "YESTERDAY";
}
