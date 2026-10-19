import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Growth Agent + Growth Dashboard reads (NP-P2-S2). The caller's own per-request client (never the service-role
 * client); the database decides access (plus_can_read) inside each RPC.
 */
export class GrowthReadError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus growth read failed (${code ?? "unknown"})`);
  }
}

export interface Recommendation {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  opportunityStage: string;
  contactId: string;
  contactName: string;
  contactDoNotContact: boolean;
  contactPreferredChannel: string;
  contactHasPhone: boolean;
  contactHasEmail: boolean;
  type: string;
  proposedAction: string;
  signalDays: number;
  lastActivityAt: string | null;
  lastActivityType: string | null;
  status: string;
  generatedByName: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  approvedTaskId: string | null;
  updatedAt: string;
}

export async function listRecommendations(organizationId: string, view: "pending" | "reviewed" | "all", limit = 50): Promise<{ rows: Recommendation[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_agent_recommendations", { p_organization_id: organizationId, p_view: view, p_limit: limit, p_offset: 0 });
  if (error) throw new GrowthReadError(error.code);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.recommendation_id,
      opportunityId: r.opportunity_id,
      opportunityTitle: r.opportunity_title,
      opportunityStage: r.opportunity_stage,
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactDoNotContact: r.contact_do_not_contact,
      contactPreferredChannel: r.contact_preferred_channel,
      contactHasPhone: r.contact_has_phone,
      contactHasEmail: r.contact_has_email,
      type: r.recommendation_type,
      proposedAction: r.proposed_action,
      signalDays: r.signal_days,
      lastActivityAt: r.last_activity_at,
      lastActivityType: r.last_activity_type,
      status: r.status,
      generatedByName: r.generated_by_name,
      createdAt: r.created_at,
      reviewedByName: r.reviewed_by_name,
      reviewedAt: r.reviewed_at,
      approvedTaskId: r.approved_task_id,
      updatedAt: r.updated_at,
    })),
    total: data && data.length > 0 ? Number(data[0].total_count) : 0,
  };
}

export interface GrowthDashboard {
  activeOpportunities: number;
  stages: { new_inquiry: number; contacted: number; qualified: number; quote_sent: number; quote_accepted: number };
  activeContacts: number;
  openTasks: number;
  overdueTasks: number;
  dueTodayTasks: number;
  myOpenTasks: number;
  pendingRecommendations: number;
  attentionOpportunities: number;
}

export async function getGrowthDashboard(organizationId: string): Promise<GrowthDashboard> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_growth_dashboard", { p_organization_id: organizationId });
  if (error) throw new GrowthReadError(error.code);
  const r = data?.[0];
  const n = (v: number | string | null | undefined) => Number(v ?? 0);
  return {
    activeOpportunities: n(r?.active_opportunities),
    stages: {
      new_inquiry: n(r?.stage_new_inquiry),
      contacted: n(r?.stage_contacted),
      qualified: n(r?.stage_qualified),
      quote_sent: n(r?.stage_quote_sent),
      quote_accepted: n(r?.stage_quote_accepted),
    },
    activeContacts: n(r?.active_contacts),
    openTasks: n(r?.open_tasks),
    overdueTasks: n(r?.overdue_tasks),
    dueTodayTasks: n(r?.due_today_tasks),
    myOpenTasks: n(r?.my_open_tasks),
    pendingRecommendations: n(r?.pending_recommendations),
    attentionOpportunities: n(r?.attention_opportunities),
  };
}

export interface AttentionOpportunity {
  opportunityId: string;
  title: string;
  stage: string;
  contactName: string;
  type: string;
  signalDays: number;
  lastActivityAt: string | null;
}

export async function listAttentionOpportunities(organizationId: string, limit = 5): Promise<AttentionOpportunity[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_attention_opportunities", { p_organization_id: organizationId, p_limit: limit });
  if (error) throw new GrowthReadError(error.code);
  return (data ?? []).map((r) => ({
    opportunityId: r.opportunity_id,
    title: r.opportunity_title,
    stage: r.opportunity_stage,
    contactName: r.contact_name,
    type: r.attention_type,
    signalDays: r.signal_days,
    lastActivityAt: r.last_activity_at,
  }));
}

export interface RecentActivity {
  id: string;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  actorName: string | null;
  occurredAt: string;
  /** NP-P2-S5-S3B (ZD-222): quote lifecycle event reference (never an amount) */
  quoteNumber: number | null;
  quoteKind: string | null;
  quoteStatus: string | null;
}

export async function listRecentActivities(organizationId: string, limit = 8): Promise<RecentActivity[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_recent_activities", { p_organization_id: organizationId, p_limit: limit });
  if (error) throw new GrowthReadError(error.code);
  return (data ?? []).map((r) => ({
    id: r.activity_id,
    type: r.activity_type,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    contactId: r.contact_id,
    contactName: r.contact_name,
    opportunityId: r.opportunity_id,
    opportunityTitle: r.opportunity_title,
    actorName: r.actor_name,
    occurredAt: r.occurred_at,
    quoteNumber: r.quote_number,
    quoteKind: r.quote_kind,
    quoteStatus: r.quote_status,
  }));
}
