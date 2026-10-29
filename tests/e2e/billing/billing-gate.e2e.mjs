// NP-FIN-P1G -- financial-write gate: browser + SQL E2E on the ISOLATED stack (NemrynS1Iso + `next start -p 3100`).
// FICTIONAL data only; the plus-quotes config refuses any other target (assertFictionalSeed).
//   node tests/e2e/billing/billing-gate.e2e.mjs
// Journey: Org A enabled (synthetic) -> fixtures (draft, issued invoice with a payment, receipt with credit) -> Org A
// DISABLED by the platform admin -> every billing page is read-only (notice, no write actions, records still visible);
// a payment dialog opened BEFORE the disable is refused on submit with a plain message and nothing is recorded (old
// tab / old build path); tenant isolation (enabling Org B never enables Org A); responsive + axe.
// Fixtures are removed at the end, including the enablement rows. Nothing is sent.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";
import { gateCleanupSql, gateDisableSql, gateEnableSql } from "./_gate.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1" };
const P1 = "40000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
const OUT = artifactDir("billing-gate");
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
const LABEL = `GATEE2E-${STAMP}`;
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
    delete from trips where pickup_description like 'GATEE2E-%';${gateCleanupSql([ORG_A, ORG_B])}
    set session_replication_role = origin;
  `);
}
cleanup();
sql(`delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');`);
check("FX0 deny by default: no enablement row for Org A or Org B after cleanup", one(`select count(*) from billing_write_enablements where organization_id in ('${ORG_A}', '${ORG_B}')`) === "0");
sql(gateEnableSql([ORG_A], "NP-FIN-P1G gate E2E fixture (fictional)"));
const TODAY = one(`select (now() at time zone timezone)::date from organizations where id = '${ORG_A}'`);
const trip = (tag, hoursAgo) =>
  one(`insert into trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at)
       values ('${ORG_A}', '${P1}', 'completed', '${LABEL}-${tag} 12 Fictional Lane', 'Fictional Clinic A', now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo - 1} hours') returning id`);
const T1 = trip("T1", 40), T2 = trip("T2", 30), T3 = trip("T3", 20);
const ver = (inv) => one(`select version from billing_invoices where id = '${inv}'`);
function draft(tripId, key, cents) {
  const inv = asUser(U.a1, `select (r).invoice_id from (select public.billing_create_invoice_draft('${ORG_A}', '{${tripId}}'::uuid[], 'passenger', '${P1}', null, null, '${key}') r) s`);
  const lines = JSON.stringify([{ description: "Ride", quantity: "1", unit_cents: cents, trip_id: tripId, source: "trip" }]);
  asUser(U.a1, `select (public.billing_update_invoice_draft('${ORG_A}', '${inv}', ${ver(inv)}, 'Fictional Payer', null, null, null, '${lines}'::jsonb, 0, null)).status`);
  return inv;
}
const DRAFT = draft(T1, `gatee2e-d-${STAMP}`, 2500);
const INV = draft(T2, `gatee2e-i-${STAMP}`, 6000);
asUser(U.a1, `select (public.billing_issue_invoice('${ORG_A}', '${INV}', ${ver(INV)}, '${TODAY}'::date, null)).status`);
const PAY = asUser(U.a1, `select (r).payment_id from (select public.billing_record_payment('${ORG_A}', '${INV}', ${ver(INV)}, 1000, '${TODAY}'::date, 'check', 'CHK-G1', null, 'gatee2e-p-${STAMP}') r) s`);
const RC = asUser(U.a1, `select (r).receipt_id from (select public.billing_record_receipt('${ORG_A}', null, 'passenger', '${P1}', null, 3000, 0, '${TODAY}'::date, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'gatee2e-r-${STAMP}') r) s`);
check("FX fixtures while enabled: draft, issued invoice with a payment, receipt with credit, an uninvoiced completed trip",
  [T1, T2, T3, DRAFT, INV, PAY, RC].every((v) => /^[0-9a-f-]{36}$/.test(v)) && one(`select status from billing_invoices where id = '${INV}'`) === "issued", `${DRAFT} ${INV} ${PAY} ${RC}`);
