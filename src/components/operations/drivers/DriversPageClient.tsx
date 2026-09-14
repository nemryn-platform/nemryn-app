"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IdentificationBadge, Plus, X, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { InviteDriverDialog } from "./InviteDriverDialog";
import { revokeDriverInviteAction, resendDriverInviteAction } from "@/app/operations/drivers/actions";
import type { DriversListRow } from "@/lib/operations/drivers-list";
import type { DriverInviteRow } from "@/lib/operations/driver-invites-list";

export interface DriversPageClientProps {
  rows: DriversListRow[];
  invites: DriverInviteRow[];
  canInvite: boolean;
}

/**
 * Drivers screen client shell (P1-E3-S9, work item §10 — closes GAP-15).
 * "Invite Driver" and the pending-invites list are only rendered for
 * Organization Admin (`canInvite`) — a Dispatcher sees the same directory
 * as before, unchanged, matching authorization-model.md §F/§J
 * ("create_driver_profile: Organization Admin... Not Dispatcher").
 */
export function DriversPageClient({ rows, invites, canInvite }: DriversPageClientProps) {
  const [inviting, setInviting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resendNotice, setResendNotice] = useState<{ id: string; text: string } | null>(null);
  const router = useRouter();

  function handleResend(inviteId: string, email: string) {
    setResendNotice(null);
    startTransition(async () => {
      const result = await resendDriverInviteAction(inviteId);
      const text =
        result.status === "sent"
          ? `Invitation re-sent to ${email}.`
          : result.status === "not_configured"
            ? "Email delivery isn't configured for this environment."
            : "Couldn't re-send the invitation. Try again shortly.";
      setResendNotice({ id: inviteId, text });
    });
  }

  const columns: DataTableColumn<DriversListRow>[] = [
    { key: "name", header: "Name", primary: true, render: (row) => row.displayName },
    { key: "phone", header: "Phone", render: (row) => row.phone ?? <span className="text-text-muted">Not on file</span> },
    {
      key: "current",
      header: "Current Trip",
      render: (row) =>
        row.currentTripPassengerName ? (
          <StatusBadge label={`On ${row.currentTripPassengerName}'s trip`} category="active" />
        ) : (
          <span className="text-text-muted">No active trip</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge label={row.status === "active" ? "Active" : "Inactive"} category={row.status === "active" ? "positive" : "neutral"} />,
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      {canInvite && (
        <div className="flex justify-end">
          <Button type="button" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setInviting(true)}>
            Invite Driver
          </Button>
        </div>
      )}

      {canInvite && invites.length > 0 && (
        <Panel className="flex flex-col gap-zw-sm">
          <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Pending Invites</h2>
          <ul className="divide-y divide-border-subtle">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-1 py-zw-sm first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{invite.displayName}</p>
                    <p className={cn(typography.metadata, "text-text-muted")}>{invite.email}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={`Resend invitation to ${invite.email}`}
                      icon={<PaperPlaneTilt className="size-4" aria-hidden />}
                      disabled={pending}
                      onClick={() => handleResend(invite.id, invite.email)}
                    />
                    <IconButton
                      label={`Revoke invite for ${invite.email}`}
                      icon={<X className="size-4" aria-hidden />}
                      disabled={pending}
                      onClick={() => startTransition(async () => {
                        await revokeDriverInviteAction(invite.id);
                        router.refresh();
                      })}
                    />
                  </div>
                </div>
                {resendNotice?.id === invite.id && (
                  <p role="status" className={cn(typography.metadata, "text-text-secondary")}>
                    {resendNotice.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState icon={<IdentificationBadge className="size-8" aria-hidden />} title="No drivers yet" description="Drivers on your team will appear here." />
        }
      />

      {inviting && <InviteDriverDialog onClose={() => setInviting(false)} />}
    </div>
  );
}
