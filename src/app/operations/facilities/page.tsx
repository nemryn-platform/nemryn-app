import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getFacilitiesList } from "@/lib/operations/facilities-list";
import { FacilitiesPageClient } from "@/components/operations/facilities/FacilitiesPageClient";

/**
 * The canonical Facility directory (P1-E3-S8B1, real Create/Edit added
 * P1-E3-S9 — closes GAP-13). Facility is not Organization: this list is
 * the operator's own referring clinics/dialysis centers/etc., scoped to
 * their tenant only, never the Zenward organization itself.
 */
export default async function FacilitiesListPage() {
  const pathname = await getCurrentPathname("/operations/facilities");
  const organization = await requireOperationsAccess(pathname);
  const rows = await getFacilitiesList(organization.organizationId);

  return (
    <FacilitiesPageClient rows={rows} />
  );
}
