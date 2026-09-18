/**
 * Pure, framework-free Operations Brief derivation helpers (P1-E1-S1B).
 *
 * Deliberately has NO `server-only`/database import, and deliberately no
 * RUNTIME import of any kind (only `import type`, fully erased) — mirrors
 * src/lib/app-url-core.ts's established split (a pure core + a
 * server-only wrapper, operations-brief.ts) so the 2-hour-window,
 * attention-dedup, day-state, and driver-snapshot-counting logic here can
 * be unit-tested directly with Node's test runner (loaded as a bare `.ts`
 * file, with no bundler to resolve extensionless sibling imports), without
 * a database or Next.js server context, and so `now` is always an
 * explicit parameter rather than a `new Date()` scattered through
 * filtering logic (deterministic boundary testing).
 *
 * This module composes and derives — it never re-implements trip
 * assurance (src/lib/operations/trip-assurance.ts) or the trip lifecycle
 * (src/lib/operations/presentation.ts's `isActiveTripState`). Both are
 * consumed via their already-computed results (attentionItems, activeTrips,
 * and — for the one genuinely new driver-snapshot number — a pre-
 * classified `isActiveState` boolean computed by the server-only wrapper,
 * which calls `isActiveTripState` directly); nothing here re-derives what
 * counts as an attention condition or an active lifecycle state.
 */

import type { TodaysOperationsData, TodaysOperationsTrip, TodaysOperationsAttentionItem } from "./todays-operations";

/**
 * NO_TRIPS: `todayTrips.length === 0` — nothing scheduled today at all.
 * ALL_COMPLETE: today had at least one trip and EVERY one of them is
 *   `completed` — a genuinely finished day. A day that also contains a
 *   `cancelled`/`no_show` trip is deliberately NOT this state (those are
 *   real terminal outcomes, but "every trip completed" is a specific,
 *   different claim this state must not misrepresent).
 * ACTIVE_DAY: everything else — today has trips that are not (all)
 *   completed, whether scheduled, in progress, or a mix including a
 *   cancellation/no-show alongside completions.
 */
export type OperationsBriefDayState = "NO_TRIPS" | "ALL_COMPLETE" | "ACTIVE_DAY";

/** Next Departures window — 2 hours, inclusive of both boundaries (see deriveNextDepartures's own doc comment for exact semantics). */
const NEXT_DEPARTURES_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface OperationsBriefDriverSnapshot {
  /** `drivers.status = 'active'` count for the organization — never "available" (no such schema concept exists, P1-E1-S1A §5). */
  totalActiveDrivers: number;
  /** Distinct active drivers holding a currently-active (`ended_at IS NULL`) assignment on a trip whose lifecycle state is one of the 5 real in-progress states (`isActiveTripState`) — never inferred from "has any assignment today." */
  driversCurrentlyOnTrip: number;
}

/**
 * Requests awaiting review (P1-E1-S2G). The exact same "Pending queue"
 * definition Request Hub itself uses (`transportation_requests` where
 * `organization_id = <current org>` and `state = 'pending'` —
 * requests-list.ts's own `getRequestsList` pendingCount query, never a
 * second interpretation of what "pending" means). `pendingRequestCount`
 * is the org's real total pending count, not merely "however many are on
 * some page." `oldestPendingRequestCreatedAt` is the `created_at` of the
 * single oldest pending Request (matches the Pending queue's own locked
 * `created_at ASC` ordering, requests-list.ts §8) — null only when
 * `pendingRequestCount === 0`, never fabricated.
 */
export interface OperationsBriefRequestSummary {
  pendingRequestCount: number;
  oldestPendingRequestCreatedAt: string | null;
}

/**
 * Compact Tomorrow Readiness summary for Operations Brief (P1-E1-S4E).
 * Deliberately just 3 counts — never the full `TomorrowReadinessData`
 * (never its `items` list, never `timezone`/`tomorrowStartUtc`, which
 * this compact block does not need — S4E §3/§14's own explicit "the
 * Brief does not need every Trip row" / "omit a literal date if it does
 * not materially improve the compact block" instructions). Sourced
 * ENTIRELY from S4C/S4C1's already-authoritative `getTomorrowReadiness`
 * — this pure module never queries Trips or re-evaluates readiness
 * itself; it only narrows an already-computed result down to what this
 * one compact block actually renders.
 */
export interface OperationsBriefTomorrowSummary {
  totalScheduledTrips: number;
  readyCount: number;
  needsPreparationCount: number;
}

/**
 * Compact Recurring Care summary for Operations Brief (P1-E2-S1F).
 * Answers exactly one question: "Which expected recurring occurrences do
 * not yet have qualifying Trips?" — never Trip Readiness reasons, open
 * Trip exceptions, Driver/Vehicle inactivity, or today's execution
 * problems (all already owned by other Operations Brief blocks, §2's own
 * explicit exclusion list). No occurrence list, no Passenger list, no
 * score, no percentage, no adherence metric — just 4 plain facts.
 * `nextMissingDate` is an already-resolved LOCAL SERVICE DATE string
 * (`YYYY-MM-DD`, from the authoritative per-arrangement evaluator's own
 * timezone resolution) — never re-interpreted through any timezone here
 * or in the component that renders it.
 */
