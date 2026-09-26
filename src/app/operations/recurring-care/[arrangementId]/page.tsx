import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRecurringArrangementDetail } from "@/lib/operations/recurring-arrangement-detail";
import {
  formatRecurringPattern,
  formatWallClockTime,
  recurringArrangementStatusLabel,
  recurringArrangementStatusCategory,
} from "@/lib/operations/presentation";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ArrangementLifecycleControls } from "@/components/operations/recurring-care/ArrangementLifecycleControls";
import { OccurrenceList } from "@/components/operations/recurring-care/OccurrenceList";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Recurring Arrangement Detail (P1-E2-S1E §12). Mirrors Trip Detail's/
 * Request Detail's own established discriminated-result handling exactly
 * (unavailable = no existence oracle; error = genuine query failure with
 * distinct copy). The "Upcoming transportation" section renders the
 * EXISTING, unmodified Recurring Care Assurance result only — no
 * occurrence is ever calculated in this component.
 */
export default async function RecurringArrangementDetailPage({ params }: { params: Promise<{ arrangementId: string }> }) {
  const { arrangementId } = await params;
  const pathname = await getCurrentPathname(`/operations/recurring-care/${arrangementId}`);
  const organization = await requireOperationsAccess(pathname);

  const result = await getRecurringArrangementDetail(organization.organizationId, arrangementId);

  if (result.status === "unavailable") {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Arrangement unavailable"
        description="This recurring arrangement doesn't exist, or you don't have access to it."
        action={
          <Link href="/operations/recurring-care" className={cn(typography.button, "text-text-link")}>
            Back to Recurring Care
          </Link>
        }
      />
    );
  }

  if (result.status === "error") {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load this arrangement"
        description="Something went wrong. Try refreshing the page in a moment."
      />
    );
  }

  const { arrangement, assurance } = result;

  return (
    <div className="flex flex-col gap-zw-lg">
      <nav aria-label="Breadcrumb" className={cn(typography.bodySmall, "text-text-muted")}>
        <Link href="/operations/recurring-care" className="hover:text-text-secondary hover:underline">
          Recurring Care
        </Link>
        <span className="mx-2" aria-hidden>
          ›
        </span>
        <span className="text-text-secondary">{arrangement.passengerDisplayName}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-zw-md">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className={cn(typography.pageTitleOperational, "text-text-primary")}>{arrangement.passengerDisplayName}</h2>
            <StatusBadge label={recurringArrangementStatusLabel(arrangement.status)} category={recurringArrangementStatusCategory(arrangement.status)} />
          </div>
          <p className={cn(typography.body, "mt-1 text-text-secondary")}>
            {formatRecurringPattern(arrangement.daysOfWeek)} · {formatWallClockTime(arrangement.pickupTime)}
          </p>
        </div>
        <ArrangementLifecycleControls
          arrangementId={arrangement.id}
          passengerName={arrangement.passengerDisplayName}
          status={arrangement.status}
          pickupDescription={arrangement.pickupDescription}
          destinationDescription={arrangement.destinationDescription}
          pickupTime={arrangement.pickupTime}
          daysOfWeek={arrangement.daysOfWeek}
          startDate={arrangement.startDate}
          endDate={arrangement.endDate}
          requiresWheelchairAccess={arrangement.requiresWheelchairAccess}
        />
      </div>
      <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="arrangement-wheelchair">
        Wheelchair transport equipment:{" "}
        {arrangement.requiresWheelchairAccess === true ? "Needed" : arrangement.requiresWheelchairAccess === false ? "Not needed" : "Not specified"}
        <span className="text-text-muted"> · applied to trips created from now on</span>
      </p>

      {arrangement.status === "ended" && arrangement.endedReason && (
        <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-secondary px-zw-lg py-zw-md">
          <div>
            <p className={cn(typography.subsectionHeading, "text-text-primary")}>Ended</p>
            <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Reason: {arrangement.endedReason}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
          <Panel>
            <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Upcoming transportation</h3>
            <p className={cn(typography.bodySmall, "mt-1 mb-zw-md text-text-secondary")}>
              {assurance.missingCount > 0
                ? `${assurance.missingCount} occurrence${assurance.missingCount === 1 ? "" : "s"} not yet scheduled in the next 14 days.`
                : "Upcoming transportation is scheduled."}
            </p>
            <OccurrenceList arrangementId={arrangement.id} occurrences={assurance.occurrences} />
          </Panel>
        </div>

        <div className="flex flex-col gap-zw-lg">
          <Panel>
            <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Arrangement details</h3>
            <DefinitionList
              className="mt-zw-md"
              columns={1}
              items={[
                { label: "Pickup", value: arrangement.pickupDescription },
                { label: "Destination", value: arrangement.destinationDescription },
                { label: "Pickup time", value: `${formatWallClockTime(arrangement.pickupTime)} (${arrangement.timezone})` },
                { label: "Pattern", value: formatRecurringPattern(arrangement.daysOfWeek) },
                { label: "Start date", value: arrangement.startDate },
                { label: "End date", value: arrangement.endDate ?? "Open-ended" },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
