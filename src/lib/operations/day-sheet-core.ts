/**
 * Pure Day Sheet (P1-PILOT-UX1). Runtime-import-free (unit-tested under plain Node).
 *
 * The Day Sheet is the Dispatch working set for ONE organization-local day, turned into the minimum printable /
 * downloadable operating schedule. It never interprets the schedule itself: the caller passes the trips
 * `getDispatchBoardData` already loaded for that day (same day bounds, same non-terminal set). Only the fields below
 * are ever exported -- no phone numbers, emails, requester data, assistance notes, instructions, notes, exception
 * details, readiness reasons, ids or audit data.
 */

export interface DaySheetTripInput {
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  passengerName: string;
  pickupDescription: string;
  destinationDescription: string;
  driverName: string | null;
  vehicleLabel: string | null;
  statusLabel: string;
  requiresWheelchairAccess: boolean | null;
}

export interface DaySheetRow {
  pickupTime: string;
  appointmentTime: string;
  passenger: string;
  pickup: string;
  destination: string;
  driver: string;
  vehicle: string;
  status: string;
  /** "Yes" / "No" / "" (not specified). */
  wheelchair: string;
}

export const DAY_SHEET_COLUMNS: { key: keyof DaySheetRow; header: string }[] = [
  { key: "pickupTime", header: "Pickup time" },
  { key: "appointmentTime", header: "Appointment" },
  { key: "passenger", header: "Passenger" },
  { key: "pickup", header: "Pickup" },
  { key: "destination", header: "Destination" },
  { key: "driver", header: "Driver" },
  { key: "vehicle", header: "Vehicle" },
  { key: "status", header: "Status" },
  { key: "wheelchair", header: "Wheelchair equipment" },
];

function clock(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
}

/** Scheduled pickup ascending; pickup-less trips last; ties by passenger name (stable, deterministic). */
export function sortDaySheetTrips<T extends Pick<DaySheetTripInput, "scheduledPickupAt" | "passengerName">>(trips: readonly T[]): T[] {
  return [...trips].sort((a, b) => {
    const at = a.scheduledPickupAt ? Date.parse(a.scheduledPickupAt) : Number.POSITIVE_INFINITY;
    const bt = b.scheduledPickupAt ? Date.parse(b.scheduledPickupAt) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.passengerName.localeCompare(b.passengerName);
  });
}

export function buildDaySheetRows(trips: readonly DaySheetTripInput[], timezone: string): DaySheetRow[] {
  return sortDaySheetTrips(trips).map((t) => ({
    pickupTime: t.scheduledPickupAt ? clock(t.scheduledPickupAt, timezone) : "No pickup time",
    appointmentTime: clock(t.appointmentAt, timezone),
    passenger: t.passengerName,
    pickup: t.pickupDescription,
    destination: t.destinationDescription,
    driver: t.driverName ?? "Unassigned",
    vehicle: t.vehicleLabel ?? "",
    status: t.statusLabel,
    wheelchair: t.requiresWheelchairAccess === true ? "Yes" : t.requiresWheelchairAccess === false ? "No" : "",
  }));
}

/**
 * Leading characters a spreadsheet (Excel, Sheets, Numbers) evaluates as a formula. Pickup / destination text and
 * passenger names can originate from a PUBLIC website request (prefilled into New Trip), so a cell like
 * `=HYPERLINK(...)` must never reach the CSV as a live formula (CSV / formula injection, OWASP).
 */
const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One CSV field. A value starting with a formula character is prefixed with an apostrophe so spreadsheets show it as
 * text; then RFC 4180: quoted when it contains a comma, quote, CR or LF, embedded quotes doubled.
 */
export function csvField(value: string): string {
  const text = SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface DaySheetMeta {
  organizationName: string;
  /** "Tuesday, September 29, 2026" (organization-local). */
  dayLabel: string;
  /** YYYY-MM-DD (organization-local). */
  dateKey: string;
  timezone: string;
  /** "Sep 28, 2026, 5:40 PM" (organization-local). */
  generatedLabel: string;
}

/** Header rows (organization, day, timezone, generated) + a blank line + the table. CRLF line endings. */
export function daySheetCsv(meta: DaySheetMeta, rows: readonly DaySheetRow[]): string {
  const lines = [
    ["Organization", meta.organizationName],
    ["Day", meta.dayLabel],
    ["Timezone", meta.timezone],
    ["Generated", meta.generatedLabel],
    [],
    DAY_SHEET_COLUMNS.map((c) => c.header),
    ...rows.map((r) => DAY_SHEET_COLUMNS.map((c) => r[c.key])),
  ];
  return lines.map((cells) => cells.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** "<safe-org-name>-day-sheet-YYYY-MM-DD.csv" (lowercase ASCII, dashes); falls back to "nemryn-day-sheet-...". */
export function daySheetFilename(organizationName: string, dateKey: string): string {
  const slug = organizationName
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "nemryn"}-day-sheet-${dateKey}.csv`;
}

export type DaySheetDay = "today" | "tomorrow";
export function parseDaySheetDay(value: unknown): DaySheetDay {
  return value === "tomorrow" ? "tomorrow" : "today";
}
