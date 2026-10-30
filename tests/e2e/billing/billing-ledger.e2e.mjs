// NP-FIN-P1 -- Core billing ledger (receipts, allocations, payer credit, refunds, reversals): browser + SQL E2E on the
// ISOLATED stack (NemrynS1Iso + `next start -p 3100`). FICTIONAL data only; the plus-quotes config refuses any other
// target (assertFictionalSeed).
//   node tests/e2e/billing/billing-ledger.e2e.mjs
// Journeys (docs/reports/NP-FIN-P1-security-and-test-plan.md §5): E1 one payment received pays three invoices (oldest
// first) and keeps payer credit; E3 refund limited to refundable funds; E2 credit applied to another payer's invoice only
// with explicit confirmation + reason; E4 remove a payment from an invoice and re-apply the payer's credit; E5 returned
// check reversed from the invoice (receipt REVERSED); E6 duplicate warning + confirm; E7 assurance labels (never
// "Provider confirmed"); E7b overpayment kept as credit only when chosen; E8 roles / tenancy; E9 receipt print;
// E10 axe + responsive. Fixtures (owner SQL on the fictional seed + the billing RPCs as the seed admin) are removed at
// the end. Nothing is sent.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";
import { gateCleanupSql, gateEnableSql } from "./_gate.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1" };
const P1 = "40000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
const OUT = artifactDir("billing-ledger");
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
const LABEL = `LEDGERE2E-${STAMP}`;
function cleanup() {
  sql(`
    set session_replication_role = replica;
    delete from billing_assurance_events where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_receipt_reversals where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_refund_reversals where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_refunds where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_allocations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_receipts where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_receipt_counters where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_payments where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_lines where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_trips where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoices where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from billing_invoice_counters where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from trips where pickup_description like 'LEDGERE2E-%';
    delete from passengers where display_name like 'LEDGERE2E%';${gateCleanupSql([ORG_A, ORG_B])}
    set session_replication_role = origin;
  `);
}
cleanup();
sql(gateEnableSql([ORG_A, ORG_B], "NP-FIN-P1G ledger E2E fixture (fictional)"));
const P2 = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', 'LEDGERE2E Second Rider', '(404) 555-0133') returning id`);
const P1NAME = one(`select display_name from passengers where id = '${P1}'`);
let tripN = 0;
const trip = (pass) => one(`insert into trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at)
  values ('${ORG_A}', '${pass}', 'completed', '${LABEL}-${++tripN} 12 Fictional Lane', 'Fictional Clinic A', now() - interval '${60 - tripN} hours', now() - interval '${59 - tripN} hours') returning id`);
