import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getActivePassengerOptions } from "@/lib/operations/recurring-arrangement-options";
import { NewRecurringArrangementForm } from "@/components/operations/recurring-care/NewRecurringArrangementForm";

/**
 * New Recurring Arrangement (P1-E2-S1E §8) — Organization Admin/Dispatcher
 * only, via the same `requireOperationsAccess` every Operations route
 * uses. Only ACTIVE Passengers are offered (§9) — the exact same
 * restriction `create_recurring_arrangement` itself re-validates
 * server-side; this is a UX convenience, never the authority.
 */
export default async function NewRecurringArrangementPage() {
  const pathname = await getCurrentPathname("/operations/recurring-care/new");
  const organization = await requireOperationsAccess(pathname);

  const passengers = await getActivePassengerOptions(organization.organizationId);

  return <NewRecurringArrangementForm passengers={passengers} />;
}
