// NP-PILOT-P1 -- Growth -> Core handoff: browser + SQL E2E on the ISOLATED stack (NemrynS1Iso + `next start -p 3100`,
// public inquiry switch OFF). FICTIONAL data only; the plus-quotes config refuses any other target.
//   node tests/e2e/handoff/handoff.e2e.mjs
// Opportunity (from a website inquiry) -> accepted round-trip quote -> conversion with prefilled, editable fields and an
// OPTIONAL, confirmed passenger linked IN THE SAME TRANSACTION -> pending Core Request (never auto-approved) -> staff
// accept -> trip -> driver completes -> Trip Detail Billing -> invoice draft importing the originating quote. Plus
// missing-data, decide-later, new-rider name snapshot (D1), "requester is the rider" (D3), inactive / foreign passengers
// and the deactivation race refused with NOTHING created (D2), replay, rebooking, read-only access, axe.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1", ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", a3: "20000000-0000-0000-0000-0000000000a3" };
const DRIVER = "30000000-0000-0000-0000-0000000000a1", VAN = "50000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
const OUT = artifactDir("handoff");
const SHOTS = process.env.HANDOFF_SCREENSHOT_DIR || OUT;
mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|UPDATE \d+|INSERT 0 \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
const one = (q) => first(sql(q));
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }

// ---------------------------------------------------------------- fixtures
const TAG = "HANDOFF";
function cleanup() {
  sql(`
    set session_replication_role = replica;
    delete from billing_assurance_events where organization_id = '${ORG_A}';
    delete from billing_receipt_reversals where organization_id = '${ORG_A}';
    delete from billing_refund_reversals where organization_id = '${ORG_A}';
    delete from billing_refunds where organization_id = '${ORG_A}';
    delete from billing_allocations where organization_id = '${ORG_A}';
    delete from billing_receipts where organization_id = '${ORG_A}';
    delete from billing_receipt_counters where organization_id = '${ORG_A}';
    delete from billing_payments where organization_id = '${ORG_A}';
    delete from billing_invoice_lines where organization_id = '${ORG_A}';
    delete from billing_invoice_trips where organization_id = '${ORG_A}';
    delete from billing_invoices where organization_id = '${ORG_A}';
    delete from billing_invoice_counters where organization_id = '${ORG_A}';
    delete from trip_events where trip_id in (select id from trips where pickup_description like '${TAG}%');
    delete from trip_assignments where trip_id in (select id from trips where pickup_description like '${TAG}%');
    delete from trips where pickup_description like '${TAG}%';
    delete from plus_activities where organization_id = '${ORG_A}' and (contact_id in (select id from plus_contacts where display_name like '${TAG}%') or opportunity_id in (select id from plus_opportunities where title like '${TAG}%'));
    delete from plus_request_attributions where organization_id = '${ORG_A}' and contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from request_events where request_id in (select id from transportation_requests where pickup_description like '${TAG}%');
    delete from transportation_requests where pickup_description like '${TAG}%';
    delete from plus_quotes where organization_id = '${ORG_A}' and idempotency_key like 'handoff-%';
    delete from plus_communication_consents where organization_id = '${ORG_A}' and contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from plus_opportunities where organization_id = '${ORG_A}' and (title like '${TAG}%' or primary_contact_id in (select id from plus_contacts where display_name like '${TAG}%'));
    delete from plus_inquiries where organization_id = '${ORG_A}';
    delete from plus_inquiry_forms where organization_id = '${ORG_A}';
    delete from plus_inquiry_public_access where organization_id = '${ORG_A}';
    delete from plus_contacts where organization_id = '${ORG_A}' and display_name like '${TAG}%';
    delete from passengers where display_name like '${TAG}%';
    set session_replication_role = origin;
  `);
}
cleanup();
sql(`delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');
     insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'handoff e2e');
     update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where organization_id = '${ORG_A}' and revoked_at is null;`);
