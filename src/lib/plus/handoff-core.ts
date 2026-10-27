/**
 * Growth -> Core handoff rules (NP-PILOT-P1). Runtime-import free (unit-tested under plain Node: handoff-core.test.mjs).
 * Only data the opportunity / contact / inquiry / quote ALREADY hold is suggested, every suggestion is editable, and nothing
 * is decided for staff: no passenger is ever pre-selected or created here. The database re-checks everything
 * (plus_convert_opportunity_to_request, plus_create_rebooking_request -> Core log_transportation_request).
 */

/** Core requester_relationship values (transportation_requests). */
export type CoreRelationship = "self" | "family" | "caregiver" | "facility_coordinator" | "other";

const FROM_INQUIRY: Record<string, CoreRelationship> = {
  self: "self",
  family: "family",
  caregiver: "caregiver",
  facility_staff: "facility_coordinator",
  other: "other",
};
const FROM_CONTACT_KIND: Record<string, CoreRelationship> = {
  family_caregiver: "family",
  facility_staff: "facility_coordinator",
};

export interface HandoffPrefill {
  requesterRelationship: CoreRelationship | null;
  returnTripNeeded: "yes" | null;
  /** Plain-language "where did this come from" notes shown next to the prefilled fields. */
  notes: string[];
}

/**
 * Suggested values for the conversion / rebooking form.
 * - Who is requesting: the inquiry's own answer when the opportunity came from a website inquiry; otherwise only an
 *   unambiguous contact kind (family / caregiver -> family, facility staff -> facility coordinator). An "individual"
 *   contact suggests nothing (the existing default stays).
 * - Return trip: "yes" only when the newest ACCEPTED (else newest SENT) quote was priced as a round trip. Never "no" from
 *   a quote, never a date, time, address or assistance need (none of that is stored before the request).
 */
export function handoffPrefill(input: {
  inquiryRelationship?: string | null;
  contactKind?: string | null;
  quotes?: { quoteNumber: number; kind: string; status: string; roundTrip: boolean; isExpired?: boolean }[];
}): HandoffPrefill {
  const notes: string[] = [];
  let requesterRelationship: CoreRelationship | null = null;
  if (input.inquiryRelationship && FROM_INQUIRY[input.inquiryRelationship]) {
    requesterRelationship = FROM_INQUIRY[input.inquiryRelationship];
    notes.push("Who is requesting: from their website inquiry.");
  } else if (input.contactKind && FROM_CONTACT_KIND[input.contactKind]) {
    requesterRelationship = FROM_CONTACT_KIND[input.contactKind];
    notes.push("Who is requesting: from the contact type.");
  }
  let returnTripNeeded: "yes" | null = null;
  const quotes = input.quotes ?? [];
  const pick = quotes.filter((q) => q.status === "accepted").sort((a, b) => b.quoteNumber - a.quoteNumber)[0]
    ?? quotes.filter((q) => q.status === "sent" && !q.isExpired).sort((a, b) => b.quoteNumber - a.quoteNumber)[0];
  if (pick?.roundTrip) {
    returnTripNeeded = "yes";
    notes.push(`Return trip: ${pick.kind === "estimate" ? "estimate" : "quote"} ${pick.quoteNumber} was priced as a round trip.`);
  }
  return { requesterRelationship, returnTripNeeded, notes };
}

export const digitsOf = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const nameKey = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface PassengerChoice {
  id: string;
  displayName: string;
  phone: string | null;
  /** Why it is suggested (never a decision): previous rides for this contact, same phone, same name. */
  match: "previous" | "phone" | "name" | null;
}

/**
 * Orders the organization's ACTIVE passengers for the optional "Who will ride?" choice: passengers already linked to
 * this contact's earlier requests first, then a phone match (10+ digits), then an exact name match, then everyone else
 * alphabetically. A match is a hint only -- nothing is pre-selected; staff must pick and confirm.
 */
export function rankPassengerChoices(
  passengers: { id: string; displayName: string; phone: string | null }[],
  contact: { name: string; phone: string | null },
  previousPassengerIds: readonly string[] = [],
): PassengerChoice[] {
  const phone = digitsOf(contact.phone);
  const name = nameKey(contact.name);
  const prev = new Set(previousPassengerIds);
  const order = { previous: 0, phone: 1, name: 2 } as const;
  return passengers
    .map((p) => {
      const match: PassengerChoice["match"] = prev.has(p.id)
        ? "previous"
        : phone.length >= 10 && digitsOf(p.phone) === phone
          ? "phone"
          : name !== "" && nameKey(p.displayName) === name
            ? "name"
            : null;
      return { ...p, match };
    })
    .sort((a, b) => (a.match ? order[a.match] : 9) - (b.match ? order[b.match] : 9) || a.displayName.localeCompare(b.displayName));
}

export const PASSENGER_MATCH_LABELS: Record<NonNullable<PassengerChoice["match"]>, string> = {
  previous: "rode before for this contact",
  phone: "same phone as the contact",
  name: "same name as the contact",
};

export const RIDER_NAME_MAX = 200; // the requested-passenger snapshot limit Core shares with the website intake

/**
 * The optional passenger part of the form (NP-PILOT-P1, D1-D3): EITHER an existing passenger (explicitly confirmed) OR a
 * rider name for a new passenger (recorded on the request for Core's Add New Passenger), or neither ("decide on the request
 * page"). Never both. The rider name is only ever what staff typed -- the form may suggest the contact's name when staff
 * tick "the requester is the rider", but nothing here assumes it.
 */
export function parsePassengerChoice(raw: { passengerId: unknown; passengerConfirmed: unknown; riderName?: unknown }):
  | { ok: true; passengerId: string | null; riderName: string | null }
  | { ok: false; error: string; field: "passenger" | "riderName" } {
  const id = typeof raw.passengerId === "string" ? raw.passengerId.trim() : "";
  const name = typeof raw.riderName === "string" ? raw.riderName.trim() : "";
  if (id !== "" && name !== "") return { ok: false, error: "Choose an existing passenger OR enter a new rider's name, not both.", field: "riderName" };
  if (name !== "") {
    if (name.length > RIDER_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: `Use at most ${RIDER_NAME_MAX} characters.`, field: "riderName" };
    return { ok: true, passengerId: null, riderName: name };
  }
  if (id === "") return { ok: true, passengerId: null, riderName: null };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: "Choose a passenger from the list.", field: "passenger" };
  if (raw.passengerConfirmed !== "yes") return { ok: false, error: "Confirm that this is the person who will ride, or choose “Decide on the request page”.", field: "passenger" };
  return { ok: true, passengerId: id, riderName: null };
}
