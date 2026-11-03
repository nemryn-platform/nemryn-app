import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RequestGrowthControls } from "@/components/growth/RequestGrowthControls";
import { getPlusAccessState } from "@/lib/plus/access";
import { canOpenGrowth, canWriteGrowth } from "@/lib/plus/access-core";
import { getRequestAttribution, isRequestContactEnabled, type RequestAttribution } from "@/lib/plus/attribution";
import {
  CONVERSION_LINK_NOTE,
  buildRequesterPrefill,
  canOfferAddContact,
  contactLinkId,
  isLinkCorrectable,
  linkMethodLabel,
  type RequesterFacts,
} from "@/lib/plus/attribution-core";
import { listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { formatContactTime } from "@/lib/plus/contacts-core";
import { stageDisplayLabel } from "@/lib/plus/opportunities-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Operations -> Request detail -> Growth (NP-P2-S3; product spec 7.4). Sits next to the existing Acquisition section.
 * Rendered ONLY for people Growth admits (Plus entitlement + Organization Admin or a Dispatcher's named grant); for
 * everyone else it returns null -- no placeholder, no disabled control, no Growth data. Read-only Plus users see the
 * link without controls. The Request's own decision, passenger, trips and acquisition are never touched from here.
 *
 * NP-CORE-PLUS-REQUEST-02B: "Add contact" is offered only for an unlinked Request, a Growth writer and an organization
 * on the synthetic-only activation allowlist (ZD-300). Its prefill is built from the REQUESTER facts only (the caller
 * passes no passenger field; ZD-296), and the database re-checks everything when the form is submitted.
 */
export async function RequestGrowthPanel({
  organizationId,
  requestId,
  timezone,
  requester,
}: {
  organizationId: string;
  requestId: string;
  timezone: string;
  requester: RequesterFacts;
}) {
  const plus = await getPlusAccessState(organizationId);
  if (!canOpenGrowth(plus.state, plus.capability)) return null;
  const canWrite = canWriteGrowth(plus.state, plus.capability);

  let attribution: RequestAttribution | null = null;
  let failed = false;
  try {
    attribution = await getRequestAttribution(organizationId, requestId);
  } catch {
    failed = true;
  }

  let addContact: { initial: ReturnType<typeof buildRequesterPrefill>; owners: OwnerOption[] } | null = null;
  if (!failed && canWrite && !attribution) {
    const enabled = await isRequestContactEnabled(organizationId);
    if (canOfferAddContact({ linked: false, canWrite, enabled })) {
      let owners: OwnerOption[] = [];
      try {
        owners = await listOwnerOptions(organizationId);
      } catch {
        // The form still works without owner choices ("No owner").
      }
      addContact = { initial: buildRequesterPrefill(requester), owners };
    }
  }

  return (
    <Panel data-testid="request-growth-panel">
      <h3 className={cn(typography.subsectionHeading, "border-b border-border-subtle pb-zw-md text-text-primary")}>Growth</h3>
      <div className="mt-zw-md flex flex-col gap-zw-md">
        {failed ? (
          <p className={cn(typography.bodySmall, "text-critical-text")} data-testid="request-growth-error">
            The Growth link couldn&apos;t be loaded. Reload to try again.
          </p>
        ) : attribution ? (
          <>
            <DefinitionList
              columns={1}
              items={[
                {
                  label: "Contact",
                  value: attribution.contactId ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        id={contactLinkId(requestId)}
                        href={`/operations/growth/contacts/${attribution.contactId}`}
                        className="text-text-link hover:underline"
                        data-testid="request-growth-contact"
                      >
                        {attribution.contactName}
                      </Link>
                      {attribution.contactStatus === "archived" && <StatusBadge label="Archived" category="neutral" />}
                      <Link
                        href={`/operations/growth/contacts/${attribution.contactId}`}
                        className={cn(typography.metadata, "text-text-link hover:underline")}
                        data-testid="request-growth-open-in-plus"
                      >
                        Open in Plus
                      </Link>
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Opportunity",
                  value: attribution.opportunityId ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/operations/growth/pipeline/${attribution.opportunityId}`} className="text-text-link hover:underline" data-testid="request-growth-opportunity">
                        {attribution.opportunityTitle}
                      </Link>
                      <span className={cn(typography.metadata, "text-text-secondary")}>{stageDisplayLabel(attribution.opportunityStage ?? "")}</span>
                    </span>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "Link",
                  value: (
                    <span data-testid="request-growth-method">
                      {linkMethodLabel(attribution.linkMethod)}
                      {attribution.linkedByName ? ` by ${attribution.linkedByName}` : ""}, {formatContactTime(attribution.linkedAt, timezone)}
                    </span>
                  ),
                },
              ]}
            />
            {!isLinkCorrectable(attribution.linkMethod) ? (
              // NP-P2-S4-R5-F1: a conversion link is permanent (the database refuses changes); say so, offer no control
              <p className={cn(typography.metadata, "text-text-secondary")} data-testid="request-growth-conversion-note">
                {CONVERSION_LINK_NOTE}
              </p>
            ) : canWrite && (
              <RequestGrowthControls
                organizationId={organizationId}
                requestId={requestId}
                current={{
                  contactId: attribution.contactId,
                  contactName: attribution.contactName,
                  opportunityId: attribution.opportunityId,
                  version: attribution.updatedAt,
                }}
              />
            )}
          </>
        ) : (
          <>
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="request-growth-unlinked">
              Not linked to a Growth contact or opportunity.
            </p>
            {canWrite && <RequestGrowthControls organizationId={organizationId} requestId={requestId} current={null} addContact={addContact} />}
          </>
        )}
      </div>
    </Panel>
  );
}
