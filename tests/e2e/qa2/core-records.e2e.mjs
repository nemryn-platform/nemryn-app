// NP-UI-QA2 core-records -- Standing Orders (create arrangement, review + create missing rides), Passengers (add, edit
// via the row action), Facilities (add), Drivers (invite), Vehicles (add), Proof of Service (yesterday's completed trip),
// role restrictions (Organization Admin-only record changes), axe. ISOLATED stack + fictional seed only.
import { suite, ORG_A, STAMP, one, at, sleep, waitFor, go, path, mainText, has, h1s, controls, click, setField, dialogOpen, axe, shot, overflowX } from "./_qa2.mjs";

const t = suite("core-records");

try {
  t.section("fixtures (fictional, isolated): a passenger for standing orders; a trip completed yesterday");
  const PAX = `QA2 Standing Rider ${STAMP}`;
  const pax = one(`insert into passengers (organization_id, display_name, status) values ('${ORG_A}', '${PAX}', 'active') returning id`);
  const DONE = one(`insert into trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description, destination_description, completed_at) values ('${ORG_A}', '${pax}', 'completed', ${at(-1, "09:00")}, 'QA2 proof pickup ${STAMP}', 'QA2 proof clinic', ${at(-1, "10:00")}) returning id`);

  const admin = await t.open("admin", "org-a-admin@example.test");

  t.section("Standing Orders: create an arrangement, then review and create its missing rides");
  await go(admin, "/operations/recurring-care");
  // NP-UI-QA2-P2 (owner decision): Standing Orders actions use the Brand Lock §15 term "standing order".
  t.check("S1 Standing Orders list: one h1 'Standing Orders'; New standing order offered; no remaining 'recurring arrangement' wording", JSON.stringify(await h1s(admin)) === JSON.stringify(["Standing Orders"]) && (await controls(admin)).includes("New standing order") && !/recurring arrangement/i.test(await admin.evaluate("document.querySelector('main').innerText")), JSON.stringify(await h1s(admin)));
  t.check("S2 Standing Orders list: 0 serious / critical axe violations", (await axe(admin)).length === 0, JSON.stringify(await axe(admin)));
  await go(admin, "/operations/recurring-care/new");
  t.check("S2c New standing order page: one h1 'New standing order'; breadcrumb back to Standing Orders", JSON.stringify(await h1s(admin)) === JSON.stringify(["New standing order"]) && (await admin.evaluate(`!!document.querySelector('nav[aria-label="Breadcrumb"] a[href="/operations/recurring-care"]')`)), JSON.stringify(await h1s(admin)));
  const before = one(`select count(*) from recurring_arrangements where passenger_id='${pax}'`);
  await click(admin, "Create standing order", "main", "button");
  await sleep(1200);
  t.check("S3 submitting without the required fields creates nothing", one(`select count(*) from recurring_arrangements where passenger_id='${pax}'`) === before);
  await setField(admin, 'select[name="passengerId"]', pax);
  await setField(admin, 'input[name="pickupDescription"]', `QA2 standing pickup ${STAMP}`);
  await setField(admin, 'input[name="destinationDescription"]', "QA2 standing clinic");
  await setField(admin, 'input[name="pickupTime"]', "07:30");
  await setField(admin, 'input[name="startDate"]', one(`select ((now() at time zone 'America/New_York')::date + 1)::text`));
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) await admin.evaluate(`(function(){const b=document.querySelector('[role="group"][aria-label="Days of week"] button[aria-label="${d}"]'); if (b && b.getAttribute('aria-pressed')!=='true') b.click(); return true;})()`);
  await sleep(300);
  await click(admin, "Create standing order", "main", "button");
  await waitFor(() => one(`select count(*) from recurring_arrangements where passenger_id='${pax}'`) === "1", 15000);
  await waitFor(async () => /^\/operations\/recurring-care\/[0-9a-f-]{36}/.test(await path(admin)), 15000);
  const ARR = one(`select id from recurring_arrangements where passenger_id='${pax}'`);
  t.check("S4 a complete form creates one active arrangement (every day, 07:30, from tomorrow) and opens it",
    one(`select status||'|'||pickup_time::text||'|'||array_length(days_of_week,1) from recurring_arrangements where id='${ARR}'`) === "active|07:30:00|7" && (await path(admin)).startsWith(`/operations/recurring-care/${ARR}`), await path(admin));
  t.check("S5 arrangement detail: exactly one visible h1 (page title)", (await h1s(admin)).length === 1, JSON.stringify(await h1s(admin)));
  t.check("S5c detail offers the standing-order lifecycle actions in standing-order wording (no 'recurring arrangement')", !/recurring arrangement/i.test(await admin.evaluate("document.querySelector('main').innerText")) && (await controls(admin)).includes("Edit") && (await controls(admin)).includes("End"));
  t.check("S5b arrangement detail: 0 serious / critical axe violations", (await axe(admin)).length === 0, JSON.stringify(await axe(admin)));
  const perOcc = (await controls(admin)).filter((c) => c === "Create trip").length;
  t.check("S6 the arrangement lists its upcoming occurrences, each with Create trip (no trips exist yet)", perOcc > 0 && one(`select count(*) from trips where recurring_arrangement_id='${ARR}'`) === "0", `${perOcc}`);
  await click(admin, "Create trip", "main", "button");
  await waitFor(() => one(`select count(*) from trips where recurring_arrangement_id='${ARR}'`) === "1", 15000);
  t.check("S7 Create trip on one occurrence writes exactly one scheduled trip at 07:30 local for the arrangement's passenger",
    one(`select count(*) from trips where recurring_arrangement_id='${ARR}' and passenger_id='${pax}' and state='scheduled' and to_char(scheduled_pickup_at at time zone 'America/New_York','HH24:MI')='07:30'`) === "1");
  await go(admin, "/operations/recurring-care");
  const reviewLabel = (await controls(admin)).find((c) => /^Review \d+ missing rides?$/.test(c));
  t.check("S8 Standing Orders list reports the remaining missing rides and offers a review", !!reviewLabel, JSON.stringify((await controls(admin)).slice(0, 12)));
  await click(admin, reviewLabel, "main");
  await waitFor(async () => (await path(admin)).startsWith("/operations/recurring-care/create-missing"), 15000);
  await sleep(1200);
  // select exactly two of THIS arrangement's occurrences (keys are "<arrangementId>::<serviceDate>"), then create them
  const picked = await admin.evaluate(`(function(){const c=[...document.querySelectorAll('input[name="occurrenceKey"]')]; c.forEach(x => { if (x.checked) x.click(); }); const mine=c.filter(x => x.value.startsWith(${JSON.stringify(ARR + "::")})); mine.slice(0,2).forEach(x => x.click()); return mine.length;})()`);
  await sleep(400);
  t.check("S9 review: choosing two of the arrangement's occurrences offers 'Create 2 trips'", picked >= 2 && (await controls(admin)).includes("Create 2 trips"), `${picked} ${JSON.stringify((await controls(admin)).filter((c) => /^Create/.test(c)))}`);
  await click(admin, "Create 2 trips", "main", "button");
  await waitFor(() => one(`select count(*) from trips where recurring_arrangement_id='${ARR}'`) === "3", 20000);
  t.check("S10 bulk creation writes exactly two more trips (three in total), never duplicating an occurrence",
    one(`select count(*)||'/'||count(distinct (scheduled_pickup_at at time zone 'America/New_York')::date) from trips where recurring_arrangement_id='${ARR}' and state='scheduled'`) === "3/3");

  t.section("Passengers: add, edit through the row action");
  await go(admin, "/operations/passengers");
  t.check("R1 Passengers: one h1; Add Passenger offered; 0 serious / critical axe", (await h1s(admin)).length === 1 && (await controls(admin)).includes("Add Passenger") && (await axe(admin)).length === 0);
  await click(admin, "Add Passenger", "main", "button");
  await waitFor(() => dialogOpen(admin), 5000);
  const NEWPAX = `QA2 Added Rider ${STAMP}`;
  await setField(admin, 'input[name="displayName"]', NEWPAX, "dialog");
  await setField(admin, 'input[name="phone"]', "555-0177", "dialog");
  await click(admin, "Add Passenger", "dialog", "button");
  await waitFor(() => one(`select count(*) from passengers where display_name='${NEWPAX}'`) === "1", 15000);
  await sleep(1000);
  await go(admin, `/operations/passengers?q=${encodeURIComponent(NEWPAX)}`);
  t.check("R2 Add Passenger writes an active passenger that appears in the list", one(`select status from passengers where display_name='${NEWPAX}'`) === "active" && (await mainText(admin)).includes(NEWPAX));
  const opened = await admin.evaluate(`(function(){const b=[...document.querySelectorAll('[data-row-action]')].find(x => x.textContent.includes(${JSON.stringify(NEWPAX)})); if(!b) return false; b.click(); return true;})()`);
  await waitFor(() => dialogOpen(admin), 5000);
  await setField(admin, 'input[name="phone"]', "555-0199", "dialog");
  await click(admin, "Save Changes", "dialog", "button");
  await waitFor(() => one(`select phone from passengers where display_name='${NEWPAX}'`) === "555-0199", 15000);
  t.check("R3 the row's Edit action opens Edit Passenger and saving updates the record", opened && one(`select phone from passengers where display_name='${NEWPAX}'`) === "555-0199");

  t.section("Facilities, Vehicles, Drivers");
  await go(admin, "/operations/facilities");
  t.check("F1 Facilities: one h1; Add Facility offered; 0 serious / critical axe", (await h1s(admin)).length === 1 && (await controls(admin)).includes("Add Facility") && (await axe(admin)).length === 0);
  await click(admin, "Add Facility", "main", "button");
  await waitFor(() => dialogOpen(admin), 5000);
  const FAC = `QA2 Clinic ${STAMP}`;
  for (const [n, v] of [["name", FAC], ["addressLine1", "1 QA2 Way"], ["city", "Atlanta"], ["state", "GA"], ["postalCode", "30301"]]) await setField(admin, `input[name="${n}"]`, v, "dialog");
  await click(admin, "Add Facility", "dialog", "button");
  await waitFor(() => one(`select count(*) from facilities where name='${FAC}'`) === "1", 15000);
  await sleep(800);
  t.check("F2 Add Facility writes the facility and lists it", one(`select status from facilities where name='${FAC}'`) === "active" && (await waitFor(async () => (await mainText(admin)).includes(FAC), 8000)));
  await go(admin, "/operations/fleet");
  t.check("V1 Vehicles page: one h1; Add Vehicle offered; 0 serious / critical axe", (await h1s(admin)).length === 1 && (await controls(admin)).includes("Add Vehicle") && (await axe(admin)).length === 0, JSON.stringify(await h1s(admin)));
  await click(admin, "Add Vehicle", "main", "button");
  await waitFor(() => dialogOpen(admin), 5000);
  const VAN = `QA2 Van ${STAMP}`;
  await setField(admin, 'input[name="label"]', VAN, "dialog");
  await click(admin, "Add Vehicle", "dialog", "button");
  await waitFor(() => one(`select count(*) from vehicles where label='${VAN}'`) === "1", 15000);
  await sleep(800);
  t.check("V2 Add Vehicle writes an active vehicle and lists it", one(`select status from vehicles where label='${VAN}'`) === "active" && (await waitFor(async () => (await mainText(admin)).includes(VAN), 8000)));
  await go(admin, "/operations/drivers");
  t.check("DR1 Drivers: one h1; Invite Driver offered; 0 serious / critical axe", (await h1s(admin)).length === 1 && (await controls(admin)).includes("Invite Driver") && (await axe(admin)).length === 0);
  await click(admin, "Invite Driver", "main", "button");
  await waitFor(() => dialogOpen(admin), 5000);
  const DRV = `qa2-driver-${STAMP}@example.test`;
  await setField(admin, 'input[name="displayName"]', `QA2 Driver ${STAMP}`, "dialog");
  await setField(admin, 'input[name="email"]', DRV, "dialog");
  await click(admin, "Send Invite", "dialog", "button");
  await waitFor(() => one(`select count(*) from driver_invites where email='${DRV}'`) === "1", 15000);
  t.check("DR2 Invite Driver writes one pending invitation for the entered email (nothing is sent: no email provider in the isolated env)", one(`select status from driver_invites where email='${DRV}'`) === "pending");

  t.section("Proof of Service (yesterday)");
  await go(admin, "/operations/proof-of-service");
  const pt = await mainText(admin);
  t.check("PS1 Proof of Service: one h1; yesterday's completed fixture is listed for review", (await h1s(admin)).length === 1 && pt.includes(PAX), JSON.stringify(await h1s(admin)));
  t.check("PS2 the listed trip links to its Trip Detail", await has(admin, `main a[href="/operations/trips/${DONE}"]`));
  t.check("PS3 Proof of Service: 0 serious / critical axe violations", (await axe(admin)).length === 0, JSON.stringify(await axe(admin)));

  t.section("role restrictions (Organization Admin-only record administration)");
  const disp = await t.open("dispatcher", "org-a-dispatcher@example.test");
  await go(disp, "/operations/drivers");
  t.check("RO1 a Dispatcher can view Drivers but is not offered Invite Driver", (await h1s(disp)).length === 1 && !(await controls(disp)).includes("Invite Driver"), JSON.stringify(await controls(disp)).slice(0, 200));
  await go(disp, "/operations/fleet");
  t.check("RO2 a Dispatcher can view Vehicles but is not offered Add Vehicle", (await h1s(disp)).length === 1 && !(await controls(disp)).includes("Add Vehicle"));
  await disp.setViewport(768, 1024);
  for (const p of ["/operations/recurring-care", "/operations/passengers", "/operations/facilities", "/operations/drivers", "/operations/fleet", "/operations/proof-of-service"]) {
    await go(disp, p);
    if ((await overflowX(disp)) > 1) t.check(`W ${p} at 768px has no page-level horizontal overflow`, false, await overflowX(disp));
  }
  t.check("W1 768px: Standing Orders, Passengers, Facilities, Drivers, Vehicles, Proof of Service have no page-level horizontal overflow", true);
  await shot(admin, t.out, "records");
} catch (e) {
  await t.finish(e);
}
await t.finish();
