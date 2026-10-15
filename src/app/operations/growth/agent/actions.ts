"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { agentErrorMessage } from "@/lib/plus/agent-core";
import { END_OF_DAY_TIME, isUuid, validateTaskForm } from "@/lib/plus/tasks-core";
import { organizationLocalToUtc } from "@/lib/operations/local-time-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const AGENT = "/operations/growth/agent";
const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view recommendations but not act on them. Ask an Organization Admin for write access.";

export interface AgentActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname(AGENT);
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

function refresh() {
  revalidatePath("/operations/growth", "layout");
}

/** "Review opportunities": one deterministic review cycle on demand. Creates recommendations only. */
export async function runAgentReviewAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_run_growth_agent_review", { p_organization_id: guard.context.organizationId });
  if (error || !data) {
    console.error("[plus] agent review failed", error?.code ?? "no_data");
    return { status: "error", message: agentErrorMessage(error?.code) };
  }
  refresh();
  const created = data.created ?? 0;
  const superseded = data.superseded ?? 0;
  const parts = [
    created === 0 ? "No new recommendations" : `${created} new ${created === 1 ? "recommendation" : "recommendations"}`,
    superseded > 0 ? `${superseded} withdrawn because the situation changed` : null,
  ].filter(Boolean);
  return { status: "success", message: `Review complete: ${parts.join("; ")}.` };
}

/**
 * Staff approval: creates ONE internal follow-up task on the opportunity (title / due / assignee as edited). The
 * database revalidates the situation first; nothing is ever sent.
 */
export async function approveRecommendationAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const id = text(formData, "recommendationId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(id) || !expected) return { status: "error", message: "Reload the page and try again." };
  const parsed = validateTaskForm({
    title: text(formData, "title"),
    dueDate: text(formData, "dueDate"),
    dueTime: text(formData, "dueTime"),
    assigneeHandle: text(formData, "assigneeHandle"),
  });
  if (!parsed.ok) return { status: "error", message: Object.values(parsed.errors)[0] ?? "Check the task." };
  let dueAt: string | null = null;
  if (parsed.value.due) {
    const r = organizationLocalToUtc({ date: parsed.value.due.date, time: parsed.value.due.time || END_OF_DAY_TIME }, guard.context.organizationTimezone);
    if (r.status !== "ok") return { status: "error", message: "Choose a valid due date and time." };
    dueAt = r.utc.toISOString();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_approve_agent_recommendation", {
    p_organization_id: guard.context.organizationId,
    p_recommendation_id: id,
    p_expected_updated_at: expected,
    p_task_title: parsed.value.title,
    p_due_at: dueAt as string,
    p_assignee_membership_id: parsed.value.assigneeHandle as string,
  });
  if (error || !data) {
    console.error("[plus] agent approval failed", error?.code ?? "no_data");
    return { status: "error", message: agentErrorMessage(error?.code) };
  }
  refresh();
  if (data.outcome === "superseded") {
    return { status: "error", message: "This recommendation is out of date — the situation changed — so it was withdrawn. No task was created." };
  }
  return { status: "success", message: data.outcome === "already_approved" ? "A task was already created for this recommendation." : "Follow-up task created. Nothing was sent." };
}

export async function dismissRecommendationAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const id = text(formData, "recommendationId");
  const expected = text(formData, "expectedVersion");
  const outcome = text(formData, "outcome");
  if (!isUuid(id) || !expected || (outcome !== "dismissed" && outcome !== "not_relevant")) return { status: "error", message: "Reload the page and try again." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_dismiss_agent_recommendation", {
    p_organization_id: guard.context.organizationId,
    p_recommendation_id: id,
    p_expected_updated_at: expected,
    p_outcome: outcome,
  });
  if (error || !data) return { status: "error", message: agentErrorMessage(error?.code) };
  refresh();
  return { status: "success", message: outcome === "not_relevant" ? "Marked as no longer relevant." : "Recommendation dismissed." };
}
