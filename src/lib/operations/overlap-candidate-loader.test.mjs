// Unit tests for paginated overlap candidate retrieval (P1-OPS-PROG4B-R1).
//   node --test src/lib/operations/overlap-candidate-loader.test.mjs
// The loader runs against an in-memory PostgREST stand-in that applies the same filters, the keyset `or`
// predicate, ordering, `limit` and a `max_rows` cap -- so these tests exercise the real query composition.
import test from "node:test";
import assert from "node:assert/strict";

const { collectKeysetPages, collectIdPages, keysetAfterFilter, loadOverlapCandidates, OVERLAP_CANDIDATE_PAGE_SIZE, OVERLAP_CANDIDATE_MAX_PAGES } =
  await import("./overlap-candidate-loader.ts");
const { deriveResourceOverlap, OVERLAP_LOOKBACK_MS } = await import("./trip-overlap-core.ts");

// ---------------------------------------------------------------------------
// In-memory PostgREST stand-in
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000; // supabase/config.toml

function fakeClient(trips, log = []) {
  return {
    from(table) {
      assert.equal(table, "trips");
      const filters = [];
      let inner = false;
      let columns = "";
      let pickupIsNull = false;
      let limit = Infinity;
      const orders = [];
      const builder = {
        select(cols) {
          columns = cols;
          inner = cols.includes("!inner");
          return builder;
        },
        eq(col, v) {
          filters.push((r) => r[col] === v);
          return builder;
        },
        in(col, vs) {
          filters.push((r) => vs.includes(r[col]));
          return builder;
        },
        gte(col, v) {
          filters.push((r) => r[col] !== null && Date.parse(r[col]) >= Date.parse(v));
          return builder;
        },
        lt(col, v) {
          filters.push((r) => r[col] !== null && Date.parse(r[col]) < Date.parse(v));
          return builder;
        },
        is(col, v) {
          assert.equal(v, null);
          if (col === "scheduled_pickup_at") {
            pickupIsNull = true;
            filters.push((r) => r.scheduled_pickup_at === null);
          }
          else assert.equal(col, "trip_assignments.ended_at");
          return builder;
        },
        gt(col, v) {
          assert.equal(col, "id");
          filters.push((r) => r.id > v);
          return builder;
        },
        or(expr) {
          const m = expr.match(/^scheduled_pickup_at\.gt\."([^"]+)",and\(scheduled_pickup_at\.eq\."([^"]+)",id\.gt\."([^"]+)"\)$/);
          assert.ok(m, `unexpected keyset filter: ${expr}`);
          const at = Date.parse(m[1]);
          const id = m[3];
          filters.push((r) => Date.parse(r.scheduled_pickup_at) > at || (Date.parse(r.scheduled_pickup_at) === at && r.id > id));
          return builder;
        },
        order(col) {
          orders.push(col);
          return builder;
        },
        limit(n) {
          limit = n;
          return builder;
        },
        then(resolve, reject) {
          try {
            const scheduleless = pickupIsNull;
            if (scheduleless) {
              assert.deepEqual(orders, ["id"], "Family C pages by id");
            } else {
              assert.deepEqual(orders, ["scheduled_pickup_at", "id"], "pagination needs a total order");
            }
            let rows = trips
              .map((t) => ({ ...t, trip_assignments: (t.trip_assignments ?? []).filter((a) => a.ended_at === null) }))
              .filter((r) => filters.every((f) => f(r)))
              .filter((r) => !inner || r.trip_assignments.length > 0);
            const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            rows.sort(scheduleless ? byId : (a, b) => Date.parse(a.scheduled_pickup_at) - Date.parse(b.scheduled_pickup_at) || byId(a, b));
            if (scheduleless) {
              // Family C must not ask for route / passenger detail.
              assert.doesNotMatch(columns, /pickup_description|destination_description|passenger/);
              assert.ok(inner, "Family C inner-joins the active assignment");
            }
            rows = rows.slice(0, Math.min(limit, MAX_ROWS));
            log.push({ inner, scheduleless, returned: rows.length });
            resolve({ data: rows, error: null });
          } catch (e) {
            reject(e);
          }
        },
      };
      return builder;
    },
  };
}

