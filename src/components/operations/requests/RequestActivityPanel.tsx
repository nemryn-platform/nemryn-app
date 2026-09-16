import { Panel } from "@/components/ui/Panel";
import { requestEventLabel, formatOperationsTime, formatOperationsLongDate } from "@/lib/operations/presentation";
import type { RequestActivityEvent } from "@/lib/operations/request-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestActivityPanelProps {
  /** null only when the underlying query genuinely failed (§18) — never used to represent "zero events", which is a real, distinct, successfully-fetched empty array. */
  events: RequestActivityEvent[] | null;
  timezone: string;
}

/**
 * Request Activity (P1-E1-S2F-B2 §16) — a small, read-only,
 * `request_events`-only list. Deliberately NOT a unified cross-table
 * timeline: Trip conversion is already visible through Request state
 * (Accepted) and the Linked Trips panel; `create_trip`'s own
 * `request_converted_to_trip` event lives on `trip_events`, not here,
 * and is never joined in (§17).
 *
 * Mirrors `TripNotesPanel`'s established compact-list idiom exactly
 * (bordered rows, a muted timestamp on the right) — the closest
 * existing precedent for "a small list of timestamped historical
 * records" in this codebase.
 *
 * Three distinct states, never conflated (§18/§19): a genuine query
 * failure (`events === null`) shows "Activity unavailable" — this
 * panel degrading never turns into "Request unavailable" for the whole
 * page, since Activity is supplementary, not part of the Request's own
 * authoritative state. A genuinely empty, successfully-fetched history
 * (`events.length === 0` — a legacy/test fixture predating this
 * feature) shows "No request activity recorded" — never a fabricated
 * `request_logged` row for a Request this code didn't actually see
 * created. Real events show their restrained label, a full date+time
 * (composed from the two existing `formatOperations*` helpers — no new
 * formatter; request activity can genuinely span multiple days, unlike
 * Trip Notes' own typically same-day timestamps), and — for
 * `request_declined` only — the reason, when one was actually given.
 */
export function RequestActivityPanel({ events, timezone }: RequestActivityPanelProps) {
  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Request Activity</h3>
      <div className="mt-zw-md">
        {events === null ? (
          <p className={cn(typography.bodySmall, "text-text-muted")}>Activity unavailable</p>
        ) : events.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-muted")}>No request activity recorded</p>
        ) : (
          <ul className="flex flex-col gap-zw-sm">
            {events.map((event) => (
              <li key={event.id} className="border-b border-border-subtle pb-zw-sm last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{requestEventLabel(event.eventType)}</p>
                  <span className={cn(typography.metadata, "text-text-muted")}>
                    {formatOperationsLongDate(new Date(event.occurredAt), timezone)} · {formatOperationsTime(event.occurredAt, timezone)}
                  </span>
                </div>
                {event.reason && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{event.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
