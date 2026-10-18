/**
 * Conversion & rebooking -- pure rules (NP-P2-S4). Runtime-import-free (unit-tested under plain Node:
 * booking-core.test.mjs).
 *
 * Both actions create ONE pending Core transportation request through Core's own log_transportation_request (called by
 * plus_convert_opportunity_to_request / plus_create_rebooking_request as the signed-in staff member). Core stays the
 * authority: the Request is reviewed in Operations; no ride, driver, payment or trip is confirmed here. These rules
 * mirror Core's own field contract so staff get clear messages before the database re-checks everything.
 */

/** Mirrors log_transportation_request's own limits and closed sets. */
export const BOOKING_LIMITS = { location: 2000, notes: 4000 } as const;
export const RELATIONSHIP_VALUES = ["self", "family", "caregiver", "facility_coordinator", "other"] as const;
export const RETURN_TRIP_VALUES = ["yes", "no", "not_sure"] as const;
export const CORE_SOURCE_VALUES = ["phone", "facility", "email", "web", "other"] as const;

export const BOOKING_PENDING_NOTE =
  "This creates a pending transportation request for Operations to review. No ride is confirmed, no driver is assigned and no trip is scheduled yet.";
export const BOOKING_SUCCESS_MESSAGE = "Transportation request created. Awaiting Operations review.";

/**
 * OD-6 (NP-P2-S4-R3): a staff-visible reminder in the booking form, driven ONLY by the contact's stored do_not_contact
 * preference (plus_contacts, read tenant-scoped through getContact). Never inferred from activity, never treated as
 * consent, never blocks the internal Request, and nothing is sent either way.
 *   true            -> warning: this person asked not to be contacted
 *   false           -> no notice
 *   null/undefined  -> preference not available here: a neutral reminder that asserts nothing about this person
 */
export const DO_NOT_CONTACT_BOOKING_TITLE = "This person asked not to be contacted";
export const DO_NOT_CONTACT_BOOKING_NOTE =
  "Create this request only if they asked for this ride. Creating a transportation request does not send them a message; respect their preference when Operations follows up.";
export const CONTACT_PREFERENCE_REMINDER =
  "Before contacting this person, check their communication preferences. Creating a transportation request does not send a message.";

export type DoNotContactNotice =
  | { kind: "do_not_contact"; title: string; description: string }
  | { kind: "reminder"; description: string };