const ORG = "org-a";
const OTHER_ORG = "org-b";
const DAY0 = Date.parse("2026-10-10T04:00:00.000Z"); // tomorrow start (New York)
const DAY1 = DAY0 + 86_400_000;
const at = (ms) => new Date(ms).toISOString();
let seq = 0;
const trip = (startMs, extra = {}) => ({
  id: `t${String(++seq).padStart(6, "0")}`,
  organization_id: ORG,
  state: "scheduled",
  scheduled_pickup_at: at(startMs),
  expected_duration_minutes: 30,
  pickup_description: "A",
  destination_description: "B",
  trip_assignments: [{ driver_id: "filler-driver", vehicle_id: null, ended_at: null }],
  ...extra,
});
const load = (trips, opts = {}, log) =>
  loadOverlapCandidates(fakeClient(trips, log), ORG, DAY0, DAY1, { lookbackMs: OVERLAP_LOOKBACK_MS, ...opts });

// Fillers ordered BEFORE a given time so a relevant trip lands on a later page.
const fillers = (n, beforeMs) => Array.from({ length: n }, (_, i) => trip(beforeMs - (n - i) * 1000));

// ---------------------------------------------------------------------------
// collectKeysetPages (pure)
// ---------------------------------------------------------------------------

function pagedSource(total) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, scheduled_pickup_at: at(DAY0 + i * 1000) }));
  const calls = [];
  const fetchPage = async (cursor, size) => {
    calls.push(cursor);
    const start = cursor ? all.findIndex((r) => r.id === cursor.id) + 1 : 0;
    return all.slice(start, start + size);
  };
  return { all, calls, fetchPage };
}

test("R1-A: fewer rows than the page size -> one page, complete", async () => {
  const src = pagedSource(3);
  const r = await collectKeysetPages(src.fetchPage, { pageSize: 5, maxPages: 4 });
  assert.equal(r.complete, true);
  assert.equal(r.rows.length, 3);
  assert.equal(src.calls.length, 1);
});

test("R1-B: exactly the page size -> the next page is read and proves completeness", async () => {
  const src = pagedSource(5);
  const r = await collectKeysetPages(src.fetchPage, { pageSize: 5, maxPages: 4 });
  assert.equal(r.complete, true);
  assert.equal(r.rows.length, 5);
  assert.equal(src.calls.length, 2);
  assert.deepEqual(src.calls[1], { scheduledPickupAt: src.all[4].scheduled_pickup_at, id: src.all[4].id });
});

test("R1-C: more than one page -> every row exactly once, in order", async () => {
  const src = pagedSource(13);
  const r = await collectKeysetPages(src.fetchPage, { pageSize: 5, maxPages: 4 });
  assert.equal(r.complete, true);
  assert.equal(r.pages, 3);
  assert.deepEqual(r.rows.map((x) => x.id), src.all.map((x) => x.id));
});

test("R1-G: safety ceiling reached -> incomplete, never silently complete", async () => {
  const exact = pagedSource(20); // exactly maxPages × pageSize: more rows cannot be ruled out
  const r1 = await collectKeysetPages(exact.fetchPage, { pageSize: 5, maxPages: 4 });
  assert.equal(r1.complete, false);
  assert.equal(r1.rows.length, 20);
  const more = pagedSource(40);
  const r2 = await collectKeysetPages(more.fetchPage, { pageSize: 5, maxPages: 4 });
  assert.equal(r2.complete, false);
  assert.equal(more.calls.length, 4);
});

test("keyset predicate quotes timestamp values and orders by (scheduled_pickup_at, id)", () => {
  assert.equal(
    keysetAfterFilter({ scheduledPickupAt: "2026-10-10T13:00:00+00:00", id: "abc" }),
    'scheduled_pickup_at.gt."2026-10-10T13:00:00+00:00",and(scheduled_pickup_at.eq."2026-10-10T13:00:00+00:00",id.gt."abc")',
  );
});

