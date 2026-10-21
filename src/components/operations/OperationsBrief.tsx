import Link from "next/link";
import type { ReactNode } from "react";
import {
  WarningCircle,
  ArrowRight,
  CaretRight,
  Tray,
  CalendarCheck,
  Repeat,
  ShieldCheck,
  IdentificationCard,
  Clock,
  Lightning,
  NavigationArrow,
  Path,
  Storefront,
  PlugsConnected,
  SteeringWheel,
  ListChecks,
} from "@phosphor-icons/react/dist/ssr";
import { Panel, PanelHeader, PanelSection, iconToneClasses, type PanelTone } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { deriveTomorrowSummaryLine } from "@/lib/operations/readiness-actions-core";
import { formatOperationsTime, formatOperationsLongDate, formatServiceDateLabel, assuranceStatusCategory } from "@/lib/operations/presentation";
import type { OperationsBriefData } from "@/lib/operations/operations-brief-core";
import { strandedRequestsLine, STRANDED_REQUESTS_HREF } from "@/lib/operations/request-fulfilment-core";
import {
  BRIEF_ROW_LIMIT,
  type BriefCalmLine,
  type BriefComposition,
  type BriefHeadline,
  type BriefTodayDetail,
} from "@/lib/operations/progressive-operations-core";
import type { TodaysOperationsTrip, TodaysOperationsAttentionItem } from "@/lib/operations/todays-operations";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface OperationsBriefProps {
  brief: OperationsBriefData;
  /** P1-OPS-PROG3B: the fact-derived section order/density (composeOperationsBrief). */
  composition: BriefComposition;
  timezone: string;
  /** The next scheduled pickup later today, for the collapsed Today line. */
  nextTodayPickupAt: string | null;
  /** Organization Admin: may use admin-only setup links (the destinations are still server-guarded). */
  isAdmin: boolean;
  /** The caller has an active linked Driver (owner-as-driver). */
  hasLinkedDriver: boolean;
  /** NP-UI-P1b: today's fact tiles (the page's real summary counts), shown under the heading on a standard Brief. */
  summaryTiles?: ReactNode;
}

/**
 * The Operations Brief (P1-E1-S1C) — the operator's briefing layer,
 * rendered above the existing Today's Operations detail.
 *
 * P1-OPS-PROG3B (docs/reports/p1-ops-prog3a-fact-signal-composition-spec.txt):
 * WHAT renders and in WHICH ORDER is decided by `composition`
 * (composeOperationsBrief, a pure function of facts the Overview already
 * loaded) -- never by business_stage, size, membership counts or any
 * threshold. This component only renders that decision:
 *   - fresh organization: Get started (+ Requests only when some are waiting);
 *   - otherwise: the Today headline, then the WORK sections in the fixed
 *     P0..P5 order (Needs Attention, Requests, No active drivers, Today,
 *     Tomorrow, Recurring Care, Proof of Service), then ONE calm group of
 *     single lines for everything with nothing waiting, and an
 *     "… unavailable" line for any summary that failed to load (unknown
 *     is never shown as zero, and never silently dropped).
 * The individual blocks keep their existing data, copy and actions.
 */
