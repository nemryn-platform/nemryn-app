import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { collectPages, OVERLAP_CANDIDATE_MAX_PAGES, OVERLAP_CANDIDATE_PAGE_SIZE } from "./overlap-candidate-loader";
import { addDaysToDateKey, isoWeekdayOfDateKey, localDateKeyOf, organizationLocalToUtc, resolveLocalBoundary } from "./local-time-core";
import {
  availabilityReadinessReasons,
  deriveDriverTripAvailability,
  deriveWindowFact,
  expandShiftInstances,
  MAX_TRIP_SPAN_MS,
  type AvailabilityReadinessReason,
  type DriverTripAvailability,
  type ShiftFact,
  type TimeTools,
  type TimeWindow,
  type VehicleTripAvailability,
  type WeeklyShift,
  type WindowFact,
} from "./availability-core";
import { deriveCapabilityMatch, type CapabilityMatch, type VehicleCapabilities } from "./capability-core";
import { deriveTripExtent, type TripExtent } from "./trip-overlap-core";

/**
 * P1-OPS-PROG5B server-side availability facts. Session client only (RLS applies: Organization Admin / Dispatcher
 * read these tables) and every query is explicitly filtered by the server-resolved organization id. No service role.
 *
 * Batched, bounded reads -- never one query per trip:
 *   - schedule configuration rows + weekly shifts for the organization (optionally scoped to drivers);
 *   - driver / vehicle unavailability windows intersecting [from, to) (windows are at most 366 days long, so
 *     starts_at >= from − 366 d bounds the scan);
 *   - vehicle capability columns.
 * Every family is keyset-paginated with the PROG4 R1 pager (page 500, ceiling 20 pages); if any family hits the
 * ceiling, coverage is "incomplete" and callers never derive certainty ("clear", "available") from it.
 */

export const TIME_TOOLS: TimeTools = { resolveLocalBoundary, localDateKeyOf, addDaysToDateKey, isoWeekdayOfDateKey };
const MAX_WINDOW_MS = 366 * 86_400_000;
const PAGE = { pageSize: OVERLAP_CANDIDATE_PAGE_SIZE, maxPages: OVERLAP_CANDIDATE_MAX_PAGES };

export interface AvailabilityFacts {
  configured: Set<string>;
  shiftsByDriver: Map<string, WeeklyShift[]>;
  /** Q2: whether ANY driver in the organization has a configured schedule. */
  organizationUsesSchedules: boolean;
  driverWindows: Map<string, TimeWindow[]>;
  vehicleWindows: Map<string, TimeWindow[]>;
  capabilities: Map<string, VehicleCapabilities>;
  coverage: "complete" | "incomplete";
}

type Db = SupabaseClient<Database>;
const hhmm = (t: string) => t.slice(0, 5);
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

async function pagedById<R extends { id: string }>(fetchPage: (afterId: string | null, size: number) => PromiseLike<R[]>) {
  return collectPages<R, string>((cursor, size) => Promise.resolve(fetchPage(cursor, size)), PAGE, (last) => last.id);
}

async function rows<R>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<R[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
  return (data ?? []) as R[];
}