test("defaults: page size stays within max_rows; ceiling is explicit", () => {
  assert.ok(OVERLAP_CANDIDATE_PAGE_SIZE <= MAX_ROWS);
  assert.equal(OVERLAP_CANDIDATE_PAGE_SIZE * OVERLAP_CANDIDATE_MAX_PAGES, 10_000);
});

// ---------------------------------------------------------------------------
// loadOverlapCandidates (query composition through the stand-in)
// ---------------------------------------------------------------------------

const TARGET_START = DAY0 + 10 * 3_600_000;
const target = { tripId: null, scheduledPickupAt: at(TARGET_START), expectedDurationMinutes: 60, driverId: "d1", vehicleId: "v1" };

test("R1: previous single-request behaviour would miss rows beyond max_rows; the loader does not", async () => {
  seq = 0;
  const trips = [...fillers(1500, TARGET_START), trip(TARGET_START + 15 * 60_000, { trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] })];
  const log = [];
  const set = await load(trips, {}, log);
  assert.equal(set.coverage, "complete");
  assert.equal(set.candidates.length, trips.length);
  assert.ok(log.every((c) => c.returned <= OVERLAP_CANDIDATE_PAGE_SIZE));
  assert.equal(deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage).driver.status, "overlap");
});

test("R1-D: relevant DRIVER candidate on a later page -> overlap detected", async () => {
  seq = 0;
  const relevant = trip(TARGET_START + 30 * 60_000, { trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const set = await load([...fillers(7, TARGET_START), relevant], { pageSize: 3 });
  assert.equal(set.diagnostics.windowPages, 3);
  assert.equal(set.coverage, "complete");
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.driver.status, "overlap");
  assert.deepEqual(r.driver.overlaps, [relevant.id]);
});

test("R1-E: relevant VEHICLE candidate on a later page -> overlap detected", async () => {
  seq = 0;
  const relevant = trip(TARGET_START + 30 * 60_000, { trip_assignments: [{ driver_id: "d9", vehicle_id: "v1", ended_at: null }] });
  const set = await load([...fillers(7, TARGET_START), relevant], { pageSize: 3 });
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.vehicle.status, "overlap");
  assert.deepEqual(r.vehicle.overlaps, [relevant.id]);
  assert.equal(r.driver.status, "clear");
});

