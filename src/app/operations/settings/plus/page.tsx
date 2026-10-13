import Link from "next/link";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getPlusAccessState } from "@/lib/plus/access";
import { canEnterGrowth, plusStatusSummary } from "@/lib/plus/access-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Nemryn Plus" };

/**
 * Settings -> Nemryn Plus (NP-P1-S2). Organization Admin only. READ-ONLY status of the workspace's Plus entitlement:
 * not enabled, trial (with its end date), active, not active (read-only) or restricted. There are deliberately no
 * controls: Plus is granted, extended and ended by Nemryn (ZD-207), never from the workspace, and no billing exists.
 * A restricted (locked) workspace sees only that access is restricted -- no Plus data.
 */
export default async function PlusSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/plus");
  const organization = await requireOrganizationAdminAccess(pathname);
  const plus = await getPlusAccessState(organization.organizationId);
  const status = plusStatusSummary(plus.state, plus.trialEndsAt, organization.organizationTimezone, new Date());

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Nemryn Plus"
        description="The status of the Nemryn Plus growth module for this workspace."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Nemryn Plus" }]}
      />
      <Panel className="flex flex-col gap-zw-md" data-testid="plus-settings-status">
        <SectionHeader title="Status" actions={<StatusBadge label={status.label} category={status.tone} />} />
        <p className={cn(typography.body, "text-text-primary")}>{status.message}</p>
        {canEnterGrowth(plus.state) && (
          <Link href="/operations/growth" className={cn(typography.bodySmall, "text-text-link hover:underline")}>
            Open Growth
          </Link>
        )}
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Nemryn Plus is managed by Nemryn. Changes to this workspace&apos;s Plus access are made by Nemryn, not from
          Settings, and never affect requests, trips, dispatch or drivers.
        </p>
      </Panel>
    </div>
  );
}