export function OperationsBrief({ brief, composition, timezone, nextTodayPickupAt, isAdmin, hasLinkedDriver, summaryTiles }: OperationsBriefProps) {
  const { attention, activeNow, nextDepartures, unassignedCount, requestSummary, tomorrowReadiness, recurringCare, proofOfService } = brief;

  const heading = (
    <div>
      <h2 className={cn(typography.sectionHeading, "text-text-primary")} id="operations-brief-heading">
        Operations Brief
      </h2>
      <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>What needs your attention and what is happening next.</p>
    </div>
  );

  if (composition.kind === "fresh") {
    return (
      <section className="flex flex-col gap-zw-md" data-testid="brief" data-brief-kind="fresh" aria-labelledby="operations-brief-heading">
      {/* NP-UI-P1b: heading 16px above its first card. */}
        {heading}
        {/* NP-UI-P1b (Concept B): Get started and Requests awaiting review side by side when both are present. */}
        <div className={cn("grid grid-cols-1 gap-zw-lg", composition.showRequests && "lg:grid-cols-2")}>
          <GetStartedPanel timezone={timezone} isAdmin={isAdmin} hasLinkedDriver={hasLinkedDriver} />
          {composition.showRequests && (
            <div data-brief-section="requests" className="[&>*]:h-full">
              <RequestsAwaitingReviewBlock summary={requestSummary} timezone={timezone} />
            </div>
          )}
        </div>
        {composition.requestsUnavailable && (
          <CalmGroup lines={[{ key: "unavailable", section: "requests" }]} brief={brief} />
        )}
      </section>
    );
  }

  const noOtherWork = composition.work.every((section) => section === "today");
  return (
    <section className="flex flex-col gap-zw-lg" data-testid="brief" data-brief-kind="standard" aria-labelledby="operations-brief-heading">
      {/* NP-UI-P1b rhythm: heading -> its fact tiles 16px; then 24px between the Brief's cards. */}
      <div className="flex flex-col gap-zw-md">
        {heading}
        {summaryTiles}
      </div>
      <TodayHeadline
        headline={composition.headline}
        detail={composition.todayDetail}
        nothingWaiting={noOtherWork}
        nextTodayPickupAt={nextTodayPickupAt}
        timezone={timezone}
      />
      {/* NP-UI-P1b: the WORK sections keep their fixed P0..P5 order (reading order is row by row); the wide blocks
          (Needs Attention, Today) span both columns at lg, the compact single-row blocks pair up. */}
      <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-2">
      {composition.work.map((section, index) => (
        <div key={section} data-brief-section={section} className={cn(spansFullRow(composition.work, index) ? "lg:col-span-2" : "[&>*]:h-full")}>
          {section === "attention" && (
            <NeedsAttentionBlock items={attention ?? []} unassignedCount={unassignedCount ?? 0} timezone={timezone} />
          )}
          {section === "requests" && <RequestsAwaitingReviewBlock summary={requestSummary} timezone={timezone} />}
          {section === "noActiveDrivers" && <NoActiveDriversRow isAdmin={isAdmin} />}
          {section === "today" && (
            <div
              className={cn(
                "grid grid-cols-1 gap-zw-lg",
                composition.todayShowsActiveNow && composition.todayShowsNextDepartures && "lg:grid-cols-2",
              )}
            >
              {composition.todayShowsActiveNow && <ActiveNowBlock trips={activeNow ?? []} timezone={timezone} />}
              {composition.todayShowsNextDepartures && <NextDeparturesBlock trips={nextDepartures ?? []} timezone={timezone} />}
            </div>
          )}
          {section === "tomorrow" && <TomorrowReadinessBlock summary={tomorrowReadiness} />}
          {section === "recurring" && <RecurringCareBlock summary={recurringCare} />}
          {section === "proof" && <ProofOfServiceBlock summary={proofOfService} />}
        </div>
      ))}
      </div>
      {composition.calm.length > 0 && <CalmGroup lines={composition.calm} brief={brief} />}
    </section>
  );
}

const WIDE_SECTIONS = new Set<string>(["attention", "today"]);

/**
 * Wide sections always span the row. Compact sections pair up in reading order; one left without a partner (a run of
 * compact sections with an odd length) spans the row instead of leaving an empty half.
 */
function spansFullRow(work: readonly string[], index: number): boolean {
  if (WIDE_SECTIONS.has(work[index])) return true;
  let runStart = index;
  while (runStart > 0 && !WIDE_SECTIONS.has(work[runStart - 1])) runStart--;
  let runEnd = index;
  while (runEnd < work.length - 1 && !WIDE_SECTIONS.has(work[runEnd + 1])) runEnd++;
  const runLength = runEnd - runStart + 1;
  return runLength % 2 === 1 && index === runEnd;
}

/** The Today headline: one calm line (or the existing contained panels for unavailable / all clear). */
function TodayHeadline({
  headline,
  detail,
  nothingWaiting,
  nextTodayPickupAt,
  timezone,
}: {
  headline: BriefHeadline;
  detail: BriefTodayDetail;
  nothingWaiting: boolean;
  nextTodayPickupAt: string | null;
  timezone: string;
}) {
  if (headline === "today_unavailable") {
    return (
      <Panel data-testid="brief-headline" data-headline={headline}>
        <EmptyState title="Today's operations unavailable" description="We couldn't load today's trip activity. Refresh the page to try again." />
      </Panel>
    );
  }
  if (headline === "all_clear") {
    return (
      <Panel data-testid="brief-headline" data-headline={headline}>
        <EmptyState title="All clear" description="Every trip today is complete. Nothing is waiting for you." />
      </Panel>
    );
  }
  if (headline === "attention_present") {
    return null;
  }
  const text: Record<Exclude<BriefHeadline, "today_unavailable" | "all_clear" | "attention_present">, string> = {
    all_complete: "Every trip today is complete.",
    nothing_scheduled: nothingWaiting ? "Nothing scheduled today. Nothing is waiting for you." : "Nothing scheduled today.",
    carryover: "No new trips scheduled today.",
    nothing_needs_attention: "Nothing needs attention right now.",
  };
  return (
    <div data-testid="brief-headline" data-headline={headline}>
      <p className={cn(typography.body, "text-text-primary")}>{text[headline]}</p>
      {detail === "next_trip_later_today" && nextTodayPickupAt && (
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Next trip today at {formatOperationsTime(nextTodayPickupAt, timezone)}.</p>
      )}
      {detail === "nothing_departing_soon" && (
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Nothing departing in the next 2 hours.</p>
      )}
    </div>
  );
}

