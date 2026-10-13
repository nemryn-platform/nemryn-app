// P1-PILOT-UX1 -- Day Sheet pure core + header Help / bell role rules. Run with:
//
//   node --test src/lib/operations/day-sheet-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { buildDaySheetRows, sortDaySheetTrips, csvField, daySheetCsv, daySheetFilename, parseDaySheetDay, DAY_SHEET_COLUMNS } =
  await import("./day-sheet-core.ts");
const { helpLinksFor, canViewNotificationHistory } = await import("./header-help-core.ts");

const TZ = "America/New_York";
const trip = (over) => ({
  scheduledPickupAt: "2026-09-29T13:00:00.000Z",
  appointmentAt: null,
  passengerName: "SIM Passenger",
  pickupDescription: "12 Oak St",
  destinationDescription: "Clinic",
  driverName: "SIM Driver A",
  vehicleLabel: "SIM Van A",
  statusLabel: "Assigned",
  requiresWheelchairAccess: null,
  ...over,
});

test("rows: org-local times; appointment only when present; unassigned / no vehicle / wheelchair facts", () => {
  const rows = buildDaySheetRows(
    [
      trip({ appointmentAt: "2026-09-29T14:00:00.000Z", requiresWheelchairAccess: true }),
      trip({ scheduledPickupAt: "2026-09-29T12:15:00.000Z", driverName: null, vehicleLabel: null, statusLabel: "Unassigned", requiresWheelchairAccess: false, passengerName: "B" }),
    ],
    TZ,
  );
  assert.deepEqual(rows[0], {
    pickupTime: "8:15 AM", appointmentTime: "", passenger: "B", pickup: "12 Oak St", destination: "Clinic",
    driver: "Unassigned", vehicle: "", status: "Unassigned", wheelchair: "No",
  });
  assert.equal(rows[1].pickupTime, "9:00 AM");
  assert.equal(rows[1].appointmentTime, "10:00 AM");
  assert.equal(rows[1].wheelchair, "Yes");
  assert.equal(buildDaySheetRows([trip({})], TZ)[0].wheelchair, "");
});

test("sorting: pickup ascending, pickup-less last, ties by passenger", () => {
  const sorted = sortDaySheetTrips([
    trip({ scheduledPickupAt: null, passengerName: "Z" }),
    trip({ scheduledPickupAt: "2026-09-29T15:00:00Z", passengerName: "C" }),
    trip({ scheduledPickupAt: "2026-09-29T13:00:00Z", passengerName: "B" }),
    trip({ scheduledPickupAt: "2026-09-29T13:00:00Z", passengerName: "A" }),
  ]);
  assert.deepEqual(sorted.map((t) => t.passengerName), ["A", "B", "C", "Z"]);
  assert.equal(buildDaySheetRows([trip({ scheduledPickupAt: null })], TZ)[0].pickupTime, "No pickup time");
});

test("timezone: the same instant renders in the organization's zone", () => {
  assert.equal(buildDaySheetRows([trip({ scheduledPickupAt: "2026-09-29T13:00:00Z" })], "America/Los_Angeles")[0].pickupTime, "6:00 AM");
});

test("CSV: commas, quotes and newlines escaped (RFC 4180)", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a, b"), '"a, b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
});

test("CSV: formula-looking values are neutralized (CSV / formula injection)", () => {
  assert.equal(csvField("=HYPERLINK(\"http://x\",\"Click\")"), '"\'=HYPERLINK(""http://x"",""Click"")"');
  assert.equal(csvField("+1 555 0100"), "'+1 555 0100");
  assert.equal(csvField("-2+3"), "'-2+3");
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField("\t=1"), "'\t=1");
  assert.equal(csvField("\r=1"), '"\'\r=1"');
  // Ordinary values -- including ones that merely CONTAIN these characters -- are unchanged.
  assert.equal(csvField("9:00 AM"), "9:00 AM");
  assert.equal(csvField("Apt 4-B"), "Apt 4-B");
  assert.equal(csvField("a@b.example"), "a@b.example");
  assert.equal(csvField(""), "");
  const meta = { organizationName: "=Org", dayLabel: "Day", dateKey: "2026-09-29", timezone: TZ, generatedLabel: "now" };
  const csv = daySheetCsv(meta, buildDaySheetRows([trip({ passengerName: "=cmd|' /C calc'!A0", pickupDescription: "@x" })], TZ));
  assert.ok(csv.startsWith("Organization,'=Org\r\n"));
  const tripLine = csv.split("\r\n")[6];
  assert.ok(tripLine.includes(",'@x,"), tripLine);
  assert.ok(tripLine.includes("'=cmd|' /C calc'!A0"), tripLine);
});

