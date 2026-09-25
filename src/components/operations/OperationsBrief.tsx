import Link from "next/link";
import { WarningCircle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { deriveTomorrowSummaryLine } from "@/lib/operations/readiness-actions-core";
import { formatOperationsTime, formatOperationsLongDate, formatServiceDateLabel, assuranceStatusCategory } from "@/lib/operations/presentation";
import type { OperationsBriefData } from "@/lib/operations/operations-brief-core";
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
export function OperationsBrief({ brief, composition, timezone, nextTodayPickupAt, isAdmin, hasLinkedDriver }: OperationsBriefProps) {
  const { attention, activeNow, nextDepartures, unassignedCount, requestSummary, tomorrowReadiness, recurringCare, proofOfService } = brief;

  const heading = (
    <div>
      <h2 className={cn(typography.sectionHeading, "text-text-primary")}>Operations Brief</h2>
      <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>What needs your attention and what is happening next.</p>
    </div>
  );

  if (composition.kind === "fresh") {
    return (
      <div className="flex flex-col gap-zw-lg" data-testid="brief" data-brief-kind="fresh">
        {heading}
        <GetStartedPanel timezone={timezone} isAdmin={isAdmin} hasLinkedDriver={hasLinkedDriver} />
        {composition.showRequests && (
          <div data-brief-section="requests">
            <RequestsAwaitingReviewBlock summary={requestSummary} timezone={timezone} />
          </div>
        )}
        {composition.requestsUnavailable && (
          <CalmGroup lines={[{ key: "unavailable", section: "requests" }]} brief={brief} />
        )}
      </div>
    );
  }

  const noOtherWork = composition.work.every((section) => section === "today");
  return (
    <div className="flex flex-col gap-zw-lg" data-testid="brief" data-brief-kind="standard">
      {heading}
      <TodayHeadline
        headline={composition.headline}
        detail={composition.todayDetail}
        nothingWaiting={noOtherWork}
        nextTodayPickupAt={nextTodayPickupAt}
        timezone={timezone}
      />
      {composition.work.map((section) => (
        <div key={section} data-brief-section={section}>
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
      {composition.calm.length > 0 && <CalmGroup lines={composition.calm} brief={brief} />}
    </div>
  );
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
  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="get-started">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Get started</h3>
        <LinkButton href="/operations/trips/new" size="sm">
          Create your first trip
        </LinkButton>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        <li className="flex flex-wrap items-center justify-between gap-3 py-zw-sm first:pt-0">
          <div>
            <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>Business basics</p>
            {/* The stored value is shown as a fact -- never claimed as "confirmed" (no persisted confirmation exists). */}
            <p className={cn(typography.metadata, "text-text-secondary")} data-testid="get-started-timezone">
              Timezone: {timezone}
            </p>
          </div>
          {isAdmin && (
            <LinkButton href="/onboarding/basics" variant="outline" size="sm">
              Review business basics
            </LinkButton>
          )}
        </li>
        {isAdmin && (
          <li className="flex flex-wrap items-center justify-between gap-3 py-zw-sm">
            <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>Website requests</p>
            <LinkButton href="/operations/settings/website-requests" variant="outline" size="sm">
              Open
            </LinkButton>
          </li>
        )}
        {isAdmin && !hasLinkedDriver && (
          <li className="flex flex-wrap items-center justify-between gap-3 py-zw-sm last:pb-0">
            <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>Do you also drive?</p>
            <LinkButton href="/operations/settings/my-access" variant="outline" size="sm">
              I also drive
            </LinkButton>
          </li>
        )}
      </ul>
    </Panel>
  );
}

/** Trips exist but no active Driver can be assigned (activeDriverCount = 0). Admin gets the setup link; a Dispatcher gets a factual note. */
function NoActiveDriversRow({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Drivers</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-warning-text")}>No active drivers — trips can&apos;t be assigned.</p>
        {!isAdmin && <p className={cn(typography.metadata, "mt-1 text-text-muted")}>An organization admin can add drivers.</p>}
      </div>
      {isAdmin && (
        <LinkButton href="/operations/drivers" variant="outline" size="sm">
          Set up drivers
        </LinkButton>
      )}
    </Panel>
  );
}

/** One compact group of single-line summaries -- no zero tiles, no percentages. */
function CalmGroup({ lines, brief }: { lines: BriefCalmLine[]; brief: OperationsBriefData }) {
  return (
    <Panel data-testid="brief-calm">
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
                <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>{row.title}</p>
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
      return { title: "Recurring care", text: "Recurring care is covered", href: "/operations/recurring-care", action: "Open" };
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
        recurring: { title: "Recurring care", text: "Recurring care unavailable", href: "/operations/recurring-care" },
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

  return (
    <Panel className="p-0">
      <div className="flex items-start justify-between gap-4 p-zw-lg pb-0">
        <div className="flex items-center gap-2">
          <WarningCircle className="size-5 text-warning-strong" weight="fill" aria-hidden />
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Needs Attention</h3>
        </div>
        {items.length > 0 && (
          <StatusBadge label={`${items.length} ${items.length === 1 ? "Item" : "Items"}`} category="warning" />
        )}
      </div>

      {unassignedCount > 0 && (
        <p className={cn(typography.bodySmall, "px-zw-lg pt-zw-sm text-text-secondary")}>
          {unassignedCount} {unassignedCount === 1 ? "trip needs" : "trips need"} a driver.
        </p>
      )}

      <div className="p-zw-lg">
        {items.length === 0 ? (
          <EmptyState title="Nothing needs attention" description="No open issues, unassigned trips, or location concerns right now." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {visible.map((item) => (
              <li
                key={item.trip.id}
                className="flex flex-col gap-2 py-zw-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                      {formatOperationsTime(item.trip.scheduledPickupAt, timezone)} · {item.trip.passengerName}
                    </p>
                    <StatusBadge label={item.assurance.label} category={assuranceStatusCategory(item.assurance.code)} />
                  </div>
                  <p className={cn(typography.metadata, "truncate text-text-muted")}>
                    {item.trip.pickupDescription} <ArrowRight className="inline size-3" aria-hidden />{" "}
                    {item.trip.destinationDescription}
                  </p>
                  <p className={cn(typography.metadata, "text-text-secondary")}>{item.assurance.explanation}</p>
                </div>
                <LinkButton href={attentionItemHref(item)} variant="outline" size="sm" className="shrink-0">
                  {item.assurance.code === "NEEDS_ASSIGNMENT" ? "Assign" : "Open Trip"}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}

        {overflowCount > 0 && (
          <div className="mt-zw-md border-t border-border-subtle pt-zw-md text-center">
            <Link
              href="/operations/dispatch"
              className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}
            >
              +{overflowCount} more in Dispatch <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Matches SectionHeader's own visual styling (title + description) but at
 * heading level 3 — every Brief sub-block nests under the Brief's own h2
 * "Operations Brief" (accessibility: a screen-reader heading-level scan
 * must see Brief -> its 4 blocks as a real h2 -> h3 nesting, not a second,
 * competing set of page-level h2s alongside the existing Needs Attention/
 * Upcoming Trips/Active Trips/Activity Log panels below). */
function BlockHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{title}</h3>
      {description && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{description}</p>}
    </div>
  );
}

function ActiveNowBlock({ trips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  return (
    <Panel>
      <BlockHeading title="Active Now" description="What's happening right now." />
      <div className="mt-zw-md">
        {trips.length === 0 ? (
          <EmptyState title="Nothing in progress" description="Trips currently underway will appear here." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <li key={trip.id} className="py-zw-sm first:pt-0 last:pb-0">
                <Link
                  href={`/operations/trips/${trip.id}`}
                  className="flex items-center justify-between gap-3 rounded-sm px-zw-sm py-zw-xs hover:bg-surface-hover"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-info-strong" aria-hidden />
                    <div className="min-w-0">
                      <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                        {formatOperationsTime(trip.scheduledPickupAt, timezone)} · {trip.passengerName}
                      </p>
                      <p className={cn(typography.metadata, "truncate text-text-muted")}>
                        {trip.pickupDescription} → {trip.destinationDescription}
                      </p>
                    </div>
                  </div>
                  <span className={cn(typography.bodySmall, "shrink-0 font-medium text-info-text")}>{trip.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function NextDeparturesBlock({ trips: allTrips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  // P1-OPS-PROG3B: at most BRIEF_ROW_LIMIT rows (the Brief's existing list
  // cap), then a link to the full list of today's trips below.
  const trips = allTrips.slice(0, BRIEF_ROW_LIMIT);
  const overflow = allTrips.length - trips.length;
  return (
    <Panel>
      <BlockHeading title="Next Departures" description="Scheduled to depart within 2 hours." />
      <div className="mt-zw-md">
        {trips.length === 0 ? (
          <EmptyState title="Nothing departing soon" description="No trips scheduled to depart in the next 2 hours." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <li key={trip.id} className="py-zw-sm first:pt-0 last:pb-0">
                <Link
                  href={`/operations/trips/${trip.id}`}
                  className="flex items-center justify-between gap-3 rounded-sm px-zw-sm py-zw-xs hover:bg-surface-hover"
                >
                  <div className="min-w-0">
                    <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                      {formatOperationsTime(trip.scheduledPickupAt, timezone)} · {trip.passengerName}
                    </p>
                    <p className={cn(typography.metadata, "truncate text-text-muted")}>
                      {trip.pickupDescription} → {trip.destinationDescription}
                    </p>
                  </div>
                  <span className={cn(typography.metadata, "shrink-0 text-text-muted")}>{trip.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {overflow > 0 && (
          <div className="mt-zw-md border-t border-border-subtle pt-zw-md text-center">
            <Link href="#today-trips" className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}>
              View today&apos;s trips <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
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
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Requests awaiting review</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Request summary unavailable</p>
        </div>
        <LinkButton href="/operations/requests?state=pending" variant="outline" size="sm">
          Review requests
        </LinkButton>
      </Panel>
    );
  }

  const { pendingRequestCount, oldestPendingRequestCreatedAt } = summary;
  const hasPending = pendingRequestCount > 0;

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Requests awaiting review</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          {hasPending ? `${pendingRequestCount} ${pendingRequestCount === 1 ? "request" : "requests"}` : "No requests awaiting review"}
        </p>
        {hasPending && oldestPendingRequestCreatedAt && (
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            Oldest request received {formatOperationsLongDate(new Date(oldestPendingRequestCreatedAt), timezone)}
          </p>
        )}
      </div>
      <LinkButton href="/operations/requests?state=pending" variant="outline" size="sm">
        Review requests
      </LinkButton>
    </Panel>
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
    <Panel className="flex flex-wrap items-center justify-between gap-3" data-testid="brief-tomorrow">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Tomorrow</h3>
        <p className={cn(typography.bodySmall, "mt-1", summary === null ? "text-text-muted" : "text-text-secondary")} data-testid="brief-tomorrow-line">
          {line}
        </p>
      </div>
      <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
        Review tomorrow
      </LinkButton>
    </Panel>
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
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Recurring care unavailable</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          View recurring care
        </LinkButton>
      </Panel>
    );
  }

  const { activeArrangementCount, missingOccurrenceCount, arrangementsWithMissingCount, nextMissingDate } = summary;

  if (activeArrangementCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>No recurring transportation set up</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          Set up recurring care
        </LinkButton>
      </Panel>
    );
  }

  if (missingOccurrenceCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Recurring care is covered</p>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>All expected rides in the next 14 days have trips scheduled.</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          View recurring care
        </LinkButton>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-warning-text")}>
          {missingOccurrenceCount} recurring {missingOccurrenceCount === 1 ? "ride" : "rides"} need{missingOccurrenceCount === 1 ? "s" : ""} scheduling
        </p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          Across {arrangementsWithMissingCount} {arrangementsWithMissingCount === 1 ? "arrangement" : "arrangements"}
          {nextMissingDate && ` · Next gap: ${formatServiceDateLabel(nextMissingDate)}`}
        </p>
      </div>
      <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
        Review recurring care
      </LinkButton>
    </Panel>
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
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Proof-of-service review unavailable</p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  const { completedTripCount, needsReviewCount, evidenceIntegrityGapCount } = summary;

  if (completedTripCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>No completed trips to review from yesterday.</p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  if (needsReviewCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Yesterday&apos;s completed trips are ready for review.</p>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            {completedTripCount} completed {completedTripCount === 1 ? "trip has" : "trips have"} the required operational evidence.
          </p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-warning-text")}>
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
      </div>
      <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
        Review proof of service
      </LinkButton>
    </Panel>
  );
}
