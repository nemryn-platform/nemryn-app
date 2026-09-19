import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRequestDetail, getRequestActivity, type RequestActivityEvent } from "@/lib/operations/request-detail";
import { getLogRequestFormData } from "@/lib/operations/log-request";
import { requestStatusLabel, requestStatusCategory, requestReadinessLabel, requestReadinessTextClass, formatOperationsLongDate } from "@/lib/operations/presentation";
import { deriveRequestReadiness } from "@/lib/operations/request-readiness-core";
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
 * Does NOT include: return-trip creation, Request reopening, accepted-
 * Request cancellation, Trip cancellation, Passenger reassignment,
 * notification infrastructure, Operations Brief request count, public
 * intake, or a recurring-care engine — all explicitly out of scope for
 * this phase.
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
  const passengerNeedsResolution =
    request.state === "pending" && (request.passenger === null || request.passenger.status !== "active");
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

  const identity = request.passenger?.displayName ?? request.requesterName;
  const readiness = deriveRequestReadiness({
    state: request.state,
    passengerId: request.passenger?.id ?? null,
    passengerActive: request.passenger?.status === "active",
  });

  // P1-E1-S2F-B1 §10-§12 — the ONE primary operational action this
  // phase adds. Pending + Ready (readiness already encodes "has an
  // active linked Passenger") offers first conversion; Accepted + an
  // ACTIVE linked Passenger offers an additional Trip (return-
  // transportation / multi-Trip, preserving the existing 1:N model).
  // Readiness alone cannot distinguish "accepted + active" from
  // "accepted + inactive" (deriveRequestReadiness always returns
  // "accepted" for that state regardless of Passenger status, S2E-R1
  // §10), so the accepted case checks request.passenger.status
  // directly — deliberately, not an oversight. Every other combination
  // (pending+unresolved, pending+inactive, accepted+inactive, declined,
  // cancelled) shows neither action, matching §12's own explicit list;
  // an accepted Request with an inactive Passenger stays read-only —
  // no reassignment path is invented here (S2E-R1's own locked rule).
  const canCreateTrip = request.state === "pending" && readiness === "ready";
  const canCreateAnotherTrip = request.state === "accepted" && request.passenger !== null && request.passenger.status === "active";
  const createTripHref = `/operations/trips/new?${new URLSearchParams({ requestId: request.id }).toString()}`;

  // P1-E1-S2F-B2 §5 — Decline is available for ANY pending Request
  // (resolved or not; Decline doesn't require a Passenger, unlike
  // conversion). Cancel is available only while pending AND zero
  // linked Trips exist — the UI gate is a convenience, never the
  // authority: `cancel_transportation_request`'s own "ANY linked Trip
  // row blocks cancellation" rule (S2B, locked) remains authoritative
  // regardless of what this boolean ever says (§12). Neither action is
  // ever offered for accepted/declined/cancelled Requests — no Reopen,
  // no accepted-Request cancellation, no Trip cancellation path exists
  // here or anywhere in this phase.
  const canDecline = request.state === "pending";
  const canCancel = request.state === "pending" && request.linkedTrips.length === 0;
  // A rare, mostly-legacy-data edge case (§11): a pending Request that
  // somehow already has a linked Trip (not reachable through this
  // phase's own controlled UI, but not something to hide silently
  // either) — a restrained, informational note only, never an enabled
  // action, never a cascade into Trip cancellation.
  const hasUncancellableLinkedTrips = request.state === "pending" && request.linkedTrips.length > 0;

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
        <RequestActionBar
          requestId={request.id}
          canCreateTrip={canCreateTrip}
          canCreateAnotherTrip={canCreateAnotherTrip}
          canDecline={canDecline}
          canCancel={canCancel}
          createTripHref={createTripHref}
        />
      </div>

      {hasUncancellableLinkedTrips && (
        <p className={cn(typography.bodySmall, "text-text-muted")}>
          This request has linked trips and cannot be cancelled here.
        </p>
      )}

      {/* READINESS (P1-E1-S2E §10/§11) — the one normal pending blocker
          is Passenger resolution; a missing preferred date/time is never
          treated as a readiness blocker (§11). Only the "needs_passenger"
          case gets a prominent warning banner — ready/accepted/
          not_convertible are calm, restrained facts, not something to
          visually flag. */}
      {readiness === "needs_passenger" ? (
        <AttentionState
          level="warning"
          title="Passenger needed"
          description="Link a passenger below to mark this request ready."
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
            requestState={request.state}
            passenger={request.passenger}
            candidatePassengers={candidatePassengers}
            candidatesUnavailable={candidatesUnavailable}
          />
          <RequestTransportationPanel
            pickupDescription={request.pickupDescription}
            destinationDescription={request.destinationDescription}
            preferredDate={request.preferredDate}
            preferredTime={request.preferredTime}
            returnTripNeeded={request.returnTripNeeded}
          />
          <RequestLinkedTripsPanel requestState={request.state} linkedTrips={request.linkedTrips} timezone={timezone} />
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
          />
          <RequestActivityPanel events={activityEvents} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}
