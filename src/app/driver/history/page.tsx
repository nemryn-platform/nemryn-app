import { WarningCircle, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripStatus } from "@/components/ui/TripStatus";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { driverTripStateLabel, formatLongDate, formatTripTime } from "@/lib/driver/trip-presentation";

/**
 * Driver History (P1-E3-S3) — no Stitch reference exists for this screen
 * (GAP-3, ui-backend-gap-register.md) and none is fabricated here; this is
 * a minimal, functional version built directly against the existing
 * design system, matching that gap's own recommendation.
 *
 * Server-rendered from `driver_list_trip_history` only — its contract is
 * deliberately, materially redacted (ZD-099): no passenger identity, no
 * route/address text, `trip_outcome` populated only for a Trip that
 * actually reached a terminal state. This page is built entirely around
 * what that projection legitimately returns (work item §9) — it does not,
 * and structurally cannot, call `driver_get_trip_detail` for a historical
 * Trip to recover the redacted fields; that RPC correctly denies access
 * once the assignment has ended (docs/product/driver-trips-data-map.md).
 */
export default async function DriverHistoryPage() {
  const pathname = await getCurrentPathname("/driver/history");
  const access = await requireDriverAccess(pathname);

  if (access.status !== "ok") {
    return null;
  }

  const timezone = access.organization.organizationTimezone;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_list_trip_history", {
    p_organization_id: access.organization.organizationId,
  });

  if (error) {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load your history"
        description="Something went wrong loading your trip history. Try again in a moment."
        action={
          <Link href="/driver/history" className={cn(typography.button, "text-text-link")}>
            Try again
          </Link>
        }
      />
    );
  }

  const entries = (data ?? [])
    .filter((e) => e.trip_id && e.scheduled_pickup_at)
    .sort(
      (a, b) => new Date(b.scheduled_pickup_at as string).getTime() - new Date(a.scheduled_pickup_at as string).getTime(),
    );

  return (
    <div className="flex flex-col gap-4 pb-4">
      <h2 className={cn(typography.pageTitleOperational, "text-brand-care-navy")}>History</h2>

      {entries.length === 0 ? (
        <EmptyState
          icon={<ClockCounterClockwise className="size-8" aria-hidden />}
          title="No trip history yet"
          description="Your completed and past assignments will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div
              key={entry.trip_id}
              className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-elevated p-zw-md"
            >
              <div className="min-w-0">
                <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                  {formatLongDate(new Date(entry.scheduled_pickup_at as string), timezone)}
                </p>
                <p className={cn(typography.metadata, "text-text-muted")}>
                  {formatTripTime(entry.scheduled_pickup_at, timezone)}
                  {entry.end_reason ? ` · ${entry.end_reason.replace(/_/g, " ")}` : ""}
                </p>
              </div>
              {entry.trip_outcome ? (
                <TripStatus status={driverTripStateLabel(entry.trip_outcome)} />
              ) : (
                <StatusBadge label="Assignment ended" category="neutral" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
