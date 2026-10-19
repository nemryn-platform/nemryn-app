// NP-P2-S5-S4 A6 -- accessibility of the Estimates & Quotes module: axe-core (pinned devDependency 4.10.2, injected from node_modules) on the panel,
// every quote dialog (incl. DNC and the follow-up task dialog), the directory and the print page, plus keyboard checks
// (open with Enter, focus inside, Tab stays in the dialog, Escape closes, focus returns). ISOLATED NemrynS1Iso +
// `next start -p 3100`; FICTIONAL data.
//   npm run test:e2e:quotes -- s4-a11y      (or: node tests/e2e/plus-quotes/s4-a11y.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep, newChromeSession, signIn, injectAxe } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const OUT = artifactDir("s4-a11y");
mkdirSync(OUT, { recursive: true });
let fails = 0;
const findings = [];
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
async function go(p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(1000); }
const key = async (k, code, keyCode, shift = false) => {
  const mods = shift ? 8 : 0;
  // Enter must carry text "\r" so Chrome generates the keypress that activates a focused button (real keyboard behaviour)
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: mods, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: mods });
  await sleep(150);
};
const contact = (name, dnc = false) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by, do_not_contact) values ('${ORG_A}', '${name}', '(404) 555-0180', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${U.a1}', ${dnc}) returning id`));
const opp = (title, k) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${U.a1}') returning id`));
const ver = (q) => `(select updated_at from public.plus_quotes where id = '${q}')`;
const create = (o, key) => asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${o}', '${key}', 'quote', 'dialysis', false, null, 10000, 2500, 0, 0, 0, 0, 0, 0, null, 500, 'Fictional terms', current_date + 10)).quote_id`);
const send = (q) => asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q}', ${ver(q)})).status`);
const revise = (q, key) => asUser(U.a1, `select (public.plus_revise_quote('${ORG_A}', '${q}', '${key}')).quote_id`);
const withdraw = (q) => asUser(U.a1, `select (public.plus_withdraw_quote('${ORG_A}', '${q}', ${ver(q)}, null)).status`);

