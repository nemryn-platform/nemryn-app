import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTomorrowReadiness, type TomorrowReadinessData } from "@/lib/operations/tomorrow-readiness";
import { formatOperationsTime, formatOperationsLongDate, tripReadinessReasonLabel } from "@/lib/operations/presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { SummaryStrip, type SummaryItem } from "@/components/ui/SummaryStrip";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/LinkButton";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Tomorrow Readiness (P1-E1-S4D) — the first operator-facing surface over
 * the S4B/S4C/S4C1 readiness engine. Answers exactly one question: "what
 * scheduled work for tomorrow still needs preparation?" Never a dispatch
 * board, never a Trip lifecycle page, never a score.
 *
 * Reached directly at this route only — deliberately NOT added to the
 * permanent Operations sidebar (S4D §3/§29) and NOT integrated into
 * Operations Brief (S4D §28) in this phase; both are S4E's own contextual-
 * discovery work. Authorization comes entirely from the existing
 * `/operations/*` boundary — `requireOperationsAccess` here (this route's
 * own page-level call, matching every other Operations page's own
 * convention) plus the parent layout's own identical call already gate
 * this route exactly like every other Operations screen; a Driver
 * Membership is redirected to /driver before this component ever renders,
 * no second access model introduced.
 *
 * All data comes from the ALREADY-PROVEN `getTomorrowReadiness` wrapper
 * (S4C/S4C1) — this page renders that data, it never re-derives or
 * re-interprets a readiness rule itself.
 */
export default async function TomorrowReadinessPage() {
  const pathname = await getCurrentPathname("/operations/tomorrow");
  const organization = await requireOperationsAccess(pathname);

  let data: TomorrowReadinessData;
  try {
    data = await getTomorrowReadiness(organization.organizationId, organization.organizationTimezone);
  } catch {
    // S4D §24: data unavailable is never rendered as "0 trips / 0
    // problems / tomorrow is ready" — a contained page-level error state
    // instead, matching Trip Detail's own established "Couldn't load"
    // pattern (src/app/operations/trips/[tripId]/page.tsx).
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader title="Tomorrow" />
        <Panel>
          <EmptyState
            icon={<WarningCircle className="size-8" aria-hidden />}
            title="Couldn't load tomorrow's trips"
            description="Something went wrong. Try refreshing the page in a moment."
          />
        </Panel>
      </div>
    );
  }

  const { totalScheduledTrips, readyCount, needsPreparationCount, items, timezone } = data;
  const dateLabel = formatOperationsLongDate(new Date(data.tomorrowStartUtc), timezone);

  // S4C1 §7/S4D §9 invariant: a Trip with a null scheduled_pickup_at can
  // never truthfully belong to "tomorrow" — S4C's own date-range query
  // excludes it before aggregation ever runs. If NO_SCHEDULE ever reached
  // this page anyway, that is an upstream contract violation, never a
  // case to quietly render (S4D §9's own explicit instruction).
  for (const item of items) {
    if (item.readiness.reasons.includes("NO_SCHEDULE")) {
      throw new Error(
        `Invariant violation: Tomorrow Readiness item ${item.tripId} carries NO_SCHEDULE, which S4C's own query is supposed to have already excluded.`,
      );
    }
  }

  const needsPreparation = items.filter((item) => item.readiness.state === "NEEDS_PREPARATION");
  const ready = items.filter((item) => item.readiness.state === "READY");

  const summaryItems: SummaryItem[] = [
    { label: totalScheduledTrips === 1 ? "scheduled trip" : "scheduled trips", value: totalScheduledTrips },
    { label: "ready", value: readyCount, dot: true },
  ];
  if (needsPreparationCount > 0) {
    summaryItems.push({ label: "need preparation", value: needsPreparationCount, tone: "warning", dot: true });
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="Tomorrow" description={dateLabel} />

      {totalScheduledTrips === 0 ? (
        <Panel>
          <EmptyState
            title="No trips scheduled for tomorrow."
            description="Trips scheduled for tomorrow will appear here."
          />
        </Panel>
      ) : (
        <>
          <SummaryStrip inline items={summaryItems} />

          {needsPreparationCount === 0 ? (
            <Panel>
              <EmptyState
                title="Tomorrow is ready"
                description={`All ${totalScheduledTrips} scheduled ${totalScheduledTrips === 1 ? "trip is" : "trips are"} prepared based on the information currently available.`}
              />
            </Panel>
          ) : (
            <Panel className="p-0">
              <div className="flex items-center justify-between gap-4 p-zw-lg pb-0">
                <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Needs preparation</h2>
                <StatusBadge
                  label={`${needsPreparationCount} ${needsPreparationCount === 1 ? "Trip" : "Trips"}`}
                  category="warning"
                />
              </div>
              <div className="p-zw-lg">
                <ul className="divide-y divide-border-subtle">
                  {needsPreparation.map((item) => (
                    <li
                      key={item.tripId}
                      className="flex flex-col gap-2 py-zw-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                          {formatOperationsTime(item.scheduledPickupAt, timezone)} · {item.passengerDisplayName}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.readiness.reasons.map((reason) => (
                            <StatusBadge key={reason} label={tripReadinessReasonLabel(reason)} category="warning" />
                          ))}
                        </div>
                      </div>
                      <LinkButton href={`/operations/trips/${item.tripId}`} variant="outline" size="sm" className="shrink-0">
                        View trip
                      </LinkButton>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          {ready.length > 0 && (
            <Panel className="p-0">
              <div className="p-zw-lg pb-0">
                <h2 className={cn(typography.subsectionHeading, "text-text-secondary")}>Ready</h2>
              </div>
              <div className="p-zw-lg">
                <ul className="divide-y divide-border-subtle">
                  {ready.map((item) => (
                    <li key={item.tripId} className="flex items-center justify-between gap-3 py-zw-xs first:pt-0 last:pb-0">
                      <Link
                        href={`/operations/trips/${item.tripId}`}
                        className={cn(typography.bodySmall, "min-w-0 flex-1 truncate text-text-secondary hover:text-text-link hover:underline")}
                      >
                        {formatOperationsTime(item.scheduledPickupAt, timezone)} · {item.passengerDisplayName}
                      </Link>
                      <span className={cn(typography.metadata, "shrink-0 text-success-text")}>Ready</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