export async function loadAvailabilityFacts(
  organizationId: string,
  fromMs: number,
  toMs: number,
  scope: { driverIds?: string[] | null; vehicleIds?: string[] | null } = {},
  client?: Db,
): Promise<AvailabilityFacts> {
  const supabase = client ?? (await createServerSupabaseClient());
  const driverIds = scope.driverIds === undefined ? null : scope.driverIds;
  const vehicleIds = scope.vehicleIds === undefined ? null : scope.vehicleIds;
  const wantDrivers = driverIds === null || driverIds.length > 0;
  const wantVehicles = vehicleIds === null || vehicleIds.length > 0;
  const lowerIso = new Date(fromMs - MAX_WINDOW_MS).toISOString();
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  type WindowRow = { id: string; resource_id: string; starts_at: string; ends_at: string };
  const windowPages = (table: "driver_unavailability_windows" | "vehicle_unavailability_windows", column: "driver_id" | "vehicle_id", ids: string[] | null) =>
    collectPages<WindowRow, { at: string; id: string }>(
      async (cursor, size) => {
        let q = supabase
          .from(table)
          .select(`id, resource_id:${column}, starts_at, ends_at`)
          .eq("organization_id", organizationId)
          .gte("starts_at", lowerIso)
          .lt("starts_at", toIso)
          .gt("ends_at", fromIso);
        if (ids) q = q.in(column, ids);
        if (cursor) q = q.or(`starts_at.gt."${cursor.at}",and(starts_at.eq."${cursor.at}",id.gt."${cursor.id}")`);
        return rows<WindowRow>(q.order("starts_at", { ascending: true }).order("id", { ascending: true }).limit(size), table);
      },
      PAGE,
      (last) => ({ at: last.starts_at, id: last.id }),
    );

  const [schedules, shifts, anySchedule, dWindows, vWindows, caps] = await Promise.all([
    wantDrivers
      ? collectPages<{ driver_id: string }, string>(
          async (cursor, size) => {
            let q = supabase.from("driver_weekly_schedules").select("driver_id").eq("organization_id", organizationId);
            if (driverIds) q = q.in("driver_id", driverIds);
            if (cursor) q = q.gt("driver_id", cursor);
            return rows(q.order("driver_id", { ascending: true }).limit(size), "driver schedules");
          },
          PAGE,
          (last) => last.driver_id,
        )
      : Promise.resolve({ rows: [], complete: true, pages: 0 }),
    wantDrivers
      ? pagedById<{ id: string; driver_id: string; weekday: number; start_time: string; end_time: string }>((afterId, size) => {
          let q = supabase.from("driver_weekly_shifts").select("id, driver_id, weekday, start_time, end_time").eq("organization_id", organizationId);
          if (driverIds) q = q.in("driver_id", driverIds);
          if (afterId) q = q.gt("id", afterId);
          return rows(q.order("id", { ascending: true }).limit(size), "driver shifts");
        })
      : Promise.resolve({ rows: [], complete: true, pages: 0 }),
    rows<{ driver_id: string }>(supabase.from("driver_weekly_schedules").select("driver_id").eq("organization_id", organizationId).limit(1), "schedule adoption"),
    wantDrivers ? windowPages("driver_unavailability_windows", "driver_id", driverIds) : Promise.resolve({ rows: [] as WindowRow[], complete: true, pages: 0 }),
    wantVehicles ? windowPages("vehicle_unavailability_windows", "vehicle_id", vehicleIds) : Promise.resolve({ rows: [] as WindowRow[], complete: true, pages: 0 }),
    wantVehicles
      ? pagedById<{ id: string; wheelchair_ramp: boolean | null; wheelchair_lift: boolean | null; wheelchair_positions: number | null; seated_capacity: number | null }>((afterId, size) => {
          let q = supabase.from("vehicles").select("id, wheelchair_ramp, wheelchair_lift, wheelchair_positions, seated_capacity").eq("organization_id", organizationId);
          if (vehicleIds) q = q.in("id", vehicleIds);
          if (afterId) q = q.gt("id", afterId);
          return rows(q.order("id", { ascending: true }).limit(size), "vehicle capabilities");
        })
      : Promise.resolve({ rows: [], complete: true, pages: 0 }),
  ]);

  const shiftsByDriver = new Map<string, WeeklyShift[]>();
  for (const s of shifts.rows) push(shiftsByDriver, s.driver_id, { weekday: s.weekday, start: hhmm(s.start_time), end: hhmm(s.end_time) });
  const driverWindows = new Map<string, TimeWindow[]>();
  for (const w of dWindows.rows) push(driverWindows, w.resource_id, { id: w.id, startsAt: Date.parse(w.starts_at), endsAt: Date.parse(w.ends_at) });
  const vehicleWindows = new Map<string, TimeWindow[]>();
  for (const w of vWindows.rows) push(vehicleWindows, w.resource_id, { id: w.id, startsAt: Date.parse(w.starts_at), endsAt: Date.parse(w.ends_at) });
  const capabilities = new Map<string, VehicleCapabilities>();
  for (const v of caps.rows) {
    capabilities.set(v.id, { wheelchairRamp: v.wheelchair_ramp, wheelchairLift: v.wheelchair_lift, wheelchairPositions: v.wheelchair_positions, seatedCapacity: v.seated_capacity });
  }
  const complete = schedules.complete && shifts.complete && dWindows.complete && vWindows.complete && caps.complete;
  if (!complete) console.warn("[availability] fact set incomplete (safety ceiling reached)", { organizationId });
  return {
    configured: new Set(schedules.rows.map((r) => r.driver_id)),
    shiftsByDriver,
    organizationUsesSchedules: anySchedule.length > 0,
    driverWindows,
    vehicleWindows,
    capabilities,
    coverage: complete ? "complete" : "incomplete",
  };
}

