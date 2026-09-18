/**
 * Pure, framework-free Proof-of-Service Assurance derivation (P1-E3-S1B,
 * following the P1-E3-S1A foundation audit —
 * docs/reports/p1-e3-s1a-revenue-assurance-foundation-audit.txt).
 *
 * Deliberately has NO runtime import of any kind — no Supabase, no
 * `server-only`, no React, no date/time I/O beyond the facts supplied by
 * the caller — mirroring `trip-readiness-core.ts`'s own established
 * pure-core convention exactly, so this logic is directly unit-testable
 * with Node's test runner, with no bundler and no database.
 *
 * Proof-of-Service Assurance answers exactly one question: "for a
 * COMPLETED Trip, does Nemryn possess the operational evidence it
 * requires before an operator moves that Trip into billing review?" It
 * is a DERIVED operational evidence evaluator, never a new Trip lifecycle
 * state, never persisted, never written back anywhere. It is explicitly
 * NOT a billing status, NOT a claim status, NOT a payer-compliance
 * status, NOT an invoice/payment state, and NOT a revenue amount or
 * financial score — no monetary fact of any kind is consumed here (none
 * currently exists in this schema — see the S1A audit's own CURRENT
 * FINANCIAL MODEL finding).
 *
 * RELATIONSHIP TO TRIP ASSURANCE (`trip-assurance.ts`, NOT modified, NOT
 * duplicated): Trip Assurance owns live/non-terminal execution — "does
 * this Trip need attention RIGHT NOW, while it is still underway."
 * Proof-of-Service Assurance owns the COMPLEMENT — it only ever evaluates
 * Trips that have ALREADY reached `completed`; every other state
 * (scheduled, every in-progress state, cancelled, no_show) is
 * NOT_APPLICABLE here. Both modules independently consume the same
 * underlying `openExceptionCount` fact (an unresolved `trip_exceptions`
 * row is meaningful in both windows), but neither ever evaluates the same
 * lifecycle-state window as the other, so there is no duplication.
 *
 * RELATIONSHIP TO TRIP READINESS (`trip-readiness-core.ts`, NOT modified,
 * NOT duplicated): Trip Readiness answers "is this SCHEDULED Trip
 * sufficiently prepared to execute" — a pre-execution question. This
 * module answers a post-execution question about a Trip that has already
 * finished. The two never overlap in which states they evaluate
 * (`scheduled` only, vs. `completed` only) and this module reuses that
 * same established MULTI-REASON shape (preserve every applicable reason
 * simultaneously, never collapse to one highest-priority result, never a
 * score/percentage/AI classification) rather than Trip Assurance's own
 * single-collapsed-priority shape, because the underlying question here
 * — "list everything not yet in place before this Trip can move to
 * billing review" — is a checklist, not a single most-important
 * condition.
 *
 * NO-SHOW / CANCELLATION (S1A §12/§13, locked by this phase's own spec):
 * both are NOT_APPLICABLE here, deliberately, not merely "no reasons
 * apply." No-show is NOT evaluated as completed Proof of Service at all
 * — a later read-model/UI phase may surface it separately as "No-show —
 * billing policy review," but that is an entirely different question
 * this module makes no attempt to answer, and no billability judgment of
 * any kind is made here for either outcome.
 *
 * EXPLICITLY OUT OF SCOPE FOR THIS MVP (S1A's own audit + this phase's
 * own explicit exclusions — not oversights):
 *   - GPS / Driver location — supporting evidence only, periodic,
 *     device-dependent, subject to an unenforced retention policy; no
 *     location fact is consumed here at all.
 *   - TripNote content — never inspected, never keyword-matched, never
 *     AI-classified. Notes may be shown as human review context by a
 *     later presentation layer, never derived into a proof reason here.
 *   - Signature / photo / document evidence — no such schema, no such
 *     storage infrastructure exists anywhere in this repository; no
 *     payer requirement has established any of these as mandatory.
 *   - Mileage — not captured anywhere; never derived from GPS coordinates
 *     (straight-line distance would be actively misleading, not merely
 *     approximate). Belongs to future monetary/rate work, not here.
 *   - Any rate, fare, payer, invoice, billing-status, or currency fact —
 *     none exists in this schema (S1A CURRENT FINANCIAL MODEL).
 *   - MISSING_DRIVER / MISSING_PICKUP_EVENT / MISSING_DESTINATION_EVENT /
 *     MISSING_COMPLETION_EVENT as ordinary reason codes — the current
 *     lifecycle architecture (every forward transition is its own
 *     single-edge SECURITY DEFINER RPC, no skip path exists) structurally
 *     guarantees these facts for any correctly-created completed Trip.
 *     Their absence is not a normal operator condition; it is a data-
 *     integrity anomaly, surfaced once via the single fail-closed
 *     `EVIDENCE_INTEGRITY_GAP` rather than as several normally-
 *     unreachable reason codes that would otherwise be dead code.
 */