test("R1-F: older still-open candidate on a later page -> not_fully_checkable", async () => {
  seq = 0;
  const old = DAY0 - OVERLAP_LOOKBACK_MS - 10 * 86_400_000;
  const oldFillers = Array.from({ length: 7 }, (_, i) => trip(old + i * 1000));
  const stillOpen = trip(old + 3_600_000, { state: "passenger_onboard", trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const set = await load([...oldFillers, stillOpen], { pageSize: 3 });
  assert.equal(set.diagnostics.stillOpenPages, 3);
  const r = deriveResourceOverlap(target, set.candidates, DAY0, set.coverage);
  assert.equal(r.driver.status, "not_fully_checkable");
  assert.deepEqual(r.driver.stillOpenPastPlannedEnd, [stillOpen.id]);
  assert.equal(r.driver.candidateSetIncomplete, false);
});

test("R1-G/H: ceiling reached in either family -> coverage incomplete -> never clear", async () => {
  seq = 0;
  const windowHeavy = await load(fillers(9, TARGET_START), { pageSize: 3, maxPages: 3 });
  assert.equal(windowHeavy.coverage, "incomplete");
  assert.equal(windowHeavy.diagnostics.windowComplete, false);
  const r = deriveResourceOverlap(target, windowHeavy.candidates, DAY0 - 86_400_000, windowHeavy.coverage);
  assert.equal(r.driver.status, "not_fully_checkable");
  assert.equal(r.vehicle.status, "not_fully_checkable");

  seq = 0;
  const old = DAY0 - OVERLAP_LOOKBACK_MS - 86_400_000;
  const olderHeavy = await load(Array.from({ length: 9 }, (_, i) => trip(old + i * 1000, { expected_duration_minutes: null })), { pageSize: 3, maxPages: 3 });
  assert.equal(olderHeavy.diagnostics.windowComplete, true);
  assert.equal(olderHeavy.diagnostics.stillOpenComplete, false);
  assert.equal(olderHeavy.coverage, "incomplete");
  assert.equal(deriveResourceOverlap(target, olderHeavy.candidates, DAY0, olderHeavy.coverage).driver.status, "not_fully_checkable");
});

test("R1-I: incomplete coverage keeps a known overlap found in the read pages", async () => {
  seq = 0;
  const relevant = trip(TARGET_START - 1000, { expected_duration_minutes: 30, trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const set = await load([...fillers(3, TARGET_START - 1000), relevant, ...fillers(20, TARGET_START + 3 * 3_600_000)], { pageSize: 2, maxPages: 3 });
  assert.equal(set.coverage, "incomplete");
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.driver.status, "overlap");
  assert.equal(r.driver.candidateSetIncomplete, true);
});

test("R1-J: pagination never crosses the organization boundary", async () => {
  seq = 0;
  const foreign = Array.from({ length: 10 }, (_, i) =>
    trip(TARGET_START + i * 60_000, { organization_id: OTHER_ORG, trip_assignments: [{ driver_id: "d1", vehicle_id: "v1", ended_at: null }] }),
  );
  const own = fillers(5, TARGET_START);
  const set = await load([...foreign, ...own], { pageSize: 2 });
  assert.equal(set.candidates.length, own.length);
  assert.ok(set.candidates.every((c) => own.some((t) => t.id === c.tripId)));
  assert.equal(deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage).driver.status, "clear");
});

test("terminal trips and ended assignments are never candidates; ties on start are paged by id", async () => {
  seq = 0;
  const same = TARGET_START + 5 * 60_000;
  const tied = Array.from({ length: 5 }, () => trip(same));
  const terminal = trip(same, { state: "completed", trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const ended = trip(same, { trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: at(DAY0) }] });
  const set = await load([...tied, terminal, ended], { pageSize: 2 });
  assert.deepEqual(set.candidates.map((c) => c.tripId).sort(), [...tied.map((t) => t.id), ended.id].sort());
  assert.equal(set.candidates.find((c) => c.tripId === ended.id).activeDriverId, null);
});

// ---------------------------------------------------------------------------
// P1-OPS-PROG4B-R2: Family C -- non-terminal trips with NO pickup time and an ACTIVE assignment
// ---------------------------------------------------------------------------

const pickupless = (extra = {}) => trip(0, { scheduled_pickup_at: null, expected_duration_minutes: null, ...extra });

test("R2-11/12/13: Family C returns pickup-less ACTIVE assigned trips; terminal and ended-assignment ones excluded", async () => {
  seq = 0;
  const active = pickupless({ trip_assignments: [{ driver_id: "d1", vehicle_id: "v1", ended_at: null }] });
  const terminal = pickupless({ state: "cancelled", trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const ended = pickupless({ trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: at(DAY0) }] });
  const unassigned = pickupless({ trip_assignments: [] });
  const set = await load([active, terminal, ended, unassigned]);
  assert.deepEqual(set.candidates.map((c) => c.tripId), [active.id]);
  assert.equal(set.candidates[0].scheduledPickupAt, null);
  assert.equal(set.candidates[0].activeDriverId, "d1");
  assert.equal(set.candidates[0].activeVehicleId, "v1");
  assert.equal(set.details.has(active.id), false, "no route detail fetched or kept for Family C");
  assert.equal(set.coverage, "complete");
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.driver.status, "not_checkable");
  assert.equal(r.vehicle.status, "not_checkable");
  assert.deepEqual(r.driver.missingSchedule, [active.id]);
});

test("R2-14/18: Family C multi-page pagination by id -- every row exactly once, deterministic", async () => {
  seq = 0;
  const rows = Array.from({ length: 7 }, () => pickupless({ trip_assignments: [{ driver_id: "d9", vehicle_id: null, ended_at: null }] }));
  const shuffled = [rows[4], rows[0], rows[6], rows[2], rows[1], rows[5], rows[3]];
  const log = [];
  const set = await load(shuffled, { pageSize: 3 }, log);
  assert.equal(set.diagnostics.schedulelessPages, 3);
  assert.equal(set.diagnostics.schedulelessComplete, true);
  assert.deepEqual(set.candidates.map((c) => c.tripId), rows.map((t) => t.id));
  assert.equal(new Set(set.candidates.map((c) => c.tripId)).size, 7);
  const again = await load([...shuffled].reverse(), { pageSize: 3 });
  assert.deepEqual(again.candidates.map((c) => c.tripId), set.candidates.map((c) => c.tripId));
});

test("R2-15: exactly one full Family C page causes the next read", async () => {
  seq = 0;
  const rows = Array.from({ length: 3 }, () => pickupless({ trip_assignments: [{ driver_id: "d9", vehicle_id: null, ended_at: null }] }));
  const log = [];
  const set = await load(rows, { pageSize: 3 }, log);
  assert.equal(set.diagnostics.schedulelessPages, 2);
  assert.deepEqual(log.filter((c) => c.scheduleless).map((c) => c.returned), [3, 0]);
  assert.equal(set.coverage, "complete");
});

test("R2-16: Family C safety ceiling -> coverage incomplete -> never clear", async () => {
  seq = 0;
  const rows = Array.from({ length: 9 }, () => pickupless({ trip_assignments: [{ driver_id: "d9", vehicle_id: null, ended_at: null }] }));
  const set = await load(rows, { pageSize: 3, maxPages: 3 });
  assert.equal(set.diagnostics.windowComplete, true);
  assert.equal(set.diagnostics.stillOpenComplete, true);
  assert.equal(set.diagnostics.schedulelessComplete, false);
  assert.equal(set.coverage, "incomplete");
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.driver.status, "not_fully_checkable", "d1 has nothing in the read pages, but the set is incomplete");
  assert.equal(r.driver.candidateSetIncomplete, true);
});

