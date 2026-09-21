/**
 * Stable application-level error vocabulary for Driver lifecycle mutations
 * (P1-E3-S3, work item §21) — mirrors the same pattern as
 * src/lib/auth/errors.ts: never a raw ZW00x code, SQLSTATE, or Postgres/
 * PostgREST message surfaced to a Driver. The 6 Driver transition RPCs
 * only ever produce ZW001/ZW002/ZW003 (docs/data/mutation-api.md's own
 * documented authorization chain for this family — ZW004/ZW005/ZW006 are
 * ops-action-only) — mapped below, plus one generic fallback for anything
 * else (a network failure, an unexpected code) so nothing ever falls
 * through to raw error text.
 */
export const DRIVER_ACTION_ERROR = {
  UNAUTHORIZED: "UNAUTHORIZED", // ZW001 — caller can see the Trip but can't act on it right now (reassigned away, already closed)
  NOT_FOUND: "NOT_FOUND", // ZW002 — Trip doesn't exist, or caller has no legitimate visibility (foreign org, never assigned)
  STALE_STATE: "STALE_STATE", // ZW003 — the Trip's actual state no longer matches what this action expected
  NETWORK: "NETWORK", // P1-PILOT-S5A — the request never reached Nemryn (offline / dropped connection); nothing was changed
  UNKNOWN: "UNKNOWN", // anything else — never render the underlying detail
} as const;

export type DriverActionErrorCode = (typeof DRIVER_ACTION_ERROR)[keyof typeof DRIVER_ACTION_ERROR];

/** Safe, generic, user-facing copy — action-focused, never a database code or message. */
export const DRIVER_ACTION_ERROR_MESSAGE: Record<DriverActionErrorCode, string> = {
  UNAUTHORIZED: "This action is no longer available for this trip. It may have been reassigned.",
  NOT_FOUND: "This trip is no longer available.",
  STALE_STATE: "This trip has changed. Refreshing the latest details.",
  NETWORK: "Can't reach Nemryn. Your update was not sent. Check your connection, then try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

/** Maps a PostgREST error's `code` field (docs/data/mutation-api.md's ZW00x contract) to the safe vocabulary above. */
export function mapDriverActionError(code: string | undefined): DriverActionErrorCode {
  switch (code) {
    case "ZW001":
      return DRIVER_ACTION_ERROR.UNAUTHORIZED;
    case "ZW002":
      return DRIVER_ACTION_ERROR.NOT_FOUND;
    case "ZW003":
      return DRIVER_ACTION_ERROR.STALE_STATE;
    default:
      return DRIVER_ACTION_ERROR.UNKNOWN;
  }
}
