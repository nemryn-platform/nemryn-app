import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { listRecommendations } from "@/lib/plus/agent";
import { AGENT_IS_ASSISTANT_NOTE, AGENT_THRESHOLDS } from "@/lib/plus/agent-core";
import { toRecommendationView } from "@/lib/plus/agent-view";
import { listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { AttentionState } from "@/components/ui/AttentionState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Sparkle } from "@phosphor-icons/react/dist/ssr";
import { RecommendationQueue, RunReviewButton, type RecommendationView } from "@/components/growth/GrowthAgent";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Growth Agent" };

/**
 * Growth -> Growth Agent (NP-P2-S2, Phase D). Staff-supervised recommendations from a deterministic review of this
 * workspace's pipeline. Read through plus_list_agent_recommendations (Plus read); "Review opportunities", "Create
 * follow-up task" and dismissal require Plus write and are re-checked in the database. The agent never sends, calls,
 * changes stages or marks anything lost; message drafts are local, labelled NOT SENT, and never stored.
 */
export default async function GrowthAgentPage() {
  const pathname = await getCurrentPathname("/operations/growth/agent");
  const { context, plus } = await requirePlusAccess(pathname);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const tz = context.organizationTimezone;

  let pending: RecommendationView[] | null = null;
  let reviewed: RecommendationView[] = [];
  try {
    const [p, r] = await Promise.all([
      listRecommendations(context.organizationId, "pending"),
      listRecommendations(context.organizationId, "reviewed", 20),
    ]);
    pending = p.rows.map((x) => toRecommendationView(x, tz, context.organizationName));
    reviewed = r.rows.map((x) => toRecommendationView(x, tz, context.organizationName));
  } catch {
    pending = null;
  }
  let owners: OwnerOption[] = [];
  if (canWrite) {
    try {
      owners = await listOwnerOptions(context.organizationId);
    } catch {
      owners = [];
    }
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Growth Agent"
        description="Suggested follow-ups from a review of your pipeline. You decide what happens."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Growth Agent" }]}
        actions={canWrite ? <RunReviewButton organizationId={context.organizationId} /> : undefined}
      />
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Recommendations are kept and can be viewed, but no review or approval can run until Plus is active again." />
      )}
      {/* NP-UI-V2-3 final polish: the explainer is guidance -- a Brand Lock v2 mint panel with an icon header; same text. */}
      <Panel surface="mint" className="flex flex-col gap-zw-sm" data-testid="agent-explainer">
        <SectionHeader as="h2" title="How the Growth Agent works" icon={<Sparkle />} tone="accent" />
        <p className={cn(typography.bodySmall, "text-text-primary")}>{AGENT_IS_ASSISTANT_NOTE}</p>
        <p className={cn(typography.metadata, "text-text-secondary")}>
          Internal-test rules: a new inquiry with nothing recorded after {AGENT_THRESHOLDS.newInquiryWaitingDays} days; no reply recorded{" "}
          {AGENT_THRESHOLDS.awaitingResponseDays} days after a logged call or email; nothing recorded for {AGENT_THRESHOLDS.noRecentActivityDays} days. Opportunities
          that already have an open task are skipped. These thresholds are for testing, not final policy.
        </p>
      </Panel>
      {pending === null ? (
        <AttentionState level="critical" title="Recommendations couldn't be loaded" description="Reload the page to try again." />
      ) : (
        <RecommendationQueue
          pending={pending}
          reviewed={reviewed}
          canWrite={canWrite}
          organizationId={context.organizationId}
          owners={owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }))}
          selfHandle={owners.find((o) => o.isSelf)?.handle ?? null}
        />
      )}
    </div>
  );
}
