import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CONTACTS_PAGE_SIZE, type ContactListParams, type PossibleDuplicate } from "./contacts-core";

/**
 * Nemryn Plus Contacts reads (NP-P1-S4). Every call uses the ordinary per-request, cookie-based client -- never the
 * service-role client -- so the database decides from the caller's own membership, named grant and entitlement
 * (plus_can_read / _require_plus_write inside each RPC). A refusal surfaces as a ContactsError with the ZW code.
 */
export class ContactsError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus contacts request failed (${code ?? "unknown"})`);
  }
}

export interface ContactListRow {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  contactKind: string;
  jobTitle: string | null;
  preferredChannel: string;
  doNotContact: boolean;
  status: string;
  ownerName: string | null;
}

export interface ContactListPage {
  rows: ContactListRow[];
  total: number;
}

export async function listContacts(organizationId: string, params: ContactListParams): Promise<ContactListPage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_contacts", {
    p_organization_id: organizationId,
    p_search: (params.search || null) as string,
    p_contact_kind: params.kind as string,
    p_status: params.status,
    p_limit: CONTACTS_PAGE_SIZE,
    p_offset: (params.page - 1) * CONTACTS_PAGE_SIZE,
  });
  if (error) throw new ContactsError(error.code);
  const rows = (data ?? []).map((r) => ({
    id: r.contact_id,
    displayName: r.display_name,
    phone: r.phone,
    email: r.email,
    contactKind: r.contact_kind,
    jobTitle: r.job_title,
    preferredChannel: r.preferred_channel,
    doNotContact: r.do_not_contact,
    status: r.status,
    ownerName: r.owner_name,
  }));
  return { rows, total: data && data.length > 0 ? Number(data[0].total_count) : 0 };
}

export interface ContactDetail extends ContactListRow {
  ownerHandle: string | null;
  /** false when the owner no longer has Plus write access (kept, flagged). null when there is no owner. */
  ownerCanWrite: boolean | null;
  createdByName: string | null;
  createdAt: string;
  /** Version token for optimistic concurrency. */
  updatedAt: string;
}

/** null when the contact is not available to the caller (foreign, unknown, or no access): never says which. */
export async function getContact(organizationId: string, contactId: string): Promise<ContactDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_contact", { p_organization_id: organizationId, p_contact_id: contactId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new ContactsError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.contact_id,
    displayName: r.display_name,
    phone: r.phone,
    email: r.email,
    contactKind: r.contact_kind,
    jobTitle: r.job_title,
    preferredChannel: r.preferred_channel,
    doNotContact: r.do_not_contact,
    status: r.status,
    ownerName: r.owner_name,
    ownerHandle: r.owner_membership_id,
    ownerCanWrite: r.owner_can_write,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ContactActivity {
  id: string;
  type: string;
  body: string | null;
  actorName: string | null;
  occurredAt: string;
  recordedAt: string;
  /** the opportunity a quote event belongs to (null for contact-only activities) */
  opportunityId: string | null;
  /** NP-P2-S5-S3B (ZD-222): quote lifecycle event reference (null for every other activity); never an amount */
  quoteId: string | null;
  quoteNumber: number | null;
  quoteKind: string | null;
  quoteStatus: string | null;
  relatedQuoteNumber: number | null;
}

export async function listContactActivities(organizationId: string, contactId: string, limit = 100): Promise<{ rows: ContactActivity[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_contact_activities", {
    p_organization_id: organizationId,
    p_contact_id: contactId,
    p_limit: limit,
    p_offset: 0,
  });
  if (error) throw new ContactsError(error.code);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.activity_id,
      type: r.activity_type,
      body: r.body,
      actorName: r.actor_name,
      occurredAt: r.occurred_at,
      recordedAt: r.recorded_at,
      opportunityId: r.opportunity_id,
      quoteId: r.quote_id,
      quoteNumber: r.quote_number,
      quoteKind: r.quote_kind,
      quoteStatus: r.quote_status,
      relatedQuoteNumber: r.related_quote_number,
    })),
    total: data && data.length > 0 ? Number(data[0].total_count) : 0,
  };
}

export interface OwnerOption {
  handle: string;
  name: string;
  isSelf: boolean;
}

/** Eligible owners (Plus writers). Only callable with Plus write access. */
export async function listOwnerOptions(organizationId: string): Promise<OwnerOption[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_contact_owner_options", { p_organization_id: organizationId });
  if (error) throw new ContactsError(error.code);
  return (data ?? []).map((r) => ({ handle: r.membership_id, name: r.display_name, isSelf: r.is_self }));
}

export async function findPossibleDuplicates(
  organizationId: string,
  input: { displayName: string; phone: string | null; email: string | null; excludeContactId: string | null },
): Promise<PossibleDuplicate[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_find_contact_matches", {
    p_organization_id: organizationId,
    p_display_name: input.displayName,
    p_phone: input.phone as string,
    p_email: input.email as string,
    p_exclude_contact_id: input.excludeContactId as string,
  });
  if (error) throw new ContactsError(error.code);
  return (data ?? []).map((r) => ({
    contactId: r.contact_id,
    displayName: r.display_name,
    status: r.status,
    matchOn: (r.match_on ?? "").split(",").filter(Boolean),
  }));
}