/** Locked top-level vocabulary (S1B §4) — no fourth state, no claim/payer/invoice/payment vocabulary borrowed in. */
export type TripProofOfServiceState = "READY_FOR_REVIEW" | "NEEDS_REVIEW" | "NOT_APPLICABLE";

/**
 * Closed vocabulary (S1B §5-§15, locked). Deliberately narrow: the
 * "impossible under normal operation" facts (missing Passenger/pickup/
 * destination/completion timestamp/completion assignment/lifecycle event
 * chain) are never surfaced as their own separate reason codes — they
 * collapse into the single fail-closed `EVIDENCE_INTEGRITY_GAP` (S1B
 * §18), because a completed Trip missing any of them did not arise from
 * an ordinary, expected operational gap the way "no Vehicle was assigned"
 * or "an exception was never resolved" can.
 */
export type TripProofOfServiceReasonCode = "EVIDENCE_INTEGRITY_GAP" | "MISSING_VEHICLE" | "OPEN_EXCEPTION";

/**
 * Stable, deterministic output order (S1B §17, locked): integrity problem
 * first (if the underlying facts themselves are untrustworthy, that is
 * the headline concern), missing execution resource second, unresolved
 * operational issue third. This is a PRESENTATION-FRIENDLY ordering
 * choice only, mirroring `trip-readiness-core.ts`'s own `REASON_ORDER`
 * convention exactly — every applicable reason is always returned, this
 * array only fixes the order they appear in.
 */
const REASON_ORDER: TripProofOfServiceReasonCode[] = ["EVIDENCE_INTEGRITY_GAP", "MISSING_VEHICLE", "OPEN_EXCEPTION"];

const COMPLETED_STATE = "completed";

/**
 * The exact, minimal fact set the supported MVP dimensions require —
 * nothing more (S1B §16's own explicit exclusion list: no Passenger name,
 * no Driver name, no Vehicle label, no notes, no GPS, no money/rate/
 * payer, no Request/Recurring-Arrangement provenance — all presentation/
 * context concerns for a later layer, never consumed by this pure core).
 */
export interface TripProofOfServiceFacts {
  /** The canonical Trip lifecycle state — never re-derived, always the real `trips.state`. Every state other than `'completed'` (including `'cancelled'` and `'no_show'`, per S1B §21/§22) short-circuits to NOT_APPLICABLE before any other fact is examined. */
  tripState: string;
  /** Whether `trips.passenger_id` resolves to a real Passenger row — contractually always true by schema (`passenger_id` is NOT NULL), modeled explicitly so the fact contract remains self-contained rather than silently assuming schema guarantees hold at read time. */
  hasPassenger: boolean;
  /** Whether `trips.pickup_description` is present and non-blank — contractually always true by schema (`NOT NULL`); modeled explicitly for the same self-containment reason. */
  hasPickupDescription: boolean;
  /** Whether `trips.destination_description` is present and non-blank — same as `hasPickupDescription`. */
  hasDestinationDescription: boolean;
  /** `trips.completed_at` — the write-once terminal timestamp set exactly once by `driver_complete_trip`. Never substitute `trips.updated_at` (a generic trigger timestamp with no transition-specific meaning) for this value (S1A ACTUAL TIMESTAMP ANALYSIS). */
  completedAt: string | null;
  /** Whether the authoritative `trip_events` chain for this Trip includes every one of the 6 forward transition events (`en_route_to_pickup` through `trip_completed`) with server-set `occurred_at` values — caller-computed, never re-derived here (this module performs no TripEvent query of any kind). */
  hasCompleteLifecycleEventChain: boolean;
  /** Whether a `trip_assignments` row exists for this Trip with `end_reason = 'trip_completed'` — the ONE authoritative source for "who performed this completed Trip" (S1A HISTORICAL ASSIGNMENT ANALYSIS). Never the current active assignment (there is none, post-completion), never the most-recent-by-timestamp assignment, never inferred from `trip_events.actor_user_id` alone. */
  hasCompletionAssignment: boolean;
  /** The `vehicle_id` on that SAME completion assignment row — null both when no Vehicle was ever assigned to it AND when `hasCompletionAssignment` is false; callers must check `hasCompletionAssignment` first to distinguish "no completion assignment exists at all" (an integrity gap) from "a completion assignment exists but carries no Vehicle" (an ordinary, expected `MISSING_VEHICLE` condition — S1B §6, the assignment model legitimately permits Driver-only assignment). */
  completionAssignmentVehicleId: string | null;
  /** Count of real, currently OPEN `trip_exceptions` rows — the SAME authoritative definition `trip-assurance.ts` and `trip-readiness-core.ts` both use, never re-derived independently. Evaluated here for the COMPLETED-Trip window only — never a second, competing "does this Trip need attention" judgment overlapping Trip Assurance's own live-execution window. */
  openExceptionCount: number;
}

