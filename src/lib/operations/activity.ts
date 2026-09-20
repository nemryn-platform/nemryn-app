import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ACTIVITY_PAGE_SIZE, actorLabel, decodeCursor, describeActivity, encodeCursor, type ActivityItem } from "./activity-core";
import { formatSchedule } from "./operating-schedule-core";
import { serviceLabel } from "./organization-services-core";

export interface ActivityPage {
  items: ActivityItem[];
  /** Cursor for the next (older) page, or null when this is the last page. */
  nextCursor: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * One newest-first page of the caller's organization's administrative activity
 * (Organization Admin only, enforced by list_activity_events). Raw before/after
 * data is used only here, on the server, to build a title and a safe summary;
 * the returned items contain neither it nor any identifier. `organizationId` is
 * always the server-resolved workspace.
 */
export async function getActivityPage(organizationId: string, cursor: string | null | undefined): Promise<ActivityPage> {
  const decoded = decodeCursor(cursor);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_activity_events", {
    p_organization_id: organizationId,
    p_limit: ACTIVITY_PAGE_SIZE + 1,
    ...(decoded ? { p_before_at: decoded.occurredAt, p_before_id: decoded.id } : {}),
  });
  if (error) throw new Error("Failed to load activity");

  const rows = data ?? [];
  const pageRows = rows.slice(0, ACTIVITY_PAGE_SIZE);
  const hasMore = rows.length > ACTIVITY_PAGE_SIZE;
  const last = pageRows[pageRows.length - 1];

  const items: ActivityItem[] = [];
  for (const row of pageRows) {
    const description = describeActivity(
      { action: row.action, actorName: row.actor_name, before: asObject(row.before_data), after: asObject(row.after_data) },
      { formatSchedule: (days, opens, closes) => formatSchedule({ days, opensAt: opens, closesAt: closes }), serviceLabel },
    );
    if (!description) continue; // unmapped -> omitted, never shown as a raw code
    items.push({ key: row.id, occurredAt: row.occurred_at, title: description.title, summary: description.summary, actor: actorLabel(row.actor_name) });
  }

  return { items, nextCursor: hasMore && last ? encodeCursor(last.occurred_at, last.id) : null };
}
