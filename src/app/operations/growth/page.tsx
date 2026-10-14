import Link from "next/link";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { isPlusReadOnly, plusCapabilitySummary, plusStatusSummary } from "@/lib/plus/access-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionState } from "@/components/ui/AttentionState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Growth" };

/**
 * NP-P1-S1 / S2 / S3 -- the Growth page. Deliberately empty of data: no contacts, leads, opportunities, revenue or
 * metrics exist yet, so none are shown, and no create / edit control is offered for tools that do not exist. It states
 * the workspace's Nemryn Plus status (active, the trial end for an Admin while a trial runs, or a read-only notice) and
 * the signed-in person's OWN access (S3: Admin, or a named Dispatcher's read / write grant).
 * (locked / none / no grant never reach this page: requirePlusAccess.)
 */
export default async function GrowthPage() {
  const pathname = await getCurrentPathname("/operations/growth");
  const { context, plus } = await requirePlusAccess(pathname);
  const readOnly = isPlusReadOnly(plus.state);
  const status = plusStatusSummary(plus.state, plus.trialEndsAt, context.organizationTimezone, new Date());
  const mine = plusCapabilitySummary(context.role, plus.state, plus.capability);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Growth"
        description={
          readOnly
            ? "Nemryn Plus is not active for this workspace."
            : "Nemryn Plus is enabled for this workspace."
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
      <Panel className="flex flex-col gap-1" data-testid="growth-contacts-link">
        <Link href="/operations/growth/contacts" className={cn(typography.subsectionHeading, "text-text-link hover:underline")}>
          Contacts
        </Link>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          The people you work with or follow up with, and a timeline of notes, calls, emails and meetings.
        </p>
      </Panel>
      <div className="flex flex-col gap-1" data-testid="plus-my-access">
        <div className="flex items-center gap-2">
          <span className={cn(typography.label, "text-text-primary")}>Your access</span>
          <StatusBadge label={mine.label} category="neutral" />
        </div>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>{mine.message}</p>
      </div>
    </div>
  );
}
