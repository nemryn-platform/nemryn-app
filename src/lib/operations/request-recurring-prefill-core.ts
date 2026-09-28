/**
 * Pure Request -> Recurring Care prefill (P1-PILOT-R3, PR-04). Runtime-import-free (unit-tested under plain Node).
 *
 * STRUCTURED FACTS ONLY. The form is prefilled from the Request's stored structured fields; nothing is inferred:
 *   - pickup time starts EMPTY (D-R3-4). The Request holds an APPOINTMENT time, which is shown beside the field as
 *     context only -- never copied, never offset (no "appointment - 30 minutes"), never route-derived.
 *   - wheelchair = "yes" ONLY when service_type = 'wheelchair_transportation'; otherwise "unspecified". Never derived
 *     from assistance / additional notes, Passenger history or any free text.
 *   - return expectation (D-R3-5) is a hint only: never a second arrangement, never swapped addresses, never a return
 *     time.
 *   - no free text (assistance / additional notes) is copied: the arrangement model has no equivalent reviewed field.
 * create_recurring_arrangement re-validates the Request (accepted, same organization, linked Passenger).
 */

export interface RecurringPrefillRequestFacts {
  state: string;
  passenger: { id: string; status: string } | null;
  pickupDescription: string;
  destinationDescription: string;
  serviceType: string | null;
  /** transportation_requests.return_trip_needed ('yes' | 'no' | 'not_sure'). */
  returnTripNeeded: string;
  recurringSchedule: {
    daysOfWeek: number[];
    startDate: string;
    endDate: string | null;
    appointmentTime: string | null;
    returnTripExpected: boolean | null;
  } | null;
}

export interface RecurringPrefill {
  requestId: string;
  passengerId: string;
  pickupDescription: string;
  destinationDescription: string;
  /** Always "" -- the operator chooses the pickup time (D-R3-4). */
  pickupTime: "";
  daysOfWeek: number[];
  startDate: string;
  endDate: string;
  wheelchair: "yes" | "unspecified";
  /** Context only (HH:MM), never a default: "Requested appointment time: ...". */
  appointmentTime: string | null;
  /** Show "Return trip expected" + the one-schedule note. */
  returnTripExpected: boolean;
}

/** The Request carries a STRUCTURED recurring schedule (days + start are stored together, by constraint). */
export function hasRecurringIntent(facts: Pick<RecurringPrefillRequestFacts, "recurringSchedule">): boolean {
  return facts.recurringSchedule !== null && facts.recurringSchedule.daysOfWeek.length > 0;
}

/** Eligible to be turned into Recurring Care right now: accepted with an ACTIVE linked Passenger (the RPC's own rule). */
export function isReadyForRecurringCare(facts: Pick<RecurringPrefillRequestFacts, "state" | "passenger">): boolean {
  return facts.state === "accepted" && facts.passenger !== null && facts.passenger.status === "active";
}

/** Either structured return field says yes (return_trip_needed = 'yes', or recurring_return_trip_expected = true). */
export function isReturnTripExpected(facts: Pick<RecurringPrefillRequestFacts, "returnTripNeeded" | "recurringSchedule">): boolean {
  return facts.returnTripNeeded === "yes" || facts.recurringSchedule?.returnTripExpected === true;
}

/** "10:00:00" / "10:00" -> "10:00"; anything else -> null. */
function hhmm(value: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
}

/** null when the Request is not ready (the page shows a calm "no longer ready" message instead of a form). */
export function buildRecurringPrefill(requestId: string, facts: RecurringPrefillRequestFacts): RecurringPrefill | null {
  if (!isReadyForRecurringCare(facts) || facts.passenger === null) return null;
  const schedule = facts.recurringSchedule;
  return {
    requestId,
    passengerId: facts.passenger.id,
    pickupDescription: facts.pickupDescription,
    destinationDescription: facts.destinationDescription,
    pickupTime: "",
    daysOfWeek: schedule ? [...schedule.daysOfWeek] : [],
    startDate: schedule?.startDate ?? "",
    endDate: schedule?.endDate ?? "",
    wheelchair: facts.serviceType === "wheelchair_transportation" ? "yes" : "unspecified",
    appointmentTime: hhmm(schedule?.appointmentTime),
    returnTripExpected: isReturnTripExpected(facts),
  };
}

export const RETURN_TRIP_HINT_TITLE = "Return trip expected";
export const RETURN_TRIP_HINT_BODY =
  "This arrangement covers one recurring schedule. Create another arrangement if the return needs its own schedule.";
export const REQUEST_NOT_READY_MESSAGE = "This request is no longer ready for recurring care.";
