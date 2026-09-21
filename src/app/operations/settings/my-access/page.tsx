import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getMyAccessSummary } from "@/lib/operations/self-driver";
import { MyDriverAccessCard } from "@/components/operations/settings/MyDriverAccessCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "My Access" };

/**
 * Settings -> My Access (P1-PILOT-S5A1). PERSONAL: what THIS signed-in account can
 * do in the current organization -- distinct from Team & Access, which manages
 * OTHER staff. Organization Admin only, like every Settings page (a Dispatcher or
 * Driver never reaches Settings; the guard redirects them exactly as elsewhere).
 * Shows no ids, role codes or raw data. Membership role and Driver identity stay
 * separate: this page can add Driver access to the same account, never change the
 * Organization Admin role.
 */
export default async function MyAccessPage() {
  const pathname = await getCurrentPathname("/operations/settings/my-access");
  const organization = await requireOrganizationAdminAccess(pathname);
  const me = await getMyAccessSummary(organization);

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <PageHeader
        title="My Access"
        description="What you can do with this account in this organization."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "My Access" }]}
      />

      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="My account" />
        <dl className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <div className="min-w-0">
            <dt className={cn(typography.label, "text-text-muted")}>Name</dt>
            <dd className={cn(typography.body, "mt-0.5 min-w-0 break-words text-text-primary")}>{me.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className={cn(typography.label, "text-text-muted")}>Email</dt>
            <dd className={cn(typography.body, "mt-0.5 min-w-0 break-all text-text-primary")}>{me.email ?? "Unknown"}</dd>
          </div>
          <div className="min-w-0">
            <dt className={cn(typography.label, "text-text-muted")}>Organization</dt>
            <dd className={cn(typography.body, "mt-0.5 min-w-0 break-words text-text-primary")}>{me.organizationName}</dd>
          </div>
          <div>
            <dt className={cn(typography.label, "text-text-muted")}>Operations access</dt>
            <dd className={cn(typography.body, "mt-0.5 text-text-primary")}>{me.operationsAccess}</dd>
          </div>
        </dl>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Driver access" />
        <MyDriverAccessCard state={me.driverAccess} suggestedName={me.suggestedName} suggestedPhone={me.suggestedPhone} />
      </Panel>
    </div>
  );
}
