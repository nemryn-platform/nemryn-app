/**
 * Pure rules for the Nemryn Plus private-pay pipeline (NP-P2-S1). Runtime-import-free (unit-tested under plain Node:
 * opportunities-core.test.mjs).
 *
 * The database is the authority: plus_create_opportunity / plus_update_opportunity / plus_change_opportunity_stage /
 * plus_mark_opportunity_lost / plus_reopen_opportunity re-check Plus access, the organization, the contact, every value,
 * the stage rules and the version. These helpers mirror those rules so forms can explain a problem before submitting
 * and so wording lives in one place. They never grant anything.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Stages (domain model 8.1; product spec 4.3)
// ---------------------------------------------------------------------------------------------------------------------
export const OPEN_STAGES = ["new_inquiry", "contacted", "qualified", "quote_sent", "quote_accepted"] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];
export type OpportunityStage = OpenStage | "converted" | "lost";
export const ALL_STAGES: readonly OpportunityStage[] = [...OPEN_STAGES, "converted", "lost"];

const STAGE_LABELS: Record<OpportunityStage, string> = {
  new_inquiry: "New inquiry",
  contacted: "Contacted",
  qualified: "Qualified",
  quote_sent: "Quote sent",
  quote_accepted: "Quote accepted",
  converted: "Converted",
  lost: "Lost",
};

/**
 * The two quote stages are STAFF-RECORDED: set by hand here, or by "Mark sent" / "Record accepted" on an estimate or
 * quote (NP-P2-S5-S3B). Nemryn keeps the quote records but never sends a quote or verifies delivery or acceptance.
 */
export const REPORTED_QUOTE_STAGE_NOTE =
  "Quote stages are recorded by your team, by hand or when a quote is marked sent or its acceptance is recorded. Nemryn doesn't send quotes or verify delivery or acceptance.";

export const CONVERTED_RESERVED_NOTE =
  "Converted is set only by “Create transportation request”, which creates a pending request for Operations to review.";

export function isOpenStage(raw: unknown): raw is OpenStage {
  return typeof raw === "string" && (OPEN_STAGES as readonly string[]).includes(raw);
}
export function isStage(raw: unknown): raw is OpportunityStage {
  return typeof raw === "string" && (ALL_STAGES as readonly string[]).includes(raw);
}
export function stageLabel(stage: string): string {
  return isStage(stage) ? STAGE_LABELS[stage] : "Unknown";
}
/** "Quote sent (reported)" -- the qualifier is shown wherever a quote stage is shown. */
export function stageDisplayLabel(stage: string): string {
  return stage === "quote_sent" || stage === "quote_accepted" ? `${stageLabel(stage)} (reported)` : stageLabel(stage);
}
export function stageTone(stage: string): "neutral" | "informational" | "active" | "positive" | "warning" | "cancelled" {
  switch (stage) {
    case "new_inquiry":
      return "informational";
    case "contacted":
    case "qualified":
      return "active";
    case "quote_sent":
      return "warning";
    case "quote_accepted":
    case "converted":
      return "positive";
    case "lost":
      return "cancelled";
    default:
      return "neutral";
  }
}

/** The stages an open opportunity can move to directly (every other open stage; forward skips and backward moves). */
export function stageMoveOptions(current: string): OpenStage[] {
  return isOpenStage(current) ? OPEN_STAGES.filter((s) => s !== current) : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Closed sets
// ---------------------------------------------------------------------------------------------------------------------
export const SOURCES = ["phone", "website", "web_inquiry", "email", "referral", "facility", "walk_in", "event", "advertising", "other"] as const;
export type OpportunitySource = (typeof SOURCES)[number];
const SOURCE_LABELS: Record<OpportunitySource, string> = {
  phone: "Phone call",
  website: "Website",
  web_inquiry: "Web inquiry",
  email: "Email",
  referral: "Referral",
  facility: "Facility",
  walk_in: "Walk-in",
  event: "Event",
  advertising: "Advertising",
  other: "Other",
};

export const INQUIRY_TYPES = ["quote", "availability", "service_question", "booking", "other"] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];
const INQUIRY_LABELS: Record<InquiryType, string> = {
  quote: "Price / quote",
  availability: "Availability",
  service_question: "Question about the service",
  booking: "Wants to book",
  other: "Other",
};

