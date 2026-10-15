/**
 * Pure rules for Nemryn Plus tasks & follow-ups (NP-P2-S2). Runtime-import-free (unit-tested under plain Node:
 * tasks-core.test.mjs).
 *
 * The database is the authority: plus_create_task / plus_update_task / plus_reassign_task / plus_complete_task /
 * plus_cancel_task re-check Plus access, the subject, the assignee and the version. A task is INTERNAL work for staff --
 * it never sends anything and is never presented as a customer communication.
 */

export const TASK_VIEWS = ["open", "mine", "overdue", "today", "upcoming", "no_date", "history"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

const VIEW_LABELS: Record<TaskView, string> = {
  open: "All open",
  mine: "My tasks",
  overdue: "Overdue",
  today: "Due today",
  upcoming: "Upcoming",
  no_date: "No due date",
  history: "Completed & cancelled",
};

export const TASK_VIEW_OPTIONS = TASK_VIEWS.map((value) => ({ value, label: VIEW_LABELS[value] }));
export const taskViewLabel = (v: TaskView) => VIEW_LABELS[v];

export type TaskStatus = "open" | "done" | "cancelled";
export function taskStatusLabel(status: string): string {
  return status === "done" ? "Done" : status === "cancelled" ? "Cancelled" : "Open";
}

export const TASK_LIMITS = { title: 200, search: 200 } as const;
/** A due date without a time means "by the end of that day" in the organization's timezone. */
export const END_OF_DAY_TIME = "23:59";

export const TASK_IS_INTERNAL_NOTE =
  "Tasks are internal follow-ups for your team. Creating or completing one doesn't contact anyone.";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (raw: unknown): raw is string => typeof raw === "string" && UUID_RE.test(raw);

export interface TaskFormValues {
  title: string;
  dueDate: string;
  dueTime: string;
  assigneeHandle: string;
}

export type TaskFieldErrors = Partial<Record<keyof TaskFormValues | "form", string>>;

export interface TaskInput {
  title: string;
  /** Organization-local due date/time, or null for no due date. The server converts it to UTC in the org timezone. */
  due: { date: string; time: string } | null;
  assigneeHandle: string | null;
}

export function validateTaskForm(values: TaskFormValues): { ok: true; value: TaskInput } | { ok: false; errors: TaskFieldErrors } {
  const errors: TaskFieldErrors = {};
  const title = values.title.trim();
  const date = values.dueDate.trim();
  const time = values.dueTime.trim();
  if (!title) errors.title = "Describe the follow-up.";
  else if (title.length > TASK_LIMITS.title) errors.title = `Use ${TASK_LIMITS.title} characters or fewer.`;
  if (date && !DATE_RE.test(date)) errors.dueDate = "Choose a valid date.";
  if (time && !TIME_RE.test(time)) errors.dueTime = "Choose a valid time.";
  if (time && !date) errors.dueDate = "Choose a date for the time you entered.";
  if (values.assigneeHandle && !UUID_RE.test(values.assigneeHandle)) errors.assigneeHandle = "Choose someone from the list.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { title, due: date ? { date, time: time || END_OF_DAY_TIME } : null, assigneeHandle: values.assigneeHandle || null },
  };
}

export type TaskSubject = { kind: "contact"; id: string } | { kind: "opportunity"; id: string };

/** Exactly one subject, from posted fields. */
export function parseTaskSubject(rawContact: unknown, rawOpportunity: unknown): TaskSubject | null {
  const c = isUuid(rawContact) ? rawContact : null;
  const o = isUuid(rawOpportunity) ? rawOpportunity : null;
  if ((c ? 1 : 0) + (o ? 1 : 0) !== 1) return null;
  return c ? { kind: "contact", id: c } : { kind: "opportunity", id: o as string };
}

export interface TaskListParams {
  view: TaskView;
  search: string;
  assignee: string | null;
}

function single(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
}

export function parseTaskListParams(params: Record<string, string | string[] | undefined>): TaskListParams {
  const view = single(params.view);
  const assignee = single(params.assignee);
  return {
    view: (TASK_VIEWS as readonly string[]).includes(view) ? (view as TaskView) : "open",
    search: single(params.q).trim().slice(0, TASK_LIMITS.search),
    assignee: UUID_RE.test(assignee) ? assignee : null,
  };
}

export function taskListHref(p: TaskListParams, overrides: Partial<TaskListParams> = {}): string {
  const v = { ...p, ...overrides };
  const qs = new URLSearchParams();
  if (v.view !== "open") qs.set("view", v.view);
  if (v.search) qs.set("q", v.search);
  if (v.assignee) qs.set("assignee", v.assignee);
  const s = qs.toString();
  return `/operations/growth/tasks${s ? `?${s}` : ""}`;
}

/** "Overdue · Oct 14, 9:00 AM" / "Due today · 3:00 PM" / "Due Oct 20, 11:59 PM" / "No due date" in the org timezone. */
export function dueLabel(dueAt: string | null, flags: { overdue: boolean; today: boolean }, timezone: string): string {
  if (!dueAt) return "No due date";
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "No due date";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(d);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(d);
  if (flags.overdue) return `Overdue · ${date}, ${time}`;
  if (flags.today) return `Due today · ${time}`;
  return `Due ${date}, ${time}`;
}

export function taskErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ZW003":
      return "This task changed since you opened it. Reload the page to see the latest, then try again.";
    case "ZW004":
      return "This task is already closed. Completed and cancelled tasks are kept as history.";
    case "ZW006":
      return "Check the task: it needs a title, one active contact or open opportunity, and an assignee with Nemryn Plus write access.";
    case "ZW001":
      return "You can view tasks but not change them. Ask an Organization Admin for write access.";
    case "ZW002":
      return "That task, contact or opportunity isn't available. It may not exist, or you may no longer have access.";
    default:
      return "That change couldn't be saved. Try again.";
  }
}

/** UTC instant -> organization-local {date: "YYYY-MM-DD", time: "HH:mm"} for prefilling a form; empty when none. */
export function localDueParts(dueAt: string | null, timezone: string): { date: string; time: string } {
  if (!dueAt) return { date: "", time: "" };
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The fields a list row needs from a task read (structurally typed so this module stays import-free). */
export interface TaskRowLike {
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

function shortDateTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(d);
}

/** A task read -> what a list row displays, in the organization timezone. */
export function toTaskListItem(r: TaskRowLike, timezone: string) {
  const due = localDueParts(r.dueAt, timezone);
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    dueLabel: dueLabel(r.dueAt, { overdue: r.isOverdue, today: r.isDueToday }, timezone),
    isOverdue: r.isOverdue,
    isDueToday: r.isDueToday,
    assigneeName: r.assigneeName,
    assigneeIsSelf: r.assigneeIsSelf,
    contactId: r.contactId,
    contactName: r.contactName,
    opportunityId: r.opportunityId,
    opportunityTitle: r.opportunityTitle,
    closedLabel:
      r.status === "done"
        ? `Done ${r.completedAt ? shortDateTime(r.completedAt, timezone) : ""}${r.completedByName ? ` by ${r.completedByName}` : ""}`.trim()
        : r.status === "cancelled"
          ? `Cancelled ${shortDateTime(r.updatedAt, timezone)}`
          : null,
    version: r.updatedAt,
    edit: { title: r.title, dueDate: due.date, dueTime: due.time, assigneeHandle: r.assigneeHandle ?? "" },
  };
}