export interface TripProofOfServiceResult {
  state: TripProofOfServiceState;
  /** Every applicable reason, in the fixed `REASON_ORDER` above — empty for both READY_FOR_REVIEW and NOT_APPLICABLE (never populated when inapplicable, S1B §17). */
  reasons: TripProofOfServiceReasonCode[];
}

/**
 * Pure function: `facts → result`. No DB access, no `new Date()` inside,
 * no I/O of any kind — mirrors `deriveTripReadiness`'s own established
 * shape exactly.
 *
 * NOT_APPLICABLE whenever `tripState !== 'completed'` (S1B §3, locked) —
 * this includes every in-progress state, `scheduled`, AND both remaining
 * terminal outcomes (`cancelled`, `no_show` — S1B §21/§22, locked
 * separately from ordinary "not yet reached" states because they are
 * terminal but still never evaluated as completed-service Proof of
 * Service). Proof-of-Service Assurance never evaluates, and never
 * reports a reason for, a Trip outside this one window.
 */
export function deriveTripProofOfService(facts: TripProofOfServiceFacts): TripProofOfServiceResult {
  if (facts.tripState !== COMPLETED_STATE) {
    return { state: "NOT_APPLICABLE", reasons: [] };
  }

  const applicable = new Set<TripProofOfServiceReasonCode>();

  // EVIDENCE_INTEGRITY_GAP — fail-closed (S1B §18): ANY of these
  // structural facts being absent means the completed Trip's own record
  // is internally inconsistent with the state machine's own guarantees
  // (S1A: every correctly-created completed Trip structurally has all of
  // these). Multiple simultaneous defects still collapse to ONE emission
  // — this is a single boolean condition, never a per-defect count.
  const hasIntegrityGap =
    !facts.completedAt ||
    !facts.hasPassenger ||
    !facts.hasPickupDescription ||
    !facts.hasDestinationDescription ||
    !facts.hasCompletionAssignment ||
    !facts.hasCompleteLifecycleEventChain;

  if (hasIntegrityGap) {
    applicable.add("EVIDENCE_INTEGRITY_GAP");
  }

  // MISSING_VEHICLE — S1B §6/§20 (the locked Vehicle decision): only
  // ever interpretable when a completion assignment genuinely exists
  // (`hasCompletionAssignment === true`) — deliberately NOT gated on the
  // absence of any OTHER integrity defect, so it still combines with
  // EVIDENCE_INTEGRITY_GAP when that gap arose from an unrelated cause
  // (e.g. a missing Passenger) while a real completion assignment is
  // present. When `hasCompletionAssignment` is false, Vehicle absence
  // cannot be independently interpreted at all (S1B §20's own explicit
  // reasoning) — that case is already covered by EVIDENCE_INTEGRITY_GAP
  // alone, never additionally by this reason.
  if (facts.hasCompletionAssignment && facts.completionAssignmentVehicleId === null) {
    applicable.add("MISSING_VEHICLE");
  }

  // OPEN_EXCEPTION — identical meaning to Trip Assurance's own and Trip
  // Readiness's own `openExceptionCount > 0` check; never a second
  // definition. Independent of any integrity defect — an unresolved
  // exception remains a real, separately-meaningful fact even when the
  // completion record also has an unrelated structural problem (S1B §20
  // example P).
  if (facts.openExceptionCount > 0) {
    applicable.add("OPEN_EXCEPTION");
  }

  const reasons = REASON_ORDER.filter((code) => applicable.has(code));

  return {
    state: reasons.length > 0 ? "NEEDS_REVIEW" : "READY_FOR_REVIEW",
    reasons,
  };
}
