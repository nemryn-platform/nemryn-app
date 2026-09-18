import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getRecurringCareAssuranceForArrangement, type RecurringArrangementAssurance } from "./recurring-care";

/**
 * Recurring Care DETAIL read model (P1-E2-S1E) — mirrors getTripDetail's/
 * getRequestDetail's own discriminated-result contract exactly:
 * "unavailable" (does not exist OR foreign-org — deliberately
 * indistinguishable, no existence oracle) vs "error" (a genuine query
 * failure, distinct so the page can render a Retry affordance rather than
 * a bare not-found notice) vs "ok". Composes
 * getRecurringCareAssuranceForArrangement (recurring-care.ts) for the
 * occurrence/assurance data — never reimplements any of that logic here.
 */

export interface RecurringArrangementDetailFacts {
  id: string;
  organizationId: string;
  passengerId: string;
  passengerDisplayName: string;
  pickupDescription: string;
  destinationDescription: string;
  /** `HH:mm:ss`, local wall-clock in `timezone` below. */
  pickupTime: string;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  timezone: string;
  status: "active" | "paused" | "ended";
  pausedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
}

export type RecurringArrangementDetailResult =
  | { status: "unavailable" }
  | { status: "error" }
  | { status: "ok"; arrangement: RecurringArrangementDetailFacts; assurance: RecurringArrangementAssurance };

interface PassengerEmbed {
  display_name: string;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

interface ArrangementDetailDbRow {
  id: string;
  organization_id: string;
  passenger_id: string;
  passengers: PassengerRelation;
  pickup_description: string;
  destination_description: string;
  pickup_time: string;
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
  timezone: string;
  status: string;
  paused_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
}

const DETAIL_COLUMNS =
  "id, organization_id, passenger_id, passengers!recurring_arrangements_passenger_id_organization_id_fkey(display_name), " +
  "pickup_description, destination_description, pickup_time, days_of_week, start_date, end_date, timezone, status, " +
  "paused_at, ended_at, ended_reason";

export async function getRecurringArrangementDetail(
  organizationId: string,
  arrangementId: string,
  now: Date = new Date(),
): Promise<RecurringArrangementDetailResult> {
  try {
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("recurring_arrangements")
      .select(DETAIL_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", arrangementId)
      .maybeSingle()
      .returns<ArrangementDetailDbRow | null>();

    if (error) {
      return { status: "error" };
    }
    if (!data) {
      return { status: "unavailable" };
    }

    const assurance = await getRecurringCareAssuranceForArrangement(organizationId, arrangementId, now);
    if (!assurance) {
      // Defensive — cannot normally happen given the row above was just
      // confirmed to exist in this exact organization, matching the same
      // "cannot happen given the .in() filter above" defensive comment
      // style already established in recurring-care.ts itself.
      return { status: "unavailable" };
    }

    return {
      status: "ok",
      arrangement: {
        id: data.id,
        organizationId: data.organization_id,
        passengerId: data.passenger_id,
        passengerDisplayName: unwrapOne(data.passengers)?.display_name ?? "Unknown Passenger",
        pickupDescription: data.pickup_description,
        destinationDescription: data.destination_description,
        pickupTime: data.pickup_time,
        daysOfWeek: data.days_of_week,
        startDate: data.start_date,
        endDate: data.end_date,
        timezone: data.timezone,
        status: data.status as RecurringArrangementDetailFacts["status"],
        pausedAt: data.paused_at,
        endedAt: data.ended_at,
        endedReason: data.ended_reason,
      },
      assurance,
    };
  } catch {
    return { status: "error" };
  }
}