/** Fresh organization (never had a trip, setup incomplete): one concise Get started panel instead of empty widgets. */
function GetStartedPanel({ timezone, isAdmin, hasLinkedDriver }: { timezone: string; isAdmin: boolean; hasLinkedDriver: boolean }) {
  // NP-UI-P1b (Concept B "Get started"): each action is one row link (icon, action, one-line purpose, chevron). The
  // destinations and their role gating are unchanged; admin-only links stay admin-only (and server-guarded).
  return (
    <Panel padding="none" elevated className="flex flex-col" data-testid="get-started">
      <div className="p-zw-lg pb-zw-md">
        <PanelHeader
          icon={<ListChecks className="size-5" />}
          tone="info"
          title="Get started"
          description="Set up your workspace and schedule your first trip."
        />
      </div>
      <ul className="mx-zw-lg mb-zw-lg flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
        <QuickActionRow href="/operations/trips/new" icon={<Path className="size-5" />} title="Create your first trip" description="Put a trip on the schedule." />
        {isAdmin ? (
          <QuickActionRow
            href="/onboarding/basics"
            icon={<Storefront className="size-5" />}
            title="Review business basics"
            // The stored value is shown as a fact -- never claimed as "confirmed" (no persisted confirmation exists).
            description={<span data-testid="get-started-timezone">Timezone: {timezone}</span>}
          />
        ) : (
          <QuickActionRow icon={<Storefront className="size-5" />} title="Business basics" description={<span data-testid="get-started-timezone">Timezone: {timezone}</span>} />
        )}
        {isAdmin && (
          <QuickActionRow
            href="/operations/settings/website-requests"
            icon={<PlugsConnected className="size-5" />}
            title="Open website requests"
            description="Set up and manage requests from your website."
          />
        )}
        {isAdmin && !hasLinkedDriver && (
          <QuickActionRow
            href="/operations/settings/my-access"
            icon={<SteeringWheel className="size-5" />}
            title="I also drive"
            description="Do you also drive? Link your own driver profile."
          />
        )}
      </ul>
    </Panel>
  );
}

/** One quick-action row: a whole-row link when there is a destination, otherwise a static fact row (no chevron). */
function QuickActionRow({ href, icon, title, description }: { href?: string; icon: ReactNode; title: string; description: ReactNode }) {
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-secondary text-text-secondary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn(typography.bodySmall, "block font-medium text-text-primary")}>{title}</span>
        <span className={cn(typography.metadata, "block text-text-secondary")}>{description}</span>
      </span>
      {href && <CaretRight className="size-4 shrink-0 text-text-muted" aria-hidden />}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="flex items-center gap-3 px-zw-md py-zw-sm transition-colors duration-base first:rounded-t-md hover:bg-surface-hover">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-zw-md py-zw-sm">{body}</div>
      )}
    </li>
  );
}

/** Trips exist but no active Driver can be assigned (activeDriverCount = 0). Admin gets the setup link; a Dispatcher gets a factual note. */
function NoActiveDriversRow({ isAdmin }: { isAdmin: boolean }) {
  return (
    <CompactBlock
      icon={<IdentificationCard className="size-5" />}
      tone="attention"
      title="Drivers"
      action={
        isAdmin ? (
          <LinkButton href="/operations/drivers" variant="outline" size="sm">
            Set up drivers
          </LinkButton>
        ) : undefined
      }
    >
      <p className={cn(typography.bodySmall, "text-warning-text")}>No active drivers — trips can&apos;t be assigned.</p>
      {!isAdmin && <p className={cn(typography.metadata, "mt-1 text-text-muted")}>An organization admin can add drivers.</p>}
    </CompactBlock>
  );
}

