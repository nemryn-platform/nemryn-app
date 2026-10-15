"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { cancelTaskAction, completeTaskAction, reassignTaskAction, type TaskActionState } from "@/app/operations/growth/tasks/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TaskDialog, type ChoiceOption } from "@/components/growth/TaskDialog";
import { taskStatusLabel, type TaskFormValues } from "@/lib/plus/tasks-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: TaskActionState = { status: "idle" };

export interface TaskListItem {
  id: string;
  title: string;
  status: string;
  dueLabel: string;
  isOverdue: boolean;
  isDueToday: boolean;
  assigneeName: string | null;
  assigneeIsSelf: boolean;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  closedLabel: string | null;
  version: string;
  /** Prefill for Edit (organization-local due date / time). */
  edit: TaskFormValues;
}

type Notify = (message: string, tone?: "success" | "error") => void;

/** One-click task action through a transition; the result is reported to the LIST (the row may leave the view). */
function QuickAction({
  action,
  fields,
  label,
  onDone,
  variant = "text",
  testId,
}: {
  action: (prev: TaskActionState, fd: FormData) => Promise<TaskActionState>;
  fields: Record<string, string>;
  label: string;
  onDone: Notify;
  variant?: "text" | "outline";
  testId?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      loading={pending}
      disabled={pending}
      data-testid={testId}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          for (const [k, v] of Object.entries(fields)) fd.set(k, v);
          const r = await action(IDLE, fd);
          onDone(r.message ?? "", r.status === "error" ? "error" : "success");
        })
      }
    >
      {label}
    </Button>
  );
}

function Row({
  task,
  canWrite,
  organizationId,
  owners,
  selfHandle,
  showSubject,
  onDone,
}: {
  task: TaskListItem;
  canWrite: boolean;
  organizationId: string;
  owners: ChoiceOption[];
  selfHandle: string | null;
  showSubject: boolean;
  onDone: Notify;
}) {
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelPending, startCancel] = useTransition();
  const close = useCallback(() => setEditing(false), []);
  const open = task.status === "open";
  const base = { organizationId, taskId: task.id, expectedVersion: task.version };

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0" data-testid="task-row" data-status={task.status}>
      <div className="min-w-0 flex-1 basis-64">
        <p className={cn(typography.label, "break-words text-text-primary")}>{task.title}</p>
        <p className={cn(typography.metadata, task.isOverdue ? "text-critical-text" : task.isDueToday ? "text-warning-text" : "text-text-secondary")} data-testid="task-due">
          {open ? task.dueLabel : task.closedLabel}
        </p>
        {showSubject && (
          <p className={cn(typography.metadata, "mt-0.5 text-text-secondary")}>
            {task.opportunityId ? (
              <>
                Opportunity:{" "}
                <Link href={`/operations/growth/pipeline/${task.opportunityId}`} className="text-text-link hover:underline" data-testid="task-subject-link">
                  {task.opportunityTitle}
                </Link>
                {task.contactName ? ` · ${task.contactName}` : ""}
              </>
            ) : task.contactId ? (
              <>
                Contact:{" "}
                <Link href={`/operations/growth/contacts/${task.contactId}`} className="text-text-link hover:underline" data-testid="task-subject-link">
                  {task.contactName}
                </Link>
              </>
            ) : null}
          </p>
        )}
        <p className={cn(typography.metadata, "text-text-muted")}>{task.assigneeName ? `Assigned to ${task.assigneeName}${task.assigneeIsSelf ? " (you)" : ""}` : "Unassigned"}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
        <StatusBadge label={task.isOverdue ? "Overdue" : taskStatusLabel(task.status)} category={task.isOverdue ? "critical" : task.status === "done" ? "completed" : task.status === "cancelled" ? "cancelled" : "neutral"} />
        {canWrite && open && (
          <div className="flex flex-wrap gap-1 md:justify-end">
            <QuickAction action={completeTaskAction} fields={base} label="Mark done" onDone={onDone} variant="outline" testId="task-done" />
            {selfHandle && !task.assigneeIsSelf && (
              <QuickAction action={reassignTaskAction} fields={{ ...base, assigneeHandle: selfHandle }} label="Assign to me" onDone={onDone} testId="task-assign-me" />
            )}
            <Button type="button" size="sm" variant="text" onClick={() => setEditing(true)} data-testid="task-edit">
              Edit
            </Button>
            <Button type="button" size="sm" variant="text" onClick={() => setCancelling(true)} data-testid="task-cancel">
              Cancel task
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <TaskDialog mode="edit" organizationId={organizationId} onClose={close} onDone={onDone} owners={owners} initial={task.edit} taskId={task.id} expectedVersion={task.version} />
      )}
      {cancelling && (
        <Dialog open onClose={() => setCancelling(false)} title="Cancel this task?" description="It stays in the history as cancelled. Nothing is deleted.">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelling(false)} disabled={cancelPending}>
              Keep task
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={cancelPending}
              disabled={cancelPending}
              data-testid="task-cancel-confirm"
              onClick={() =>
                startCancel(async () => {
                  const fd = new FormData();
                  for (const [k, v] of Object.entries(base)) fd.set(k, v);
                  const r = await cancelTaskAction(IDLE, fd);
                  setCancelling(false);
                  onDone(r.message ?? "", r.status === "error" ? "error" : "success");
                })
              }
            >
              Cancel task
            </Button>
          </div>
        </Dialog>
      )}
    </li>
  );
}

