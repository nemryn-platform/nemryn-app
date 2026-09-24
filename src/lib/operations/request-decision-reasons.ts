/**
 * Decline / cancel reason taxonomy for Request decisions (P1-OPS-R1).
 *
 * Pure, no runtime imports. The code lists MUST match the closed sets the
 * database enforces (request_events_reason_code_check and
 * _validate_request_decision_reason in
 * 20260924090000_request_decision_workflow_expand.sql) — the database stays the
 * authority; these lists drive the dialogs and pre-validate server actions.
 */

export const DECLINE_REASON_CODES = [
  "outside_service_area",
  "no_availability",
  "unsupported_transportation_need",
  "requested_time_unavailable",
  "duplicate_request",
  "other",
] as const;

export const CANCEL_REASON_CODES = [
  "requester_cancelled",
  "no_availability",
  "unable_to_reach_requester",
  "duplicate_request",
  "other",
] as const;

export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];
export type RequestDecisionKind = "decline" | "cancel";

export const REQUEST_REASON_NOTE_MAX_LENGTH = 500;

const REASON_LABEL: Record<string, string> = {
  outside_service_area: "Outside service area",
  no_availability: "No availability",
  unsupported_transportation_need: "Transportation need not supported",
  requested_time_unavailable: "Requested time unavailable",
  duplicate_request: "Duplicate request",
  requester_cancelled: "Requester cancelled",
  unable_to_reach_requester: "Unable to reach requester",
  other: "Other",
};

export function requestReasonLabel(code: string): string {
  return REASON_LABEL[code] ?? code;
}

export function requestReasonCodes(kind: RequestDecisionKind): readonly string[] {
  return kind === "decline" ? DECLINE_REASON_CODES : CANCEL_REASON_CODES;
}

export type RequestReasonValidation =
  | { ok: true; reasonCode: string; reasonNote: string | null }
  | { ok: false };

/** Same rules as the database: a known code is required; the note is optional (≤ 500) except for `other`, where it is required. */
export function validateRequestReason(kind: RequestDecisionKind, rawCode: unknown, rawNote: unknown): RequestReasonValidation {
  const reasonCode = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!requestReasonCodes(kind).includes(reasonCode)) {
    return { ok: false };
  }
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > REQUEST_REASON_NOTE_MAX_LENGTH) {
    return { ok: false };
  }
  if (reasonCode === "other" && note.length === 0) {
    return { ok: false };
  }
  return { ok: true, reasonCode, reasonNote: note.length > 0 ? note : null };
}
