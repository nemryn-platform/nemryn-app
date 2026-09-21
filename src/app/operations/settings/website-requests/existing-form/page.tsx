import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { loadWebsiteRequestsContext } from "@/lib/operations/website-requests-data";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExistingFormSetup } from "@/components/operations/settings/ExistingFormSetup";

export const metadata = { title: "Connect existing form" };

/** Settings -> Website Requests -> Connect existing form (P1-COMM-D1). Organization Admin only; guidance + copy-ready developer package. */
export default async function ExistingFormPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/settings/website-requests/existing-form");
  const organization = await requireOrganizationAdminAccess(pathname);
  const params = await searchParams;
  const { selected, endpoint } = await loadWebsiteRequestsContext(organization, params.connection);
  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Connect existing form"
        description="Keep the transportation request form you already use."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Website Requests", href: "/operations/settings/website-requests" }, { label: "Connect existing form" }]}
      />
      <ExistingFormSetup connection={selected} endpoint={endpoint} />
    </div>
  );
}
