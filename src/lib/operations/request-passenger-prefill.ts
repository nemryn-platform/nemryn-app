/**
 * Add New Passenger prefill from a Request (P1-OPS-R1A). Pure, no runtime imports.
 *
 * The ONLY source is the Request's `requested_passenger_name` snapshot. Requester name / phone / email are never
 * used: the requester and the passenger may be different people (a family member booking for a parent). No
 * fallback is guessed when the snapshot is absent. The result is an editable initial value; the Passenger record
 * holds what the operator confirms, and the Request snapshot is never modified.
 */
export interface RequestPassengerPrefill {
  displayName: string;
  phone: string;
}

export function requestPassengerPrefill(requestedPassengerName: string | null | undefined): RequestPassengerPrefill {
  return { displayName: requestedPassengerName?.trim() ?? "", phone: "" };
}
