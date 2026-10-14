import Link from "next/link";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getPlusAccessState } from "@/lib/plus/access";
import { canEnterGrowth, plusStatusSummary } from "@/lib/plus/access-core";
import { listPlusTeamAccess } from "@/lib/plus/team-access";
import type { PlusTeamMember } from "@/lib/plus/team-access-core";
import { PlusTeamAccessSection } from "@/components/operations/settings/PlusTeamAccessSection";
import { AttentionState } from "@/components/ui/AttentionState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Nemryn Plus" };

/**
 * Settings -> Nemryn Plus (NP-P1-S2; Team access NP-P1-S3). Organization Admin only, like every Settings page.
 * - Status: READ-ONLY status of the workspace's Plus entitlement (not enabled, trial with its end date, active, not
 *   active / read-only, restricted). The entitlement has no control here: Plus is granted, extended and ended by Nemryn
 *   (ZD-207), and no billing exists.
 * - Team access (S3): while Plus is write or read_only, the Admin chooses which existing Dispatchers may use Growth
 *   (read or write) and can remove access. Not shown while restricted (locked) or not enabled -- no Plus data then.
 */
export default async function PlusSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/plus");
  const organization = await requireOrganizationAdminAccess(pathname);
  const plus = await getPlusAccessState(organization.organizationId);
  const status = plusStatusSummary(plus.state, plus.trialEndsAt, organization.organizationTimezone, new Date());

  let team: PlusTeamMember[] | null = null;
  let teamError = false;
  if (canEnterGrowth(plus.state)) {
    try {
      team = await listPlusTeamAccess(organization.organizationId);
    } catch {
      teamError = true;
    }
  }

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
          Nemryn Plus is managed by Nemryn. Changes to this workspace&apos;s Plus subscription are made by Nemryn, not from
          Settings, and never affect requests, trips, dispatch or drivers.
        </p>
      </Panel>
      {team && (
        <PlusTeamAccessSection
          members={team}
          plusWritable={plus.state === "write"}
          organizationId={organization.organizationId}
          organizationName={organization.organizationName}
        />
      )}
      {teamError && (
        <AttentionState level="warning" title="Team access could not be loaded" description="Reload the page to try again. Nobody's access was changed." />
      )}
    </div>
  );
}
