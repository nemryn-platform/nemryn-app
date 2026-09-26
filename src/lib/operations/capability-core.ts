/**
 * Pure wheelchair capability match (P1-OPS-PROG5B; spec §9). No runtime imports.
 *
 * Facts only: a vehicle's RECORDED equipment versus a trip's stated requirement. NULL means "not recorded" /
 * "not specified" and is never read as false. The result never ranks, recommends or blocks anything, and it is never a
 * regulatory claim -- it only says whether the recorded equipment matches the stated need.
 */

export interface VehicleCapabilities {
  wheelchairRamp: boolean | null;
  wheelchairLift: boolean | null;
  wheelchairPositions: number | null;
  seatedCapacity: number | null;
}

export type CapabilityMatch =
  | "NOT_APPLICABLE" // the trip explicitly does not need wheelchair transport equipment
  | "REQUIREMENT_UNKNOWN" // the trip's requirement is not specified -> no warning
  | "CAPABLE" // recorded equipment supports it
  | "KNOWN_MISMATCH" // recorded equipment provably does not
  | "NOT_CHECKABLE"; // required, but the needed equipment facts are not recorded

/**
 * requires = true:
 *   CAPABLE         wheelchair_positions >= 1 AND (ramp = true OR lift = true)
 *   KNOWN_MISMATCH  wheelchair_positions = 0 OR (ramp = false AND lift = false)
 *   NOT_CHECKABLE   everything else (a needed fact is NULL and nothing is provably missing)
 */
export function deriveCapabilityMatch(requires: boolean | null, capabilities: VehicleCapabilities | null): CapabilityMatch {
  if (requires === false) return "NOT_APPLICABLE";
  if (requires === null || requires === undefined) return "REQUIREMENT_UNKNOWN";
  const c = capabilities ?? { wheelchairRamp: null, wheelchairLift: null, wheelchairPositions: null, seatedCapacity: null };
  if (c.wheelchairPositions === 0 || (c.wheelchairRamp === false && c.wheelchairLift === false)) return "KNOWN_MISMATCH";
  if (c.wheelchairPositions !== null && c.wheelchairPositions >= 1 && (c.wheelchairRamp === true || c.wheelchairLift === true)) return "CAPABLE";
  return "NOT_CHECKABLE";
}

/** Operator-facing copy (one source). Null when there is nothing to say. */
export function capabilityNotice(match: CapabilityMatch): string | null {
  if (match === "KNOWN_MISMATCH") return "This trip needs wheelchair transport equipment; this vehicle's recorded equipment doesn't match.";
  if (match === "NOT_CHECKABLE") return "This trip needs wheelchair transport equipment; this vehicle's wheelchair equipment isn't recorded.";
  return null;
}

/** Short flag text for Dispatch blocks. */
export function capabilityFlag(match: CapabilityMatch): string | null {
  if (match === "KNOWN_MISMATCH") return "Wheelchair equipment doesn't match";
  if (match === "NOT_CHECKABLE") return "Wheelchair equipment not recorded";
  return null;
}

/** Tri-state form value <-> stored value (NULL = not specified). */
export type TriState = "yes" | "no" | "unspecified";
export function triStateToBoolean(value: string | null | undefined): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}
export function booleanToTriState(value: boolean | null | undefined): TriState {
  return value === true ? "yes" : value === false ? "no" : "unspecified";
}
