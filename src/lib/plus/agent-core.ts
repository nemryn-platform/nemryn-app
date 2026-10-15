/**
 * Growth Agent -- pure presentation and drafting rules (NP-P2-S2, Phase D). Runtime-import-free (unit-tested under
 * plain Node: agent-core.test.mjs).
 *
 * The agent's DETECTION and every state change live in the database (_plus_agent_candidates, plus_run_growth_agent_review,
 * plus_approve_agent_recommendation, plus_dismiss_agent_recommendation). This module only explains a recommendation in
 * plain words and prepares an OPTIONAL message DRAFT from a fixed template for staff to read and copy. Nothing here
 * sends, calls, schedules or contacts anyone -- there is no network code in this module at all.
 *
 * Provider boundary: GrowthAgentDraftProvider is the seam a FUTURE, separately reviewed provider (e.g. an AI model under
 * a BAA and consent rules) could implement. The only provider today is the local, deterministic templateDraftProvider.
 * No contact record is sent anywhere.
 */

export type RecommendationType = "new_inquiry_waiting" | "awaiting_response" | "no_recent_activity";
export const RECOMMENDATION_TYPES: readonly RecommendationType[] = ["new_inquiry_waiting", "awaiting_response", "no_recent_activity"];

/** Internal-test thresholds, mirrored from _plus_agent_threshold (database). Shown to staff; NOT production policy. */
export const AGENT_THRESHOLDS = { newInquiryWaitingDays: 2, awaitingResponseDays: 5, noRecentActivityDays: 10, suggestedDueDays: 1 } as const;

export const NOT_SENT_LABEL = "Draft — NOT SENT";
export const AGENT_IS_ASSISTANT_NOTE =
  "The Growth Agent reviews your pipeline and suggests internal follow-ups. It never sends messages, places calls, changes stages or marks anything lost. Staff decide.";
export const CONSENT_CAVEAT =
  "Nemryn has no consent record for this person yet. Use this draft only if they agreed to be contacted this way.";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function recommendationTitle(type: string): string {
  switch (type) {
    case "new_inquiry_waiting":
      return "New inquiry waiting";
    case "awaiting_response":
      return "No reply recorded after outreach";
    case "no_recent_activity":
      return "No recent recorded activity";
    default:
      return "Needs attention";
  }
}

/**
 * Why the agent flagged it -- based ONLY on what is recorded in Plus. Never claims a customer ignored anyone: the
 * absence of a logged reply only means nothing was logged.
 */
export function recommendationReason(type: string, signalDays: number): string {
  switch (type) {
    case "new_inquiry_waiting":
      return `Still a new inquiry after ${plural(signalDays, "day")}, with no note, call, email or meeting recorded since it came in.`;
    case "awaiting_response":
      return `Your team's last recorded outreach (a logged call or email) was ${plural(signalDays, "day")} ago, and nothing has been recorded since. This doesn't mean the person ignored it — only that no reply was logged.`;
    case "no_recent_activity":
      return `Nothing has been recorded on this opportunity or its contact for ${plural(signalDays, "day")}.`;
    default:
      return "This opportunity may need attention.";
  }
}

export function proposedActionText(type: string, doNotContact: boolean): string {
  if (doNotContact) return "Create an internal task to review this opportunity. The contact asked not to be contacted, so no outreach is suggested.";
  switch (type) {
    case "new_inquiry_waiting":
      return "Create a follow-up task to make first contact.";
    case "awaiting_response":
      return "Create a follow-up task to check in.";
    default:
      return "Create a follow-up task to review where this stands.";
  }
}

/** The default title for the internal task a staff member may approve (editable before creating). */
export function suggestedTaskTitle(type: string, opportunityTitle: string, doNotContact: boolean): string {
  const t = opportunityTitle.trim().slice(0, 150);
  if (doNotContact) return `Review (do not contact): ${t}`;
  switch (type) {
    case "new_inquiry_waiting":
      return `First contact: ${t}`;
    case "awaiting_response":
      return `Check in: ${t}`;
    default:
      return `Review: ${t}`;
  }
}

/** First word of a display name, used as a greeting; "there" when unusable. Never invents a name. */
export function firstName(displayName: string | null | undefined): string {
  const w = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,39}$/u.test(w) ? w : "there";
}

export interface DraftContext {
  type: string;
  contactName: string | null;
  organizationName: string;
  doNotContact: boolean;
  preferredChannel: string;
  hasPhone: boolean;
  hasEmail: boolean;
}

export type DraftDecision =
  | { allowed: true; channel: "phone" | "email" }
  | { allowed: false; reason: string };

/** Whether ANY draft may be prepared. Stays conservative: missing or unclear permission means no draft. */
export function draftDecision(c: DraftContext): DraftDecision {
  if (c.doNotContact) return { allowed: false, reason: "No draft: this person asked not to be contacted." };
  if (c.preferredChannel === "none") return { allowed: false, reason: "No draft: this person has no preferred contact channel." };
  if (c.preferredChannel === "phone" && !c.hasPhone) return { allowed: false, reason: "No draft: no phone number is recorded." };
  if (c.preferredChannel === "email" && !c.hasEmail) return { allowed: false, reason: "No draft: no email address is recorded." };
  if (c.preferredChannel !== "phone" && c.preferredChannel !== "email") return { allowed: false, reason: "No draft: the preferred channel is unclear." };
  return { allowed: true, channel: c.preferredChannel };
}

/** The future-provider seam. Implementations must be pure with respect to sending: they only return text. */
export interface GrowthAgentDraftProvider {
  readonly id: string;
  draft(c: DraftContext): { channel: "phone" | "email"; text: string } | null;
}

/**
 * The local, deterministic template provider. Uses only the person's first name and the workspace name. Never adds
 * prices, appointments, vehicle availability, medical details or any claim of consent.
 */
export const templateDraftProvider: GrowthAgentDraftProvider = {
  id: "template-v1",
  draft(c) {
    const d = draftDecision(c);
    if (!d.allowed) return null;
    const name = firstName(c.contactName);
    const org = c.organizationName.trim() || "our team";
    const ask =
      c.type === "new_inquiry_waiting"
        ? "We received your transportation inquiry and wanted to follow up."
        : "We're following up on your transportation inquiry.";
    const close = "Would you still like our team to assist you?";
    const text = d.channel === "phone"
      ? `Hello ${name}, this is ${org}. ${ask} ${close}`
      : `Hello ${name},\n\nThis is ${org}. ${ask} ${close}\n\nThank you,\n${org}`;
    return { channel: d.channel, text };
  },
};

export function reviewOutcomeLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Task created by staff";
    case "dismissed":
      return "Dismissed by staff";
    case "not_relevant":
      return "Marked not relevant by staff";
    case "superseded":
      return "Withdrawn — the situation changed";
    default:
      return "Waiting for review";
  }
}

export function agentErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ZW003":
      return "This recommendation changed since you opened it. Reload the page and review it again.";
    case "ZW004":
      return "This recommendation was already reviewed.";
    case "ZW006":
      return "Check the task: it needs a title, and the assignee must have Nemryn Plus write access.";
    case "ZW001":
      return "You can view recommendations but not act on them. Ask an Organization Admin for write access.";
    case "ZW002":
      return "That recommendation isn't available. It may not exist, or you may no longer have access.";
    default:
      return "That couldn't be completed. Try again.";
  }
}
