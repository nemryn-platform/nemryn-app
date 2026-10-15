import type { Recommendation } from "./agent";
import {
  AGENT_THRESHOLDS,
  draftDecision,
  proposedActionText,
  recommendationReason,
  recommendationTitle,
  reviewOutcomeLabel,
  suggestedTaskTitle,
  templateDraftProvider,
} from "./agent-core";
import { activityTypeLabel, formatContactTime } from "./contacts-core";
import { stageDisplayLabel } from "./opportunities-core";
import { localDueParts } from "./tasks-core";
import type { RecommendationView } from "@/components/growth/GrowthAgent";

/** Builds a recommendation card's view model. The draft comes from the LOCAL template provider; nothing is sent. */
export function toRecommendationView(r: Recommendation, timezone: string, organizationName: string): RecommendationView {
  const ctx = {
    type: r.type,
    contactName: r.contactName,
    organizationName,
    doNotContact: r.contactDoNotContact,
    preferredChannel: r.contactPreferredChannel,
    hasPhone: r.contactHasPhone,
    hasEmail: r.contactHasEmail,
  };
  const decision = draftDecision(ctx);
  const due = localDueParts(new Date(Date.now() + AGENT_THRESHOLDS.suggestedDueDays * 86_400_000).toISOString(), timezone);
  return {
    id: r.id,
    version: r.updatedAt,
    status: r.status,
    opportunityId: r.opportunityId,
    opportunityTitle: r.opportunityTitle,
    stageLabel: stageDisplayLabel(r.opportunityStage),
    contactId: r.contactId,
    contactName: r.contactName,
    doNotContact: r.contactDoNotContact,
    title: recommendationTitle(r.type),
    reason: recommendationReason(r.type, r.signalDays),
    proposedAction: proposedActionText(r.type, r.contactDoNotContact),
    lastActivityLabel: r.lastActivityAt
      ? `${r.lastActivityType ? activityTypeLabel(r.lastActivityType) : "Activity"} · ${formatContactTime(r.lastActivityAt, timezone)}`
      : "Nothing recorded yet",
    generatedLabel: `Suggested by the Growth Agent ${formatContactTime(r.createdAt, timezone)}${r.generatedByName ? ` (review run by ${r.generatedByName})` : ""}`,
    outcomeLabel:
      r.status === "pending"
        ? null
        : `${reviewOutcomeLabel(r.status)}${r.reviewedByName ? ` — ${r.reviewedByName}` : ""}${r.reviewedAt ? `, ${formatContactTime(r.reviewedAt, timezone)}` : ""}`,
    draft: templateDraftProvider.draft(ctx),
    noDraftReason: decision.allowed ? null : decision.reason,
    suggestedTaskTitle: suggestedTaskTitle(r.type, r.opportunityTitle, r.contactDoNotContact),
    suggestedDueDate: due.date,
  };
}
