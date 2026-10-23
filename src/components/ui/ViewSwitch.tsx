import Link from "next/link";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface ViewSwitchItem {
  key: string;
  label: string;
  href: string;
  /** Optional real count shown beside the label (e.g. pending requests). Never decorative or estimated. */
  count?: number | null;
  /** NP-UI-V2-3: an optional per-option data-testid (kept from a hand-built switch this replaces). */
  testId?: string;
}

export interface ViewSwitchProps {
  /** Accessible name of the navigation landmark, e.g. "Request status". */
  label: string;
  items: ViewSwitchItem[];
  activeKey: string;
  className?: string;
  testId?: string;
}

/**
 * NP-UI-P2 ViewSwitch: the one URL-driven segmented view control (status / day views). Every option is a real,
 * shareable, reload-safe link with `aria-current="page"` on the active view — no client JS, no ARIA tabs semantics
 * (P1a guidance: URL filters stay links; `Tabs` is for in-page panels). Replaces three hand-built copies (Requests
 * status, Dispatch day, Standing Orders status). The active option reads by weight, a raised fill and a marker, never
 * by colour alone.
 */
export function ViewSwitch({ label, items, activeKey, className, testId }: ViewSwitchProps) {
  return (
    <nav aria-label={label} className={cn("inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-border-subtle bg-surface-secondary/60 p-0.5", className)} data-testid={testId}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-testid={item.testId}
            className={cn(
              typography.bodySmall,
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-medium transition-colors duration-base motion-reduce:transition-none",
              // Brand Lock v2 (D-5): the active option = a white segment, teal text and a 2px teal underline (plus the
              // semibold weight) — never colour alone.
              active
                ? "bg-surface-elevated font-semibold text-text-link shadow-[inset_0_-2px_0_var(--color-text-link)] ring-1 ring-border-subtle"
                : "text-text-secondary hover:bg-surface-elevated/70 hover:text-text-primary",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <>
                {/* separator so the link's accessible name / text reads "Pending, 3" -- not a merged "Pending3" */}
                <span className="sr-only">, </span>
                <span className={cn(typography.metadata, "min-w-5 rounded-full px-1.5 text-center font-medium tabular-nums", active ? "bg-accent-soft text-text-link" : "bg-surface-elevated text-text-secondary")}>
                  {item.count}
                </span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
