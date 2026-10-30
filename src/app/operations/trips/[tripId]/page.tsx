import Link from "next/link";
import { WarningCircle, CheckCircle, XCircle, Path } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTripDetail, getVisibleAssignerNames } from "@/lib/operations/trip-detail";
import { deriveAssignmentAttribution } from "@/lib/operations/assignment-attribution-core";
import { getUser } from "@/lib/auth/session";
import { getTripReadiness, type TripReadinessResult } from "@/lib/operations/trip-readiness";
import { formatOperationsTime, formatOperationsLongDate } from "@/lib/operations/presentation";
import { TripStatus } from "@/components/ui/TripStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { DetailPageHeader } from "@/components/operations/OperationsPageHeaders";
import { TripDetailActionBar } from "@/components/operations/trip-detail/TripDetailActionBar";
import { canEditTrip, tripEditFieldLabels } from "@/lib/operations/trip-edit-core";
import { canRecordCompletion } from "@/lib/operations/trip-completion-core";
import { getActiveFacilityOptions } from "@/lib/operations/new-trip";
import { tripSummaryFacts } from "@/components/operations/trip-detail/TripInfoStrip";
import { RecordSummary } from "@/components/ui/RecordSummary";
import { TripRoutePanel } from "@/components/operations/trip-detail/TripRoutePanel";
import { PassengerInfoPanel } from "@/components/operations/trip-detail/PassengerInfoPanel";
import { CurrentStatusPanel } from "@/components/operations/trip-detail/CurrentStatusPanel";
import { TripAssignmentButton } from "@/components/operations/trip-detail/TripAssignmentButton";
import {
  getAssignmentOptions,
  getOperatorLinkedDriverId,
  getRecurringAssignmentHintForTrip,
  type AssignmentOptions,
} from "@/lib/operations/assignment-context";
import type { RecurringAssignmentHint } from "@/lib/operations/assignment-defaults-core";
import { ASSIGNABLE_TRIP_STATES } from "@/lib/operations/readiness-actions-core";
import { dispatchErrorMessage, type DispatchErrorCode } from "@/lib/operations/dispatch-errors";
import { TripReadinessPanel } from "@/components/operations/trip-detail/TripReadinessPanel";
import { TripDurationPanel } from "@/components/operations/trip-detail/TripDurationPanel";
import { TripWheelchairPanel } from "@/components/operations/trip-detail/TripWheelchairPanel";
import { getAssignmentOverlap, type AssignmentOverlapView } from "@/lib/operations/trip-overlap";
import { deriveTripExtent, formatTripExtent } from "@/lib/operations/trip-overlap-core";
import { overlapUnavailableView } from "@/components/operations/overlap/OverlapNotes";
import { TripExceptionsPanel } from "@/components/operations/trip-detail/TripExceptionsPanel";
import { TripNotesPanel } from "@/components/operations/trip-detail/TripNotesPanel";
import { TripBillingPanel } from "@/components/billing/TripBillingPanel";
import { getBillingWriteStatus, getTripBillingStatus, type TripBillingStatus } from "@/lib/billing/billing";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Operations Trip Detail (P1-E3-S6) —
 * docs/design/stitch/references/02-trip-detail.png, treated as the
 * canonical visual specification. See docs/product/
 * operations-trip-detail-data-map.md for the full field-level rationale
 * behind every value and every omission (Trip Type, Reference code,
 * Companion — all fabricated concepts with no backend field; a separate
 * Activity Timeline panel — the reference's own actual composition does
 * not show one).
 */
