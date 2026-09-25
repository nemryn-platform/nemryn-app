/**
 * Pure fact-signal composition for the Operations Brief (P1-OPS-PROG3B,
 * docs/reports/p1-ops-prog3a-fact-signal-composition-spec.txt).
 *
 * No runtime imports -- unit-testable with Node's test runner, like
 * `trip-readiness-core.ts`. The composition decides ONLY the order and
 * density of Brief sections from facts the Overview already loads. It
 * never decides authorization, never hides a route, and deliberately has
 * no input for business_stage, plan, size labels, vehicle counts,
 * membership counts or dispatcher presence: every placement below is
 * explained by one factual signal, never by "the company is small/large".
 *
 * `null` always means "could not be loaded" -- it is never read as zero.
 */

export type ProgressiveDayState = "NO_TRIPS" | "ALL_COMPLETE" | "ACTIVE_DAY" | "UNAVAILABLE";

export interface ProgressiveOperationsSignals {
  dayState: ProgressiveDayState;
  attentionCount: number | null;
  todayUnassignedCount: number | null;
  activeNowCount: number | null;
  /** Scheduled departures within the Brief's existing 2-hour window. */
  nextDepartureCount: number | null;
  /** The next scheduled pickup later today (beyond the Next Departures content), if any -- for the collapsed Today line. */
  nextTodayPickupAt: string | null;
  pendingRequestCount: number | null;
  tomorrowTripCount: number | null;
  tomorrowNeedsPreparationCount: number | null;
  activeRecurringCount: number | null;
  recurringMissingCount: number | null;
  /** Yesterday's completed trips (the Proof-of-Service review window). */
  proofCompletedCount: number | null;
  proofReviewCount: number | null;
  activeDriverCount: number | null;
  /** The organization has had at least one Trip (checklist "First trip"). */
  hasEverHadTrip: boolean | null;
  checklistComplete: boolean | null;
}

/** Work sections, in the ONE fixed priority order (P0..P5). */
export type BriefWorkSection =
  | "attention" // P0
  | "requests" // P1
  | "noActiveDrivers" // after P1: trips exist but nobody can be assigned
  | "today" // P2
  | "tomorrow" // P3
  | "recurring" // P4
  | "proof"; // P5

export type BriefCalmLine =
  | { key: "tomorrow"; state: "ready" | "none" }
  | { key: "requests"; state: "none" }
  | { key: "recurring"; state: "covered" }
  | { key: "proof"; state: "ready" | "none" }
  | { key: "drivers"; state: "snapshot" }
  | { key: "unavailable"; section: "tomorrow" | "requests" | "recurring" | "proof" | "drivers" };

export type BriefHeadline =
  | "today_unavailable"
  | "all_clear" // today complete AND nothing is waiting anywhere
  | "all_complete" // today complete, other work exists
  | "nothing_scheduled" // no trips today, nothing carried over
  | "carryover" // no new trips today, but an earlier trip is active / needs attention
  | "nothing_needs_attention" // active day, attention = 0
  | "attention_present"; // active day, attention > 0 (the Attention section itself leads)

/** Extra line for the collapsed Today block (active day with no live/upcoming-within-2h content). */
export type BriefTodayDetail = "next_trip_later_today" | "nothing_departing_soon" | null;

export type BriefComposition =
  | { kind: "fresh"; showRequests: boolean; requestsUnavailable: boolean }
  | {
      kind: "standard";
      headline: BriefHeadline;
      todayDetail: BriefTodayDetail;
      work: BriefWorkSection[];
      calm: BriefCalmLine[];
      /** The Today block shows Active Now only when it has content; Next Departures when it (or Active Now) has content. */
      todayShowsActiveNow: boolean;
      todayShowsNextDepartures: boolean;
    };

/** Fresh organization: never had a trip AND setup checklist still incomplete. Both are facts; unknown (null) is never "fresh". */
export function isFreshOrganization(signals: Pick<ProgressiveOperationsSignals, "hasEverHadTrip" | "checklistComplete">): boolean {
  return signals.hasEverHadTrip === false && signals.checklistComplete === false;
}

