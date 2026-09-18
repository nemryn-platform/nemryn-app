import "server-only";
import { organizationLocalToUtc } from "./local-time";

/**
 * Organization-local "today"/"tomorrow" boundary, expressed as EXACT UTC
 * instants (P1-E3-S4, hardened for DST correctness at P1-E1-S4C1) — the
 * Operations-console counterpart to src/lib/driver/trip-presentation.ts's
 * per-instant `operationalDateKey`/`isSameOperationalDay` helpers. Driver
 * Today never needed a range query (it filters an already-small RPC result
 * set client-side, one instant at a time); Today's Operations/Dispatch/
 * Trips-list/Tomorrow Readiness do — they query `trips`/`trip_events`
 * directly with an explicit `gte`/`lt` bound, so they need the actual UTC
 * start/end instants of "this organization-local calendar date" to hand
 * to PostgREST, not just a same-day boolean check.
 *
 * Never the runtime's local timezone, never a hardcoded Georgia timezone,
 * never a fixed/assumed UTC offset, never a 24-hour-day assumption, never
 * a hardcoded DST transition table — same rule as P1-E3-S2C/ZD-11x.
 *
 * P1-E1-S4C1 CORRECTNESS FIX: this function previously computed `endUtc`
 * as `startUtc + 24 hours` — correct for an ordinary day, but WRONG on a
 * DST transition day (a spring-forward local calendar day genuinely has
 * only 23 elapsed hours; a fall-back day genuinely has 25). That produced
 * a window up to 1 hour too wide or too narrow at its far edge on exactly
 * those two days per year, discovered and documented as an accepted
 * tolerance during P1-E1-S4C's own Tomorrow Readiness work — accepted
 * then because Tomorrow Readiness's own composition (`organizationDay
 * BoundsUtc(todayBounds.endUtc, timezone)`) had no cheaper fix available
 * without changing this shared helper; fixed HERE now instead, so every
 * caller of this helper benefits automatically, with no caller-side
 * change required.
 *
 * FIX STRATEGY: reuse `organizationLocalToUtc` (local-time.ts) — the
 * SAME already-proven, already-tested, DST-exact local-date-time → UTC
 * conversion this codebase already relies on for the reverse direction
 * (Dispatcher wall-clock input → `create_trip`'s own `timestamptz`
 * parameters). `startUtc` and `endUtc` are each resolved independently as
 * "local 00:00 of this specific calendar date" — never derived from one
 * another by adding a fixed duration — so each one automatically reflects
 * whatever that specific date's own real UTC offset actually is. This is
 * the exact "smallest well-tested solution using the existing Intl-based
 * approach" this fix was scoped to: no new library, no hardcoded offset
 * table, no dependency added.
 */

/**
 * `YYYY-MM-DD`, the organization-local calendar date containing `instant`.
 * Exported (P1-E2-S1C) for reuse by recurring-care.ts, which needs the
 * identical instant->local-date-key conversion for "today," for each
 * linked Trip's own service date, and for an arrangement's paused_at/
 * ended_at effective dates — never a second, independently-drifting
 * copy of this exact formatting logic.
 */
export function localDateKey(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * `dateKey` plus `days` calendar days, as a `YYYY-MM-DD` string — pure
 * calendar-digit arithmetic, never timezone-sensitive (the intermediate
 * `Date.UTC` value here is used only as a scratch calendar calculator,
 * exactly like `formatRequestServiceDate`'s own established use of
 * `Date.UTC` for calendar-only values elsewhere in this codebase — never
 * treated as a real instant). `Date.UTC`'s own well-defined month/day
 * overflow behavior (e.g. day 32 of a 31-day month correctly rolls into
 * the 1st of the next month, Dec 31 correctly rolls into Jan 1 of the
 * next year) means no manual end-of-month/leap-year logic is needed here.
 * Exported (P1-E2-S1C) so recurring-care.ts can resolve the exact UTC
 * instant bounding its 14-day horizon without duplicating this technique.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(next);
}

function nextDateKey(dateKey: string): string {
  return addDaysToDateKey(dateKey, 1);
}

/**
 * The exact UTC instant of local midnight (00:00) at the start of
 * `dateKey` in `timezone`, via `organizationLocalToUtc`. Local midnight
 * is not, for any IANA timezone this product currently supports (this
 * product's own documented scope: America/New_York, per local-time.ts's
 * own doc comment — no organization in current or near-term scope uses a
 * zone whose DST transition occurs at midnight; real-world transitions in
 * every zone this product supports occur at 2:00 AM local), ever the
 * `nonexistent`/`ambiguous` DST-edge instant `organizationLocalToUtc` can
 * in principle report — those statuses exist for a *general* local
 * date+time conversion (an arbitrary Dispatcher-entered pickup time COULD
 * land inside a 2 AM transition gap/overlap) and are simply not reachable
 * at exactly midnight for any timezone actually in use. This function
 * still does not silently paper over that impossible case with a guessed
 * instant if it were ever somehow reached (e.g. this helper being pointed
 * at a hypothetical future timezone with a midnight transition) — it
 * throws a clear, diagnosable error instead, matching this codebase's own
 * "never fabricate a result" discipline.
 *
 * Exported (P1-E2-S1C) so recurring-care.ts can resolve the exact UTC
 * bounds of its own 14-day per-arrangement horizon without duplicating
 * this technique.
 */
export function localMidnightUtc(dateKey: string, timezone: string): Date {
  const result = organizationLocalToUtc({ date: dateKey, time: "00:00" }, timezone);
  if (result.status !== "ok") {
    throw new Error(
      `organizationDayBoundsUtc: local midnight for ${dateKey} in "${timezone}" could not be resolved to a single UTC instant (status=${result.status}). This indicates a timezone whose DST transition occurs exactly at midnight, which no timezone currently used by this product does.`,
    );
  }
  return result.utc;
}

/**
 * [startUtc, endUtc) — the EXACT UTC instants of local-midnight-to-local-
 * midnight "today" (the organization-local calendar date containing
 * `now`), in `timezone`. `endUtc` is exclusive (the following local
 * midnight), so callers filter with `gte(startUtc)` + `lt(endUtc)`. The
 * duration between them is 24 hours on an ordinary day, 23 hours on a
 * spring-forward local calendar day, and 25 hours on a fall-back local
 * calendar day — never assumed to be a fixed 24 hours (P1-E1-S4C1).
 *
 * "Tomorrow" is computed by composing this SAME function twice — never a
 * separate implementation, never `+ 24 hours` arithmetic anywhere:
 *
 *   const today = organizationDayBoundsUtc(now, timezone);
 *   const tomorrow = organizationDayBoundsUtc(today.endUtc, timezone);
 *
 * `today.endUtc` is, by this function's own contract, the exact instant
 * of tomorrow's own local midnight — feeding it back in re-derives that
 * specific calendar date's own real boundaries from scratch, correct
 * regardless of whether "tomorrow" itself is a 23/24/25-hour day.
 */
export function organizationDayBoundsUtc(now: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const dateKey = localDateKey(now, timezone);
  const startUtc = localMidnightUtc(dateKey, timezone);
  const endUtc = localMidnightUtc(nextDateKey(dateKey), timezone);
  return { startUtc, endUtc };
}
