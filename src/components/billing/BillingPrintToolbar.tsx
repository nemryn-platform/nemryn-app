"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Screen-only toolbar for printable invoices and receipts (NP-BILL-P1; hidden on paper). Printing or saving a PDF is the
 * staff member's own browser action: there is no email, share or public link, and Nemryn stores nothing.
 */
export function BillingPrintToolbar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 print:hidden" data-testid="billing-print-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={backHref} className="text-sm text-text-link hover:underline">
          ← {backLabel}
        </Link>
        <Button type="button" size="sm" onClick={() => window.print()} data-testid="billing-print-button">
          Print / Save PDF
        </Button>
      </div>
      <p className="text-sm text-black/60">Use your browser&apos;s print dialog to print or save as PDF. Nemryn doesn&apos;t send invoices or receipts.</p>
    </div>
  );
}
