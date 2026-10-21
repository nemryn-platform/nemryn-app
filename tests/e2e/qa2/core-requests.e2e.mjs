// NP-UI-QA2 core-requests -- Requests list / tabs, Log Request (validation + outcome), Request detail decision workflow
// (accept, link / create passenger, Create Trip handoff, decline with reason, cancel with reason), list badges, role and
// tenant boundaries, keyboard dialog focus, axe. Preserves the proven P1-OPS-R1 journeys (.tmp-qa/p1-ops-r1-decision-e2e)
// as a maintained suite. ISOLATED stack + fictional seed only.
import { suite, ORG_A, STAMP, APP, sql, one, sleep, waitFor, go, path, text, waitText, h1s, controls, click, setField, dialogOpen, dialogText, key, activeLabel, axe, shot, overflowX } from "./_qa2.mjs";

const t = suite("core-requests");
const SITE = "https://qa2-requests.example.test";
const EXT = `qa2-req-${STAMP}`;
let ip = 0;
async function website(keySuffix, name) {
  ip += 1;
  const res = await fetch(`${APP}/api/public-intake/website`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "X-Forwarded-For": `203.0.113.${(ip % 250) + 1}` },
    body: JSON.stringify({
      integrationExternalId: EXT, idempotencyKey: `${keySuffix}-${STAMP}`, requesterName: name, requesterRelationship: "family",
      requesterPhone: "(404) 555-0170", requesterEmail: "qa2-requester@example.test", passengerName: `Passenger of ${name}`,
      pickupDescription: "QA2 pickup — 1 Test Way", destinationDescription: "QA2 destination — Test Clinic", returnTripNeeded: "no",
    }),
  });
  return { status: res.status, id: one(`select r.id from transportation_requests r join request_intake_integrations i on i.id=r.intake_integration_id where i.external_id='${EXT}' and r.external_submission_ref='${keySuffix}-${STAMP}'`) };
}

