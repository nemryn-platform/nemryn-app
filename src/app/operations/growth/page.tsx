import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { formatTrialEnd, isPlusReadOnly, trialDaysRemaining } from "@/lib/plus/access-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionState } from "@/components/ui/AttentionState";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Growth" };

/**
 * NP-P1-S1 -- the first Growth page. Deliberately empty of data: no contacts, leads, opportunities, revenue or
 * metrics exist yet, so none are shown. It only states the workspace's Nemryn Plus status: the trial end while a trial
 * runs, and a read-only notice once Plus is no longer active.
 */
export default async function GrowthPage() {
  const pathname = await getCurrentPathname("/operations/growth");
  const { context, plus } = await requirePlusAccess(pathname);
  const readOnly = isPlusReadOnly(plus.state);
  const trialEnd = formatTrialEnd(plus.trialEndsAt, context.organizationTimezone);
  const daysLeft = trialDaysRemaining(new Date(), plus.trialEndsAt);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Growth"
        description={
          readOnly
            ? "Nemryn Plus is not active for this workspace."
            : "Nemryn Plus is enabled for this workspace. Growth tools will appear here."
        }
      />
      {readOnly && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your records are kept. Operations are not affected." />
      )}
      {!readOnly && trialEnd && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="plus-trial-end">
          Trial ends {trialEnd}
          {daysLeft !== null && daysLeft > 0 ? ` (${daysLeft} ${daysLeft === 1 ? "day" : "days"} left)` : ""}.
        </p>
      )}
    </div>
  );
}
