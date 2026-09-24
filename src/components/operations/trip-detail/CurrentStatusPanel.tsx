import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { LinkButton } from "@/components/ui/LinkButton";
import { formatOperationsTime } from "@/lib/operations/presentation";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface CurrentStatusPanelProps {
  statusLabel: string;
  driverName: string | null;
  lastUpdateAt: string | null;
  /** Read-only informational text ("what the Driver will do next") — never a button. Operations cannot trigger Driver lifecycle progression here (work item §20). Null once the Trip is terminal. */
  driverNextActionLabel: string | null;
  timezone: string;
  /** Whether the Trip currently has an active assignment — determines "Assign Driver" vs. "Manage Assignment" (work item §18). Omitted entirely once the Trip is terminal (nothing left to (re)assign). */
  eligibleForAssignmentAction: boolean;
  hasActiveAssignment: boolean;
  /** P1-OPS-PROG1: the in-place Assign / Manage Assignment control (same dialog + Server Action as Dispatch) for a Trip in an assignable state. When absent, the generic Dispatch link below is shown as before. */
  assignmentControl?: ReactNode;
}

/**
 * "Current Status" (docs/design/stitch/references/02-trip-detail.png) —
 * the right-rail summary. The reference's Driver name carries a "(View)"
 * link to a Driver detail screen that does not exist yet (Operations'
 * `/operations/drivers` remains a stub) — omitted rather than linked to
 * nowhere real.
 *
 * The assignment-management entry point (work item §18) lives here as a
 * link to the canonical Dispatch route — generic, not deep-linked to this
 * specific Trip (the Dispatch Board has no per-Trip deep-link parameter
 * yet), matching the same documented limitation Today's Operations'
 * "Assign" action already established.
 *
 * P1-OPS-PROG1: for a Trip in an assignable state the page now passes
 * `assignmentControl` -- the Dispatch board's own AssignmentDialog and
 * `assignmentAction`, mounted in place (the today-only board never lists a
 * Trip scheduled tomorrow or later). Still no second mutation path.
 */
export function CurrentStatusPanel({
  statusLabel,
  driverName,
  lastUpdateAt,
  driverNextActionLabel,
  timezone,
  eligibleForAssignmentAction,
  hasActiveAssignment,
  assignmentControl,
}: CurrentStatusPanelProps) {
  const items = [
    ...(driverName ? [{ label: "Driver", value: driverName }] : []),
    { label: "Last Update", value: formatOperationsTime(lastUpdateAt, timezone) },
    ...(driverNextActionLabel ? [{ label: "Next Action", value: driverNextActionLabel }] : []),
  ];

  return (
    <Panel>
      <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>Current Status</p>
      <p className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>{statusLabel}</p>
      <div className="mt-zw-lg border-t border-border-subtle pt-zw-lg">
        <DefinitionList items={items} />
      </div>
      {eligibleForAssignmentAction && assignmentControl && <div className="mt-zw-lg">{assignmentControl}</div>}
      {eligibleForAssignmentAction && !assignmentControl && (
        <div className="mt-zw-lg">
          <LinkButton href="/operations/dispatch" variant="outline" size="sm" className="w-full">
            {hasActiveAssignment ? "Manage Assignment" : "Assign Driver"}
          </LinkButton>
        </div>
      )}
    </Panel>
  );
}
