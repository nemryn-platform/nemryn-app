import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { INQUIRIES_PAGE_SIZE, type InquiryStatusFilter } from "./inquiries-core";

/**
 * Nemryn Plus staff inquiry reads (NP-P2-S7-C). Every call uses the ordinary per-request, cookie-based client -- never the
 * service-role client -- so the database decides from the caller's own membership, named grant and entitlement
 * (plus_can_read inside each S7-A RPC; ZW002 for no access / foreign rows). The idempotency key is never returned.
 */
export class InquiriesError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus inquiries request failed (${code ?? "unknown"})`);
  }
}

export interface InquiryListRow {
  id: string;
  receivedAt: string;
  name: string;
  phone: string | null;
  email: string | null;
  inquiryType: string;
  serviceType: string | null;
  status: string;
  dismissReason: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

export async function listInquiries(organizationId: string, p: { status: InquiryStatusFilter; search: string; page: number }): Promise<{ rows: InquiryListRow[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_inquiries", {
    p_organization_id: organizationId,
    p_status: p.status,
    p_search: (p.search || null) as string,
    p_limit: INQUIRIES_PAGE_SIZE,
    p_offset: (p.page - 1) * INQUIRIES_PAGE_SIZE,
  });
  if (error) throw new InquiriesError(error.code);
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    receivedAt: r.received_at,
    name: r.name,
    phone: r.phone,
    email: r.email,
    inquiryType: r.inquiry_type,
    serviceType: r.service_type,
    status: r.status,
    dismissReason: r.dismiss_reason,
    contactId: r.contact_id,
    opportunityId: r.opportunity_id,
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export interface InquiryDetail extends InquiryListRow {
  preferredReply: string;
  relationship: string | null;
  timeframe: string | null;
  question: string;
  consentFollowup: boolean;
  consentMarketing: boolean;
  consentTextVersion: string;
  formConfigVersion: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  dismissNote: string | null;
  contactDisplayName: string | null;
  triagedAt: string | null;
  triagedByName: string | null;
  version: number;
}

/** One inquiry, or null when it doesn't exist for this organization (ZW002 -- no existence oracle). */
export async function getInquiry(organizationId: string, inquiryId: string): Promise<InquiryDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_inquiry", { p_organization_id: organizationId, p_inquiry_id: inquiryId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new InquiriesError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id, receivedAt: r.received_at, name: r.name, phone: r.phone, email: r.email, inquiryType: r.inquiry_type,
    serviceType: r.service_type, status: r.status, dismissReason: r.dismiss_reason, contactId: r.contact_id,
    opportunityId: r.opportunity_id, preferredReply: r.preferred_reply, relationship: r.relationship, timeframe: r.timeframe,
    question: r.question, consentFollowup: r.consent_followup, consentMarketing: r.consent_marketing,
    consentTextVersion: r.consent_text_version, formConfigVersion: r.form_config_version, utmSource: r.utm_source,
    utmMedium: r.utm_medium, utmCampaign: r.utm_campaign, landingPath: r.landing_path, referrerHost: r.referrer_host,
    dismissNote: r.dismiss_note, contactDisplayName: r.contact_display_name, triagedAt: r.triaged_at,
    triagedByName: r.triaged_by_name, version: r.version,
  };
}

export interface DuplicateHint {
  kind: "contact" | "inquiry";
  id: string;
  displayName: string;
  status: string;
  matchOn: string;
  receivedAt: string | null;
}

/** Hints only (never merges): up to 5 matching contacts and up to 5 other new inquiries. */
export async function listDuplicateHints(organizationId: string, inquiryId: string): Promise<DuplicateHint[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_inquiry_duplicate_hints", { p_organization_id: organizationId, p_inquiry_id: inquiryId });
  if (error) throw new InquiriesError(error.code);
  return (data ?? []).map((r) => ({
    kind: r.kind === "contact" ? "contact" : "inquiry",
    id: r.record_id,
    displayName: r.display_name,
    status: r.status,
    matchOn: r.match_on,
    receivedAt: r.received_at,
  }));
}

/** The NEW-inquiry count for the navigation badge. Request-cached; any failure -> null (no badge, never an error page). */
export const countNewInquiries = cache(async (organizationId: string): Promise<number | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_count_new_inquiries", { p_organization_id: organizationId });
  if (error || typeof data !== "number") return null;
  return data;
});

export interface InquiryFormSettings {
  formId: string | null;
  status: string | null;
  publicKey: string | null;
  headline: string | null;
  introText: string | null;
  offeredServiceTypes: string[];
  configVersion: number | null;
  version: number | null;
  publishedAt: string | null;
  publicAccessEnabled: boolean;
  serviceOptions: string[];
}

export async function getInquiryFormSettings(organizationId: string): Promise<InquiryFormSettings> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_inquiry_form", { p_organization_id: organizationId });
  if (error) throw new InquiriesError(error.code);
  const r = data?.[0];
  return {
    formId: r?.form_id ?? null,
    status: r?.status ?? null,
    publicKey: r?.public_key ?? null,
    headline: r?.headline ?? null,
    introText: r?.intro_text ?? null,
    offeredServiceTypes: r?.offered_service_types ?? [],
    configVersion: r?.config_version ?? null,
    version: r?.version ?? null,
    publishedAt: r?.published_at ?? null,
    publicAccessEnabled: r?.public_access_enabled ?? false,
    serviceOptions: r?.service_options ?? [],
  };
}
