import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getRecurringCareAssurance, type RecurringArrangementAssurance } from "./recurring-care";

/**
 * Recurring Care LIST read model (P1-E2-S1E) — the descriptive/identity
 * fields (Passenger, pattern, pickup time, route, status) a list row needs
 * to identify a standing commitment, joined in application code against
 * the authoritative assurance evaluator's own output (never reimplemented
 * — see recurring-care.ts/recurring-care-core.ts). `RecurringArrangement
 * Assurance` itself carries no descriptive fields (by design — it answers
 * only "is the near-horizon covered," never "what is this arrangement"),
 * so a list page needs both; this module is the one place that combines
 * them, rather than every page/component re-deriving the join.
 *
 * Exactly 2 round trips total: one direct, unfiltered arrangement query
 * (every status — active/paused/ended all shown, §5) run CONCURRENTLY
 * with `getRecurringCareAssurance`'s own already-bounded 4-query fetch
 * (Promise.all) — never N+1 relative to arrangement count.
 *
 * A long-ended arrangement whose own effective end date falls outside
 * `getRecurringCareAssurance`'s coarse near-horizon window will correctly
 * have `assurance: null` here — not a bug: that arrangement genuinely has
 * no current near-horizon occurrences to report, and the list row falls
 * back to showing its own descriptive/status fields only (see the list
 * page's own rendering for the exact fallback copy).
 */

export type RecurringArrangementListStatus = "active" | "paused" | "ended";

export interface RecurringArrangementListRow {
  id: string;
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
  status: RecurringArrangementListStatus;
  assurance: RecurringArrangementAssurance | null;
}

interface PassengerEmbed {
  display_name: string;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

interface ArrangementListDbRow {
  id: string;
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
}

const LIST_COLUMNS =
  "id, passenger_id, passengers!recurring_arrangements_passenger_id_organization_id_fkey(display_name), " +
  "pickup_description, destination_description, pickup_time, days_of_week, start_date, end_date, timezone, status";

export async function getRecurringArrangementsList(
  organizationId: string,
  now: Date = new Date(),
): Promise<RecurringArrangementListRow[]> {
  const supabase = await createServerSupabaseClient();

  const [{ data: rows, error }, assurances] = await Promise.all([
    supabase
      .from("recurring_arrangements")
      .select(LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .returns<ArrangementListDbRow[]>(),
    getRecurringCareAssurance(organizationId, now),
  ]);

  if (error) {
    throw new Error(`Failed to load recurring arrangements list: ${error.message}`);
  }

  const assuranceByArrangementId = new Map(assurances.map((a) => [a.arrangementId, a]));

  return (rows ?? []).map((row) => ({
    id: row.id,
    passengerId: row.passenger_id,
    passengerDisplayName: unwrapOne(row.passengers)?.display_name ?? "Unknown Passenger",
    pickupDescription: row.pickup_description,
    destinationDescription: row.destination_description,
    pickupTime: row.pickup_time,
    daysOfWeek: row.days_of_week,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    status: row.status as RecurringArrangementListStatus,
    assurance: assuranceByArrangementId.get(row.id) ?? null,
  }));
}
