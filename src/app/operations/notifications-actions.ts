"use server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getNotificationHistory } from "@/lib/operations/notifications";

export interface RecentNotification {
  createdAt: string;
  event: string;
  status: string;
  recipientCount: number;
  sentCount: number;
}

export type RecentNotificationsResult =
  | { status: "ok"; timezone: string; items: RecentNotification[] }
  | { status: "not_available" }
  | { status: "error" };

/**
 * P1-PILOT-UX1 header bell. Reuses the EXISTING notification history (list_notification_history -- Organization
 * Admin only, counts and status only; no addresses, ids, entity links or provider text). No new event type, no unread
 * state (none exists in the model). A failure is returned as data so the header never fails.
 */
export async function loadRecentNotificationsAction(): Promise<RecentNotificationsResult> {
  const organization = await requireOperationsAccess("/operations");
  if (organization.role !== "organization_admin") return { status: "not_available" };
  try {
    const items = await getNotificationHistory(organization.organizationId);
    return { status: "ok", timezone: organization.organizationTimezone, items };
  } catch {
    return { status: "error" };
  }
}
