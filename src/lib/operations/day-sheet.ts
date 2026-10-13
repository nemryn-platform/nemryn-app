import "server-only";
import type { OrganizationContext } from "@/lib/auth/types";
import { getDispatchBoardData } from "./dispatch-board";
import { buildDaySheetRows, type DaySheetDay, type DaySheetMeta, type DaySheetRow } from "./day-sheet-core";

export interface DaySheet {
  day: DaySheetDay;
  meta: DaySheetMeta;
  rows: DaySheetRow[];
}

/**
 * P1-PILOT-UX1 Day Sheet for the caller's organization and the chosen org-local day. Reuses the Dispatch loader
 * (`getDispatchBoardData`: the same organization day bounds -- Tomorrow composed on today's end, DST-safe -- and the
 * same RLS-scoped, non-terminal working set the Dispatch screen shows). No second scheduling interpretation and no
 * extra query. Callers must have passed `requireOperationsAccess` first.
 */
export async function getDaySheet(organization: OrganizationContext, day: DaySheetDay, now: Date = new Date()): Promise<DaySheet> {
  const timezone = organization.organizationTimezone;
  const board = await getDispatchBoardData(organization.organizationId, timezone, day);
  // Midday of the board's own day, so the label can never slip across a DST boundary edge.
  const start = new Date(board.dayBoundsUtc.startUtc);
  const end = new Date(board.dayBoundsUtc.endUtc);
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone }).format(mid);
  const dateKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(mid);
  const generatedLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);
  return {
    day,
    meta: { organizationName: organization.organizationName, dayLabel, dateKey, timezone, generatedLabel },
    rows: buildDaySheetRows(board.trips, timezone),
  };
}
