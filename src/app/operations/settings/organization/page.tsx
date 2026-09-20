import { notFound } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { OrganizationSettingsForm } from "@/components/operations/settings/OrganizationSettingsForm";

export const metadata = { title: "Organization settings" };

/**
 * Settings -> Organization (P1-PILOT-S4B-R4A). The organization is derived
 * from the authenticated workspace context -- there is no route parameter
 * or query value that could select a different tenant.
 */
export default async function OrganizationSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/organization");
  const organization = await requireOrganizationAdminAccess(pathname);

  const settings = await getOrganizationSettings(organization.organizationId);
  if (!settings) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Organization"
        description="Your business profile and operating timezone."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Organization" }]}
      />
      <OrganizationSettingsForm initialValues={settings} />
    </div>
  );
}
