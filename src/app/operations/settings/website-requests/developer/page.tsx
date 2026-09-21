import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { loadWebsiteRequestsContext } from "@/lib/operations/website-requests-data";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeveloperSetup } from "@/components/operations/settings/DeveloperSetup";

export const metadata = { title: "Developer setup" };

/** Settings -> Website Requests -> Developer setup (P1-COMM-D1). The technical surface: endpoint, Integration ID, Origin rule, payload, acquisition, testing. */
export default async function DeveloperSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/settings/website-requests/developer");
  const organization = await requireOrganizationAdminAccess(pathname);
  const params = await searchParams;
  const { selected, endpoint } = await loadWebsiteRequestsContext(organization, params.connection);
  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Developer setup"
        description="Connect your website directly using Nemryn's website intake API."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Website Requests", href: "/operations/settings/website-requests" }, { label: "Developer setup" }]}
      />
      <DeveloperSetup connection={selected} endpoint={endpoint} />
    </div>
  );
}
