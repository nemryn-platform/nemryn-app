"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { isUuid } from "@/lib/plus/attribution-core";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { getQuote } from "@/lib/plus/quotes";
import {
  isQuoteKey,
  parseAcknowledgment,
  quoteErrorMessage,
  validateSentWithdrawReason,
  validateQuoteForm,
  type QuoteFieldErrors,
  type QuoteFormValues,
  type QuoteInput,
} from "@/lib/plus/quotes-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Estimate / quote DRAFT actions (NP-P2-S5-S2): create, edit, withdraw. Each re-checks Growth access
 * (requirePlusAccess), the organization binding of the form and the write capability, validates every field again on
 * the server, and then calls the S1 RPC -- which re-checks Plus write, tenancy, the opportunity, OD-Q12's one-draft rule
 * (ZD-221), the version and the snapshot, and computes the stored total. The client total is never sent. Nothing is
 * sent to the customer.
 * NP-P2-S5-S3B adds the lifecycle actions below: Mark sent (with the server-enforced do-not-contact acknowledgment,
 * OD-Q16 / ZD-223), record the customer's reported response, revise a sent quote, withdraw a sent quote. Every one is
 * a staff statement; the database writes the timeline event (OD-Q15 / ZD-222) in the same transaction.
 */

const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view quotes but can't change them. Ask an Organization Admin for write access.";
const RELOAD = "Reload the page and try again.";

export interface QuoteFormState {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: QuoteFieldErrors;
  values?: QuoteFormValues;
  /** ZW003: someone else changed the draft; offer a reload instead of overwriting */
  stale?: boolean;
  /** server-confirmed result */
  quoteId?: string;
  quoteNumber?: number;
  totalCents?: number;
  replayed?: boolean;
}

export interface QuoteWithdrawState {
  status: "idle" | "success" | "error";
  message?: string;
  stale?: boolean;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
function readValues(formData: FormData): QuoteFormValues {
  const t = (name: string, max = 600) => text(formData, name).slice(0, max);
  return {
    kind: t("kind", 20),
    serviceType: t("serviceType", 60),
    roundTrip: t("roundTrip", 5),
    distanceMiles: t("distanceMiles", 20),
    base: t("base", 30),
    mileage: t("mileage", 30),
    wait: t("wait", 30),
    extraStops: t("extraStops", 30),
    mobilityAssistance: t("mobilityAssistance", 30),
    escort: t("escort", 30),
    returnLeg: t("returnLeg", 30),
    other: t("other", 30),
    otherLabel: t("otherLabel", 200),
    discount: t("discount", 30),
    validUntil: t("validUntil", 20),
    termsNote: t("termsNote", 2000),
  };
}

async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname("/operations/growth/pipeline");
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

function refresh() {
  revalidatePath("/operations/growth", "layout");
}

/** The snapshot arguments shared by plus_create_quote and plus_update_quote_draft (integer cents; never a total). */
function snapshotArgs(v: QuoteInput) {
  return {
    p_kind: v.kind,
    p_service_type: v.serviceType as string,
    p_round_trip: v.roundTrip,
    p_distance_miles: v.distanceMiles as number,
    p_base_cents: v.charges.base,
    p_mileage_cents: v.charges.mileage,
    p_wait_cents: v.charges.wait,
    p_extra_stops_cents: v.charges.extraStops,
    p_mobility_assistance_cents: v.charges.mobilityAssistance,
    p_escort_cents: v.charges.escort,
    p_return_leg_cents: v.charges.returnLeg,
    p_other_cents: v.charges.other,
    p_other_label: v.otherLabel as string,
    p_discount_cents: v.discountCents,
    p_terms_note: v.termsNote as string,
    p_valid_until: v.validUntil,
  };
}

/** ONE draft estimate / quote for an open opportunity. The idempotency key makes a retry return the same draft. */
export async function createQuoteDraftAction(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const opportunityId = text(formData, "opportunityId");
  const key = text(formData, "idempotencyKey");
  if (!isUuid(opportunityId) || !isQuoteKey(key)) return { status: "error", message: RELOAD, values };
  const today = localDateKeyOf(Date.now(), guard.context.organizationTimezone);
  const parsed = validateQuoteForm(values, today);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Check the highlighted fields.", values };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_create_quote", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: opportunityId,
    p_idempotency_key: key,
    ...snapshotArgs(parsed.value),
  });
  if (error || !data) {
    console.error("[plus] quote draft create failed", error?.code ?? "no_data");
    return { status: "error", message: quoteErrorMessage(error?.code, error?.message), values };
  }
  refresh();
  return {
    status: "success",
    message: data.changed === false ? "This draft had already been saved; nothing new was added." : "Draft saved.",
    quoteId: data.quote_id ?? undefined,
    quoteNumber: data.quote_number ?? undefined,
    totalCents: data.total_cents === null ? undefined : Number(data.total_cents),
    replayed: data.changed === false,
  };
}

