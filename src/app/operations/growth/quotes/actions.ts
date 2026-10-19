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
  quoteErrorMessage,
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
 * sent to the customer; Mark sent, responses and revisions are not offered here (S3).
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
