import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRequestDetail, getRequestActivity, getRequestAcquisition, type RequestActivityEvent } from "@/lib/operations/request-detail";
import type { RequestAcquisition } from "@/lib/operations/request-acquisition-core";
import { getLogRequestFormData } from "@/lib/operations/log-request";
import { requestStatusLabel, requestStatusCategory, requestReadinessLabel, requestReadinessTextClass, formatOperationsLongDate } from "@/lib/operations/presentation";
import { deriveRequestActions, deriveRequestReadiness } from "@/lib/operations/request-readiness-core";
import { EmptyState } from "@/components/ui/EmptyState";
import { AttentionState } from "@/components/ui/AttentionState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/LinkButton";
import { RequestActionBar } from "@/components/operations/requests/RequestActionBar";
import { RequestTransportationPanel } from "@/components/operations/requests/RequestTransportationPanel";
import { RequestPassengerPanel } from "@/components/operations/requests/RequestPassengerPanel";
import { RequestRequesterPanel } from "@/components/operations/requests/RequestRequesterPanel";
import { RequestDetailsPanel } from "@/components/operations/requests/RequestDetailsPanel";
import { RequestLinkedTripsPanel } from "@/components/operations/requests/RequestLinkedTripsPanel";
import { RequestActivityPanel } from "@/components/operations/requests/RequestActivityPanel";
import { RequestAcquisitionPanel } from "@/components/operations/requests/RequestAcquisitionPanel";
import type { NewTripPassengerOption } from "@/lib/operations/new-trip-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Operations Request Detail (P1-E1-S2E, extended by P1-E1-S2F-B1's
 * Create Trip/Create Another Trip and P1-E1-S2F-B2's Decline/Cancel)
 * — mirrors Trip Detail's own established page shape as closely as
 * possible (the closest existing precedent for a single-record
 * Operations detail page in this codebase): breadcrumb, `<h2>` main
 * heading (AppHeader's own persistent chrome title remains this page's
 * real `<h1>`, exactly like Trip Detail), a discriminated not-found/
 * error/ok result contract, and bare-`Panel`-plus-`<h3>` read-only
 * sections.
 *
 * P1-OPS-R1: the Request's business DECISION (Accept / Decline on a
 * pending Request, Cancel on an accepted one) is explicit and separate
 * from operational READINESS (an active linked Passenger). Linking a
 * Passenger never accepts; accepting never creates a Passenger or Trip.
 *
 * Does NOT include: Request reopening / undo, Trip cancellation from
 * here, Passenger reassignment once a Trip exists, or external
 * (passenger-facing) notifications.
 */
