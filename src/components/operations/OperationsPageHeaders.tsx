import type { ReactNode } from "react";
import { Clock, Plus } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { PageHeader } from "@/components/ui/PageHeader";
import type { BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { LinkButton } from "@/components/ui/LinkButton";
import { ExportDaySheetMenu } from "@/components/operations/header/ExportDaySheetMenu";
import { formatOperationsLongDate } from "@/lib/operations/presentation";

/**
 * NP-UI-P1b page headers for the four routes whose title (and, for Overview / Dispatch, actions) used to live in the
 * persistent header (P1-E3-S4 / ZD-129, P1-E3-S6, NP-UI-P1a A2). They are rendered by the PAGES, not the layout: an
 * in-shell error boundary (operations/error.tsx) replaces the page segment, so a failing page shows only the error
 * panel's own h1 — never the page's h1 as well (the duplicate-h1 error state found in the P1b review).
 * Same h1 text, same actions, same data-testids as before.
 */

function NewTripAction() {
  return (
    <LinkButton href="/operations/trips/new" size="md" leadingIcon={<Plus className="size-4" aria-hidden />}>
      New Trip
    </LinkButton>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="mb-zw-xl">{children}</div>;
}

/** Operating hours (P1-PILOT-S4B-R4C, informational, best-effort) sit as a quiet second line under the date. */
export function OverviewPageHeader({ timezone, operatingHours }: { timezone: string; operatingHours?: string | null }) {
  return (
    <Frame>
      <PageHeader
        testId="page-header"
        title="Today's Operations"
        description={
          <>
            {/* Concept B `.head p`: the real date at 16px, muted. */}
            <span className="text-base text-text-muted">{formatOperationsLongDate(new Date(), timezone)}</span>
            {operatingHours && (
              <span className={cn(typography.metadata, "mt-1 flex items-center gap-1.5 text-text-secondary")} data-testid="operating-hours">
                <Clock className="size-3.5 text-text-muted" aria-hidden />
                <span className="font-medium text-text-primary">Operating hours</span> · {operatingHours}
              </span>
            )}
          </>
        }
        actions={
          <>
            <ExportDaySheetMenu day="today" />
            <NewTripAction />
          </>
        }
      />
    </Frame>
  );
}

/** P1-OPS-PROG4: the board has a real Today / Tomorrow switch in the page; the description follows the selected day. */
export function DispatchPageHeader({ day, timezone }: { day: "today" | "tomorrow"; timezone: string }) {
  return (
    <Frame>
      <PageHeader
        testId="page-header"
        title="Dispatch"
        description={day === "tomorrow" ? "Tomorrow" : formatOperationsLongDate(new Date(), timezone)}
        actions={
          <>
            <ExportDaySheetMenu day={day} />
            <NewTripAction />
          </>
        }
      />
    </Frame>
  );
}

/**
 * The h1 names the screen; the page's own record heading (passenger name / "Request") stays the h2 below it, in the
 * RecordSummary. NP-UI-V2-2: the h1 takes the same display role as every other Operations screen (Brand Lock v2 §2)
 * with the breadcrumb above it and the record's own actions on the right -- the same anatomy as the list pages and the
 * Overview, instead of a quiet label stacked over a second title.
 */
export function DetailPageHeader({
  title,
  breadcrumb,
  actions,
}: {
  title: "Trip Detail" | "Request Detail" | "Standing Order";
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-zw-lg">
      <PageHeader testId="page-header" title={title} breadcrumb={breadcrumb} actions={actions} />
    </div>
  );
}
