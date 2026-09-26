import "server-only";
import { Panel } from "@/components/ui/Panel";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatShift, type WeeklyShift } from "@/lib/operations/availability-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * P1-OPS-PROG5B (Q3) -- read-only "My working hours" for the signed-in driver. OWN data only, through
 * driver_get_own_schedule (the RPC derives the active linked Driver from auth.uid(); it takes no driver id). Shows the
 * driver's own weekly hours and own time off in the next 14 days. No editing, no fleet or capability data, no other
 * driver's information. A failed read renders nothing (never an error surface for drivers).
 */
export async function DriverWorkingHoursCard({ organizationId }: { organizationId: string }) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_get_own_schedule", { p_organization_id: organizationId });
  if (error || !data) return null;
  const shifts = (Array.isArray(data.shifts) ? data.shifts : []) as unknown as WeeklyShift[];
  const windows = (Array.isArray(data.upcoming_unavailability) ? data.upcoming_unavailability : []) as unknown as { starts_at: string; ends_at: string }[];
  const tz = data.timezone ?? "UTC";
  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

  return (
    <Panel data-testid="driver-working-hours-card">
      <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>My working hours</h2>
      {data.configured ? (
        <ul className="mt-2 flex flex-col gap-1" data-testid="driver-own-shifts">
          {shifts.map((s) => (
            <li key={`${s.weekday}-${s.start}-${s.end}`} className={cn(typography.bodySmall, "text-text-secondary")}>
              {formatShift(s)}
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn(typography.bodySmall, "mt-2 text-text-muted")}>Working hours not set.</p>
      )}
      <p className={cn(typography.metadata, "mt-3 font-medium uppercase tracking-wide text-text-muted")}>Time off (next 14 days)</p>
      {windows.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1" data-testid="driver-own-time-off">
          {windows.map((w) => (
            <li key={w.starts_at} className={cn(typography.bodySmall, "text-text-secondary")}>
              {fmt.format(new Date(w.starts_at))} – {fmt.format(new Date(w.ends_at))}
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>None recorded.</p>
      )}
      <p className={cn(typography.metadata, "mt-3 text-text-muted")}>Times are in {tz}. Ask your dispatcher to change them.</p>
    </Panel>
  );
}
