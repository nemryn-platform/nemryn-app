import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getDaySheet } from "@/lib/operations/day-sheet";
import { daySheetCsv, daySheetFilename, parseDaySheetDay } from "@/lib/operations/day-sheet-core";

export const dynamic = "force-dynamic";

/**
 * P1-PILOT-UX1 Day Sheet CSV download. Same Operations authorization and the same dataset as the printable Day Sheet
 * (the Dispatch working set for the chosen org-local day). Sensitive operational data: never cached, never a public
 * URL, no ids or tokens in the file.
 */
export async function GET(request: Request) {
  const day = parseDaySheetDay(new URL(request.url).searchParams.get("day"));
  const organization = await requireOperationsAccess(`/day-sheet/csv?day=${day}`);
  const sheet = await getDaySheet(organization, day);
  const body = "﻿" + daySheetCsv(sheet.meta, sheet.rows);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${daySheetFilename(sheet.meta.organizationName, sheet.meta.dateKey)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
