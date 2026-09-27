/**
 * Pure, framework-free evidence-normalization helpers for Proof-of-Service
 * Assurance (P1-E3-S1C). Deliberately separate from
 * `trip-proof-of-service-core.ts` (S1B, LOCKED — not modified by this
 * phase): the core takes already-normalized booleans
 * (`hasCompleteLifecycleEventChain`, `hasCompletionAssignment`,
 * `completionAssignmentVehicleId`) and makes the READY_FOR_REVIEW /
 * NEEDS_REVIEW / reasons decision; this module does the narrower, purely
 * mechanical job of turning RAW `trip_events`/`trip_assignments` row
 * shapes into those specific booleans, so that translation logic is
 * itself unit-testable without a database and without duplicating any
 * business decision the S1B core already owns (S1C §2's own explicit
 * "do not reimplement Proof-of-Service logic in the query layer").
 *
 * No runtime import of any kind (no Supabase, no `server-only`, no React)
 * — mirrors `trip-proof-of-service-core.ts`'s own pure-module convention.
 */

/**
 * The exact 6 forward lifecycle transition event types the state machine
 * requires for any Trip to have legitimately reached `completed`
 * (`_is_valid_trip_transition`,
 * supabase/migrations/20260831100200_controlled_trip_mutations.sql). In
 * this fixed order — the same order the state machine itself enforces,
 * used both for exactly-once-membership checking and for the
 * monotonic-timestamp check below.
 */
export const REQUIRED_LIFECYCLE_EVENT_TYPES = [
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
  "trip_completed",
] as const;

export type RequiredLifecycleEventType = (typeof REQUIRED_LIFECYCLE_EVENT_TYPES)[number];

const REQUIRED_EVENT_TYPE_SET: ReadonlySet<string> = new Set(REQUIRED_LIFECYCLE_EVENT_TYPES);

/**
 * P1-PILOT-R2C: the one Operations provenance event for a completion recorded because the Driver could not complete
 * the Trip in Nemryn (`record_trip_completion_by_operations`). It is NOT a Driver lifecycle event and never counts as
 * one of the 6 required types above.
 */
export const COMPLETION_RECORDED_BY_OPERATIONS_EVENT_TYPE = "completion_recorded_by_operations";

/** Every `trip_events` type the Proof-of-Service loaders read: the 6 Driver lifecycle types + the recovery event. */
export const PROOF_OF_SERVICE_EVENT_TYPES: readonly string[] = [...REQUIRED_LIFECYCLE_EVENT_TYPES, COMPLETION_RECORDED_BY_OPERATIONS_EVENT_TYPE];

/**
 * One raw `trip_events` row's minimal shape — never the full row (no `actor_user_id`; `event_type` + `occurred_at`,
 * plus, for the recovery event ONLY, the two structural metadata facts its RPC writes). No note is ever carried: the
 * recovery note lives only in `audit_events.reason` and is never in `trip_events` at all.
 */
export interface LifecycleEventFact {
  eventType: string;
  occurredAt: string;
  /** Recovery event only: `metadata.previous_state` (the state Operations completed the Trip from). */
  previousState?: string | null;
  /** Recovery event only: `metadata.recorded_completed_at` (the operator-stated completion time). */
  recordedCompletedAt?: string | null;
}

/**
 * Whether a completed Trip's `trip_events` history structurally satisfies
 * every requirement Proof-of-Service Assurance needs before treating the
 * lifecycle chain as trustworthy evidence (S1C §14-§17):
 *
 *   1. Every one of the 6 `REQUIRED_LIFECYCLE_EVENT_TYPES` appears EXACTLY
 *      ONCE — both a missing required event AND a DUPLICATE required
 *      event fail this check (S1C §15: this repository's mutation
 *      architecture only ever writes one `trip_events` row per legal
 *      single-edge transition per Trip — transitions are strictly forward
 *      and no terminal state is ever revisited — but no UNIQUE(trip_id,
 *      event_type) database constraint actually enforces this, so a
 *      duplicate here is treated as a genuine data-integrity anomaly,
 *      never silently accepted as "the same fact twice").
 *   2. The 6 required events' own `occurred_at` timestamps are
 *      monotonically non-decreasing in the fixed state-machine order
 *      (S1C §16) — a chain whose timestamps are out of order is not
 *      silently re-sorted and declared valid; it is treated as
 *      inconsistent evidence.
 *   3. The `trip_completed` event's own `occurred_at` exactly equals the
 *      supplied `completedAt` (S1C §17). This is INTENTIONALLY an exact
 *      equality check, not a tolerance window: both values are written by
 *      the SAME statement-set inside `_driver_execute_trip_transition`'s
 *      single transaction (`update trips set completed_at = ... now() ...`
 *      immediately followed, in the same function invocation, by
 *      `insert into trip_events (...) values (..., default now())`) —
 *      confirmed directly against that function's source, not assumed.
 *      Postgres's own `now()` is `transaction_timestamp()`, constant for
 *      every statement within one transaction — never `clock_timestamp()`
 *      (which WOULD legitimately drift statement-to-statement). Because
 *      this specific pair of writes is structurally guaranteed to share
 *      one transaction-start instant for any Trip completed through the
 *      one real completion path, exact equality is a safe, meaningful
 *      integrity signal here — not a "false failure waiting to happen."
 *
 * Any OTHER event type present in `events` (`driver_assigned`,
 * `note_added`, `exception_flagged`, ...) is silently ignored — this
 * function only ever reasons about the 6 required types.
 *
 * `completedAt === null` short-circuits to `false` defensively — the
 * caller (the S1B core) already independently fails closed on a null
 * `completedAt` via its own `EVIDENCE_INTEGRITY_GAP` rule, so this is
 * redundant-but-harmless, never contradictory.
 */
