import "server-only";

/**
 * Organization-local date/time → UTC instant conversion (P1-E3-S7). The implementation lives, unchanged, in the
 * runtime-import-free local-time-core.ts (moved there in P1-OPS-PROG5B so pure cores and unit tests can share it);
 * this module keeps the server-only boundary for existing server callers.
 */
export { organizationLocalToUtc, type LocalDateTime, type LocalToUtcResult } from "./local-time-core";
