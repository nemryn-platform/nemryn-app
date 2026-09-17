/**
 * Pure, framework-free Tomorrow Readiness aggregation (P1-E1-S4C).
 *
 * Deliberately has NO runtime import of any kind — only an `import
 * type` reference to `trip-readiness-core.ts` (erased entirely at
 * compile time, so it never needs runtime module resolution) — no
 * Supabase, no `server-only`, no React, no date/time I/O. Mirrors the
 * established pure-core convention exactly (`request-readiness-
 * core.ts`, `trip-readiness-core.ts`, `operations-brief-core.ts`, all
 * of which likewise reference sibling types only, never a sibling
 * module's runtime code).
 *
 * Tomorrow Readiness is NOT a new readiness definition. It is:
 *
 *   DATE SCOPE (which Trips count as "tomorrow" — resolved entirely by
 *   the server-only wrapper, `tomorrow-readiness.ts`, using the
 *   existing `organizationDayBoundsUtc` machinery — never here)
 *   +
 *   P1-E1-S4B's own `deriveTripReadiness` (called ONCE PER CANDIDATE by
 *   the server-only wrapper itself, never here, and never
 *   re-implemented — see this file's own design note below)
 *
 * DESIGN NOTE — why `deriveTripReadiness` is called by the WRAPPER, not
 * by this pure module, even though S4C's own instruction says "every
 * candidate Trip must be evaluated by deriveTripReadiness": this module
 * takes ALREADY-EVALUATED `TripReadinessResult`s as its input (see
 * `TomorrowReadinessCandidate.readiness` below), never raw
 * `TripReadinessFacts`. This still satisfies "use the S4B evaluator,
 * never a second definition" — the evaluation itself happens exactly
 * once, via the real `deriveTripReadiness`, just one call site earlier
 * (in `tomorrow-readiness.ts`, which already has to assemble the raw
 * facts from several queries anyway). The alternative — importing
 * `deriveTripReadiness` as a real runtime dependency into THIS pure
 * module — was tried first and reverted: it is the first case in this
 * codebase where one pure `*-core.ts` module would need a genuine
 * runtime (non-type-only) import of ANOTHER pure module, which exposed
 * a real TypeScript/Node module-resolution conflict (tsc's own
 * "bundler" resolution wants a `.js`-suffixed relative specifier
 * resolving to the sibling `.ts` file; Node's native direct TypeScript
 * execution — used by `node --test`, exactly like every other
 * `*-core.test.mjs` file here, with no bundler in front of it — does
 * NOT implement that convention and looks for a literal
 * `trip-readiness-core.js` file, which does not exist). Rather than
 * work around that with a build-only trick, this module's own contract
 * was narrowed to accept pre-evaluated results — a genuinely cleaner
 * separation besides: assembling facts is already I/O-adjacent work
 * living in the wrapper, so evaluating them there too is a natural fit,
 * and this module's own job stays exactly "sort + count + enforce the
 * NOT_APPLICABLE invariant," never touching a raw fact or an evaluation
 * rule at all.
 *
 * This module's ONLY job is aggregation/sorting/invariant-enforcement
 * over an already-assembled, already-evaluated candidate list — it
 * never decides which Trips belong to "tomorrow" (a day-boundary/
 * timezone concern, the server wrapper's job) and it never re-derives
 * what makes a Trip ready (that is `deriveTripReadiness`'s own,
 * unmodified, unduplicated job, called exactly once per candidate by
 * the wrapper).
 */

import type { TripReadinessResult } from "./trip-readiness-core";

/**
 * One candidate Trip already known to be `state='scheduled'`, already
 * known to fall within tomorrow's own organization-local window, and
 * already evaluated by the real `deriveTripReadiness` — all three
 * facts are established by the caller (the server-only wrapper),
 * never re-checked or re-derived here. `scheduledPickupAt` is
 * contractually non-null for every candidate (S4C §3's own locked
 * rule: a Trip with a null schedule can never be a Tomorrow Readiness
 * candidate at all — excluded before it ever reaches this module).
 */
export interface TomorrowReadinessCandidate {
  tripId: string;
  /** Real ISO instant — never null for a genuine candidate (see this interface's own doc comment). */
  scheduledPickupAt: string;
  passengerDisplayName: string;
  /** The real, unmodified S4B result for this Trip — `state` must be `READY` or `NEEDS_PREPARATION` for every genuine candidate; this module enforces that as an invariant rather than merely assuming it (see `aggregateTomorrowReadiness`'s own NOT_APPLICABLE guard below). `reasons` retains every applicable reason, never collapsed to one. */
  readiness: TripReadinessResult;
}

export interface TomorrowReadinessItem {
  tripId: string;
  scheduledPickupAt: string;
  passengerDisplayName: string;
  readiness: TripReadinessResult;
}

export interface TomorrowReadinessAggregate {
  totalScheduledTrips: number;
  readyCount: number;
  needsPreparationCount: number;
  /** Stable chronological order: `scheduledPickupAt` ascending, `tripId` ascending as a deterministic tiebreaker for same-instant Trips. */
  items: TomorrowReadinessItem[];
}

/**
 * Aggregates an already-evaluated candidate list into the Tomorrow
 * Readiness result. Never calls or duplicates `deriveTripReadiness`
 * itself (see this file's own design note above) — never a second,
 * independently-maintained "tomorrow readiness" definition (S4C's own
 * explicit, locked instruction).
 *
 * INVARIANT (enforced, not merely assumed): every candidate's own
 * `readiness.state` must already be `READY` or `NEEDS_PREPARATION`. If
 * it is `NOT_APPLICABLE`, that is a genuine CALLER CONTRACT VIOLATION
 * (the caller evaluated a Trip that was not actually `state='scheduled'`
 * before calling this function) — this function throws rather than
 * silently counting a `NOT_APPLICABLE` result as `READY` or quietly
 * dropping it, matching this codebase's own established "never
 * fabricate a result" discipline.
 */
export function aggregateTomorrowReadiness(candidates: TomorrowReadinessCandidate[]): TomorrowReadinessAggregate {
  const sorted = [...candidates].sort((a, b) => {
    const timeDiff = new Date(a.scheduledPickupAt).getTime() - new Date(b.scheduledPickupAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.tripId.localeCompare(b.tripId);
  });

  const items: TomorrowReadinessItem[] = [];
  let readyCount = 0;
  let needsPreparationCount = 0;

  for (const candidate of sorted) {
    const { readiness } = candidate;

    if (readiness.state === "NOT_APPLICABLE") {
      throw new Error(
        `aggregateTomorrowReadiness: candidate trip ${candidate.tripId} carries a NOT_APPLICABLE readiness result — every Tomorrow Readiness candidate must already have been evaluated as state='scheduled' before reaching this function; this indicates a caller contract violation, never a legitimate empty result.`,
      );
    }

    if (readiness.state === "READY") {
      readyCount++;
    } else {
      needsPreparationCount++;
    }

    items.push({
      tripId: candidate.tripId,
      scheduledPickupAt: candidate.scheduledPickupAt,
      passengerDisplayName: candidate.passengerDisplayName,
      readiness,
    });
  }

  return {
    totalScheduledTrips: items.length,
    readyCount,
    needsPreparationCount,
    items,
  };
}
