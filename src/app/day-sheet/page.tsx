import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getDaySheet } from "@/lib/operations/day-sheet";
import { DAY_SHEET_COLUMNS, parseDaySheetDay } from "@/lib/operations/day-sheet-core";
import { DaySheetPrintToolbar } from "@/components/operations/day-sheet/DaySheetPrintToolbar";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Day Sheet" };
export const dynamic = "force-dynamic";

/**
 * P1-PILOT-UX1 printable Day Sheet (browser Print -> Save as PDF). Lives OUTSIDE /operations so it renders without the
 * Operations sidebar / header, but uses the same Operations authorization (Organization Admin / Dispatcher of the
 * caller's current organization; Drivers are redirected to /driver). The toolbar is hidden when printing; the table
 * header repeats on every printed page and rows never split across pages.
 */
export default async function DaySheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const day = parseDaySheetDay(params.day);
  const organization = await requireOperationsAccess(`/day-sheet?day=${day}`);
  const sheet = await getDaySheet(organization, day);
  const { meta, rows } = sheet;

  return (
    <main className="mx-auto max-w-[1100px] bg-white px-6 py-6 text-black print:max-w-none print:px-0 print:py-0">
      <DaySheetPrintToolbar day={day} csvHref={`/day-sheet/csv?day=${day}`} />
      <header className="mb-4 border-b border-black/20 pb-3" data-testid="day-sheet-header">
        <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Day Sheet</p>
        <h1 className="text-xl font-semibold">{meta.organizationName}</h1>
        <p className="text-base">{meta.dayLabel}</p>
        <p className={cn(typography.metadata, "text-black/60")}>
          Times in {meta.timezone} · Generated {meta.generatedLabel} · {rows.length} {rows.length === 1 ? "trip" : "trips"}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="text-base" data-testid="day-sheet-empty">
          No trips scheduled for this day.
        </p>
      ) : (
        <table className="w-full border-collapse text-[12px] leading-snug" data-testid="day-sheet-table">
          <thead className="[display:table-header-group]">
            <tr>
              {DAY_SHEET_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="border-b-2 border-black/60 px-1.5 py-1 text-left align-bottom font-semibold">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="break-inside-avoid border-b border-black/15 align-top">
                {DAY_SHEET_COLUMNS.map((c) => (
                  <td key={c.key} className={cn("px-1.5 py-1", c.key === "pickupTime" && "whitespace-nowrap font-medium")}>
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={cn(typography.metadata, "mt-4 text-black/60")}>Contains passenger names and addresses — handle as confidential operational data.</p>
    </main>
  );
}
