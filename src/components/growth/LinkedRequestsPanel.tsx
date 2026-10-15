import Link from "next/link";
import { AttentionState } from "@/components/ui/AttentionState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { listLinkedRequests, type LinkedRequest } from "@/lib/plus/attribution";
import { decisionReasonLabel, linkMethodLabel, requestOutcomeLine } from "@/lib/plus/attribution-core";
import { formatContactTime } from "@/lib/plus/contacts-core";
import { requestStatusCategory, requestStatusLabel } from "@/lib/operations/presentation";
import { SERVICE_TYPE_LABELS } from "@/lib/public-intake/website-intake-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Linked Operations requests on a Contact or Opportunity detail page (NP-P2-S3). Server component. Each row shows the
 * Request's REAL Core status and outcome, derived live from Core (plus_get_request_summaries) -- never inferred from
 * the opportunity stage and never labelled a sales conversion. Minimum-necessary facts only: no requester phone /
 * email, addresses, notes or passenger details. Linking is done from the Request itself (Operations -> Request).
 */
export async function LinkedRequestsPanel({
  organizationId,
  timezone,
  subject,
}: {
  organizationId: string;
  timezone: string;
  subject: { kind: "contact" | "opportunity"; id: string };
}) {
  let rows: LinkedRequest[] | null = null;
  try {
    rows = (await listLinkedRequests(organizationId, subject.kind === "contact" ? { contactId: subject.id } : { opportunityId: subject.id })).rows;
  } catch {
    rows = null;
  }
  return (
    <div className="flex flex-col gap-zw-md" data-testid={`${subject.kind}-requests`}>
      <SectionHeader
        title="Linked requests"
        description="Operations requests linked to this record. Status comes from Operations; linking doesn't change it."
      />
      {rows === null ? (
        <AttentionState level="critical" title="Linked requests couldn't be loaded" description="Reload the page to try again." />
      ) : rows.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="linked-requests-empty">
          No requests linked yet. Link one from Operations → Requests (“Track in Plus”).
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle" aria-label="Linked requests">
          {rows.map((r) => {
            const reason = decisionReasonLabel(r.decisionReasonCode);
            return (
              <li key={r.requestId} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid="linked-request" data-state={r.state}>
                <div className="min-w-0">
                  <Link href={`/operations/requests/${r.requestId}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                    {r.serviceType ? (SERVICE_TYPE_LABELS[r.serviceType as keyof typeof SERVICE_TYPE_LABELS] ?? "Request") : "Request"} · logged{" "}
                    {formatContactTime(r.createdAt, timezone)}
                  </Link>
                  <p className={cn(typography.metadata, "text-text-secondary")} data-testid="linked-request-outcome">
                    {requestOutcomeLine(r)}
                    {reason ? ` · ${reason}` : ""}
                  </p>
                  <p className={cn(typography.metadata, "text-text-muted")}>
                    {linkMethodLabel(r.linkMethod)}
                    {subject.kind === "contact" && r.opportunityTitle ? ` · ${r.opportunityTitle}` : ""}
                  </p>
                </div>
                <StatusBadge label={requestStatusLabel(r.state)} category={requestStatusCategory(r.state)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
