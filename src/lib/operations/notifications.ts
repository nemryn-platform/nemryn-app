import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isNotificationEvent, type NotificationEvent } from "./notification-core";

export interface NotificationSetting {
  event: NotificationEvent;
  recipientRoles: string[];
  isDefault: boolean;
}

export interface NotificationHistoryItem {
  createdAt: string;
  event: string;
  status: string;
  recipientCount: number;
  sentCount: number;
}

/** Effective recipient roles per event (Organization Admin only, enforced by the database). */
export async function getNotificationSettings(organizationId: string): Promise<NotificationSetting[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_notification_settings", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load notification settings");
  return (data ?? [])
    .filter((row) => isNotificationEvent(row.event_type))
    .map((row) => ({ event: row.event_type as NotificationEvent, recipientRoles: row.recipient_roles, isDefault: row.is_default }));
}

/** Recent delivery outcomes -- counts and status only; no addresses, ids or provider text. */
export async function getNotificationHistory(organizationId: string): Promise<NotificationHistoryItem[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_notification_history", { p_organization_id: organizationId, p_limit: 10 });
  if (error) throw new Error("Failed to load notification history");
  return (data ?? []).map((row) => ({
    createdAt: row.created_at,
    event: row.event_type,
    status: row.status,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
  }));
}
