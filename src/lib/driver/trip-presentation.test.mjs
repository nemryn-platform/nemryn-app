// Driver trip presentation: current leg, in-progress states and Driver Today ordering (NP-DRIVER-UX-02). Run with:
//
//   node --test src/lib/driver/trip-presentation.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const {
  currentLeg,
  DRIVER_NEXT_ACTION,
  DRIVER_IN_PROGRESS_STATES,
  ELIGIBLE_LOCATION_TRACKING_STATES,
  isTripInProgress,
  selectTodayTrips,
  ADDRESS_MISSING_MESSAGE,
} = await import("./trip-presentation.ts");

const TZ = "America/New_York";

test("pickup states navigate to the PICKUP, post-boarding states to the DROP-OFF, terminal states to nothing", () => {
  assert.equal(currentLeg("scheduled"), "pickup");
  assert.equal(currentLeg("en_route_to_pickup"), "pickup");
  assert.equal(currentLeg("arrived_at_pickup"), "pickup");
  assert.equal(currentLeg("passenger_onboard"), "destination");
  assert.equal(currentLeg("en_route_to_destination"), "destination");
  assert.equal(currentLeg("arrived_at_destination"), "destination");
  for (const s of ["completed", "cancelled", "no_show", "", "unknown_state"]) assert.equal(currentLeg(s), "none");
});

test("every lifecycle step's target state keeps the right leg (the leg flips exactly at Passenger Onboard)", () => {
  const order = ["scheduled", "en_route_to_pickup", "arrived_at_pickup", "passenger_onboard", "en_route_to_destination", "arrived_at_destination"];
  for (const s of order) assert.equal(DRIVER_NEXT_ACTION[s].targetState, order[order.indexOf(s) + 1] ?? "completed");
  assert.equal(currentLeg(DRIVER_NEXT_ACTION.arrived_at_pickup.targetState), "destination");
  assert.equal(currentLeg(DRIVER_NEXT_ACTION.en_route_to_pickup.targetState), "pickup");
});

test("in-progress = the five states between Start and Complete (same set as location tracking)", () => {
  assert.deepEqual([...DRIVER_IN_PROGRESS_STATES].sort(), [...ELIGIBLE_LOCATION_TRACKING_STATES].sort());
  assert.equal(isTripInProgress("scheduled"), false);
  assert.equal(isTripInProgress("completed"), false);
  assert.equal(isTripInProgress("en_route_to_destination"), true);
});

test("missing-address copy is the approved wording", () => {
  assert.equal(ADDRESS_MISSING_MESSAGE, "Address missing — contact dispatch.");
});

// 2026-11-01 15:00 UTC = 11:00 America/New_York
const NOW = new Date("2026-11-01T15:00:00Z");
const t = (id, state, at) => ({ id, state, scheduledPickupAt: at });

test("Today: an in-progress trip comes first even when an earlier-scheduled trip has not started", () => {
  const out = selectTodayTrips([t("early", "scheduled", "2026-11-01T13:30:00Z"), t("active", "en_route_to_destination", "2026-11-01T14:30:00Z")], NOW, TZ);
  assert.deepEqual(out.map((x) => x.id), ["active", "early"]);
});

test("Today: in-progress trips from a PREVIOUS day and with NO time are included, first", () => {
  const out = selectTodayTrips([
    t("today", "scheduled", "2026-11-01T16:00:00Z"),
    t("yesterday-active", "passenger_onboard", "2026-11-01T03:30:00Z"), // 23:30 Oct 31 local
    t("untimed-active", "arrived_at_pickup", null),
  ], NOW, TZ);
  assert.deepEqual(out.map((x) => x.id), ["yesterday-active", "untimed-active", "today"]);
});

test("Today: not-started trips appear only on today's organization-local date; untimed not-started stay off Today", () => {
  const out = selectTodayTrips([
    t("yesterday-scheduled", "scheduled", "2026-10-31T15:00:00Z"),
    t("tomorrow", "scheduled", "2026-11-02T15:00:00Z"),
    t("untimed", "scheduled", null),
    t("late-today-local", "scheduled", "2026-11-02T03:30:00Z"), // 22:30 Nov 1 local
    t("bad-date", "scheduled", "not-a-date"),
  ], NOW, TZ);
  assert.deepEqual(out.map((x) => x.id), ["late-today-local"]);
});

test("Today: any state that is not in progress follows the today-only rule (unchanged from before; the RPC lists active assignments only)", () => {
  const out = selectTodayTrips([t("other-day", "completed", "2026-10-30T14:00:00Z"), t("untimed", "cancelled", null), t("today", "scheduled", "2026-11-01T14:00:00Z")], NOW, TZ);
  assert.deepEqual(out.map((x) => x.id), ["today"]);
});

test("Today: ordering within groups is by time, untimed last, stable on ties; input is not mutated", () => {
  const input = [
    t("a2", "en_route_to_pickup", "2026-11-01T14:00:00Z"),
    t("a1", "en_route_to_pickup", "2026-11-01T13:00:00Z"),
    t("a-untimed", "arrived_at_destination", null),
    t("s2", "scheduled", "2026-11-01T18:00:00Z"),
    t("s1", "scheduled", "2026-11-01T17:00:00Z"),
    t("s1-tie", "scheduled", "2026-11-01T17:00:00Z"),
  ];
  const snapshot = JSON.stringify(input);
  assert.deepEqual(selectTodayTrips(input, NOW, TZ).map((x) => x.id), ["a1", "a2", "a-untimed", "s1", "s1-tie", "s2"]);
  assert.equal(JSON.stringify(input), snapshot);
});
