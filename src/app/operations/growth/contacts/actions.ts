"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { findPossibleDuplicates } from "@/lib/plus/contacts";
import {
  CONTACT_LIMITS,
  contactErrorMessage,
  isUuid,
  validateActivityInput,
  validateContactForm,
  type ContactFieldErrors,
  type ContactFormValues,
  type PossibleDuplicate,
} from "@/lib/plus/contacts-core";
import { organizationLocalToUtc } from "@/lib/operations/local-time-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const LIST = "/operations/growth/contacts";
const WRONG_ORGANIZATION =
  "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view contacts but not change them. Ask an Organization Admin for write access.";

export interface ContactFormState {
  status: "idle" | "error" | "duplicates";
  message?: string;
  errors?: ContactFieldErrors;
  /** Echoed back so a refused submission never wipes what was typed. */
  values?: ContactFormValues;
  duplicates?: PossibleDuplicate[];
}

export interface ContactActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function readValues(formData: FormData): ContactFormValues {
  return {
    displayName: text(formData, "displayName").slice(0, CONTACT_LIMITS.name + 50),
    phone: text(formData, "phone").slice(0, CONTACT_LIMITS.phone + 20),
    email: text(formData, "email").slice(0, CONTACT_LIMITS.email + 20),
    contactKind: text(formData, "contactKind"),
    jobTitle: text(formData, "jobTitle").slice(0, CONTACT_LIMITS.jobTitle + 20),
    preferredChannel: text(formData, "preferredChannel"),
    doNotContact: formData.get("doNotContact") === "on" || formData.get("doNotContact") === "true",
    ownerHandle: text(formData, "ownerHandle"),
  };
}

/**
 * The Growth guard (signed in, Operations role, database-reported Plus capability), the organization binding (the
 * session workspace; the form must have been rendered for that same workspace), and write capability. The database
 * re-checks all of it inside every RPC.
 */
async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname(LIST);
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

/** New contact. Possible duplicates are shown first; nothing is created until the person confirms. Never merges. */
export async function createContactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const { context } = guard;

  const parsed = validateContactForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: parsed.errors.form, values };
  const input = parsed.value;
  const confirmed = formData.get("confirmDuplicate") === "true";

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_create_contact", {
    p_organization_id: context.organizationId,
    p_display_name: input.displayName,
    p_phone: input.phone as string,
    p_email: input.email as string,
    p_contact_kind: input.contactKind,
    p_job_title: input.jobTitle as string,
    p_preferred_channel: input.preferredChannel,
    p_do_not_contact: input.doNotContact,
    p_owner_membership_id: input.ownerHandle as string,
    p_confirm_possible_duplicate: confirmed,
  });
  if (error || !data) {
    console.error("[plus] create contact failed", error?.code ?? "no_data");
    return { status: "error", message: contactErrorMessage(error?.code, "save"), values };
  }
  if (!data.changed || !data.contact_id) {
    let duplicates: PossibleDuplicate[] = [];
    try {
      duplicates = await findPossibleDuplicates(context.organizationId, {
        displayName: input.displayName,
        phone: input.phone,
        email: input.email,
        excludeContactId: null,
      });
    } catch {
      // The warning still stands (the database counted possible duplicates); the list is a convenience.
    }
    return {
      status: "duplicates",
      message: "This may be someone who is already in your contacts. Check the matches below before creating a new contact.",
      duplicates,
      values,
    };
  }

  revalidatePath(LIST);
  redirect(`${LIST}/${data.contact_id}?saved=created`);
}

/** Edit contact. The version the form was rendered from must still be current (ZW003 otherwise). */
export async function updateContactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const { context } = guard;

  const contactId = text(formData, "contactId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(contactId) || !expected || Number.isNaN(Date.parse(expected))) {
    return { status: "error", message: "Reload the page and try again.", values };
  }
  const parsed = validateContactForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: parsed.errors.form, values };
  const input = parsed.value;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_update_contact", {
    p_organization_id: context.organizationId,
    p_contact_id: contactId,
    p_expected_updated_at: expected,
    p_display_name: input.displayName,
    p_phone: input.phone as string,
    p_email: input.email as string,
    p_contact_kind: input.contactKind,
    p_job_title: input.jobTitle as string,
    p_preferred_channel: input.preferredChannel,
    p_do_not_contact: input.doNotContact,
    p_owner_membership_id: input.ownerHandle as string,
  });
  if (error || !data) {
    console.error("[plus] update contact failed", error?.code ?? "no_data");
    return { status: "error", message: contactErrorMessage(error?.code, "save"), values };
  }

  revalidatePath(LIST);
  revalidatePath(`${LIST}/${contactId}`);
  redirect(`${LIST}/${contactId}?saved=${data.changed ? "updated" : "unchanged"}`);
}

/** Archive contact (kept with its whole timeline; never deleted). */
export async function archiveContactAction(_prev: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const { context } = guard;
  const contactId = text(formData, "contactId");
  const expected = text(formData, "expectedVersion");
  const reason = text(formData, "reason").trim();
  if (!isUuid(contactId) || !expected) return { status: "error", message: "Reload the page and try again." };
  if (reason.length > CONTACT_LIMITS.archiveReason) return { status: "error", message: `Use ${CONTACT_LIMITS.archiveReason} characters or fewer.` };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_archive_contact", {
    p_organization_id: context.organizationId,
    p_contact_id: contactId,
    p_expected_updated_at: expected,
    p_reason: (reason || null) as string,
  });
  if (error || !data) {
    console.error("[plus] archive contact failed", error?.code ?? "no_data");
    return { status: "error", message: contactErrorMessage(error?.code, "archive") };
  }
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${contactId}`);
  return { status: "success", message: data.changed ? "Contact archived. Its history is kept." : "This contact was already archived." };
}

/** Add a note / log a call, email or meeting that staff had themselves. Nemryn sends nothing. */
export async function logContactActivityAction(_prev: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const { context } = guard;
  const contactId = text(formData, "contactId");
  if (!isUuid(contactId)) return { status: "error", message: "Reload the page and try again." };
  const parsed = validateActivityInput(formData.get("activityType"), formData.get("body"));
  if (!parsed.ok) return { status: "error", message: parsed.error };

  // Optional "when" in the organization's own timezone (default: now).
  let occurredAt: string | null = null;
  const date = text(formData, "occurredDate");
  const time = text(formData, "occurredTime");
  if (date || time) {
    const resolved = organizationLocalToUtc({ date, time: time || "12:00" }, context.organizationTimezone);
    if (resolved.status !== "ok") {
      return { status: "error", message: "Enter a valid date and time, or leave both empty for now." };
    }
    occurredAt = resolved.utc.toISOString();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_log_contact_activity", {
    p_organization_id: context.organizationId,
    p_contact_id: contactId,
    p_activity_type: parsed.type,
    p_body: parsed.body,
    p_occurred_at: occurredAt as string,
  });
  if (error || !data) {
    console.error("[plus] log activity failed", error?.code ?? "no_data");
    return { status: "error", message: contactErrorMessage(error?.code, "log") };
  }
  revalidatePath(`${LIST}/${contactId}`);
  return { status: "success", message: data.changed ? "Added to the timeline." : "That entry was already recorded." };
}
