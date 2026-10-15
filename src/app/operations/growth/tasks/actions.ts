"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { isUuid, parseTaskSubject, taskErrorMessage, validateTaskForm, type TaskFieldErrors, type TaskFormValues } from "@/lib/plus/tasks-core";
import { organizationLocalToUtc } from "@/lib/operations/local-time-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TASKS = "/operations/growth/tasks";
const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view tasks but not change them. Ask an Organization Admin for write access.";

export interface TaskFormState {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: TaskFieldErrors;
  values?: TaskFormValues;
}
export interface TaskActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
function readValues(formData: FormData): TaskFormValues {
  return {
    title: text(formData, "title").slice(0, 260),
    dueDate: text(formData, "dueDate"),
    dueTime: text(formData, "dueTime"),
    assigneeHandle: text(formData, "assigneeHandle"),
  };
}

/** Growth guard + organization binding (session workspace; the form must be for it) + write capability. */
async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname(TASKS);
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

/** Organization-local due date/time -> UTC ISO, or null. `undefined` = invalid (DST gap / ambiguity / bad date). */
function toUtc(due: { date: string; time: string } | null, timezone: string): string | null | undefined {
  if (!due) return null;
  const r = organizationLocalToUtc(due, timezone);
  return r.status === "ok" ? r.utc.toISOString() : undefined;
}

function refresh() {
  revalidatePath("/operations/growth", "layout");
}

/** New internal follow-up for exactly one contact OR opportunity. Sends nothing. */
export async function createTaskAction(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const subject = parseTaskSubject(formData.get("contactId"), formData.get("opportunityId"));
  if (!subject) return { status: "error", message: "Reload the page and try again.", values };
  const parsed = validateTaskForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, values };
  const dueAt = toUtc(parsed.value.due, guard.context.organizationTimezone);
  if (dueAt === undefined) return { status: "error", errors: { dueTime: "That time doesn't exist or is ambiguous on that date (daylight saving). Choose another time." }, values };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_create_task", {
    p_organization_id: guard.context.organizationId,
    p_title: parsed.value.title,
    p_due_at: dueAt as string,
    p_assignee_membership_id: parsed.value.assigneeHandle as string,
    p_contact_id: (subject.kind === "contact" ? subject.id : null) as string,
    p_opportunity_id: (subject.kind === "opportunity" ? subject.id : null) as string,
  });
  if (error || !data) {
    console.error("[plus] create task failed", error?.code ?? "no_data");
    return { status: "error", message: taskErrorMessage(error?.code), values };
  }
  refresh();
  return { status: "success", message: data.changed ? "Task added." : "That task was already added." };
}

export async function updateTaskAction(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const taskId = text(formData, "taskId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(taskId) || !expected || Number.isNaN(Date.parse(expected))) return { status: "error", message: "Reload the page and try again.", values };
  const parsed = validateTaskForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, values };
  const dueAt = toUtc(parsed.value.due, guard.context.organizationTimezone);
  if (dueAt === undefined) return { status: "error", errors: { dueTime: "That time doesn't exist or is ambiguous on that date (daylight saving). Choose another time." }, values };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_update_task", {
    p_organization_id: guard.context.organizationId,
    p_task_id: taskId,
    p_expected_updated_at: expected,
    p_title: parsed.value.title,
    p_due_at: dueAt as string,
    p_assignee_membership_id: parsed.value.assigneeHandle as string,
  });
  if (error || !data) {
    console.error("[plus] update task failed", error?.code ?? "no_data");
    return { status: "error", message: taskErrorMessage(error?.code), values };
  }
  refresh();
  return { status: "success", message: data.changed ? "Task updated." : "No changes to save." };
}

async function statusChange(formData: FormData, rpc: "plus_complete_task" | "plus_cancel_task", done: string, already: string): Promise<TaskActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const taskId = text(formData, "taskId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(taskId) || !expected) return { status: "error", message: "Reload the page and try again." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(rpc, { p_organization_id: guard.context.organizationId, p_task_id: taskId, p_expected_updated_at: expected });
  if (error || !data) return { status: "error", message: taskErrorMessage(error?.code) };
  refresh();
  return { status: "success", message: data.changed ? done : already };
}

export async function completeTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return statusChange(formData, "plus_complete_task", "Task marked done.", "That task was already done.");
}

export async function cancelTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return statusChange(formData, "plus_cancel_task", "Task cancelled.", "That task was already cancelled.");
}

/** Assign to an eligible Plus writer (or unassign). The database re-checks eligibility at assignment time. */
export async function reassignTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const taskId = text(formData, "taskId");
  const expected = text(formData, "expectedVersion");
  const assignee = text(formData, "assigneeHandle");
  if (!isUuid(taskId) || !expected || (assignee && !isUuid(assignee))) return { status: "error", message: "Reload the page and try again." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_reassign_task", {
    p_organization_id: guard.context.organizationId,
    p_task_id: taskId,
    p_expected_updated_at: expected,
    p_assignee_membership_id: (assignee || null) as string,
  });
  if (error || !data) return { status: "error", message: taskErrorMessage(error?.code) };
  refresh();
  return { status: "success", message: data.changed ? "Assignee updated." : "It was already assigned that way." };
}
