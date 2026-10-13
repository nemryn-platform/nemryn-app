/**
 * Pure Nemryn Plus access rules (NP-P1-S1). Runtime-import-free (unit-tested under plain Node: access-core.test.mjs).
 *
 * The effective Plus state comes ONLY from the database (`plus_access_state`, which resolves the caller's own
 * Organization Admin membership). These helpers interpret it; they never grant anything on their own. Anything the
 * database did not clearly return is treated as `none` -- fail closed.
 */

/** The four effective states (docs/security/plus-access-model.md section 3.1a). */
export type PlusAccessState = "none" | "write" | "read_only" | "locked";

export const PLUS_ACCESS_STATES: readonly PlusAccessState[] = ["none", "write", "read_only", "locked"];

/** Unknown, missing or malformed values become `none` (fail closed). */
export function parsePlusAccessState(raw: unknown): PlusAccessState {
  return typeof raw === "string" && (PLUS_ACCESS_STATES as readonly string[]).includes(raw) ? (raw as PlusAccessState) : "none";
}

/** Only `write` and `read_only` may open the Growth area. `locked` (security disable) and `none` may not. */
export function canEnterGrowth(state: PlusAccessState): boolean {
  return state === "write" || state === "read_only";
}

/** Read-only Plus: history stays visible to the Organization Admin, nothing can be changed. */
export function isPlusReadOnly(state: PlusAccessState): boolean {
  return state === "read_only";
}

/**
 * Whole days left in a running trial, rounded up (0 once the end has passed). `null` when there is no valid trial end.
 */
export function trialDaysRemaining(now: Date, trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  const ms = end - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** "October 27, 2026" in the organization's own timezone; `null` when there is no valid trial end. */
export function formatTrialEnd(trialEndsAt: string | null, timezone: string): string | null {
  if (!trialEndsAt) return null;
  const date = new Date(trialEndsAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: timezone }).format(date);
}