/** Mirrors Core's service-type closed set and labels (src/lib/public-intake/website-intake-core.ts; unit-tested). */
export const SERVICE_TYPES = [
  "medical_appointment",
  "dialysis",
  "rehabilitation",
  "hospital_discharge",
  "recurring_care",
  "senior_medical",
  "wheelchair_transportation",
  "other",
] as const;
export type OpportunityServiceType = (typeof SERVICE_TYPES)[number];
const SERVICE_LABELS: Record<OpportunityServiceType, string> = {
  medical_appointment: "Medical appointment",
  dialysis: "Dialysis transportation",
  rehabilitation: "Rehabilitation transportation",
  hospital_discharge: "Hospital discharge transportation",
  recurring_care: "Recurring care transportation",
  senior_medical: "Senior medical transportation",
  wheelchair_transportation: "Wheelchair transportation",
  other: "Other",
};

/** The owner-approved canonical lost-reason vocabulary (NP-P2-S1-R1A), in canonical order. Non-medical. */
export const LOST_REASONS = [
  "no_response",
  "price",
  "chose_competitor",
  "outside_service_area",
  "service_not_offered",
  "no_availability",
  "not_a_fit",
  "duplicate",
  "other",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];
const LOST_LABELS: Record<LostReason, string> = {
  no_response: "Stopped responding",
  price: "Price",
  chose_competitor: "Chose a competitor",
  outside_service_area: "Outside our service area",
  service_not_offered: "Service we don't offer",
  no_availability: "We had no availability",
  not_a_fit: "Not a fit",
  duplicate: "Duplicate inquiry",
  other: "Other",
};

export const PAYMENT_REPORTED_STATUSES = ["none", "deposit_reported", "paid_reported", "refund_reported"] as const;
export type PaymentReportedStatus = (typeof PAYMENT_REPORTED_STATUSES)[number];
const PAYMENT_LABELS: Record<PaymentReportedStatus, string> = {
  none: "Nothing reported",
  deposit_reported: "Deposit reported by staff",
  paid_reported: "Payment reported by staff",
  refund_reported: "Refund reported by staff",
};
export const PAYMENT_REPORTED_NOTE =
  "Recorded by your team. Nemryn doesn't take or verify payments, so this is not a settlement record.";
export const ESTIMATE_NOTE = "An estimate of the first booking's value, not revenue.";

function inSet<T extends string>(set: readonly T[], raw: unknown): raw is T {
  return typeof raw === "string" && (set as readonly string[]).includes(raw);
}
export const isSource = (raw: unknown): raw is OpportunitySource => inSet(SOURCES, raw);
export const isInquiryType = (raw: unknown): raw is InquiryType => inSet(INQUIRY_TYPES, raw);
export const isServiceType = (raw: unknown): raw is OpportunityServiceType => inSet(SERVICE_TYPES, raw);
export const isLostReason = (raw: unknown): raw is LostReason => inSet(LOST_REASONS, raw);
export const isPaymentReportedStatus = (raw: unknown): raw is PaymentReportedStatus => inSet(PAYMENT_REPORTED_STATUSES, raw);

export const sourceLabel = (v: string | null) => (v && isSource(v) ? SOURCE_LABELS[v] : "—");
export const inquiryTypeLabel = (v: string | null) => (v && isInquiryType(v) ? INQUIRY_LABELS[v] : "—");
export const serviceTypeLabel = (v: string | null) => (v && isServiceType(v) ? SERVICE_LABELS[v] : "—");
export const lostReasonLabel = (v: string | null) => (v && isLostReason(v) ? LOST_LABELS[v] : "—");
export const paymentReportedLabel = (v: string) => (isPaymentReportedStatus(v) ? PAYMENT_LABELS[v] : PAYMENT_LABELS.none);

export const SOURCE_OPTIONS = SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }));
export const INQUIRY_OPTIONS = INQUIRY_TYPES.map((value) => ({ value, label: INQUIRY_LABELS[value] }));
export const SERVICE_OPTIONS = SERVICE_TYPES.map((value) => ({ value, label: SERVICE_LABELS[value] }));
export const LOST_REASON_OPTIONS = LOST_REASONS.map((value) => ({ value, label: LOST_LABELS[value] }));
export const PAYMENT_OPTIONS = PAYMENT_REPORTED_STATUSES.map((value) => ({ value, label: PAYMENT_LABELS[value] }));
export const OPEN_STAGE_OPTIONS = OPEN_STAGES.map((value) => ({ value, label: stageDisplayLabel(value) }));