// ---------------------------------------------------------------------------
// Per-trip derivation over a loaded fact set
// ---------------------------------------------------------------------------

/** An incomplete fact set never yields "clear" for a window fact. */
const guard = (fact: WindowFact, coverage: AvailabilityFacts["coverage"]): WindowFact => (fact === "clear" && coverage !== "complete" ? "not_checkable" : fact);

/** The span the facts must cover for trips starting in [fromMs, toMs): previous-day overnight + the 48 h ceiling. */
export function factSpanForTrips(fromMs: number, toMs: number): { fromMs: number; toMs: number } {
  return { fromMs: fromMs - 86_400_000, toMs: toMs + MAX_TRIP_SPAN_MS + 86_400_000 };
}

export function driverAvailabilityFor(
  facts: AvailabilityFacts,
  timezone: string,
  driverId: string,
  extent: TripExtent,
  commitmentStatus: DriverTripAvailabilityInputStatus,
): DriverTripAvailability {
  const configured = facts.configured.has(driverId);
  const spanFrom = (extent.startMs ?? Date.now()) - 86_400_000;
  const spanTo = (extent.kind === "known" ? extent.endMs : (extent.startMs ?? Date.now()) + MAX_TRIP_SPAN_MS) + 86_400_000;
  const instances = configured ? expandShiftInstances(facts.shiftsByDriver.get(driverId) ?? [], timezone, spanFrom, spanTo, TIME_TOOLS) : [];
  const base = deriveDriverTripAvailability({
    extent,
    configured,
    instances,
    windows: facts.driverWindows.get(driverId) ?? [],
    commitmentStatus: facts.coverage === "complete" ? commitmentStatus : "not_fully_checkable",
  });
  return { ...base, timeOff: guard(base.timeOff, facts.coverage) };
}
type DriverTripAvailabilityInputStatus = "overlap" | "clear" | "not_checkable" | "not_fully_checkable" | null;

export function vehicleAvailabilityFor(facts: AvailabilityFacts, vehicleId: string, extent: TripExtent, requiresWheelchairAccess: boolean | null): VehicleTripAvailability {
  return {
    outOfService: guard(deriveWindowFact(extent, facts.vehicleWindows.get(vehicleId) ?? []), facts.coverage),
    capability: deriveCapabilityMatch(requiresWheelchairAccess, facts.capabilities.get(vehicleId) ?? null),
  };
}

// ---------------------------------------------------------------------------
// Assignment view (joined into PROG4's AssignmentOverlapView by trip-overlap.ts)
// ---------------------------------------------------------------------------

export interface AvailabilityView {
  driver: { shift: ShiftFact; timeOff: WindowFact } | null;
  vehicle: VehicleTripAvailability | null;
  organizationUsesSchedules: boolean;
  /** The availability fact set could not be proven complete. */
  incomplete: boolean;
}

