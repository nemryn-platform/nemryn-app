import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { FormConfig } from "./website-requests-core";

export interface StoredWebsiteRequestForm extends FormConfig {
  /** Content version; drives the S4C formVersion "nemryn-form-v<version>". */
  version: number;
  updatedAt: string;
}

/**
 * The organization's Nemryn form configuration (Organization Admin only, enforced by the database). `null` = never
 * configured. `organizationId` is ALWAYS the server-resolved workspace. The raw table has no client privilege.
 */
export async function getWebsiteRequestForm(organizationId: string): Promise<StoredWebsiteRequestForm | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_website_request_form", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load the website request form");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    status: row.status === "ready" ? "ready" : "draft",
    title: row.title,
    introText: row.intro_text,
    submitLabel: row.submit_label,
    confirmationMessage: row.confirmation_message,
    offeredServiceTypes: row.offered_service_types,
    allowRecurring: row.allow_recurring,
    requireServiceChoice: row.require_service_choice,
    version: row.version,
    updatedAt: row.updated_at,
  };
}
