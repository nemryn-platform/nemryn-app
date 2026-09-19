import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SOURCE_OPTIONS, selectOptionLabel } from "@/lib/operations/log-request-options";
import { requestProvenanceLabel } from "@/lib/public-intake/website-intake-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestDetailsPanelProps {
  source: string;
  /** P1-PILOT-S4A — pass `request.intakeIntegrationId` through unchanged; `null` for every staff-entered Request. */
  intakeIntegrationId: string | null;
  assistanceNotes: string | null;
  additionalNotes: string | null;
}

/**
 * P1-E1-S2E §24/§25 — provenance (source) and the two distinct free-text
 * note fields. Source is shown as restrained metadata (a small muted
 * line), never visually dominant next to lifecycle Status — it is useful
 * context, not a status signal. assistance_notes/additional_notes are
 * deliberately kept as two separate fields (never collapsed into one),
 * each with an honest "No … notes" placeholder rather than a raw `null`.
 *
 * P1-PILOT-S4A adds one small, restrained "Website" badge next to the
 * existing Source line, shown only when this Request was actually
 * created via the public intake path (`intakeIntegrationId !== null`) —
 * never merely because `source === 'web'`, which a staff member can
 * still select manually for an entirely hand-typed Request. Quiet by
 * design (a neutral badge, not a warning/status color) — the operator
 * should simply understand where the Request came from, not be alerted
 * to it.
 */
export function RequestDetailsPanel({ source, intakeIntegrationId, assistanceNotes, additionalNotes }: RequestDetailsPanelProps) {
  const provenanceLabel = requestProvenanceLabel(intakeIntegrationId);
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-zw-md">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Request Details</h3>
        <span className={cn(typography.metadata, "flex items-center gap-1.5 text-text-muted")}>
          Source: {selectOptionLabel(SOURCE_OPTIONS, source)}
          {provenanceLabel && <StatusBadge label={provenanceLabel} category="neutral" />}
        </span>
      </div>
      <div className="mt-zw-md flex flex-col gap-zw-md">
        <div>
          <p className={cn(typography.label, "text-text-muted")}>Assistance Notes</p>
          <p className={cn(typography.body, "mt-0.5 text-text-primary")}>
            {assistanceNotes || <span className="text-text-muted">No assistance notes</span>}
          </p>
        </div>
        <div>
          <p className={cn(typography.label, "text-text-muted")}>Additional Notes</p>
          <p className={cn(typography.body, "mt-0.5 text-text-primary")}>
            {additionalNotes || <span className="text-text-muted">No additional notes</span>}
          </p>
        </div>
      </div>
    </Panel>
  );
}