// passengers: a phone match, an unrelated one, an INACTIVE phone match, a foreign-org phone match
const PHONE = "(404) 555-0161";
const P_MATCH = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', '${TAG} Rose Mother', '404-555-0161') returning id`);
const P_OTHER = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', '${TAG} Unrelated Rider', '(404) 555-0199') returning id`);
const P_INACTIVE = one(`insert into passengers (organization_id, display_name, phone, status) values ('${ORG_A}', '${TAG} Old Record', '${PHONE}', 'inactive') returning id`);
const P_FOREIGN = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_B}', '${TAG} Other Org Rose', '${PHONE}') returning id`);
const P_RACE = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', '${TAG} Race Rider', '(404) 555-0177') returning id`);
// opportunity 1: from a website inquiry (relationship family), with an ACCEPTED round-trip quote
sql(`insert into plus_inquiry_forms (organization_id, status, headline, offered_service_types, consent_text_version, published_at, published_by, created_by, updated_by)
       values ('${ORG_A}', 'published', 'Handoff form', '{}', 'plus-inquiry-consent-v1', now(), '${U.a1}', '${U.a1}', '${U.a1}');
     insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG_A}', 'handoff e2e', '${U.a1}');`);
const KEY = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG_A}'`);
const VER = one(`select config_version from plus_inquiry_forms where organization_id = '${ORG_A}'`);
sql(`select (public.submit_plus_inquiry('${KEY}', 'handoff-inq-${STAMP}', ${VER}, '${TAG} Daughter Dee', '${PHONE}', null, 'either', 'family', 'quote', null, 'this_week', 'Rides for my mother (fictional).', false, false, '{}'::jsonb)).*`);
const INQ = one(`select id from plus_inquiries where idempotency_key = 'handoff-inq-${STAMP}'`);
const CONV = asUser(U.a1, `select (r).opportunity_id || '|' || (r).contact_id from (select public.plus_convert_inquiry('${ORG_A}', '${INQ}', 1, 'create', null, true, false, '${TAG} Dee — dialysis rides', null, false) r) s`);
const [OPP1, C1] = CONV.split("|");
sql(`delete from plus_inquiry_public_access where organization_id = '${ORG_A}'`);
const Q = asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${OPP1}', 'handoff-q-${STAMP}', 'quote', 'dialysis', true, 12, 4000, 1500, 0, 0, 1000, 0, 0, 0, null, 0, null, current_date + 30)).quote_id`);
asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${Q}', (select updated_at from public.plus_quotes where id = '${Q}'), false)).status`);
asUser(U.a1, `select (public.plus_record_quote_response('${ORG_A}', '${Q}', (select updated_at from public.plus_quotes where id = '${Q}'), 'accepted')).status`);
const QNUM = one(`select quote_number from plus_quotes where id = '${Q}'`);
// opportunity 2: an individual contact, no inquiry, no quote (missing-data path)
const C2 = one(`insert into plus_contacts (organization_id, display_name, phone, contact_kind, created_by) values ('${ORG_A}', '${TAG} Walk In Wally', '(404) 555-0188', 'individual', '${U.a1}') returning id`);
const OPP2 = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} Wally ride', 'phone', '${C2}', '${U.a1}') returning id`);
// opportunity 3 / 4: forged foreign passenger + deactivation race
const OPP3 = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} Forged ride', 'phone', '${C2}', '${U.a1}') returning id`);
const OPP4 = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} Race ride', 'phone', '${C2}', '${U.a1}') returning id`);
// opportunity 5 / 6: new-rider name (D1) and "the requester is the rider" (D3)
const OPP5 = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} New rider ride', 'phone', '${C2}', '${U.a1}') returning id`);
const OPP6 = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} Self rider ride', 'phone', '${C2}', '${U.a1}') returning id`);
check("FX fixtures: inquiry-born opportunity (family) with accepted round-trip quote, 5 more opportunities, 5 passengers", [P_MATCH, OPP1, C1, Q, OPP2, OPP3, OPP4, OPP5, OPP6].every((v) => /^[0-9a-f-]{36}$/.test(v)), CONV);

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
async function go(p, w = 1440, h = 1100) { await s.setViewport(w, h); await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
async function open(name, email) { const x = await newChromeSession(`handoff-${name}`); sessions.push(x); await x.setViewport(1440, 1100); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical`, serious.length === 0, JSON.stringify(serious));
}
async function openConvert(opp) {
  await go(`/operations/growth/pipeline/${opp}`);
  await click('[data-testid="convert-open"]');
  return waitFor(() => has('dialog[open] [data-testid="booking-form"]'), 8000);
}
async function fillAndReview(pickup = `${TAG} 12 Fictional Lane`, dest = "Fictional Dialysis Center") {
  await setValue('[data-testid="booking-pickup"]', pickup);
  await setValue('[data-testid="booking-destination"]', dest);
  await sleep(200);
}
const requestOf = (opp) => one(`select request_id from plus_request_attributions where opportunity_id = '${opp}' and link_method = 'converted_from_opportunity'`);

try {
  // ============================================================== prefill + passenger choice
  section("conversion with prefill and a confirmed passenger");
  s = await open("a1", "org-a-admin@example.test");
  await openConvert(OPP1);
  const f = await ev(`(function(){const d=document.querySelector('dialog[open]'); const sel=d.querySelector('[data-testid="booking-passenger-select"]'); return {
    rel: d.querySelector('[data-testid="booking-relationship"]').value, ret: d.querySelector('[data-testid="booking-return"]').value,
    notes: d.querySelector('[data-testid="booking-prefill-notes"]')?.innerText ?? '', selected: sel.value,
    options: [...sel.options].map(o => o.value + '|' + o.textContent), pickupHelp: d.innerText.includes('Not stored in Growth') };})()`);
  check("H1 'Who is requesting' prefilled from the inquiry (family) and return trip 'yes' from the accepted round-trip quote, with source notes",
    f.rel === "family" && f.ret === "yes" && /website inquiry/.test(f.notes) && new RegExp(`quote ${QNUM} was priced as a round trip`).test(f.notes), JSON.stringify(f));
  const optIds = f.options.map((o) => o.split("|")[0]);
  check("H2 passenger choice: nothing pre-selected; phone match listed first and labelled; inactive and other-organization passengers never offered",
    f.selected === "" && optIds[0] === "" && optIds[1] === P_MATCH && /same phone as the contact/.test(f.options[1]) && optIds.includes(P_OTHER) && !optIds.includes(P_INACTIVE) && !optIds.includes(P_FOREIGN), JSON.stringify(f.options.slice(0, 4)));
  check("H3 missing data is explicit: pickup / destination say they are not stored in Growth and stay empty", f.pickupHelp && (await ev(`document.querySelector('[data-testid="booking-pickup"]').value`)) === "");
  const fam = await ev(`({ name: document.querySelector('[data-testid="booking-rider-name"]')?.value, self: document.querySelector('[data-testid="booking-rider-is-requester"]')?.checked })`);
  check("H3b family requester: the rider is NEVER assumed to be the requester (rider name empty, 'requester is the rider' unticked)", fam.name === "" && fam.self === false, JSON.stringify(fam));
  await fillAndReview();
  await setValue('[data-testid="booking-passenger-select"]', P_MATCH); await sleep(300);
  check("H4 choosing a passenger requires explicit confirmation: Review stays disabled until confirmed; the new-rider name field is hidden",
    (await has('[data-testid="booking-passenger-confirm"]')) && (await ev(`document.querySelector('[data-testid="booking-review"]').disabled`)) === true && !(await has('[data-testid="booking-rider-name"]')));
  await s.screenshot(path.join(SHOTS, "h01-convert-prefill-passenger.png"));
  await axe("conversion dialog with passenger choice");
  await click('[data-testid="booking-passenger-confirm"]'); await sleep(200);
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  check("H5 review shows the passenger that will be linked", /HANDOFF Rose Mother \(will be linked\)/.test(await text('[data-testid="booking-summary"]')));
  await click('[data-testid="booking-confirm"]');
  await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  const R1 = requestOf(OPP1);
  const r1 = one(`select state || '|' || coalesce(passenger_id::text,'-') || '|' || requester_relationship || '|' || return_trip_needed || '|' || (select count(*) from trips where request_id = '${R1}') from transportation_requests where id = '${R1}'`);
  check("H6 ONE pending Core Request (not approved, no trip) with the confirmed passenger linked atomically, family / return yes, attribution kept",
    r1 === `pending|${P_MATCH}|family|yes|0` && /Passenger linked/.test(await text('[data-testid="booking-passenger-result"]')) && one(`select stage from plus_opportunities where id = '${OPP1}'`) === "converted", r1);
  await s.screenshot(path.join(SHOTS, "h02-convert-success.png"));

  // ============================================================== Core: request ready, accept, schedule, complete
  section("core + billing");
  await go(`/operations/requests/${R1}`);
  const rq = await text("main");
  check("C1 request page: passenger linked (no 'Passenger needed'), Growth link shows the opportunity, decision still with Operations",
    !/Passenger needed/.test(rq) && /HANDOFF Rose Mother/.test(rq) && /HANDOFF Dee/.test(rq) && (await ev(`[...document.querySelectorAll('button')].some(b => /Accept Request/.test(b.innerText))`)));
  await s.screenshot(path.join(SHOTS, "h03-request-ready.png"));
  asUser(U.a1, `select public.accept_transportation_request('${ORG_A}', '${R1}')`);
  const T = asUser(U.a1, `select (public.create_trip('${ORG_A}', '${P_MATCH}', '${TAG} 12 Fictional Lane', 'Fictional Dialysis Center', now() + interval '7 days', null, null, null, null, null, '${R1}', 30, false)).trip_id`);
  asUser(U.a1, `select (public.assign_trip('${T}', '${DRIVER}', '${VAN}')).*`);
  for (const [fn, st] of [["driver_start_to_pickup", "scheduled"], ["driver_arrive_at_pickup", "en_route_to_pickup"], ["driver_mark_passenger_onboard", "arrived_at_pickup"], ["driver_start_to_destination", "passenger_onboard"], ["driver_arrive_at_destination", "en_route_to_destination"], ["driver_complete_trip", "arrived_at_destination"]]) asUser(U.a3, `select (public.${fn}('${T}', '${st}')).*`);
  check("C2 staff accepted, scheduled with the linked passenger, driver completed", one(`select state || '|' || passenger_id from trips where id = '${T}'`) === `completed|${P_MATCH}`);
  await go(`/operations/trips/${T}`);
  check("C3 completed Trip Detail offers the existing Billing entry point", await has('[data-testid="trip-billing-create"]'));
  await click('[data-testid="trip-billing-create"]'); await waitFor(() => has('[data-testid="billing-new-form"]'), 10000); await sleep(600);
  check("C4 billing offers the ORIGINATING quote for import (request → opportunity → quote relationship preserved)",
    await ev(`[...document.querySelectorAll('[data-testid="billing-new-quote"] option')].some(o => o.value === ${JSON.stringify(Q)})`));
  await setValue('[data-testid="billing-new-quote"]', Q);
  await click('[data-testid="billing-new-submit"]'); await waitFor(() => has('[data-testid="billing-draft-editor"]'), 15000);
  check("C5 draft invoice created from the trip with the quote's lines (source quote, number kept); not issued", one(`select i.status || '|' || i.source_quote_number || '|' || (select count(*) from billing_invoice_lines l where l.invoice_id = i.id and l.source = 'quote') from billing_invoices i join billing_invoice_trips t on t.invoice_id = i.id where t.trip_id = '${T}'`) === `draft|${QNUM}|3`);
  await s.screenshot(path.join(SHOTS, "h04-billing-from-quote.png"));

  // ============================================================== decide later + missing data
  section("decide later / missing data");
  await openConvert(OPP2);
  const f2 = await ev(`(function(){const d=document.querySelector('dialog[open]'); return { rel: d.querySelector('[data-testid="booking-relationship"]').value, ret: d.querySelector('[data-testid="booking-return"]').value, notes: !!d.querySelector('[data-testid="booking-prefill-notes"]') };})()`);
  check("M1 no inquiry / no quote / individual contact: nothing suggested (existing defaults, no notes)", f2.rel === "self" && f2.ret === "no" && !f2.notes, JSON.stringify(f2));
  await click('[data-testid="booking-review"]');
  check("M2 Review blocked until pickup and destination are entered", (await ev(`document.querySelector('[data-testid="booking-review"]').disabled`)) === true);
  await fillAndReview(`${TAG} 3 Walk Way`, "Fictional Clinic A");
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  check("M3 review states the passenger is not chosen yet", /Not chosen — link or add on the request page/.test(await text('[data-testid="booking-summary"]')));
  await click('[data-testid="booking-confirm"]'); await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  const R2 = requestOf(OPP2);
  check("M4 decide-later keeps today's flow: pending request without passenger; no link message", one(`select state || '|' || coalesce(passenger_id::text, '-') from transportation_requests where id = '${R2}'`) === "pending|-" && !(await has('[data-testid="booking-passenger-result"]')));

  // ============================================================== forged foreign passenger (database tenant isolation)
  section("isolation + races");
  await openConvert(OPP3);
  await fillAndReview(`${TAG} 4 Forge Rd`, "Fictional Clinic A");
  await ev(`(function(){const sel=document.querySelector('[data-testid="booking-passenger-select"]'); const o=document.createElement('option'); o.value=${JSON.stringify(P_FOREIGN)}; o.textContent='forged'; sel.appendChild(o);})()`);
  await setValue('[data-testid="booking-passenger-select"]', P_FOREIGN); await sleep(200);
  // the forged id is not in the dialog's list, so no confirmation box renders: post it directly through the hidden field
  await ev(`(function(){const f=document.querySelector('[data-testid="booking-form"]'); const c=f.querySelector('input[name="passengerConfirmed"]'); c.value='yes';})()`);
  await ev(`(function(){const f=document.querySelector('[data-testid="booking-form"]'); const b=document.createElement('button'); b.type='submit'; b.id='forge-submit'; b.hidden=true; f.appendChild(b); b.click();})()`);
  await waitFor(async () => /Not created/.test(await ev(`document.querySelector('dialog[open]')?.innerText ?? ''`)), 15000);
  const notCreated = async (opp, pickup) => ({
    ui: await ev(`document.querySelector('dialog[open]')?.innerText ?? ''`),
    req: requestOf(opp),
    rows: one(`select count(*) from transportation_requests where pickup_description = '${pickup}'`),
    stage: one(`select stage from plus_opportunities where id = '${opp}'`),
  });
  const i1 = await notCreated(OPP3, `${TAG} 4 Forge Rd`);
  check("I1 a forged OTHER-ORGANIZATION passenger id is refused by the database and NOTHING is created (no request, no attribution, opportunity not converted), neutral message",
    i1.req === "" && i1.rows === "0" && i1.stage !== "converted" && /Not created/.test(i1.ui) && /isn't available any more/.test(i1.ui) && !/Other Org Rose|ZW0/.test(i1.ui), JSON.stringify({ ...i1, ui: i1.ui.slice(0, 160) }));
  // deactivation race: chosen + confirmed, then the passenger is deactivated before submitting
  await openConvert(OPP4);
  await fillAndReview(`${TAG} 5 Race Rd`, "Fictional Clinic A");
  await setValue('[data-testid="booking-passenger-select"]', P_RACE); await sleep(200);
  await click('[data-testid="booking-passenger-confirm"]'); await sleep(200);
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  sql(`update passengers set status = 'inactive' where id = '${P_RACE}'`);
  await click('[data-testid="booking-confirm"]'); await waitFor(async () => /Not created/.test(await ev(`document.querySelector('dialog[open]')?.innerText ?? ''`)), 15000);
  const i2 = await notCreated(OPP4, `${TAG} 5 Race Rd`);
  check("I2 passenger deactivated before submit: the whole conversion rolls back (no request, opportunity not converted), 'isn't available' message",
    i2.req === "" && i2.rows === "0" && i2.stage !== "converted" && /isn't available any more/.test(i2.ui), JSON.stringify({ ...i2, ui: i2.ui.slice(0, 160) }));
  // same form, same key: choose "decide later" instead -> the conversion now succeeds (the refused attempt left nothing behind)
  // the refusal returned the person to the fields (passenger error shown); nothing to undo
  const i2c = await ev(`({ ui: document.querySelector('dialog[open]')?.innerText ?? '', passenger: document.querySelector('[data-testid="booking-passenger-select"]')?.value, ret: document.querySelector('[data-testid="booking-return"]')?.value, rel: document.querySelector('[data-testid="booking-relationship"]')?.value, pickup: document.querySelector('[data-testid="booking-pickup"]')?.value, confirm: !!document.querySelector('[data-testid="booking-passenger-confirm"]') })`);
  check("I2c the refusal returns staff to the fields: refused passenger cleared with a field message; every other entry kept and shown as entered (no form reset)",
    /Choose again, or decide on the request page/.test(i2c.ui) && i2c.passenger === "" && !i2c.confirm && i2c.ret === "no" && i2c.rel === "self" && i2c.pickup === `${TAG} 5 Race Rd`, JSON.stringify({ ...i2c, ui: undefined }));
  await s.screenshot(path.join(SHOTS, "h06-passenger-refused-nothing-created.png"));
  await waitFor(() => has('[data-testid="booking-passenger-select"]'), 5000);
  await setValue('[data-testid="booking-passenger-select"]', ""); await sleep(200);
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  await click('[data-testid="booking-confirm"]'); await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  check("I2b after the refusal, retrying with 'decide later' converts normally: exactly ONE request, no passenger",
    one(`select count(*) || '|' || coalesce(max(passenger_id::text), '-') from transportation_requests where pickup_description = '${TAG} 5 Race Rd'`) === "1|-" && requestOf(OPP4) !== "");
  // database-level refusals (SQL as the staff member): each leaves no request behind
  const before = one(`select count(*) from transportation_requests where organization_id = '${ORG_A}'`);
  const rpcErr = (stmt) => { try { return asUser(U.a1, stmt); } catch (e) { return String(e.stderr ?? e.message ?? e); } };
  const conv = (opp, key, passenger, name) => `select (public.plus_convert_opportunity_to_request('${ORG_A}', '${opp}', (select updated_at from plus_opportunities where id = '${opp}'), '${key}', 'self', '${TAG} sql', 'y', 'no', null, null, null, null, ${passenger ? `'${passenger}'` : "null"}, ${name === null ? "null" : `'${name}'`})).request_id`;
  const both = rpcErr(conv(OPP5, `handoff-both-${STAMP}`, P_OTHER, "Somebody"));
  const ctrl = rpcErr(conv(OPP5, `handoff-ctrl-${STAMP}`, null, "Bad' || chr(10) || 'Name"));
  const long = rpcErr(conv(OPP5, `handoff-long-${STAMP}`, null, "x".repeat(201)));
  const inact = rpcErr(`select (public.plus_create_rebooking_request('${ORG_A}', '${C1}', 'handoff-rbi-${STAMP}', 'self', '${TAG} sql', 'y', 'no', 'phone', null, null, null, null, null, '${P_INACTIVE}', null)).request_id`);
  const foreignRb = rpcErr(`select (public.plus_create_rebooking_request('${ORG_A}', '${C1}', 'handoff-rbf-${STAMP}', 'self', '${TAG} sql', 'y', 'no', 'phone', null, null, null, null, null, '${P_FOREIGN}', null)).request_id`);
  check("I4 RPC refusals with nothing created: passenger AND name together (invalid_input), control characters / 201 characters (invalid_passenger_name), inactive / foreign passenger on rebooking (passenger_unavailable)",
    /invalid_input/.test(both) && /invalid_passenger_name/.test(ctrl) && /invalid_passenger_name/.test(long) && /passenger_unavailable/.test(inact) && /passenger_unavailable/.test(foreignRb)
      && one(`select count(*) from transportation_requests where organization_id = '${ORG_A}'`) === before && one(`select stage from plus_opportunities where id = '${OPP5}'`) !== "converted",
    [both, ctrl, long, inact, foreignRb].map((x) => x.match(/invalid_input|invalid_passenger_name|passenger_unavailable/)?.[0] ?? x.slice(0, 60)).join(","));
  // replay: same idempotency key again with a different passenger -> the original request, passenger NOT changed
  const replay = asUser(U.a1, `select (public.plus_convert_opportunity_to_request('${ORG_A}', '${OPP1}', (select updated_at from plus_opportunities where id = '${OPP1}'), (select conversion_idempotency_key from plus_request_attributions where opportunity_id = '${OPP1}'), 'family', 'x', 'y', 'no', null, null, null, null, '${P_OTHER}', null)).changed`);
  check("I3 replay of the conversion with a DIFFERENT passenger returns the original request (changed=false); its passenger is unchanged and no second request exists",
    replay === "f" && one(`select passenger_id from transportation_requests where id = '${R1}'`) === P_MATCH && one(`select count(*) from plus_request_attributions where opportunity_id = '${OPP1}'`) === "1", replay);

  // ============================================================== D1: new rider's name -> Core Add New Passenger prefill
  section("new rider name (D1) + requester is the rider (D3)");
  await openConvert(OPP5);
  await fillAndReview(`${TAG} 6 New Rider Rd`, "Fictional Clinic B");
  await setValue('[data-testid="booking-rider-name"]', `${TAG} Nia Newrider`); await sleep(200);
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  check("N1 review shows the new rider's name (added on the request page), not a linked passenger", /HANDOFF Nia Newrider \(new — added on the request page\)/.test(await text('[data-testid="booking-summary"]')));
  await click('[data-testid="booking-confirm"]'); await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  const R5 = requestOf(OPP5);
  check("N2 request created PENDING with NO passenger and the rider-name snapshot; no passenger created in Growth; success note says so",
    one(`select state || '|' || coalesce(passenger_id::text, '-') || '|' || coalesce(requested_passenger_name, '-') from transportation_requests where id = '${R5}'`) === `pending|-|${TAG} Nia Newrider`
      && one(`select count(*) from passengers where display_name like '%Nia Newrider%'`) === "0" && /Rider's name recorded/.test(await text('[data-testid="booking-passenger-result"]')));
  await go(`/operations/requests/${R5}`);
  const rq5 = await text("main");
  await ev(`[...document.querySelectorAll('button')].find(b => /Add New Passenger/.test(b.innerText))?.click()`);
  await waitFor(() => has('dialog[open] input'), 5000);
  const prefill = await ev(`[...document.querySelectorAll('dialog[open] input')].map(i => i.value).filter(Boolean).join('|')`);
  check("N3 Core request page: 'Passenger needed' with 'Requested passenger: Nia'; Add New Passenger is prefilled with that name (Core still creates it)",
    /Passenger needed/.test(rq5) && /Requested passenger/.test(rq5) && /HANDOFF Nia Newrider/.test(rq5) && prefill.includes(`${TAG} Nia Newrider`), prefill);
  await s.screenshot(path.join(SHOTS, "h07-core-add-new-passenger-prefill.png"));
  // D3: requester is the rider -- suggested, editable, only after the explicit tick
  await openConvert(OPP6);
  await fillAndReview(`${TAG} 7 Self Rd`, "Fictional Clinic B");
  const d3a = await ev(`({ name: document.querySelector('[data-testid="booking-rider-name"]').value, rel: document.querySelector('[data-testid="booking-relationship"]').value })`);
  await click('[data-testid="booking-rider-is-requester"]'); await sleep(200);
  const d3b = await ev(`({ name: document.querySelector('[data-testid="booking-rider-name"]').value, rel: document.querySelector('[data-testid="booking-relationship"]').value })`);
  await setValue('[data-testid="booking-relationship"]', "family"); await sleep(200);
  const d3c = await ev(`({ name: document.querySelector('[data-testid="booking-rider-name"]').value, self: document.querySelector('[data-testid="booking-rider-is-requester"]').checked })`);
  check("N4 'requester is the rider' is never assumed: empty until ticked; ticking suggests the contact's name and 'Self'; switching to Family unticks and removes the suggestion",
    d3a.name === "" && d3b.name === `${TAG} Walk In Wally` && d3b.rel === "self" && d3c.name === "" && d3c.self === false, JSON.stringify([d3a, d3b, d3c]));
  await click('[data-testid="booking-rider-is-requester"]'); await sleep(200);
  await setValue('[data-testid="booking-rider-name"]', `${TAG} Wallace Walk In`); await sleep(200);
  await s.screenshot(path.join(SHOTS, "h08-requester-is-rider.png"));
  await axe("conversion dialog with the requester-is-rider choice");
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  await click('[data-testid="booking-confirm"]'); await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  check("N5 the staff-edited name is what Core records (self, snapshot 'Wallace Walk In', no passenger linked or created)",
    one(`select requester_relationship || '|' || coalesce(passenger_id::text, '-') || '|' || coalesce(requested_passenger_name, '-') from transportation_requests where id = '${requestOf(OPP6)}'`) === `self|-|${TAG} Wallace Walk In`
      && one(`select count(*) from passengers where display_name like '%Wall%'`) === "0");

  // ============================================================== rebooking: "rode before"
  section("rebooking");
  await go(`/operations/growth/contacts/${C1}`);
  await click('[data-testid="rebook-open"]'); await waitFor(() => has('dialog[open] [data-testid="booking-form"]'), 8000);
  const rb = await ev(`(function(){const sel=document.querySelector('dialog[open] [data-testid="booking-passenger-select"]'); return { selected: sel.value, first: sel.options[1]?.value + '|' + sel.options[1]?.textContent };})()`);
  check("RB1 rebooking for a repeat customer suggests the passenger who rode before first, still not pre-selected", rb.selected === "" && rb.first.startsWith(P_MATCH) && /rode before for this contact/.test(rb.first), JSON.stringify(rb));
  await s.screenshot(path.join(SHOTS, "h05-rebook-rode-before.png"));
  await setValue('[data-testid="booking-passenger-select"]', P_MATCH); await sleep(200);
  await click('[data-testid="booking-passenger-confirm"]'); await sleep(200);
  await fillAndReview(`${TAG} 8 Rebook Rd`, "Fictional Dialysis Center");
  await click('[data-testid="booking-review"]'); await waitFor(() => has('[data-testid="booking-summary"]'), 5000);
  await click('[data-testid="booking-confirm"]'); await waitFor(() => has('[data-testid="booking-success"]'), 15000);
  check("RB2 rebooking with the confirmed passenger: ONE new pending request linked atomically to the rebooking attribution",
    one(`select count(*) || '|' || max(r.state) || '|' || max(r.passenger_id::text) from transportation_requests r join plus_request_attributions a on a.request_id = r.id and a.link_method = 'rebooking' where r.pickup_description = '${TAG} 8 Rebook Rd'`) === `1|pending|${P_MATCH}`);

  // ============================================================== authorization
  section("authorization");
  sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) select '${ORG_A}', id, 'plus', 'read', '${U.a1}' from memberships where user_id = '${U.a2}' and organization_id = '${ORG_A}'`);
  s = await open("a2", "org-a-dispatcher@example.test");
  await go(`/operations/growth/contacts/${C1}`);
  check("A1 read-only Growth grant: no conversion / rebooking dialog (no passenger list exposed)", !(await has('[data-testid="rebook-open"]')) && !(await has('[data-testid="booking-passenger-select"]')));
  const forgedLink = (() => { try { return asUser(U.a2, `select (public.plus_create_rebooking_request('${ORG_A}', '${C1}', 'handoff-rb-${STAMP}', 'self', 'x', 'y', 'no', 'phone', null, null, null, null, null)).request_id`); } catch (e) { return String(e.stderr ?? e).slice(0, 80); } })();
  check("A2 read-only grant cannot create a request through the RPC (ZW001)", /ZW001|unauthorized|ERROR/.test(forgedLink), forgedLink);
  check("Z1 no request was approved or scheduled automatically by any conversion", one(`select count(*) from transportation_requests where pickup_description like '${TAG}%' and state <> 'pending' and id <> '${R1}'`) === "0");
} catch (e) {
  fails++; console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  try {
    sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where organization_id = '${ORG_A}' and revoked_at is null`);
    cleanup();
    sql(`delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}')`);
  } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