export default async function RequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const pathname = await getCurrentPathname(`/operations/requests/${requestId}`);
  const organization = await requireOperationsAccess(pathname);

  const result = await getRequestDetail(requestId, organization.organizationId);

  // P1-E1-S2E §6/§26/§33 — a nonexistent Request and a foreign-org
  // Request are deliberately indistinguishable (no existence oracle),
  // exactly matching Trip Detail's own "unavailable" precedent.
  if (result.status === "unavailable") {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Request unavailable"
        description="This request doesn't exist, or you don't have access to it."
        action={
          <Link href="/operations/requests" className={cn(typography.button, "text-text-link")}>
            Back to Requests
          </Link>
        }
      />
    );
  }

  // P1-E1-S2D-R1 established the fail-visible convention this phase
  // reuses deliberately: a genuine query failure gets a visibly
  // different, critical-toned treatment with a real Retry action —
  // never the same quiet EmptyState treatment as "doesn't exist" (a
  // stricter standard than Trip Detail's own pre-R1 error copy, applied
  // here because Request Detail is being built AFTER that lesson was
  // learned).
  if (result.status === "error") {
    return (
      <AttentionState
        level="critical"
        title="Unable to load request"
        description="Request information could not be loaded. Try again."
        action={
          <LinkButton href={`/operations/requests/${requestId}`} variant="outline">
            Retry
          </LinkButton>
        }
      />
    );
  }

  const { request } = result;
  const timezone = organization.organizationTimezone;

  // The active-Passenger candidate list is only needed for the
  // Search-existing-Passenger affordance — either the ordinary unlinked
  // case (§16), or the P1-E1-S2E-R1 recovery case (a pending Request
  // whose linked Passenger has gone inactive) — skipped entirely
  // otherwise, both to avoid an unnecessary query and because it is not
  // part of the Request's own authoritative data (unlike the Linked
  // Trips query, which fails the whole page — §27.E). A failure here
  // degrades only the search sub-feature, never the page. Fetched
  // whenever the recovery notice COULD render, even though the
  // operator may not click through to the search UI on every page
  // load — cheap and keeps this data-loading decision independent of
  // the Passenger panel's own client-side "has the operator clicked
  // through yet" state.
  let candidatePassengers: NewTripPassengerOption[] = [];
  let candidatesUnavailable = false;
  const hasLinkedTrips = request.linkedTrips.length > 0;
  const readinessInput = {
    state: request.state,
    passengerId: request.passenger?.id ?? null,
    passengerActive: request.passenger?.status === "active",
    hasLinkedTrips,
  };
  const actions = deriveRequestActions(readinessInput);
  const passengerNeedsResolution =
    actions.canLinkPassenger && (request.passenger === null || request.passenger.status !== "active");
  if (passengerNeedsResolution) {
    try {
      const formData = await getLogRequestFormData(organization.organizationId);
      candidatePassengers = formData.passengers;
    } catch {
      candidatesUnavailable = true;
    }
  }

  // Request Activity (P1-E1-S2F-B2 §16/§18) — a SEPARATE, best-effort
  // fetch, exactly like the candidatePassengers pattern above: this is
  // supplementary information, never part of the Request's own
  // authoritative state (unlike Linked Trips, whose failure fails the
  // whole page via getRequestDetail's own discriminated result). A
  // failure here degrades ONLY the Activity panel — `events === null`
  // is how that failure is represented, distinct from a genuine empty
  // history (`events === []`, a real, successfully-fetched fact).
  let activityEvents: RequestActivityEvent[] | null = null;
  try {
    activityEvents = await getRequestActivity(request.id, organization.organizationId);
  } catch {
    activityEvents = null;
  }

  // Acquisition (P1-PILOT-S4C) -- supplementary, best effort, website Requests only. `null` (no snapshot, historical
  // Request, or any failure) simply omits the section; it never affects the Request's own state or page load.
  let acquisition: RequestAcquisition | null = null;
  if (request.intakeIntegrationId !== null) {
    try {
      acquisition = await getRequestAcquisition(request.id, organization.organizationId);
    } catch {
      acquisition = null;
    }
  }

  const identity = request.passenger?.displayName ?? request.requesterName;
  const readiness = deriveRequestReadiness(readinessInput);
  const createTripHref = `/operations/trips/new?${new URLSearchParams({ requestId: request.id }).toString()}`;

  return (
    <div className="flex flex-col gap-zw-lg">
      <nav aria-label="Breadcrumb" className={cn(typography.bodySmall, "text-text-muted")}>
        <Link href="/operations/requests" className="hover:text-text-secondary hover:underline">
          Requests
        </Link>
        <span className="mx-2" aria-hidden>
          ›
        </span>
        <span className="text-text-secondary">{identity}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-zw-md">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {/* AppHeader's persistent "Request Detail" chrome title is this page's real <h1> — matches Trip Detail's own established convention exactly (src/app/operations/trips/[tripId]/page.tsx). */}
            <h2 className={cn(typography.pageTitleOperational, "text-text-primary")}>Request</h2>
            <StatusBadge label={requestStatusLabel(request.state)} category={requestStatusCategory(request.state)} />
          </div>
          <p className={cn(typography.body, "mt-1 text-text-secondary")}>
            {identity} · Logged {formatOperationsLongDate(new Date(request.createdAt), timezone)}
          </p>
        </div>
        <RequestActionBar requestId={request.id} actions={actions} createTripHref={createTripHref} />
      </div>

      {actions.cancelBlockedByTrips && (
        <p className={cn(typography.bodySmall, "text-text-muted")}>
          This request already has transportation scheduled. Manage cancellation from the linked trip.
        </p>
      )}

      {/* READINESS (P1-E1-S2E §10/§11, P1-OPS-R1) — separate from the
          decision. The one operational blocker is Passenger resolution;
          only "needs_passenger" gets a warning banner, and its copy never
          implies that linking a Passenger accepts the Request. */}
      {readiness === "needs_passenger" ? (
        <AttentionState
          level="warning"
          title="Passenger needed"
          description="Link or create the passenger before this request can be scheduled."
        />
      ) : (
        <p className={cn(typography.bodySmall, "font-medium", requestReadinessTextClass(readiness))}>
          {requestReadinessLabel(readiness)}
        </p>
      )}

      <div className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
          <RequestPassengerPanel
            requestId={request.id}
            canLinkPassenger={actions.canLinkPassenger}
            passenger={request.passenger}
            candidatePassengers={candidatePassengers}
            candidatesUnavailable={candidatesUnavailable}
            requestedPassengerName={request.requestedPassengerName}
          />
          <RequestTransportationPanel
            pickupDescription={request.pickupDescription}
            destinationDescription={request.destinationDescription}
            preferredDate={request.preferredDate}
            preferredTime={request.preferredTime}
            returnTripNeeded={request.returnTripNeeded}
          />
          <RequestLinkedTripsPanel linkedTrips={request.linkedTrips} timezone={timezone} />
        </div>

        <div className="flex flex-col gap-zw-lg">
          <RequestRequesterPanel
            requesterName={request.requesterName}
            requesterRelationship={request.requesterRelationship}
            requesterPhone={request.requesterPhone}
            requesterEmail={request.requesterEmail}
          />
          <RequestDetailsPanel
            source={request.source}
            intakeIntegrationId={request.intakeIntegrationId}
            assistanceNotes={request.assistanceNotes}
            additionalNotes={request.additionalNotes}
            serviceType={request.serviceType}
            recurringSchedule={request.recurringSchedule}
          />
          <RequestAcquisitionPanel acquisition={acquisition} />
          <RequestActivityPanel events={activityEvents} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}
