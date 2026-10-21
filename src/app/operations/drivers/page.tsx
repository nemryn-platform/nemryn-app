import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getDriversList } from "@/lib/operations/drivers-list";
import { getDriverInvitesList } from "@/lib/operations/driver-invites-list";
import { getDriverScheduleOverviews } from "@/lib/operations/availability";
import { DriversPageClient } from "@/components/operations/drivers/DriversPageClient";

/**
 * The canonical Driver directory (P1-E3-S8B1; real Invite added
 * P1-E3-S9 — closes GAP-15). Never shows "Available" — only a real
 * current-trip fact ("On [Passenger]'s trip") or nothing, matching the
 * identical restraint DriverCapacityPanel already established on
 * Dispatch (GAP-6, still open). Invite Driver is Organization Admin
 * only — see docs/product/driver-invite-linkage-model.md.
 */
export default async function DriversListPage() {
  const pathname = await getCurrentPathname("/operations/drivers");
  const organization = await requireOperationsAccess(pathname);
  const canInvite = organization.role === "organization_admin";

  const [rows, invites] = await Promise.all([
    getDriversList(organization.organizationId),
    canInvite ? getDriverInvitesList(organization.organizationId) : Promise.resolve([]),
  ]);

  // P1-OPS-PROG5B: working hours + time off for every listed driver (one batched load).
  const availability = await getDriverScheduleOverviews(organization.organizationId, organization.organizationTimezone, rows.map((r) => r.id));

  return (
    <DriversPageClient rows={rows} invites={invites} canInvite={canInvite} availability={availability} timezone={organization.organizationTimezone} />
  );
}