/**
 * A list of tasks with their actions (NP-P2-S2). Write actions only for Plus write capability and open tasks; the
 * database re-checks every action. Used by the Tasks page and the Contact / Opportunity detail panels.
 */
export function TaskList({
  tasks,
  canWrite,
  organizationId,
  owners,
  selfHandle,
  showSubject = true,
  emptyText,
  createSubject,
  subjectOptions,
  createLabel = "New task",
}: {
  tasks: TaskListItem[];
  canWrite: boolean;
  organizationId: string;
  owners: ChoiceOption[];
  selfHandle: string | null;
  showSubject?: boolean;
  emptyText: string;
  /** When set, "New task" creates a task for this fixed subject. */
  createSubject?: { kind: "contact" | "opportunity"; id: string; label: string };
  /** When set (Tasks page), "New task" lets the person pick a subject. */
  subjectOptions?: ChoiceOption[];
  createLabel?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const onDone = useCallback<Notify>((text, tone = "success") => setNotice(text ? { text, tone } : null), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const canCreate = canWrite && Boolean(createSubject || (subjectOptions && subjectOptions.length > 0));

  return (
    <div className="flex flex-col gap-zw-md" data-testid="task-list">
      {canCreate && (
        <div>
          <Button type="button" size="sm" variant="outline" leadingIcon={<Plus className="size-3.5" aria-hidden />} onClick={() => { setNotice(null); setCreating(true); }} data-testid="task-new">
            {createLabel}
          </Button>
        </div>
      )}
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={cn(typography.bodySmall, notice.tone === "error" ? "text-critical-text" : "text-text-secondary")} data-testid="task-notice">
          {notice.text}
        </p>
      )}
      {tasks.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="task-empty">
          {emptyText}
        </p>
      ) : (
        <Panel>
          <ul aria-label="Tasks">
            {tasks.map((t) => (
              <Row key={t.id} task={t} canWrite={canWrite} organizationId={organizationId} owners={owners} selfHandle={selfHandle} showSubject={showSubject} onDone={onDone} />
            ))}
          </ul>
        </Panel>
      )}
      {creating && (
        <TaskDialog
          mode="create"
          organizationId={organizationId}
          onClose={closeCreate}
          onDone={onDone}
          owners={owners}
          subject={createSubject}
          subjectOptions={subjectOptions}
          initial={{ title: "", dueDate: "", dueTime: "", assigneeHandle: selfHandle ?? "" }}
        />
      )}
    </div>
  );
}