const ver = (inv) => one(`select version from billing_invoices where id = '${inv}'`);
// an ISSUED invoice of `cents` billed to the passenger, through the billing RPCs as the seed admin
function issued(pass, cents) {
  const t = trip(pass);
  const inv = asUser(U.a1, `select (r).invoice_id from (select public.billing_create_invoice_draft('${ORG_A}', array['${t}']::uuid[], 'passenger', '${pass}', null, null, 'led-e2e-${STAMP}-${tripN}') r) s`);
  asUser(U.a1, `select (public.billing_update_invoice_draft('${ORG_A}', '${inv}', ${ver(inv)}, 'Payer', null, null, null, jsonb_build_array(jsonb_build_object('trip_id', '${t}', 'source', 'trip', 'description', 'Ride', 'quantity', 1, 'unit_cents', ${cents})), 0, null)).version`);
  asUser(U.a1, `select (public.billing_issue_invoice('${ORG_A}', '${inv}', ${ver(inv)}, current_date - ${10 - tripN}, null)).invoice_number`);
  return inv;
}
const I1 = issued(P1, 6000), I2 = issued(P1, 4000), I3 = issued(P1, 2500), IQ = issued(P2, 5000), I4 = issued(P1, 1500), I5 = issued(P1, 13000), I6 = issued(P1, 2000);
const num = (inv) => `INV-${String(one(`select invoice_number from billing_invoices where id = '${inv}'`)).padStart(6, "0")}`;
const net = (inv) => Number(one(`select public._billing_invoice_net('${inv}')`));
const unal = (r) => Number(one(`select public._billing_receipt_unallocated('${r}')`));
check("FX fixtures: seven issued fictional invoices (P1 x6, P2 x1)", [I1, I2, I3, IQ, I4, I5, I6].every((v) => /^[0-9a-f-]{36}$/.test(v)), `${I1} ${IQ}`);

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;})()`);
async function go(p, w = 1440, h = 1100) { await s.setViewport(w, h); await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
async function open(name, email, w = 1440, h = 1100) { const x = await newChromeSession(`ledger-${name}`); sessions.push(x); await x.setViewport(w, h); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function shot(name) { await s.screenshot(path.join(SHOTS, `${name}.png`)); }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target?.join(' ') })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower: ${res.map((v) => v.id).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
const noHScroll = () => ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
const dialogGone = (formId) => waitFor(async () => !(await has(`dialog[open] [data-testid="${formId}"]`)), 12000);

try {
  s = await open("a1", "org-a-admin@example.test");

  // ============================================================== E1 one payment pays three invoices + payer credit
  section("E1 record payment received");
  await go("/operations/billing?view=receipts");
  check("E1a Payments received tab + Record payment received action", (await has('[data-testid="billing-view-receipts"]')) && (await has('[data-testid="billing-record-receipt"]')));
  await axe("payments received (empty)");
  await go("/operations/billing/receipts/new");
  const payerLinks = await ev(`[...document.querySelectorAll('[data-testid="billing-receipt-new-payer-option"]')].map(a => a.innerText + '|' + a.getAttribute('href'))`);
  const p1Link = payerLinks.find((l) => l.startsWith(P1NAME + "|"));
  check("E1b payer chooser lists payers by their record (passenger P1 present; typed 'someone else' separate)", Boolean(p1Link) && (await has('[data-testid="billing-receipt-new-payer-other"]')), payerLinks.join(" ; "));
  await go(p1Link.split("|")[1]);
  await setValue('[data-testid="billing-receipt-new-amount"]', "130.00");
  await sleep(500);
  await setValue('[data-testid="billing-receipt-new-form"] input[name="reference"]', "CHK-500");
  const sug = await ev(`[...document.querySelectorAll('[data-testid="billing-allocation-row"][data-same-payer="true"] [data-testid="billing-allocation-amount"]')].map(i => i.value)`);
  check("E1c oldest-first suggestion fills the payer's invoices and never exceeds a balance (60 + 40 + 25 + 5 of 15)", sug.slice(0, 4).join(",") === "60.00,40.00,25.00,5.00" && /kept as payer credit \$0\.00/.test(await text('[data-testid="billing-receipt-new-summary"]')), sug.join(","));
  // keep $5 as credit: clear the 4th suggestion (I4)
  await ev(`(function(){const i=[...document.querySelectorAll('[data-testid="billing-allocation-row"][data-same-payer="true"] [data-testid="billing-allocation-amount"]')][3]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0'); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  check("E1d summary shows applied $125.00 and $5.00 kept as payer credit", /Applying \$125\.00 · kept as payer credit \$5\.00/.test(await text('[data-testid="billing-receipt-new-summary"]')), await text('[data-testid="billing-receipt-new-summary"]'));
  await axe("record payment received");
  await shot("l01-record-payment-received");
  await click('[data-testid="billing-receipt-new-submit"]');
  await waitFor(async () => /\/operations\/billing\/receipts\/[0-9a-f-]{36}/.test(await ev("location.pathname")), 15000);
  const R1 = (await ev("location.pathname")).split("/").pop();
  check("E1e receipt RCPT-000001 recorded: three invoices paid / applied, $5.00 payer credit kept",
    (await text("main h1")) === "RCPT-000001" && net(I1) === 6000 && net(I2) === 4000 && net(I3) === 2500 && unal(R1) === 500
    && (await text('[data-testid="billing-receipt-credit"]')) === "$5.00" && /payer credit/.test(await text('[data-testid="billing-receipt-recorded"]')), `${R1} ${unal(R1)}`);
  check("E7 assurance: a typed reference shows 'Reference noted', never 'Provider confirmed'",
    /Reference noted/.test(await text('[data-testid="billing-receipt-summary"]')) && !/Provider confirmed/.test(await text("main")));
  await axe("payment page");
  await shot("l02-payment-page");

  // ============================================================== E3 refund limited to refundable funds
  section("E3 refund");
  await click('[data-testid="billing-refund-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-refund-form"]'), 5000);
  check("E3a refund dialog offers at most the refundable $5.00", (await ev(`document.querySelector('[data-testid="billing-refund-amount"]').value`)) === "5.00");
  await axe("refund dialog");
  await setValue('[data-testid="billing-refund-amount"]', "6.00");
  await setValue('[data-testid="billing-refund-reason"]', "Overpaid by mistake (fictional)");
  await click('[data-testid="billing-refund-submit"]');
  await waitFor(() => has('[data-testid="billing-refund-message"]'), 10000);
  check("E3b a refund above the refundable funds is refused by the server with a plain message; nothing recorded",
    /more than can be refunded/.test(await text('[data-testid="billing-refund-message"]')) && one(`select count(*) from billing_refunds where receipt_id = '${R1}'`) === "0");
  await setValue('[data-testid="billing-refund-amount"]', "2.00");
  await click('[data-testid="billing-refund-submit"]'); await dialogGone("billing-refund-form"); await sleep(800);
  check("E3c refund of $2.00 recorded: credit $5.00 -> $3.00; shown as recorded by staff (not provider-confirmed)",
    unal(R1) === 300 && /Recorded by staff/.test(await text('[data-testid="billing-receipt-refunds"]')) && !/Provider confirmed/.test(await text('[data-testid="billing-receipt-refunds"]')));

  // ============================================================== E2 credit to another payer: explicit confirmation + reason
  section("E2 cross-payer credit");
  await click('[data-testid="billing-receipt-apply-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-receipt-apply-form"]'), 5000);
  check("E2a apply-credit dialog hides other / unverified payers' invoices until asked", !(await has('dialog[open] [data-testid="billing-allocation-row"][data-same-payer="false"]')));
  await click('dialog[open] [data-testid="billing-allocation-show-others"]'); await sleep(300);
  // the oldest-first suggestion puts the $3.00 on P1's own oldest open invoice; move it to P2's invoice (IQ) instead
  check("E2a-2 the suggestion goes to the payer's own invoices first ($3.00 on the oldest open one)",
    (await ev(`[...document.querySelectorAll('dialog[open] [data-testid="billing-allocation-row"][data-same-payer="true"] input')].map(i => i.value).join(',')`)).startsWith("3.00"));
  await ev(`[...document.querySelectorAll('dialog[open] [data-testid="billing-allocation-row"][data-same-payer="true"] input')].forEach(i => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); })`);
  const iqNum = num(IQ);
  await ev(`(function(){const row=[...document.querySelectorAll('dialog[open] [data-testid="billing-allocation-row"][data-same-payer="false"]')].find(r=>r.innerText.includes(${JSON.stringify(iqNum)})); const i=row.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'3.00'); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  check("E2b choosing another payer's invoice asks for a reason", await has('dialog[open] [data-testid="billing-cross-payer-reason"]'));
  await axe("apply credit dialog (other payer)");
  await shot("l03-apply-credit-other-payer");
  await setValue('dialog[open] [data-testid="billing-cross-payer-reason"]', "Family member pays for both riders (fictional)");
  await click('[data-testid="billing-receipt-apply-submit"]'); await dialogGone("billing-receipt-apply-form"); await sleep(800);
  check("E2c applied to the other payer's invoice, flagged different_payer with the reason; credit now $0.00",
    net(IQ) === 300 && unal(R1) === 0 && one(`select different_payer || '|' || (reason like 'Family member%') from billing_allocations where invoice_id = '${IQ}'`) === "true|true"
    && /Other payer/.test(await text('[data-testid="billing-receipt-allocations"]')));

  // ============================================================== E4 remove a payment from an invoice, then re-apply credit
  section("E4 unapply + apply payer credit");
  await go(`/operations/billing/invoices/${I2}`);
  await click('[data-testid="billing-unapply-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-unapply-form"]'), 5000);
  await setValue('[data-testid="billing-unapply-reason"]', "Applied to the wrong invoice (fictional)");
  await click('[data-testid="billing-unapply-submit"]'); await dialogGone("billing-unapply-form"); await sleep(1000);
  check("E4a removed from the invoice: balance reopens $40.00, the payment row is kept as Removed, money back as payer credit",
    net(I2) === 0 && unal(R1) === 4000 && (await text('[data-testid="billing-balance"]')) === "$40.00" && /Removed/.test(await text('[data-testid="billing-invoice-payments"]')));
  check("E4b 'Apply payer credit' offered for the SAME payer", await has('[data-testid="billing-apply-credit-open"]'));
  await click('[data-testid="billing-apply-credit-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-apply-credit-form"]'), 5000);
  check("E4c credit amount defaults to min(credit, balance) = $40.00", (await ev(`document.querySelector('[data-testid="billing-apply-credit-amount"]').value`)) === "40.00");
  await click('[data-testid="billing-apply-credit-submit"]'); await dialogGone("billing-apply-credit-form"); await sleep(1000);
  check("E4d credit applied: invoice paid again, credit back to $0.00", net(I2) === 4000 && unal(R1) === 0 && (await text('[data-testid="billing-balance"]')) === "$0.00");

  // ============================================================== E5 returned check reversed from the invoice
  section("E5 returned check");
  await go(`/operations/billing/invoices/${I4}`);
  await click('[data-testid="billing-payment-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('[data-testid="billing-payment-reference"]', "CHK-77");
  await click('[data-testid="billing-payment-submit"]'); await dialogGone("billing-payment-form"); await sleep(1000);
  const R5 = one(`select receipt_id from billing_allocations where invoice_id = '${I4}' and kind = 'apply'`);
  check("E5a payment recorded from the invoice (payer = bill-to, simple payment, RCPT-000002)", net(I4) === 1500 && one(`select receipt_number || '|' || (source_invoice_id = '${I4}') from billing_receipts where id = '${R5}'`) === "2|true");
  await click('[data-testid="billing-reverse-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-reverse-form"]'), 5000);
  await setValue('[data-testid="billing-reverse-reason"]', "Check returned by the bank (fictional)");
  await click('[data-testid="billing-reverse-submit"]'); await dialogGone("billing-reverse-form"); await sleep(1000);
  check("E5b reversed: invoice balance back to $15.00; payment shows Reversed; receipt reversal + unapply recorded",
    net(I4) === 0 && (await text('[data-testid="billing-balance"]')) === "$15.00" && /Reversed/.test(await text('[data-testid="billing-invoice-payments"]'))
    && one(`select count(*) from billing_receipt_reversals where receipt_id = '${R5}'`) === "1");
  await go(`/receipt-print/${R5}`, 1000, 1200);
  check("E5c reversed receipt prints PAYMENT REVERSED (not proof of payment or of a refund)", /PAYMENT REVERSED/.test(await text('[data-testid="receipt-print-reversed"]')) && /not proof of payment or of a refund/.test(await text("main")));

  // ============================================================== E6 duplicate warning + confirm
  section("E6 duplicate warning");
  await go(`/operations/billing/invoices/${I5}`);
  await click('[data-testid="billing-payment-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('[data-testid="billing-payment-reference"]', "chk 500");
  await click('[data-testid="billing-payment-submit"]'); await waitFor(() => has('[data-testid="billing-payment-message"]'), 10000);
  check("E6a same method + reference (ignoring case / spaces / dashes) + amount + date as RCPT-000001 -> duplicate warning, nothing recorded",
    /same method, reference, amount and date/.test(await text('[data-testid="billing-payment-message"]')) && (await has('[data-testid="billing-payment-confirm-duplicate"]')) && net(I5) === 0);
  await click('[data-testid="billing-payment-confirm-duplicate"]');
  await click('[data-testid="billing-payment-submit"]'); await dialogGone("billing-payment-form"); await sleep(1000);
  check("E6b after confirming it's a separate payment, it is recorded", net(I5) === 13000);

  // ============================================================== E7b overpayment kept as credit only when chosen
  section("E7b keep extra as credit");
  await go(`/operations/billing/invoices/${I6}`);
  await click('[data-testid="billing-payment-open"]'); await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('[data-testid="billing-payment-amount"]', "25.00");
  await click('[data-testid="billing-payment-submit"]'); await waitFor(() => has('[data-testid="billing-payment-message"]'), 10000);
  check("E7b-1 without the choice, paying more than the balance is refused (NP-BILL-P1 behaviour)", /more than the balance/.test(await text('[data-testid="billing-payment-message"]')) && net(I6) === 0);
  await click('[data-testid="billing-payment-keep-credit"]');
  await click('[data-testid="billing-payment-submit"]'); await dialogGone("billing-payment-form"); await sleep(1000);
  const R7 = one(`select receipt_id from billing_allocations where invoice_id = '${I6}' and kind = 'apply'`);
  check("E7b-2 with the choice: invoice paid in full and the extra $5.00 kept as payer credit", net(I6) === 2000 && unal(R7) === 500);

  // ============================================================== E9 receipt print
  section("E9 receipt print");
  await go(`/receipt-print/${R1}`, 1000, 1200);
  const printed = await text('[data-testid="receipt-print-applied"]');
  check("E9 RCPT-000001 prints the number, amount, the invoices paid and the refund; no reversal banner",
    (await text('[data-testid="receipt-print-number"]')) === "RCPT-000001" && (await text('[data-testid="receipt-print-amount"]')) === "$130.00"
    && printed.includes(num(I1)) && printed.includes(num(IQ)) && /\$2\.00/.test(await text('[data-testid="receipt-print-refunds"]')) && !(await has('[data-testid="receipt-print-reversed"]')), printed);
  await shot("l04-receipt-print");
  await axe("receipt print");

  // ============================================================== E10 lists, responsive
  section("E10 lists + responsive");
  await go("/operations/billing?view=receipts");
  const listTxt = await text("main");
  check("E10a Payments received lists RCPT-000001..4 with status + assurance; payer credit tile", /RCPT-000001/.test(listTxt) && /RCPT-000004/.test(listTxt) && /Reversed/.test(listTxt) && /payer credit/.test(await text('[data-testid="billing-summary"]')));
  await go("/operations/billing?view=receipts&rfilter=credit");
  check("E10b 'With credit' filter shows only payments holding credit", /RCPT-000004/.test(await text("main")) && !/RCPT-000001/.test(await text("main")));
  await axe("payments received (list)");
  await go(`/operations/billing/receipts/${R1}`, 390, 900);
  check("E10c payment page at 390px: no horizontal page scroll", await noHScroll());
  await shot("l05-payment-page-390");
  await go("/operations/billing?view=receipts", 820, 1000);
  check("E10d payments list at 820px: no horizontal page scroll", await noHScroll());

  // ============================================================== E8 roles + tenancy
  section("E8 roles");
  s = await open("a2", "org-a-dispatcher@example.test");
  await go(`/operations/billing/receipts/${R1}`);
  check("E8a Dispatcher: payment page redirects away (no data)", !/RCPT-000001|\$130\.00/.test(await text("body")));
  await go(`/receipt-print/${R1}`);
  check("E8b Dispatcher: receipt print redirects away (no data)", !(await has('[data-testid="receipt-print"]')));
  s = await open("a3", "org-a-driver-a@example.test");
  await go("/operations/billing/receipts/new");
  check("E8c Driver: no record-payment page", !(await has('[data-testid="billing-receipt-new-payers"]')) && !(await has('[data-testid="billing-receipt-new-form"]')));
  s = await open("b1", "org-b-admin@example.test");
  await go(`/operations/billing/receipts/${R1}`);
  const b1 = await text("body");
  await go(`/receipt-print/${R1}`);
  check("E8d Org B admin: Org A payment and receipt URLs are not found (no data)", !/RCPT-000001|\$130\.00/.test(b1 + (await text("body"))));
  await go("/operations/billing?view=receipts");
  check("E8e Org B admin sees no Org A payments", !/RCPT-00000/.test(await text("main")));

  // ============================================================== privacy + invariants
  check("Z1 audit rows of ledger actions hold no payer names, references, notes or reasons",
    Number(one(`select count(*) from audit_events where organization_id = '${ORG_A}' and action in ('billing_receipt_recorded','billing_allocation_applied','billing_allocation_unapplied','billing_refund_recorded','billing_receipt_reversed')`)) >= 8
    && one(`select count(*) from audit_events where organization_id = '${ORG_A}' and action in ('billing_receipt_recorded','billing_allocation_applied','billing_allocation_unapplied','billing_refund_recorded','billing_receipt_reversed','billing_receipt_evidence_added') and (coalesce(after_data::text,'') ~* 'CHK-|chk 500|Fictional|LEDGERE2E|Family member|Overpaid' or reason is not null)`) === "0");
  check("Z2 invariants: 0 <= paid <= total on every invoice; allocated + refunded <= gross; billing_payments empty",
    one(`select count(*) from billing_invoices i where i.organization_id = '${ORG_A}' and (public._billing_invoice_net(i.id) < 0 or public._billing_invoice_net(i.id) > i.total_cents)`) === "0"
    && one(`select count(*) from billing_receipts r where r.organization_id = '${ORG_A}' and public._billing_receipt_allocated(r.id) + public._billing_receipt_refunded(r.id) > r.gross_cents`) === "0"
    && one(`select count(*) from billing_payments`) === "0");
} catch (e) {
  fails++;
  console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  cleanup();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