export interface OperationsBriefRecurringCareSummary {
  activeArrangementCount: number;
  missingOccurrenceCount: number;
  arrangementsWithMissingCount: number;
  nextMissingDate: string | null;
}

/**
 * Minimal structural input for `deriveRecurringCareSummary` — deliberately
 * NOT an import of `RecurringArrangementListRow`/`RecurringArrangement
 * Assurance` (recurring-care-list.ts/recurring-care.ts), matching this
 * file's own "no runtime import of any kind" charter (see this file's
 * header comment) exactly: the server-only wrapper (operations-brief.ts)
 * narrows its own already-fetched, already-authoritative rows down to
 * this shape before calling in here. `assurance` is `null` only for an
 * arrangement the evaluator's own coarse near-horizon filter excluded
 * (recurring-care-list.ts) — such a row never contributes to the summary
 * either way, exactly like a genuinely paused/ended row's own exclusion
 * below.
 */
export interface RecurringCareSummaryRow {
  status: string;
  assurance: { missingCount: number; nextMissingDate: string | null } | null;
}

/**
 * Reduces already-fetched, already-authoritative per-arrangement
 * assurance facts down to the Brief's own 4-field summary. Pure
 * aggregation only — every date/weekday/timezone/satisfaction rule that
 * decided each row's own `missingCount`/`nextMissingDate` already ran
 * inside the S1C evaluator (recurring-care-core.ts) before this function
 * ever sees the result; this function never re-derives or second-guesses
 * any of it (P1-E2-S1F §4/§18 — "No second weekday/date evaluator").
 *
 * ACTIVE-ONLY (§5): a paused or ended arrangement's own row is completely
 * excluded from every count, regardless of its own `missingCount` — a
 * standing commitment that has been deliberately paused or ended is
 * never "unattended work." Both remain fully visible in the Recurring
 * Care workspace itself; this Brief summary simply never counts them.
 *
 * SKIPPED/READINESS/CANCELLED (§10/§11/§12) require no special-case logic
 * here at all — the evaluator's own `missingCount` already excludes a
 * SKIPPED date, already excludes a SCHEDULED (Trip-created) date
 * regardless of that Trip's own Readiness state, and already includes a
 * date whose only linked Trip is cancelled (since a cancelled Trip never
 * satisfies an occurrence). This function only ever sums/counts whatever
 * `missingCount` the evaluator already decided.
 */
export function deriveRecurringCareSummary(rows: RecurringCareSummaryRow[]): OperationsBriefRecurringCareSummary {
  const activeRows = rows.filter((row) => row.status === "active");

  let missingOccurrenceCount = 0;
  let arrangementsWithMissingCount = 0;
  let nextMissingDate: string | null = null;

  for (const row of activeRows) {
    if (!row.assurance) continue;
    missingOccurrenceCount += row.assurance.missingCount;
    if (row.assurance.missingCount > 0) {
      arrangementsWithMissingCount += 1;
      if (row.assurance.nextMissingDate !== null && (nextMissingDate === null || row.assurance.nextMissingDate < nextMissingDate)) {
        nextMissingDate = row.assurance.nextMissingDate;
      }
    }
  }

  return {
    activeArrangementCount: activeRows.length,
    missingOccurrenceCount,
    arrangementsWithMissingCount,
    nextMissingDate,
  };
}

export interface OperationsBriefData {
  dayState: OperationsBriefDayState;
  totalTripsToday: number;
  /** Pass-through of getTodaysOperations().attentionItems — same objects, same deterministic priority order (trip-assurance.ts's evaluator + todays-operations.ts's own PRIORITY_RANK sort). Never re-sorted or re-evaluated here. */
  attention: TodaysOperationsAttentionItem[];
  /** Pass-through of getTodaysOperations().activeTrips — no new lifecycle concept (delayed/late/at-risk/on-time) is introduced. */
  activeNow: TodaysOperationsTrip[];
  /** Derived subset of todayTrips: state='scheduled', not already present in `attention`, scheduled_pickup_at within [now, now+2h]. See deriveNextDepartures. */
  nextDepartures: TodaysOperationsTrip[];
  /** Count only (P1-E1-S1A §11's own resolved ambiguity) — every unassigned trip already appears as its own row inside `attention` via the NEEDS_ASSIGNMENT assurance code; this is deliberately NOT a second row collection. */
  unassignedCount: number;
  driverSnapshot: OperationsBriefDriverSnapshot;
  requestSummary: OperationsBriefRequestSummary;
  /**
   * `null` only when the underlying `getTomorrowReadiness` fetch
   * genuinely failed (P1-E1-S4E §11) — never used to represent "zero
   * trips scheduled tomorrow," which is a real, distinct, successfully-
   * fetched `{ totalScheduledTrips: 0, ... }` value. Mirrors
   * `RequestActivityPanel`'s own established `events: T[] | null`
   * failure-vs-empty convention exactly (src/components/operations/
   * requests/RequestActivityPanel.tsx).
   */
  tomorrowReadiness: OperationsBriefTomorrowSummary | null;
  /**
   * `null` only when the underlying Recurring Care fetch genuinely failed
   * (P1-E2-S1F §17) — never used to represent "no active arrangements"
   * or "nothing missing," both of which are real, successfully-fetched
   * `{ activeArrangementCount: 0, ... }` / `{ missingOccurrenceCount: 0,
   * ... }` values. Mirrors `tomorrowReadiness`'s own established
   * null-on-failure convention exactly.
   */
  recurringCare: OperationsBriefRecurringCareSummary | null;
}