export async function getAvailabilityView(
  organizationId: string,
  timezone: string,
  extent: TripExtent,
  driverId: string | null,
  vehicleId: string | null,
  requiresWheelchairAccess: boolean | null,
  driverCommitmentStatus: DriverTripAvailabilityInputStatus,
): Promise<AvailabilityView> {
  const anchor = extent.startMs ?? Date.now();
  const span = factSpanForTrips(anchor, anchor);
  const facts = await loadAvailabilityFacts(organizationId, span.fromMs, span.toMs, {
    driverIds: driverId ? [driverId] : [],
    vehicleIds: vehicleId ? [vehicleId] : [],
  });
  const driver = driverId ? driverAvailabilityFor(facts, timezone, driverId, extent, driverCommitmentStatus) : null;
  return {
    driver: driver ? { shift: driver.shift, timeOff: driver.timeOff } : null,
    vehicle: vehicleId ? vehicleAvailabilityFor(facts, vehicleId, extent, requiresWheelchairAccess) : null,
    organizationUsesSchedules: facts.organizationUsesSchedules,
    incomplete: facts.coverage !== "complete",
  };
}

// ---------------------------------------------------------------------------
// Readiness (Tomorrow, Trip Detail, Recurring Care) -- one batched evaluation
// ---------------------------------------------------------------------------

export interface ReadinessAvailabilityInput {
  id: string;
  scheduledPickupAt: string | null;
  expectedDurationMinutes: number | null;
  requiresWheelchairAccess: boolean | null;
  driverId: string | null;
  vehicleId: string | null;
}

export interface TripAvailabilityOutcome {
  reasons: AvailabilityReadinessReason[];
  capability: CapabilityMatch;
  driver: DriverTripAvailability | null;
  vehicle: VehicleTripAvailability | null;
}

