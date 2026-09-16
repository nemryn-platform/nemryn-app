import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getNewTripFormData } from "@/lib/operations/new-trip";
import { NewTripForm } from "@/components/operations/new-trip/NewTripForm";

/**
 * Internal New Trip (P1-E3-S7) —
 * docs/design/stitch/references/05-internal-new-trip.png. See
 * docs/product/new-trip-data-map.md for the full field-level rationale.
 * Backend-ready since P1-E3-S0A (`create_trip`) — this phase is UI-only.
 * Organization Admin/Dispatcher only, via the same `requireOperationsAccess`
 * every other Operations route uses (work item §6) — a Driver-role
 * Membership is redirected before this component ever runs.
 *
 * P1-E1-S2F-B1 §13/§14: supports `?requestId=<uuid>`, reached from
 * Request Detail's own "Create Trip"/"Create Another Trip" action.
 * `requestId` is treated as REQUESTED CONTEXT ONLY — resolved by a
 * simple membership check against `requests`, the SAME already-
 * fetched, already org-scoped, already eligibility-filtered list this
 * page renders the dropdown from (no second query, no existence
 * oracle of any kind: a malformed, nonexistent, foreign-org, or
 * currently-ineligible id all produce the identical "not found in this
 * list" outcome, and are never distinguished from one another).
 */
export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/trips/new");
  const organization = await requireOperationsAccess(pathname);

  const { passengers, facilities, requests } = await getNewTripFormData(organization.organizationId);

  const params = await searchParams;
  const requestedId = typeof params.requestId === "string" ? params.requestId : null;
  const preselectedRequest = requestedId ? (requests.find((r) => r.id === requestedId) ?? null) : null;
  // Supplied but not found in the eligible list, for ANY reason —
  // malformed, nonexistent, foreign-org, or currently ineligible —
  // shows the same restrained notice; never distinguishes why (§13).
  const requestUnavailable = requestedId !== null && preselectedRequest === null;

  return (
    <NewTripForm
      passengers={passengers}
      facilities={facilities}
      requests={requests}
      organizationTimezone={organization.organizationTimezone}
      preselectedRequestId={preselectedRequest?.id ?? null}
      requestUnavailable={requestUnavailable}
    />
  );
}
