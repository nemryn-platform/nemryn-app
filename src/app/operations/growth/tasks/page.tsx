import Link from "next/link";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { listContacts, listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { listOpportunities } from "@/lib/plus/opportunities";
import { listTasks, TASKS_PAGE_SIZE, type TaskRow } from "@/lib/plus/tasks";
import { TASK_IS_INTERNAL_NOTE, TASK_VIEW_OPTIONS, parseTaskListParams, taskListHref, toTaskListItem } from "@/lib/plus/tasks-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { ViewSwitch } from "@/components/ui/ViewSwitch";
import { Select } from "@/components/ui/Select";
import { TaskList } from "@/components/growth/TaskList";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Tasks" };

const EMPTY: Record<string, string> = {
  open: "No follow-ups. Add a task from any contact or opportunity.",
  mine: "Nothing is assigned to you right now.",
  overdue: "Nothing is overdue.",
  today: "Nothing else is due today.",
  upcoming: "No upcoming follow-ups.",
  no_date: "Every open task has a due date.",
  history: "No completed or cancelled tasks yet.",
};

/**
 * Growth -> Tasks (NP-P2-S2). Internal follow-ups for contacts and opportunities, read through plus_list_tasks (Plus
 * read, re-checked in the database). Views: all open, mine, overdue, due today, upcoming, no due date, history -- "today"
 * and due times use the workspace's own timezone. Write actions only for Plus write capability. Tasks never contact
 * anyone.
 */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/growth/tasks");
  const { context, plus } = await requirePlusAccess(pathname);
  const params = parseTaskListParams(await searchParams);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const tz = context.organizationTimezone;

  let rows: TaskRow[] | null = null;
  let total = 0;
  try {
    const r = await listTasks(context.organizationId, { view: params.view, search: params.search, assignee: params.assignee });
    rows = r.rows;
    total = r.total;
  } catch {
    rows = null;
  }

  let owners: OwnerOption[] = [];
  let subjectOptions: { value: string; label: string }[] = [];
  if (canWrite) {
    try {
      owners = await listOwnerOptions(context.organizationId);
    } catch {
      owners = [];
    }
    try {
      const [opps, contacts] = await Promise.all([
        listOpportunities(context.organizationId, { search: "", view: "open", stage: null, source: null, owner: null }),
        listContacts(context.organizationId, { search: "", kind: null, status: "active", page: 1 }),
      ]);
      subjectOptions = [
        ...opps.rows.map((o) => ({ value: `opportunity:${o.id}`, label: `Opportunity: ${o.title} (${o.contactName})` })),
        ...contacts.rows.map((c) => ({ value: `contact:${c.id}`, label: `Contact: ${c.displayName}` })),
      ];
    } catch {
      subjectOptions = [];
    }
  }
  const ownerChoices = owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }));
  const selfHandle = owners.find((o) => o.isSelf)?.handle ?? null;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Tasks"
        description="Follow-ups your team has planned for contacts and opportunities."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Tasks" }]}
      />
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your tasks are kept and can be viewed. They can't be changed until Plus is active again." />
      )}

      {/* NP-UI-V2-3: the shared URL-driven ViewSwitch (D-5) -- same views, hrefs and aria-current as the hand-built links. */}
      <ViewSwitch
        label="Task views"
        testId="task-views"
        activeKey={params.view}
        items={TASK_VIEW_OPTIONS.map((v) => ({ key: v.value, label: v.label, href: taskListHref(params, { view: v.value }) }))}
        className="self-start"
      />

      <form method="get" action="/operations/growth/tasks" role="search" className="flex flex-col gap-zw-md rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm md:flex-row md:items-end" data-testid="task-filters">
        {params.view !== "open" && <input type="hidden" name="view" value={params.view} />}
        <div className="min-w-0 flex-1">
          <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Task, contact or opportunity" maxLength={200} />
        </div>
        {ownerChoices.length > 0 && params.view !== "mine" && (
          <div className="md:w-56">
            <Select name="assignee" label="Assignee" options={[{ value: "", label: "Anyone" }, ...ownerChoices]} defaultValue={params.assignee ?? ""} />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {(params.search || params.assignee) && (
            <LinkButton href={taskListHref(params, { search: "", assignee: null })} variant="text">
              Clear
            </LinkButton>
          )}
        </div>
      </form>

      {rows === null ? (
        <AttentionState
          level="critical"
          title="Tasks couldn't be loaded"
          description="Your filters are kept. Try again in a moment."
          action={
            <LinkButton href={taskListHref(params)} variant="outline" size="sm">
              Retry
            </LinkButton>
          }
        />
      ) : (
        <TaskList
          tasks={rows.map((r) => toTaskListItem(r, tz))}
          canWrite={canWrite}
          organizationId={context.organizationId}
          owners={ownerChoices}
          selfHandle={selfHandle}
          subjectOptions={subjectOptions}
          emptyText={params.search || params.assignee ? "No tasks match these filters." : EMPTY[params.view]}
        />
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>
        {rows && total > TASKS_PAGE_SIZE ? `Showing ${TASKS_PAGE_SIZE} of ${total}. Narrow the view or search to see others. ` : ""}
        {TASK_IS_INTERNAL_NOTE} Times are shown in your workspace&apos;s timezone.
      </p>
    </div>
  );
}
