import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DIRECTORY_PAGE_SIZE, type OrganizationStatus } from "./platform-core";

/**
 * Nemryn Platform read models (P1-PILOT-S4B-R4E). Every call goes through a
 * PlatformAdminGrant-gated SECURITY DEFINER function that returns aggregate
 * counts and health metadata only -- never a Request, Trip, Passenger, address,
 * note, recipient or provider response. The caller must already have passed
 * requirePlatformAdminAccess; the database re-checks independently.
 */

export interface PlatformOverview {
  totalOrganizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  integrationsTotal: number;
  integrationsActive: number;
  notificationsFailed: number;
  notificationsPartial: number;
  notificationsStuck: number;
  platformAdminCount: number;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_get_overview");
  const row = data?.[0];
  if (error || !row) throw new Error("Failed to load platform overview");
  return {
    totalOrganizations: row.total_organizations,
    activeOrganizations: row.active_organizations,
    suspendedOrganizations: row.suspended_organizations,
    integrationsTotal: row.integrations_total,
    integrationsActive: row.integrations_active,
    notificationsFailed: row.notifications_failed,
    notificationsPartial: row.notifications_partial,
    notificationsStuck: row.notifications_stuck,
    platformAdminCount: row.platform_admin_count,
  };
}

export interface DirectoryRow {
  organizationId: string;
  name: string;
  status: string;
  createdAt: string;
  timezone: string;
  activeStaffCount: number;
  driverCount: number;
  integrationsTotal: number;
  integrationsActive: number;
  requestCount: number;
  tripCount: number;
  lastActivityAt: string | null;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function getOrganizationDirectory(args: { search: string | null; status: OrganizationStatus | null; page: number }): Promise<DirectoryPage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_list_organizations", {
    ...(args.search ? { p_search: args.search } : {}),
    ...(args.status ? { p_status: args.status } : {}),
    p_limit: DIRECTORY_PAGE_SIZE,
    p_offset: (args.page - 1) * DIRECTORY_PAGE_SIZE,
  });
  if (error) throw new Error("Failed to load organizations");
  const rows = (data ?? []).map((row) => ({
    organizationId: row.organization_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    timezone: row.timezone,
    activeStaffCount: row.active_staff_count,
    driverCount: row.driver_count,
    integrationsTotal: row.integrations_total,
    integrationsActive: row.integrations_active,
    requestCount: row.request_count,
    tripCount: row.trip_count,
    lastActivityAt: row.last_activity_at,
  }));
  const total = data?.[0] ? Number(data[0].total_count) : 0;
  return { rows, total, page: args.page, pageCount: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)) };
}

export interface OrganizationDetail {
  organizationId: string;
  name: string;
  status: string;
  createdAt: string;
  timezone: string;
  businessStage: string | null;
  activeAdminCount: number;
  activeDispatcherCount: number;
  activeDriverMembershipCount: number;
  pendingStaffInviteCount: number;
  driverCount: number;
  vehicleCount: number;
  passengerCount: number;
  requestCount: number;
  tripCount: number;
  lastActivityAt: string | null;
  integrationsTotal: number;
  integrationsActive: number;
  websiteRequestCount: number;
  lastWebsiteRequestAt: string | null;
  notifications: { pending: number; dispatching: number; sent: number; failed: number; partial: number; skipped: number; stuck: number };
  lastFailureReason: string | null;
  lastFailureAt: string | null;
}

export async function getOrganizationDetail(organizationId: string): Promise<OrganizationDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_get_organization", { p_organization_id: organizationId });
  if (error) return null; // unknown organization (ZW002) or malformed id
  const row = data?.[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    timezone: row.timezone,
    businessStage: row.business_stage,
    activeAdminCount: row.active_admin_count,
    activeDispatcherCount: row.active_dispatcher_count,
    activeDriverMembershipCount: row.active_driver_membership_count,
    pendingStaffInviteCount: row.pending_staff_invite_count,
    driverCount: row.driver_count,
    vehicleCount: row.vehicle_count,
    passengerCount: row.passenger_count,
    requestCount: row.request_count,
    tripCount: row.trip_count,
    lastActivityAt: row.last_activity_at,
    integrationsTotal: row.integrations_total,
    integrationsActive: row.integrations_active,
    websiteRequestCount: row.website_request_count,
    lastWebsiteRequestAt: row.last_website_request_at,
    notifications: {
      pending: row.notif_pending,
      dispatching: row.notif_dispatching,
      sent: row.notif_sent,
      failed: row.notif_failed,
      partial: row.notif_partial,
      skipped: row.notif_skipped,
      stuck: row.notif_stuck,
    },
    lastFailureReason: row.last_failure_reason,
    lastFailureAt: row.last_failure_at,
  };
}

export interface IntegrationHealth {
  origin: string | null;
  isActive: boolean;
  createdAt: string;
  requestCount: number;
  lastRequestAt: string | null;
}

export async function getOrganizationIntegrations(organizationId: string): Promise<IntegrationHealth[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_list_organization_integrations", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load integration health");
  return (data ?? []).map((row) => ({
    origin: row.allowed_origins?.[0] ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    requestCount: row.request_count,
    lastRequestAt: row.last_request_at,
  }));
}

export interface AttentionItem {
  key: string;
  organizationId: string;
  organizationName: string;
  eventType: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  isStuck: boolean;
}

export async function getNotificationAttention(limit = 10): Promise<AttentionItem[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_list_notification_attention", { p_limit: limit });
  if (error) throw new Error("Failed to load notification health");
  return (data ?? []).map((row, index) => ({
    key: `${row.organization_id}-${row.created_at}-${index}`,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    eventType: row.event_type,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    isStuck: row.is_stuck,
  }));
}

export interface PlatformActivityItem {
  key: string;
  occurredAt: string;
  action: string;
  organizationId: string;
  organizationName: string;
  actor: string;
  reason: string | null;
}

export interface PlatformActivityPage {
  items: PlatformActivityItem[];
  nextCursor: string | null;
}

const PLATFORM_ACTIVITY_PAGE_SIZE = 30;

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | null | undefined): { occurredAt: string; id: string } | null {
  if (!cursor || cursor.length > 200) return null;
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(text);
    return match ? { occurredAt: match[1], id: match[2] } : null;
  } catch {
    return null;
  }
}

export async function getPlatformActivity(cursor: string | null | undefined): Promise<PlatformActivityPage> {
  const decoded = decodeCursor(cursor);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("platform_list_activity", {
    p_limit: PLATFORM_ACTIVITY_PAGE_SIZE + 1,
    ...(decoded ? { p_before_at: decoded.occurredAt, p_before_id: decoded.id } : {}),
  });
  if (error) throw new Error("Failed to load platform activity");
  const rows = data ?? [];
  const pageRows = rows.slice(0, PLATFORM_ACTIVITY_PAGE_SIZE);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((row) => ({
      key: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      actor: row.actor_name && row.actor_name.trim() ? row.actor_name : "System",
      reason: row.reason,
    })),
    nextCursor: rows.length > PLATFORM_ACTIVITY_PAGE_SIZE && last ? toBase64Url(`${last.occurred_at}|${last.id}`) : null,
  };
}
