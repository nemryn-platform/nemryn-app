/**
 * Pure, framework-free Recurring Care Assurance derivation (P1-E2-S1C,
 * following the locked P1-E2-S1A/S1A1 product/domain model — see
 * docs/reports/p1-e2-s1a-recurring-care-assurance-foundation-audit.txt
 * and docs/reports/p1-e2-s1a1-recurring-care-domain-decision-lock.txt).
 *
 * Deliberately has NO runtime import of any kind — no Supabase, no
 * `server-only`, no React, no `Intl`/timezone conversion of its own —
 * mirrors `trip-readiness-core.ts`/`tomorrow-readiness-core.ts`'s own
 * established pure-core convention exactly. Every genuinely timezone-
 * dependent fact (today's own local date, each linked Trip's local
 * service date, an arrangement's paused/ended effective local date) is
 * resolved by the server-only wrapper (recurring-care.ts) BEFORE calling
 * in here — this module receives only already-resolved `YYYY-MM-DD`
 * date-key strings and does pure string/calendar-digit arithmetic on
 * them, never a real IANA timezone lookup. This is the identical
 * "accept pre-evaluated results, not raw facts requiring further
 * conversion" architecture Tomorrow Readiness (P1-E1-S4C) already
 * established for the exact same class of tsc/Node module-resolution
 * reason, reused here rather than re-derived from scratch.
 *
 * Answers exactly one question, per arrangement: "for each of the next
 * 14 local calendar dates (starting today, in the ARRANGEMENT's own
 * timezone), does the transportation that should exist actually exist?"
 * It is derived, never stored — no ExpectedOccurrence table exists or
 * is needed; every fact below is computed fresh from the arrangement's
 * own pattern, the horizon, a bounded set of already-fetched linked
 * Trips, and a bounded set of already-fetched skip-date exceptions.
 *
 * RELATIONSHIP TO TRIP READINESS (`trip-readiness-core.ts`, NOT
 * modified, NOT duplicated, NOT re-derived): this module never
 * re-implements "is this Trip prepared" — for a qualifying Trip still in
 * `state='scheduled'`, the caller (recurring-care.ts) has already called
 * the real, unmodified `deriveTripReadiness` and hands this module the
 * result as an opaque, already-computed value to pass through
 * unchanged. This module composes Trip Readiness's OUTPUT, never its
 * logic.
 *
 * ASSURANCE VOCABULARY (locked, P1-E2-S1C §17) — exactly three
 * occurrence-level states, no others:
 *   SCHEDULED — at least one non-cancelled, dated Trip exists for this
 *     occurrence (the Trip may itself still need preparation — that is
 *     Trip Readiness's own job, exposed alongside, never re-labeled).
 *   MISSING   — this date is expected (a real pattern date, not
 *     deliberately skipped) and no qualifying Trip exists.
 *   SKIPPED   — this date would otherwise be a pattern date, but a
 *     deliberate occurrence exception exists for it.
 * No READY state at this layer (that's Trip Readiness's own vocabulary,
 * never duplicated here). No compliance/risk/adherence/severity score,
 * anywhere in this module, ever.
 */

/** ISO weekday numbers: 1=Monday .. 7=Sunday (matches Postgres's own `EXTRACT(ISODOW FROM date)`, and the locked `recurring_arrangements.days_of_week` representation, P1-E2-S1A1). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const HORIZON_LENGTH_DAYS = 14;

export type RecurringArrangementStatus = "active" | "paused" | "ended";

/**
 * Already-normalized arrangement facts — every date field is a plain
 * `YYYY-MM-DD` string, already resolved to the ARRANGEMENT's own
 * timezone by the caller. Never re-derives `daysOfWeek`/`startDate`/
 * `endDate` from anything else; these are read directly from the
 * `recurring_arrangements` row.
 */
