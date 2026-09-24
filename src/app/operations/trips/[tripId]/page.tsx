import Link from "next/link";
import { WarningCircle, CheckCircle, XCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTripDetail } from "@/lib/operations/trip-detail";
import { getTripReadiness, type TripReadinessResult } from "@/lib/operations/trip-readiness";
import { formatOperationsTime, formatOperationsLongDate } from "@/lib/operations/presentation";
import { TripStatus } from "@/components/ui/TripStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripDetailActionBar } from "@/components/operations/trip-detail/TripDetailActionBar";
import { TripInfoStrip } from "@/components/operations/trip-detail/TripInfoStrip";
import { TripRoutePanel } from "@/components/operations/trip-detail/TripRoutePanel";
import { PassengerInfoPanel } from "@/components/operations/trip-detail/PassengerInfoPanel";
import { CurrentStatusPanel } from "@/components/operations/trip-detail/CurrentStatusPanel";
import { TripAssignmentButton } from "@/components/operations/trip-detail/TripAssignmentButton";
import { getAssignmentOptions, getOperatorLinkedDriverId, type AssignmentOptions } from "@/lib/operations/assignment-context";
import { TripReadinessPanel } from "@/components/operations/trip-detail/TripReadinessPanel";
import { TripExceptionsPanel } from "@/components/operations/trip-detail/TripExceptionsPanel";
import { TripNotesPanel } from "@/components/operations/trip-detail/TripNotesPanel";
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
/** The Trip states assign_trip / reassign_trip accept (20260831100200_controlled_trip_mutations.sql) -- a UI gate only. */
const ASSIGNABLE_STATES = new Set(["scheduled", "en_route_to_pickup", "arrived_at_pickup"]);

export default async function TripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const pathname = await getCurrentPathname(`/operations/trips/${tripId}`);
  const organization = await requireOperationsAccess(pathname);
  const timezone = organization.organizationTimezone;

  const result = await getTripDetail(tripId, organization.organizationId);

  if (result.status === "unavailable") {
    return (
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
    );
  }

  if (result.status === "error") {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load this trip"
        description="Something went wrong. Try refreshing the page in a moment."
      />
    );
  }

  const { trip, notes, openExceptions, events } = result;
  const lastUpdateAt = events[0]?.occurredAt ?? trip.updatedAt;

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
      readiness = await getTripReadiness(trip.id, organization.organizationId);
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
  if (ASSIGNABLE_STATES.has(trip.state)) {
    try {
      [assignmentOptions, operatorDriverId] = await Promise.all([
        getAssignmentOptions(organization.organizationId),
        getOperatorLinkedDriverId(organization.organizationId),
      ]);
    } catch {
      assignmentOptions = null;
    }
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <nav aria-label="Breadcrumb" className={cn(typography.bodySmall, "text-text-muted")}>
        <Link href="/operations/trips" className="hover:text-text-secondary hover:underline">
          Trips
        </Link>
        <span className="mx-2" aria-hidden>
          ›
        </span>
        <span className="text-text-secondary">{trip.passengerName}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-zw-md">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {/* AppHeader's persistent "Trip Detail" chrome title is this page's real <h1> (src/components/operations/AppHeader.tsx) — the Passenger name is this page's own main heading, one level down, not a second <h1> (found via real accessibility testing, not assumed). */}
            <h2 className={cn(typography.pageTitleOperational, "text-text-primary")}>{trip.passengerName}</h2>
            <TripStatus status={trip.statusLabel} />
          </div>
          {trip.scheduledPickupAt && (
            <p className={cn(typography.body, "mt-1 text-text-secondary")}>
              {formatOperationsLongDate(new Date(trip.scheduledPickupAt), timezone)}
            </p>
          )}
        </div>
        <TripDetailActionBar
          tripId={trip.id}
          passengerName={trip.passengerName}
          driverPhone={trip.driverPhone}
          eligibleForCancel={trip.eligibleForCancel}
          eligibleForNoShow={trip.eligibleForNoShow}
        />
      </div>

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
            {trip.state === "cancelled" && trip.cancellationReason && (
              <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Reason: {trip.cancellationReason}</p>
            )}
          </div>
        </div>
      )}

      <TripInfoStrip
        scheduledPickupAt={trip.scheduledPickupAt}
        appointmentAt={trip.appointmentAt}
        driverName={trip.driverName}
        vehicleLabel={trip.vehicleLabel}
        statusLabel={trip.statusLabel}
        timezone={timezone}
      />

      <div className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
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

        <div className="flex flex-col gap-zw-lg">
          <CurrentStatusPanel
            statusLabel={trip.statusLabel}
            driverName={trip.driverName}
            lastUpdateAt={lastUpdateAt}
            driverNextActionLabel={trip.isTerminal ? null : trip.driverNextActionLabel}
            timezone={timezone}
            eligibleForAssignmentAction={!trip.isTerminal}
            hasActiveAssignment={trip.activeAssignmentId !== null}
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
                />
              ) : undefined
            }
          />
          <TripReadinessPanel readiness={readiness} unavailable={readinessUnavailable} />
          <TripExceptionsPanel tripId={trip.id} openExceptions={openExceptions} timezone={timezone} />
          <TripNotesPanel tripId={trip.id} notes={notes} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}
