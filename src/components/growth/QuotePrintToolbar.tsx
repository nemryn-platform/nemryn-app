"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { QUOTE_PRINT_SCREEN_NOTE } from "@/lib/plus/quotes-core";

/**
 * Screen-only toolbar for the printable estimate / quote (NP-P2-S5-S3C, hidden on paper). Printing or saving a PDF is the
 * staff member's own browser action: there is no email, share or link action, and Nemryn stores nothing.
 */
export function QuotePrintToolbar({ backHref }: { backHref: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 print:hidden" data-testid="quote-print-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={backHref} className="text-sm text-text-link hover:underline" data-testid="quote-print-back">
          ← Back to the opportunity
        </Link>
        <Button type="button" size="sm" onClick={() => window.print()} data-testid="quote-print-button">
          Print / Save PDF
        </Button>
      </div>
      <p className="text-sm text-black/60">{QUOTE_PRINT_SCREEN_NOTE}</p>
    </div>
  );
}
