/**
 * Client-safe types + presentation helpers for New Trip's option lists
 * (P1-E3-S7) — split out from `new-trip.ts` (which is `server-only`, since
 * it queries Supabase directly) so the client-side `NewTripForm` can import
 * the shapes/formatters it needs without pulling a server-only module into
 * the browser bundle.
 */

export interface NewTripPassengerOption {
  id: string;
  displayName: string;
  phone: string | null;
}

export interface NewTripFacilityOption {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

/**
 * P1-E1-S2F-B1: eligibility (state pending/accepted AND passenger_id IS
 * NOT NULL AND linked Passenger active — enforced server-side in
 * `new-trip.ts`) now guarantees every option here already has a real,
 * active, resolved Passenger — `passengerId`/`passengerDisplayName` are
 * therefore non-null. `requesterName`/`requesterRelationship` were
 * removed: once eligibility guarantees a resolved Passenger, the
 * Passenger's own identity is what New Trip actually needs to bind and
 * display (§7) — the requester's name/relationship added no further
 * value to this specific form and was dropped to keep this DTO narrow
 * (never expose requester PII a screen doesn't actually use).
 */
export interface NewTripRequestOption {
  id: string;
  passengerId: string;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  preferredDate: string | null;
  preferredTime: string | null;
  assistanceNotes: string | null;
  /** P1-OPS-PROG5B: the Request's structured service type -- only 'wheelchair_transportation' is used, to PREFILL (never decide) the trip's wheelchair requirement. */
  serviceType: string | null;
}

/** `Emory Dialysis · Atlanta, GA` style — matches Trip Detail's own Facility annotation format (ZD-152) for visual/product consistency across screens. */
export function formatFacilityOptionLabel(facility: NewTripFacilityOption): string {
  const cityState = [facility.city, facility.state].filter(Boolean).join(", ");
  return cityState ? `${facility.name} · ${cityState}` : facility.name;
}

/** The Facility's own canonical address, formatted as a starting address snapshot when the Facility is selected — the user may still edit it freely afterward (work item §18/§20: populate, don't force). */
export function formatFacilityAddress(facility: NewTripFacilityOption): string {
  const lines = [facility.addressLine1, facility.addressLine2].filter(Boolean);
  const cityStateZip = [facility.city, [facility.state, facility.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [facility.name, ...lines, cityStateZip].filter(Boolean).join(", ");
}

/**
 * `Mary Johnson — preferred Aug 29` (or just the Passenger name when no
 * preferred date was given) — real fields only, never a raw UUID (work
 * item §14). P1-E1-S2F-B1: shows the Passenger's own name, not the
 * requester's — now that eligibility guarantees every option has a
 * resolved Passenger, that identity is the authoritative one for the
 * Trip this option would create (matching Request Hub's own established
 * "linked Passenger is the primary identity" convention, S2D §14).
 */
export function formatRequestOptionLabel(request: NewTripRequestOption): string {
  return request.preferredDate
    ? `${request.passengerDisplayName} — preferred ${request.preferredDate}`
    : request.passengerDisplayName;
}
