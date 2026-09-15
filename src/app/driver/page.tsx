import Link from "next/link";
import { CalendarCheck, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { DriverNextTripCard } from "@/components/driver/DriverNextTripCard";
import { DriverTripCard } from "@/components/driver/DriverTripCard";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { driverTripStateLabel, formatTripTime, formatLongDate, isSameOperationalDay } from "@/lib/driver/trip-presentation";
import type { Database } from "@/lib/supabase/database.types";

type RawActiveTrip = Database["public"]["CompositeTypes"]["driver_active_trip_summary"];

interface TodayTrip {
  tripId: string;
  scheduledPickupAt: string;
  appointmentAt: string | null;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  state: string;
}

/**
 * Narrows + presents one `driver_active_trip_summary` row for the Today
 * screen, scoped to today's calendar date IN THE ORGANIZATION'S OWN
 * OPERATIONAL TIMEZONE (P1-E3-S2C — never the Next.js server's own
 * timezone; work item §13 of P1-E3-S2 — every rendered field is mapped to
 * an actual RPC output; see docs/product/driver-today-data-map.md and
 * docs/product/operational-timezone.md). A trip with no
 * `scheduled_pickup_at` (optional at creation — docs/data/mutation-api.md
 * `create_trip`) has no unambiguous "is this today" answer and is
 * deliberately excluded here, not guessed into either bucket — it remains
 * visible on the (not-yet-built) Trips screen instead.
 */
function toTodayTrip(trip: RawActiveTrip, now: Date, timezone: string): TodayTrip | null {
  if (!trip.trip_id || !trip.scheduled_pickup_at) return null;
  if (!isSameOperationalDay(new Date(trip.scheduled_pickup_at), now, timezone)) return null;

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
 * Driver Today (P1-E3-S2) — docs/design/stitch/references/06-driver-today.png.
 * Server-rendered from the approved secure Driver read API only
 * (`driver_list_active_trips`); no direct `trips`/`passengers` read, no
 * client-side fetch-after-mount. See docs/product/driver-today-data-map.md
 * for the full field mapping, and that document's "Omitted from this
 * phase" section for what the Stitch reference shows that the current
 * secure projection cannot support without a backend gap (Completed Today,
 * the Navigate/Call Passenger actions, the "Pickup updated from X" notice).
 */
export default async function DriverTodayPage() {
  const pathname = await getCurrentPathname("/driver");
  const access = await requireDriverAccess(pathname);

  if (access.status !== "ok") {
    // The parent layout already renders the link-missing state before this
    // page can render at all (work item §36) — unreachable in practice,
    // kept only so this function's own types stay sound without a cast.
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_list_active_trips", {
    p_organization_id: access.organization.organizationId,
  });

  if (error) {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load your trips"
        description="Something went wrong loading today's schedule. Try again in a moment."
        action={
          <Link href="/driver" className={cn(typography.button, "text-text-link")}>
            Try again
          </Link>
        }
      />
    );
  }

  const timezone = access.organization.organizationTimezone;
  const now = new Date();
  const todayTrips = (data ?? [])
    .map((trip) => toTodayTrip(trip, now, timezone))
    .filter((trip): trip is TodayTrip => trip !== null)
    .sort((a, b) => new Date(a.scheduledPickupAt).getTime() - new Date(b.scheduledPickupAt).getTime());

  const [nextTrip, ...laterTrips] = todayTrips;

  return (
    <div className="flex flex-col gap-6 pb-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className={cn(typography.pageTitleOperational, "text-brand-care-navy")}>Today</h2>
          {todayTrips.length > 0 && (
            <StatusBadge
              label={`${todayTrips.length} trip${todayTrips.length === 1 ? "" : "s"} assigned`}
              category="active"
            />
          )}
        </div>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{formatLongDate(now, timezone)}</p>
      </div>

      {todayTrips.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-8" aria-hidden />}
          title="You're clear for now"
          description="No trips scheduled for today yet. Check the Trips tab for what's coming up."
        />
      ) : (
        <>
          {nextTrip && (
            <section className="flex flex-col gap-2">
              <SectionLabel text="Next Trip" />
              <DriverNextTripCard
                time={formatTripTime(nextTrip.scheduledPickupAt, timezone)}
                passengerName={nextTrip.passengerDisplayName}
                pickup={nextTrip.pickupDescription}
                destination={nextTrip.destinationDescription}
                status={driverTripStateLabel(nextTrip.state)}
                appointmentLabel={
                  nextTrip.appointmentAt ? `Appt: ${formatTripTime(nextTrip.appointmentAt, timezone)}` : undefined
                }
                tripHref={`/driver/trips/${nextTrip.tripId}`}
              />
            </section>
          )}

          {laterTrips.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionLabel text="Later Today" />
              <div className="flex flex-col gap-3">
                {laterTrips.map((trip) => (
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
          )}
        </>
      )}
    </div>
  );
}
