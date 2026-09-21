import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getWebsiteRequestForm } from "@/lib/operations/website-request-form";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { loadWebsiteRequestsContext } from "@/lib/operations/website-requests-data";
import { DEFAULT_FORM_CONFIG } from "@/lib/operations/website-requests-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { NemrynFormEditor } from "@/components/operations/settings/NemrynFormEditor";

export const metadata = { title: "Nemryn form" };

/** Settings -> Website Requests -> Use a Nemryn form (P1-COMM-D1): configuration + safe preview. No public/hosted form exists yet (D2). */
export default async function NemrynFormPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/settings/website-requests/form");
  const organization = await requireOrganizationAdminAccess(pathname);
  const params = await searchParams;
  const [saved, orgServices, ctx] = await Promise.all([
    getWebsiteRequestForm(organization.organizationId),
    getServiceOfferings(organization.organizationId),
    loadWebsiteRequestsContext(organization, params.connection),
  ]);
  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Use a Nemryn form"
        description="Choose how your transportation request form looks. Nemryn handles the rest."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Website Requests", href: "/operations/settings/website-requests" }, { label: "Nemryn form" }]}
      />
      <NemrynFormEditor
        organizationName={organization.organizationName}
        saved={saved}
        initial={saved ?? DEFAULT_FORM_CONFIG}
        orgServices={orgServices}
        connectionHandle={ctx.selected?.handle ?? null}
        websiteManager={ctx.selected?.websiteManager ?? null}
      />
    </div>
  );
}
