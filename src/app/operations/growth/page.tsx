import Link from "next/link";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly, plusCapabilitySummary, plusStatusSummary } from "@/lib/plus/access-core";
import {
  getGrowthDashboard,
  listAttentionOpportunities,
  listRecentActivities,
  type AttentionOpportunity,
  type GrowthDashboard,
  type RecentActivity,
} from "@/lib/plus/agent";
import { recommendationTitle } from "@/lib/plus/agent-core";
import { activityTypeLabel, formatContactTime } from "@/lib/plus/contacts-core";
import { OPEN_STAGES, stageDisplayLabel, stageLabel } from "@/lib/plus/opportunities-core";
import { listTasks, type TaskRow } from "@/lib/plus/tasks";
import { dueLabel } from "@/lib/plus/tasks-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionState } from "@/components/ui/AttentionState";
import { LinkButton } from "@/components/ui/LinkButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Panel } from "@/components/ui/Panel";
import { RunReviewButton } from "@/components/growth/GrowthAgent";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Growth" };

function Metric({ label, value, href, tone = "default", testId }: { label: string; value: number; href: string; tone?: "default" | "critical"; testId: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-elevated p-zw-md hover:bg-surface-hover focus-visible:bg-surface-hover"
      data-testid={testId}
    >
      <span className={cn(typography.metadata, "text-text-secondary")}>{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums", tone === "critical" && value > 0 ? "text-critical-text" : "text-text-primary")} data-testid={`${testId}-value`}>
        {value}
      </span>
    </Link>
  );
}

function TaskLines({ rows, tz, empty }: { rows: TaskRow[]; tz: string; empty: string }) {
  if (rows.length === 0) return <p className={cn(typography.bodySmall, "text-text-secondary")}>{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {rows.map((t) => (
        <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
          <span className="min-w-0">
            <span className={cn(typography.bodySmall, "block break-words font-medium text-text-primary")}>{t.title}</span>
            <span className={cn(typography.metadata, "text-text-secondary")}>
              {t.opportunityId ? (
                <Link href={`/operations/growth/pipeline/${t.opportunityId}`} className="text-text-link hover:underline">
                  {t.opportunityTitle}
                </Link>
              ) : t.contactId ? (
                <Link href={`/operations/growth/contacts/${t.contactId}`} className="text-text-link hover:underline">
                  {t.contactName}
                </Link>
              ) : null}
              {t.assigneeName ? ` · ${t.assigneeName}` : " · Unassigned"}
            </span>
          </span>
          <span className={cn(typography.metadata, t.isOverdue ? "text-critical-text" : "text-warning-text")}>{dueLabel(t.dueAt, { overdue: t.isOverdue, today: t.isDueToday }, tz)}</span>
        </li>
      ))}
    </ul>
  );
}

function activityLine(a: RecentActivity): string {
  if (a.type === "stage_changed") return `${stageLabel(a.fromStage ?? "")} → ${stageDisplayLabel(a.toStage ?? "")}`;
  return activityTypeLabel(a.type);
}

/**
 * Growth -> Dashboard (NP-P2-S2, Phase C) at /operations/growth. The operational Growth view: real counts from one
 * server-side aggregate (plus_growth_dashboard), the private-pay stage overview, what needs attention (overdue / due-today
 * tasks and the Growth Agent's deterministic attention list), recent activity, quick actions and the Growth Agent
 * preview. Every number is the caller's own organization's (plus_can_read). No conversion, booking, revenue or quote
 * outcome is shown -- those arrive with P2-S3 / S4 / S5 / S8. Operations Overview is unchanged.
 */
export default async function GrowthDashboardPage() {
  const pathname = await getCurrentPathname("/operations/growth");
  const { context, plus } = await requirePlusAccess(pathname);
  const readOnly = isPlusReadOnly(plus.state);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const tz = context.organizationTimezone;
  const status = plusStatusSummary(plus.state, plus.trialEndsAt, tz, new Date());
  const mine = plusCapabilitySummary(context.role, plus.state, plus.capability);

  let dash: GrowthDashboard | null = null;
  let overdue: TaskRow[] = [];
  let today: TaskRow[] = [];
  let attention: AttentionOpportunity[] = [];
  let recent: RecentActivity[] = [];
  try {
    [dash, overdue, today, attention, recent] = await Promise.all([
      getGrowthDashboard(context.organizationId),
      listTasks(context.organizationId, { view: "overdue", limit: 5 }).then((r) => r.rows),
      listTasks(context.organizationId, { view: "today", limit: 5 }).then((r) => r.rows),
      listAttentionOpportunities(context.organizationId, 5),
      listRecentActivities(context.organizationId, 8),
    ]);
  } catch {
    dash = null;
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Growth"
        description={readOnly ? "Nemryn Plus is not active for this workspace." : "Your private-pay pipeline, follow-ups and what needs attention."}
        actions={<StatusBadge label={`Plus: ${status.label}`} category={status.tone} />}
      />
      {readOnly && <AttentionState level="info" title="Nemryn Plus is not active" description="Your records are kept. Operations are not affected." />}
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

      {dash === null ? (
        <AttentionState
          level="critical"
          title="The dashboard couldn't be loaded"
          description="Try again in a moment."
          action={
            <LinkButton href="/operations/growth" variant="outline" size="sm">
              Retry
            </LinkButton>
          }
        />
      ) : (
        <>
          {/* A. summary */}
          <section aria-label="Summary" className="grid grid-cols-2 gap-zw-md md:grid-cols-5" data-testid="growth-summary">
            <Metric label="Active opportunities" value={dash.activeOpportunities} href="/operations/growth/pipeline" testId="metric-active" />
            <Metric label="New inquiries" value={dash.stages.new_inquiry} href="/operations/growth/pipeline?stage=new_inquiry&layout=list" testId="metric-new" />
            <Metric label="Contacts" value={dash.activeContacts} href="/operations/growth/contacts" testId="metric-contacts" />
            <Metric label="Open tasks" value={dash.openTasks} href="/operations/growth/tasks" testId="metric-open-tasks" />
            <Metric label="Overdue tasks" value={dash.overdueTasks} href="/operations/growth/tasks?view=overdue" tone="critical" testId="metric-overdue" />
          </section>

          {/* B. pipeline overview */}
          <Panel className="flex flex-col gap-zw-md" data-testid="growth-stage-overview">
            <SectionHeader
              title="Private-pay pipeline"
              actions={
                <Link href="/operations/growth/pipeline" className={cn(typography.bodySmall, "text-text-link hover:underline")}>
                  Open pipeline
                </Link>
              }
            />
            <ol className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {OPEN_STAGES.map((s) => (
                <li key={s}>
                  <Link href={`/operations/growth/pipeline?stage=${s}&layout=list`} className="flex flex-col rounded-sm bg-surface-secondary px-3 py-2 hover:bg-surface-hover" data-testid="stage-count" data-stage={s}>
                    <span className={cn(typography.metadata, "text-text-secondary")}>{stageDisplayLabel(s)}</span>
                    <span className="text-xl font-semibold tabular-nums text-text-primary">{dash!.stages[s]}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className={cn(typography.metadata, "text-text-muted")}>Open opportunities only. Booking outcomes appear once conversion to Operations requests is available.</p>
          </Panel>

          <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-2">
            {/* C. needs attention */}
            <Panel className="flex flex-col gap-zw-md" data-testid="growth-needs-attention">
              <SectionHeader title="Needs attention" />
              <div className="flex flex-col gap-1">
                <p className={cn(typography.label, "text-text-primary")}>Overdue tasks ({dash.overdueTasks})</p>
                <TaskLines rows={overdue} tz={tz} empty="Nothing is overdue." />
              </div>
              <div className="flex flex-col gap-1">
                <p className={cn(typography.label, "text-text-primary")}>Due today ({dash.dueTodayTasks})</p>
                <TaskLines rows={today} tz={tz} empty="Nothing else is due today." />
              </div>
              <div className="flex flex-col gap-1" data-testid="growth-attention-opportunities">
                <p className={cn(typography.label, "text-text-primary")}>Opportunities that may need follow-up ({dash.attentionOpportunities})</p>
                {attention.length === 0 ? (
                  <p className={cn(typography.bodySmall, "text-text-secondary")}>Every open opportunity has recent recorded activity or a planned follow-up.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border-subtle">
                    {attention.map((a) => (
                      <li key={a.opportunityId} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <Link href={`/operations/growth/pipeline/${a.opportunityId}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                            {a.title}
                          </Link>
                          <span className={cn(typography.metadata, "block text-text-secondary")}>
                            {a.contactName} · {stageDisplayLabel(a.stage)}
                          </span>
                        </span>
                        <span className={cn(typography.metadata, "text-text-secondary")}>
                          {recommendationTitle(a.type)} · {a.signalDays} {a.signalDays === 1 ? "day" : "days"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            <div className="flex flex-col gap-zw-lg">
              {/* F. Growth Agent preview */}
              <Panel className="flex flex-col gap-zw-md" data-testid="growth-agent-preview">
                <SectionHeader title="Growth Agent" />
                <p className={cn(typography.bodySmall, "text-text-primary")}>
                  <span className="font-semibold tabular-nums" data-testid="agent-pending-count">{dash.pendingRecommendations}</span>{" "}
                  {dash.pendingRecommendations === 1 ? "recommendation needs" : "recommendations need"} review.
                </p>
                <p className={cn(typography.metadata, "text-text-secondary")}>Suggestions only — the agent never sends messages, places calls or changes stages.</p>
                <div className="flex flex-wrap items-start gap-2">
                  <LinkButton href="/operations/growth/agent" variant="outline" size="sm" data-testid="agent-view">
                    View recommendations
                  </LinkButton>
                  {canWrite && <RunReviewButton organizationId={context.organizationId} />}
                </div>
              </Panel>

              {/* E. quick actions */}
              <Panel className="flex flex-col gap-zw-md" data-testid="growth-quick-actions">
                <SectionHeader title="Quick actions" />
                <div className="flex flex-wrap gap-2">
                  {canWrite && (
                    <>
                      <LinkButton href="/operations/growth/pipeline/new" size="sm" data-testid="quick-new-opportunity">
                        New opportunity
                      </LinkButton>
                      <LinkButton href="/operations/growth/contacts/new" size="sm" variant="outline" data-testid="quick-new-contact">
                        New contact
                      </LinkButton>
                      <LinkButton href="/operations/growth/tasks" size="sm" variant="outline" data-testid="quick-new-task">
                        New task
                      </LinkButton>
                    </>
                  )}
                  <LinkButton href="/operations/growth/pipeline" size="sm" variant="text" data-testid="quick-pipeline">
                    Open Pipeline
                  </LinkButton>
                  <LinkButton href="/operations/growth/tasks" size="sm" variant="text" data-testid="quick-tasks">
                    Open Tasks
                  </LinkButton>
                </div>
              </Panel>

              {/* D. recent activity */}
              <Panel className="flex flex-col gap-zw-md" data-testid="growth-recent-activity">
                <SectionHeader title="Recent activity" />
                {recent.length === 0 ? (
                  <p className={cn(typography.bodySmall, "text-text-secondary")}>Nothing recorded yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border-subtle">
                    {recent.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <span className={cn(typography.bodySmall, "block font-medium text-text-primary")}>{activityLine(a)}</span>
                          <span className={cn(typography.metadata, "text-text-secondary")}>
                            {a.opportunityId ? (
                              <Link href={`/operations/growth/pipeline/${a.opportunityId}`} className="text-text-link hover:underline">
                                {a.opportunityTitle}
                              </Link>
                            ) : a.contactId ? (
                              <Link href={`/operations/growth/contacts/${a.contactId}`} className="text-text-link hover:underline">
                                {a.contactName}
                              </Link>
                            ) : null}
                            {a.actorName ? ` · ${a.actorName}` : ""}
                          </span>
                        </span>
                        <span className={cn(typography.metadata, "text-text-muted")}>{formatContactTime(a.occurredAt, tz)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}

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