export const OPPORTUNITY_LIMITS = { title: 200, sourceDetail: 120, campaign: 64, note: 500, reasonMin: 3, maxCents: 100_000_000 } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Money (estimates only)
// ---------------------------------------------------------------------------------------------------------------------
/** "$1,250" / "$1,250.50"; "" for null. Estimates are whole US dollars or cents. */
export function formatEstimate(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "";
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(dollars);
}

/** "1,250" / "$1250.50" / "" -> cents; invalid -> undefined. */
export function parseEstimate(raw: string): number | null | undefined {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const cents = Math.round(Number(s) * 100);
  return cents >= 0 && cents <= OPPORTUNITY_LIMITS.maxCents ? cents : undefined;
}

export function normalizeCampaignCode(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// Form validation (mirrors the plus_opportunities CHECK constraints)
// ---------------------------------------------------------------------------------------------------------------------
export interface OpportunityFormValues {
  contactId: string;
  title: string;
  inquiryType: string;
  serviceType: string;
  source: string;
  sourceDetail: string;
  campaignCode: string;
  estimate: string;
  paymentReportedStatus: string;
  ownerHandle: string;
}

export interface OpportunityInput {
  contactId: string;
  title: string;
  inquiryType: InquiryType;
  serviceType: OpportunityServiceType | null;
  source: OpportunitySource;
  sourceDetail: string | null;
  campaignCode: string | null;
  estimatedValueCents: number | null;
  paymentReportedStatus: PaymentReportedStatus;
  ownerHandle: string | null;
}

export type OpportunityFieldErrors = Partial<Record<keyof OpportunityFormValues | "form", string>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]*$/;
export const isUuid = (raw: unknown): raw is string => typeof raw === "string" && UUID_RE.test(raw);

export function validateOpportunityForm(values: OpportunityFormValues): { ok: true; value: OpportunityInput } | { ok: false; errors: OpportunityFieldErrors } {
  const errors: OpportunityFieldErrors = {};
  const title = values.title.trim();
  const sourceDetail = values.sourceDetail.trim();
  const campaign = normalizeCampaignCode(values.campaignCode);
  const estimate = parseEstimate(values.estimate);

  if (!isUuid(values.contactId)) errors.contactId = "Choose the contact this opportunity is for.";
  if (!title) errors.title = "Give the opportunity a short title.";
  else if (title.length > OPPORTUNITY_LIMITS.title) errors.title = `Use ${OPPORTUNITY_LIMITS.title} characters or fewer.`;
  if (!isInquiryType(values.inquiryType)) errors.inquiryType = "Choose what they asked about.";
  if (values.serviceType && !isServiceType(values.serviceType)) errors.serviceType = "Choose a service from the list.";
  if (!isSource(values.source)) errors.source = "Choose how they found you.";
  if (sourceDetail.length > OPPORTUNITY_LIMITS.sourceDetail) errors.sourceDetail = `Use ${OPPORTUNITY_LIMITS.sourceDetail} characters or fewer.`;
  if (campaign && (campaign.length > OPPORTUNITY_LIMITS.campaign || !CAMPAIGN_RE.test(campaign))) {
    errors.campaignCode = "Use lowercase letters, numbers, - and _ (for example spring_2026).";
  }
  if (estimate === undefined) errors.estimate = "Enter an amount like 250 or 1,250.50 (up to $1,000,000).";
  if (values.paymentReportedStatus && !isPaymentReportedStatus(values.paymentReportedStatus)) errors.paymentReportedStatus = "Choose a reported status.";
  if (values.ownerHandle && !UUID_RE.test(values.ownerHandle)) errors.ownerHandle = "Choose an owner from the list.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      contactId: values.contactId,
      title,
      inquiryType: values.inquiryType as InquiryType,
      serviceType: values.serviceType ? (values.serviceType as OpportunityServiceType) : null,
      source: values.source as OpportunitySource,
      sourceDetail: sourceDetail || null,
      campaignCode: campaign || null,
      estimatedValueCents: estimate ?? null,
      paymentReportedStatus: (values.paymentReportedStatus || "none") as PaymentReportedStatus,
      ownerHandle: values.ownerHandle || null,
    },
  };
}

export function validateLostInput(rawReason: unknown, rawNote: unknown): { ok: true; reason: LostReason; note: string | null } | { ok: false; error: string } {
  if (!isLostReason(rawReason)) return { ok: false, error: "Choose why the opportunity was lost." };
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (rawReason === "other" && !note) return { ok: false, error: "Add a short note when the reason is Other." };
  if (note.length > OPPORTUNITY_LIMITS.note) return { ok: false, error: `Use ${OPPORTUNITY_LIMITS.note} characters or fewer.` };
  return { ok: true, reason: rawReason, note: note || null };
}

