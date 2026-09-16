import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getLogRequestFormData } from "@/lib/operations/log-request";
import { LogRequestForm } from "@/components/operations/requests/LogRequestForm";

/**
 * Internal Log Request (P1-E1-S2C) — fast demand capture for an
 * authenticated operator (phone call, facility call, email, manual
 * coordination). Organization Admin/Dispatcher only, via the same
 * `requireOperationsAccess` every other Operations route uses — a
 * Driver-role Membership is redirected before this component ever runs.
 *
 * Deliberately reachable only by direct navigation in this phase — the
 * Request Hub queue (S2D) and the sidebar entry (deferred, per S2A §22)
 * do not exist yet, so nothing currently links here. This route was
 * explicitly authorized to exist ahead of the queue per the phase's own
 * instruction, rather than waiting for S2D merely to have a place to
 * host it.
 */
export default async function LogRequestPage() {
  const pathname = await getCurrentPathname("/operations/requests/new");
  const organization = await requireOperationsAccess(pathname);

  const { passengers } = await getLogRequestFormData(organization.organizationId);

  return <LogRequestForm passengers={passengers} />;
}
