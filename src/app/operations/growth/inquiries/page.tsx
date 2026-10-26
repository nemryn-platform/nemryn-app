import Link from "next/link";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { isPlusReadOnly } from "@/lib/plus/access-core";
import { formatContactTime } from "@/lib/plus/contacts-core";
import { listInquiries, type InquiryListRow } from "@/lib/plus/inquiries";
import {
  INQUIRIES_PAGE_SIZE,
  dismissReasonLabel,
  inquiryListHref,
  inquiryStatusLabel,
  inquiryStatusTone,
  inquiryTypeText,
  parseInquiryListParams,
} from "@/lib/plus/inquiries-core";
import { serviceTypeLabel } from "@/lib/plus/opportunities-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { InquiriesTable, type InquiriesTableRow } from "@/components/growth/InquiriesTable";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Inquiries" };

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "converted", label: "Converted" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

function toRow(r: InquiryListRow, timezone: string): InquiriesTableRow {
  return {
    id: r.id,
    name: r.name,
    reach: [r.phone, r.email].filter(Boolean).join(" · ") || "—",
    received: formatContactTime(r.receivedAt, timezone),
    topic: inquiryTypeText(r.inquiryType),
    service: r.serviceType ? serviceTypeLabel(r.serviceType) : "Not specified",
    statusLabel: inquiryStatusLabel(r.status),
    statusTone: inquiryStatusTone(r.status),
    statusNote: r.status === "dismissed" ? dismissReasonLabel(r.dismissReason) : null,
  };
}

/**
 * Growth -> Inquiries (NP-P2-S7-C). Website inquiries received through the organization's public inquiry form (S7-B),
 * listed through plus_list_inquiries (Plus READ, re-checked in the database; one bounded page + the filtered total).
 * Nothing is converted or dismissed from the list: each row opens the inquiry, where staff decide. No Request is ever
 * created from an inquiry.
 */
export default async function InquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/growth/inquiries");
  const { context, plus } = await requirePlusAccess(pathname);
  const params = parseInquiryListParams(await searchParams);
  const tz = context.organizationTimezone;

  let list: { rows: InquiryListRow[]; total: number } | null = null;
  try {
    list = await listInquiries(context.organizationId, params);
  } catch {
    list = null;
  }
  const filtered = Boolean(params.search) || params.status !== "new";
  const pages = list ? Math.max(1, Math.ceil(list.total / INQUIRIES_PAGE_SIZE)) : 1;
  const pastEnd = list !== null && list.rows.length === 0 && params.page > 1;
  // NP-P2-S7-D: the default (New) and All views without a search share the "nothing yet" copy; it never says the public
  // form is live -- that depends on Nemryn's activation, explained in Settings.
  const unfilteredEmpty = !params.search && (params.status === "new" || params.status === "all");

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Inquiries"
        description="Questions people sent through your website inquiry form. Convert one into a contact and an opportunity, or dismiss it."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Inquiries" }]}
      />
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your inquiries are kept and can be viewed. They can't be converted or dismissed until Plus is active again." />
      )}

      <form method="get" action="/operations/growth/inquiries" role="search" className="@container rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm" data-testid="inquiries-filters">
        <div className="flex flex-wrap items-end gap-zw-md">
          <div className="min-w-0 basis-full @4xl:min-w-60 @4xl:flex-1 @4xl:basis-60">
            <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Name, phone or email" maxLength={200} data-testid="inquiries-search" />
          </div>
          <div className="min-w-40 flex-1 @4xl:w-56 @4xl:flex-none">
            <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue={params.status} data-testid="inquiries-status" />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="submit" variant="outline" data-testid="inquiries-apply">
              Apply
            </Button>
            {filtered && (
              <LinkButton href="/operations/growth/inquiries" variant="text">
                Clear
              </LinkButton>
            )}
          </div>
        </div>
      </form>

      {list === null ? (
        <div data-testid="inquiries-error">
          <AttentionState
            level="critical"
            title="Inquiries couldn't be loaded"
            description="Your filters are kept. Try again in a moment."
            action={
              <LinkButton href={inquiryListHref(params)} variant="outline" size="sm">
                Retry
              </LinkButton>
            }
          />
        </div>
      ) : pastEnd ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="inquiries-past-end">
          There are no more results on this page.{" "}
          <Link className="text-text-link hover:underline" href={inquiryListHref(params, { page: 1 })}>
            Go to the first page
          </Link>
        </p>
      ) : list.rows.length === 0 ? (
        <Panel surface="raised" padding="none" data-testid="inquiries-empty">
          <EmptyState
            icon={<ChatCircleText className="size-6" aria-hidden />}
            title={unfilteredEmpty ? "No inquiries yet" : params.search ? "No inquiries match this search." : "No inquiries here."}
            description={
              unfilteredEmpty
                ? "Questions submitted through your inquiry form will appear here. Manage your form in Settings → Nemryn Plus."
                : "Change the search or status to see other inquiries."
            }
            action={
              filtered ? (
                <LinkButton href="/operations/growth/inquiries" size="sm" variant="text">
                  Clear filters
                </LinkButton>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <InquiriesTable rows={list.rows.map((r) => toRow(r, tz))} />
          <nav aria-label="Inquiry pages" className="flex flex-wrap items-center justify-between gap-2" data-testid="inquiries-pagination">
            <p className={cn(typography.metadata, "text-text-muted")}>
              {list.total} {list.total === 1 ? "inquiry" : "inquiries"}
              {pages > 1 && ` · page ${Math.min(params.page, pages)} of ${pages}`}
            </p>
            {pages > 1 && (
              <div className="flex gap-3">
                {params.page > 1 && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={inquiryListHref(params, { page: params.page - 1 })} data-testid="inquiries-prev">
                    Previous
                  </Link>
                )}
                {params.page < pages && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={inquiryListHref(params, { page: params.page + 1 })} data-testid="inquiries-next">
                    Next
                  </Link>
                )}
              </div>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
