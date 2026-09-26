import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getVehiclesList } from "@/lib/operations/vehicles-list";
import { getVehicleAvailabilityOverviews } from "@/lib/operations/availability";
import { PageHeader } from "@/components/ui/PageHeader";
import { FleetPageClient } from "@/components/operations/fleet/FleetPageClient";

/**
 * The canonical Fleet directory (P1-E3-S8B1, real Create/Edit added
 * P1-E3-S9 — closes GAP-14). Never claims an accessibility capability
 * the schema doesn't model.
 */
export default async function FleetListPage() {
  const pathname = await getCurrentPathname("/operations/fleet");
  const organization = await requireOperationsAccess(pathname);
  const rows = await getVehiclesList(organization.organizationId);
  // P1-OPS-PROG5B: recorded equipment + out-of-service windows (one batched load). Vehicle create / edit and equipment
  // edits are Organization Admin only (matching RLS); out-of-service windows are Admin + Dispatcher.
  const availability = await getVehicleAvailabilityOverviews(organization.organizationId, organization.organizationTimezone, rows.map((r) => r.id));
  const isAdmin = organization.role === "organization_admin";

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="Fleet" description="Your organization's vehicles and their current assignment." />
      <FleetPageClient rows={rows} availability={availability} isAdmin={isAdmin} timezone={organization.organizationTimezone} />
    </div>
  );
}
