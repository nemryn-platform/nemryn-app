// NP-UI-QA2 growth -- Growth Dashboard, Contacts (create), Pipeline (create opportunity from the contact, listed),
// Tasks (create on the opportunity, list, mark done), the Growth -> Core handoff (opportunity -> pending transportation
// request, exactly once), and entitlement / named-grant / tenant restrictions. Quotes are covered by tests/e2e/plus-quotes.
// ISOLATED stack + fictional seed only.
import { suite, ORG_A, ORG_B, STAMP, sql, one, sleep, waitFor, go, path, text, mainText, has, h1s, controls, click, setField, dialogOpen, axe, shot, userId } from "./_qa2.mjs";

const t = suite("growth");
const tid = (id) => `[data-testid="${id}"]`;
const clickT = (s, id) => s.evaluate(`(function(){const e=document.querySelector('${tid(id)}'); if(!e) return false; e.click(); return true;})()`);

try {
  t.section("fixtures: Nemryn Plus active for Org A only (harness SQL, isolated)");
  sql(`delete from membership_module_grants where organization_id in ('${ORG_A}','${ORG_B}'); delete from organization_modules where organization_id in ('${ORG_A}','${ORG_B}');
       insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}','plus','active','QA2 growth suite')`);
  const admin = await t.open("admin", "org-a-admin@example.test");

  t.section("Dashboard + Contacts");
  await go(admin, "/operations/growth");
  t.check("G1 Growth Dashboard: one h1; 0 serious / critical axe", (await h1s(admin)).length === 1 && (await axe(admin)).length === 0, JSON.stringify(await h1s(admin)));
  await go(admin, "/operations/growth/contacts/new");
  const before = one(`select count(*) from plus_contacts where organization_id='${ORG_A}'`);
  await clickT(admin, "contact-save");
  await sleep(1200);
  t.check("G2 New contact: saving without the required fields creates nothing", one(`select count(*) from plus_contacts where organization_id='${ORG_A}'`) === before);
  const PAT = `QA2 Pat ${STAMP}`;
  await setField(admin, 'input[name="displayName"]', PAT);
  await setField(admin, 'input[name="phone"]', "(404) 555-0166");
  await setField(admin, 'select[name="contactKind"]', "individual");
  await setField(admin, 'select[name="preferredChannel"]', "phone");
  await clickT(admin, "contact-save");
  await waitFor(() => one(`select count(*) from plus_contacts where display_name='${PAT}'`) === "1", 15000);
  const K = one(`select id from plus_contacts where display_name='${PAT}'`);
  await waitFor(async () => (await path(admin)).startsWith(`/operations/growth/contacts/${K}`), 15000);
  t.check("G3 a complete contact is saved (individual, phone) and its record opens", one(`select contact_kind||'|'||preferred_channel from plus_contacts where id='${K}'`) === "individual|phone" && (await path(admin)).startsWith(`/operations/growth/contacts/${K}`), await path(admin));
  await go(admin, `/operations/growth/contacts?q=${encodeURIComponent(PAT)}`);
  t.check("G4 Contacts list finds the new contact; rows link to it; 0 serious / critical axe", (await has(admin, `a[href="/operations/growth/contacts/${K}"]`)) && (await axe(admin)).length === 0);

  t.section("Pipeline: opportunity from the contact");
  await go(admin, `/operations/growth/contacts/${K}`);
  await clickT(admin, "contact-new-opportunity");
  await waitFor(() => has(admin, tid("opportunity-form")), 15000);
  const TITLE = `QA2 dialysis rides ${STAMP}`;
  await setField(admin, 'input[name="title"]', TITLE);
  await setField(admin, 'select[name="inquiryType"]', "quote");
  await setField(admin, 'select[name="source"]', "website");
  if ((await admin.evaluate(`document.querySelector('select[name="contactId"]')?.value ?? 'n/a'`)) === "") await setField(admin, 'select[name="contactId"]', K);
  await clickT(admin, "opportunity-save");
  await waitFor(() => one(`select count(*) from plus_opportunities where title='${TITLE}'`) === "1", 15000);
  const O = one(`select id from plus_opportunities where title='${TITLE}'`);
  await waitFor(async () => (await path(admin)).startsWith(`/operations/growth/pipeline/${O}`), 15000);
  t.check("P1 the opportunity is created for the contact (quote / website) and its record opens", one(`select primary_contact_id||'|'||inquiry_type||'|'||source from plus_opportunities where id='${O}'`) === `${K}|quote|website` && (await path(admin)).startsWith(`/operations/growth/pipeline/${O}`), await path(admin));
  await go(admin, "/operations/growth/pipeline");
  t.check("P2 Pipeline lists the opportunity with a link to it; 0 serious / critical axe", (await has(admin, `a[href="/operations/growth/pipeline/${O}"]`)) && (await axe(admin)).length === 0);

  t.section("Tasks on the opportunity");
  await go(admin, `/operations/growth/pipeline/${O}`);
  const taskOpen = (await click(admin, "Add task", "main", "button")) || (await clickT(admin, "task-new"));
  await waitFor(() => dialogOpen(admin), 5000);
  await setField(admin, 'input[name="title"]', `QA2 call back ${STAMP}`, "dialog");
  await setField(admin, 'input[name="dueDate"]', one(`select ((now() at time zone 'America/New_York')::date + 2)::text`), "dialog");
  await sleep(200);
  await clickT(admin, "task-save");
  await waitFor(() => one(`select count(*) from plus_tasks where title='QA2 call back ${STAMP}'`) === "1", 15000);
  const TK = one(`select id from plus_tasks where title='QA2 call back ${STAMP}'`);
  t.check("T1 Add task on the opportunity writes an open task linked to it", taskOpen && one(`select status||'|'||opportunity_id from plus_tasks where id='${TK}'`) === `open|${O}`);
  await go(admin, "/operations/growth/tasks");
  t.check("T2 Tasks lists the task; 0 serious / critical axe", (await mainText(admin)).includes(`QA2 call back ${STAMP}`) && (await axe(admin)).length === 0);
  const done = await admin.evaluate(`(function(){const r=[...document.querySelectorAll('[data-testid="task-row"]')].find(x => x.textContent.includes(${JSON.stringify(`QA2 call back ${STAMP}`)})); const b=r && r.querySelector('[data-testid="task-done"]'); if(!b) return false; b.click(); return true;})()`);
  await waitFor(() => one(`select status from plus_tasks where id='${TK}'`) === "done", 15000);
  t.check("T3 Mark done completes the task", done && one(`select status from plus_tasks where id='${TK}'`) === "done");

  t.section("Growth -> Core handoff (opportunity -> pending transportation request)");
  await go(admin, `/operations/growth/pipeline/${O}`);
  t.check("H1 an open opportunity offers 'Create transportation request'", await has(admin, tid("convert-open")));
  await clickT(admin, "convert-open");
  await waitFor(() => has(admin, tid("booking-form")), 10000);
  await setField(admin, tid("booking-relationship"), "family");
  await setField(admin, tid("booking-pickup"), `QA2 Elm St ${STAMP}`);
  await setField(admin, tid("booking-destination"), `QA2 Dialysis ${STAMP}`);
  await setField(admin, tid("booking-date"), one(`select ((now() at time zone 'America/New_York')::date + 4)::text`));
  await setField(admin, tid("booking-time"), "10:15");
  await setField(admin, tid("booking-return"), "yes");
  await sleep(300);
  await clickT(admin, "booking-review");
  await waitFor(() => has(admin, tid("booking-summary")), 8000);
  await admin.evaluate(`(function(){const b=document.querySelector('${tid("booking-confirm")}'); b.click(); b.click(); return true;})()`);
  await waitFor(() => has(admin, tid("booking-success")), 20000);
  const R = one(`select request_id from plus_request_attributions where opportunity_id='${O}'`);
  t.check("H2 review -> confirm (double click) creates exactly ONE pending Core request, passenger not linked, with the entered transport details",
    !!R && one(`select count(*) from plus_request_attributions where opportunity_id='${O}'`) === "1" && one(`select state||'|'||coalesce(passenger_id::text,'null')||'|'||pickup_description from transportation_requests where id='${R}'`) === `pending|null|QA2 Elm St ${STAMP}`);
  t.check("H3 success links to the Core request", (await admin.evaluate(`document.querySelector('${tid("booking-open-request")}')?.getAttribute('href')`)) === `/operations/requests/${R}`);
  await go(admin, `/operations/requests/${R}`);
  t.check("H4 the Core request opens in Operations as Pending with its normal decision controls", (await controls(admin)).includes("Accept Request") && /Pending/.test(await mainText(admin)));
  await go(admin, `/operations/growth/pipeline/${O}`);
  t.check("H5 the converted opportunity offers no second conversion", !(await has(admin, tid("convert-open"))));

  t.section("entitlement, named grants, tenant isolation");
  const disp = await t.open("dispatcher", "org-a-dispatcher@example.test");
  await go(disp, "/operations");
  t.check("E1 a Dispatcher without a Growth grant sees no Growth navigation", !(await has(disp, '[data-testid="growth-nav-group"]')));
  await go(disp, "/operations/growth/contacts");
  t.check("E2 …and the Growth route refuses on the server (redirected away)", !(await path(disp)).startsWith("/operations/growth"), await path(disp));
  const dispMem = one(`select m.id from memberships m join auth.users u on u.id=m.user_id where u.email='org-a-dispatcher@example.test' and m.organization_id='${ORG_A}'`);
  sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}','${dispMem}','plus','read','${userId("org-a-admin@example.test")}')`);
  await go(disp, "/operations/growth/contacts");
  t.check("E3 with a named READ grant the Dispatcher can open Contacts and sees the contact", (await path(disp)).startsWith("/operations/growth/contacts") && (await mainText(disp)).includes(PAT), await path(disp));
  t.check("E4 …but a read grant offers no 'New contact'", !(await has(disp, tid("contacts-new"))));
  sql(`update membership_module_grants set revoked_at=now(), revoked_by='${userId("org-a-admin@example.test")}' where membership_id='${dispMem}' and revoked_at is null`);
  await go(disp, "/operations/growth/contacts");
  t.check("E5 revoking the grant removes access again (server-side)", !(await path(disp)).startsWith("/operations/growth"), await path(disp));
  sql(`update organization_modules set status='disabled', restriction='no_access' where organization_id='${ORG_A}'`);
  await go(admin, "/operations/growth/pipeline");
  t.check("E6 with Plus disabled (no access) even the Organization Admin is refused and the Growth nav disappears", !(await path(admin)).startsWith("/operations/growth") && !(await has(admin, '[data-testid="growth-nav-group"]')), await path(admin));
  sql(`update organization_modules set status='active', restriction=null where organization_id='${ORG_A}'`);
  sql(`insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_B}','plus','active','QA2 tenant isolation')`);
  const orgB = await t.open("org-b", "org-b-admin@example.test");
  await go(orgB, `/operations/growth/contacts/${K}`);
  t.check("E7 tenant isolation: Org B (with Plus) cannot open Org A's contact", !(await text(orgB)).includes(PAT));
  await go(orgB, `/operations/growth/pipeline/${O}`);
  t.check("E8 tenant isolation: Org B cannot open Org A's opportunity", !(await text(orgB)).includes(TITLE));
  await go(orgB, "/operations/growth/contacts");
  t.check("E9 tenant isolation: Org A contacts never appear in Org B's list", !(await text(orgB)).includes(PAT));
  sql(`delete from organization_modules where organization_id='${ORG_B}'`);
  await shot(admin, t.out, "growth");
} catch (e) {
  await t.finish(e);
}
await t.finish();
