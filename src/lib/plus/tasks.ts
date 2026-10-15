import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TaskView } from "./tasks-core";

/**
 * Nemryn Plus task reads (NP-P2-S2). The caller's own per-request client (never the service-role client): the database
 * decides access through plus_can_read inside each RPC.
 */
export class TasksError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus tasks request failed (${code ?? "unknown"})`);
  }
}

export interface TaskRow {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  isOverdue: boolean;
  isDueToday: boolean;
  assigneeHandle: string | null;
  assigneeName: string | null;
  assigneeIsSelf: boolean;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  completedAt: string | null;
  completedByName: string | null;
  updatedAt: string;
}

export const TASKS_PAGE_SIZE = 100;

export async function listTasks(
  organizationId: string,
  params: { view: TaskView | "done" | "cancelled"; search?: string; assignee?: string | null; contactId?: string | null; opportunityId?: string | null; limit?: number },
): Promise<{ rows: TaskRow[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_tasks", {
    p_organization_id: organizationId,
    p_view: params.view,
    p_search: (params.search || null) as string,
    p_assignee_membership_id: (params.assignee ?? null) as string,
    p_contact_id: (params.contactId ?? null) as string,
    p_opportunity_id: (params.opportunityId ?? null) as string,
    p_limit: params.limit ?? TASKS_PAGE_SIZE,
    p_offset: 0,
  });
  if (error) throw new TasksError(error.code);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.task_id,
      title: r.title,
      dueAt: r.due_at,
      status: r.status,
      isOverdue: r.is_overdue,
      isDueToday: r.is_due_today,
      assigneeHandle: r.assignee_membership_id,
      assigneeName: r.assignee_name,
      assigneeIsSelf: r.assignee_is_self,
      contactId: r.contact_id,
      contactName: r.contact_name,
      opportunityId: r.opportunity_id,
      opportunityTitle: r.opportunity_title,
      completedAt: r.completed_at,
      completedByName: r.completed_by_name,
      updatedAt: r.updated_at,
    })),
    total: data && data.length > 0 ? Number(data[0].total_count) : 0,
  };
}

export interface TaskDetail extends TaskRow {
  assigneeCanWrite: boolean | null;
  opportunityStage: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** null when not available to the caller (foreign, unknown or no access). */
export async function getTask(organizationId: string, taskId: string): Promise<TaskDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_task", { p_organization_id: organizationId, p_task_id: taskId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new TasksError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.task_id,
    title: r.title,
    dueAt: r.due_at,
    status: r.status,
    isOverdue: r.is_overdue,
    isDueToday: false,
    assigneeName: r.assignee_name,
    assigneeIsSelf: false,
    assigneeHandle: r.assignee_membership_id,
    assigneeCanWrite: r.assignee_can_write,
    contactId: r.contact_id,
    contactName: r.contact_name,
    opportunityId: r.opportunity_id,
    opportunityTitle: r.opportunity_title,
    opportunityStage: r.opportunity_stage,
    completedAt: r.completed_at,
    completedByName: r.completed_by_name,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