export function evaluateLifecycleEventChain(events: LifecycleEventFact[], completedAt: string | null): boolean {
  if (completedAt === null) return false;

  const byType = new Map<string, LifecycleEventFact[]>();
  for (const event of events) {
    if (!REQUIRED_EVENT_TYPE_SET.has(event.eventType)) continue;
    const existing = byType.get(event.eventType);
    if (existing) {
      existing.push(event);
    } else {
      byType.set(event.eventType, [event]);
    }
  }

  for (const type of REQUIRED_LIFECYCLE_EVENT_TYPES) {
    const matches = byType.get(type);
    if (!matches || matches.length !== 1) {
      // Missing (undefined) or duplicated (length > 1) — both fail.
      return false;
    }
  }

  const orderedTimestamps = REQUIRED_LIFECYCLE_EVENT_TYPES.map((type) => Date.parse(byType.get(type)![0].occurredAt));
  for (let i = 1; i < orderedTimestamps.length; i++) {
    if (orderedTimestamps[i] < orderedTimestamps[i - 1]) return false;
  }

  const completedEventAt = byType.get("trip_completed")![0].occurredAt;
  if (Date.parse(completedEventAt) !== Date.parse(completedAt)) return false;

  return true;
}

/**
 * Extracts each required event type's own `occurred_at`, for the
 * SUPPORTING TIMESTAMPS context a later Proof-of-Service detail/document
 * presentation may want (S1C §22) — deliberately independent of, and
 * never consulted by, `evaluateLifecycleEventChain` above (which only
 * returns a single boolean the S1B core consumes). `null` for any event
 * type that is missing OR duplicated (in the duplicated case, exposing
 * either candidate timestamp as authoritative would misrepresent
 * genuinely inconsistent evidence as clean).
 */
export function extractLifecycleEventTimestamps(
  events: LifecycleEventFact[],
): Record<RequiredLifecycleEventType, string | null> {
  const byType = new Map<string, LifecycleEventFact[]>();
  for (const event of events) {
    if (!REQUIRED_EVENT_TYPE_SET.has(event.eventType)) continue;
    const existing = byType.get(event.eventType);
    if (existing) {
      existing.push(event);
    } else {
      byType.set(event.eventType, [event]);
    }
  }

  const result = {} as Record<RequiredLifecycleEventType, string | null>;
  for (const type of REQUIRED_LIFECYCLE_EVENT_TYPES) {
    const matches = byType.get(type);
    result[type] = matches && matches.length === 1 ? matches[0].occurredAt : null;
  }
  return result;
}

/** The 3-way classification a completion-assignment lookup can genuinely land on (S1C §11) — never silently collapsed to a boolean. */
export type CompletionAssignmentCardinality = "none" | "one" | "multiple";

/**
 * Classifies how many `trip_assignments` rows were found for one Trip
 * with `end_reason = 'trip_completed'` — the ONE authoritative filter
 * this phase (and the S1A audit before it) established for "the
 * performing assignment" (S1C §10). `0` means no completion assignment
 * exists (an integrity gap — a Trip cannot legitimately reach `completed`
 * without one, since `driver_complete_trip` always closes the active
 * assignment with exactly this `end_reason` in the same transaction).
 * `1` is the only cardinality a valid completed Trip can genuinely have.
 * `>1` is NEVER silently resolved by picking the first/most-recent row —
 * multiple rows sharing this `end_reason` for the same Trip is itself
 * corrupted historical data (S1C §11's own explicit "do not mask
 * corrupted historical data" instruction), surfaced as `"multiple"` so
 * the caller can feed the S1B core `hasCompletionAssignment: false`
 * exactly as it would for zero rows, and present no driver/vehicle
 * identity rather than an arbitrarily-chosen one.
 */
export function classifyCompletionAssignmentCardinality(matchingRowCount: number): CompletionAssignmentCardinality {
  if (matchingRowCount === 0) return "none";
  if (matchingRowCount === 1) return "one";
  return "multiple";
}

