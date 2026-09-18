import { ClipboardText } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRecurringArrangementsList } from "@/lib/operations/recurring-care-list";
import { flattenMissingOccurrences, type MissingOccurrenceSourceRow } from "@/lib/operations/recurring-care-bulk-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateMissingTripsReview } from "@/components/operations/recurring-care/CreateMissingTripsReview";

/**
 * Bulk missing-Trip review route (P1-PILOT-S2 §3-§4) — reached only via
 * the "Review N missing rides" entry point on the Recurring Care list
 * page, never linked from permanent sidebar navigation. Opens a review;
 * creates nothing on load (§4 — this page itself performs no mutation).
 *
 * Reuses `getRecurringArrangementsList` exactly as the list page already
 * does — no separate/duplicated arrangement or assurance query. A
 * long-ended arrangement outside the near-horizon window legitimately
 * has `assurance: null` here (recurring-care-list.ts's own documented
 * behavior) and is simply excluded from the flattened review list, since
 * it has no near-horizon occurrences to report at all.
 */
export default async function CreateMissingTripsPage() {
  const pathname = await getCurrentPathname("/operations/recurring-care/create-missing");
  const organization = await requireOperationsAccess(pathname);

  const arrangements = await getRecurringArrangementsList(organization.organizationId);
  const sourceRows: MissingOccurrenceSourceRow[] = arrangements
    .filter((a) => a.assurance !== null)
    .map((a) => ({
      arrangementId: a.id,
      passengerDisplayName: a.passengerDisplayName,
      pickupDescription: a.pickupDescription,
      destinationDescription: a.destinationDescription,
      pickupTime: a.pickupTime,
      timezone: a.timezone,
      occurrences: a.assurance!.occurrences,
    }));

  const missingRows = flattenMissingOccurrences(sourceRows);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Review missing rides"
        description="Select which occurrences to create as Trips. Nothing is created until you submit."
        breadcrumb={[
          { label: "Recurring Care", href: "/operations/recurring-care" },
          { label: "Review missing rides" },
        ]}
      />

      {missingRows.length === 0 ? (
        <EmptyState
          icon={<ClipboardText className="size-8" aria-hidden />}
          title="No missing rides."
          description="Every active recurring arrangement is already covered by a scheduled Trip for its near-term dates."
        />
      ) : (
        <CreateMissingTripsReview rows={missingRows} />
      )}
    </div>
  );
}