/** One compact group of single-line summaries -- no zero tiles, no percentages. */
function CalmGroup({ lines, brief }: { lines: BriefCalmLine[]; brief: OperationsBriefData }) {
  return (
    <Panel padding="dense" elevated data-testid="brief-calm">
      <ul className="divide-y divide-border-subtle">
        {lines.map((line) => {
          const row = calmRow(line, brief);
          return (
            <li
              key={line.key === "unavailable" ? `unavailable-${line.section}` : line.key}
              className="flex flex-wrap items-center justify-between gap-3 py-zw-sm first:pt-0 last:pb-0"
              data-calm={line.key === "unavailable" ? `unavailable-${line.section}` : line.key}
              data-testid={line.key === "tomorrow" ? "brief-tomorrow" : undefined}
            >
              <div className="min-w-0">
                <p className={cn(typography.metadata, "font-medium text-text-muted")}>{row.title}</p>
                <p
                  className={cn(typography.bodySmall, line.key === "unavailable" ? "text-text-muted" : "text-text-secondary")}
                  data-testid={line.key === "tomorrow" ? "brief-tomorrow-line" : undefined}
                >
                  {row.text}
                </p>
              </div>
              <Link href={row.href} className={cn(typography.bodySmall, "shrink-0 font-medium text-text-link hover:underline")}>
                {row.action}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function calmRow(line: BriefCalmLine, brief: OperationsBriefData): { title: string; text: string; href: string; action: string } {
  switch (line.key) {
    case "tomorrow":
      return { title: "Tomorrow", text: deriveTomorrowSummaryLine(brief.tomorrowReadiness), href: "/operations/tomorrow", action: "Review tomorrow" };
    case "requests":
      return { title: "Requests", text: "No requests awaiting review", href: "/operations/requests", action: "Open" };
    case "recurring":
      return { title: "Standing orders", text: "Standing orders are covered", href: "/operations/recurring-care", action: "Open" };
    case "proof":
      return {
        title: "Proof of service",
        text: line.state === "ready" ? "Yesterday's completed trips are ready for review" : "Nothing from yesterday to review",
        href: "/operations/proof-of-service",
        action: "Open",
      };
    case "drivers": {
      const snapshot = brief.driverSnapshot;
      return {
        title: "Drivers",
        text: snapshot ? `On trip now: ${snapshot.driversCurrentlyOnTrip} of ${snapshot.totalActiveDrivers} active drivers` : "Driver snapshot unavailable",
        href: "/operations/dispatch",
        action: "View Dispatch",
      };
    }
    case "unavailable": {
      const map = {
        tomorrow: { title: "Tomorrow", text: "Tomorrow unavailable", href: "/operations/tomorrow" },
        requests: { title: "Requests", text: "Request summary unavailable", href: "/operations/requests?state=pending" },
        recurring: { title: "Standing orders", text: "Standing orders unavailable", href: "/operations/recurring-care" },
        proof: { title: "Proof of service", text: "Proof-of-service review unavailable", href: "/operations/proof-of-service" },
        drivers: { title: "Drivers", text: "Driver snapshot unavailable", href: "/operations/dispatch" },
      } as const;
      return { ...map[line.section], action: "Open" };
    }
  }
}

/** Restrained maximum row count for the Brief's own compact Needs Attention list (P1-E1-S1C §10) — the existing, unchanged, full Needs Attention table further down the page remains the "see everything" surface; this block's own overflow link goes to Dispatch, the same already-existing destination NEEDS_ASSIGNMENT rows already route to. */
const ATTENTION_ROW_LIMIT = 5;

function attentionItemHref(item: TodaysOperationsAttentionItem): string {
  return item.assurance.code === "NEEDS_ASSIGNMENT" ? "/operations/dispatch" : `/operations/trips/${item.trip.id}`;
}

function NeedsAttentionBlock({
  items,
  unassignedCount,
  timezone,
}: {
  items: TodaysOperationsAttentionItem[];
  unassignedCount: number;
  timezone: string;
}) {
  const visible = items.slice(0, ATTENTION_ROW_LIMIT);
  const overflowCount = items.length - visible.length;

  // NP-UI-P1b card rhythm: header (icon, title, count) · body (one row per trip: time column, passenger + reason,
  // route, explanation, the row's one action) · footer only when more items wait in Dispatch. Same rows, limit,
  // reasons, explanations and destinations as before.
  return (
    <Panel padding="none" elevated className="flex h-full flex-col">
      <PanelSection part="header">
        <PanelHeader
          icon={<WarningCircle className="size-5" weight="fill" />}
          tone={items.length > 0 ? "attention" : "neutral"}
          title="Needs Attention"
          description="Trips with an open issue, no driver, or a location concern."
          actions={items.length > 0 ? <StatusBadge label={`${items.length} ${items.length === 1 ? "Item" : "Items"}`} category="warning" /> : undefined}
        />
      </PanelSection>
      <PanelSection part="body">
        {unassignedCount > 0 && (
          <p className={cn(typography.bodySmall, "mb-zw-sm font-medium text-text-secondary")}>
            {unassignedCount} {unassignedCount === 1 ? "trip needs" : "trips need"} a driver.
          </p>
        )}
        {items.length === 0 ? (
          <EmptyState size="compact" title="Nothing needs attention" description="No open issues, unassigned trips, or location concerns right now." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {visible.map((item) => (
              <li key={item.trip.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-zw-md first:pt-zw-xs last:pb-zw-xs sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                <p className={cn(typography.label, "pt-0.5 tabular-nums text-text-primary")}>{formatOperationsTime(item.trip.scheduledPickupAt, timezone)}</p>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{item.trip.passengerName}</p>
                    <StatusBadge label={item.assurance.label} category={assuranceStatusCategory(item.assurance.code)} />
                  </div>
                  <p className={cn(typography.metadata, "mt-1 truncate text-text-muted")}>
                    {item.trip.pickupDescription} <ArrowRight className="inline size-3" aria-hidden />{" "}
                    {item.trip.destinationDescription}
                  </p>
                  <p className={cn(typography.metadata, "mt-0.5 text-text-secondary")}>{item.assurance.explanation}</p>
                </div>
                <LinkButton href={attentionItemHref(item)} variant="outline" size="sm" className="col-start-2 justify-self-start sm:col-start-auto sm:self-center sm:justify-self-end">
                  {item.assurance.code === "NEEDS_ASSIGNMENT" ? "Assign" : "Open Trip"}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {overflowCount > 0 && (
        <PanelSection part="footer">
          <Link href="/operations/dispatch" className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}>
            +{overflowCount} more in Dispatch <ArrowRight className="size-4" aria-hidden />
          </Link>
        </PanelSection>
      )}
    </Panel>
  );
}

/** Matches SectionHeader's own visual styling (title + description) but at
 * heading level 3 — every Brief sub-block nests under the Brief's own h2
 * "Operations Brief" (accessibility: a screen-reader heading-level scan
 * must see Brief -> its 4 blocks as a real h2 -> h3 nesting, not a second,
 * competing set of page-level h2s alongside the existing Needs Attention/
 * Upcoming Trips/Active Trips/Activity Log panels below). */
function BlockHeading({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return <PanelHeader title={title} description={description} icon={icon} tone="info" />;
}

/**
 * NP-UI-P1b compact Brief block (Concept B card anatomy): a header (icon tile + fixed h3 title), the block's own
 * varying body, and its one action in a quiet footer. The copy, the action and the heading identity of every block
 * are unchanged.
 */
function CompactBlock({
  icon,
  tone = "neutral",
  title,
  action,
  children,
  testId,
}: {
  icon: ReactNode;
  tone?: PanelTone;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Panel padding="none" elevated className="flex flex-col" data-testid={testId}>
      <PanelSection part="header" className="pb-zw-lg">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", iconToneClasses[tone])} aria-hidden>
            {icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{title}</h3>
            <div className="mt-1">{children}</div>
          </div>
        </div>
      </PanelSection>
      {action && <PanelSection part="footer">{action}</PanelSection>}
    </Panel>
  );
}

/** NP-UI-P1b: one trip row in a Brief list — a fixed time column, then passenger and route, then the status. */
function BriefTripRow({ trip, timezone, status }: { trip: TodaysOperationsTrip; timezone: string; status: ReactNode }) {
  return (
    <li>
      <Link
        href={`/operations/trips/${trip.id}`}
        className="-mx-zw-sm grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-sm px-zw-sm py-zw-sm transition-colors duration-base hover:bg-surface-hover"
      >
        <span className={cn(typography.label, "pt-0.5 tabular-nums text-text-primary")}>{formatOperationsTime(trip.scheduledPickupAt, timezone)}</span>
        <span className="min-w-0">
          <span className={cn(typography.bodySmall, "block truncate font-medium text-text-primary")}>{trip.passengerName}</span>
          <span className={cn(typography.metadata, "block truncate text-text-muted")}>
            {trip.pickupDescription} → {trip.destinationDescription}
          </span>
        </span>
        {status}
      </Link>
    </li>
  );
}

function ActiveNowBlock({ trips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  return (
    <Panel padding="none" elevated className="flex h-full flex-col">
      <PanelSection part="header">
        <BlockHeading title="Active Now" description="What's happening right now." icon={<Lightning className="size-5" />} />
      </PanelSection>
      <PanelSection part="body" className="flex-1">
        {trips.length === 0 ? (
          <EmptyState size="compact" title="Nothing in progress" description="Trips currently underway will appear here." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <BriefTripRow
                key={trip.id}
                trip={trip}
                timezone={timezone}
                status={
                  <span className={cn(typography.bodySmall, "inline-flex items-center gap-1.5 pt-0.5 font-medium text-info-text")}>
                    <span className="size-2 shrink-0 rounded-full bg-info-strong" aria-hidden />
                    {trip.statusLabel}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </PanelSection>
    </Panel>
  );
}

function NextDeparturesBlock({ trips: allTrips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  // P1-OPS-PROG3B: at most BRIEF_ROW_LIMIT rows (the Brief's existing list
  // cap), then a link to the full list of today's trips below.
  const trips = allTrips.slice(0, BRIEF_ROW_LIMIT);
  const overflow = allTrips.length - trips.length;
  return (
    <Panel padding="none" elevated className="flex h-full flex-col">
      <PanelSection part="header">
        <BlockHeading title="Next Departures" description="Scheduled to depart within 2 hours." icon={<NavigationArrow className="size-5" />} />
      </PanelSection>
      <PanelSection part="body" className="flex-1">
        {trips.length === 0 ? (
          <EmptyState size="compact" title="Nothing departing soon" description="No trips scheduled to depart in the next 2 hours." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <BriefTripRow key={trip.id} trip={trip} timezone={timezone} status={<span className={cn(typography.metadata, "pt-0.5 text-text-muted")}>{trip.statusLabel}</span>} />
            ))}
          </ul>
        )}
      </PanelSection>
      {overflow > 0 && (
        <PanelSection part="footer">
          <Link href="#today-trips" className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}>
            View today&apos;s trips <ArrowRight className="size-4" aria-hidden />
          </Link>
        </PanelSection>
      )}
    </Panel>
  );
}

/**
 * Requests awaiting review (P1-E1-S2G) — answers "is there inbound
 * transportation demand I have not reviewed yet?" Mirrors
 * DriverSnapshotBlock's own compact single-row shape exactly (same Panel
 * layout, same label/value/action structure) rather than inventing a new
 * visual pattern. Deliberately calm: no WarningCircle icon, no
 * StatusBadge, no warning color — a pending Request is inbound demand,
 * never a Trip operational failure, so this block never competes
 * visually with Needs Attention above. "Review requests" always routes
 * to Request Hub's own actual Pending filter contract
 * (`?state=pending`, requests-list.ts's own query parameter — no new
 * parameter invented here).
 */
function RequestsAwaitingReviewBlock({
  summary,
  timezone,
}: {
  summary: OperationsBriefData["requestSummary"];
  timezone: string;
}) {
  if (summary === null) {
    // P1-PILOT-S3R: the underlying `getRequestSummary` fetch genuinely
    // failed — "Request summary unavailable," never a fabricated "No
    // requests awaiting review" (that copy is reserved for the real,
    // successfully-fetched `pendingRequestCount === 0` case).
    return (
      <CompactBlock icon={<Tray className="size-5" />} title="Requests awaiting review" action={<ReviewRequestsLink />}>
        <p className={cn(typography.bodySmall, "text-text-muted")}>Request summary unavailable</p>
      </CompactBlock>
    );
  }

  const { pendingRequestCount, oldestPendingRequestCreatedAt, strandedAcceptedCount } = summary;
  const hasPending = pendingRequestCount > 0;
  // P1-PILOT-R2B (PR-03): a plain fact line, no score / aging / severity; zero or unknown -> nothing.
  const strandedLine = strandedRequestsLine(strandedAcceptedCount ?? 0);

  // NP-UI-P1b (Concept B): the pending count is the block's headline figure; the oldest request and the stranded
  // accepted requests are fact rows beneath it. Same facts, same copy, same links as before.
  return (
    <CompactBlock icon={<Tray className="size-5" />} tone={hasPending ? "info" : "neutral"} title="Requests awaiting review" action={<ReviewRequestsLink />}>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>
        {hasPending ? (
          <>
            <span className={cn(typography.metricValue, "text-text-primary")}>{pendingRequestCount}</span>{" "}
            {pendingRequestCount === 1 ? "request" : "requests"}
          </>
        ) : (
          "No requests awaiting review"
        )}
      </p>
      {((hasPending && oldestPendingRequestCreatedAt) || strandedLine) && (
        <ul className="mt-zw-md flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface-app px-zw-sm">
          {hasPending && oldestPendingRequestCreatedAt && (
            <li className={cn(typography.metadata, "flex items-center gap-2 py-zw-sm text-text-muted")}>
              <Clock className="size-4 shrink-0" aria-hidden />
              <span>Oldest request received {formatOperationsLongDate(new Date(oldestPendingRequestCreatedAt), timezone)}</span>
            </li>
          )}
          {strandedLine && (
            <li className="py-zw-sm">
              <p className={cn(typography.bodySmall, "flex items-center gap-2")} data-testid="brief-stranded-requests">
                <Path className="size-4 shrink-0 text-text-muted" aria-hidden />
                <Link href={STRANDED_REQUESTS_HREF} className="text-text-link underline-offset-2 hover:underline">
                  {strandedLine}
                </Link>
              </p>
            </li>
          )}
        </ul>
      )}
    </CompactBlock>
  );
}

function ReviewRequestsLink() {
  return (
    <LinkButton href="/operations/requests?state=pending" variant="outline" size="sm" trailingIcon={<ArrowRight className="size-4" aria-hidden />}>
      Review requests
    </LinkButton>
  );
}

/**
 * Tomorrow Readiness (P1-E1-S4E) — mirrors DriverSnapshotBlock's and
 * RequestsAwaitingReviewBlock's own compact single-row shape exactly
 * (same Panel layout, same fixed-title/varying-description/single-action
 * structure) — no new visual pattern. Deliberately calm at every count,
 * including when `needsPreparationCount > 0`: no StatusBadge, no
 * WarningCircle, no warning-toned text — the SAME restraint
 * RequestsAwaitingReviewBlock already establishes for exactly the same
 * reason ("never compete visually with Needs Attention above"). Tomorrow
 * preparation is workflow, not a current operational failure (S4E §8's
 * own explicit instruction).
 *
 * Reuses `TomorrowReadinessData`'s already-authoritative counts
 * end-to-end — this component performs no filtering, sorting, or
 * re-evaluation of its own; `summary` is `null` only when the underlying
 * fetch genuinely failed (S4E §11), never used to represent a real zero
 * value.
 */
function TomorrowReadinessBlock({ summary }: { summary: OperationsBriefData["tomorrowReadiness"] }) {
  // P1-OPS-PROG2: one fact-derived line a one-person operator can act on
  // without opening Tomorrow ("4 trips · All ready" / "4 trips · 2 need
  // preparation" / "Nothing scheduled for tomorrow") -- counts straight
  // from the derived aggregate, no percentage, no stored status.
  const line = deriveTomorrowSummaryLine(summary);
  return (
    <CompactBlock
      testId="brief-tomorrow"
      icon={<CalendarCheck className="size-5" />}
      title="Tomorrow"
      action={
        <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
          Review tomorrow
        </LinkButton>
      }
    >
      <p className={cn(typography.bodySmall, summary === null ? "text-text-muted" : "text-text-secondary")} data-testid="brief-tomorrow-line">
        {line}
      </p>
    </CompactBlock>
  );
}

/**
 * Recurring Care (P1-E2-S1F) — mirrors TomorrowReadinessBlock's own
 * compact single-row shape and fixed-title/varying-description structure
 * exactly (same Panel layout, same "Recurring care" heading in every
 * state — never a state-dependent heading, matching every other Brief
 * block's own convention of keeping the h3 identity label constant and
 * varying only the body copy, so a screen-reader heading-level scan
 * always sees the same fixed set of Brief sub-headings regardless of
 * data). Answers exactly "Which expected recurring occurrences do not
 * yet have qualifying Trips?" (§2) — never Trip Readiness reasons, open
 * Trip exceptions, Driver/Vehicle inactivity, or today's execution
 * problems, all already owned by other blocks above.
 *
 * `summary` is `null` only on a genuine fetch failure (§17 — "Unknown ≠
 * healthy") and renders "Recurring care unavailable," never silently
 * falling back to a covered/zero appearance. `activeArrangementCount
 * === 0` is a real discovery state (§6), not an error — restrained
 * "Set up recurring care" copy, no 0-missing/0-scheduled numbers shown.
 * `missingOccurrenceCount === 0` (with active arrangements) is a calm,
 * factual "covered" state (§7) — deliberately never claims recurring
 * care "will run successfully," since Trip Readiness/execution are
 * separate concerns this block does not speak to. `missingOccurrenceCount
 * > 0` uses restrained attention styling (a warm text tone on the count
 * line only — no WarningCircle icon, no StatusBadge, §13) — visually
 * quieter than Needs Attention's own stronger current-execution
 * hierarchy, consistent with Recurring Care being forward planning, not
 * an active incident. `nextMissingDate` (already an authoritative LOCAL
 * SERVICE DATE string from the evaluator's own per-arrangement timezone
 * resolution) is rendered via `formatServiceDateLabel` — the same
 * date-key-only formatter the Recurring Care workspace itself uses,
 * never re-interpreted through the browser's timezone.
 */
function RecurringCareBlock({ summary }: { summary: OperationsBriefData["recurringCare"] }) {
  if (summary === null) {
    return (
      <CompactBlock
        icon={<Repeat className="size-5" />}
        tone="neutral"
        title="Standing orders"
        action={
          <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
            View standing orders
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-muted")}>Standing orders unavailable</p>
      </CompactBlock>
    );
  }

  const { activeArrangementCount, missingOccurrenceCount, arrangementsWithMissingCount, nextMissingDate } = summary;

  if (activeArrangementCount === 0) {
    return (
      <CompactBlock
        icon={<Repeat className="size-5" />}
        tone="neutral"
        title="Standing orders"
        action={
          <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
            Set up a standing order
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-secondary")}>No recurring transportation set up</p>
      </CompactBlock>
    );
  }

  if (missingOccurrenceCount === 0) {
    return (
      <CompactBlock
        icon={<Repeat className="size-5" />}
        tone="neutral"
        title="Standing orders"
        action={
          <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
            View standing orders
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-secondary")}>Standing orders are covered</p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>All expected rides in the next 14 days have trips scheduled.</p>
      </CompactBlock>
    );
  }

  return (
    <CompactBlock
      icon={<Repeat className="size-5" />}
      tone="attention"
      title="Standing orders"
      action={
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          Review standing orders
        </LinkButton>
      }
    >
      <p className={cn(typography.bodySmall, "text-warning-text")}>
        {missingOccurrenceCount} recurring {missingOccurrenceCount === 1 ? "ride" : "rides"} need{missingOccurrenceCount === 1 ? "s" : ""} scheduling
      </p>
      <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
        Across {arrangementsWithMissingCount} {arrangementsWithMissingCount === 1 ? "standing order" : "standing orders"}
        {nextMissingDate && ` · Next gap: ${formatServiceDateLabel(nextMissingDate)}`}
      </p>
    </CompactBlock>
  );
}

/**
 * Proof of Service (P1-E3-S1F) — mirrors `TomorrowReadinessBlock`'s/
 * `RecurringCareBlock`'s own compact single-row shape and fixed-title/
 * varying-description structure exactly (same Panel layout, same "Proof
 * of service" heading in every state — never state-dependent). Answers
 * exactly one question: "does any recently completed transportation need
 * operational evidence review before billing?" (§Mission) — never a
 * revenue amount, a claim/invoice/payment state, or a payer-compliance
 * judgment (none of that data exists in this schema — see docs/reports/
 * p1-e3-s1a-revenue-assurance-foundation-audit.txt). This block owns
 * ONLY completed-service evidence review — never live Trip execution,
 * Trip Readiness, Tomorrow Readiness, Recurring Care gaps, Requests
 * awaiting review, Driver capacity, or any monetary concept, all already
 * owned by other Brief blocks or explicitly out of scope for this
 * product today (§12).
 *
 * WINDOW: always Yesterday, in the organization's local timezone (§3,
 * locked) — never Today, never Last 7 Days; the summary itself
 * (`getProofOfServiceSummary`) only ever evaluates that one window. The
 * "Review proof of service"/"View proof of service" action always routes
 * to `/operations/proof-of-service`, which itself already defaults to
 * Yesterday (P1-E3-S1D) — no query param is needed here to keep the two
 * in sync.
 *
 * `summary` is `null` only on a genuine fetch failure OR a deliberate
 * whole-window "unavailable" decision (a safety-cap trip or a detected
 * truncation — trip-proof-of-service.ts's own `getYesterdayProofOfServiceResults`,
 * S1F §9/§11 — "Unknown ≠ healthy") — renders "Proof-of-service review
 * unavailable," never silently falling back to a covered/zero appearance.
 * `completedTripCount === 0` is a real, successfully-fetched "nothing to
 * review" state (§13), not an error — restrained copy, never "No
 * revenue"/"No billable trips"/"Everything ready." `needsReviewCount ===
 * 0` (with completed trips present) is a calm, factual "ready for
 * review" state (§14) — deliberately never "ready to bill"/"claim
 * ready"/"revenue secured," since none of those claims is one this
 * product can truthfully make. `needsReviewCount > 0` uses the SAME
 * restrained warm-text-only attention styling `RecurringCareBlock`
 * already established (§18 — "lower urgency than active Trip exception
 * or current operational failure," no WarningCircle icon, no
 * StatusBadge, no critical-red treatment) — administrative follow-through
 * on completed work, not a current incident. An `evidenceIntegrityGapCount
 * > 0` contribution adds one restrained extra line (§16) without ever
 * exposing which specific internal-integrity cause produced it and
 * without turning the whole block critical.
 */
function ProofOfServiceBlock({ summary }: { summary: OperationsBriefData["proofOfService"] }) {
  if (summary === null) {
    return (
      <CompactBlock
        icon={<ShieldCheck className="size-5" />}
        tone="neutral"
        title="Proof of service"
        action={
          <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
            View proof of service
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-muted")}>Proof-of-service review unavailable</p>
      </CompactBlock>
    );
  }

  const { completedTripCount, needsReviewCount, evidenceIntegrityGapCount } = summary;

  if (completedTripCount === 0) {
    return (
      <CompactBlock
        icon={<ShieldCheck className="size-5" />}
        tone="neutral"
        title="Proof of service"
        action={
          <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
            View proof of service
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-secondary")}>No completed trips to review from yesterday.</p>
      </CompactBlock>
    );
  }

  if (needsReviewCount === 0) {
    return (
      <CompactBlock
        icon={<ShieldCheck className="size-5" />}
        tone="neutral"
        title="Proof of service"
        action={
          <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
            View proof of service
          </LinkButton>
        }
      >
        <p className={cn(typography.bodySmall, "text-text-secondary")}>Yesterday&apos;s completed trips are ready for review.</p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          {completedTripCount} completed {completedTripCount === 1 ? "trip has" : "trips have"} the required operational evidence.
        </p>
      </CompactBlock>
    );
  }

  return (
    <CompactBlock
      icon={<ShieldCheck className="size-5" />}
      tone="attention"
      title="Proof of service"
      action={
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          Review proof of service
        </LinkButton>
      }
    >
      <p className={cn(typography.bodySmall, "text-warning-text")}>
        {needsReviewCount} completed {needsReviewCount === 1 ? "trip needs" : "trips need"} review
      </p>
      <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
        From {completedTripCount} completed {completedTripCount === 1 ? "trip" : "trips"} yesterday.
      </p>
      {evidenceIntegrityGapCount > 0 && (
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          {evidenceIntegrityGapCount} {evidenceIntegrityGapCount === 1 ? "has" : "have"} incomplete service evidence.
        </p>
      )}
    </CompactBlock>
  );
}