/** Replaces a DRAFT's snapshot (optimistic concurrency: the version the person opened). */
export async function updateQuoteDraftAction(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const quoteId = text(formData, "quoteId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(quoteId) || !expected || Number.isNaN(Date.parse(expected))) return { status: "error", message: RELOAD, values };
  const today = localDateKeyOf(Date.now(), guard.context.organizationTimezone);
  const parsed = validateQuoteForm(values, today);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Check the highlighted fields.", values };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_update_quote_draft", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_expected_updated_at: expected,
    ...snapshotArgs(parsed.value),
  });
  if (error || !data) {
    console.error("[plus] quote draft update failed", error?.code ?? "no_data");
    return { status: "error", message: quoteErrorMessage(error?.code, error?.message), values, stale: error?.code === "ZW003" };
  }
  refresh();
  return {
    status: "success",
    message: data.changed === false ? "No changes to save." : "Draft saved.",
    quoteId: data.quote_id ?? undefined,
    quoteNumber: data.quote_number ?? undefined,
    totalCents: data.total_cents === null ? undefined : Number(data.total_cents),
  };
}

/**
 * Withdraws a DRAFT (kept as history; never deleted). S2 offers this for drafts only: the action refuses anything that
 * is not currently a draft, and the RPC's version check refuses a draft that changed (e.g. was sent) meanwhile.
 */
export async function withdrawQuoteDraftAction(_prev: QuoteWithdrawState, formData: FormData): Promise<QuoteWithdrawState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const quoteId = text(formData, "quoteId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(quoteId) || !expected || Number.isNaN(Date.parse(expected))) return { status: "error", message: RELOAD };
  let current;
  try {
    current = await getQuote(guard.context.organizationId, quoteId);
  } catch {
    return { status: "error", message: quoteErrorMessage(undefined) };
  }
  if (!current) return { status: "error", message: quoteErrorMessage("ZW002") };
  if (current.status !== "draft") return { status: "error", message: quoteErrorMessage("ZW004", "quote_not_draft"), stale: true };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_withdraw_quote", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_expected_updated_at: expected,
    p_reason: null as unknown as string,
  });
  if (error || !data) {
    console.error("[plus] quote draft withdraw failed", error?.code ?? "no_data");
    return { status: "error", message: quoteErrorMessage(error?.code, error?.message), stale: error?.code === "ZW003" };
  }
  refresh();
  return { status: "success", message: data.changed === false ? "This draft was already withdrawn." : "Draft withdrawn. It stays in the quote history." };
}

// ---------------------------------------------------------------------------------------------------------------------
// NP-P2-S5-S3B lifecycle actions
// ---------------------------------------------------------------------------------------------------------------------

export interface QuoteLifecycleState {
  status: "idle" | "success" | "error";
  message?: string;
  /** ZW003 / no longer in the expected state: offer a reload instead of retrying blindly */
  stale?: boolean;
  /** OD-Q16: the database refused because the contact is do-not-contact and no acknowledgment was given */
  dncRequired?: boolean;
  /** field error (withdraw reason) */
  reasonError?: string;
  quoteId?: string;
  replayed?: boolean;
}

function lifecycleError(error: { code?: string; message?: string } | null, label: string): QuoteLifecycleState {
  console.error(`[plus] quote ${label} failed`, error?.code ?? "no_data");
  const stale = error?.code === "ZW003" || (error?.code === "ZW004" && ["illegal_transition", "quote_not_draft", "revision_base_not_current"].includes(error?.message ?? ""));
  return {
    status: "error",
    message: quoteErrorMessage(error?.code, error?.message),
    stale,
    dncRequired: error?.code === "ZW004" && error?.message === "dnc_acknowledgment_required",
  };
}

