import { Panel } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { REQUESTER_RELATIONSHIP_OPTIONS, selectOptionLabel } from "@/lib/operations/log-request-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestRequesterPanelProps {
  requesterName: string;
  requesterRelationship: string;
  requesterPhone: string;
  requesterEmail: string | null;
}

/**
 * P1-E1-S2E §7 — the REQUESTER (who called this in), kept visually and
 * structurally separate from the PASSENGER section (P1-E1-S2D §14's own
 * "never imply the requester IS the passenger" rule, carried through to
 * Detail: these are two different panels, never merged fields).
 */
export function RequestRequesterPanel({ requesterName, requesterRelationship, requesterPhone, requesterEmail }: RequestRequesterPanelProps) {
  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "border-b border-border-subtle pb-zw-md text-text-primary")}>
        Requester
      </h3>
      <div className="mt-zw-md">
        <DefinitionList
          columns={2}
          items={[
            { label: "Name", value: requesterName },
            { label: "Relationship", value: selectOptionLabel(REQUESTER_RELATIONSHIP_OPTIONS, requesterRelationship) },
            { label: "Phone", value: requesterPhone },
            { label: "Email", value: requesterEmail ?? <span className="text-text-muted">Not on file</span> },
          ]}
        />
      </div>
    </Panel>
  );
}
