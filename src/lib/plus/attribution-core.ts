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

// ---------------------------------------------------------------------------------------------------------------------
// NP-CORE-PLUS-REQUEST-02B: "Add contact" from Request Details (ZD-294 .. ZD-300). The database is the authority:
// plus_create_contact_for_request re-checks Plus write, the Core request-read role, the synthetic-only activation
// guard, tenancy, every value and duplicates, and creates + links in one transaction.
// ---------------------------------------------------------------------------------------------------------------------

/** Shown above the form: the prefill is the REQUESTER, never the passenger (ZD-296). */
export const REQUESTER_NOT_PASSENGER_NOTICE = "Requester — the person who contacted you. This is not necessarily the passenger.";

export const ADD_CONTACT_NOTICE =
  "This creates one Growth contact and links it to this request. It doesn't change the request, its decision, trips or billing, and it doesn't create an opportunity or record any communication consent.";

/** ZD-297: Core requester_relationship -> plus_contacts.contact_kind (the same mapping as inquiry conversion). */
const RELATIONSHIP_TO_CONTACT_KIND: Record<string, "individual" | "family_caregiver" | "facility_staff" | "other"> = {
  self: "individual",
  family: "family_caregiver",
  caregiver: "family_caregiver",
  facility_coordinator: "facility_staff",
  other: "other",
};
export function contactKindForRelationship(relationship: string | null | undefined): string {
  return (relationship && RELATIONSHIP_TO_CONTACT_KIND[relationship]) || "other";
}

/** The requester facts of a Core Request that may prefill the form. Deliberately has no passenger field. */
export interface RequesterFacts {
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string | null;
  requesterRelationship: string;
}

/**
 * Initial form values (the same shape as the Growth contact form) from the requester ONLY. Values are copied as given
 * -- never reformatted -- so staff see exactly what the request says and correct it where the contact rules differ.
 * Preferences start at the Growth form's defaults: phone (email when there is no phone), Do not contact unticked,
 * no owner. Nothing about consent is inferred.
 */
export function buildRequesterPrefill(r: RequesterFacts) {
  const phone = (r.requesterPhone ?? "").trim();
  const email = (r.requesterEmail ?? "").trim();
  return {
    displayName: (r.requesterName ?? "").trim(),
    phone,
    email,
    contactKind: contactKindForRelationship(r.requesterRelationship),
    jobTitle: "",
    preferredChannel: phone || !email ? "phone" : "email",
    doNotContact: false,
    ownerHandle: "",
  };
}

/**
 * NP-CORE-PLUS-REQUEST-02C-R1 (A3): the DOM id of the Request Growth panel's contact link. The panel renders it and the
 * controls move focus to it after a successful add or link.
 */
export function contactLinkId(requestId: string): string {
  return `request-growth-contact-${requestId}`;
}

/** D8 / ZD-300: offered only for an unlinked Request, a Growth writer and an enabled (synthetic-only) organization. */
export function canOfferAddContact(s: { linked: boolean; canWrite: boolean; enabled: boolean }): boolean {
  return !s.linked && s.canWrite && s.enabled;
}

export type RequestContactOutcome = "linked" | "possible_duplicates" | "already_linked";

export function requestContactOutcomeMessage(outcome: RequestContactOutcome): string {
  switch (outcome) {
    case "linked":
      return "Contact added and linked in Growth. The request itself is unchanged.";
    case "already_linked":
      return "This request is already linked in Growth, so no contact was added. Its current link is shown.";
    case "possible_duplicates":
      return "This may be someone who is already in your contacts. Nothing has been created yet: link a match below, or create a separate contact if this is a different person.";
  }
}

/** Errors from plus_create_contact_for_request. Never echoes submitted values or says why an organization is disabled. */
export function requestContactErrorMessage(code: string | undefined, reason?: string): string {
  switch (code) {
    case "ZW004":
      if (reason === "request_contact_not_enabled") return "Adding a contact from a request isn't available for this organization. You can still link an existing contact.";
      return "This request was linked in Growth by someone else just now, so no contact was added. Reload the page to see the link.";
    case "ZW006":
      return "Check the details: a name and a valid phone number or email are required, and the owner must have Nemryn Plus write access.";
    case "ZW001":
      return "You can view Growth links but not add contacts. Ask an Organization Admin for write access.";
    case "ZW002":
      return "This request isn't available. It may not exist, or you may no longer have access.";
    default:
      return "The contact couldn't be added. Try again.";
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
  if (s.arrangementCount > 0) parts.push(`standing order ${s.arrangementStatus ?? "linked"}`); // D-14 (Brand Lock v2 §6): "standing order" terminology
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