// =============================================================================
// P1-PILOT-R2C (PR-02) -- completion recorded by Operations.
// =============================================================================

/** The Driver lifecycle events that must really exist before a recovery from each eligible state (the RPC's own set). */
const RECOVERY_PRIOR_DRIVER_EVENTS: Record<string, readonly RequiredLifecycleEventType[]> = {
  passenger_onboard: ["en_route_to_pickup", "arrived_at_pickup", "passenger_onboard"],
  en_route_to_destination: ["en_route_to_pickup", "arrived_at_pickup", "passenger_onboard", "en_route_to_destination"],
  arrived_at_destination: [
    "en_route_to_pickup",
    "arrived_at_pickup",
    "passenger_onboard",
    "en_route_to_destination",
    "arrived_at_destination",
  ],
};

/**
 * The recovery chain rule (R2A spec section 20), replacing the 6-event rule ONLY for a Trip whose completion was
 * recorded by Operations. The missing Driver steps are never expected (they must not be fabricated), so the rule is:
 *
 *   1. exactly ONE `completion_recorded_by_operations` event;
 *   2. `trip_completed` is ABSENT (a Driver completion and an Operations completion can not both be true);
 *   3. the recovery's `previous_state` is one of the three eligible states, and exactly the Driver events up to it
 *      exist -- each exactly once -- and NONE after it;
 *   4. those Driver events are in state-machine order (non-decreasing) and all at or before the recovery event;
 *   5. the recorded completion time equals `completedAt` and is not before the last Driver event (the RPC's own
 *      no-time-travel rule).
 *
 * Any violation fails closed (the caller surfaces EVIDENCE_INTEGRITY_GAP).
 */
export function evaluateRecoveredLifecycleEventChain(events: LifecycleEventFact[], completedAt: string | null): boolean {
  if (completedAt === null) return false;

  const recoveries = events.filter((e) => e.eventType === COMPLETION_RECORDED_BY_OPERATIONS_EVENT_TYPE);
  if (recoveries.length !== 1) return false;
  const recovery = recoveries[0];

  const byType = new Map<string, LifecycleEventFact[]>();
  for (const event of events) {
    if (!REQUIRED_EVENT_TYPE_SET.has(event.eventType)) continue;
    byType.set(event.eventType, [...(byType.get(event.eventType) ?? []), event]);
  }
  if (byType.has("trip_completed")) return false;

  const prior = recovery.previousState ? RECOVERY_PRIOR_DRIVER_EVENTS[recovery.previousState] : undefined;
  if (!prior) return false;
  for (const type of REQUIRED_LIFECYCLE_EVENT_TYPES) {
    const count = byType.get(type)?.length ?? 0;
    if (count !== (prior.includes(type) ? 1 : 0)) return false;
  }

  const priorTimes = prior.map((type) => Date.parse(byType.get(type)![0].occurredAt));
  for (let i = 1; i < priorTimes.length; i++) {
    if (priorTimes[i] < priorTimes[i - 1]) return false;
  }
  const lastDriverAt = priorTimes[priorTimes.length - 1];
  if (lastDriverAt > Date.parse(recovery.occurredAt)) return false;

  if (!recovery.recordedCompletedAt || Date.parse(recovery.recordedCompletedAt) !== Date.parse(completedAt)) return false;
  if (Date.parse(completedAt) < lastDriverAt) return false;

  return true;
}

/**
 * The two Proof-of-Service facts derived from one Trip's events. A Trip with no recovery event is evaluated EXACTLY as
 * before (the unchanged 6-event rule). Any recovery event -- even a duplicated one -- marks the completion as recorded
 * by Operations, and the recovery rule above decides the chain (duplicates fail it).
 */
export function evaluateProofOfServiceEvents(
  events: LifecycleEventFact[],
  completedAt: string | null,
): { completionRecordedByOperations: boolean; hasCompleteLifecycleEventChain: boolean } {
  const recovered = events.some((e) => e.eventType === COMPLETION_RECORDED_BY_OPERATIONS_EVENT_TYPE);
  return recovered
    ? { completionRecordedByOperations: true, hasCompleteLifecycleEventChain: evaluateRecoveredLifecycleEventChain(events, completedAt) }
    : { completionRecordedByOperations: false, hasCompleteLifecycleEventChain: evaluateLifecycleEventChain(events, completedAt) };
}

/** Driver milestones that actually exist (Driver lifecycle types before completion, in state-machine order) -- for presentation only. */
export function driverRecordedMilestones(events: LifecycleEventFact[]): RequiredLifecycleEventType[] {
  const present = new Set(events.map((e) => e.eventType));
  return REQUIRED_LIFECYCLE_EVENT_TYPES.filter((type) => type !== "trip_completed" && present.has(type));
}