const DISPATCH_ERROR_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "ILLEGAL_STATE",
  "ASSIGNMENT_CONFLICT",
  "INVALID_DRIVER_OR_VEHICLE",
  "UNKNOWN",
]);

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tripId } = await params;
  // P1-OPS-PROG2: New Trip "Assign now" outcome notice. Display-only copy
  // chosen from a fixed allowlist -- the page's own data (assignment panel,
  // readiness) remains the authority on what actually happened.
  const query = await searchParams;
  const createdNotice = query.created === "assigned" || query.created === "assignment_failed" ? query.created : null;
  const createdErrorCode: DispatchErrorCode =
    typeof query.reason === "string" && DISPATCH_ERROR_CODES.has(query.reason) ? (query.reason as DispatchErrorCode) : "UNKNOWN";
  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  const organization = await requireOperationsAccess(pathname);
  const timezone = organization.organizationTimezone;

  const result = await getTripDetail(tripId, organization.organizationId);

  if (result.status === "unavailable") {
    return (
      <>
        <DetailPageHeader title="Trip Detail" />
        <EmptyState
          icon={<WarningCircle className="size-8" aria-hidden />}
          title="Trip unavailable"
          description="This trip doesn't exist, or you don't have access to it."
          action={
            <Link href="/operations/trips" className={cn(typography.button, "text-text-link")}>
              Back to Trips
            </Link>
          }
        />
      </>
    );
  }

  if (result.status === "error") {
    return (
      <>
        <DetailPageHeader title="Trip Detail" />
        <EmptyState
          icon={<WarningCircle className="size-8" aria-hidden />}
          title="Couldn't load this trip"
          description="Something went wrong. Try refreshing the page in a moment."
        />
      </>
    );
  }

  const { trip, notes, openExceptions, events, assignments } = result;

  // P1-OPS-PROG3B assignment attribution -- stored facts only. Names come
  // back only where the viewer's existing user_profiles RLS allows
  // (self; Organization Admin for members); everyone else reads as
  // "a team member". Best-effort: a failed name read degrades to that.
  const viewer = await getUser();
  const visibleNames = await getVisibleAssignerNames(
    assignments.map((a) => a.assignedBy).filter((id): id is string => id !== null),
  ).catch(() => new Map<string, string>());
  const attribution = deriveAssignmentAttribution(assignments, viewer?.id ?? null, visibleNames);
  // NP-BILL-P1: billing status for completed trips, Organization Admins only (billing is admin-only, D2)
  const showBilling = organization.role === "organization_admin" && trip.state === "completed";
  const billingStatus: TripBillingStatus | null = showBilling ? await getTripBillingStatus(organization.organizationId, trip.id) : null;
  const billingCanWrite = showBilling ? (await getBillingWriteStatus(organization.organizationId)).enabled : false;

  // P1-OPS-PROG4: the planned window (a plan, never a lifecycle fact) and, for a non-terminal trip with a current
  // assignment, the same canonical overlap facts the dialog uses. A failed read shows "Can't fully check" (R1).
  const plannedExtentLabel = formatTripExtent(deriveTripExtent(trip.scheduledPickupAt, trip.expectedDurationMinutes), timezone);
  let currentOverlap: AssignmentOverlapView | null = null;
  if (!trip.isTerminal && trip.activeAssignmentId && (trip.driverId || trip.vehicleId)) {
    currentOverlap = await getAssignmentOverlap(
      organization.organizationId,
      timezone,
      { kind: "trip", tripId: trip.id },
      trip.driverId,
      trip.vehicleId,
    ).catch(() => overlapUnavailableView(Boolean(trip.driverId), Boolean(trip.vehicleId)));
  }
  const lastUpdateAt = events[0]?.occurredAt ?? trip.updatedAt;

  // P1-PILOT-R2B (PR-01): Edit Trip needs the active facility options (same query as New Trip); a failed read hides the
  // edit flow rather than offering an incomplete form. The last correction is attributed with the existing convention
  // (you / a team member) -- field labels only, never values.
  const editFacilities = canEditTrip(trip.state) ? await getActiveFacilityOptions(organization.organizationId).catch(() => null) : null;
  const correction = trip.lastCorrection;

  // P1-E1-S4D §16: Trip Readiness is only ever fetched/rendered for a
  // Trip currently in state='scheduled' — deriveTripReadiness itself
  // already returns NOT_APPLICABLE for every other state, but this Trip
  // Detail page never even calls it in that case, sparing 2 needless
  // round trips for the vast majority of Trip Detail views (in-progress
  // and terminal Trips together outnumber scheduled ones). A fetch
  // failure is isolated here (§24) — it never takes down the rest of the
  // page, matching this codebase's own Request Activity precedent.
  let readiness: TripReadinessResult | null = null;
  let readinessUnavailable = false;
  if (trip.state === "scheduled") {
    try {
      readiness = await getTripReadiness(trip.id, organization.organizationId, timezone);
    } catch {
      readinessUnavailable = true;
    }
  }

  // P1-OPS-PROG1: the in-place Assign/Reassign dialog is offered only in the
  // states assign_trip / reassign_trip accept (the RPCs still decide). An
  // option-load failure falls back to the previous Dispatch link rather
  // than taking down the page.
  let assignmentOptions: AssignmentOptions | null = null;
  let operatorDriverId: string | null = null;
  let recurringHint: RecurringAssignmentHint | null = null;
  if (ASSIGNABLE_TRIP_STATES.has(trip.state)) {
    try {
      [assignmentOptions, operatorDriverId, recurringHint] = await Promise.all([
        getAssignmentOptions(organization.organizationId),
        getOperatorLinkedDriverId(organization.organizationId),
        // P1-OPS-PROG2: only an unassigned Trip can use a recurring-history prefill.
        trip.activeAssignmentId ? Promise.resolve(null) : getRecurringAssignmentHintForTrip(organization.organizationId, trip.id),
      ]);
    } catch {
      assignmentOptions = null;
    }
  }

  return (
    <>
      <DetailPageHeader
        title="Trip Detail"
        breadcrumb={[{ label: "Trips", href: "/operations/trips" }, { label: trip.passengerName }]}
        actions={
          <TripDetailActionBar
            tripId={trip.id}
            passengerName={trip.passengerName}
            driverPhone={trip.driverPhone}
            eligibleForCancel={trip.eligibleForCancel}
            eligibleForNoShow={trip.eligibleForNoShow}
            edit={
              editFacilities && canEditTrip(trip.state)
                ? {
                    trip: {
                      id: trip.id,
                      state: trip.state,
                      updatedAt: trip.updatedAt,
                      scheduledPickupAt: trip.scheduledPickupAt,
                      appointmentAt: trip.appointmentAt,
                      pickupDescription: trip.pickupDescription,
                      pickupFacilityId: trip.pickupFacilityId,
                      destinationDescription: trip.destinationDescription,
                      destinationFacilityId: trip.destinationFacilityId,
                      instructions: trip.instructions,
                      assistanceNotes: trip.assistanceNotes,
                      recurringArrangementId: trip.recurringArrangementId,
                      driverId: trip.driverId,
                      vehicleId: trip.vehicleId,
                      expectedDurationMinutes: trip.expectedDurationMinutes,
                      requiresWheelchairAccess: trip.requiresWheelchairAccess,
                    },
                    facilities: editFacilities,
                    organizationTimezone: timezone,
                  }
                : null
            }
            recordCompletion={canRecordCompletion(trip.state) ? { tripState: trip.state, organizationTimezone: timezone } : null}
          />
        }
      />
      <div className="flex flex-col gap-zw-lg">

        {createdNotice === "assigned" && (
          <p role="status" data-testid="created-notice" className={cn(typography.bodySmall, "rounded-md border border-success-border bg-success-bg px-zw-lg py-zw-md text-text-primary")}>
            Trip created and assigned.
          </p>
        )}
        {createdNotice === "assignment_failed" && (
          <div role="alert" data-testid="created-notice" className="rounded-md border border-warning-border bg-warning-bg px-zw-lg py-zw-md">
            <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>Trip created, but the assignment could not be completed.</p>
            <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
              {dispatchErrorMessage(createdErrorCode)} The trip is saved{trip.activeAssignmentId ? "." : " without a driver"} — you can assign it from Current Status on this page.
            </p>
          </div>
        )}

        {/* The PageHeader's "Trip Detail" is this page's one <h1>; the Passenger name is the record heading, an <h2> in the summary. */}
        <RecordSummary
          testId="trip-record-summary"
          title={trip.passengerName}
          status={<TripStatus status={trip.statusLabel} />}
          icon={<Path className="size-[1.375rem]" />}
          meta={trip.scheduledPickupAt ? formatOperationsLongDate(new Date(trip.scheduledPickupAt), timezone) : undefined}
          facts={tripSummaryFacts({
            scheduledPickupAt: trip.scheduledPickupAt,
            appointmentAt: trip.appointmentAt,
            driverName: trip.summaryDriverName,
            vehicleLabel: trip.summaryVehicleLabel,
            timezone,
          })}
        >
          {correction && (
            <p className={cn(typography.metadata, "text-text-muted")} data-testid="trip-last-correction">
              Details corrected by {correction.actorUserId && correction.actorUserId === viewer?.id ? "you" : "a team member"} ·{" "}
              {formatOperationsLongDate(new Date(correction.occurredAt), timezone)}, {formatOperationsTime(correction.occurredAt, timezone)}
              {correction.fields.length > 0 && <> · {tripEditFieldLabels(correction.fields).join(", ")}</>}
            </p>
          )}
        </RecordSummary>

        {trip.isTerminal && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-md border px-zw-lg py-zw-md",
              trip.state === "completed" ? "border-success-border bg-success-bg" : "border-critical-border bg-critical-bg",
            )}
          >
            {trip.state === "completed" ? (
              <CheckCircle className="mt-0.5 size-5 shrink-0 text-success-strong" weight="fill" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-5 shrink-0 text-critical-strong" weight="fill" aria-hidden />
            )}
            <div>
              <p className={cn(typography.subsectionHeading, "text-text-primary")}>
                {trip.state === "completed" && `Completed ${formatOperationsTime(trip.completedAt, timezone)}`}
                {trip.state === "cancelled" && `Cancelled ${formatOperationsTime(trip.cancelledAt, timezone)}`}
                {trip.state === "no_show" && `No-show recorded ${formatOperationsTime(trip.noShowAt, timezone)}`}
              </p>
              {trip.state === "completed" && trip.completionRecord && (
                <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")} data-testid="trip-completion-record">
                  Completion recorded by operations · by {trip.completionRecord.actorUserId && trip.completionRecord.actorUserId === viewer?.id ? "you" : "a team member"} ·{" "}
                  {formatOperationsLongDate(new Date(trip.completionRecord.recordedAt), timezone)}, {formatOperationsTime(trip.completionRecord.recordedAt, timezone)}
                  {trip.completionRecord.completedAt && <> · Completion time recorded: {formatOperationsTime(trip.completionRecord.completedAt, timezone)}</>}
                </p>
              )}
              {trip.state === "cancelled" && trip.cancellationReason && (
                <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Reason: {trip.cancellationReason}</p>
              )}
            </div>
          </div>
        )}

        {/* NP-UI-V2-2: the record (route, passenger, exceptions, notes) in the main column; the operational controls
            (status / assignment, readiness, duration, equipment) in the side column. DOM order = the stacked order below
            xl (route, passenger, controls, exceptions, notes), so reading / focus order never jumps; at xl the side column
            is placed on the right across both rows. */}
        <div className="grid grid-cols-1 items-start gap-zw-lg xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[auto_1fr]">
          <div className="flex flex-col gap-zw-lg xl:col-start-1 xl:row-start-1">
            <TripRoutePanel
              scheduledPickupAt={trip.scheduledPickupAt}
              appointmentAt={trip.appointmentAt}
              pickupDescription={trip.pickupDescription}
              destinationDescription={trip.destinationDescription}
              pickupFacilityName={trip.pickupFacilityName}
              destinationFacilityName={trip.destinationFacilityName}
              instructions={trip.instructions}
              timezone={timezone}
            />
            <PassengerInfoPanel
              passengerName={trip.passengerName}
              passengerPhone={trip.passengerPhone}
              requesterName={trip.requesterName}
              requesterRelationship={trip.requesterRelationship}
              assistanceNotes={trip.assistanceNotes}
            />
          </div>

          <div className="flex flex-col gap-zw-lg xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <CurrentStatusPanel
              statusLabel={trip.statusLabel}
              driverName={trip.driverName}
              lastUpdateAt={lastUpdateAt}
              driverNextActionLabel={trip.isTerminal ? null : trip.driverNextActionLabel}
              timezone={timezone}
              eligibleForAssignmentAction={!trip.isTerminal}
              hasActiveAssignment={trip.activeAssignmentId !== null}
              attribution={attribution}
              overlap={currentOverlap}
              assignmentControl={
                assignmentOptions ? (
                  <TripAssignmentButton
                    trip={{
                      id: trip.id,
                      passengerName: trip.passengerName,
                      pickupDescription: trip.pickupDescription,
                      destinationDescription: trip.destinationDescription,
                      activeAssignmentId: trip.activeAssignmentId,
                      driverId: trip.driverId,
                      driverName: trip.driverName,
                      vehicleId: trip.vehicleId,
                      vehicleLabel: trip.vehicleLabel,
                    }}
                    driverOptions={assignmentOptions.driverOptions}
                    vehicleOptions={assignmentOptions.vehicleOptions}
                    operatorDriverId={operatorDriverId}
                    canManageDriverSetup={organization.role === "organization_admin"}
                    recurringHint={recurringHint}
                  />
                ) : undefined
              }
            />
            {showBilling && <TripBillingPanel tripId={trip.id} status={billingStatus} canWrite={billingCanWrite} />}
            <TripReadinessPanel readiness={readiness} unavailable={readinessUnavailable} />
            <TripDurationPanel
              tripId={trip.id}
              expectedDurationMinutes={trip.expectedDurationMinutes}
              expectedDurationSource={trip.expectedDurationSource}
              plannedExtentLabel={plannedExtentLabel}
              canEdit={!trip.isTerminal}
            />
            <TripWheelchairPanel tripId={trip.id} requiresWheelchairAccess={trip.requiresWheelchairAccess} canEdit={!trip.isTerminal} />
          </div>

          <div className="flex flex-col gap-zw-lg xl:col-start-1 xl:row-start-2">
            <TripExceptionsPanel tripId={trip.id} openExceptions={openExceptions} timezone={timezone} />
            <TripNotesPanel tripId={trip.id} notes={notes} timezone={timezone} />
          </div>
        </div>
      </div>
    </>
  );
}