/** Draft -> sent: STAFF report they shared it outside Nemryn. The acknowledgment is only ever what the person ticked. */
export async function markQuoteSentAction(_prev: QuoteLifecycleState, formData: FormData): Promise<QuoteLifecycleState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const quoteId = text(formData, "quoteId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(quoteId) || !expected || Number.isNaN(Date.parse(expected))) return { status: "error", message: RELOAD };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_mark_quote_sent", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_expected_updated_at: expected,
    p_dnc_acknowledged: parseAcknowledgment(formData.get("dncAcknowledged")),
  });
  if (error || !data) return lifecycleError(error, "mark sent");
  refresh();
  return {
    status: "success",
    quoteId: data.quote_id ?? undefined,
    replayed: data.changed === false,
    message: data.changed === false ? "This quote was already marked sent." : "Marked sent. The prices are now final; a change needs a revision.",
  };
}

/** Sent -> accepted | declined, as reported by the customer to staff (never a verified acceptance). */
export async function recordQuoteResponseAction(_prev: QuoteLifecycleState, formData: FormData): Promise<QuoteLifecycleState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const quoteId = text(formData, "quoteId");
  const expected = text(formData, "expectedVersion");
  const response = text(formData, "response");
  if (!isUuid(quoteId) || !expected || Number.isNaN(Date.parse(expected)) || (response !== "accepted" && response !== "declined")) {
    return { status: "error", message: RELOAD };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_record_quote_response", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_expected_updated_at: expected,
    p_response: response,
  });
  if (error || !data) return lifecycleError(error, "response");
  refresh();
  const what = response === "accepted" ? "acceptance" : "decline";
  return {
    status: "success",
    quoteId: data.quote_id ?? undefined,
    replayed: data.changed === false,
    message: data.changed === false ? `The customer's ${what} was already recorded.` : `The customer's ${what} is recorded.`,
  };
}

/** Sent -> a NEW revision draft (the original stays sent until the revision is marked sent). One key per intended revision. */
export async function reviseQuoteAction(_prev: QuoteLifecycleState, formData: FormData): Promise<QuoteLifecycleState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const quoteId = text(formData, "quoteId");
  const key = text(formData, "idempotencyKey");
  if (!isUuid(quoteId) || !isQuoteKey(key)) return { status: "error", message: RELOAD };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_revise_quote", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_idempotency_key: key,
  });
  if (error || !data) return lifecycleError(error, "revise");
  refresh();
  return {
    status: "success",
    quoteId: data.quote_id ?? undefined,
    replayed: data.changed === false,
    message: data.changed === false ? "This revision had already been created. Edit it below." : "Revision draft created. Edit it, then mark it sent to replace the current quote.",
  };
}

/** Sent -> withdrawn, with a required reason (kept on the quote and its audit row, never on the timeline). */
export async function withdrawSentQuoteAction(_prev: QuoteLifecycleState, formData: FormData): Promise<QuoteLifecycleState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const quoteId = text(formData, "quoteId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(quoteId) || !expected || Number.isNaN(Date.parse(expected))) return { status: "error", message: RELOAD };
  const reason = validateSentWithdrawReason(text(formData, "reason").slice(0, 1000));
  if (!reason.ok) return { status: "error", reasonError: reason.error, message: "Check the reason." };
  let current;
  try {
    current = await getQuote(guard.context.organizationId, quoteId);
  } catch {
    return { status: "error", message: quoteErrorMessage(undefined) };
  }
  if (!current) return { status: "error", message: quoteErrorMessage("ZW002") };
  if (current.status !== "sent" && current.status !== "withdrawn") return { status: "error", message: quoteErrorMessage("ZW004", "illegal_transition"), stale: true };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_withdraw_quote", {
    p_organization_id: guard.context.organizationId,
    p_quote_id: quoteId,
    p_expected_updated_at: expected,
    p_reason: reason.value,
  });
  if (error || !data) return lifecycleError(error, "withdraw sent");
  refresh();
  return {
    status: "success",
    quoteId: data.quote_id ?? undefined,
    replayed: data.changed === false,
    message: data.changed === false ? "This quote was already withdrawn." : "Sent quote withdrawn. It stays in the quote history.",
  };
}
