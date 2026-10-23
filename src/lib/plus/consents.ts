import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CONSENT_LIMITS } from "./consents-core";

/**
 * Nemryn Plus communication-preference reads (NP-P2-S6-B). Every call uses the ordinary per-request, cookie-based
 * client -- never the service-role client -- so the database decides from the caller's own membership, named grant and
 * entitlement (plus_can_read inside each RPC). Neither RPC returns the address digest or the idempotency key (ZD-240).
 */
export class ConsentsError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus consents request failed (${code ?? "unknown"})`);
  }
}

/** One channel / purpose cell (always six, in a fixed order). */
export interface ConsentStateRow {
  channel: string;
  purpose: string;
  recordedStatus: string;
  effectiveStatus: string;
  latestConsentId: string | null;
  capturedVia: string | null;
  capturedAt: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
  isCorrection: boolean;
}

export interface ConsentEvent {
  id: string;
  channel: string;
  purpose: string;
  status: string;
  capturedVia: string;
  capturedAt: string;
  recordedAt: string;
  recordedByName: string | null;
  evidenceNote: string | null;
  correctsConsentId: string | null;
}

export async function getContactConsents(organizationId: string, contactId: string): Promise<ConsentStateRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_contact_consents", {
    p_organization_id: organizationId,
    p_contact_id: contactId,
  });
  if (error) throw new ConsentsError(error.code);
  return (data ?? []).map((r) => ({
    channel: r.channel,
    purpose: r.purpose,
    recordedStatus: r.recorded_status,
    effectiveStatus: r.effective_status,
    latestConsentId: r.latest_consent_id,
    capturedVia: r.captured_via,
    capturedAt: r.captured_at,
    recordedAt: r.recorded_at,
    recordedByName: r.recorded_by_name,
    isCorrection: r.is_correction,
  }));
}

/** One page of the consent history, newest first (page is 1-based). */
export async function listContactConsentEvents(
  organizationId: string,
  contactId: string,
  page = 1,
  pageSize: number = CONSENT_LIMITS.historyPageSize,
): Promise<{ rows: ConsentEvent[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_contact_consent_events", {
    p_organization_id: organizationId,
    p_contact_id: contactId,
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  if (error) throw new ConsentsError(error.code);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      channel: r.channel,
      purpose: r.purpose,
      status: r.status,
      capturedVia: r.captured_via,
      capturedAt: r.captured_at,
      recordedAt: r.recorded_at,
      recordedByName: r.recorded_by_name,
      evidenceNote: r.evidence_note,
      correctsConsentId: r.corrects_consent_id,
    })),
    total: data && data.length > 0 ? Number(data[0].total_count) : 0,
  };
}