export function doNotContactNotice(doNotContact: boolean | null | undefined): DoNotContactNotice | null {
  if (doNotContact === true) return { kind: "do_not_contact", title: DO_NOT_CONTACT_BOOKING_TITLE, description: DO_NOT_CONTACT_BOOKING_NOTE };
  if (doNotContact === false) return null;
  return { kind: "reminder", description: CONTACT_PREFERENCE_REMINDER };
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export interface BookingFormValues {
  requesterRelationship: string;
  pickupDescription: string;
  destinationDescription: string;
  returnTripNeeded: string;
  preferredDate: string;
  preferredTime: string;
  assistanceNotes: string;
  additionalNotes: string;
  /** rebooking only (conversion maps the opportunity's own source) */
  source: string;
}

export type BookingFieldErrors = Partial<Record<keyof BookingFormValues | "serviceType", string>>;

/** NP-P2-S4.1-S2: a rebooking's optional "Service requested" was not one of the listed services (the action and Core re-check). */
export const BOOKING_SERVICE_ERROR = "Choose a service from the list, or leave Service requested as Not specified.";

export interface BookingInput {
  requesterRelationship: string;
  pickupDescription: string;
  destinationDescription: string;
  returnTripNeeded: string;
  preferredDate: string | null;
  preferredTime: string | null;
  assistanceNotes: string | null;
  additionalNotes: string | null;
  source: string;
}

const has = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** Server-side validation of the staff-entered Core fields (the database and Core re-check everything). */
export function validateBookingForm(values: BookingFormValues, opts: { needsSource: boolean }): { ok: true; value: BookingInput } | { ok: false; errors: BookingFieldErrors } {
  const errors: BookingFieldErrors = {};
  const pickup = values.pickupDescription.trim();
  const destination = values.destinationDescription.trim();
  const assistance = values.assistanceNotes.trim();
  const additional = values.additionalNotes.trim();
  const date = values.preferredDate.trim();
  const time = values.preferredTime.trim();
  if (!has(RELATIONSHIP_VALUES, values.requesterRelationship)) errors.requesterRelationship = "Choose who is requesting the ride.";
  if (!pickup) errors.pickupDescription = "Enter the pickup location.";
  else if (pickup.length > BOOKING_LIMITS.location) errors.pickupDescription = `Use ${BOOKING_LIMITS.location} characters or fewer.`;
  if (!destination) errors.destinationDescription = "Enter the destination.";
  else if (destination.length > BOOKING_LIMITS.location) errors.destinationDescription = `Use ${BOOKING_LIMITS.location} characters or fewer.`;
  if (!has(RETURN_TRIP_VALUES, values.returnTripNeeded)) errors.returnTripNeeded = "Say whether a return trip is needed.";
  if (date && !DATE_RE.test(date)) errors.preferredDate = "Choose a valid date.";
  if (time && !TIME_RE.test(time)) errors.preferredTime = "Choose a valid time.";
  if (assistance.length > BOOKING_LIMITS.notes) errors.assistanceNotes = `Use ${BOOKING_LIMITS.notes} characters or fewer.`;
  if (additional.length > BOOKING_LIMITS.notes) errors.additionalNotes = `Use ${BOOKING_LIMITS.notes} characters or fewer.`;
  if (opts.needsSource && !has(CORE_SOURCE_VALUES, values.source)) errors.source = "Choose how the request came in.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      requesterRelationship: values.requesterRelationship,
      pickupDescription: pickup,
      destinationDescription: destination,
      returnTripNeeded: values.returnTripNeeded,
      preferredDate: date || null,
      preferredTime: time || null,
      assistanceNotes: assistance || null,
      additionalNotes: additional || null,
      source: values.source,
    },
  };
}

/** The idempotency key carried by one submit (retries reuse it). Not proof of anything: the database re-checks authority. */
export function isIdempotencyKey(raw: unknown): raw is string {
  return typeof raw === "string" && KEY_RE.test(raw);
}

/** Opportunity source -> the Core source the Request will record (mirrors _plus_core_request_source). */
export function coreSourceForOpportunity(source: string): string {
  switch (source) {
    case "phone":
    case "email":
    case "facility":
      return source;
    case "website":
    case "web_inquiry":
      return "web";
    default:
      return "other";
  }
}

/**
 * Plain-words error copy. `reason` is the database exception message, which distinguishes refusals sharing a code.
 * Never shows SQL text.
 */
export function bookingErrorMessage(code: string | undefined, reason?: string): string {
  switch (code) {
    case "ZW004":
      if (reason === "already_converted") return "This opportunity has already been converted. Open its transportation request below.";
      if (reason === "linked_request_exists")
        return "This opportunity is already linked to a transportation request. Open that request instead of creating another one.";
      return "This opportunity is closed. Reopen it first if the customer still needs a ride.";
    case "ZW003":
      return "This opportunity changed since you opened it. Reload the page to see the latest, then try again.";
    case "ZW006":
      if (reason === "contact_phone_required") return "Add a phone number to the contact first. Operations needs one to review the request.";
      if (reason === "contact_not_active") return "This contact is archived. Only an active contact can have a new transportation request.";
      return "Check the transportation details: pickup, destination, who is requesting and whether a return trip is needed.";
    case "ZW001":
      return "You can view this record but can't create transportation requests. Ask an Organization Admin for access.";
    case "ZW002":
      return "This record isn't available, or you don't have permission to create transportation requests.";
    default:
      // (after a timeout the first attempt may have succeeded: a retry with the same key returns it, never a duplicate)
      return "The request couldn't be confirmed. It's safe to try again -- the same request will never be created twice.";
  }
}
