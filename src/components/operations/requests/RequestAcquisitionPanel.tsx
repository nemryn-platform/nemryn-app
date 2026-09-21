import { Panel } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { describeAcquisition, type RequestAcquisition } from "@/lib/operations/request-acquisition-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestAcquisitionPanelProps {
  acquisition: RequestAcquisition | null;
}

/**
 * Request Detail -> Acquisition (P1-PILOT-S4C). Restrained, read-only evidence of how this website Request
 * reached the tenant (source, medium, campaign, landing page, referrer ...). Rendered ONLY when useful
 * attribution exists -- for every historical Request and every submission with no valid acquisition the section
 * is omitted entirely (no empty state, no "Direct" / "Unknown" guess). No editing, no raw JSON, no ids, no
 * links (values are plain text). Kept out of the primary Request workflow: it sits in the secondary column.
 */
export function RequestAcquisitionPanel({ acquisition }: RequestAcquisitionPanelProps) {
  const rows = describeAcquisition(acquisition);
  if (rows.length === 0) return null;
  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "border-b border-border-subtle pb-zw-md text-text-primary")}>Acquisition</h3>
      <div className="mt-zw-md">
        <DefinitionList
          columns={1}
          items={rows.map((row) => ({ label: row.label, value: <span className="break-words">{row.value}</span> }))}
        />
      </div>
      <p className={cn(typography.metadata, "mt-zw-md text-text-muted")}>Recorded when the request was submitted from your website.</p>
    </Panel>
  );
}
