// NP-BILL-P1 -- Core private-pay billing: browser + SQL E2E on the ISOLATED stack (NemrynS1Iso + `next start -p 3100`).
// FICTIONAL data only; the plus-quotes config refuses any other target (assertFictionalSeed).
//   node tests/e2e/billing/billing.e2e.mjs
// Journey: Completed Trip -> Create invoice -> edit draft -> Issue -> partial payment -> receipt -> duplicate click ->
// reversal (reversed receipt) -> overpayment refused -> pay in full -> print; quote import (R3) + discard; void + VOID
// print; roles (dispatcher / driver / other tenant); Core-only workspace (no Plus) can bill; responsive + axe.
// Fixtures (owner SQL on the fictional seed) are removed at the end. Nothing is sent.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1" };
const P1 = "40000000-0000-0000-0000-0000000000a1", PB = "40000000-0000-0000-0000-0000000000b1", FA = "60000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
const OUT = artifactDir("billing");
const SHOTS = process.env.BILL_SCREENSHOT_DIR || OUT;
mkdirSync(SHOTS, { recursive: true });

let fails = 0, passes = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|UPDATE \d+|INSERT 0 \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
const one = (q) => first(sql(q));
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }

// ---------------------------------------------------------------- fixtures
const LABEL = `BILLE2E-${STAMP}`;
function cleanup() {
  sql(`
    set session_replication_role = replica;
    delete from billing_payments where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_lines where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_trips where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoices where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_counters where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from plus_quotes where organization_id = '${ORG_A}' and idempotency_key like 'bille2e-%';
    delete from plus_request_attributions where organization_id = '${ORG_A}' and request_id in (select id from transportation_requests where pickup_description like 'BILLE2E-%');
    delete from plus_opportunities where organization_id = '${ORG_A}' and title like 'BILLE2E%';
    delete from plus_contacts where organization_id = '${ORG_A}' and display_name like 'BILLE2E%';
    delete from trips where pickup_description like 'BILLE2E-%';
    delete from transportation_requests where pickup_description like 'BILLE2E-%';
    delete from passengers where display_name like 'BILLE2E%';
    set session_replication_role = origin;
  `);
}
cleanup();
sql(`delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');
     insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'billing e2e (quote import only)');`);
const P2 = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', 'BILLE2E Second Rider', '(404) 555-0122') returning id`);
const R = one(`insert into transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, requester_email, pickup_description, destination_description, return_trip_needed, state, source, passenger_id)
  values ('${ORG_A}', 'Fictional Daughter Payer', 'family', '(404) 555-0190', 'payer@example.test', '${LABEL} request pickup', 'Fictional Clinic A', 'yes', 'accepted', 'phone', '${P1}') returning id`);
const trip = (org, pass, tag, { req = null, fac = null, state = "completed", hoursAgo = 30 } = {}) =>
  one(`insert into trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at, request_id, destination_facility_id)
       values ('${org}', '${pass}', '${state}', '${LABEL}-${tag} 12 Fictional Lane', 'Fictional Clinic A', now() - interval '${hoursAgo} hours', ${state === "completed" ? `now() - interval '${hoursAgo - 1} hours'` : "null"}, ${req ? `'${req}'` : "null"}, ${fac ? `'${fac}'` : "null"}) returning id`);
