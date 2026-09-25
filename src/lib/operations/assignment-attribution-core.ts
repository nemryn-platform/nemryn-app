/**
 * Pure assignment attribution for Trip Detail (P1-OPS-PROG3B). No runtime
 * imports -- unit-testable with Node's test runner.
 *
 * Uses ONLY stored facts: trip_assignments.assigned_by / assigned_at /
 * ended_at / end_reason. Nothing is inferred beyond the recorded action --
 * no "responsible dispatcher", no blame language.
 *
 * Name resolution is decided by what the viewer's existing RLS already
 * returns: the caller passes only the display names it could read
 * (`visibleNames`). A name that is not visible becomes "a team member";
 * this module never widens visibility.
 */

export interface AttributionAssignment {
  id: string;
  assignedBy: string | null;
  assignedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface AssignmentAttribution {
  verb: "Assigned" | "Reassigned";
  /** "you", a visible display name, "a team member", or null when no assigner was recorded. */
  who: string | null;
  at: string;
  /** Operator-entered reassignment reason only; never a system/default value. */
  reason: string | null;
}

/** end_reason values written by the system rather than typed by an operator. */
export const SYSTEM_END_REASONS: ReadonlySet<string> = new Set(["reassigned", "trip_completed", "trip_cancelled", "no_show"]);

/** Assignment-ending reasons that are NOT a reassignment (the trip itself ended). */
const TRIP_ENDING_REASONS: ReadonlySet<string> = new Set(["trip_completed", "trip_cancelled", "no_show"]);

export function resolveAssignerLabel(
  assignedBy: string | null,
  viewerUserId: string | null,
  visibleNames: ReadonlyMap<string, string>,
): string | null {
  if (!assignedBy) return null;
  if (viewerUserId && assignedBy === viewerUserId) return "you";
  const name = visibleNames.get(assignedBy)?.trim();
  return name ? name : "a team member";
}

/**
 * Attribution for the Trip's CURRENT assignment (the active one, or -- for
 * a Trip that has ended -- the most recent one). It is a reassignment only
 * when the stored history proves it: an earlier assignment on the same
 * Trip was ended, at or before this one began, with a non-trip-ending
 * reason (reassign_trip's own close). Its reason is shown only when an
 * operator typed it.
 */
export function deriveAssignmentAttribution(
  assignments: AttributionAssignment[],
  viewerUserId: string | null,
  visibleNames: ReadonlyMap<string, string>,
): AssignmentAttribution | null {
  if (assignments.length === 0) return null;
  const byAssignedAt = [...assignments].sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt));
  const current = byAssignedAt.find((a) => a.endedAt === null) ?? byAssignedAt[byAssignedAt.length - 1];
  const currentAt = Date.parse(current.assignedAt);

  const previous = byAssignedAt
    .filter((a) => a.id !== current.id && a.endedAt !== null && Date.parse(a.endedAt) <= currentAt + 1000)
    .sort((a, b) => Date.parse(b.endedAt as string) - Date.parse(a.endedAt as string))[0];
  const isReassignment = Boolean(previous && previous.endReason !== null && !TRIP_ENDING_REASONS.has(previous.endReason));
  const reason =
    isReassignment && previous?.endReason && !SYSTEM_END_REASONS.has(previous.endReason) ? previous.endReason.trim() || null : null;

  return {
    verb: isReassignment ? "Reassigned" : "Assigned",
    who: resolveAssignerLabel(current.assignedBy, viewerUserId, visibleNames),
    at: current.assignedAt,
    reason,
  };
}
