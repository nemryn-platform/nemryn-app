import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** The organization's public-form publication (P1-COMM-D2). Organization Admin only, enforced by the database. */
export interface FormPublication {
  /** Opaque public addressing key ("form_" + 32 hex). Not a secret; never an internal id. */
  publicKey: string;
  status: "published" | "disabled";
  publishedVersion: number;
  publishedAt: string;
  /** Requests received through the published form (drives Ready to test -> Connected). */
  requestCount: number;
  lastRequestReceivedAt: string | null;
}

/** `null` = never published ("Not published"). `organizationId` is ALWAYS the server-resolved workspace. */
export async function getWebsiteRequestFormPublication(organizationId: string): Promise<FormPublication | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_website_request_form_publication", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load the form publication");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.public_key) return null;
  return {
    publicKey: row.public_key ?? "",
    status: row.publication_status === "published" ? "published" : "disabled",
    publishedVersion: row.published_version ?? 1,
    publishedAt: row.published_at ?? "",
    requestCount: Number(row.request_count ?? 0),
    lastRequestReceivedAt: row.last_request_received_at ?? null,
  };
}