test("R2-17: Family C never crosses the organization boundary", async () => {
  seq = 0;
  const foreign = Array.from({ length: 4 }, () => pickupless({ organization_id: OTHER_ORG, trip_assignments: [{ driver_id: "d1", vehicle_id: "v1", ended_at: null }] }));
  const set = await load(foreign, { pageSize: 2 });
  assert.equal(set.candidates.length, 0);
  const r = deriveResourceOverlap(target, set.candidates, DAY0 - 86_400_000, set.coverage);
  assert.equal(r.driver.status, "clear");
});

test("R2-19: Families A / B unchanged when pickup-less trips are present", async () => {
  seq = 0;
  const relevant = trip(TARGET_START + 30 * 60_000, { trip_assignments: [{ driver_id: "d1", vehicle_id: null, ended_at: null }] });
  const old = trip(DAY0 - OVERLAP_LOOKBACK_MS - 86_400_000, { state: "passenger_onboard", trip_assignments: [{ driver_id: "d7", vehicle_id: null, ended_at: null }] });
  const extra = Array.from({ length: 5 }, () => pickupless({ trip_assignments: [{ driver_id: "d8", vehicle_id: null, ended_at: null }] }));
  const set = await load([...fillers(7, TARGET_START), relevant, old, ...extra], { pageSize: 3 });
  assert.equal(set.diagnostics.windowRows, 8);
  assert.equal(set.diagnostics.windowPages, 3);
  assert.equal(set.diagnostics.stillOpenRows, 1);
  assert.equal(set.diagnostics.schedulelessRows, 5);
  const r = deriveResourceOverlap(target, set.candidates, DAY0, set.coverage);
  assert.equal(r.driver.status, "overlap");
  assert.deepEqual(r.driver.missingSchedule, [], "d8's pickup-less trips do not affect d1");
});

test("collectIdPages: stops on a short page; ceiling reports incomplete", async () => {
  const ids = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}` }));
  const fetchPage = async (afterId, size) => ids.filter((r) => afterId === null || r.id > afterId).slice(0, size);
  assert.deepEqual(await collectIdPages(fetchPage, { pageSize: 2, maxPages: 5 }), { rows: ids, complete: true, pages: 3 });
  const capped = await collectIdPages(fetchPage, { pageSize: 2, maxPages: 2 });
  assert.equal(capped.complete, false);
});