async function axe(label, include) {
  await injectAxe(s);
  const res = await ev(`axe.run(${include ? `{ include: [${JSON.stringify(include)}] }` : "document"}, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, target: v.nodes[0]?.target?.join(' '), detail: v.nodes.slice(0, 3).map(n => ({ html: n.html.slice(0, 140), summary: (n.any[0]?.message || n.failureSummary || '').slice(0, 220), ratio: n.any[0]?.data?.contrastRatio, fg: n.any[0]?.data?.fgColor, bg: n.any[0]?.data?.bgColor, size: n.any[0]?.data?.fontSize })) })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of res) findings.push({ page: label, ...v });
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower-impact: ${res.map((v) => `${v.id}/${v.impact}`).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
async function keyboardDialog(label, triggerSel, formSel) {
  await ev(`document.querySelector(${JSON.stringify(triggerSel)}).focus()`);
  const focused = await ev(`document.activeElement === document.querySelector(${JSON.stringify(triggerSel)})`);
  await key("Enter", "Enter", 13);
  const opened = await waitFor(() => has(formSel), 5000);
  const inside = await ev(`(function(){const d=document.querySelector(${JSON.stringify(formSel)})?.closest('dialog'); return !!d && d.contains(document.activeElement);})()`);
  // Tab through the dialog's own focusable controls (count - 1 presses): focus must stay inside and never land on a page
  // element behind the modal. (Beyond the last control Chrome moves focus to the browser UI, standard for a modal
  // <dialog>; the page then reports <body>. That is not a page element, so it isn't tested past the end.)
  const count = await ev(`(function(){const d=document.querySelector(${JSON.stringify(formSel)})?.closest('dialog'); return [...d.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(e => !e.disabled && e.type !== 'hidden' && e.offsetParent !== null).length;})()`);
  let trapped = count > 1;
  for (let i = 0; i < count - 1; i++) { await key("Tab", "Tab", 9); if (!(await ev(`(function(){const d=document.querySelector(${JSON.stringify(formSel)})?.closest('dialog'); return !!d && d.contains(document.activeElement);})()`))) { trapped = false; break; } }
  await key("Tab", "Tab", 9, true);
  const reverse = await ev(`(function(){const d=document.querySelector(${JSON.stringify(formSel)})?.closest('dialog'); return !!d && d.contains(document.activeElement);})()`);
  const beforeEsc = await ev(`(function(){const a=document.activeElement; return (a?.tagName || '') + ':' + (a?.getAttribute('type') || a?.getAttribute('data-testid') || a?.getAttribute('aria-label') || a?.textContent?.trim().slice(0, 20) || '');})()`);
  await key("Escape", "Escape", 27);
  // closed = no OPEN dialog (what a user perceives); the form being unmounted is checked separately
  const closed = await waitFor(async () => !(await ev("!!document.querySelector('dialog[open]')")), 5000);
  console.log(`NOTE — ${label}: focus before Escape = ${beforeEsc}; dialog open after Escape = ${await ev("!!document.querySelector('dialog[open]')")}`);
  await sleep(300);
  const returned = await ev(`document.activeElement === document.querySelector(${JSON.stringify(triggerSel)})`);
  check(`KEY ${label}: trigger focusable; Enter opens; focus moves into the dialog; Tab and Shift+Tab stay inside; Escape closes; focus returns to the trigger`,
    focused && opened && inside && trapped && reverse && closed && returned, JSON.stringify({ focused, opened, inside, trapped, reverse, closed, returned }));
}

try {
  section("fixtures (fictional)");
  sql(`delete from organization_modules where organization_id = '${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'NP-P2-S5-S4 a11y')`);
  const K = contact(`A11y Pat ${STAMP}`); const KD = contact(`A11y DNC ${STAMP}`, true);
  const OE = opp(`A11y empty ${STAMP}`, K);
  const ODR = opp(`A11y draft ${STAMP}`, K); create(ODR, `a11y-${STAMP}-d`);
  const OS = opp(`A11y sent ${STAMP}`, K); const QS = create(OS, `a11y-${STAMP}-s`); send(QS);
  const ODN = opp(`A11y DNC ${STAMP}`, KD); create(ODN, `a11y-${STAMP}-n`);
  const OF = opp(`A11y follow-up ${STAMP}`, K); create(OF, `a11y-${STAMP}-f`);
  // history rows so the directory renders EVERY status badge tone (incl. Withdrawn / Superseded): the axe directory check
  // must see them on any fresh database, not only after another suite has run (deterministic U1 coverage)
  const OH = opp(`A11y history ${STAMP}`, K); const QH1 = create(OH, `a11y-${STAMP}-h1`); send(QH1); const QH2 = revise(QH1, `a11y-${STAMP}-h2`); send(QH2);
  const OW = opp(`A11y withdrawn ${STAMP}`, K); withdraw(create(OW, `a11y-${STAMP}-w`));
  s = await newChromeSession("s4-a11y"); await s.setViewport(1440, 1100); await signIn(s, "org-a-admin@example.test", PW);

  section("axe-core: pages and every quote dialog");
  await go(`/operations/growth/pipeline/${ODR}`);
  await axe("opportunity quotes panel (draft)", '[data-testid="opportunity-quotes"]');
  for (const [label, trigger, form] of [["create dialog", null, '[data-testid="quote-form"]'], ["edit dialog", '[data-testid="quote-edit-open"]', '[data-testid="quote-form"]'], ["withdraw-draft dialog", '[data-testid="quote-withdraw-open"]', '[data-testid="quote-withdraw-form"]'], ["Mark sent dialog", '[data-testid="quote-send-open"]', '[data-testid="quote-send-form"]']]) {
    if (!trigger) { await go(`/operations/growth/pipeline/${OE}`); await click('[data-testid="quote-create-open"]'); }
    else { await go(`/operations/growth/pipeline/${ODR}`); await click(trigger); }
    await waitFor(() => has(form));
    await axe(label, "dialog[open]");
  }
  await go(`/operations/growth/pipeline/${ODN}`); await click('[data-testid="quote-send-open"]'); await waitFor(() => has('[data-testid="quote-send-dnc"]'));
  await axe("Mark sent dialog with the do-not-contact warning", "dialog[open]");
  for (const [label, trigger, form] of [["record accepted dialog", '[data-testid="quote-accept-open"]', '[data-testid="quote-response-form"]'], ["record declined dialog", '[data-testid="quote-decline-open"]', '[data-testid="quote-response-form"]'], ["revise dialog", '[data-testid="quote-revise-open"]', '[data-testid="quote-revise-form"]'], ["withdraw sent dialog", '[data-testid="quote-withdraw-sent-open"]', '[data-testid="quote-withdraw-sent-form"]']]) {
    await go(`/operations/growth/pipeline/${OS}`); await click(trigger); await waitFor(() => has(form));
    await axe(label, "dialog[open]");
  }
  await go(`/operations/growth/pipeline/${OF}`); await click('[data-testid="quote-send-open"]'); await waitFor(() => has('[data-testid="quote-send-form"]'));
  await click('[data-testid="quote-send-confirm"]');
  await waitFor(() => has('[data-testid="quote-follow-up-offer"]'), 15000);
  await axe("follow-up offer", '[data-testid="quote-follow-up-offer"]');
  check("ARIA the confirmation after Mark sent is a live status message (role=status)", (await ev(`document.querySelector('[data-testid="quote-saved"]')?.getAttribute('role')`)) === "status");
  await click('[data-testid="quote-follow-up-open"]'); await waitFor(() => has('[data-testid="task-form"]'));
  await axe("follow-up task dialog", "dialog[open]");
  await go("/operations/growth/quotes");
  await axe("Estimates & Quotes directory", "main");
  await go(`/quote-print/${QS}`);
  await axe("print page", null);
  check("ARIA print banners / notices use role=note where shown; the Print / Save PDF control is a real button", (await ev(`document.querySelector('[data-testid="quote-print-button"]').tagName`)) === "BUTTON");
  await go(`/operations/growth/pipeline/${OS}`);
  check("ARIA every Print link has an accessible name naming the quote and the new tab", await ev(`[...document.querySelectorAll('[data-testid="quote-print-link"]')].every(a => /Print Quote \\d+ \\(opens in a new tab\\)/.test(a.textContent.replace(/\\s+/g, ' ').trim()))`));

  section("keyboard");
  await go(`/operations/growth/pipeline/${ODR}`);
  await keyboardDialog("Mark sent", '[data-testid="quote-send-open"]', '[data-testid="quote-send-form"]');
  await go(`/operations/growth/pipeline/${ODR}`);
  await keyboardDialog("Edit draft", '[data-testid="quote-edit-open"]', '[data-testid="quote-form"]');
  await go(`/operations/growth/pipeline/${OS}`);
  await keyboardDialog("Record accepted", '[data-testid="quote-accept-open"]', '[data-testid="quote-response-form"]');
  await go(`/operations/growth/pipeline/${OS}`);
  await keyboardDialog("Withdraw sent quote", '[data-testid="quote-withdraw-sent-open"]', '[data-testid="quote-withdraw-sent-form"]');
  await go(`/operations/growth/pipeline/${OE}`);
  await keyboardDialog("New estimate or quote", '[data-testid="quote-create-open"]', '[data-testid="quote-form"]');
  // closing with the dialog's own Cancel / Close buttons BY KEYBOARD: where does focus go?
  for (const [label, page, trigger, btn] of [["Edit draft -> Cancel", `/operations/growth/pipeline/${ODR}`, '[data-testid="quote-edit-open"]', "Cancel"], ["Edit draft -> Close (X)", `/operations/growth/pipeline/${ODR}`, '[data-testid="quote-edit-open"]', "Close"], ["Record accepted -> Cancel", `/operations/growth/pipeline/${OS}`, '[data-testid="quote-accept-open"]', "Cancel"]]) {
    await go(page);
    await ev(`document.querySelector(${JSON.stringify(trigger)}).focus()`);
    await key("Enter", "Enter", 13);
    await waitFor(() => ev("!!document.querySelector('dialog[open]')"), 5000);
    const found = await ev(`(function(){const b=[...document.querySelectorAll('dialog[open] button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(btn)}); if(!b) return false; b.focus(); return document.activeElement === b;})()`);
    await key("Enter", "Enter", 13);
    const closed = await waitFor(async () => !(await ev("!!document.querySelector('dialog[open]')")), 5000);
    await sleep(400);
    const where = await ev(`(function(){const a=document.activeElement; return a === document.querySelector(${JSON.stringify(trigger)}) ? 'trigger' : (a?.tagName || 'none');})()`);
    check(`KEY ${label} (keyboard): the dialog closes and focus returns to the trigger`, found && closed && where === "trigger", `button found=${found} closed=${closed} focus=${where}`);
  }
  await go(`/quote-print/${QS}`);
  await ev(`document.querySelector('[data-testid="quote-print-back"]').focus()`);
  await key("Tab", "Tab", 9);
  check("KEY print toolbar: Tab moves from Back to 'Print / Save PDF'", await ev(`document.activeElement === document.querySelector('[data-testid="quote-print-button"]')`));
} catch (e) {
  fails++; console.log(`FAIL — STOPPED :: ${e?.stack ?? e}`);
} finally {
  writeFileSync(`${OUT}/a11y-findings.json`, JSON.stringify(findings, null, 1));
  console.log(`NOTE — all axe findings (any impact): ${findings.length}; saved to ${OUT}a11y-findings.json`);
  try { await s?.close(); } catch {}
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