export function validateReopenInput(rawStage: unknown, rawReason: unknown): { ok: true; stage: OpenStage; reason: string } | { ok: false; error: string } {
  if (!isOpenStage(rawStage)) return { ok: false, error: "Choose the stage to reopen it in." };
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length < OPPORTUNITY_LIMITS.reasonMin) return { ok: false, error: "Say why you're reopening it." };
  if (reason.length > OPPORTUNITY_LIMITS.note) return { ok: false, error: `Use ${OPPORTUNITY_LIMITS.note} characters or fewer.` };
  return { ok: true, stage: rawStage, reason };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pipeline list parameters
// ---------------------------------------------------------------------------------------------------------------------
export type PipelineView = "open" | "lost" | "all";
export type PipelineLayout = "board" | "list";
export interface PipelineParams {
  search: string;
  view: PipelineView;
  stage: OpportunityStage | null;
  source: OpportunitySource | null;
  owner: string | null;
  layout: PipelineLayout;
}

function single(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
}

export function parsePipelineParams(params: Record<string, string | string[] | undefined>): PipelineParams {
  const view = single(params.view);
  const stage = single(params.stage);
  const source = single(params.source);
  const owner = single(params.owner);
  const layout = single(params.layout);
  const parsedView: PipelineView = view === "lost" || view === "all" ? view : "open";
  return {
    search: single(params.q).trim().slice(0, 200),
    view: parsedView,
    // a stage filter that contradicts the view is dropped (e.g. "lost" in the open view)
    stage: isStage(stage) && stage !== "converted" && (parsedView === "all" || (parsedView === "lost") === (stage === "lost")) ? stage : null,
    source: isSource(source) ? source : null,
    owner: UUID_RE.test(owner) ? owner : null,
    // the board only makes sense for open opportunities
    layout: parsedView === "open" && layout !== "list" ? "board" : "list",
  };
}

export function pipelineHref(p: PipelineParams, overrides: Partial<PipelineParams> = {}): string {
  const v = { ...p, ...overrides };
  const qs = new URLSearchParams();
  if (v.search) qs.set("q", v.search);
  if (v.view !== "open") qs.set("view", v.view);
  if (v.stage) qs.set("stage", v.stage);
  if (v.source) qs.set("source", v.source);
  if (v.owner) qs.set("owner", v.owner);
  if (v.layout === "list" && v.view === "open") qs.set("layout", "list");
  const s = qs.toString();
  return `/operations/growth/pipeline${s ? `?${s}` : ""}`;
}

/** The database's ZW004 reason when a contact change is refused because Requests are linked (NP-P2-S3-R2). */
export const LINKED_REQUESTS_REASON = "linked_requests";

/**
 * Plain-words error copy. `reason` is the database exception message; it distinguishes the two ZW004 refusals of a save:
 * a closed opportunity vs a contact change while transportation Requests are linked (NP-P2-S3-R2, option B).
 */
export function opportunityErrorMessage(code: string | undefined, op: "save" | "stage" | "lost" | "reopen", reason?: string): string {
  switch (code) {
    case "ZW003":
      return "This opportunity changed since you opened it. Reload the page to see the latest, then try again.";
    case "ZW004":
      if (op === "save" && reason === LINKED_REQUESTS_REASON) {
        return "This opportunity has linked transportation requests. Correct those request links before changing its contact.";
      }
      return op === "reopen"
        ? "Only a lost opportunity can be reopened."
        : "This opportunity is closed. Reopen it first if the conversation started again.";
    case "ZW006":
      return op === "save"
        ? "Check the details: the contact must be an active contact, and the owner must have Nemryn Plus write access."
        : op === "lost"
          ? "Choose a reason (a note is required for Other)."
          : op === "reopen"
            ? "Choose an open stage and say why you're reopening it."
            : "Choose one of the open stages. Lost has its own action; Converted is set by “Create transportation request”.";
    case "ZW001":
      return "You can view the pipeline but not change it. Ask an Organization Admin for write access.";
    case "ZW002":
      return "That opportunity or contact isn't available. It may not exist, or you may no longer have access.";
    default:
      return "That change couldn't be saved. Try again.";
  }
}
