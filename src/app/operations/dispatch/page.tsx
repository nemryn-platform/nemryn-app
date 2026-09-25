import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import Link from "next/link";
import { getDispatchBoardData, type DispatchDay } from "@/lib/operations/dispatch-board";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { getOperatorLinkedDriverId, getRecurringAssignmentHints } from "@/lib/operations/assignment-context";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { DispatchBoardClient } from "@/components/operations/dispatch/DispatchBoardClient";
import { DispatchLiveRefresh } from "@/components/operations/dispatch/DispatchLiveRefresh";

/**
 * Dispatch Board (P1-E3-S5) —
 * docs/design/stitch/references/03-dispatch-board.png, treated as the
 * canonical visual specification. See docs/product/dispatch-board-data-map.md
 * for the full field-level rationale behind every value and every
 * omission on this screen (Driver Availability status pills, "Potential
 * timing conflict", "Pending Confirmation"/REVIEW cards, the day
 * navigator, "Dispatch Settings" — none have a real data source or a
 * defined product rule yet).
 */
export default async function DispatchBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/dispatch");
  const organization = await requireOperationsAccess(pathname);
  // P1-OPS-PROG4: ?day=today (default) | tomorrow -- the SAME board engine for either org-local day.
  const query = await searchParams;
  const day: DispatchDay = query.day === "tomorrow" ? "tomorrow" : "today";

  let data: Awaited<ReturnType<typeof getDispatchBoardData>>;
  let operatorDriverId: string | null;
  try {
    [data, operatorDriverId] = await Promise.all([
      getDispatchBoardData(organization.organizationId, organization.organizationTimezone, day),
      getOperatorLinkedDriverId(organization.organizationId),
    ]);
  } catch {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load the Dispatch Board"
        description={`Something went wrong loading ${day === "tomorrow" ? "tomorrow" : "today"}'s trips and drivers. Try refreshing the page in a moment.`}
      />
    );
  }

  // P1-OPS-PROG2: recurring-history prefill hints for the Needs Assignment
  // queue -- one bounded query for all of them (never per trip); a failed
  // read just means no recurring prefill.
  const recurringHints = await getRecurringAssignmentHints(
    organization.organizationId,
    data.unassignedTrips.map((trip) => ({
      tripId: trip.id,
      recurringArrangementId: trip.recurringArrangementId,
      scheduledPickupAt: trip.scheduledPickupAt,
    })),
  ).catch(() => ({}));

  return (
    <div className="flex flex-col gap-zw-lg">
      <DispatchLiveRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Dispatch day" className="inline-flex rounded-md border border-border-subtle bg-surface-elevated p-0.5" data-testid="dispatch-day-switch">
          {(["today", "tomorrow"] as const).map((option) => (
            <Link
              key={option}
              href={option === "today" ? "/operations/dispatch" : "/operations/dispatch?day=tomorrow"}
              aria-current={day === option ? "page" : undefined}
              className={cn(
                typography.bodySmall,
                "rounded-sm px-3 py-1.5 font-medium",
                day === option ? "bg-surface-secondary text-text-primary" : "text-text-secondary hover:text-text-primary",
              )}
            >
              {option === "today" ? "Today" : "Tomorrow"}
            </Link>
          ))}
        </nav>
        {day === "tomorrow" && (
          <Link href="/operations/tomorrow" className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")} data-testid="dispatch-tomorrow-readiness-link">
            Tomorrow readiness
          </Link>
        )}
      </div>
      <SummaryStrip
        inline
        items={[
          { label: day === "tomorrow" ? "open trips tomorrow" : "open trips today", value: data.summary.todayCount },
          { label: "unassigned", value: data.summary.unassignedCount, tone: "warning", dot: true },
          { label: "active", value: data.summary.activeCount, dot: true },
          ...(data.summary.attentionCount > 0
            ? [{ label: "need attention", value: data.summary.attentionCount, tone: "warning" as const, dot: true }]
            : []),
        ]}
      />

      <DispatchBoardClient
        data={data}
        timezone={organization.organizationTimezone}
        operatorDriverId={operatorDriverId}
        recurringHints={recurringHints}
        canManageDriverSetup={organization.role === "organization_admin"}
      />
    </div>
  );
}
