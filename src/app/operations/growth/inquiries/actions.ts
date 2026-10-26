"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { isUuid } from "@/lib/plus/contacts-core";
import { DISMISS_NOTE_MAX, DISMISS_REASONS, consentSkipText, inquiryErrorMessage } from "@/lib/plus/inquiries-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const LIST = "/operations/growth/inquiries";
const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view inquiries but not change them. Ask an Organization Admin for write access.";

export interface InquiryActionState {
  status: "idle" | "success" | "error" | "duplicates";
  message?: string;
  /** Conversion only. */
  opportunityId?: string;
  contactId?: string;
  consentNotes?: string[];
  possibleDuplicates?: number;
}

const text = (f: FormData, n: string) => {
  const v = f.get(n);
  return typeof v === "string" ? v : "";
};

/**
 * Growth guard (signed in, Operations role, database-reported Plus capability), the organization binding (the form must
 * have been rendered for the CURRENT session workspace) and write capability. The S7-A RPCs re-check all of it.
 */
async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname(LIST);
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  const inquiryId = text(formData, "inquiryId");
  const version = Number.parseInt(text(formData, "expectedVersion"), 10);
  if (!isUuid(inquiryId) || !Number.isInteger(version) || version < 1) return { error: inquiryErrorMessage("ZW006") } as const;
  return { context, inquiryId, version } as const;
}

/**
 * Staff-controlled conversion (ZD-251 / ZD-252) through plus_convert_inquiry: create a contact (the released duplicate
 * warning applies -- nothing is written until confirmed) or link an existing one; always ONE new private-pay opportunity;
 * web-form consent only for boxes the person TICKED, only for matching addresses, never for Do not contact. Never a Core
 * Request. The browser sends no consent values: the database reads them from the inquiry itself.
 */
export async function convertInquiryAction(_prev: InquiryActionState, formData: FormData): Promise<InquiryActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const mode = text(formData, "mode");
  const contactId = text(formData, "contactId");
  if ((mode !== "create" && mode !== "link") || (mode === "link" && !isUuid(contactId))) {
    return { status: "error", message: mode === "link" ? "Choose the contact to link." : inquiryErrorMessage("ZW006") };
  }
  const title = text(formData, "title").trim().slice(0, 200);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_convert_inquiry", {
    p_organization_id: guard.context.organizationId,
    p_inquiry_id: guard.inquiryId,
    p_expected_version: guard.version,
    p_contact_mode: mode,
    p_contact_id: (mode === "link" ? contactId : null) as string,
    p_confirm_possible_duplicate: formData.get("confirmDuplicate") === "true",
    p_fill_blank_contact_fields: mode === "link" && formData.get("fillBlanks") === "on",
    p_opportunity_title: (title || null) as string,
    p_owner_membership_id: null as unknown as string,
    p_dnc_acknowledged: formData.get("dncAcknowledged") === "on",
  });
  if (error || !data) return { status: "error", message: inquiryErrorMessage(error?.code, error?.message) };
  if (data.outcome === "possible_duplicates") {
    return {
      status: "duplicates",
      possibleDuplicates: data.possible_duplicates ?? 0,
      message: "A contact with the same name, phone or email may already exist. Link the inquiry to that contact, or create a new contact anyway.",
    };
  }
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${guard.inquiryId}`);
  revalidatePath("/operations", "layout");
  const granted = data.consent_granted ?? 0;
  return {
    status: "success",
    opportunityId: data.opportunity_id ?? undefined,
    contactId: data.contact_id ?? undefined,
    consentNotes: [
      granted > 0 ? `${granted} website-form consent ${granted === 1 ? "entry was" : "entries were"} recorded from the boxes the person ticked.` : "No consent was recorded.",
      ...(data.consent_skipped ?? []).map(consentSkipText),
    ],
    message: "Converted. A contact and a private-pay opportunity were created or linked. No booking request was made.",
  };
}

export async function dismissInquiryAction(_prev: InquiryActionState, formData: FormData): Promise<InquiryActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const reason = text(formData, "reason");
  const note = text(formData, "note").trim();
  if (!(DISMISS_REASONS as readonly string[]).includes(reason)) return { status: "error", message: "Choose a reason." };
  if (reason === "other" && note === "") return { status: "error", message: "Add a short note for “Other”." };
  if (note.length > DISMISS_NOTE_MAX) return { status: "error", message: `Use at most ${DISMISS_NOTE_MAX} characters.` };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("plus_dismiss_inquiry", {
    p_organization_id: guard.context.organizationId,
    p_inquiry_id: guard.inquiryId,
    p_expected_version: guard.version,
    p_reason: reason,
    p_note: (note || null) as string,
  });
  if (error) return { status: "error", message: inquiryErrorMessage(error.code, error.message) };
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${guard.inquiryId}`);
  revalidatePath("/operations", "layout");
  return { status: "success", message: "Inquiry dismissed. You can reopen it later." };
}

export async function reopenInquiryAction(_prev: InquiryActionState, formData: FormData): Promise<InquiryActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("plus_reopen_inquiry", {
    p_organization_id: guard.context.organizationId,
    p_inquiry_id: guard.inquiryId,
    p_expected_version: guard.version,
  });
  if (error) return { status: "error", message: inquiryErrorMessage(error.code, error.message) };
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${guard.inquiryId}`);
  revalidatePath("/operations", "layout");
  return { status: "success", message: "Inquiry reopened." };
}
