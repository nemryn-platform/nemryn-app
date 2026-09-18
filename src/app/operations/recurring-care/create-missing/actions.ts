"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapRecurringArrangementError } from "@/lib/operations/recurring-arrangement-errors";
import {
  parseOccurrenceKey,
  dedupeOccurrenceKeys,
  type BulkOccurrenceResult,
} from "@/lib/operations/recurring-care-bulk-core";

export interface BulkCreateMissingTripsState {
  status: "idle" | "done";
  results: BulkOccurrenceResult[];
}

/** Small, bounded-concurrency batch runner (§16) — never one unbounded `Promise.all` over the whole selection, never a fully serial loop either. Correctness over micro-optimization: this exists only to keep the number of simultaneous database round trips small and predictable, not to squeeze out maximum throughput. */
async function runBounded<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Bulk "Create selected Trips" — the review page's own single Server
 * Action (P1-PILOT-S2 §11). Calls the EXISTING, unmodified
 * `create_trip_for_recurring_occurrence` RPC once per unique selected
 * occurrence — never a new SQL mutation, never a duplicated body (§2's
 * own explicit "do not replace or duplicate this authority").
 *
 * INPUT AUTHORITY (§10): the browser submits ONLY `occurrenceKey` values
 * (`arrangementId::serviceDate` pairs, parsed via `parseOccurrenceKey` —
 * never trusted as anything more than two identifiers). No Passenger id,
 * pickup/destination text, pickup time, timezone, organization id, or
 * Trip state is ever accepted from the browser here — every one of those
 * facts is derived by the RPC itself, from the arrangement's own CURRENT,
 * freshly-locked row, exactly as the single-occurrence path already
 * does. `organizationId` itself comes only from `requireOperationsAccess`'s
 * trusted result, never a hidden form field.
 *
 * DEDUPLICATION (§12): `dedupeOccurrenceKeys` runs BEFORE any RPC call —
 * a duplicate key in the submitted form data (e.g. a double-click that
 * somehow submitted the same checkbox value twice) results in exactly
 * one RPC invocation, never relying solely on the RPC's own idempotency
 * to absorb an avoidable duplicate call.
 *
 * EXECUTION STRATEGY (§16): bounded concurrency, 5 calls in flight at a
 * time (`BULK_CONCURRENCY_LIMIT`) — chosen as a small, safe middle
 * ground; correctness (never an unbounded burst of simultaneous
 * requests) matters more here than shaving milliseconds off a batch of a
 * few dozen occurrences. No SAFETY-CAP row limit is imposed (§17) — the
 * realistic maximum (14-day horizon × however many weekdays an
 * arrangement's own pattern includes, across however many arrangements
 * exist) stays comfortably within what bounded concurrency handles
 * safely; imposing an arbitrary cap here would risk silently dropping a
 * genuinely selected occurrence, which this phase explicitly forbids.
 *
 * PARTIAL SUCCESS (§14): each RPC call is independently transactional.
 * A single occurrence's own failure NEVER rolls back or blocks any other
 * occurrence in the same batch — every occurrence is attempted
 * regardless of any other occurrence's own outcome, and the full,
 * truthful per-occurrence result list is always returned.
 *
 * ALREADY-SCHEDULED (§13/§25): the RPC's own `created: false` response
 * (returned for a qualifying Trip that already exists on this date —
 * whether from an earlier bulk batch, a concurrent Dispatcher, or the
 * single-occurrence "Create trip" button) maps to `ALREADY_SCHEDULED`,
 * never `FAILED` and never a second Trip.
 */
export async function bulkCreateMissingTripsAction(
  _prevState: BulkCreateMissingTripsState,
  formData: FormData,
): Promise<BulkCreateMissingTripsState> {
  const pathname = await getCurrentPathname("/operations/recurring-care/create-missing");
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  const rawKeys = formData.getAll("occurrenceKey").filter((v): v is string => typeof v === "string");
  const keys = dedupeOccurrenceKeys(rawKeys);

  const BULK_CONCURRENCY_LIMIT = 5;
  const results = await runBounded(keys, BULK_CONCURRENCY_LIMIT, async (key): Promise<BulkOccurrenceResult> => {
    const parsed = parseOccurrenceKey(key);
    if (!parsed) {
      // Structurally malformed input never reaches the RPC at all --
      // classified the same way any other invalid input is (§10's own
      // "do not trust the browser" boundary).
      return { arrangementId: "", serviceDate: "", status: "FAILED", errorCode: "INVALID_INPUT" };
    }

    const { data, error } = await supabase.rpc("create_trip_for_recurring_occurrence", {
      p_organization_id: organization.organizationId,
      p_arrangement_id: parsed.arrangementId,
      p_service_date: parsed.serviceDate,
    });

    if (error) {
      return {
        arrangementId: parsed.arrangementId,
        serviceDate: parsed.serviceDate,
        status: "FAILED",
        errorCode: mapRecurringArrangementError(error.code),
      };
    }

    return {
      arrangementId: parsed.arrangementId,
      serviceDate: parsed.serviceDate,
      status: data?.created ? "CREATED" : "ALREADY_SCHEDULED",
      tripId: data?.trip_id ?? undefined,
    };
  });

  // Revalidation (§19) — the created Trips feed every one of these
  // existing surfaces; never manually patched client state, only the
  // real Next.js revalidation this codebase already relies on elsewhere.
  revalidatePath("/operations/recurring-care");
  for (const key of keys) {
    const parsed = parseOccurrenceKey(key);
    if (parsed) revalidatePath(`/operations/recurring-care/${parsed.arrangementId}`);
  }
  revalidatePath("/operations");
  revalidatePath("/operations/trips");
  revalidatePath("/operations/tomorrow");
  revalidatePath("/operations/dispatch");

  return { status: "done", results };
}
