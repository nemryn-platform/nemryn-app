import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { isPlusReadOnly, plusStatusSummary } from "@/lib/plus/access-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionState } from "@/components/ui/AttentionState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Growth" };

/**
 * NP-P1-S1 / S2 -- the Growth page. Deliberately empty of data: no contacts, leads, opportunities, revenue or metrics
 * exist yet, so none are shown. It states the workspace's Nemryn Plus status only: active, the trial end while a trial
 * runs, or a read-only notice once Plus is no longer active. (locked / none never reach this page: requirePlusAccess.)
 */
export default async function GrowthPage() {
  const pathname = await getCurrentPathname("/operations/growth");
  const { context, plus } = await requirePlusAccess(pathname);
  const readOnly = isPlusReadOnly(plus.state);
  const status = plusStatusSummary(plus.state, plus.trialEndsAt, context.organizationTimezone, new Date());

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Growth"
        description={
          readOnly
            ? "Nemryn Plus is not active for this workspace."
            : "Nemryn Plus is enabled for this workspace. Growth tools will appear here."
        }
        actions={<StatusBadge label={`Plus: ${status.label}`} category={status.tone} />}
      />
      {readOnly && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your records are kept. Operations are not affected." />
      )}
      {!readOnly && status.trialEnd && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="plus-trial-end">
          Trial ends {status.trialEnd}
          {status.trialDaysLeft !== null && status.trialDaysLeft > 0 ? ` (${status.trialDaysLeft} ${status.trialDaysLeft === 1 ? "day" : "days"} left)` : ""}.
        </p>
      )}
      {!readOnly && !status.trialEnd && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="plus-active">
          {status.message}
        </p>
      )}
    </div>
  );
}
