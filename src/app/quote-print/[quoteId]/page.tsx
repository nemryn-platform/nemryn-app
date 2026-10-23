import { notFound } from "next/navigation";
import { requirePlusAccess } from "@/lib/plus/access";
import { getOrganizationSettings } from "@/lib/operations/organization-settings";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { isUuid, serviceTypeLabel } from "@/lib/plus/opportunities-core";
import { getQuote } from "@/lib/plus/quotes";
import { quotePrintModel } from "@/lib/plus/quotes-core";
import { QuotePrintToolbar } from "@/components/growth/QuotePrintToolbar";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Estimate or quote", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Printable estimate / quote (NP-P2-S5-S3C, OD-Q10 Option A, ZD-224). Browser Print -> Save as PDF of the STORED record.
 * Lives OUTSIDE /operations (no sidebar / header) but uses the same Growth guard as every Plus page: a signed-in staff
 * member of the current workspace with Plus READ or above (requirePlusAccess). The quote is read through plus_get_quote
 * on the per-request client -- never the service role -- so an unknown, foreign or inaccessible id is the same 404.
 * There is no public link, token, email or share action; nothing is cached or stored. Customer display name only.
 * NP-P2-S5-O1 (ZD-226): when the opportunity (stage from the same plus_get_quote row) is Lost or Converted, a neutral
 * "Opportunity closed" notice is added next to the status banner. Presentational only: nothing is changed.
 */
export default async function QuotePrintPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  const { context } = await requirePlusAccess(`/quote-print/${quoteId}`);
  if (!isUuid(quoteId)) notFound();
  const q = await getQuote(context.organizationId, quoteId);
  if (!q) notFound();

  const tz = context.organizationTimezone;
  const dateOf = (iso: string | null) => (iso ? localDateKeyOf(new Date(iso).getTime(), tz) : null);
  let successor: { kind: string; quoteNumber: number } | null = null;
  if (q.status === "superseded" && q.supersededByQuoteId) {
    try {
      const s = await getQuote(context.organizationId, q.supersededByQuoteId);
      successor = s ? { kind: s.kind, quoteNumber: s.quoteNumber } : null;
    } catch {
      successor = null;
    }
  }
  // the organization's EXISTING business contact fields (members may read them; RLS organizations_select_members)
  let business: { phone: string; email: string; address: string } | null = null;
  try {
    const s = await getOrganizationSettings(context.organizationId);
    business = s ? { phone: s.businessPhone, email: s.businessEmail, address: s.businessAddress } : null;
  } catch {
    business = null;
  }

  const m = quotePrintModel({
    ...q,
    serviceLabel: q.serviceType ? serviceTypeLabel(q.serviceType) : "Not specified",
    createdDate: dateOf(q.createdAt) ?? q.createdAt.slice(0, 10),
    sentDate: q.status === "draft" ? null : dateOf(q.sentAt),
    respondedDate: dateOf(q.respondedAt),
    customerName: q.contactName,
    successor,
    opportunityStage: q.opportunityStage,
  });

  return (
    <main className="mx-auto max-w-[800px] bg-white px-6 py-8 text-black md:my-zw-xl md:rounded-lg md:border md:border-border-subtle md:px-zw-xl md:shadow-panel print:my-0 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none" data-testid="quote-print" data-status={q.status}>
      <QuotePrintToolbar backHref={`/operations/growth/pipeline/${q.opportunityId}#quotes`} />

      {m.banner && (
        <div
          role="note"
          className={cn("mb-6 border-2 px-4 py-3", m.banner.tone === "caution" ? "border-black" : "border-black/50")}
          data-testid="quote-print-banner"
        >
          <p className="text-lg font-bold tracking-wide">{m.banner.heading}</p>
          <p className="text-sm">{m.banner.text}</p>
        </div>
      )}

      {m.closedNotice && (
        <div role="note" className="mb-6 border border-black/50 px-4 py-3" data-testid="quote-print-closed-notice">
          <p className="text-base font-semibold">{m.closedNotice.heading}</p>
          <p className="text-sm">{m.closedNotice.text}</p>
        </div>
      )}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-black/20 pb-4" data-testid="quote-print-header">
        <div className="min-w-0">
          <p className="text-xl font-semibold" data-testid="quote-print-organization">
            {context.organizationName}
          </p>
          {business && (
            <div className="text-sm text-black/70" data-testid="quote-print-business">
              {business.address && <p className="whitespace-pre-line">{business.address}</p>}
              {business.phone && <p>{business.phone}</p>}
              {business.email && <p>{business.email}</p>}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>{m.documentTitle}</p>
          <h1 className="text-2xl font-semibold" data-testid="quote-print-reference">
            {m.reference}
          </h1>
          <p className="text-sm" data-testid="quote-print-status">
            Status: {m.statusLabel}
          </p>
        </div>
      </header>

      <section className="mb-6" aria-label="Customer">
        <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Prepared for</p>
        <p className="text-base font-medium" data-testid="quote-print-customer">
          {m.customerName}
        </p>
      </section>

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm" data-testid="quote-print-details">
        {m.details.map((d) => (
          <div key={d.label} className="contents">
            <dt className="text-black/60">{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
      </dl>

      <table className="mb-6 w-full border-collapse text-sm" data-testid="quote-print-charges">
        <thead>
          <tr>
            <th scope="col" className="border-b-2 border-black/60 py-1 text-left font-semibold">
              Charge
            </th>
            <th scope="col" className="border-b-2 border-black/60 py-1 text-right font-semibold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {m.lines.length === 0 ? (
            <tr className="border-b border-black/15">
              <td className="py-1 text-black/60" colSpan={2}>
                No itemized charges
              </td>
            </tr>
          ) : (
            m.lines.map((l) => (
              <tr key={l.label} className="break-inside-avoid border-b border-black/15" data-testid="quote-print-line">
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-right tabular-nums">{l.amount}</td>
              </tr>
            ))
          )}
          {m.discount && (
            <tr className="border-b border-black/15" data-testid="quote-print-discount">
              <td className="py-1">Discount</td>
              <td className="py-1 text-right tabular-nums">−{m.discount}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="pt-2 text-left text-base font-semibold">
              Total ({m.currency})
            </th>
            <td className="pt-2 text-right text-base font-semibold tabular-nums" data-testid="quote-print-total">
              {m.total}
            </td>
          </tr>
        </tfoot>
      </table>

      {m.termsNote && (
        <section className="mb-6 break-inside-avoid" aria-label="Terms" data-testid="quote-print-terms">
          <p className={cn(typography.metadata, "uppercase tracking-wide text-black/60")}>Terms</p>
          <p className="whitespace-pre-wrap break-words text-sm">{m.termsNote}</p>
        </section>
      )}

      <p className="border-t border-black/20 pt-3 text-sm text-black/70" data-testid="quote-print-footer">
        {m.footer}
      </p>
    </main>
  );
}
