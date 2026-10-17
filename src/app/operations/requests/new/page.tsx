import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getLogRequestFormData } from "@/lib/operations/log-request";
import { LogRequestForm } from "@/components/operations/requests/LogRequestForm";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { serviceRequestedOptions } from "@/lib/operations/log-request-options";
import { SERVICE_TYPE_LABELS, SERVICE_TYPE_VALUES } from "@/lib/public-intake/website-intake-core";

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

  // NC-REQUEST-SERVICE-TYPE-S1 (OD-S1 = A): offer the organization's configured Services (Admins and Dispatchers may
  // read them), or every canonical service when none are configured. A failed read is NOT "none configured": then only
  // "Not specified" is offered, with a short note, and the Request can still be logged. No error detail is shown.
  let configured: string[] | null;
  try {
    configured = await getServiceOfferings(organization.organizationId);
  } catch {
    configured = null;
  }
  const serviceOptions = serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, configured);

  return <LogRequestForm passengers={passengers} serviceOptions={serviceOptions} serviceOptionsUnavailable={configured === null} />;
}