const gt0 = (value: number | null): boolean => value !== null && value > 0;

export function composeOperationsBrief(signals: ProgressiveOperationsSignals): BriefComposition {
  if (isFreshOrganization(signals)) {
    return {
      kind: "fresh",
      showRequests: gt0(signals.pendingRequestCount),
      requestsUnavailable: signals.pendingRequestCount === null,
    };
  }

  const todayUnavailable = signals.dayState === "UNAVAILABLE";
  const attention = gt0(signals.attentionCount);
  const activeNow = gt0(signals.activeNowCount);
  const departures = gt0(signals.nextDepartureCount);
  const todayLive = !todayUnavailable && (activeNow || departures);

  const work: BriefWorkSection[] = [];
  if (attention) work.push("attention");
  if (gt0(signals.pendingRequestCount)) work.push("requests");
  if (signals.activeDriverCount === 0 && signals.hasEverHadTrip === true) work.push("noActiveDrivers");
  if (todayLive) work.push("today");
  if (gt0(signals.tomorrowNeedsPreparationCount)) work.push("tomorrow");
  if (gt0(signals.recurringMissingCount)) work.push("recurring");
  if (gt0(signals.proofReviewCount)) work.push("proof");

  // Calm group -- fixed order, then every unavailable summary (never omitted, never shown as zero).
  const calm: BriefCalmLine[] = [];
  const unavailable: BriefCalmLine[] = [];
  if (signals.tomorrowNeedsPreparationCount === null || signals.tomorrowTripCount === null) {
    unavailable.push({ key: "unavailable", section: "tomorrow" });
  } else if (!work.includes("tomorrow")) {
    calm.push({ key: "tomorrow", state: signals.tomorrowTripCount > 0 ? "ready" : "none" });
  }
  if (signals.pendingRequestCount === null) {
    unavailable.push({ key: "unavailable", section: "requests" });
  } else if (!work.includes("requests")) {
    calm.push({ key: "requests", state: "none" });
  }
  if (signals.recurringMissingCount === null || signals.activeRecurringCount === null) {
    unavailable.push({ key: "unavailable", section: "recurring" });
  } else if (!work.includes("recurring") && signals.activeRecurringCount > 0) {
    calm.push({ key: "recurring", state: "covered" });
  }
  if (signals.proofReviewCount === null || signals.proofCompletedCount === null) {
    unavailable.push({ key: "unavailable", section: "proof" });
  } else if (!work.includes("proof")) {
    calm.push({ key: "proof", state: signals.proofCompletedCount > 0 ? "ready" : "none" });
  }
  if (signals.activeDriverCount === null) {
    unavailable.push({ key: "unavailable", section: "drivers" });
  } else if (signals.activeDriverCount >= 2) {
    calm.push({ key: "drivers", state: "snapshot" });
  }

  const otherWork = work.some((section) => section !== "today" && section !== "attention");
  let headline: BriefHeadline;
  if (todayUnavailable) headline = "today_unavailable";
  else if (signals.dayState === "ALL_COMPLETE" && !attention && !activeNow) headline = otherWork ? "all_complete" : "all_clear";
  else if (signals.dayState === "NO_TRIPS" && !attention && !activeNow) headline = "nothing_scheduled";
  else if (signals.dayState === "NO_TRIPS") headline = "carryover";
  else headline = attention ? "attention_present" : "nothing_needs_attention";

  let todayDetail: BriefTodayDetail = null;
  if (signals.dayState === "ACTIVE_DAY" && !todayLive) {
    todayDetail = signals.nextTodayPickupAt ? "next_trip_later_today" : "nothing_departing_soon";
  }

  return {
    kind: "standard",
    headline,
    todayDetail,
    work,
    calm: [...calm, ...unavailable],
    todayShowsActiveNow: activeNow,
    todayShowsNextDepartures: departures || activeNow,
  };
}

/** The Brief's existing restrained list cap (NeedsAttention's ATTENTION_ROW_LIMIT) -- reused for Next Departures for consistency, not as a size threshold. */
export const BRIEF_ROW_LIMIT = 5;
