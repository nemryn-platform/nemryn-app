import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { PageHeader } from "@/components/ui/PageHeader";
import { ServiceOfferingsForm } from "@/components/operations/settings/ServiceOfferingsForm";

export const metadata = { title: "Services & Intake" };

/**
 * Settings -> Services & Intake (P1-PILOT-S4B-R4C). Organization Admin only.
 * Which canonical transportation services this organization provides -- and
 * therefore which service types its website intake accepts once configured.
 * Not pricing, payers or licensing.
 */
export default async function ServicesSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/services");
  const organization = await requireOrganizationAdminAccess(pathname);
  const enabled = await getServiceOfferings(organization.organizationId);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Services & Intake"
        description="Choose the transportation services your organization provides."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Services & Intake" }]}
      />
      <ServiceOfferingsForm enabled={enabled} />
    </div>
  );
}
