"use client";

import { UsersThree } from "@phosphor-icons/react/dist/ssr";
import { useActionState, useCallback, useEffect, useState } from "react";
import { changePlusTeamAccessAction, type PlusTeamActionState } from "@/app/operations/settings/plus/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  coreRoleLabel,
  offeredTeamChanges,
  plusAccessLabel,
  plusPermissionView,
  teamChangeButtonLabel,
  teamChangeCopy,
  type PlusTeamChange,
  type PlusTeamMember,
} from "@/lib/plus/team-access-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: PlusTeamActionState = { status: "idle" };

// ---------------------------------------------------------------------------
// Confirm dialog: names the staff member AND the organization, shows Core role (unchanged) and the Plus change.
// ---------------------------------------------------------------------------
function ConfirmTeamChangeDialog({
  open,
  onClose,
  onDone,
  member,
  change,
  organizationId,
  organizationName,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  member: PlusTeamMember;
  change: PlusTeamChange;
  organizationId: string;
  organizationName: string;
}) {
  const [state, action, pending] = useActionState(changePlusTeamAccessAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);
  const copy = teamChangeCopy(change, member, organizationName);

  return (
    <Dialog open={open} onClose={onClose} title={copy.title} description={copy.body}>
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="handle" value={member.handle} />
        <input type="hidden" name="change" value={change} />
        <input type="hidden" name="expectedGrant" value={member.grantToken} />
        <input type="hidden" name="organizationId" value={organizationId} />
        <dl className="grid grid-cols-1 gap-zw-sm rounded-md border border-border-strong bg-surface-secondary px-3 py-2 md:grid-cols-2" data-testid="plus-team-confirm-target">
          <div className="min-w-0">
            <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Staff member</dt>
            <dd className={cn(typography.label, "min-w-0 break-words text-text-primary")}>{member.name}</dd>
            <dd className={cn(typography.metadata, "min-w-0 break-all text-text-secondary")}>{member.email}</dd>
          </div>
          <div className="min-w-0">
            <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Organization</dt>
            <dd className={cn(typography.label, "min-w-0 break-words text-text-primary")}>{organizationName}</dd>
          </div>
          <div>
            <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Core role (unchanged)</dt>
            <dd className={cn(typography.bodySmall, "text-text-primary")}>{coreRoleLabel(member.role)}</dd>
          </div>
          <div>
            <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Nemryn Plus</dt>
            <dd className={cn(typography.bodySmall, "text-text-primary")}>
              {plusAccessLabel(member.access ?? "none")} → {plusAccessLabel(change)}
            </dd>
          </div>
        </dl>
        {state.status === "error" && state.message && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={copy.destructive ? "destructive" : "primary"} loading={pending} disabled={pending}>
            {copy.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
function TeamAccessRow({
  member,
  plusWritable,
  organizationId,
  organizationName,
  onDone,
}: {
  member: PlusTeamMember;
  plusWritable: boolean;
  organizationId: string;
  organizationName: string;
  onDone: (message: string) => void;
}) {
  const [change, setChange] = useState<PlusTeamChange | null>(null);
  const close = useCallback(() => setChange(null), []);
  const permission = plusPermissionView(member, plusWritable);
  const changes = offeredTeamChanges(member, plusWritable);

  return (
    <li
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0"
      data-testid="plus-team-row"
      data-email={member.email}
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn(typography.subsectionHeading, "min-w-0 break-words text-text-primary")}>
          {member.name}
          {member.isSelf && <span className={cn(typography.metadata, "ml-2 font-normal text-text-muted")}>You</span>}
        </p>
        <p className={cn(typography.bodySmall, "min-w-0 break-all text-text-secondary")}>{member.email}</p>
        <p className={cn(typography.metadata, "mt-0.5 text-text-muted")} data-testid="plus-team-core-role">
          Core role: {coreRoleLabel(member.role)}
          {!member.isActive && " · Inactive"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
        <div className="flex items-center gap-2">
          <span className={cn(typography.metadata, "text-text-muted")}>Nemryn Plus</span>
          <span data-testid="plus-team-permission">
            <StatusBadge label={permission.label} category={permission.tone} />
          </span>
        </div>
        {permission.note && <p className={cn(typography.metadata, "max-w-xs text-text-secondary md:text-right")}>{permission.note}</p>}
        {changes.length > 0 && (
          <div className="flex flex-wrap items-start gap-1 md:justify-end">
            {changes.map((c) => (
              <Button key={c} type="button" size="sm" variant="text" onClick={() => setChange(c)} data-testid={`plus-team-change-${c}`}>
                {teamChangeButtonLabel(c, member.access)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {change && (
        <ConfirmTeamChangeDialog
          open
          onClose={close}
          onDone={onDone}
          member={member}
          change={change}
          organizationId={organizationId}
          organizationName={organizationName}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------
/**
 * Settings -> Nemryn Plus -> Team access (NP-P1-S3). Organization Admin only (the page guard and the database both
 * enforce it). Lists EXISTING staff with their Core role and Nemryn Plus permission side by side, and lets the Admin
 * give, change or remove a Dispatcher's Plus access. Plus never changes a Core role, invites anyone or grants Plus
 * automatically; the workspace's Plus subscription itself is managed by Nemryn, not here.
 */
export function PlusTeamAccessSection({
  members,
  plusWritable,
  organizationId,
  organizationName,
}: {
  members: PlusTeamMember[];
  plusWritable: boolean;
  organizationId: string;
  organizationName: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const onDone = useCallback((message: string) => setNotice(message || null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const hasDispatchers = members.some((m) => m.role === "dispatcher");

  return (
    <div className="flex flex-col gap-zw-md" data-testid="plus-team-access">
      <SectionHeader
        icon={<UsersThree />}
        title="Team access"
        description={
          plusWritable
            ? "Choose which Dispatchers can use Growth. Read lets them view Growth; write lets them change it. Their Core role and operations access never change here."
            : "Nemryn Plus is not active, so only Organization Admins can view Growth. You can still remove access that is no longer needed."
        }
      />
      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="plus-team-notice">
          {notice}
        </p>
      )}
      <Panel>
        <ul aria-label="Nemryn Plus team access">
          {members.map((member) => (
            // Keyed by the stable membership handle: the refresh after a change must NOT remount the row, or its open
            // dialog would unmount before it reports the outcome. The new grant version arrives as a prop.
            <TeamAccessRow
              key={member.handle}
              member={member}
              plusWritable={plusWritable}
              organizationId={organizationId}
              organizationName={organizationName}
              onDone={onDone}
            />
          ))}
        </ul>
        {!hasDispatchers && (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            There are no Dispatchers in this workspace yet. Add staff under Team &amp; Access first.
          </p>
        )}
      </Panel>
    </div>
  );
}
