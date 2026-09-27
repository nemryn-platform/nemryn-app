/**
 * Pure dispatcher completion-recovery policy (P1-PILOT-R2C, PR-02). Runtime-import-free (unit-tested under plain
 * Node). The database (record_trip_completion_by_operations) is the authority and re-checks every rule here -- this
 * core only lets the UI show the SAME rules before the operator confirms (who sees the action, note / time checks) and
 * reads the recovery event back for Trip Detail.
 */

/** Owner decision D-6: the only states Operations may record a completion from (the passenger is already onboard). */
export const RECORD_COMPLETION_ELIGIBLE_STATES = ["passenger_onboard", "en_route_to_destination", "arrived_at_destination"] as const;

export function canRecordCompletion(state: string): boolean {
  return (RECORD_COMPLETION_ELIGIBLE_STATES as readonly string[]).includes(state);
}

export const RECOVERY_NOTE_MIN = 10;
export const RECOVERY_NOTE_MAX = 500;
/** The RPC refuses a completion time more than this far in the future. */
export const COMPLETION_FUTURE_ALLOWANCE_MS = 5 * 60 * 1000;

export type RecoveryNoteCheck = { ok: true; note: string } | { ok: false; problem: "NOTE_REQUIRED" | "NOTE_TOO_SHORT" | "NOTE_TOO_LONG" };

/** Trimmed, required, 10..500 characters (the RPC's own rule). */
export function checkRecoveryNote(raw: string | null | undefined): RecoveryNoteCheck {
  const note = (raw ?? "").trim();
  if (note.length === 0) return { ok: false, problem: "NOTE_REQUIRED" };
  if (note.length < RECOVERY_NOTE_MIN) return { ok: false, problem: "NOTE_TOO_SHORT" };
  if (note.length > RECOVERY_NOTE_MAX) return { ok: false, problem: "NOTE_TOO_LONG" };
  return { ok: true, note };
}

/**
 * The stated completion time against the RPC's two bounds: not more than 5 minutes after `nowMs`, and not before the
 * latest lifecycle event that actually happened (`lastLifecycleAt`, null when none).
 */
export function checkCompletionTime(
  completedAtIso: string,
  nowMs: number,
  lastLifecycleAt: string | null,
): "ok" | "TIME_IN_FUTURE" | "TIME_BEFORE_LAST_STEP" {
  const at = Date.parse(completedAtIso);
  if (at > nowMs + COMPLETION_FUTURE_ALLOWANCE_MS) return "TIME_IN_FUTURE";
  if (lastLifecycleAt && at < Date.parse(lastLifecycleAt)) return "TIME_BEFORE_LAST_STEP";
  return "ok";
}

/** The Driver lifecycle event types the RPC's no-time-travel rule looks at. */
export const LIFECYCLE_PROGRESS_EVENT_TYPES = [
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
] as const;

export interface CompletionRecord {
  /** Who recorded it (Organization Admin / Dispatcher). */
  actorUserId: string | null;
  /** When it was recorded (the event's occurred_at). */
  recordedAt: string;
  /** The completion time the operator stated (metadata.recorded_completed_at). */
  completedAt: string | null;
}

/** The completion_recorded_by_operations event, if any. Reads structural metadata only -- the note is never in trip_events. */
export function completionRecordOf(
  events: { event_type: string; occurred_at: string; actor_user_id: string | null; metadata: unknown }[],
): CompletionRecord | null {
  const e = events.find((x) => x.event_type === "completion_recorded_by_operations");
  if (!e) return null;
  const raw = (e.metadata as { recorded_completed_at?: unknown } | null)?.recorded_completed_at;
  return { actorUserId: e.actor_user_id, recordedAt: e.occurred_at, completedAt: typeof raw === "string" ? raw : null };
}