/** KNOWN availability problems per assigned trip, from ONE fact load. Unknowns never become reasons. */
export async function getTripAvailabilityOutcomes(
  organizationId: string,
  timezone: string,
  trips: ReadinessAvailabilityInput[],
): Promise<Map<string, TripAvailabilityOutcome>> {
  const out = new Map<string, TripAvailabilityOutcome>();
  const assigned = trips.filter((t) => (t.driverId || t.vehicleId) && t.scheduledPickupAt);
  if (assigned.length === 0) return out;
  const starts = assigned.map((t) => Date.parse(t.scheduledPickupAt as string));
  const span = factSpanForTrips(Math.min(...starts), Math.max(...starts));
  const facts = await loadAvailabilityFacts(organizationId, span.fromMs, span.toMs, {
    driverIds: [...new Set(assigned.map((t) => t.driverId).filter((x): x is string => Boolean(x)))],
    vehicleIds: [...new Set(assigned.map((t) => t.vehicleId).filter((x): x is string => Boolean(x)))],
  });
  for (const t of assigned) {
    const extent = deriveTripExtent(t.scheduledPickupAt, t.expectedDurationMinutes);
    const driver = t.driverId ? driverAvailabilityFor(facts, timezone, t.driverId, extent, null) : null;
    const vehicle = t.vehicleId ? vehicleAvailabilityFor(facts, t.vehicleId, extent, t.requiresWheelchairAccess) : null;
    out.set(t.id, {
      reasons: availabilityReadinessReasons({ driver, vehicle }),
      capability: vehicle?.capability ?? "REQUIREMENT_UNKNOWN",
      driver,
      vehicle,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Management overviews (Drivers / Fleet pages) -- organization-local display values prepared server-side
// ---------------------------------------------------------------------------

export interface ManagedWindow {
  id: string;
  /** Display, organization-local ("Oct 12, 9:00 AM – Oct 12, 5:00 PM" / "Oct 12 – Oct 14 (all day)"). */
  label: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
}

const MANAGE_HORIZON_MS = 366 * 86_400_000;

function managedWindow(w: TimeWindow, timezone: string): ManagedWindow {
  const dateKey = (ms: number) => localDateKeyOf(ms, timezone);
  const time = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(ms));
  const pretty = (ms: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(ms));
  const prettyDate = (key: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const startDate = dateKey(w.startsAt);
  const startTime = time(w.startsAt);
  const endDateRaw = dateKey(w.endsAt);
  const endTime = time(w.endsAt);
  const allDay = startTime === "00:00" && endTime === "00:00";
  const endDate = allDay ? addDaysToDateKey(endDateRaw, -1) : endDateRaw;
  return {
    id: w.id as string,
    label: allDay ? (startDate === endDate ? `${prettyDate(startDate)} (all day)` : `${prettyDate(startDate)} – ${prettyDate(endDate)} (all day)`) : `${pretty(w.startsAt)} – ${pretty(w.endsAt)}`,
    startDate,
    startTime,
    endDate,
    endTime,
    allDay,
  };
}

export interface DriverScheduleOverview {
  configured: boolean;
  shifts: WeeklyShift[];
  /** Current and upcoming time off (windows ending after now, within a year). */
  timeOff: ManagedWindow[];
}

export async function getDriverScheduleOverviews(organizationId: string, timezone: string, driverIds: string[]): Promise<Record<string, DriverScheduleOverview>> {
  const out: Record<string, DriverScheduleOverview> = {};
  if (driverIds.length === 0) return out;
  const now = Date.now();
  const facts = await loadAvailabilityFacts(organizationId, now, now + MANAGE_HORIZON_MS, { driverIds, vehicleIds: [] });
  for (const id of driverIds) {
    out[id] = {
      configured: facts.configured.has(id),
      shifts: (facts.shiftsByDriver.get(id) ?? []).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
      timeOff: (facts.driverWindows.get(id) ?? []).sort((a, b) => a.startsAt - b.startsAt).map((w) => managedWindow(w, timezone)),
    };
  }
  return out;
}

export interface VehicleAvailabilityOverview {
  capabilities: VehicleCapabilities;
  outOfService: ManagedWindow[];
}

export async function getVehicleAvailabilityOverviews(organizationId: string, timezone: string, vehicleIds: string[]): Promise<Record<string, VehicleAvailabilityOverview>> {
  const out: Record<string, VehicleAvailabilityOverview> = {};
  if (vehicleIds.length === 0) return out;
  const now = Date.now();
  const facts = await loadAvailabilityFacts(organizationId, now, now + MANAGE_HORIZON_MS, { driverIds: [], vehicleIds });
  for (const id of vehicleIds) {
    out[id] = {
      capabilities: facts.capabilities.get(id) ?? { wheelchairRamp: null, wheelchairLift: null, wheelchairPositions: null, seatedCapacity: null },
      outOfService: (facts.vehicleWindows.get(id) ?? []).sort((a, b) => a.startsAt - b.startsAt).map((w) => managedWindow(w, timezone)),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Window form input -> instants (organization timezone; DST gaps / ambiguity refused, never guessed)
// ---------------------------------------------------------------------------

export interface WindowFormInput {
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export function windowInputToUtc(input: WindowFormInput, timezone: string): { startsAt: string; endsAt: string } | null {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^\d{2}:\d{2}$/;
  if (!DATE.test(input.startDate) || !DATE.test(input.endDate)) return null;
  const startTime = input.allDay ? "00:00" : input.startTime ?? "";
  const endTime = input.allDay ? "00:00" : input.endTime ?? "";
  if (!TIME.test(startTime) || !TIME.test(endTime)) return null;
  const endDate = input.allDay ? addDaysToDateKey(input.endDate, 1) : input.endDate;
  const s = organizationLocalToUtc({ date: input.startDate, time: startTime }, timezone);
  const e = organizationLocalToUtc({ date: endDate, time: endTime }, timezone);
  if (s.status !== "ok" || e.status !== "ok" || e.utc.getTime() <= s.utc.getTime()) return null;
  return { startsAt: s.utc.toISOString(), endsAt: e.utc.toISOString() };
}

/** Operator-facing message for availability RPC errors (no technical detail). */
export function availabilityErrorMessage(code: string | undefined): string {
  if (code === "ZW006") return "Those times aren't valid (check the order, overlaps, and the one-year limit).";
  if (code === "ZW002" || code === "ZW001") return "This change isn't available to you.";
  if (code === "ZW004") return "This can't be changed anymore.";
  return "Couldn't save the change. Try again.";
}
