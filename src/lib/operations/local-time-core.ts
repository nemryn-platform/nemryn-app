/**
 * Pure (runtime-import-free) organization-local time helpers, shared by the server-only local-time.ts and by pure
 * cores / unit tests (P1-OPS-PROG5B moved these here UNCHANGED from local-time.ts, which now re-exports them;
 * organizationLocalToUtc's contract is untouched). resolveLocalBoundary is new in PROG5B.
 */

/**
 * Organization-local date/time → UTC instant conversion (P1-E3-S7, work
 * item §21/§22/§23) — the single explicit conversion boundary between a
 * Dispatcher's wall-clock input ("Aug 29, 2026, 10:00 AM") and the
 * `timestamptz` `create_trip` actually requires. Never the server runtime's
 * own timezone, never a hardcoded offset — reuses the exact DST-aware
 * offset-resolution technique `organizationDayBoundsUtc` (day-bounds.ts)
 * already established for the reverse direction (a UTC instant → an
 * organization-local calendar day), extended here to the general case (an
 * arbitrary organization-local date+time → a UTC instant).
 *
 * No manual DST arithmetic anywhere — every offset is read from the IANA
 * timezone database via `Intl`, exactly as P1-E3-S2C's
 * `is_valid_iana_timezone` established at the database layer. The approach:
 * a real IANA zone's UTC offset only takes one of two values across any
 * given year (its standard-time offset and its daylight-time offset, e.g.
 * -5h/-4h for America/New_York; identical to each other for a zone with no
 * DST at all, e.g. UTC or Arizona). Reading both from two fixed reference
 * instants (Jan 1 / Jul 1 of the requested date's own year, guaranteed to
 * straddle any Northern-hemisphere DST period), then checking which offset
 * (if either, if both) round-trips to the exact requested wall-clock
 * fields, correctly resolves the ordinary case AND both DST edge cases
 * without ever hardcoding an offset or a transition date. This does not
 * attempt to handle a zone with
 * more than 2 offset changes within a single year (some non-US zones
 * historically have) — no organization in this product's current or
 * anticipated near-term scope uses one (seed.sql's fixtures are both
 * America/New_York; docs/product/decision-register.md's own operational-
 * timezone decision is Georgia-launch only) — see the completion report's
 * DST-handling section for this documented, deliberate limitation.
 */

export function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