test("CSV document: header facts, column row, one line per trip; zero-trip day = headers only", () => {
  const meta = { organizationName: "Acme, NEMT", dayLabel: "Tuesday, September 29, 2026", dateKey: "2026-09-29", timezone: TZ, generatedLabel: "Sep 28, 2026, 5:40 PM" };
  const csv = daySheetCsv(meta, buildDaySheetRows([trip({ pickupDescription: 'Apt 4, "rear"' })], TZ));
  const lines = csv.split("\r\n");
  assert.equal(lines[0], 'Organization,"Acme, NEMT"');
  assert.equal(lines[1], 'Day,"Tuesday, September 29, 2026"');
  assert.equal(lines[2], `Timezone,${TZ}`);
  assert.equal(lines[5], DAY_SHEET_COLUMNS.map((c) => c.header).join(","));
  assert.ok(lines[6].includes('"Apt 4, ""rear"""'));
  const empty = daySheetCsv(meta, []).trimEnd().split("\r\n");
  assert.equal(empty.length, 6);
  assert.equal(empty[5], DAY_SHEET_COLUMNS.map((c) => c.header).join(","));
});

test("data minimization: only the approved columns exist; no ids / phones / notes", () => {
  assert.deepEqual(DAY_SHEET_COLUMNS.map((c) => c.key), ["pickupTime", "appointmentTime", "passenger", "pickup", "destination", "driver", "vehicle", "status", "wheelchair"]);
  const row = buildDaySheetRows([{ ...trip({}), id: "trip-uuid", passengerPhone: "555", assistanceNotes: "private", instructions: "gate" }], TZ)[0];
  assert.equal(Object.keys(row).length, 9);
  assert.doesNotMatch(JSON.stringify(row), /trip-uuid|555|private|gate/);
});

test("filename + day parsing", () => {
  assert.equal(daySheetFilename("Nemryn Pilot Simulation", "2026-09-29"), "nemryn-pilot-simulation-day-sheet-2026-09-29.csv");
  assert.equal(daySheetFilename("Café & Co.", "2026-09-29"), "cafe-co-day-sheet-2026-09-29.csv");
  assert.equal(daySheetFilename("※※", "2026-09-29"), "nemryn-day-sheet-2026-09-29.csv");
  assert.equal(parseDaySheetDay("tomorrow"), "tomorrow");
  assert.equal(parseDaySheetDay("today"), "today");
  assert.equal(parseDaySheetDay("yesterday"), "today");
  assert.equal(parseDaySheetDay(undefined), "today");
});

test("Help: role-aware links; Admin-only settings never offered to a Dispatcher; nothing for Drivers", () => {
  const admin = helpLinksFor("organization_admin").map((l) => l.href);
  const dispatcher = helpLinksFor("dispatcher").map((l) => l.href);
  assert.deepEqual(dispatcher, ["/operations/requests", "/operations/tomorrow", "/operations/dispatch", "/operations/recurring-care"]);
  for (const href of ["/operations/settings/website-requests", "/operations/settings/team", "/operations/settings/notifications"]) {
    assert.ok(admin.includes(href), href);
    assert.ok(!dispatcher.includes(href), href);
  }
  assert.deepEqual(helpLinksFor("driver"), []);
  assert.ok(!JSON.stringify(helpLinksFor("organization_admin")).includes("mailto"), "no invented support contact");
});

test("bell: only for the role that can read the existing history", () => {
  assert.equal(canViewNotificationHistory("organization_admin"), true);
  assert.equal(canViewNotificationHistory("dispatcher"), false);
  assert.equal(canViewNotificationHistory("driver"), false);
});
