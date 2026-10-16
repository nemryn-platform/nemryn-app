/**
 * Request attribution -- pure rules (NP-P2-S3). Runtime-import-free (unit-tested under plain Node:
 * attribution-core.test.mjs).
 *
 * An attribution REFERENCES an existing Core transportation request from Growth (a contact and/or a private-pay
 * opportunity). It never creates, changes, accepts, declines or cancels the Request, and linking is NOT a sales
 * conversion: the opportunity stage never changes here (conversion is P2-S4). The database is the authority:
 * plus_link_request / plus_update_request_attribution re-check Plus write, the Core request-read role, tenancy,
 * consistency and the version.
 */

export const ATTRIBUTION_REASON_LIMITS = { min: 3, max: 500 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (raw: unknown): raw is string => typeof raw === "string" && UUID_RE.test(raw);

/** How the link was made, in plain words. Never says "converted" for a manual link. */
export function linkMethodLabel(method: string): string {
  switch (method) {
    case "linked_existing_request":
      return "Linked to an existing request";
    case "converted_from_opportunity":
      return "Created from an opportunity";
    case "rebooking":
      return "Rebooking";
    default:
      return "Linked";
  }
}

/**
 * NP-P2-S4-R5-F1: a link made by "Create transportation request" is permanent (the database refuses any change with
 * ZW004 conversion_link_immutable), so no "Correct link" is offered for it. Manual links and rebookings stay
 * correctable as before (the database keeps its own rules for each).
 */
export const CONVERSION_LINK_NOTE = "This request was created from this opportunity, so the link can't be changed.";
export const CONVERSION_LINK_IMMUTABLE_MESSAGE = "A request created from an opportunity stays linked to it.";
export function isLinkCorrectable(method: string): boolean {
  return method !== "converted_from_opportunity";
}

export interface AttributionChoice {
  contactId: string | null;
  opportunityId: string | null;
}

/** Posted contact / opportunity ids -> a choice. At least one is required; malformed ids are refused. */
export function parseAttributionChoice(rawContact: unknown, rawOpportunity: unknown): { ok: true; value: AttributionChoice } | { ok: false; error: string } {
  const c = typeof rawContact === "string" && rawContact !== "" ? rawContact : null;
  const o = typeof rawOpportunity === "string" && rawOpportunity !== "" ? rawOpportunity : null;
  if ((c !== null && !isUuid(c)) || (o !== null && !isUuid(o))) return { ok: false, error: "Choose a contact from the list." };
  if (c === null && o === null) return { ok: false, error: "Choose a contact (and, optionally, one of their opportunities)." };
  return { ok: true, value: { contactId: c, opportunityId: o } };
}

/** A correction needs a short reason (3-500 characters, trimmed). */
export function validateCorrectionReason(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < ATTRIBUTION_REASON_LIMITS.min) return { ok: false, error: "Say briefly why the link is being corrected." };
  if (v.length > ATTRIBUTION_REASON_LIMITS.max) return { ok: false, error: `Use ${ATTRIBUTION_REASON_LIMITS.max} characters or fewer.` };
  return { ok: true, value: v };
}

export function attributionErrorMessage(code: string | undefined, reason?: string): string {
  switch (code) {
    case "ZW004":
      if (reason === "conversion_link_immutable") return CONVERSION_LINK_IMMUTABLE_MESSAGE;
      return "This request is already linked in Growth. Use “Correct link” to change it.";
    case "ZW003":
      return "This link changed since you opened it. Reload the page to see the latest, then try again.";
    case "ZW006":
      return "Check the link: choose an active contact, and an opportunity only if it belongs to that contact.";
    case "ZW001":
      return "You can view Growth links but not change them. Ask an Organization Admin for write access.";
    case "ZW002":
      return "That request, contact or opportunity isn't available. It may not exist, or you may no longer have access.";
    default:
      return "That link couldn't be saved. Try again.";
  }
}

/**
 * The Request's real Core status, as Growth shows it. Derived live from Core at read time (plus_get_request_summaries)
 * -- never inferred from the opportunity stage, and never labelled a sales conversion.
 */
export function requestOutcomeLine(s: {
  state: string;
  tripsTotal: number;
  tripsCompleted: number;
  tripsCancelled: number;
  arrangementCount: number;
  arrangementStatus: string | null;
}): string {
  const parts: string[] = [];
  if (s.tripsTotal > 0) {
    parts.push(`${s.tripsTotal} ${s.tripsTotal === 1 ? "trip" : "trips"}`);
    if (s.tripsCompleted > 0) parts.push(`${s.tripsCompleted} completed`);
    if (s.tripsCancelled > 0) parts.push(`${s.tripsCancelled} cancelled or no-show`);
  }
  if (s.arrangementCount > 0) parts.push(`recurring care ${s.arrangementStatus ?? "linked"}`);
  if (parts.length === 0) return s.state === "pending" ? "Waiting for an Operations decision" : "No trips yet";
  return parts.join(" · ");
}

const REASON_CODE_LABELS: Record<string, string> = {
  outside_service_area: "Outside service area",
  no_availability: "No availability",
  unsupported_transportation_need: "Unsupported transportation need",
  requested_time_unavailable: "Requested time unavailable",
  duplicate_request: "Duplicate request",
  requester_cancelled: "Requester cancelled",
  unable_to_reach_requester: "Unable to reach requester",
  other: "Other",
};
/** The Core decline / cancel reason CODE as a label (the free-text reason note is never shown in Growth). */
export function decisionReasonLabel(code: string | null): string | null {
  return code ? (REASON_CODE_LABELS[code] ?? "Other") : null;
}
