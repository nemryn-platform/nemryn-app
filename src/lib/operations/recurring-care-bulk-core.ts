/**
 * Pure, framework-free helpers for the Recurring Care bulk missing-Trip
 * review workflow (P1-PILOT-S2). Deliberately has NO runtime import of
 * any kind — mirrors `operations-brief-core.ts`'s own established "no
 * runtime import" charter: `MissingOccurrenceSourceRow` below is a
 * minimal, locally-restated structural shape rather than an import of
 * `RecurringArrangementListRow`/`RecurringOccurrence`
 * (recurring-care-list.ts/recurring-care-core.ts), so this module can be
 * unit-tested directly with Node's test runner, with no bundler and no
 * database.
 *
 * NO business/database authority lives here (§2/§35's own explicit
 * boundary): this module only flattens, keys, deduplicates, and
 * summarizes ALREADY-AUTHORITATIVE facts the real evaluator
 * (`deriveRecurringCareAssurance`, recurring-care-core.ts — never
 * reimplemented, never touched by this phase) already computed. No
 * weekday/timezone/pattern/pause/skip logic of any kind exists here.
 */

/** Minimal structural input — the server-only wrapper (recurring-care.ts's own `getRecurringArrangementsList`) narrows its own already-fetched, already-authoritative rows down to this shape before calling in here. */
export interface MissingOccurrenceSourceRow {
  arrangementId: string;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  /** `HH:mm:ss`, local wall-clock in `timezone` below — never re-interpreted as a UTC instant here (presentation only; the RPC itself derives the real scheduled_pickup_at at submission time, §28/§10). */
  pickupTime: string;
  timezone: string;
  /** Exactly the real evaluator's own `occurrences` array for this arrangement — every state (SCHEDULED/MISSING/SKIPPED) present, filtered down to MISSING only by `flattenMissingOccurrences` below, never pre-filtered by the caller. */
  occurrences: { serviceDate: string; state: string }[];
}

export interface MissingOccurrenceRow {
  arrangementId: string;
  serviceDate: string;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  pickupTime: string;
  timezone: string;
}

/**
 * Flattens every MISSING occurrence across every given arrangement into
 * one flat, review-ready list — ascending by `serviceDate` within each
 * arrangement (the evaluator's own established `occurrences` ordering,
 * preserved, never re-sorted by this function beyond a final stable
 * whole-list sort by date so occurrences from different arrangements on
 * the same day sit together).
 *
 * DELIBERATELY does NOT filter by the arrangement's own `status` (§6):
 * the real evaluator's own MISSING state already respects the
 * arrangement's pause/end lifecycle cutoff (a date on or after that
 * cutoff is never reported as an expected/MISSING date at all — see
 * recurring-care-core.ts's own `isPatternDate` symmetry) — an
 * additional active-only filter here would create a real inconsistency
 * with the EXISTING, unmodified single-occurrence "Create trip" button
 * on the Arrangement Detail page (`OccurrenceRow.tsx`), which has never
 * gated on arrangement status either, only on `occurrence.state ===
 * 'MISSING'`. This function mirrors that same, already-proven behavior
 * exactly, rather than introducing a new, stricter rule the existing
 * single-occurrence path does not itself enforce.
 *
 * SCHEDULED and SKIPPED occurrences are never included — confirmed by
 * this function's own explicit `state === "MISSING"` filter, never an
 * inferred "not SCHEDULED" check that could accidentally admit SKIPPED.
 */
export function flattenMissingOccurrences(rows: MissingOccurrenceSourceRow[]): MissingOccurrenceRow[] {
  const flattened: MissingOccurrenceRow[] = [];
  for (const row of rows) {
    for (const occurrence of row.occurrences) {
      if (occurrence.state !== "MISSING") continue;
      flattened.push({
        arrangementId: row.arrangementId,
        serviceDate: occurrence.serviceDate,
        passengerDisplayName: row.passengerDisplayName,
        pickupDescription: row.pickupDescription,
        destinationDescription: row.destinationDescription,
        pickupTime: row.pickupTime,
        timezone: row.timezone,
      });
    }
  }
  return flattened.sort((a, b) => (a.serviceDate < b.serviceDate ? -1 : a.serviceDate > b.serviceDate ? 1 : 0));
}

/** A stable, parseable, unique key for one occurrence — `arrangementId` is always a UUID and `serviceDate` is always `YYYY-MM-DD`, neither of which can ever contain the `::` separator, so this round-trips exactly via `parseOccurrenceKey` with no ambiguity. */
export function occurrenceKey(arrangementId: string, serviceDate: string): string {
  return `${arrangementId}::${serviceDate}`;
}

const OCCURRENCE_KEY_RE = /^([0-9a-f-]{36})::(\d{4}-\d{2}-\d{2})$/i;

/** Inverse of `occurrenceKey` — `null` for any malformed input (never thrown), so a caller reading untrusted browser-submitted form values can safely discard anything that doesn't parse rather than crash the whole batch. */
export function parseOccurrenceKey(key: string): { arrangementId: string; serviceDate: string } | null {
  const match = OCCURRENCE_KEY_RE.exec(key);
  if (!match) return null;
  return { arrangementId: match[1], serviceDate: match[2] };
}

/**
 * Deduplicates a list of occurrence keys, preserving first-seen order
 * (§12 — "if the same occurrence appears twice in submitted input, call
 * the RPC ONCE"). Malformed keys are silently dropped here (the caller
 * already knows, from `parseOccurrenceKey` returning `null`, that a key
 * is unusable) — deduplication itself never needs to distinguish a
 * malformed key from a valid one beyond excluding it.
 */
export function dedupeOccurrenceKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (parseOccurrenceKey(key) === null) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export type BulkOccurrenceResultStatus = "CREATED" | "ALREADY_SCHEDULED" | "FAILED";

export interface BulkOccurrenceResult {
  arrangementId: string;
  serviceDate: string;
  status: BulkOccurrenceResultStatus;
  tripId?: string;
  /** Only present for `status === "FAILED"` — already the SAME safe, narrow `RecurringArrangementErrorCode` category every other Recurring Care action uses (`recurring-arrangement-errors.ts`), never a raw ZW code/SQL/PostgREST message. Typed as `string` here to keep this pure module free of any cross-file import (mirrors `MissingOccurrenceSourceRow`'s own restated-shape convention) — the caller supplies the real `RecurringArrangementErrorCode` value unchanged. */
  errorCode?: string;
}

export interface BulkOccurrenceBatchSummary {
  total: number;
  created: number;
  alreadyScheduled: number;
  failed: number;
}

/**
 * Pure aggregation only (§14/§18) — every CREATED/ALREADY_SCHEDULED/
 * FAILED classification already happened before this function ever sees
 * a result (the caller maps each real RPC response, via `created: true|
 * false` or a raised error, to exactly one of these 3 statuses — see the
 * server action). This function only counts; it never re-derives a
 * status, never rolls anything back, and never treats a partial batch as
 * a single pass/fail verdict.
 */
export function summarizeBatchResults(results: BulkOccurrenceResult[]): BulkOccurrenceBatchSummary {
  let created = 0;
  let alreadyScheduled = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "CREATED") created += 1;
    else if (result.status === "ALREADY_SCHEDULED") alreadyScheduled += 1;
    else failed += 1;
  }
  return { total: results.length, created, alreadyScheduled, failed };
}
