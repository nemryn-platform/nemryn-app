import { ListChecks } from "@phosphor-icons/react/dist/ssr";
import { listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { listTasks, type TaskRow } from "@/lib/plus/tasks";
import { TASK_IS_INTERNAL_NOTE, toTaskListItem } from "@/lib/plus/tasks-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Panel } from "@/components/ui/Panel";
import { TaskList } from "@/components/growth/TaskList";

/**
 * Tasks panel for a Contact or Opportunity detail page (NP-P2-S2). Server component: reads through plus_list_tasks
 * (Plus read). "New task" is fixed to this subject and offered only with Plus write capability (and, for contacts,
 * only while the contact is active -- the database refuses archived subjects anyway).
 */
export async function SubjectTasksPanel({
  organizationId,
  timezone,
  subject,
  canWrite,
}: {
  organizationId: string;
  timezone: string;
  subject: { kind: "contact" | "opportunity"; id: string; label: string };
  canWrite: boolean;
}) {
  let rows: TaskRow[] | null = null;
  try {
    rows = (await listTasks(organizationId, {
      view: "open",
      contactId: subject.kind === "contact" ? subject.id : null,
      opportunityId: subject.kind === "opportunity" ? subject.id : null,
      limit: 50,
    })).rows;
  } catch {
    rows = null;
  }
  let owners: OwnerOption[] = [];
  if (canWrite) {
    try {
      owners = await listOwnerOptions(organizationId);
    } catch {
      owners = [];
    }
  }
  return (
    <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid={`${subject.kind}-tasks`}>
      <SectionHeader title="Open tasks" description={TASK_IS_INTERNAL_NOTE} icon={<ListChecks />} />
      {rows === null ? (
        <AttentionState level="critical" title="Tasks couldn't be loaded" description="Reload the page to try again." />
      ) : (
        <TaskList
          tasks={rows.map((r) => toTaskListItem(r, timezone))}
          canWrite={canWrite}
          organizationId={organizationId}
          owners={owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }))}
          selfHandle={owners.find((o) => o.isSelf)?.handle ?? null}
          showSubject={subject.kind === "contact"}
          createSubject={subject}
          emptyText="No open tasks."
        />
      )}
    </Panel>
  );
}
