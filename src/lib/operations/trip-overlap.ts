import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationLocalToUtc } from "./local-time";
import { loadOverlapCandidates, type CandidateSet } from "./overlap-candidate-loader";
import { getAvailabilityView, type AvailabilityView } from "./availability";
import {
  deriveResourceOverlap,
  deriveTripExtent,
  formatTripExtent,
  isValidExpectedDuration,
  OVERLAP_LOOKBACK_MS,
  type CandidateCoverage,
  type ResourceCheck,
  type ResourceCheckStatus,
  type TripExtent,
} from "./trip-overlap-core";

/**
 * Tenant-scoped overlap candidate reads (P1-OPS-PROG4B, hardened in
 * P1-OPS-PROG4B-R1). Session client only (RLS applies) and every query is
 * explicitly filtered by the server-resolved organization id -- a tenant can
 * never load another tenant's candidates. No service role.
 *
 * Retrieval (three query families, keyset-paginated to exhaustion, with an
 * explicit "incomplete" coverage result at the safety ceiling) lives in
 * overlap-candidate-loader.ts.
 */

export type { CandidateSet } from "./overlap-candidate-loader";

export async function getOverlapCandidates(organizationId: string, fromMs: number, toMs: number): Promise<CandidateSet> {
  const supabase = await createServerSupabaseClient();
  const set = await loadOverlapCandidates(supabase, organizationId, fromMs, toMs, { lookbackMs: OVERLAP_LOOKBACK_MS });
  if (set.coverage !== "complete") {
    // Technical detail for logs only; operators see "Can't fully check", never row counts.
    console.warn("[overlap] candidate set incomplete (safety ceiling reached)", { organizationId, ...set.diagnostics });
  }
  return set;
}

/** Candidate window for one target: its known interval, or (unknown duration) the full ceiling after its start. */
export function targetWindow(extent: TripExtent): { fromMs: number; toMs: number } | null {
  if (extent.kind === "known") return { fromMs: extent.startMs, toMs: extent.endMs };
  if (extent.startMs !== null) return { fromMs: extent.startMs, toMs: extent.startMs + OVERLAP_LOOKBACK_MS };
  return null;
}

export interface OverlapTripView {
  tripId: string;
  extentLabel: string | null;
  route: string;
}

export interface ResourceOverlapView {
  status: ResourceCheckStatus;
  overlaps: OverlapTripView[];
  missingExtentCount: number;
  /** Of missingExtentCount: other assigned trips with no pickup time. */
  missingScheduleCount: number;
  stillOpenCount: number;
  candidateSetIncomplete: boolean;
}

export interface AssignmentOverlapView {
  /** "9:30 AM – 10:15 AM", or null when the target's extent is unknown. */
  targetExtentLabel: string | null;
  targetUnknownReason: "no_schedule" | "no_duration" | null;
  driver: ResourceOverlapView | null;
  vehicle: ResourceOverlapView | null;
  /** P1-OPS-PROG5B -- availability / capability facts for the same target and resources (null when not loaded). */
  availability?: AvailabilityView | null;
}

function viewOf(check: ResourceCheck | null, set: CandidateSet, timezone: string): ResourceOverlapView | null {
  if (!check) return null;
  return {
    status: check.status,
    overlaps: check.overlaps.map((tripId) => {
      const d = set.details.get(tripId);
      return {
        tripId,
        extentLabel: d ? formatTripExtent(deriveTripExtent(d.scheduledPickupAt, d.expectedDurationMinutes), timezone) : null,
        route: d ? `${d.pickup} → ${d.destination}` : "",
      };
    }),
    missingExtentCount: check.missingExtent.length,
    missingScheduleCount: check.missingSchedule.length,
    stillOpenCount: check.stillOpenPastPlannedEnd.length,
    candidateSetIncomplete: check.candidateSetIncomplete,
  };
}

export type OverlapTargetInput =
  | { kind: "trip"; tripId: string }
  | { kind: "date"; dateKey: string; pickupTime?: string | null; expectedDurationMinutes?: number | null; requiresWheelchairAccess?: boolean | null };

