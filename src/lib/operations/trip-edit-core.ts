/**
 * Pure Trip-correction policy (P1-PILOT-R2B, PR-01). Runtime-import-free (unit-tested under plain Node); the time
 * helper is injected. The database (update_trip_details) is the authority and re-checks every rule here -- this core
 * only lets the UI show the SAME rules before Save (locked fields, the service-date rules, what actually changed).
 */

/** The eight Trip detail fields owned by update_trip_details (duration / wheelchair keep their own setters). */
export const TRIP_EDIT_FIELDS = [
  "scheduled_pickup_at",
  "appointment_at",
  "pickup_description",
  "pickup_facility_id",
  "destination_description",
  "destination_facility_id",
  "instructions",
  "assistance_notes",
] as const;
export type TripEditField = (typeof TRIP_EDIT_FIELDS)[number];

const ALL: readonly TripEditField[] = TRIP_EDIT_FIELDS;
const AFTER_PICKUP_ARRIVAL: readonly TripEditField[] = ["appointment_at", "destination_description", "destination_facility_id", "instructions", "assistance_notes"];
const IN_TRIP: readonly TripEditField[] = ["appointment_at", "destination_description", "destination_facility_id", "instructions"];

/** Owner-approved lifecycle matrix (R2A section 4 + D-5). Unknown / terminal states: nothing editable. */
const EDITABLE_BY_STATE: Record<string, readonly TripEditField[]> = {
  scheduled: ALL,
  en_route_to_pickup: ALL,
  arrived_at_pickup: AFTER_PICKUP_ARRIVAL,
  passenger_onboard: IN_TRIP,
  en_route_to_destination: IN_TRIP,
};

export function editableFields(state: string): readonly TripEditField[] {
  return EDITABLE_BY_STATE[state] ?? [];
}

/** Whether Edit Trip is offered at all (at least one field is legally editable). */
export function canEditTrip(state: string): boolean {
  return editableFields(state).length > 0;
}

export function isFieldEditable(state: string, field: TripEditField): boolean {
  return editableFields(state).includes(field);
}

/** Concise lifecycle banner shown in the edit dialog (null = none). */
export function tripEditBanner(state: string): string | null {
  if (state === "en_route_to_pickup") return "The driver may already be on the way to pickup.";
  if (state === "passenger_onboard" || state === "en_route_to_destination") return "The passenger is on board. Changes are recorded as in-trip corrections.";
  return null;
}

/** User-facing field labels (the audit / timeline never shows database column names). */
export const TRIP_EDIT_FIELD_LABEL: Record<TripEditField, string> = {
  scheduled_pickup_at: "Pickup time",
  appointment_at: "Appointment",
  pickup_description: "Pickup address",
  pickup_facility_id: "Pickup facility",
  destination_description: "Destination address",
  destination_facility_id: "Destination facility",
  instructions: "Instructions",
  assistance_notes: "Assistance",
};

export function tripEditFieldLabels(fields: readonly string[]): string[] {
  return fields.filter((f): f is TripEditField => (TRIP_EDIT_FIELDS as readonly string[]).includes(f)).map((f) => TRIP_EDIT_FIELD_LABEL[f]);
}

export interface TripEditValues {
  /** ISO instant or null. */
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  pickupDescription: string | null;
  pickupFacilityId: string | null;
  destinationDescription: string | null;
  destinationFacilityId: string | null;
  instructions: string | null;
  assistanceNotes: string | null;
}

/** The same normalization the RPC applies: trim; blank -> null. */
export function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Fields that actually change (after normalizing both sides -- whitespace-only differences are a no-op). */
export function changedFields(current: TripEditValues, proposed: TripEditValues): TripEditField[] {
  const out: TripEditField[] = [];
  if (!sameInstant(current.scheduledPickupAt, proposed.scheduledPickupAt)) out.push("scheduled_pickup_at");
  if (!sameInstant(current.appointmentAt, proposed.appointmentAt)) out.push("appointment_at");
  if (normalizeText(current.pickupDescription) !== normalizeText(proposed.pickupDescription)) out.push("pickup_description");
  if ((current.pickupFacilityId ?? null) !== (proposed.pickupFacilityId ?? null)) out.push("pickup_facility_id");
  if (normalizeText(current.destinationDescription) !== normalizeText(proposed.destinationDescription)) out.push("destination_description");
  if ((current.destinationFacilityId ?? null) !== (proposed.destinationFacilityId ?? null)) out.push("destination_facility_id");
  if (normalizeText(current.instructions) !== normalizeText(proposed.instructions)) out.push("instructions");
  if (normalizeText(current.assistanceNotes) !== normalizeText(proposed.assistanceNotes)) out.push("assistance_notes");
  return out;
}

/** Injected organization-local date function (local-time-core's localDateKeyOf in the app). */
export type LocalDateKeyOf = (ms: number, timezone: string) => string;

export type ServiceDateCheck = "ok" | "en_route_date_change" | "recurring_date_change";

/**
 * The two service-date rules for a pickup-time change:
 *  - recurring occurrence: the ARRANGEMENT-local date can never change (any state);
 *  - en_route_to_pickup: the ORGANIZATION-local date can not change (the driver is already travelling for it).
 * A trip without a current pickup has no date to keep.
 */
export function checkServiceDate(input: {
  state: string;
  currentPickupAt: string | null;
  proposedPickupAt: string | null;
  organizationTimezone: string;
  recurringTimezone: string | null;
  localDateKeyOf: LocalDateKeyOf;
}): ServiceDateCheck {
  const { currentPickupAt, proposedPickupAt } = input;
  if (currentPickupAt === null || proposedPickupAt === null || sameInstant(currentPickupAt, proposedPickupAt)) return "ok";
  const cur = new Date(currentPickupAt).getTime();
  const next = new Date(proposedPickupAt).getTime();
  if (input.recurringTimezone && input.localDateKeyOf(cur, input.recurringTimezone) !== input.localDateKeyOf(next, input.recurringTimezone)) {
    return "recurring_date_change";
  }
  if (input.state === "en_route_to_pickup" && input.localDateKeyOf(cur, input.organizationTimezone) !== input.localDateKeyOf(next, input.organizationTimezone)) {
    return "en_route_date_change";
  }
  return "ok";
}

export function serviceDateMessage(check: ServiceDateCheck): string | null {
  if (check === "recurring_date_change") return "A recurring trip keeps its date. To move it, skip the date in Recurring Care and create a one-time trip.";
  if (check === "en_route_date_change") return "The driver is already on the way, so the pickup date can't change. Only the time can.";
  return null;
}
