"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { UserPlus } from "@phosphor-icons/react/dist/ssr";
import {
  cancelStaffInviteAction,
  changeStaffRoleAction,
  inviteStaffAction,
  resendStaffInviteAction,
  setStaffAccessAction,
  type TeamActionState,
} from "@/app/operations/settings/team/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { STAFF_ROLE_OPTIONS, accessChangeCopy, staffRoleLabel, type StaffRole } from "@/lib/operations/team-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TeamMemberView {
  handle: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  joined: string;
  isSelf: boolean;
}

export interface InvitationView {
  handle: string;
  email: string;
  role: StaffRole;
  expired: boolean;
  expires: string;
}

const IDLE: TeamActionState = { status: "idle" };

function Message({ state }: { state: TeamActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.metadata, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
      {state.message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Invite dialog
// ---------------------------------------------------------------------------
function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [state, action, pending] = useActionState(inviteStaffAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);

  return (
    <Dialog open={open} onClose={onClose} title="Invite team member" description="They'll receive a secure link to join this organization.">
      <form action={action} className="flex flex-col gap-zw-md" noValidate>
        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="off"
          required
          disabled={pending}
          defaultValue={state.email ?? ""}
          placeholder="name@example.com"
        />
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className={cn(typography.label, "mb-1 text-text-primary")}>Role</legend>
          {STAFF_ROLE_OPTIONS.map((option, index) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-sm border border-border-subtle p-3">
              <input type="radio" name="role" value={option.value} defaultChecked={index === 1} className="mt-1" />
              <span>
                <span className={cn(typography.label, "block text-text-primary")}>{option.label}</span>
                <span className={cn(typography.metadata, "block text-text-secondary")}>{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {state.status === "error" && <Message state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Send invitation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (role change / deactivate)
// ---------------------------------------------------------------------------
function ConfirmAccessDialog({
  open,
  onClose,
  onDone,
  member,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  member: TeamMemberView;
  kind: "deactivate" | "demote";
}) {
  const [state, action, pending] = useActionState(kind === "deactivate" ? setStaffAccessAction : changeStaffRoleAction, IDLE);
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);
  const copy = accessChangeCopy({ action: kind, isSelf: member.isSelf, name: member.name });

  return (
    <Dialog open={open} onClose={onClose} title={copy.title} description={copy.body}>
      <form action={action} className="flex flex-col gap-zw-md">
        <input type="hidden" name="handle" value={member.handle} />
        {kind === "deactivate" ? <input type="hidden" name="active" value="false" /> : <input type="hidden" name="role" value="dispatcher" />}
        {state.status === "error" && <Message state={state} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending}>
            {copy.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// A one-click action (no confirmation needed): promote / reactivate / resend / cancel.
// Runs the Server Action from a transition and reports the outcome to the
// PARENT: the row this button lives in is often re-rendered away by the very
// change it makes (the "Make Organization Admin" button disappears, a cancelled
// invitation leaves the list), so the result must not depend on this component
// still being mounted.
function QuickAction({
  action,
  fields,
  label,
  onDone,
}: {
  action: (prev: TeamActionState, formData: FormData) => Promise<TeamActionState>;
  fields: Record<string, string>;
  label: string;
  onDone: (message: string, tone?: "success" | "error") => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="text"
      loading={pending}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const formData = new FormData();
          for (const [name, value] of Object.entries(fields)) formData.set(name, value);
          const result = await action(IDLE, formData);
          onDone(result.message ?? "", result.status === "error" ? "error" : "success");
        })
      }
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
function MemberRow({ member, onDone }: { member: TeamMemberView; onDone: (message: string, tone?: "success" | "error") => void }) {
  const [confirm, setConfirm] = useState<"deactivate" | "demote" | null>(null);
  const close = useCallback(() => setConfirm(null), []);

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn(typography.subsectionHeading, "min-w-0 break-words text-text-primary")}>
          {member.name}
          {member.isSelf && <span className={cn(typography.metadata, "ml-2 font-normal text-text-muted")}>You</span>}
        </p>
        <p className={cn(typography.bodySmall, "min-w-0 break-all text-text-secondary")}>{member.email}</p>
        <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>Joined {member.joined}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
        <div className="flex items-center gap-2">
          <span className={cn(typography.label, "text-text-primary")}>{staffRoleLabel(member.role)}</span>
          <StatusBadge label={member.isActive ? "Active" : "Inactive"} category={member.isActive ? "positive" : "neutral"} />
        </div>
        <div className="flex flex-wrap items-start gap-1 md:justify-end">
          {member.isActive && member.role === "dispatcher" && (
            <QuickAction action={changeStaffRoleAction} fields={{ handle: member.handle, role: "organization_admin" }} label="Make Organization Admin" onDone={onDone} />
          )}
          {member.isActive && member.role === "organization_admin" && (
            <Button type="button" size="sm" variant="text" onClick={() => setConfirm("demote")}>
              Change to Dispatcher
            </Button>
          )}
          {member.isActive ? (
            <Button type="button" size="sm" variant="text" onClick={() => setConfirm("deactivate")}>
              Deactivate access
            </Button>
          ) : (
            <QuickAction action={setStaffAccessAction} fields={{ handle: member.handle, active: "true" }} label="Reactivate access" onDone={onDone} />
          )}
        </div>
      </div>
      <ConfirmAccessDialog open={confirm === "deactivate"} onClose={close} onDone={onDone} member={member} kind="deactivate" />
      <ConfirmAccessDialog open={confirm === "demote"} onClose={close} onDone={onDone} member={member} kind="demote" />
    </li>
  );
}

function InvitationRow({ invitation, onDone }: { invitation: InvitationView; onDone: (message: string, tone?: "success" | "error") => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn(typography.subsectionHeading, "min-w-0 break-all text-text-primary")}>{invitation.email}</p>
        <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>
          {invitation.expired ? `Expired ${invitation.expires}` : `Expires ${invitation.expires}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
        <div className="flex items-center gap-2">
          <span className={cn(typography.label, "text-text-primary")}>{staffRoleLabel(invitation.role)}</span>
          <StatusBadge label={invitation.expired ? "Expired" : "Invitation sent"} category={invitation.expired ? "warning" : "neutral"} />
        </div>
        <div className="flex flex-wrap items-start gap-1 md:justify-end">
          <QuickAction action={resendStaffInviteAction} fields={{ handle: invitation.handle }} label="Resend" onDone={onDone} />
          <QuickAction action={cancelStaffInviteAction} fields={{ handle: invitation.handle }} label="Cancel invitation" onDone={onDone} />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------
export function TeamSection({ members, invitations }: { members: TeamMemberView[]; invitations: InvitationView[] }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const closeInvite = useCallback(() => setInviteOpen(false), []);
  const onDone = useCallback((message: string, tone: "success" | "error" = "success") => setNotice(message ? { text: message, tone } : null), []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <SectionHeader
        title="Team members"
        description="The staff who can operate this organization in Nemryn. Drivers are managed under Drivers."
        actions={
          <Button type="button" size="sm" leadingIcon={<UserPlus className="size-3.5" aria-hidden />} onClick={() => { setNotice(null); setInviteOpen(true); }}>
            Invite team member
          </Button>
        }
      />

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={cn(typography.bodySmall, notice.tone === "error" ? "text-critical-text" : "text-text-secondary")}>
          {notice.text}
        </p>
      )}

      <Panel>
        <ul aria-label="Team members">
          {members.map((member) => (
            <MemberRow key={member.handle} member={member} onDone={onDone} />
          ))}
        </ul>
      </Panel>

      <div className="flex flex-col gap-zw-md">
        <SectionHeader title="Pending invitations" description="Invitations that haven't been accepted yet." />
        {invitations.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No pending invitations.</p>
        ) : (
          <Panel>
            <ul aria-label="Pending invitations">
              {invitations.map((invitation) => (
                <InvitationRow key={invitation.handle} invitation={invitation} onDone={onDone} />
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <InviteDialog open={inviteOpen} onClose={closeInvite} onDone={onDone} />
    </div>
  );
}
