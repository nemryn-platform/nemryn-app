import Link from "next/link";
import { CalendarBlank, CalendarCheck, ClipboardText, Clock, ListChecks, Repeat, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRecurringArrangementDetail } from "@/lib/operations/recurring-arrangement-detail";
import {
  formatRecurringPattern,
  formatWallClockTime,
  recurringArrangementStatusLabel,
  recurringArrangementStatusCategory,
} from "@/lib/operations/presentation";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { RecordSummary } from "@/components/ui/RecordSummary";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { DetailPageHeader } from "@/components/operations/OperationsPageHeaders";
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
      <>
        <DetailPageHeader title="Standing Order" />
        <EmptyState
          icon={<WarningCircle className="size-8" aria-hidden />}
          title="Standing order unavailable"
          description="This standing order doesn't exist, or you don't have access to it."
          action={
            <Link href="/operations/recurring-care" className={cn(typography.button, "text-text-link")}>
              Back to Standing Orders
            </Link>
          }
        />
      </>
    );
  }

  if (result.status === "error") {
    return (
      <>
        <DetailPageHeader title="Standing Order" />
        <EmptyState
          icon={<WarningCircle className="size-8" aria-hidden />}
          title="Couldn't load this standing order"
          description="Something went wrong. Try refreshing the page in a moment."
        />
      </>
    );
  }

  const { arrangement, assurance } = result;

  return (
    <>
      <DetailPageHeader
        title="Standing Order"
        breadcrumb={[{ label: "Standing Orders", href: "/operations/recurring-care" }, { label: arrangement.passengerDisplayName }]}
        actions={
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
        }
      />
      <div className="flex flex-col gap-zw-lg">
        {/* NP-UI-P2: the "Standing Order" PageHeader is this page's one h1 (fixes the QA2 baseline defect: the page had no h1);
            the passenger name stays the record heading (an h2, in the summary), as on Trip / Request Detail. */}
        <RecordSummary
          testId="arrangement-record-summary"
          title={arrangement.passengerDisplayName}
          status={<StatusBadge label={recurringArrangementStatusLabel(arrangement.status)} category={recurringArrangementStatusCategory(arrangement.status)} />}
          icon={<Repeat className="size-[1.375rem]" />}
          meta={`${arrangement.pickupDescription} → ${arrangement.destinationDescription}`}
          facts={[
            { label: "Pattern", value: formatRecurringPattern(arrangement.daysOfWeek), icon: <CalendarBlank /> },
            { label: "Pickup time", value: formatWallClockTime(arrangement.pickupTime), icon: <Clock /> },
            {
              label: "Next 14 days",
              value:
                assurance.missingCount > 0
                  ? `${assurance.missingCount} not yet scheduled`
                  : "All scheduled",
              icon: <ListChecks />,
            },
          ]}
        >
          <p className={cn(typography.bodySmall, "text-text-muted")} data-testid="arrangement-wheelchair">
            Wheelchair transport equipment:{" "}
            {arrangement.requiresWheelchairAccess === true ? "Needed" : arrangement.requiresWheelchairAccess === false ? "Not needed" : "Not specified"}
            <span> · applied to trips created from now on</span>
          </p>
          {/* P1-PILOT-R3 (PR-04): a quiet relationship back to the originating Request (normal tenant authorization). */}
          {arrangement.originatingRequest && (
            <p className={cn(typography.bodySmall, "text-text-muted")} data-testid="arrangement-originating-request">
              Created from a request ·{" "}
              <Link href={`/operations/requests/${arrangement.originatingRequest.id}`} className="text-text-link hover:underline">
                View originating Request
              </Link>
              {arrangement.originatingRequest.returnTripExpected && arrangement.originatingRequest.state === "accepted" && (
                <>
                  {" · "}Return trip expected ·{" "}
                  <Link
                    href={`/operations/recurring-care/new?requestId=${arrangement.originatingRequest.id}`}
                    className="text-text-link hover:underline"
                    data-testid="arrangement-create-another"
                  >
                    Create another standing order
                  </Link>
                </>
              )}
            </p>
          )}
        </RecordSummary>

        {arrangement.status === "ended" && arrangement.endedReason && (
          <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-secondary px-zw-lg py-zw-md">
            <div>
              <p className={cn(typography.subsectionHeading, "text-text-primary")}>Ended</p>
              <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Reason: {arrangement.endedReason}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-zw-lg xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-zw-lg">
            <Panel elevated>
              <PanelHeader
                title="Upcoming transportation"
                icon={<CalendarCheck className="size-5" />}
                tone={assurance.missingCount > 0 ? "attention" : "positive"}
                description={
                  assurance.missingCount > 0
                    ? `${assurance.missingCount} occurrence${assurance.missingCount === 1 ? "" : "s"} not yet scheduled in the next 14 days.`
                    : "Upcoming transportation is scheduled."
                }
                className="mb-zw-lg"
              />
              <OccurrenceList arrangementId={arrangement.id} occurrences={assurance.occurrences} />
            </Panel>
          </div>

          <div className="flex flex-col gap-zw-lg">
            <Panel elevated>
              <PanelHeader title="Arrangement details" icon={<ClipboardText className="size-5" />} />
              <DefinitionList
                className="mt-zw-lg"
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
    </>
  );
}
