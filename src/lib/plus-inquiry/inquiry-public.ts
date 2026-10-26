import "server-only";
import { cache } from "react";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import { hashClientIp } from "@/lib/public-intake/rate-limit-core";
import {
  inquirySubmissionsEnabled,
  isInquiryKey,
  type InquirySubmission,
  type InquirySubmitStatus,
  type PublicInquiryFormConfig,
} from "./inquiry-core";

/**
 * Server-side boundary of the PUBLIC Nemryn Plus inquiry form (NP-P2-S7-B). Thin by design: every tenant, publication,
 * allowlist, entitlement, suspension, service, idempotency and validation rule lives in the three service_role RPCs
 * (`get_public_plus_inquiry_form`, `check_and_record_plus_inquiry_rate_limit`, `submit_plus_inquiry`). Nothing here selects
 * a tenant except by passing the opaque public key. Uses the one narrow service-role client; no table access; no ids returned.
 *
 * Activation (ZD-259 / ZD-262): BOTH the global kill switch PLUS_INQUIRY_SUBMISSIONS (server env, default OFF) and the
 * per-organization allowlist (database) must allow. The kill switch is checked here FIRST, before any database call.
 * Logging: fixed messages only -- never the key, IP, client hash or any submitted content.
 */
export function publicInquiriesEnabled(): boolean {
  return inquirySubmissionsEnabled(process.env.PLUS_INQUIRY_SUBMISSIONS);
}

/** The public configuration, or null when switched off or for ANY unavailable key (indistinguishable). */
export const getPublicInquiryForm = cache(async (publicKey: string): Promise<PublicInquiryFormConfig | null> => {
  if (!publicInquiriesEnabled() || !isInquiryKey(publicKey)) return null;
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_plus_inquiry_form", { p_public_key: publicKey });
  if (error) {
    console.error("[plus-inquiry] get_public_plus_inquiry_form failed");
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    organizationName: row.organization_name,
    headline: row.headline,
    introText: row.intro_text ?? null,
    services: row.service_types ?? [],
    configVersion: row.config_version,
    consentTextVersion: row.consent_text_version,
  };
});

/** Durable, atomic per-form + per-client limit (5 / client / h, 60 / form / h in the database). Fails CLOSED. */
export async function checkInquiryRateLimit(publicKey: string, clientIp: string): Promise<"allowed" | "limited" | "error"> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("check_and_record_plus_inquiry_rate_limit", {
    p_form_public_key: publicKey,
    p_client_key: hashClientIp(clientIp),
  });
  if (error || !data) {
    console.error("[plus-inquiry] check_and_record_plus_inquiry_rate_limit failed");
    return "error";
  }
  return data.allowed ? "allowed" : "limited";
}

/** Creates exactly ONE inquiry (nothing else) or reports why not, without detail. */
export async function submitPublicInquiry(publicKey: string, s: InquirySubmission): Promise<InquirySubmitStatus> {
  const supabase = createServiceRoleSupabaseClient();
  // The RPC parameters have no defaults: optional values are sent as explicit NULLs (the generated types model them as string).
  const nullable = (v: string | null) => v as string;
  const { data, error } = await supabase.rpc("submit_plus_inquiry", {
    p_public_key: publicKey,
    p_idempotency_key: s.idempotencyKey,
    p_form_config_version: s.configVersion,
    p_name: s.name,
    p_phone: nullable(s.phone),
    p_email: nullable(s.email),
    p_preferred_reply: s.preferredReply,
    p_relationship: nullable(s.relationship),
    p_inquiry_type: s.inquiryType,
    p_service_type: nullable(s.serviceType),
    p_timeframe: nullable(s.timeframe),
    p_question: s.question,
    p_consent_followup: s.consentFollowup,
    p_consent_marketing: s.consentMarketing,
    p_acquisition: s.acquisition ?? (null as unknown as Record<string, string>),
  });
  if (error || !data) {
    console.error("[plus-inquiry] submit_plus_inquiry failed");
    return "error";
  }
  switch (data.status) {
    case "accepted": return "accepted";
    case "unavailable": return "unavailable";
    case "form_changed": return "form_changed";
    case "invalid": return "invalid";
    default:
      console.error("[plus-inquiry] submit_plus_inquiry returned an unknown status");
      return "error";
  }
}
