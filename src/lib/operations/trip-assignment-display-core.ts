/**
 * Which trip assignment the Trip Detail summary shows as "Driver" / "Vehicle" (NP-P2-S7-D, defect D-1). Runtime-import
 * free (unit-tested under plain Node: trip-assignment-display-core.test.mjs).
 *
 * - Any trip with an ACTIVE assignment (ended_at null): that assignment -- the existing behaviour, unchanged.
 * - A COMPLETED trip with no active assignment: the most recently ended assignment, i.e. who actually drove (completion
 *   ends the assignment; the row is kept as history). A reassigned trip therefore shows the final driver, never the one
 *   it was reassigned away from.
 * - Anything else (cancelled, no-show, still scheduled without an assignment, no assignment history): none -- the page
 *   keeps its "Unassigned" / "—" placeholders.
 * Rows of another organization are never considered (defence in depth: the query already joins on
 * (trip_id, organization_id)). Display only: assignment / reassignment controls keep using the active assignment.
 */
export interface DisplayAssignmentCandidate {
  organizationId: string;
  endedAt: string | null;
  assignedAt: string;
}

export function displayAssignmentOf<T extends DisplayAssignmentCandidate>(assignments: readonly T[] | null | undefined, tripState: string, organizationId: string): T | null {
  const own = (assignments ?? []).filter((a) => a.organizationId === organizationId);
  const active = own.find((a) => a.endedAt === null);
  if (active) return active;
  if (tripState !== "completed") return null;
  let latest: T | null = null;
  for (const a of own) {
    const ended = Date.parse(a.endedAt ?? "");
    if (Number.isNaN(ended)) continue;
    if (latest === null) {
      latest = a;
      continue;
    }
    const best = Date.parse(latest.endedAt ?? "");
    if (ended > best || (ended === best && Date.parse(a.assignedAt) > Date.parse(latest.assignedAt))) latest = a;
  }
  return latest;
}
