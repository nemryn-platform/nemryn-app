import Link from "next/link";
import { Info } from "@phosphor-icons/react/dist/ssr";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Panel } from "@/components/ui/Panel";
import { TripStatus } from "@/components/ui/TripStatus";
import { DriverActiveTripLegs } from "@/components/driver/DriverActiveTripLegs";
import { DriverInstruction } from "@/components/driver/DriverInstruction";
import { DriverLifecycleAction } from "@/components/driver/DriverLifecycleAction";
import { DriverLocationTracker } from "@/components/driver/DriverLocationTracker";
import { DriverReportIssueButton } from "@/components/driver/DriverReportIssueButton";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import {
  driverTripStateLabel,
  formatTripTime,
  DRIVER_NEXT_ACTION,
  ELIGIBLE_LOCATION_TRACKING_STATES,
} from "@/lib/driver/trip-presentation";

interface DriverNote {
  id: string;
  body: string;
  created_at: string;
}

function parseDriverNotes(value: unknown): DriverNote[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (n): n is DriverNote =>
      typeof n === "object" && n !== null && typeof (n as DriverNote).body === "string",
  );
}

/**
 * Driver Trip Detail / Active Trip (P1-E3-S3) —
 * docs/design/stitch/references/04-driver-active-trip.png. The canonical
 * route already defined in application-route-map.md and already linked to
 * from Driver Today/Trips' "View Trip" actions (P1-E3-S2) — this phase
 * implements its real content for the first time.
 *
 * Server-rendered from `driver_get_trip_detail` only — the sole approved
 * minimum-necessary Passenger/Trip projection for an actively-assigned
 * Trip (docs/data/read-api.md). `tripId` is untrusted route input; it is
 * passed straight to the RPC, which remains the sole authority — no
 * pre-validation "does this look like a UUID I might have access to"
 * check exists, because that distinction is exactly what the RPC itself
 * safely and correctly determines (work item §43/§44). Any failure —
 * malformed ID, nonexistent Trip, foreign-org Trip, never-assigned,
 * reassigned-away, or a Trip whose lifecycle has already ended (which
 * closes the active assignment in the same transaction — docs/data/
 * mutation-api.md — so a just-completed Trip becomes inaccessible here on
 * its very next load, by design) — renders the identical calm "Trip
 * unavailable" state, never a distinguished reason (no existence oracle,
 * matching ZD-095's own established anti-oracle convention).
 */
export default async function DriverTripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const pathname = await getCurrentPathname(`/driver/trips/${tripId}`);
  const access = await requireDriverAccess(pathname);

  if (access.status !== "ok") {
    return null;
  }

  const timezone = access.organization.organizationTimezone;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_get_trip_detail", { p_trip_id: tripId });

  if (error || !data || !data.trip_id) {
    return (
      <EmptyState
        title="Trip unavailable"
        description="This trip isn't accessible — it may have been reassigned, completed, or no longer exists."
        action={
          <Link href="/driver/trips" className={cn(typography.button, "text-text-link")}>
            Back to Trips
          </Link>
        }
      />
    );
  }

  const state = data.state ?? "scheduled";
  const passengerName = data.passenger_display_name ?? "Passenger";
  const pickupAddress = data.pickup_description ?? "Pickup location not available";
  const destinationAddress = data.destination_description ?? "Destination not available";
  const notes = parseDriverNotes(data.driver_notes);
  const nextAction = DRIVER_NEXT_ACTION[state];

  const requirementItems = [
    { label: "Assistance", value: data.assistance_notes ?? "None recorded" },
    { label: "Instructions", value: data.instructions ?? "None recorded" },
  ];

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <h2 className={cn(typography.sectionHeading, "text-text-primary")}>{passengerName}</h2>
          <TripStatus status={driverTripStateLabel(state)} />
        </div>
      </Panel>

      <Panel>
        <DriverActiveTripLegs
          state={state}
          pickupTime={formatTripTime(data.scheduled_pickup_at, timezone)}
          pickupAddress={pickupAddress}
          destinationTime={data.appointment_at ? `Appt: ${formatTripTime(data.appointment_at, timezone)}` : undefined}
          destinationAddress={destinationAddress}
          passengerPhone={data.passenger_phone}
        />
      </Panel>

      {ELIGIBLE_LOCATION_TRACKING_STATES.has(state) && <DriverLocationTracker tripId={tripId} />}

      {notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <DriverInstruction
              key={note.id}
              icon={<Info className="size-5" aria-hidden />}
              instruction={note.body}
            />
          ))}
        </div>
      )}

      <Panel>
        <p className={cn(typography.label, "mb-3 uppercase tracking-wide text-text-muted")}>Passenger Requirements</p>
        <DefinitionList items={requirementItems} />
      </Panel>

      {nextAction && (
        <>
          {/* P1-E3-S8B (work item §37): the reference shows Report Issue
              as a clear, natural affordance here, and the backend (after
              P1-E3-S8A's own hardening) now safely supports exactly this
              scope — current assignment only, non-terminal only, the
              same controlled RPC, no Driver resolve, no broad exception
              read. Gated on `nextAction` (the same signal that gates the
              lifecycle button below) since a Trip with no next action is
              terminal, and report_trip_exception would deny it anyway. */}
          <DriverReportIssueButton tripId={tripId} className="w-full" />
          <DriverLifecycleAction tripId={tripId} currentState={state} rpc={nextAction.rpc} label={nextAction.label} />
        </>
      )}
    </div>
  );
}