const T1 = trip(ORG_A, P1, "T1", { req: R, fac: FA, hoursAgo: 50 });
const T2 = trip(ORG_A, P1, "T2", { req: R, fac: FA, hoursAgo: 40 });
const T3 = trip(ORG_A, P1, "T3", { hoursAgo: 30 });
const T4 = trip(ORG_A, P2, "T4", { hoursAgo: 20 });
const T5 = trip(ORG_A, P1, "T5", { req: R, fac: FA, hoursAgo: 10 });
const TS = trip(ORG_A, P1, "TS", { state: "scheduled", hoursAgo: -24 });
const TB = trip(ORG_B, PB, "TB", { hoursAgo: 15 });
// quote fixture: contact + opportunity attributed to R, a SENT quote created through the Plus RPCs
const C = one(`insert into plus_contacts (organization_id, display_name, phone, contact_kind, created_by) values ('${ORG_A}', 'BILLE2E Daughter Payer', '(404) 555-0190', 'family_caregiver', '${U.a1}') returning id`);
const O = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', 'BILLE2E dialysis rides', 'phone', '${C}', '${U.a1}') returning id`);
sql(`insert into plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, linked_by) values ('${R}', '${ORG_A}', '${C}', '${O}', 'linked_existing_request', '${U.a1}')`);
const Q = asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${O}', 'bille2e-q-${STAMP}', 'quote', 'dialysis', false, 12.5, 4000, 1500, 0, 0, 1000, 0, 0, 0, null, 500, null, current_date + 30)).quote_id`);
asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${Q}', (select updated_at from public.plus_quotes where id = '${Q}'), false)).status`);
const QNUM = one(`select quote_number from plus_quotes where id = '${Q}'`);
const tripStates0 = one(`select string_agg(state, ',' order by id) from trips where pickup_description like '${LABEL}-%'`);
check("FX fixtures: 6 Org A + 1 Org B trips, a request, a sent Plus quote linked to it", [T1, T2, T3, T4, T5, TS, TB, R, Q].every((v) => /^[0-9a-f-]{36}$/.test(v)), `${T1} ${Q}`);

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
async function go(p, w = 1440, h = 1100) { await s.setViewport(w, h); await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
async function open(name, email, w = 1440, h = 1100) { const x = await newChromeSession(`bill-${name}`); sessions.push(x); await x.setViewport(w, h); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function shot(name) { await s.screenshot(path.join(SHOTS, `${name}.png`)); }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target?.join(' ') })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower: ${res.map((v) => v.id).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
const noHScroll = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const invoiceOf = (tripId) => one(`select l.invoice_id from billing_invoice_trips l where l.trip_id = '${tripId}' and l.released_at is null`);
const balanceText = () => text('[data-testid="billing-balance"]');
async function payDialog(amount, { method = "check", reference = "", submitTwice = false } = {}) {
  await click('[data-testid="billing-payment-open"]');
  await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('dialog[open] [data-testid="billing-payment-amount"]', amount);
  await setValue('dialog[open] select[name="method"]', method);
  if (reference) await setValue('dialog[open] input[name="reference"]', reference);
  if (submitTwice) await ev(`(function(){const b=document.querySelector('[data-testid="billing-payment-submit"]'); b.click(); b.click();})()`);
  else await click('[data-testid="billing-payment-submit"]');
  await waitFor(async () => !(await has('dialog[open] [data-testid="billing-payment-form"]')) || (await has('[data-testid="billing-payment-message"]')), 15000);
  await sleep(800);
}

try {
  // ============================================================== navigation + Ready to invoice
  section("billing page");
  s = await open("a1", "org-a-admin@example.test");
  await go("/operations/billing");
  const navItems = await ev(`[...document.querySelectorAll('nav[aria-label="Primary"] a')].map(a => a.getAttribute('href'))`);
  check("N1 Admin sidebar has Administration → Billing (/operations/billing)", navItems.includes("/operations/billing"), JSON.stringify(navItems));
  const ready = await text("main");
  check("N2 summary tiles + Ready to invoice lists the completed, uninvoiced trips (not the scheduled one, not Org B's)",
    (await has('[data-testid="billing-summary"]')) && (await ev(`document.querySelectorAll('[data-testid="billing-create-invoice"]').length`)) >= 5 && !ready.includes(`${LABEL}-TS`) && !ready.includes(`${LABEL}-TB`));
  await shot("b01-billing-ready");
  await axe("billing ready");

  // ============================================================== Trip Detail -> Create invoice
  section("create");
  await go(`/operations/trips/${T1}`);
  check("C1 completed Trip Detail shows the Billing panel with Create invoice (admin)", (await has('[data-testid="trip-billing-panel"]')) && (await has('[data-testid="trip-billing-create"]')));
  await click('[data-testid="trip-billing-create"]');
  await waitFor(() => has('[data-testid="billing-new-form"]'), 10000); await sleep(800);
  const newForm = await ev(`(function(){const f=document.querySelector('[data-testid="billing-new-form"]'); return { trips: [...f.querySelectorAll('input[name="tripId"]')].map(i => i.value + ':' + i.checked), billTo: [...f.querySelectorAll('input[name="billTo"]')].map(i => i.value.split(':')[0] + ':' + i.checked), quote: !!f.querySelector('[data-testid="billing-new-quote"]') };})()`);
  const tripIds = newForm.trips.map((t) => t.split(":")[0]);
  check("C2 new-invoice form: only this passenger's uninvoiced completed trips (T1 pre-selected; no T4 other passenger, no Org B, no scheduled)",
    newForm.trips.includes(`${T1}:true`) && tripIds.includes(T2) && tripIds.includes(T3) && !tripIds.includes(T4) && !tripIds.includes(TB) && !tripIds.includes(TS), JSON.stringify(newForm));
  check("C3 bill-to choices: passenger, requester (default for a requested trip), facility, someone else; quote option offered (Plus)",
    JSON.stringify(newForm.billTo.map((b) => b.split(":")[0]).filter((v, i, a) => a.indexOf(v) === i)) === JSON.stringify(["passenger", "requester", "facility", "other"])
    && newForm.billTo.includes("requester:true") && newForm.quote, JSON.stringify(newForm.billTo));
  await shot("b02-create-invoice");
  await axe("create invoice");
  await click(`input[name="tripId"][value="${T2}"]`);
  await click('[data-testid="billing-new-submit"]');
  await waitFor(() => has('[data-testid="billing-draft-editor"]'), 15000); await sleep(800);
  const INV1 = invoiceOf(T1);
  check("C4 draft created for T1 + T2, billed to the requester; one trip line each; no number yet",
    INV1 && INV1 === invoiceOf(T2) && one(`select status || '|' || coalesce(invoice_number::text, '-') || '|' || bill_to_kind || '|' || bill_to_name || '|' || (select count(*) from billing_invoice_lines where invoice_id = '${INV1}' and source = 'trip') from billing_invoices where id = '${INV1}'`) === "draft|-|requester|Fictional Daughter Payer|2"
    && (await has('[data-testid="billing-created"]')));

  // ============================================================== edit + issue
  section("draft + issue");
  const prices = await ev(`[...document.querySelectorAll('[data-testid="billing-line-price"]')].length`);
  await ev(`(function(){const els=[...document.querySelectorAll('[data-testid="billing-line-price"]')]; for (const el of els) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'45.00'); el.dispatchEvent(new Event('input',{bubbles:true})); }})()`);
  await click('[data-testid="billing-add-line"]'); await sleep(300);
  await ev(`(function(){const rows=[...document.querySelectorAll('[data-testid="billing-draft-line"]')]; const r=rows[rows.length-1]; const ins=r.querySelectorAll('input'); const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; set(ins[0],'Mileage'); set(ins[1],'12.5'); set(ins[2],'1.99');})()`);
  await setValue('input[name="discount"]', "5");
  await sleep(300);
  const preview = await text('[data-testid="billing-draft-total"]');
  await click('[data-testid="billing-draft-save"]');
  await waitFor(async () => /Draft saved/.test(await text('[data-testid="billing-draft-message"]')), 10000);
  const tot = one(`select subtotal_cents || '|' || discount_cents || '|' || total_cents from billing_invoices where id = '${INV1}'`);
  check("D1 draft edited: 2 x $45.00 + 12.5 x $1.99 ($24.88, half-up) − $5.00 = $109.88; preview equals server total", prices === 2 && tot === "11488|500|10988" && preview === "$109.88", `${tot} preview=${preview}`);
  await shot("b03-draft-editor");
  await axe("draft editor");
  await go(`/operations/billing/invoices/${INV1}`);
  await click('[data-testid="billing-issue-open"]');
  await waitFor(() => has('[data-testid="billing-issue-confirm"]'), 5000);
  await click('[data-testid="billing-issue-confirm"]');
  await waitFor(async () => !(await has('[data-testid="billing-draft-editor"]')) && (await has('[data-testid="billing-invoice-lines"]')), 15000); await sleep(800);
  const iss = one(`select status || '|' || invoice_number || '|' || (due_date - issue_date) from billing_invoices where id = '${INV1}'`);
  check("D2 issued: INV-000001, due 15 days after issue (D6); editor gone (frozen); Print + Record payment offered",
    iss === "issued|1|15" && /INV-000001/.test(await text("main h1")) && (await has('[data-testid="billing-print-invoice"]')) && (await has('[data-testid="billing-payment-open"]')) && !(await has('input[name="discount"]')), iss);
  await shot("b04-issued-invoice");
  await axe("issued invoice");

  // ============================================================== payments
  section("payments");
  await payDialog("50.00", { reference: "CHK-1001" });
  check("P1 partial payment $50.00 -> Partially paid, balance $59.88", (await balanceText()) === "$59.88" && /Partially paid/.test(await text('[data-testid="billing-invoice-summary"]')));
  await payDialog("10.00", { method: "cash", submitTwice: true });
  const nPay = one(`select count(*) from billing_payments where invoice_id = '${INV1}' and entry_kind = 'payment'`);
  check("P2 a double-clicked payment is recorded ONCE (idempotency key per dialog)", nPay === "2" && (await balanceText()) === "$49.88", `${nPay} ${await balanceText()}`);
  await click('[data-testid="billing-payment-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('dialog[open] [data-testid="billing-payment-amount"]', "1000.00"); await click('[data-testid="billing-payment-submit"]');
  await waitFor(() => has('[data-testid="billing-payment-message"]'), 10000);
  check("P3 overpayment refused with a plain message; nothing recorded", /more than the balance/.test(await text('[data-testid="billing-payment-message"]')) && one(`select count(*) from billing_payments where invoice_id = '${INV1}'`) === "2");
  await shot("b05-payment-dialog");
  await axe("payment dialog");
  await ev(`document.querySelector('dialog[open]')?.close?.()`); await go(`/operations/billing/invoices/${INV1}`);
  check("P4 Void is not offered while payments exist", !(await has('[data-testid="billing-void-open"]')));
  // reverse the $10 cash payment (the second)
  const pay10 = one(`select id from billing_payments where invoice_id = '${INV1}' and entry_kind = 'payment' and amount_cents = 1000`);
  await ev(`(function(){const rows=[...document.querySelectorAll('[data-testid="billing-payment-row"][data-kind="payment"]')]; rows[1].querySelector('[data-testid="billing-reverse-open"]').click();})()`);
  await waitFor(() => has('dialog[open] [data-testid="billing-reverse-form"]'), 5000);
  await setValue('[data-testid="billing-reverse-reason"]', "Entered twice by mistake (fictional)");
  await shot("b06-reverse-dialog");
  await click('[data-testid="billing-reverse-submit"]');
  await waitFor(async () => !(await has('dialog[open] [data-testid="billing-reverse-form"]')), 10000); await sleep(800);
  check("R1 reversal: original kept + reversal entry; balance back to $59.88; payment shows Reversed",
    one(`select count(*) from billing_payments where invoice_id = '${INV1}'`) === "3" && (await balanceText()) === "$59.88" && /Reversed/.test(await text('[data-testid="billing-invoice-payments"]')));
  await go(`/receipt-print/${pay10}`, 1000, 1200);
  check("R2 the reversed payment's receipt says PAYMENT REVERSED, not counted, not a refund", /PAYMENT REVERSED/.test(await text('[data-testid="receipt-print-reversed"]')) && /not proof of payment or of a refund/.test(await text("main")));
  await shot("b07-receipt-reversed");
  const pay50 = one(`select id from billing_payments where invoice_id = '${INV1}' and entry_kind = 'payment' and amount_cents = 5000`);
  await go(`/receipt-print/${pay50}`, 1000, 1200);
  check("R3 receipt for the $50.00 check: INV-000001-R1, amount, method, reference; no reversal banner",
    (await text('[data-testid="receipt-print-number"]')) === "INV-000001-R1" && (await text('[data-testid="receipt-print-amount"]')) === "$50.00" && /CHK-1001/.test(await text("main")) && !(await has('[data-testid="receipt-print-reversed"]')));
  await shot("b08-receipt");
  await axe("receipt print");
  await go(`/operations/billing/invoices/${INV1}`);
  await payDialog("59.88", { method: "bank_transfer", reference: "ACH-2002" });
  check("P5 remaining $59.88 -> Paid, balance $0.00, no Record payment", (await balanceText()) === "$0.00" && /Paid/.test(await text('[data-testid="billing-invoice-summary"]')) && !(await has('[data-testid="billing-payment-open"]')));
  await go(`/invoice-print/${INV1}`, 1000, 1400);
  const ip = await text('[data-testid="invoice-print"]');
  check("PR1 printable invoice: number, bill-to snapshot, lines, total $109.88, balance $0.00, reversed payment marked",
    (await text('[data-testid="invoice-print-number"]')) === "INV-000001" && (await text('[data-testid="invoice-print-billto"]')) === "Fictional Daughter Payer" && (await text('[data-testid="invoice-print-total"]')) === "$109.88" && (await text('[data-testid="invoice-print-balance"]')) === "$0.00" && /REVERSED/.test(ip));
  await shot("b09-invoice-print");
  await axe("invoice print");
  await go(`/invoice-print/${INV1}`, 390, 900);
  check("PR2 print view at 390px: no horizontal scroll", await noHScroll());

  // ============================================================== trip panel + immutability through the app
  await go(`/operations/trips/${T2}`);
  check("T1 Trip Detail of an invoiced trip links its invoice (INV-000001 · Paid); no second Create invoice", /INV-000001/.test(await text('[data-testid="trip-billing-panel"]')) && /Paid/.test(await text('[data-testid="trip-billing-panel"]')) && !(await has('[data-testid="trip-billing-create"]')));
  await shot("b10-trip-billing-panel");
  await go(`/operations/billing/new?trip=${T1}`);
  check("T2 opening Create invoice for an already-invoiced trip explains and links the invoice (no duplicate)", /already on INV-000001/.test(await text("main")) && !(await has('[data-testid="billing-new-form"]')));

  // ============================================================== quote import (R3) + discard
  section("quote import");
  await go(`/operations/billing/new?trip=${T5}`);
  await setValue('[data-testid="billing-new-quote"]', Q);
  await click('[data-testid="billing-new-submit"]');
  await waitFor(() => has('[data-testid="billing-draft-editor"]'), 15000); await sleep(800);
  const INVQ = invoiceOf(T5);
  const ql = one(`select string_agg(source || ':' || amount_cents, ',' order by position) || '|' || (select subtotal_cents || '/' || discount_cents || '/' || total_cents || '/' || source_quote_number from billing_invoices where id = '${INVQ}') from billing_invoice_lines where invoice_id = '${INVQ}'`);
  check("Q1 quote import: the quote's components become visible, editable draft lines (no duplicate trip line); discount + quote number kept",
    ql === `quote:4000,quote:1500,quote:1000|6500/500/6000/${QNUM}`
    && (await ev(`[...document.querySelectorAll('[data-testid="billing-draft-line"] input')].some(i => i.value.startsWith('Base fare'))`))
    && /From the quote/.test(await text('[data-testid="billing-draft-lines"]')), ql);
  await shot("b11-quote-import-draft");
  await click('[data-testid="billing-discard-open"]'); await waitFor(() => has('[data-testid="billing-discard-confirm"]'), 5000);
  await click('[data-testid="billing-discard-confirm"]');
  await waitFor(async () => /Draft discarded/.test(await text('[data-testid="billing-flash"]')), 15000);
  check("Q2 discarding the draft deletes it and frees the trip (no invoice number used)", one(`select count(*) from billing_invoices where id = '${INVQ}'`) === "0" && invoiceOf(T5) === "");

  // ============================================================== second invoice -> void
  section("void");
  await go(`/operations/billing/new?trip=${T4}`);
  await click('input[name="billTo"][value="other:"]'); await sleep(300);
  await setValue('[data-testid="billing-new-other-name"]', "Fictional Church Transport Fund");
  await click('[data-testid="billing-new-submit"]');
  await waitFor(() => has('[data-testid="billing-draft-editor"]'), 15000); await sleep(800);
  const INV2 = invoiceOf(T4);
  await setValue('[data-testid="billing-line-price"]', "38.50"); await sleep(200);
  await click('[data-testid="billing-draft-save"]'); await waitFor(async () => /Draft saved/.test(await text('[data-testid="billing-draft-message"]')), 10000);
  await go(`/operations/billing/invoices/${INV2}`);
  await click('[data-testid="billing-issue-open"]'); await waitFor(() => has('[data-testid="billing-issue-confirm"]'), 5000); await click('[data-testid="billing-issue-confirm"]');
  await waitFor(() => has('[data-testid="billing-void-open"]'), 15000); await sleep(500);
  check("V1 'Someone else' bill-to invoice issued as INV-000002", one(`select invoice_number || '|' || bill_to_kind || '|' || total_cents from billing_invoices where id = '${INV2}'`) === "2|other|3850");
  await click('[data-testid="billing-void-open"]'); await waitFor(() => has('[data-testid="billing-void-form"]'), 5000);
  await setValue('[data-testid="billing-void-reason"]', "Wrong payer (fictional)");
  await click('[data-testid="billing-void-submit"]');
  await waitFor(async () => /This invoice is void/.test(await text("main")), 15000);
  check("V2 voided with reason: number kept, trip free again, history kept", one(`select status || '|' || invoice_number || '|' || void_reason from billing_invoices where id = '${INV2}'`) === "void|2|Wrong payer (fictional)" && invoiceOf(T4) === "");
  await go(`/invoice-print/${INV2}`, 1000, 1200);
  check("V3 printable void invoice carries a VOID banner", /VOID/.test(await text('[data-testid="invoice-print-void"]')));

  // ============================================================== lists
  await go("/operations/billing?view=invoices&filter=paid");
  check("L1 Invoices → Paid lists INV-000001", (await ev(`[...document.querySelectorAll('[data-testid="billing-invoice-link"]')].map(a=>a.textContent).join(',')`)) === "INV-000001");
  await go("/operations/billing?view=invoices&filter=void");
  check("L2 Invoices → Void lists INV-000002", (await ev(`[...document.querySelectorAll('[data-testid="billing-invoice-link"]')].map(a=>a.textContent).join(',')`)) === "INV-000002");
  await go("/operations/billing?view=invoices&q=INV-1");
  check("L3 search by number", (await ev(`[...document.querySelectorAll('[data-testid="billing-invoice-link"]')].map(a=>a.textContent).join(',')`)) === "INV-000001");
  await go("/operations/billing?view=invoices");
  await shot("b12-invoices-list");
  await axe("invoices list");
  await go("/operations/billing?view=invoices", 820, 1100);
  check("L4 billing at 820px: no horizontal page scroll", await noHScroll());
  await go(`/operations/billing/invoices/${INV1}`, 820, 1100);
  check("L5 invoice at 820px: no horizontal page scroll", await noHScroll());
  await shot("b13-invoice-820");

  // ============================================================== roles + tenancy
  section("roles");
  s = await open("a2", "org-a-dispatcher@example.test");
  await go("/operations/billing");
  check("A1 Dispatcher: no Billing in the sidebar; /operations/billing redirects away", !(await has('nav[aria-label="Primary"] a[href="/operations/billing"]')) && !(await has('[data-testid="billing-summary"]')));
  await go(`/operations/billing/invoices/${INV1}`);
  check("A2 Dispatcher: invoice URL redirects away (no data)", !/INV-000001/.test(await text("body")));
  await go(`/invoice-print/${INV1}`);
  check("A3 Dispatcher: print URL redirects away (no data)", !(await has('[data-testid="invoice-print"]')));
  await go(`/operations/trips/${T2}`);
  check("A4 Dispatcher: Trip Detail has no Billing panel", !(await has('[data-testid="trip-billing-panel"]')));
  s = await open("a3", "org-a-driver-a@example.test");
  await go("/operations/billing");
  check("A5 Driver: no billing page", !(await has('[data-testid="billing-summary"]')));
  // Core-only workspace (Org B has NO Plus) bills its own trip; never sees Org A's
  s = await open("b1", "org-b-admin@example.test");
  await go(`/operations/billing/invoices/${INV1}`);
  const b404 = await text("body");
  await go(`/invoice-print/${INV1}`);
  const b404p = await text("body");
  await go(`/receipt-print/${pay50}`);
  check("X1 Org B admin: Org A invoice, print and receipt URLs are not found (no data)", !/INV-000001|Fictional Daughter Payer/.test(b404 + b404p + (await text("body"))));
  await go("/operations/billing");
  const bReady = await text("main");
  check("X2 Org B (no Plus) sees only its own billable trip", bReady.includes(`${LABEL}-TB`) && !bReady.includes(`${LABEL}-T1`));
  await go(`/operations/billing/new?trip=${TB}`);
  check("X3 Core-only workspace: no quote option (no Plus), invoice can still be created", (await has('[data-testid="billing-new-form"]')) && !(await has('[data-testid="billing-new-quote"]')));
  await click('[data-testid="billing-new-submit"]');
  await waitFor(() => has('[data-testid="billing-draft-editor"]'), 15000); await sleep(600);
  const INVB = invoiceOf(TB);
  await setValue('[data-testid="billing-line-price"]', "30"); await sleep(200);
  await click('[data-testid="billing-draft-save"]'); await waitFor(async () => /Draft saved/.test(await text('[data-testid="billing-draft-message"]')), 10000);
  await go(`/operations/billing/invoices/${INVB}`);
  await click('[data-testid="billing-issue-open"]'); await waitFor(() => has('[data-testid="billing-issue-confirm"]'), 5000); await click('[data-testid="billing-issue-confirm"]');
  await waitFor(() => has('[data-testid="billing-payment-open"]'), 15000);
  check("X4 Core-only workspace issues its own INV-000001 (numbering is per organization)", one(`select invoice_number || '|' || organization_id from billing_invoices where id = '${INVB}'`) === `1|${ORG_B}`);

  // ============================================================== Core untouched
  check("Z1 billing never changed a trip", one(`select string_agg(state, ',' order by id) from trips where pickup_description like '${LABEL}-%'`) === tripStates0);
  check("Z2 audit trail written for every billing action without bill-to names or references",
    Number(one(`select count(*) from audit_events where organization_id = '${ORG_A}' and action like 'billing_%'`)) >= 10
    && one(`select count(*) from audit_events where action like 'billing_%' and (coalesce(after_data::text,'') ~ 'Fictional Daughter|CHK-1001|ACH-2002|Church')`) === "0");
} catch (e) {
  fails++;
  console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  try {
    cleanup();
    sql(`delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');`);
  } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