/** See OperationsBriefDayState's own doc comment for the exact rule each branch implements. */
export function computeDayState(todayTrips: TodaysOperationsTrip[]): OperationsBriefDayState {
  if (todayTrips.length === 0) return "NO_TRIPS";
  return todayTrips.every((trip) => trip.state === "completed") ? "ALL_COMPLETE" : "ACTIVE_DAY";
}

/**
 * Next Departures: `state='scheduled'` trips whose `scheduledPickupAt`
 * falls in `[now, now + 2h]` — BOTH boundaries inclusive (a trip
 * departing at exactly `now`, or at exactly `now + 2h`, is included; one
 * second earlier or later is not). A trip with no `scheduledPickupAt` at
 * all is excluded (there is no time to window against). Excludes any
 * trip whose id already appears in `attentionTripIds` — the de-dup rule:
 * a trip already surfaced via Needs Attention is never echoed a second
 * time here. Application-level filtering only — `todayTrips` is already
 * fetched and already ordered ascending by scheduled_pickup_at
 * (getTodaysOperations' own query order), and filtering preserves that
 * relative order; no new query, no new sort.
 */
export function deriveNextDepartures(
  todayTrips: TodaysOperationsTrip[],
  attentionTripIds: ReadonlySet<string>,
  now: Date,
): TodaysOperationsTrip[] {
  const nowMs = now.getTime();
  const windowEndMs = nowMs + NEXT_DEPARTURES_WINDOW_MS;
  return todayTrips.filter((trip) => {
    if (trip.state !== "scheduled") return false;
    if (attentionTripIds.has(trip.id)) return false;
    if (!trip.scheduledPickupAt) return false;
    const pickupMs = new Date(trip.scheduledPickupAt).getTime();
    if (Number.isNaN(pickupMs)) return false;
    return pickupMs >= nowMs && pickupMs <= windowEndMs;
  });
}

/**
 * One `trip_assignments` row (already `ended_at IS NULL`-filtered by the
 * caller), reduced to exactly what driver-snapshot counting needs.
 * `isActiveState` is deliberately a pre-computed boolean, not a raw
 * `tripState` string classified in here — the classification itself
 * (which lifecycle states count as "active") is presentation.ts's own
 * `isActiveTripState`, called once by the server-only wrapper
 * (operations-brief.ts) that already has the real trip state in hand.
 * This keeps this pure module free of any lifecycle-classification
 * import (this file has no runtime import from anywhere else in the
 * repository, by design — see this file's own header comment), while
 * the classification itself still flows through the ONE shared function,
 * never re-derived here.
 */
export interface DriverAssignmentStateRow {
  driverId: string;
  isActiveState: boolean;
}

/**
 * Distinct count of drivers currently on an active-state trip, from a set
 * of already-active (`ended_at IS NULL`) assignment rows already
 * classified by the caller (see DriverAssignmentStateRow's own doc
 * comment). A `Set` keyed by driverId defensively collapses the
 * (currently believed impossible, but not schema-enforced) case of one
 * driver holding two simultaneous active assignments on two different
 * trips, so such a driver is still only ever counted once.
 */
export function countDriversCurrentlyOnTrip(rows: DriverAssignmentStateRow[]): number {
  const onTrip = new Set<string>();
  for (const row of rows) {
    if (row.isActiveState) {
      onTrip.add(row.driverId);
    }
  }
  return onTrip.size;
}

/**
 * Compose the full OperationsBriefData from an already-fetched
 * TodaysOperationsData (never re-fetched or re-derived here) and an
 * already-fetched driver snapshot. Pure — no I/O, no `new Date()` inside;
 * `now` is always the caller's own already-resolved instant.
 */
export function deriveOperationsBrief(
  data: TodaysOperationsData,
  driverSnapshot: OperationsBriefDriverSnapshot,
  requestSummary: OperationsBriefRequestSummary,
  tomorrowReadiness: OperationsBriefTomorrowSummary | null,
  recurringCare: OperationsBriefRecurringCareSummary | null,
  now: Date,
): OperationsBriefData {
  const attentionTripIds = new Set(data.attentionItems.map((item) => item.trip.id));

  return {
    dayState: computeDayState(data.todayTrips),
    totalTripsToday: data.todayTrips.length,
    attention: data.attentionItems,
    activeNow: data.activeTrips,
    nextDepartures: deriveNextDepartures(data.todayTrips, attentionTripIds, now),
    unassignedCount: data.needsAssignmentTrips.length,
    driverSnapshot,
    requestSummary,
    tomorrowReadiness,
    recurringCare,
  };
}
