import Link from "next/link";
import { WarningCircle, ListChecks } from "@phosphor-icons/react/dist/ssr";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { DriverNextTripCard } from "@/components/driver/DriverNextTripCard";
import { DriverTripCard } from "@/components/driver/DriverTripCard";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import {
  driverTripStateLabel,
  formatTripTime,
  operationalDayLabel,
  operationalDateKey,
} from "@/lib/driver/trip-presentation";
import type { Database } from "@/lib/supabase/database.types";

type RawActiveTrip = Database["public"]["CompositeTypes"]["driver_active_trip_summary"];

interface PresentedTrip {
  tripId: string;
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  state: string;
}

function toPresentedTrip(trip: RawActiveTrip): PresentedTrip | null {
  if (!trip.trip_id) return null;
  return {
    tripId: trip.trip_id,
    scheduledPickupAt: trip.scheduled_pickup_at,
    appointmentAt: trip.appointment_at,
    passengerDisplayName: trip.passenger_display_name ?? "Passenger",
    pickupDescription: trip.pickup_description ?? "Pickup location not available",
    destinationDescription: trip.destination_description ?? "Destination not available",
    state: trip.state ?? "scheduled",
  };
}

function SectionLabel({ text }: { text: string }) {
  return <p className={cn(typography.label, "uppercase tracking-wide text-text-muted")}>{text}</p>;
}

/**
 * Driver Trips (P1-E3-S3) — docs/design/stitch/references/07-driver-trips.png.
 * Server-rendered from `driver_list_active_trips` only — the same secure
 * read this application already uses on Driver Today, here shown
 * unfiltered by date (every currently-active assignment, not just today's
 * — docs/product/driver-trips-data-map.md). No direct `trips`/`passengers`
 * read, no client-side fetch-after-mount.
 */
export default async function DriverTripsPage() {
  const pathname = await getCurrentPathname("/driver/trips");
  const access = await requireDriverAccess(pathname);

  if (access.status !== "ok") {
    // The parent layout already renders the link-missing state before
    // this page can render at all — unreachable in practice.
    return null;
  }

  const timezone = access.organization.organizationTimezone;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_list_active_trips", {
    p_organization_id: access.organization.organizationId,
  });

  if (error) {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load your trips"
        description="Something went wrong loading your assignments. Try again in a moment."
        action={
          <Link href="/driver/trips" className={cn(typography.button, "text-text-link")}>
            Try again
          </Link>
        }
      />
    );
  }

  const trips = (data ?? [])
    .map(toPresentedTrip)
    .filter((trip): trip is PresentedTrip => trip !== null);

  const scheduled = trips
    .filter((t): t is PresentedTrip & { scheduledPickupAt: string } => t.scheduledPickupAt !== null)
    .sort((a, b) => new Date(a.scheduledPickupAt).getTime() - new Date(b.scheduledPickupAt).getTime());
  const unscheduled = trips.filter((t) => t.scheduledPickupAt === null);

  const [featured] = scheduled;
  const now = new Date();

  // Group EVERY scheduled trip (including the featured one) by
  // organization-local day — one header per calendar day, never one for
  // the featured trip and a SECOND, duplicate one for the rest of that
  // same day (a real bug found during P1-E3-S8B's reference comparison:
  // the reference's own Driver Trips composition shows exactly one
  // "TODAY" header covering both the featured card and any later-today
  // cards together, not two). The featured trip renders with the richer
  // DriverNextTripCard component inside its own group's section; every
  // other trip in that same group (and every trip in later groups) uses
  // the compact DriverTripCard — but the day header itself is shared.
  const groups: { key: string; label: string; trips: PresentedTrip[] }[] = [];
  for (const trip of scheduled) {
    const key = operationalDateKey(new Date(trip.scheduledPickupAt as string), timezone);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: operationalDayLabel(new Date(trip.scheduledPickupAt as string), now, timezone), trips: [] };
      groups.push(group);
    }
    group.trips.push(trip);
  }

  const isEmpty = trips.length === 0;

  return (
    <div className="flex flex-col gap-6 pb-4">
      <h2 className={cn(typography.pageTitleOperational, "text-brand-care-navy")}>Trips</h2>

      {isEmpty ? (
        <EmptyState
          icon={<ListChecks className="size-8" aria-hidden />}
          title="No active assignments"
          description="Trips assigned to you will appear here."
        />
      ) : (
        <>
          {groups.map((group) => {
            const isFirstGroup = group.key === groups[0]?.key;
            const rest = isFirstGroup ? group.trips.filter((t) => t.tripId !== featured?.tripId) : group.trips;
            return (
              <section key={group.key} className="flex flex-col gap-2">
                <SectionLabel text={group.label} />
                <div className="flex flex-col gap-3">
                  {isFirstGroup && featured && (
                    <DriverNextTripCard
                      time={formatTripTime(featured.scheduledPickupAt, timezone)}
                      passengerName={featured.passengerDisplayName}
                      pickup={featured.pickupDescription}
                      destination={featured.destinationDescription}
                      status={driverTripStateLabel(featured.state)}
                      appointmentLabel={
                        featured.appointmentAt ? `Appt: ${formatTripTime(featured.appointmentAt, timezone)}` : undefined
                      }
                      tripHref={`/driver/trips/${featured.tripId}`}
                    />
                  )}
                  {rest.map((trip) => (
                    <Link key={trip.tripId} href={`/driver/trips/${trip.tripId}`} className="block">
                      <DriverTripCard
                        time={formatTripTime(trip.scheduledPickupAt, timezone)}
                        passengerName={trip.passengerDisplayName}
                        pickup={trip.pickupDescription}
                        destination={trip.destinationDescription}
                        status={driverTripStateLabel(trip.state)}
                        appointmentLabel={
                          trip.appointmentAt ? `Appt: ${formatTripTime(trip.appointmentAt, timezone)}` : undefined
                        }
                      />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}

          {unscheduled.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionLabel text="Unscheduled" />
              <div className="flex flex-col gap-3">
                {unscheduled.map((trip) => (
                  <Link key={trip.tripId} href={`/driver/trips/${trip.tripId}`} className="block">
                    <DriverTripCard
                      time="Time TBD"
                      passengerName={trip.passengerDisplayName}
                      pickup={trip.pickupDescription}
                      destination={trip.destinationDescription}
                      status={driverTripStateLabel(trip.state)}
                    />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
