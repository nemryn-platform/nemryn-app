// NP-UI-QA2 core-trips-dispatch -- Trips list + filters, New Trip (validation + creation), Trip Detail (edit / correction,
// add note, assign + reassign, cancel), Dispatch Board (today / tomorrow, Needs Assignment queue, assignment dialog by
// keyboard), Tomorrow Readiness, Day Sheet print, role + tenant boundaries, axe and widths. Trip -> Dispatch workflow
// end to end with database outcome checks. ISOLATED stack + fictional seed only.
import { suite, ORG_A, STAMP, one, at, sleep, waitFor, go, path, text, mainText, has, h1s, controls, click, setField, dialogOpen, dialogText, comboPick, key, axe, shot, overflowX, userId } from "./_qa2.mjs";

const t = suite("core-trips-dispatch");
const D1 = "30000000-0000-0000-0000-0000000000a1"; // Fictional Driver A1
const D2 = "30000000-0000-0000-0000-0000000000a2";
const V1 = "50000000-0000-0000-0000-0000000000a1";
const V2 = "50000000-0000-0000-0000-0000000000a2";

try {
  t.section("fixtures (fictional, isolated): one passenger, an unassigned trip later today and an unassigned trip tomorrow");
  const PAX = `QA2 Trip Rider ${STAMP}`;
  const pax = one(`insert into passengers (organization_id, display_name, status) values ('${ORG_A}', '${PAX}', 'active') returning id`);
  const mk = (day, hm, pickup, dest) => one(`insert into trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description, destination_description) values ('${ORG_A}', '${pax}', 'scheduled', ${at(day, hm)}, '${pickup}', '${dest}') returning id`);
  const TODAY = mk(0, "23:15", `QA2 today pickup ${STAMP}`, "QA2 today clinic");
  const TOMORROW = mk(1, "10:00", `QA2 tomorrow pickup ${STAMP}`, "QA2 tomorrow clinic");
  const active = (trip) => one(`select coalesce(string_agg(driver_id||'/'||coalesce(vehicle_id::text,'-'),','),'') from trip_assignments where trip_id='${trip}' and ended_at is null`);

  const s = await t.open("dispatcher", "org-a-dispatcher@example.test");

  t.section("Trips list + filters");
  await go(s, `/operations/trips?q=${encodeURIComponent(STAMP)}`);
  let mt = await mainText(s);
  t.check("T1 Trips list: one h1; search finds both fixture trips by pickup text", (await h1s(s)).length === 1 && mt.includes(`QA2 today pickup ${STAMP}`) && mt.includes(`QA2 tomorrow pickup ${STAMP}`), JSON.stringify(await h1s(s)));
  await go(s, `/operations/trips?q=${encodeURIComponent(STAMP)}&date=today`);
  mt = await mainText(s);
  t.check("T2 date filter 'today' keeps today's fixture and drops tomorrow's", mt.includes(`QA2 today pickup ${STAMP}`) && !mt.includes(`QA2 tomorrow pickup ${STAMP}`));
  await go(s, `/operations/trips?q=${encodeURIComponent(STAMP)}&assignment=assigned`);
  t.check("T3 assignment filter 'assigned' hides the unassigned fixtures", !(await mainText(s)).includes(`QA2 today pickup ${STAMP}`));
  await go(s, `/operations/trips?q=${encodeURIComponent(STAMP)}`);
  const link = await s.evaluate(`(function(){const a=[...document.querySelectorAll('main a[href^="/operations/trips/"]')].find(x => /^\\/operations\\/trips\\/[0-9a-f-]{36}$/.test(x.getAttribute('href'))); return a ? a.getAttribute('href') : null;})()`);
  t.check("T4 rows link to Trip Detail (a real link per row)", !!link, link);
  t.check("T5 Trips list: 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));

  t.section("New Trip: validation + creation");
  const before = one(`select count(*) from trips where organization_id='${ORG_A}'`);
  await go(s, "/operations/trips/new");
  t.check("C1 New Trip: one h1 'New Trip'", JSON.stringify(await h1s(s)) === JSON.stringify(["New Trip"]), JSON.stringify(await h1s(s)));
  t.check("C2 New Trip form: 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));
  await s.evaluate(`(function(){const b=[...document.querySelectorAll('button[type="submit"]')].find(e => /Create Trip/.test(e.textContent)); b && b.click(); return !!b;})()`);
  await sleep(1500);
  t.check("C3 submitting an empty form creates no trip and stays on New Trip", one(`select count(*) from trips where organization_id='${ORG_A}'`) === before && (await path(s)).startsWith("/operations/trips/new"));
  t.check("C4 passenger search (combobox) selects the fixture passenger", await comboPick(s, PAX));
  await sleep(400);
  const day2 = one(`select ((now() at time zone 'America/New_York')::date + 2)::text`);
  await setField(s, 'input[name="pickupDate"]', day2);
  await setField(s, 'input[name="pickupTime"]', "08:45");
  await setField(s, 'textarea[name="pickupDescription"]', `QA2 new trip pickup ${STAMP}`);
  await setField(s, 'textarea[name="destinationDescription"]', "QA2 new trip clinic");
  await sleep(300);
  await s.evaluate(`(function(){const b=[...document.querySelectorAll('button[type="submit"]')].find(e => /Create Trip/.test(e.textContent)); b && b.click(); return !!b;})()`);
  await waitFor(() => one(`select count(*) from trips where pickup_description='QA2 new trip pickup ${STAMP}'`) === "1", 20000);
  await waitFor(async () => /^\/operations\/trips\/[0-9a-f-]{36}/.test(await path(s)), 15000);
  const NEW = one(`select id from trips where pickup_description='QA2 new trip pickup ${STAMP}'`);
  t.check("C5 creation writes one scheduled trip for the chosen passenger at the entered local time and opens its Trip Detail",
    one(`select state||'|'||passenger_id||'|'||(scheduled_pickup_at at time zone 'America/New_York')::text from trips where id='${NEW}'`).startsWith(`scheduled|${pax}|${day2} 08:45`) && (await path(s)).startsWith(`/operations/trips/${NEW}`), await path(s));

  t.section("Trip Detail: edit (correction), note, assignment, cancel");
  await go(s, `/operations/trips/${NEW}`);
  t.check("E1 Trip Detail: exactly one h1 ('Trip Detail'); the passenger is the record heading", JSON.stringify(await h1s(s)) === JSON.stringify(["Trip Detail"]) && (await mainText(s)).includes(PAX), JSON.stringify(await h1s(s)));
  t.check("E2 Trip Detail: 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));
  await click(s, "Edit Trip", "main", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'textarea[name="pickupDescription"]', `QA2 corrected pickup ${STAMP}`, "dialog");
  await sleep(200);
  await click(s, "Save", "dialog", "button");
  await waitFor(() => one(`select pickup_description from trips where id='${NEW}'`) === `QA2 corrected pickup ${STAMP}`, 15000);
  await waitFor(async () => !(await dialogOpen(s)), 8000);
  await sleep(800);
  t.check("E3 Edit Trip saves the correction (DB updated) and the page records it ('Details corrected by you')", one(`select pickup_description from trips where id='${NEW}'`) === `QA2 corrected pickup ${STAMP}` && (await has(s, '[data-testid="trip-last-correction"]')));
  await click(s, "Add Note", "main", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'textarea[name="body"]', `QA2 note ${STAMP}`, "dialog");
  await setField(s, 'select[name="visibility"]', "operations_only", "dialog");
  await click(s, "Add Note", "dialog", "button");
  await waitFor(() => one(`select count(*) from trip_notes where trip_id='${NEW}' and body='QA2 note ${STAMP}'`) === "1", 15000);
  await sleep(800);
  t.check("E4 Add Note (body + required visibility) writes an operations-only note and shows it on the trip", one(`select visibility from trip_notes where trip_id='${NEW}' and body='QA2 note ${STAMP}'`) === "operations_only" && (await waitFor(async () => (await mainText(s)).includes(`QA2 note ${STAMP}`), 8000)));
  await s.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim()==='Assign Driver').focus()`);
  await key(s, "Enter");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'select[name="driverId"]', D1, "dialog");
  await setField(s, 'select[name="vehicleId"]', V1, "dialog");
  await sleep(500);
  await click(s, "Assign Driver", "dialog", "button");
  await waitFor(() => active(NEW) === `${D1}/${V1}`, 15000);
  await sleep(800);
  t.check("A1 Assign Driver (keyboard-opened dialog) writes exactly one active assignment (driver + vehicle), attributed to the dispatcher",
    active(NEW) === `${D1}/${V1}` && one(`select assigned_by from trip_assignments where trip_id='${NEW}' and ended_at is null`) === userId("org-a-dispatcher@example.test"));
  await waitFor(async () => (await controls(s)).includes("Manage Assignment"), 10000);
  await click(s, "Manage Assignment", "main", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'select[name="driverId"]', D2, "dialog");
  await setField(s, 'textarea[name="reason"]', "QA2 reassignment", "dialog");
  await sleep(300);
  await click(s, "Confirm Reassignment", "dialog", "button");
  await waitFor(() => active(NEW).startsWith(D2), 15000);
  t.check("A2 reassignment keeps history (old ended, one active for the new driver)", active(NEW).startsWith(D2) && one(`select count(*) from trip_assignments where trip_id='${NEW}'`) === "2");
  await go(s, `/operations/trips/${NEW}`);
  await click(s, "Cancel Trip", "main", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'textarea[name="reason"]', "QA2 cancellation", "dialog");
  await click(s, "Cancel Trip", "dialog", "button");
  await waitFor(() => one(`select state from trips where id='${NEW}'`) === "cancelled", 15000);
  await sleep(800);
  t.check("X1 Cancel Trip with a reason -> cancelled; no Cancel / Assign actions remain", one(`select state from trips where id='${NEW}'`) === "cancelled" && !(await controls(s)).includes("Cancel Trip"), JSON.stringify(await controls(s)));

  t.section("Dispatch Board: today / tomorrow, Needs Assignment queue, assignment by keyboard");
  await go(s, "/operations/dispatch");
  t.check("B1 Dispatch: one h1 'Dispatch'; Export Day Sheet + New Trip; Today / Tomorrow switch", JSON.stringify(await h1s(s)) === JSON.stringify(["Dispatch"]) && (await controls(s)).includes("Export Day Sheet") && (await controls(s)).includes("New Trip") && (await has(s, '[data-testid="dispatch-day-switch"]')));
  t.check("B2 today's unassigned fixture is in the Needs Assignment queue", await has(s, `button[data-trip-id="${TODAY}"]`));
  t.check("B3 Dispatch (today): 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));
  await s.evaluate(`document.querySelector('button[data-trip-id="${TODAY}"]').focus()`);
  await key(s, "Enter");
  await waitFor(() => dialogOpen(s), 5000);
  t.check("B4 the queue's Assign opens the assignment dialog by keyboard", (await dialogText(s)).includes("Assign Driver"));
  await key(s, "Escape");
  await waitFor(async () => !(await dialogOpen(s)), 5000);
  await sleep(300);
  t.check("B5 Escape closes it, nothing written, focus returns to the queue button (U2)", active(TODAY) === "" && (await s.evaluate(`document.activeElement?.getAttribute('data-trip-id')`)) === TODAY);
  await s.evaluate(`document.querySelector('button[data-trip-id="${TODAY}"]').click()`);
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'select[name="driverId"]', D2, "dialog");
  await setField(s, 'select[name="vehicleId"]', V2, "dialog");
  await sleep(500);
  await click(s, "Assign Driver", "dialog", "button");
  await waitFor(() => active(TODAY) === `${D2}/${V2}`, 15000);
  await sleep(1500);
  t.check("B6 Dispatch assignment writes the assignment and the trip leaves the queue for the grid", active(TODAY) === `${D2}/${V2}` && (await s.evaluate(`!document.querySelector('[data-testid="dispatch-grid"]') || !!document.querySelector('[data-testid="dispatch-grid"] [data-trip-id="${TODAY}"]')`)));
  await go(s, "/operations/dispatch?day=tomorrow");
  t.check("B7 Tomorrow board lists tomorrow's unassigned fixture; the description says Tomorrow", (await has(s, `button[data-trip-id="${TOMORROW}"]`)) && /Tomorrow/.test(await s.evaluate(`document.querySelector('main [data-testid="page-header"] p')?.innerText ?? ''`)));
  await s.setViewport(1024, 800);
  await go(s, "/operations/dispatch");
  t.check("B8 1024px: Dispatch has no page-level horizontal overflow (the grid scrolls inside its own container)", (await overflowX(s)) <= 1, await overflowX(s));
  await s.setViewport(768, 1024);
  await go(s, "/operations/dispatch");
  t.check("B9 768px: Dispatch has no page-level horizontal overflow", (await overflowX(s)) <= 1, await overflowX(s));
  await s.setViewport(1440, 1000);

  t.section("Dispatch layout review (NP-UI-QA2-P2): capacity reachable, grid scroll contained, actions not clipped, keyboard");
  // a second unassigned trip today so the queue has an Assign action at every width
  const QTRIP = mk(0, "23:45", `QA2 layout pickup ${STAMP}`, "QA2 layout clinic");
  for (const [w, h] of [[1440, 900], [1024, 800], [768, 1024]]) {
    await s.setViewport(w, h);
    await go(s, "/operations/dispatch");
    const r = await s.evaluate(`(function(){
      const vw = window.innerWidth;
      const grid = document.querySelector('[data-testid="dispatch-grid"]');
      const cap = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Driver Capacity');
      const capCards = [...document.querySelectorAll('[data-testid="capacity-driver"]')];
      const assign = document.querySelector('button[data-trip-id="${QTRIP}"]');
      const inView = (e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= vw + 0.5 && b.width > 0; };
      const gs = grid ? getComputedStyle(grid) : null;
      return {
        overflow: document.documentElement.scrollWidth - vw,
        gridContained: !!grid && gs.overflowX === 'auto' && grid.getBoundingClientRect().right <= vw + 0.5,
        capacity: !!cap && cap.checkVisibility() && capCards.length > 0 && capCards.every(c => c.checkVisibility() && inView(c)),
        assignVisible: !!assign && assign.checkVisibility() && inView(assign),
        clipped: [...document.querySelectorAll('main button, main a')].filter(e => e.checkVisibility() && !e.closest('[data-testid="dispatch-grid"]') && !inView(e)).map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30)),
      };
    })()`);
    t.check(`L${w} Dispatch at ${w}px: no page overflow; grid scrolls inside its own container; Driver Capacity visible with every driver card; queue Assign visible; no clipped controls outside the grid`,
      r.overflow <= 1 && r.gridContained && r.capacity && r.assignVisible && r.clipped.length === 0, JSON.stringify(r));
    // keyboard: Tab from the day switch reaches the queue's Assign button; Enter opens; Escape returns focus
    await s.evaluate(`document.querySelector('[data-testid="dispatch-day-switch"] a[aria-current="page"]').focus()`);
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await key(s, "Tab");
      reached = (await s.evaluate(`document.activeElement?.getAttribute('data-trip-id')`)) !== null;
    }
    const target = await s.evaluate(`document.activeElement?.getAttribute('data-trip-id')`);
    await key(s, "Enter");
    const opened = await waitFor(() => dialogOpen(s), 5000);
    await key(s, "Escape");
    await waitFor(async () => !(await dialogOpen(s)), 5000);
    await sleep(300);
    t.check(`K${w} Dispatch at ${w}px keyboard: Tab reaches a queue Assign button, Enter opens the assignment dialog, Escape returns focus to it`,
      reached && opened && (await s.evaluate(`document.activeElement?.getAttribute('data-trip-id')`)) === target, `${reached}/${opened}/${target}`);
  }
  await s.setViewport(1440, 1000);

  t.section("Tomorrow Readiness");
  await go(s, "/operations/tomorrow");
  mt = await mainText(s);
  t.check("Y1 Tomorrow Readiness: one h1; tomorrow's fixture is listed and flagged as needing preparation (no driver)", (await h1s(s)).length === 1 && mt.includes(PAX) && /driver|assign/i.test(mt), JSON.stringify(await h1s(s)));
  const tripLink = await has(s, `main a[href="/operations/trips/${TOMORROW}"]`);
  t.check("Y2 the affected trip links to its Trip Detail; a Dispatch (tomorrow) link is offered", tripLink && (await has(s, '[data-testid="tomorrow-dispatch-link"]')));
  t.check("Y3 Tomorrow Readiness: 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));
  await go(s, "/day-sheet?day=today");
  t.check("Y4 Day Sheet print view renders outside the shell and lists today's assigned fixture", !(await has(s, 'nav[aria-label="Primary"]')) && (await text(s)).includes(PAX));

  t.section("role + tenant boundaries");
  const drv = await t.open("driver", "org-a-driver-a@example.test");
  await go(drv, `/operations/trips/${TOMORROW}`);
  t.check("P1 a Driver cannot open Operations Trip Detail", !(await path(drv)).startsWith("/operations"), await path(drv));
  await go(drv, "/operations/dispatch");
  t.check("P2 a Driver cannot open Dispatch", !(await path(drv)).startsWith("/operations"), await path(drv));
  await t.close(drv);
  const orgB = await t.open("org-b", "org-b-admin@example.test");
  await go(orgB, `/operations/trips/${TOMORROW}`);
  t.check("P3 tenant isolation: Org B sees 'Trip unavailable' for an Org A trip", (await text(orgB)).includes("Trip unavailable") && !(await text(orgB)).includes(PAX));
  await go(orgB, "/operations/dispatch?day=tomorrow");
  t.check("P4 tenant isolation: Org A trips never appear on Org B's board", !(await text(orgB)).includes(PAX) && !(await has(orgB, `[data-trip-id="${TOMORROW}"]`)));
  await t.close(orgB);
  await shot(s, t.out, "dispatch");
} catch (e) {
  await t.finish(e);
}
await t.finish();
