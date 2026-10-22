import { SteeringWheel } from "@phosphor-icons/react/dist/ssr";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge, type StatusCategory } from "@/components/ui/StatusBadge";
import type { DispatchDriverRow } from "@/lib/operations/dispatch-board";
import { DRIVER_NOW_STATUS_LABEL, DRIVER_NOW_STATUS_ORDER, type DriverNowStatus } from "@/lib/operations/availability-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface DriverCapacityPanelProps {
  driverRows: DispatchDriverRow[];
  /** P1-OPS-PROG4: which org-local day the board shows (copy only). */
  day?: "today" | "tomorrow";
}

const STATUS_CATEGORY: Record<DriverNowStatus, StatusCategory> = {
  AVAILABLE: "positive",
  ON_TRIP: "active",
  COMMITTED: "informational",
  TIME_OFF: "neutral",
  OFF_SHIFT: "neutral",
  NOT_FULLY_CHECKABLE: "neutral",
  SCHEDULE_NOT_SET: "neutral",
};

/**
 * The right-column "Driver Capacity" rail (P1-OPS-PROG5B).
 *   Today    -- one canonical NOW status per driver (availability-core deriveDriverNowStatus): On trip / Time off /
 *               Off shift / Committed / Can't fully check / Schedule not set / Available. "Available" means free RIGHT
 *               NOW and only when every fact proves it; it is never shown because a driver is merely active.
 *               The summary counts those mutually exclusive NOW categories (non-zero only). No percentage, no score.
 *   Tomorrow -- no NOW status and no exclusive category: each row shows FACTS (working hours, time off touching
 *               tomorrow, or "Schedule not set"); the summary uses explicitly labelled, possibly overlapping facts.
 */
export function DriverCapacityPanel({ driverRows, day = "today" }: DriverCapacityPanelProps) {
  const summary =
    day === "today"
      ? DRIVER_NOW_STATUS_ORDER.map((status) => ({ status, count: driverRows.filter((r) => r.availability.nowStatus === status).length }))
          .filter((c) => c.count > 0)
          .map((c) => `${c.count} ${DRIVER_NOW_STATUS_LABEL[c.status].toLowerCase()}`)
      : [
          `Schedules set: ${driverRows.filter((r) => r.availability.day?.scheduleConfigured).length}`,
          `Schedules not set: ${driverRows.filter((r) => r.availability.day && !r.availability.day.scheduleConfigured).length}`,
          `Time off recorded tomorrow: ${driverRows.filter((r) => (r.availability.day?.timeOff.length ?? 0) > 0).length}`,
        ];
  return (
    // NP-UI-V2-2: one Brand Lock v2 panel with its header inside; the real summary line stays (data-testid unchanged).
    <Panel surface="raised" padding="none" className="flex flex-col">
      <PanelSection part="header">
      <PanelHeader
        as="h2"
        icon={<SteeringWheel className="size-5" />}
        tone="info"
        title="Driver Capacity"
        description={driverRows.length > 0 ? <span data-testid="capacity-summary">{summary.join(" · ")}</span> : undefined}
      />
      </PanelSection>
      <div className="px-zw-md pb-zw-md">

      {driverRows.length === 0 ? (
        <EmptyState size="compact" title="No active drivers" description="Active drivers in this organization will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-zw-sm sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
          {driverRows.map(({ driver, trips, availability }) => {
            const onTrip = trips.find((trip) => trip.isActiveState);
            const status = availability.nowStatus;
            const dayFacts = availability.day;
            return (
              <Panel key={driver.id} padding="dense" className="flex items-center gap-3" data-testid="capacity-driver" data-driver-id={driver.id} data-now-status={status ?? ""}>
                <Avatar name={driver.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={driver.displayName}>
                      {driver.displayName}
                    </p>
                    {status && <StatusBadge label={DRIVER_NOW_STATUS_LABEL[status]} category={STATUS_CATEGORY[status]} />}
                  </div>
                  {day === "today" || !dayFacts ? (
                    <p
                      className={cn(typography.metadata, "truncate text-text-muted")}
                      title={onTrip ? `${onTrip.passengerName}${onTrip.vehicleLabel ? ` · ${onTrip.vehicleLabel}` : ""}` : undefined}
                    >
                      {onTrip
                        ? `${onTrip.passengerName}${onTrip.vehicleLabel ? ` · ${onTrip.vehicleLabel}` : ""}`
                        : trips.length > 0
                          ? `${trips.length} trip${trips.length === 1 ? "" : "s"} ${day === "tomorrow" ? "tomorrow" : "today"}, none in progress`
                          : `No trips ${day === "tomorrow" ? "tomorrow" : "today"}`}
                    </p>
                  ) : (
                    <div className="flex flex-col" data-testid="capacity-day-facts">
                      <p className={cn(typography.metadata, "text-text-muted")}>
                        {dayFacts.scheduleConfigured
                          ? dayFacts.hours.length > 0
                            ? `Working hours: ${dayFacts.hours.join(", ")}`
                            : "No working hours tomorrow"
                          : "Schedule not set"}
                      </p>
                      {dayFacts.timeOff.length > 0 && (
                        <p className={cn(typography.metadata, "text-text-secondary")}>Time off: {dayFacts.timeOff.join(", ")}</p>
                      )}
                      <p className={cn(typography.metadata, "text-text-muted")}>
                        {trips.length > 0 ? `${trips.length} trip${trips.length === 1 ? "" : "s"} tomorrow` : "No trips tomorrow"}
                      </p>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      </div>
    </Panel>
  );
}
