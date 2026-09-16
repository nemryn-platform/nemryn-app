import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripStatus } from "@/components/ui/TripStatus";
import { operationsTripStatusLabel, formatOperationsTime } from "@/lib/operations/presentation";
import type { RequestDetailLinkedTrip } from "@/lib/operations/request-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestLinkedTripsPanelProps {
  requestState: string;
  linkedTrips: RequestDetailLinkedTrip[];
  timezone: string;
}

/**
 * "What Trips came from this Request?" (P1-E1-S2E §20). Genuinely 1:N —
 * zero, one, or multiple linked Trips are all valid, ordinary outcomes
 * (return transportation and additional accepted-Request Trips can both
 * legitimately produce more than one) — never assumes a single Trip.
 * Deliberately narrow: no driver/vehicle assignment shown (kept cheap
 * and focused, per the phase's own instruction — the linked Trip's own
 * Detail page, one click away, has the full picture). Deliberately does
 * NOT infer or label which linked Trip is "outbound" vs. "return" (§23)
 * — every Trip is listed as its own row, in creation order.
 *
 * `hasActiveAssignment` is always passed `false` to
 * `operationsTripStatusLabel` here — this panel does not query
 * `trip_assignments` at all (kept cheap, per §20), so a `scheduled`
 * linked Trip that IS actually assigned will read as "Scheduled" rather
 * than "Assigned" in this compact list; the linked Trip's own Detail
 * page always shows the precise, authoritative status.
 */
export function RequestLinkedTripsPanel({ requestState, linkedTrips, timezone }: RequestLinkedTripsPanelProps) {
  // P1-E1-S2E §22 — an accepted Request with zero linked Trips should
  // not normally occur under the controlled mutation model (create_trip
  // is the only path that ever sets state = 'accepted', and it does so
  // in the same transaction it creates the Trip), but legacy/test data
  // could theoretically contain it. Never crash, never fabricate a Trip,
  // never alter Request state, never add repair logic here — just a
  // restrained, distinct message from the ordinary "no Trips yet" case.
  const isAcceptedWithNoTrips = requestState === "accepted" && linkedTrips.length === 0;

  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Linked Trips</h3>
      <div className="mt-zw-md">
        {linkedTrips.length === 0 ? (
          <EmptyState
            title={isAcceptedWithNoTrips ? "No linked trips found" : "No trips yet"}
            description={
              isAcceptedWithNoTrips
                ? "This request is accepted but no linked trip could be found."
                : "Trips created from this request will appear here."
            }
          />
        ) : (
          <ul className="flex flex-col gap-zw-sm">
            {linkedTrips.map((trip) => (
              <li key={trip.id} className="rounded-sm border border-border-subtle px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/operations/trips/${trip.id}`}
                    className={cn(typography.bodySmall, "font-medium text-text-primary hover:text-text-link hover:underline")}
                  >
                    {trip.passengerName ?? "Unknown Passenger"}
                  </Link>
                  <TripStatus status={operationsTripStatusLabel(trip.state, false)} />
                </div>
                <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
                  {trip.scheduledPickupAt ? formatOperationsTime(trip.scheduledPickupAt, timezone) : "No pickup time set"}
                </p>
                <p className={cn(typography.bodySmall, "mt-1 flex items-center gap-1.5 text-text-secondary")}>
                  <span className="truncate">{trip.pickupDescription}</span>
                  <span aria-hidden className="text-text-disabled">
                    →
                  </span>
                  <span className="truncate">{trip.destinationDescription}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