try {
  t.section("fixtures: a fictional website connection for Org A (harness SQL); requests arrive through the REAL public intake route");
  sql(`delete from public_intake_rate_limit_events; insert into request_intake_integrations (organization_id, external_id, integration_type, is_active, allowed_origins) values ('${ORG_A}', '${EXT}', 'website', true, array['${SITE}'])`);
  const w1 = await website("w1", `QA2 Accept ${STAMP}`);
  const w2 = await website("w2", `QA2 Decline ${STAMP}`);
  const w3 = await website("w3", `QA2 Cancel ${STAMP}`);
  t.check("F1 three website requests accepted by the real intake route and stored as pending, no passenger",
    [w1, w2, w3].every((w) => w.status === 200 && w.id) && one(`select string_agg(state||':'||coalesce(passenger_id::text,'null'),',' order by created_at) from transportation_requests where id in ('${w1.id}','${w2.id}','${w3.id}')`) === "pending:null,pending:null,pending:null");

  const s = await t.open("dispatcher", "org-a-dispatcher@example.test");

  t.section("list + status tabs");
  await go(s, "/operations/requests");
  const listText = await text(s);
  t.check("L1 Requests list: one h1, the pending tab shows the new website requests with a Pending status", (await h1s(s)).length === 1 && listText.includes(`QA2 Accept ${STAMP}`) && /Pending/.test(listText), JSON.stringify(await h1s(s)));
  const tabs = await s.evaluate(`[...document.querySelectorAll('main a')].map(a => a.textContent.trim()).filter(x => /^(Pending|Accepted|Declined|Cancelled|All)\\b/.test(x))`);
  t.check("L2 status tabs Pending / Accepted / Declined / Cancelled / All are present as links", ["Pending", "Accepted", "Declined", "Cancelled", "All"].every((x) => tabs.some((y) => y.startsWith(x))), JSON.stringify(tabs));
  await go(s, "/operations/requests?state=declined");
  t.check("L3 Declined tab does not list the pending requests", !(await text(s)).includes(`QA2 Accept ${STAMP}`));
  t.check("L4 Requests list (populated): 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));

  t.section("Log Request: validation and outcome");
  const before = one(`select count(*) from transportation_requests where organization_id='${ORG_A}'`);
  await go(s, "/operations/requests/new");
  t.check("N1 Log Request page: one h1 'Log Request'", JSON.stringify(await h1s(s)) === JSON.stringify(["Log Request"]), JSON.stringify(await h1s(s)));
  await click(s, "Log Request", "document", "button");
  await sleep(1200);
  t.check("N2 submitting with required fields empty creates nothing (required-field validation) and stays on the form", one(`select count(*) from transportation_requests where organization_id='${ORG_A}'`) === before && (await path(s)).startsWith("/operations/requests/new"));
  const reqName = `QA2 Logged ${STAMP}`;
  for (const [sel, v] of [['input[name="requesterName"]', reqName], ['select[name="requesterRelationship"]', "caregiver"], ['input[name="requesterPhone"]', "(404) 555-0181"], ['textarea[name="pickupDescription"]', "QA2 logged pickup — 5 Oak St"], ['textarea[name="destinationDescription"]', "QA2 logged destination — Clinic B"], ['select[name="returnTripNeeded"]', "yes"], ['select[name="source"]', "phone"]]) {
    await setField(s, sel, v);
  }
  await click(s, "Log Request", "document", "button");
  t.check("N3 a complete Log Request succeeds ('Request logged') and writes one pending phone request with the entered values",
    (await waitText(s, "Request logged")) && one(`select count(*) from transportation_requests where organization_id='${ORG_A}' and requester_name='${reqName}' and state='pending' and source='phone'`) === "1");

  t.section("decision workflow: accept -> passenger -> Create Trip (Request -> Trip handoff)");
  await go(s, `/operations/requests/${w1.id}`);
  let ctl = await controls(s);
  t.check("D1 pending detail: one h1 'Request Detail'; Accept + Decline offered; no Cancel / Create Trip yet",
    JSON.stringify(await h1s(s)) === JSON.stringify(["Request Detail"]) && ctl.includes("Accept Request") && ctl.includes("Decline Request") && !ctl.includes("Cancel Request") && !ctl.includes("Create Trip"), JSON.stringify(ctl));
  t.check("D2 Request detail: 0 serious / critical axe violations", (await axe(s)).length === 0, JSON.stringify(await axe(s)));
  await click(s, "Accept Request", "document", "button");
  await waitFor(() => one(`select state from transportation_requests where id='${w1.id}'`) === "accepted");
  await sleep(1200);
  ctl = await controls(s);
  t.check("D3 Accept -> accepted (one request_accepted event), no passenger and no trip created by accepting; Cancel offered",
    one(`select state from transportation_requests where id='${w1.id}'`) === "accepted" && one(`select count(*) from request_events where request_id='${w1.id}' and event_type='request_accepted'`) === "1" && one(`select count(*) from trips where request_id='${w1.id}'`) === "0" && ctl.includes("Cancel Request") && !ctl.includes("Accept Request"), JSON.stringify(ctl));
  const rider = `QA2 Rider ${STAMP}`;
  t.check("D4 accepted request offers Add New Passenger", await click(s, "Add New Passenger", "document", "button"));
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'input[name="displayName"]', rider, "dialog");
  await setField(s, 'input[name="phone"]', "555-0171", "dialog");
  await click(s, "Add Passenger", "dialog", "button");
  t.check("D5 passenger created AND linked; the decision stays accepted; Create Trip becomes available",
    (await waitFor(async () => (await controls(s)).includes("Create Trip"), 15000)) && one(`select p.display_name||'|'||r.state from transportation_requests r join passengers p on p.id=r.passenger_id where r.id='${w1.id}'`) === `${rider}|accepted`);
  await click(s, "Create Trip", "main", "a");
  await waitFor(async () => (await path(s)).includes(`requestId=${w1.id}`), 15000);
  await sleep(1500);
  const day = one(`select ((now() at time zone 'America/New_York')::date + 3)::text`);
  await setField(s, 'input[name="pickupDate"]', day);
  await setField(s, 'input[name="pickupTime"]', "09:30");
  await sleep(300);
  await s.evaluate(`(function(){const b=[...document.querySelectorAll('button[type="submit"]')].find(e => /Create Trip/.test(e.textContent)); b && b.click(); return !!b;})()`);
  await waitFor(() => one(`select count(*) from trips where request_id='${w1.id}'`) === "1", 20000);
  await waitFor(async () => /^\/operations\/trips\/[0-9a-f-]{36}/.test(await path(s)), 15000);
  const trip = one(`select id||'|'||state||'|'||(scheduled_pickup_at at time zone 'America/New_York')::text from trips where request_id='${w1.id}'`);
  t.check("D6 New Trip opened prefilled from the request; submitting creates exactly one scheduled trip linked to it at the entered local time, then opens Trip Detail",
    trip.split("|")[1] === "scheduled" && trip.split("|")[2].startsWith(`${day} 09:30`) && (await path(s)).startsWith("/operations/trips/"), `${trip} ${await path(s)}`);
  t.check("D7 the trip did not change the request decision", one(`select state from transportation_requests where id='${w1.id}'`) === "accepted");
  await go(s, `/operations/requests/${w1.id}`);
  ctl = await controls(s);
  t.check("D8 with a trip: Cancel Request gone, 'Trip created' readiness, Create Another Trip offered", !ctl.includes("Cancel Request") && (await text(s)).includes("Trip created") && ctl.includes("Create Another Trip"), JSON.stringify(ctl));

  t.section("decline (reason required) and cancel (reason), keyboard focus");
  await go(s, `/operations/requests/${w2.id}`);
  await s.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Decline Request').focus()`);
  await key(s, "Enter");
  await waitFor(() => dialogOpen(s), 5000);
  t.check("K1 Decline dialog opens by keyboard; confirm is disabled until a reason is chosen", (await dialogText(s)).includes("Decline this request?") && (await s.evaluate(`[...Array.from(document.querySelectorAll('dialog')).find(x=>x.open).querySelectorAll('button')].find(b => b.textContent.trim()==='Decline Request').disabled`)) === true);
  await key(s, "Escape");
  await waitFor(async () => !(await dialogOpen(s)), 5000);
  await sleep(300);
  t.check("K2 Escape closes the dialog and returns focus to 'Decline Request' (U2)", (await activeLabel(s)) === "Decline Request" && one(`select state from transportation_requests where id='${w2.id}'`) === "pending", await activeLabel(s));
  await click(s, "Decline Request", "document", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'select[name="reasonCode"]', "outside_service_area", "dialog");
  await setField(s, 'textarea[name="reasonNote"]', "QA2 beyond the county line", "dialog");
  await sleep(200);
  await click(s, "Decline Request", "dialog", "button");
  await waitFor(() => one(`select state from transportation_requests where id='${w2.id}'`) === "declined");
  await sleep(1000);
  ctl = await controls(s);
  t.check("K3 decline -> declined with the structured reason; terminal (no decision actions)",
    one(`select e.reason_code||'|'||e.reason_note from request_events e where e.request_id='${w2.id}' and e.event_type='request_declined'`) === "outside_service_area|QA2 beyond the county line" && !["Accept Request", "Decline Request", "Cancel Request", "Create Trip"].some((x) => ctl.includes(x)), JSON.stringify(ctl));
  await go(s, `/operations/requests/${w3.id}`);
  await click(s, "Accept Request", "document", "button");
  await waitFor(async () => (await controls(s)).includes("Cancel Request"), 15000);
  await click(s, "Cancel Request", "document", "button");
  await waitFor(() => dialogOpen(s), 5000);
  await setField(s, 'select[name="reasonCode"]', "requester_cancelled", "dialog");
  await sleep(200);
  await click(s, "Cancel Request", "dialog", "button");
  await waitFor(() => one(`select state from transportation_requests where id='${w3.id}'`) === "cancelled");
  t.check("K4 accept -> cancel with reason -> cancelled (terminal)", one(`select r.state||'|'||e.reason_code from transportation_requests r join request_events e on e.request_id=r.id and e.event_type='request_cancelled' where r.id='${w3.id}'`) === "cancelled|requester_cancelled");
  await go(s, "/operations/requests?state=all");
  const row = (n) => s.evaluate(`(function(){const r=[...document.querySelectorAll('table tbody tr')].find(x => x.textContent.includes(${JSON.stringify(n)})); return r ? r.textContent : '';})()`);
  const [r1, r2, r3] = [await row(rider), await row(`QA2 Decline ${STAMP}`), await row(`QA2 Cancel ${STAMP}`)];
  t.check("K5 All tab: Accepted (+ Trip created) / Declined / Cancelled badges", r1.includes("Accepted") && r1.includes("Trip created") && r2.includes("Declined") && r3.includes("Cancelled"), [r1, r2, r3].join(" || ").slice(0, 300));
  await shot(s, t.out, "requests-all");

  t.section("roles, tenant isolation, tablet");
  const drv = await t.open("driver", "org-a-driver-a@example.test");
  await go(drv, `/operations/requests/${w1.id}`);
  t.check("P1 a Driver cannot open Request Detail (sent away from /operations, no decision actions)", !(await path(drv)).startsWith("/operations") && !(await text(drv)).includes("Accept Request"), await path(drv));
  await t.close(drv);
  const orgB = await t.open("org-b", "org-b-admin@example.test");
  await go(orgB, `/operations/requests/${w1.id}`);
  t.check("P2 tenant isolation: Org B's admin sees 'Request unavailable' for an Org A request (no data leaks)", (await text(orgB)).includes("Request unavailable") && !(await text(orgB)).includes(rider));
  await go(orgB, "/operations/requests?state=all");
  t.check("P3 tenant isolation: Org A requests never appear in Org B's list", !(await text(orgB)).includes(`QA2 `));
  await t.close(orgB);
  await s.setViewport(768, 1024);
  await go(s, `/operations/requests/${w1.id}`);
  t.check("R1 768px Request detail: no page-level horizontal overflow, actions visible", (await overflowX(s)) <= 1 && (await controls(s)).includes("Create Another Trip"), await overflowX(s));
} catch (e) {
  await t.finish(e);
}
await t.finish();
