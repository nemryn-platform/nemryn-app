import { Lightning, Path, UserCircleDashed, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import Link from "next/link";
import { getDispatchBoardData, type DispatchDay } from "@/lib/operations/dispatch-board";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { getOperatorLinkedDriverId, getRecurringAssignmentHints } from "@/lib/operations/assignment-context";
import { StatTile, StatTileGroup } from "@/components/ui/StatTile";
import { ViewSwitch } from "@/components/ui/ViewSwitch";
import { EmptyState } from "@/components/ui/EmptyState";
import { DispatchBoardClient } from "@/components/operations/dispatch/DispatchBoardClient";
import { DispatchLiveRefresh } from "@/components/operations/dispatch/DispatchLiveRefresh";
import { DispatchPageHeader } from "@/components/operations/OperationsPageHeaders";

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
      <>
        <DispatchPageHeader day={day} timezone={organization.organizationTimezone} />
        <EmptyState
          icon={<WarningCircle className="size-8" aria-hidden />}
          title="Couldn't load the Dispatch Board"
          description={`Something went wrong loading ${day === "tomorrow" ? "tomorrow" : "today"}'s trips and drivers. Try refreshing the page in a moment.`}
        />
      </>
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
    <>
      <DispatchPageHeader day={day} timezone={organization.organizationTimezone} />
      <div className="flex flex-col gap-zw-lg">
        <DispatchLiveRefresh />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewSwitch
            label="Dispatch day"
            testId="dispatch-day-switch"
            activeKey={day}
            items={[
              { key: "today", label: "Today", href: "/operations/dispatch" },
              { key: "tomorrow", label: "Tomorrow", href: "/operations/dispatch?day=tomorrow" },
            ]}
          />
          {day === "tomorrow" && (
            <Link href="/operations/tomorrow" className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")} data-testid="dispatch-tomorrow-readiness-link">
              Tomorrow Readiness
            </Link>
          )}
        </div>
        {/* NP-UI-V2-2: the same real counts as before, in the Brand Lock v2 fact tiles (D-6) used by the Overview. The
            attention tone only when something is actually unassigned / needs attention (a zero is not a warning). */}
        <StatTileGroup label={day === "tomorrow" ? "Tomorrow at a glance" : "Today at a glance"} columns={data.summary.attentionCount > 0 ? 4 : 3} testId="dispatch-summary">
          {[
            <StatTile key="open" label={day === "tomorrow" ? "open trips tomorrow" : "open trips today"} value={data.summary.todayCount} icon={<Path className="size-5" />} tone="accent" />,
            <StatTile
              key="unassigned"
              label="unassigned"
              value={data.summary.unassignedCount}
              icon={<UserCircleDashed className="size-5" />}
              tone={data.summary.unassignedCount > 0 ? "attention" : "neutral"}
            />,
            <StatTile key="active" label="active" value={data.summary.activeCount} icon={<Lightning className="size-5" />} tone="info" />,
            ...(data.summary.attentionCount > 0
              ? [<StatTile key="attention" label="need attention" value={data.summary.attentionCount} icon={<WarningCircle className="size-5" />} tone="attention" />]
              : []),
          ]}
        </StatTileGroup>

        <DispatchBoardClient
          data={data}
          timezone={organization.organizationTimezone}
          operatorDriverId={operatorDriverId}
          recurringHints={recurringHints}
          canManageDriverSetup={organization.role === "organization_admin"}
        />
      </div>
    </>
  );
}
