"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { createTaskAction, updateTaskAction, type TaskFormState } from "@/app/operations/growth/tasks/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TASK_IS_INTERNAL_NOTE, TASK_LIMITS, type TaskFormValues } from "@/lib/plus/tasks-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: TaskFormState = { status: "idle" };

export interface ChoiceOption {
  value: string;
  label: string;
}

/**
 * New / Edit task dialog (NP-P2-S2). The subject is fixed when opened from a contact or opportunity; from the Tasks
 * page the person picks one (open opportunities and active contacts of this workspace). Server-validated; the database
 * re-checks the subject, the assignee and the version. A task is internal work -- nothing is sent.
 */
export function TaskDialog({
  mode,
  organizationId,
  onClose,
  onDone,
  owners,
  initial,
  subject,
  subjectOptions,
  taskId,
  expectedVersion,
  notice,
}: {
  mode: "create" | "edit";
  organizationId: string;
  onClose: () => void;
  onDone: (message: string) => void;
  owners: ChoiceOption[];
  initial: TaskFormValues;
  /** Fixed subject (create from a contact / opportunity). */
  subject?: { kind: "contact" | "opportunity"; id: string; label: string };
  /** Choice of subjects (create from the Tasks page): values "contact:<id>" / "opportunity:<id>". */
  subjectOptions?: ChoiceOption[];
  taskId?: string;
  expectedVersion?: string;
  /** NP-P2-S5-S3C: an extra notice above the fields (e.g. the do-not-contact reminder on a quote follow-up) */
  notice?: ReactNode;
}) {
  const [state, action, pending] = useActionState(mode === "create" ? createTaskAction : updateTaskAction, IDLE);
  const [picked, setPicked] = useState(subjectOptions?.[0]?.value ?? "");
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);
  const values = state.values ?? initial;
  const errors = state.errors ?? {};
  const chosen = subject ? `${subject.kind}:${subject.id}` : picked;
  const [kind, id] = chosen.split(":");

  return (
    <Dialog open onClose={onClose} title={mode === "create" ? "New task" : "Edit task"} description={TASK_IS_INTERNAL_NOTE}>
      <form action={action} className="flex flex-col gap-zw-md" data-testid="task-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        {mode === "create" && (
          <>
            <input type="hidden" name="contactId" value={kind === "contact" ? id ?? "" : ""} />
            <input type="hidden" name="opportunityId" value={kind === "opportunity" ? id ?? "" : ""} />
          </>
        )}
        {taskId && <input type="hidden" name="taskId" value={taskId} />}
        {notice}
        {expectedVersion && <input type="hidden" name="expectedVersion" value={expectedVersion} />}
        {mode === "create" &&
          (subject ? (
            <div>
              <p className={cn(typography.label, "text-text-primary")}>For</p>
              <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="task-subject">
                {subject.kind === "contact" ? "Contact" : "Opportunity"}: {subject.label}
              </p>
            </div>
          ) : (
            <Select
              label="For"
              required
              options={subjectOptions && subjectOptions.length > 0 ? subjectOptions : [{ value: "", label: "No open opportunities or active contacts" }]}
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              disabled={pending}
              data-testid="task-subject-select"
            />
          ))}
        <Input name="title" label="Follow-up" required maxLength={TASK_LIMITS.title} defaultValue={values.title} error={errors.title} disabled={pending} autoComplete="off" />
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <Input name="dueDate" label="Due date (optional)" type="date" defaultValue={values.dueDate} error={errors.dueDate} disabled={pending} />
          <Input name="dueTime" label="Time (optional)" type="time" defaultValue={values.dueTime} error={errors.dueTime} disabled={pending} helpText="No time means by the end of that day." />
        </div>
        <Select
          name="assigneeHandle"
          label="Assignee (optional)"
          options={[{ value: "", label: "Unassigned" }, ...owners]}
          defaultValue={values.assigneeHandle}
          error={errors.assigneeHandle}
          disabled={pending}
          helpText="Someone with Nemryn Plus write access."
        />
        {state.status === "error" && state.message && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || (mode === "create" && !chosen)} data-testid="task-save">
            {mode === "create" ? "Add task" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
