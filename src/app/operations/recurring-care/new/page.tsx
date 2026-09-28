import Link from "next/link";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getActivePassengerOptions } from "@/lib/operations/recurring-arrangement-options";
import { getRequestDetail } from "@/lib/operations/request-detail";
import { buildRecurringPrefill, REQUEST_NOT_READY_MESSAGE } from "@/lib/operations/request-recurring-prefill-core";
import { NewRecurringArrangementForm } from "@/components/operations/recurring-care/NewRecurringArrangementForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionState } from "@/components/ui/AttentionState";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * New Recurring Arrangement (P1-E2-S1E §8) — Organization Admin/Dispatcher
 * only, via the same `requireOperationsAccess` every Operations route
 * uses. Only ACTIVE Passengers are offered (§9) — the exact same
 * restriction `create_recurring_arrangement` itself re-validates
 * server-side; this is a UX convenience, never the authority.
 *
 * P1-PILOT-R3 (PR-04): `?requestId=` loads the Request through the normal organization-scoped, RLS-bound Request
 * loader (never the service role) and prefills STRUCTURED facts only (request-recurring-prefill-core). A Request that
 * is missing, foreign, not accepted or without an active linked Passenger shows one calm message -- identical in every
 * case, so a foreign Request's existence is never revealed -- and nothing can be created.
 */
export default async function NewRecurringArrangementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/recurring-care/new");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;
  const rawRequestId = typeof params.requestId === "string" ? params.requestId : null;

  if (rawRequestId !== null) {
    const result = UUID_RE.test(rawRequestId) ? await getRequestDetail(rawRequestId, organization.organizationId) : null;
    const prefill = result?.status === "ok" ? buildRecurringPrefill(result.request.id, result.request) : null;
    if (!result || result.status !== "ok" || !prefill) {
      return (
        <div className="flex flex-col gap-zw-lg">
          <PageHeader
            title="New recurring arrangement"
            breadcrumb={[{ label: "Recurring Care", href: "/operations/recurring-care" }, { label: "New arrangement" }]}
          />
          <AttentionState
            level="warning"
            title={REQUEST_NOT_READY_MESSAGE}
            description="Recurring care can be created from an accepted request with an active linked passenger."
            action={
              result?.status === "ok" ? (
                <Link href={`/operations/requests/${result.request.id}`} className="text-text-link hover:underline">
                  Back to the request
                </Link>
              ) : (
                <Link href="/operations/requests?state=accepted" className="text-text-link hover:underline">
                  Accepted requests
                </Link>
              )
            }
          />
        </div>
      );
    }
    return (
      <NewRecurringArrangementForm
        passengers={[]}
        fromRequest={{ prefill, passengerName: result.request.passenger?.displayName ?? "" }}
      />
    );
  }

  const passengers = await getActivePassengerOptions(organization.organizationId);

  return <NewRecurringArrangementForm passengers={passengers} />;
}