const counts = () => one(`select (select count(*) from billing_invoices where organization_id = '${ORG_A}') || '|' || (select count(*) from billing_receipts where organization_id = '${ORG_A}')
  || '|' || (select count(*) from billing_allocations where organization_id = '${ORG_A}') || '|' || (select count(*) from billing_refunds where organization_id = '${ORG_A}')
  || '|' || (select string_agg(id::text || version || status, ',' order by id) from billing_invoices where organization_id = '${ORG_A}')`);

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
async function go(p, w = 1440, h = 1100) { await s.setViewport(w, h); await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
async function open(name, email, w = 1440, h = 1100) { const x = await newChromeSession(`gate-${name}`); sessions.push(x); await x.setViewport(w, h); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function shot(name) { await s.screenshot(path.join(SHOTS, `${name}.png`)); }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target?.join(' ') })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower: ${res.map((v) => v.id).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
const noHScroll = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const notice = () => text('[data-testid="billing-write-disabled"]');
const ANY_WRITE = ['billing-record-receipt', 'billing-create-invoice', 'billing-payment-open', 'billing-void-open', 'billing-issue-open', 'billing-discard-open',
  'billing-draft-editor', 'billing-reverse-open', 'billing-unapply-open', 'billing-apply-credit-open', 'billing-refund-open', 'billing-receipt-reverse-open',
  'billing-refund-reverse-open', 'billing-evidence-form', 'billing-new-form', 'billing-receipt-new-form', 'trip-billing-create'].map((t) => `[data-testid="${t}"]`).join(", ");
const noWriteActions = () => ev(`document.querySelectorAll(${JSON.stringify(ANY_WRITE)}).length === 0`);

try {
  // ============================================================== stale tab: dialog opened while enabled, submitted after disable
  section("stale tab");
  s = await open("a1", "org-a-admin@example.test");
  await go(`/operations/billing/invoices/${INV}`);
  check("S0 while enabled: no notice, the issued invoice offers Record payment", !(await has('[data-testid="billing-write-disabled"]')) && (await has('[data-testid="billing-payment-open"]')));
  await click('[data-testid="billing-payment-open"]');
  await waitFor(() => has('dialog[open] [data-testid="billing-payment-form"]'), 5000);
  await setValue('dialog[open] [data-testid="billing-payment-amount"]', "5.00");
  await setValue('dialog[open] select[name="method"]', "cash");
  const before = counts();
  sql(gateDisableSql(ORG_A, 1, "NP-FIN-P1G gate E2E: disable (fictional)"));
  check("S1 the platform admin disabled Org A (version 2, history kept)", one(`select status || ':' || version from billing_write_enablements where organization_id = '${ORG_A}'`) === "disabled:2"
    && one(`select string_agg(version || status, ',' order by version) from billing_write_enablement_history where organization_id = '${ORG_A}'`) === "1enabled,2disabled");
  await click('[data-testid="billing-payment-submit"]');
  await waitFor(() => has('[data-testid="billing-payment-message"]'), 15000);
  await sleep(500);
  const msg = await text('[data-testid="billing-payment-message"]');
  check("S2 the already-open payment dialog is refused with a plain message (no code); nothing recorded", /isn't enabled for this workspace/.test(msg) && !/ZW\d|billing_not_enabled/.test(msg) && counts() === before, msg);
  await shot("gate-stale-dialog-refused");

  // ============================================================== disabled: every billing page is read-only
  section("read-only pages");
  await go("/operations/billing?view=invoices");
  check("D1 Billing page: notice shown, invoices still listed, no write actions", /isn't enabled for this workspace yet/.test(await notice()) && (await has('[data-testid="billing-invoice-link"]')) && (await noWriteActions()), await notice());
  check("D1b ZD-286: the tenant page never shows the internal enablement reason, approval reference or data class",
    !/gate E2E|NP-LAUNCH|synthetic|approval/i.test(await text("main")));
  await axe("billing (disabled)");
  await shot("gate-billing-disabled");
  await go("/operations/billing?view=ready");
  check("D2 Ready to invoice: the uninvoiced trip is listed but there is no Create invoice", (await text("main")).includes("Fictional") && (await noWriteActions()));
  await go("/operations/billing?view=receipts");
  check("D3 Payments list readable; no Record payment received", (await has('[data-testid="billing-receipt-row-link"]')) && (await noWriteActions()));
  await go(`/operations/billing/invoices/${INV}`);
  check("D4 issued invoice: balance, charges and payment history visible; print available; no payment / void / reverse / unapply / credit",
    (await text('[data-testid="billing-balance"]')).includes("$50.00") && (await has('[data-testid="billing-payment-row"]')) && (await has('[data-testid="billing-print-invoice"]')) && (await has('[data-testid="billing-write-disabled"]')) && (await noWriteActions()),
    await text('[data-testid="billing-balance"]'));
  await axe("issued invoice (disabled)");
  await go(`/operations/billing/invoices/${DRAFT}`);
  check("D5 draft invoice: saved charges shown read-only; no editor, issue or discard", (await has('[data-testid="billing-invoice-lines"]')) && (await text('[data-testid="billing-invoice-lines"]')).includes("$25.00") && (await noWriteActions()));
  await axe("draft (disabled)");
  await go(`/operations/billing/receipts/${RC}`);
  check("D6 payment page: credit and print visible; no apply / refund / reverse / evidence", (await text('[data-testid="billing-receipt-credit"]')).includes("$30.00") && (await has('[data-testid="billing-receipt-print"]')) && (await noWriteActions()));
  await axe("payment (disabled)");
  await go(`/receipt-print/${RC}`);
  check("D7 receipt print still renders while disabled", (await text("body")).includes("$30.00"));
  await go(`/operations/billing/new?trip=${T3}`);
  check("D8 Create invoice URL: notice, no form", (await has('[data-testid="billing-write-disabled"]')) && (await noWriteActions()));
  await axe("create invoice (disabled)");
  await go("/operations/billing/receipts/new");
  check("D9 Record payment received URL: notice, no payer list or form", (await has('[data-testid="billing-write-disabled"]')) && !(await has('[data-testid="billing-receipt-new-payers"]')) && (await noWriteActions()));
  await go(`/operations/trips/${T3}`);
  check("D10 Trip Detail billing panel: not invoiced, explains billing isn't enabled, no Create invoice", /isn't enabled/.test(await text('[data-testid="trip-billing-not-invoiced"]')) && (await noWriteActions()), await text('[data-testid="trip-billing-panel"]'));
  await go("/operations/billing?view=invoices", 390, 844);
  check("D11 mobile 390px: notice visible, no horizontal scroll", (await has('[data-testid="billing-write-disabled"]')) && (await noHScroll()));
  await axe("billing mobile (disabled)");
  await shot("gate-billing-disabled-mobile");
  check("D12 nothing changed in the database while disabled", counts() === before);

  // ============================================================== tenant isolation
  section("tenant isolation");
  sql(gateEnableSql([ORG_B], "NP-FIN-P1G gate E2E: Org B fixture (fictional)"));
  const sb = s;
  s = await open("b1", "org-b-admin@example.test");
  await go("/operations/billing");
  check("T1 Org B enabled: its admin sees no notice and can record a payment", !(await has('[data-testid="billing-write-disabled"]')) && (await has('[data-testid="billing-record-receipt"]')));
  s = sb;
  await go("/operations/billing");
  check("T2 Org A stays disabled after Org B is enabled", (await has('[data-testid="billing-write-disabled"]')) && (await noWriteActions()));

  // ============================================================== re-enable
  section("re-enable");
  sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000d1';
       select (public.platform_set_billing_write_enablement('${ORG_A}', 'enabled', 'synthetic', null, 'NP-FIN-P1G gate E2E: re-enable (fictional)', 2)).status; commit;`);
  await go(`/operations/billing/invoices/${INV}`);
  check("R1 re-enabled (version 3): actions return, no notice", !(await has('[data-testid="billing-write-disabled"]')) && (await has('[data-testid="billing-payment-open"]'))
    && one(`select version from billing_write_enablements where organization_id = '${ORG_A}'`) === "3");
  check("Z1 every enablement change is audited without its free-text reason",
    Number(one(`select count(*) from audit_events where organization_id in ('${ORG_A}', '${ORG_B}') and action = 'platform_billing_write_enablement_changed' and occurred_at > now() - interval '1 hour'`)) >= 4
    && one(`select count(*) from audit_events where action = 'platform_billing_write_enablement_changed' and coalesce(after_data::text, '') ~ 'gate E2E'`) === "0");
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