const EMPTY_DIAGNOSTICS: CandidateSet["diagnostics"] = {
  windowRows: 0,
  windowPages: 0,
  windowComplete: true,
  stillOpenRows: 0,
  stillOpenPages: 0,
  stillOpenComplete: true,
  schedulelessRows: 0,
  schedulelessPages: 0,
  schedulelessComplete: true,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Overlap facts for a proposed or current assignment: the target Trip (or a
 * New Trip's date + time + duration) checked against the selected driver /
 * vehicle. Warning-only -- nothing here is used to allow or refuse a
 * mutation.
 */
export async function getAssignmentOverlap(
  organizationId: string,
  timezone: string,
  target: OverlapTargetInput,
  driverId: string | null,
  vehicleId: string | null,
  nowMs: number = Date.now(),
): Promise<AssignmentOverlapView | null> {
  if ((driverId && !UUID_PATTERN.test(driverId)) || (vehicleId && !UUID_PATTERN.test(vehicleId))) return null;
  let tripId: string | null = null;
  let scheduledPickupAt: string | null = null;
  let expectedDurationMinutes: number | null = null;
  let requiresWheelchairAccess: boolean | null = null;

  if (target.kind === "trip") {
    if (!UUID_PATTERN.test(target.tripId)) return null;
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("trips")
      .select("id, scheduled_pickup_at, expected_duration_minutes, requires_wheelchair_access")
      .eq("organization_id", organizationId)
      .eq("id", target.tripId)
      .maybeSingle();
    if (error || !data) return null;
    tripId = data.id;
    scheduledPickupAt = data.scheduled_pickup_at;
    expectedDurationMinutes = data.expected_duration_minutes;
    requiresWheelchairAccess = data.requires_wheelchair_access;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target.dateKey)) return null;
    if (target.pickupTime && /^\d{2}:\d{2}$/.test(target.pickupTime)) {
      const conversion = organizationLocalToUtc({ date: target.dateKey, time: target.pickupTime }, timezone);
      scheduledPickupAt = conversion.status === "ok" ? conversion.utc.toISOString() : null;
    }
    const minutes = target.expectedDurationMinutes ?? null;
    expectedDurationMinutes = minutes !== null && isValidExpectedDuration(minutes) ? minutes : null;
    requiresWheelchairAccess = typeof target.requiresWheelchairAccess === "boolean" ? target.requiresWheelchairAccess : null;
  }

  const extent = deriveTripExtent(scheduledPickupAt, expectedDurationMinutes);
  const window = targetWindow(extent);
  const set: CandidateSet = window
    ? await getOverlapCandidates(organizationId, window.fromMs, window.toMs)
    : // No pickup time: nothing can be placed in time, so no candidates are needed (the target itself is unknown).
      { candidates: [], details: new Map(), coverage: "complete", diagnostics: EMPTY_DIAGNOSTICS };
  const result = deriveResourceOverlap(
    { tripId, scheduledPickupAt, expectedDurationMinutes, driverId, vehicleId },
    set.candidates,
    nowMs,
    set.coverage,
  );
  // P1-OPS-PROG5B: availability / capability for the SAME target + selected resources (one batched load; the PROG4
  // driver result is passed in so "available" can never be claimed without clear commitments).
  const availability = await getAvailabilityView(
    organizationId,
    timezone,
    result.targetExtent,
    driverId,
    vehicleId,
    requiresWheelchairAccess,
    result.driver?.status ?? null,
  );
  return {
    targetExtentLabel: formatTripExtent(result.targetExtent, timezone),
    targetUnknownReason: result.targetExtent.kind === "unknown" ? result.targetExtent.reason : null,
    driver: viewOf(result.driver, set, timezone),
    vehicle: viewOf(result.vehicle, set, timezone),
    availability,
  };
}

/**
 * Trip ids (of `targets`) with a KNOWN overlap on their current driver or vehicle, from ONE candidate set for
 * the window -- used for the Tomorrow page's neutral badge. Never a readiness input. `coverage` is "incomplete"
 * when the candidate set could not be proven complete: the absence of a badge then proves nothing.
 */
export async function getKnownOverlapTripIds(
  organizationId: string,
  window: { fromMs: number; toMs: number },
  targets: { id: string; scheduledPickupAt: string | null; expectedDurationMinutes: number | null; driverId: string | null; vehicleId: string | null }[],
  nowMs: number = Date.now(),
): Promise<{ tripIds: Set<string>; coverage: CandidateCoverage }> {
  const assigned = targets.filter((t) => t.driverId || t.vehicleId);
  const result = new Set<string>();
  if (assigned.length === 0) return { tripIds: result, coverage: "complete" };
  const set = await getOverlapCandidates(organizationId, window.fromMs, window.toMs);
  for (const t of assigned) {
    const r = deriveResourceOverlap(
      { tripId: t.id, scheduledPickupAt: t.scheduledPickupAt, expectedDurationMinutes: t.expectedDurationMinutes, driverId: t.driverId, vehicleId: t.vehicleId },
      set.candidates,
      nowMs,
      set.coverage,
    );
    if (r.driver?.status === "overlap" || r.vehicle?.status === "overlap") result.add(t.id);
  }
  return { tripIds: result, coverage: set.coverage };
}