export interface RecurringArrangementFacts {
  id: string;
  organizationId: string;
  passengerId: string;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  /** ISO weekday numbers this arrangement's pattern repeats on — non-empty, deduplicated, ascending (guaranteed by the database CHECK constraint, P1-E2-S1B/S1A1). */
  daysOfWeek: IsoWeekday[];
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`, or null for an open-ended arrangement. */
  endDate: string | null;
  status: RecurringArrangementStatus;
  /**
   * The LOCAL calendar date `paused_at` falls on, in the arrangement's
   * own timezone — already resolved by the caller — or null when
   * `status !== 'paused'` (meaningless/ignored otherwise, mirroring
   * `TripReadinessFacts`'s own established "null when not applicable"
   * convention rather than a sentinel value).
   */
  pausedEffectiveDate: string | null;
  /** Same shape as `pausedEffectiveDate`, for `status === 'ended'`. */
  endedEffectiveDate: string | null;
}

/**
 * One linked Trip's already-normalized facts. `serviceDate` is the
 * LOCAL calendar date `scheduled_pickup_at` resolves to in the
 * ARRANGEMENT's own timezone (never the organization's, never the
 * browser's) — null when `scheduled_pickup_at IS NULL` (a null-scheduled
 * Trip can never satisfy any dated occurrence, P1-E2-S1C §29 — this is
 * never guessed from `created_at`/`appointment_at`/anything else).
 * `readiness` is only ever present for a Trip whose own `state` is
 * `'scheduled'` (mirrors `deriveTripReadiness`'s own NOT_APPLICABLE-for-
 * every-other-state contract) — already computed by the caller, never
 * (re)computed in here.
 */
export interface RecurringLinkedTripFact {
  tripId: string;
  /** The Trip's canonical lifecycle state — used only to apply the locked `state != 'cancelled'` satisfaction rule (P1-E2-S1A1/§13); never re-interpreted beyond that one check (no_show, completed, etc. all still satisfy — see this module's own header comment). */
  state: string;
  serviceDate: string | null;
  /** Opaque pass-through — only present when `state === 'scheduled'`. */
  readiness: TripReadinessResultLike | null;
}

/**
 * A structural (not imported) mirror of `TripReadinessResult`
 * (trip-readiness-core.ts) — this module never imports that module at
 * runtime (matching its own "zero runtime imports" charter); the caller
 * supplies an already-computed value of this exact shape. Kept
 * structurally identical rather than a bare `unknown` so callers get
 * real type safety without this module taking on a dependency.
 */
export interface TripReadinessResultLike {
  state: "READY" | "NEEDS_PREPARATION" | "NOT_APPLICABLE";
  reasons: string[];
}

/** One deliberate skip fact for this arrangement — `serviceDate` as a plain `YYYY-MM-DD` string (the raw `date` column value; no timezone conversion is needed or performed, since a SQL `date` column carries no time-of-day component to resolve in the first place). */
export interface RecurringSkipFact {
  serviceDate: string;
  reason: string;
}

export type RecurringOccurrenceState = "SCHEDULED" | "MISSING" | "SKIPPED";

export interface RecurringOccurrence {
  serviceDate: string;
  state: RecurringOccurrenceState;
  /**
   * Every qualifying (non-cancelled, dated) linked Trip for this date —
   * empty for MISSING/SKIPPED. Deliberately a plain list, never an
   * aggregate/collapsed score: P1-E2-S1C §16 explicitly forbids
   * inventing one readiness value when multiple qualifying Trips exist
   * on the same date (a real, legal shape — e.g. outbound + return, or
   * a genuine duplicate a dispatcher will need to reconcile) — this is
   * the "simplest truthful representation," matching Trip Readiness's
   * own "preserve every applicable fact, never collapse" discipline.
   */
  trips: RecurringLinkedTripFact[];
  /** Only present for `state === 'SKIPPED'`. */
  skipReason: string | null;
}

export interface RecurringArrangementAssurance {
  arrangementId: string;
  /**
   * Horizon dates that match the pattern (weekday + within
   * [startDate, endDate]) AND pass the active/paused/ended lifecycle
   * cutoff — BEFORE applying explicit skips (P1-E2-S1C §19's own locked
   * count-semantics definition).
   */
  patternDateCount: number;
  /** Pattern dates (per patternDateCount above) that also carry a deliberate skip exception for that exact date — a stale skip for a date that is no longer a pattern date under current arrangement facts is never counted here (P1-E2-S1C §27). */
  skippedCount: number;
  /** `patternDateCount - skippedCount`, always. */
  expectedCount: number;
  /** Expected dates with >=1 qualifying Trip. */
  scheduledCount: number;
  /** Expected dates with zero qualifying Trips. */
  missingCount: number;
  /** The earliest date this module's own `occurrences` array reports as either SCHEDULED or MISSING (i.e. the earliest EXPECTED date) — null when expectedCount is 0. */
  nextExpectedDate: string | null;
  /** The earliest MISSING date — null when missingCount is 0. */
  nextMissingDate: string | null;
  /**
   * Count of consecutive MISSING dates, walking the expected-date
   * sequence (SKIPPED dates are not part of this sequence at all — see
   * `occurrences` below) from its earliest date, stopping at the first
   * SCHEDULED date or the end of the sequence. No threshold, no
   * severity label, no "critical" cutoff — P1-E2-S1C §20's own explicit
   * instruction. A caller may choose to surface this number as-is or
   * ignore it entirely; this module never interprets it further.
   */
  consecutiveMissingCount: number;
  /**
   * Every PATTERN date in the horizon (both expected and skipped),
   * ascending by date — non-pattern dates carry no information at all
   * and are omitted entirely, never padded in as an implicit "not
   * applicable" row.
   */
  occurrences: RecurringOccurrence[];
}

/** Pure calendar-digit arithmetic, never timezone-sensitive — the intermediate `Date.UTC` value is used only as a scratch calendar calculator, exactly like `day-bounds.ts`'s own established `nextDateKey` technique (never treated as a real instant). `Date.UTC`'s own well-defined month/day overflow behavior means no manual end-of-month/leap-year logic is needed. */
function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The ISO weekday (1=Monday..7=Sunday) a plain calendar-date string
 * falls on — a pure calendar fact, identical everywhere regardless of
 * timezone once the date is already known as data (Sept 17 2026 is a
 * Thursday globally; this requires no IANA lookup at all). JS's own
 * `Date.getUTCDay()` returns 0=Sunday..6=Saturday; remapped to the ISO
 * convention this module (and the database's own `days_of_week` column)
 * uses throughout.
 */
function isoWeekdayOf(dateKey: string): IsoWeekday {
  const [year, month, day] = dateKey.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as IsoWeekday;
}

function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Exactly 14 local calendar dates: `todayLocalDateKey` through the
 * following 13 dates, inclusive — never `now + 14*24h` (DST makes that
 * wrong; this module never touches elapsed time at all, only calendar
 * digits). `HORIZON_LENGTH_DAYS` is the one named constant governing
 * this — never a scattered literal.
 */
export function generateHorizonDates(todayLocalDateKey: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < HORIZON_LENGTH_DAYS; i++) {
    dates.push(addCalendarDays(todayLocalDateKey, i));
  }
  return dates;
}

/**
 * Whether `dateKey` is a PATTERN date for `arrangement` — matches the
 * weekday pattern, lies within [startDate, endDate], AND passes the
 * active/paused/ended lifecycle cutoff (P1-E2-S1C §4/§19 — lifecycle is
 * applied here, BEFORE skips, matching the locked count-semantics
 * pipeline exactly). Deliberately exported: both `deriveRecurringCare
 * Assurance` below and this module's own test suite need to assert
 * pattern-date membership independent of the skip/satisfaction layers.
 */
export function isPatternDate(arrangement: RecurringArrangementFacts, dateKey: string): boolean {
  if (compareDateKeys(dateKey, arrangement.startDate) < 0) return false;
  if (arrangement.endDate !== null && compareDateKeys(dateKey, arrangement.endDate) > 0) return false;
  if (!arrangement.daysOfWeek.includes(isoWeekdayOf(dateKey))) return false;

  switch (arrangement.status) {
    case "active":
      return true;
    case "paused":
      // No new expected occurrences on or after the local date paused_at
      // falls on (P1-E2-S1C §4). A malformed fixture with pausedEffective
      // Date in the future is handled mechanically, never specially —
      // this module invents no "scheduled future pause" semantics; it
      // simply applies the same comparison regardless of where
      // pausedEffectiveDate happens to fall relative to the horizon.
      return arrangement.pausedEffectiveDate === null || compareDateKeys(dateKey, arrangement.pausedEffectiveDate) < 0;
    case "ended":
      // Symmetric to paused, using endedEffectiveDate — dates before the
      // effective end date remain real pattern dates; ended never
      // "deletes" that history (P1-E2-S1C §4).
      return arrangement.endedEffectiveDate === null || compareDateKeys(dateKey, arrangement.endedEffectiveDate) < 0;
    default: {
      // Exhaustiveness guard — the database CHECK constraint already
      // makes this unreachable for any real row (P1-E2-S1B/S1B1).
      const _exhaustive: never = arrangement.status;
      return _exhaustive;
    }
  }
}

/**
 * The authoritative satisfaction rule (locked, P1-E2-S1A1 §13, restated
 * verbatim in P1-E2-S1C §13): an expected occurrence for local service
 * date D is SATISFIED by every linked Trip whose own `state` is not
 * `'cancelled'` AND whose `serviceDate` equals D exactly. A Trip with
 * `serviceDate === null` (i.e. `scheduled_pickup_at IS NULL`) can never
 * match any D, by construction — no guessing from any other field
 * (P1-E2-S1C §29). `no_show`/`completed`/every other non-cancelled
 * state all still count as evidence a real Trip was operationally
 * created for this occurrence — Recurring Care Assurance asks whether
 * transportation was represented, never whether it clinically
 * succeeded (P1-E2-S1C §15).
 */
function qualifyingTripsFor(trips: RecurringLinkedTripFact[], dateKey: string): RecurringLinkedTripFact[] {
  return trips.filter((trip) => trip.state !== "cancelled" && trip.serviceDate === dateKey);
}

/**
 * Derives the full Recurring Care Assurance result for one arrangement.
 * Pure: no I/O, no `new Date()` inside — `todayLocalDateKey` is always
 * the caller's own already-resolved instant, mirroring `deriveTripReadiness`/
 * `aggregateTomorrowReadiness`'s own established determinism discipline.
 *
 * `trips` and `skips` are expected to already be scoped to this one
 * arrangement (the server wrapper groups a larger bounded fetch by
 * arrangement id before calling in here, once per arrangement — see
 * recurring-care.ts) — this function does not itself filter by
 * `arrangementId`, trusting the caller's own grouping, exactly like
 * `aggregateTomorrowReadiness` trusts its caller's own candidate set.
 */
export function deriveRecurringCareAssurance(
  arrangement: RecurringArrangementFacts,
  todayLocalDateKey: string,
  trips: RecurringLinkedTripFact[],
  skips: RecurringSkipFact[],
): RecurringArrangementAssurance {
  const skipReasonByDate = new Map(skips.map((s) => [s.serviceDate, s.reason]));
  const horizon = generateHorizonDates(todayLocalDateKey);

  const occurrences: RecurringOccurrence[] = [];
  let patternDateCount = 0;
  let skippedCount = 0;
  let scheduledCount = 0;
  let missingCount = 0;

  for (const dateKey of horizon) {
    if (!isPatternDate(arrangement, dateKey)) continue;
    patternDateCount++;

    const skipReason = skipReasonByDate.get(dateKey) ?? null;
    if (skipReason !== null) {
      skippedCount++;
      occurrences.push({ serviceDate: dateKey, state: "SKIPPED", trips: [], skipReason });
      continue;
    }

    const qualifying = qualifyingTripsFor(trips, dateKey);
    if (qualifying.length > 0) {
      scheduledCount++;
      occurrences.push({ serviceDate: dateKey, state: "SCHEDULED", trips: qualifying, skipReason: null });
    } else {
      missingCount++;
      occurrences.push({ serviceDate: dateKey, state: "MISSING", trips: [], skipReason: null });
    }
  }

  const expectedCount = patternDateCount - skippedCount;
  // Invariant, always true by construction (never separately computed):
  // scheduledCount + missingCount === expectedCount.

  const expectedOccurrences = occurrences.filter((o) => o.state === "SCHEDULED" || o.state === "MISSING");
  const nextExpectedDate = expectedOccurrences[0]?.serviceDate ?? null;
  const nextMissingDate = expectedOccurrences.find((o) => o.state === "MISSING")?.serviceDate ?? null;

  let consecutiveMissingCount = 0;
  for (const occurrence of expectedOccurrences) {
    if (occurrence.state !== "MISSING") break;
    consecutiveMissingCount++;
  }

  return {
    arrangementId: arrangement.id,
    patternDateCount,
    skippedCount,
    expectedCount,
    scheduledCount,
    missingCount,
    nextExpectedDate,
    nextMissingDate,
    consecutiveMissingCount,
    occurrences,
  };
}
