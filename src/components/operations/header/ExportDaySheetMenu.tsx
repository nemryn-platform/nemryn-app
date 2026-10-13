"use client";

import { DownloadSimple, Printer } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { useHeaderPopover } from "./useHeaderPopover";

/**
 * P1-PILOT-UX1 Export Day Sheet: exports exactly the day the operator is looking at (Overview = today; Dispatch = the
 * selected Today / Tomorrow). Always active -- a zero-trip day still exports ("No trips scheduled for this day." / CSV
 * headers only).
 */
export function ExportDaySheetMenu({ day }: { day: "today" | "tomorrow" }) {
  const { open, setOpen, containerRef, triggerRef, close } = useHeaderPopover();
  const dayLabel = day === "tomorrow" ? "Tomorrow" : "Today";
  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="outline"
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-day-sheet"
        onClick={() => setOpen((v) => !v)}
        data-testid="export-day-sheet-button"
      >
        Export Day Sheet
      </Button>
      {open && (
        <div
          id="header-day-sheet"
          role="menu"
          aria-label={`Export ${dayLabel}'s Day Sheet`}
          className="absolute right-0 z-30 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-sm border border-border-subtle bg-surface-elevated py-1 shadow-md"
          data-testid="export-day-sheet-menu"
        >
          <p className={cn(typography.metadata, "px-3 py-1.5 text-text-muted")}>{dayLabel}&apos;s Day Sheet</p>
          <a
            href={`/day-sheet?day=${day}`}
            target="_blank"
            rel="noopener"
            role="menuitem"
            onClick={() => close()}
            className={cn(typography.bodySmall, "flex items-center gap-2.5 px-3 py-2 text-text-primary hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none")}
          >
            <Printer className="size-4" aria-hidden />
            Print / Save PDF
          </a>
          <a
            href={`/day-sheet/csv?day=${day}`}
            download
            role="menuitem"
            onClick={() => close()}
            className={cn(typography.bodySmall, "flex items-center gap-2.5 px-3 py-2 text-text-primary hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none")}
          >
            <DownloadSimple className="size-4" aria-hidden />
            Download CSV
          </a>
        </div>
      )}
    </div>
  );
}
