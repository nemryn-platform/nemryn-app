"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";

/** Screen-only toolbar for the printable Day Sheet (hidden on paper). */
export function DaySheetPrintToolbar({ day, csvHref }: { day: "today" | "tomorrow"; csvHref: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden" data-testid="day-sheet-toolbar">
      <Link href={day === "tomorrow" ? "/operations/dispatch?day=tomorrow" : "/operations/dispatch"} className="text-sm text-text-link hover:underline">
        ← Back to Dispatch
      </Link>
      <div className="flex gap-2">
        <LinkButton href={csvHref} variant="outline" size="sm" download>
          Download CSV
        </LinkButton>
        <Button type="button" size="sm" onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </div>
    </div>
  );
}