export function wallClockFields(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Wall-clock fields, as parsed from separate `date`/`time` form inputs — never combined into a Date via the server/browser's own local timezone. */
export interface LocalDateTime {
  /** `YYYY-MM-DD`, from an `<input type="date">`. */
  date: string;
  /** `HH:mm`, from an `<input type="time">`. */
  time: string;
}

export type LocalToUtcResult =
  | { status: "ok"; utc: Date }
  | { status: "invalid" }
  /** Spring-forward gap: this local wall-clock time was skipped entirely in `timezone` (e.g. 2:30 AM on America/New_York's DST-start day). */
  | { status: "nonexistent" }
  /** Fall-back repeated hour: this local wall-clock time occurred twice in `timezone` (e.g. 1:30 AM on America/New_York's DST-end day) — two genuinely different UTC instants both produce it. Resolving the ambiguity (standard vs. daylight) is a real product decision this phase does not make silently. */
  | { status: "ambiguous" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Converts an organization-local `{date, time}` pair to the UTC instant it
 * actually represents in `timezone`, or an explicit non-`"ok"` status
 * describing why it could not be resolved.
 */
export function organizationLocalToUtc(input: LocalDateTime, timezone: string): LocalToUtcResult {
  if (!DATE_RE.test(input.date) || !TIME_RE.test(input.time)) {
    return { status: "invalid" };
  }

  const [year, month, day] = input.date.split("-").map(Number);
  const [hour, minute] = input.time.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { status: "invalid" };
  }
  // Reject a calendar date that doesn't actually exist (e.g. Feb 30) —
  // Date.UTC would otherwise silently roll it into the following month.
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const naive = new Date(naiveUtcMs);
  if (naive.getUTCFullYear() !== year || naive.getUTCMonth() !== month - 1 || naive.getUTCDate() !== day) {
    return { status: "invalid" };
  }

  const requested = { year, month, day, hour, minute };
  const fieldsEqual = (a: typeof requested, b: typeof requested) =>
    a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

  // This zone's two possible UTC offsets across the requested date's own
  // calendar year (identical values for a zone with no DST) — read from
  // fixed winter/summer reference instants (Jan 1 / Jul 1 of that year,
  // noon UTC to stay clear of any transition at midnight), not an offset
  // relative to the requested date itself: a window relative to the
  // request can land in the SAME season on both sides depending on which
  // month was requested (verified empirically before settling on this —
  // e.g. a ±200-day window around a January date lands in daylight time on
  // both sides), while Jan 1/Jul 1 reliably straddle any Northern-
  // hemisphere DST period regardless of the requested month.
  const winterOffset = timezoneOffsetMs(new Date(Date.UTC(year, 0, 1, 12, 0, 0)), timezone);
  const summerOffset = timezoneOffsetMs(new Date(Date.UTC(year, 6, 1, 12, 0, 0)), timezone);

  const candidateInstants = new Map<number, Date>();
  for (const offset of new Set([winterOffset, summerOffset])) {
    const candidate = new Date(naiveUtcMs - offset);
    if (fieldsEqual(wallClockFields(candidate, timezone), requested)) {
      candidateInstants.set(candidate.getTime(), candidate);
    }
  }

  if (candidateInstants.size === 0) {
    return { status: "nonexistent" };
  }
  if (candidateInstants.size > 1) {
    return { status: "ambiguous" };
  }
  return { status: "ok", utc: [...candidateInstants.values()][0] };
}

// =============================================================================
// P1-OPS-PROG5B -- honest DST resolution for recurring shift boundaries
// =============================================================================

/**
 * The UTC instant(s) an organization-local wall-clock boundary can mean on a given local date:
 *   ok          -> earliest = latest = the single instant;
 *   ambiguous   -> earliest = the FIRST occurrence, latest = the SECOND occurrence (fall-back repeated hour);
 *   nonexistent -> earliest = latest = the first valid instant after the spring-forward gap (the clock resumes there,
 *                  so a boundary written inside the gap truly takes effect then).
 * null for invalid input. Never guesses between two offsets: callers keep both and treat the band as uncertain.
 */
export function resolveLocalBoundary(date: string, time: string, timezone: string): { earliest: number; latest: number } | null {
  const r = organizationLocalToUtc({ date, time }, timezone);
  if (r.status === "invalid") return null;
  if (r.status === "ok") return { earliest: r.utc.getTime(), latest: r.utc.getTime() };
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const winterOffset = timezoneOffsetMs(new Date(Date.UTC(year, 0, 1, 12, 0, 0)), timezone);
  const summerOffset = timezoneOffsetMs(new Date(Date.UTC(year, 6, 1, 12, 0, 0)), timezone);
  const a = naiveUtcMs - winterOffset;
  const b = naiveUtcMs - summerOffset;
  if (r.status === "ambiguous") return { earliest: Math.min(a, b), latest: Math.max(a, b) };
  // nonexistent: the transition instant lies between the two candidates; find (to the minute) the first instant whose
  // offset is the post-transition offset.
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  const after = timezoneOffsetMs(new Date(hi), timezone);
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
    if (timezoneOffsetMs(new Date(mid), timezone) === after) hi = mid;
    else lo = mid;
  }
  return { earliest: hi, latest: hi };
}

/** `YYYY-MM-DD` of an instant in the organization timezone. */
export function localDateKeyOf(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Calendar arithmetic on a `YYYY-MM-DD` key (no timezone involved). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday (Mon = 1 .. Sun = 7) of a `YYYY-MM-DD` key. */
export function isoWeekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}
