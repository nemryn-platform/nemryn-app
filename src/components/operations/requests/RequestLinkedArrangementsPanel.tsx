import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  formatRecurringPattern,
  formatWallClockTime,
  formatServiceDateShortLabel,
  recurringArrangementStatusLabel,
  recurringArrangementStatusCategory,
} from "@/lib/operations/presentation";
import type { RequestDetailLinkedArrangement } from "@/lib/operations/request-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * P1-PILOT-R3 (PR-04): the recurring arrangements created from this Request -- a small factual list (schedule summary,
 * status, link), never the full Recurring Care screen. Rendered only when at least one exists. "Ended" is simply
 * history: the Request stays fulfilled (D-R3-1).
 */
export function RequestLinkedArrangementsPanel({ arrangements }: { arrangements: RequestDetailLinkedArrangement[] }) {
  if (arrangements.length === 0) return null;
  return (
    <Panel data-testid="request-linked-arrangements">
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
      <ul className="mt-zw-md flex flex-col gap-zw-sm">
        {arrangements.map((a) => (
          <li key={a.id} className="rounded-sm border border-border-subtle px-3 py-2.5" data-testid="request-linked-arrangement">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                {formatRecurringPattern(a.daysOfWeek)} · {formatWallClockTime(a.pickupTime)}
              </p>
              <StatusBadge label={recurringArrangementStatusLabel(a.status)} category={recurringArrangementStatusCategory(a.status)} />
            </div>
            <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
              From {formatServiceDateShortLabel(a.startDate)}
              {a.endDate ? ` to ${formatServiceDateShortLabel(a.endDate)}` : ""}
            </p>
            <p className={cn(typography.bodySmall, "mt-1 flex items-center gap-1.5 text-text-secondary")}>
              <span className="truncate">{a.pickupDescription}</span>
              <span aria-hidden className="text-text-disabled">
                →
              </span>
              <span className="truncate">{a.destinationDescription}</span>
            </p>
            <Link href={`/operations/recurring-care/${a.id}`} className={cn(typography.bodySmall, "mt-1 inline-block text-text-link hover:underline")}>
              View arrangement →
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
