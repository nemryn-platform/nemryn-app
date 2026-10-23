// NP-P2-S6-B local browser E2E -- Contact detail -> Communication preferences. ISOLATED Supabase stack (NemrynS1Iso)
// + `next start -p 3100`; FICTIONAL seed identities and data only (the plus-quotes config refuses any other target).
//   node tests/e2e/plus-consents/consents.e2e.mjs        (npm run test:e2e:consents)
// Covers: placement, the six cells and approved labels, record / revoke / correct through the real UI and server action,
// history (collapsed, count, order, notes, corrections, the DNC system entry, pagination), DNC precedence and no revival,
// archived contacts, the role / entitlement matrix (incl. server-side refusal of a stale dialog), redacted and foreign
// contacts, no secrets in the page, responsive layouts, axe and keyboard dialogs. Nothing is sent.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "../plus-quotes/_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2" };
const EMAIL = { a1: "org-a-admin@example.test", a2: "org-a-dispatcher@example.test", a3: "org-a-driver-a@example.test", b1: "org-b-admin@example.test" };
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const OUT = artifactDir("s6b-consents");
mkdirSync(OUT, { recursive: true });
const FORBIDDEN = [/allowed to contact/i, /approved to send/i, /legally permitted/i, /opted in/i];
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|UPDATE \d+|INSERT 0 \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
const memId = (uid) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${ORG_A}'`));
const setPlus = (org, status = "active", restriction = null) =>
  sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, status_reason) values ('${org}', 'plus', '${status}', ${restriction ? `'${restriction}'` : "null"}, ${status === "expired" ? "now() - interval '20 days', now() - interval '6 days'" : "null, null"}, 'NP-P2-S6-B E2E')`);
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (org, name, { phone = "(404) 555-0170", email = true, dnc = false } = {}) =>
  first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, do_not_contact, created_by) values ('${org}', '${name}', ${phone ? `'${phone}'` : "null"}, ${email ? `'${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test'` : "null"}, 'individual', ${dnc}, '${org === ORG_A ? U.a1 : "20000000-0000-0000-0000-0000000000b1"}') returning id`));
const grantSql = (k, ch, pu, key, at = "null") => asUser(U.a1, `select (public.plus_record_consent('${ORG_A}', '${k}', '${ch}', '${pu}', 'written', ${at}, null, null, '${key}')).recorded_status`);
const revokeSql = (k, ch, pu, key) => asUser(U.a1, `select (public.plus_revoke_consent('${ORG_A}', '${k}', '${ch}', '${pu}', 'written', null, null, null, '${key}')).recorded_status`);
const setDnc = (k, on) => asUser(U.a1, `select r.changed::text from public.plus_contacts c, lateral public.plus_update_contact('${ORG_A}', c.id, c.updated_at, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, ${on}, null) r where c.id = '${k}'`);
const rows = (k) => sql(`select status || ':' || captured_via || ':' || coalesce(corrects_consent_id::text, '-') || ':' || recorded_by from plus_communication_consents where contact_id = '${k}' order by seq`).split("\n").filter(Boolean);
const nActivities = () => first(sql(`select count(*) from plus_activities`));

const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const visible = (sel) => ev(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility();})()`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const radio = (name, value) => click(`dialog[open] input[name="${name}"][value="${value}"]`);
const submitDisabled = () => ev(`document.querySelector('[data-testid="consent-submit"]')?.disabled ?? null`);
const cellState = (ch, pu) => ev(`(function(){const e=document.querySelector('[data-testid="consent-cell-${ch}-${pu}"]'); return e ? e.dataset.recorded + '>' + e.dataset.effective + '|' + e.innerText.split('\\n')[0] : null;})()`);
async function go(p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
const key = async (k, code, keyCode, shift = false) => {
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 });
  await sleep(150);
};
async function open(name, email, w = 1440, h = 1300) { const x = await newChromeSession(`s6b-${name}`); sessions.push(x); await x.setViewport(w, h); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function submitAndWait() {
  await click('[data-testid="consent-submit"]');
  return waitFor(async () => (await has('[data-testid="consent-notice"]')) || (await has('[data-testid="consent-error"]')), 15000);
}
async function shot(name) { const h = await ev("Math.ceil(document.documentElement.scrollHeight)"); const { w } = { w: await ev("window.innerWidth") }; await s.setViewport(w, Math.min(Math.max(900, h), 3600)); await sleep(300); await s.screenshot(path.join(OUT, `${name}.png`)); }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target?.join(' ') })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower: ${res.map((v) => v.id).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
async function keyboardDialog(label, triggerSel) {
  await ev(`document.querySelector(${JSON.stringify(triggerSel)}).focus()`);
  const focused = await ev(`document.activeElement === document.querySelector(${JSON.stringify(triggerSel)})`);
  await key("Enter", "Enter", 13);
  const opened = await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  const inside = await ev(`!!document.querySelector('dialog[open]')?.contains(document.activeElement)`);
  // radio groups: arrow keys move within the group (native radios)
  await ev(`document.querySelector('dialog[open] input[name="method"]')?.focus()`);
  await key("ArrowDown", "ArrowDown", 40);
  const arrow = await ev(`document.activeElement?.name === 'method' && document.activeElement?.value === 'in_person' && document.activeElement.checked`);
  await key("Escape", "Escape", 27);
  const closed = await waitFor(async () => !(await has("dialog[open]")), 5000);
  await sleep(300);
  const returned = await ev(`document.activeElement === document.querySelector(${JSON.stringify(triggerSel)})`);
  check(`KEY ${label}: Enter opens with focus inside; arrow keys move within a radio group; Escape closes; focus returns to the trigger`,
    focused && opened && inside && arrow && closed && returned, JSON.stringify({ focused, opened, inside, arrow, closed, returned }));
}

try {
  section("fixtures (fictional)");
  setPlus(ORG_A); setPlus(ORG_B); setGrant("none");
  const K = contact(ORG_A, `S6B Kim ${STAMP}`);
  const KP = contact(ORG_A, `S6B Lee ${STAMP}`, { email: false });
  const KD = contact(ORG_A, `S6B Ana ${STAMP}`, { dnc: true });
  const KA = contact(ORG_A, `S6B Ari ${STAMP}`);
  grantSql(KA, "sms", "service_followup", `s6b-ka-sms-${STAMP}`);
  sql(`update plus_contacts set status = 'archived' where id = '${KA}'`);
  const KR = contact(ORG_A, `S6B Red ${STAMP}`);
  sql(`update plus_contacts set status = 'redacted', phone = null, email = null where id = '${KR}'`);
  const KB = contact(ORG_B, `S6B OrgB ${STAMP}`);
  const acts0 = nActivities();

  section("A. Admin, Plus write: placement, empty state, record");
  s = await open("admin", EMAIL.a1);
  await go(`/operations/growth/contacts/${K}`);
  const order = await ev(`(function(){const ids=['contact-details','contact-consents','contact-tasks']; const els=ids.map(i=>document.querySelector('[data-testid="'+i+'"]')); if(els.some(e=>!e)) return 'missing'; return (els[0].compareDocumentPosition(els[1]) & 4) && (els[1].compareDocumentPosition(els[2]) & 4) ? 'ok' : 'order';})()`);
  check("A1 the panel sits directly after Details and before Open tasks; header actions, timeline and other panels still render",
    order === "ok" && (await has('[data-testid="contact-edit"]')) && (await has('[data-testid="contact-timeline"], [data-testid="timeline-empty"]')) && (await has('[data-testid="contact-opportunities"]')), order);
  check("A2 heading 'Communication preferences' (h2) with the not-permission description; empty state for a contact with no records",
    (await text('[data-testid="contact-consents"] h2')) === "Communication preferences"
    && /isn't permission to send, and Nemryn sends nothing/.test(await text('[data-testid="contact-consents"]'))
    && /No communication preferences recorded\./.test(await text('[data-testid="contact-consents"]')) && !(await has('[data-testid="consent-table"]')));
  check("A3 writer sees Record consent + Record revocation (outline; the page's one teal action stays in the header)",
    (await has('[data-testid="consent-record"]')) && (await has('[data-testid="consent-record-revocation"]'))
    && (await ev(`!/action-primary/.test(document.querySelector('[data-testid="consent-record"]').className)`)));
  await keyboardDialog("Record consent", '[data-testid="consent-record"]');
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  const methods = await ev(`[...document.querySelectorAll('dialog[open] input[name="method"]')].map(e=>e.value).join(',')`);
  check("A4 Record consent dialog: channel / purpose / method / date / note / confirmation; staff methods only; the purposes explain they are separate; the medical-details notice; submit disabled until valid",
    methods === "verbal_phone,in_person,written,email_reply"
    && /Separate from follow-up/.test(await text("dialog[open]")) && /Don't record medical/.test(await text("dialog[open]"))
    && (await has('dialog[open] [data-testid="consent-date"]')) && (await has('dialog[open] [data-testid="consent-confirm"]'))
    && (await submitDisabled()) === true, methods);
  await radio("channel", "email"); await radio("purpose", "marketing"); await radio("method", "verbal_phone");
  const beforeConfirm = await submitDisabled();
  await click('dialog[open] [data-testid="consent-confirm"]');
  await setValue('dialog[open] [data-testid="consent-note"]', "Said yes to offers on the call");
  const afterConfirm = await submitDisabled();
  await submitAndWait();
  const notice = await text('[data-testid="consent-notice"]');
  await waitFor(async () => (await cellState("email", "marketing"))?.startsWith("granted"), 10000);
  check("A5 recording through the UI: still disabled without the confirmation, enabled with it; 'Consent recorded.' announced (role=status); the cell shows Consent recorded; one ledger row recorded_by the Admin",
    beforeConfirm === true && afterConfirm === false && notice === "Consent recorded."
    && (await ev(`document.querySelector('[data-testid="consent-notice"]').getAttribute('role')`)) === "status"
    && (await cellState("email", "marketing")) === "granted>consent_on_record|Consent recorded"
    && JSON.stringify(rows(K)) === JSON.stringify([`granted:verbal_phone:-:${U.a1}`]), `${notice} ${await cellState("email", "marketing")} ${rows(K)}`);
  const html = await ev("document.documentElement.outerHTML");
  const digest = first(sql(`select address_digest from plus_communication_consents where contact_id = '${K}'`));
  const ikey = first(sql(`select idempotency_key from plus_communication_consents where contact_id = '${K}'`));
  const panelText = await text('[data-testid="contact-consents"]');
  check("A6 the page never contains the address digest, the idempotency key or internal function names; no label claims permission",
    digest.length === 64 && !html.includes(digest) && !html.includes(ikey) && !/address_digest|idempotency|_plus_effective_consent|_plus_append_consent/.test(html)
    && FORBIDDEN.every((re) => !re.test(panelText)));
  check("A7 meta line shows method, date and the recording staff member",
    /On a phone call · [A-Z][a-z]{2} \d{1,2}, \d{4} · by /.test(await text('[data-testid="consent-cell-email-marketing"]')), await text('[data-testid="consent-cell-email-marketing"]'));
  await shot("a-admin-recorded-1440");

  section("A. revoke a cell, history, correction");
  await click('[data-testid="consent-revoke-email-marketing"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-dialog-pair"]'), 5000);
  check("A8 per-cell Revoke opens a dialog fixed to Email · Marketing; no confirmation checkbox for a revocation",
    /Email · Marketing/.test(await text('dialog[open] [data-testid="consent-dialog-pair"]')) && !(await has('dialog[open] [data-testid="consent-confirm"]')));
  await radio("method", "written");
  await submitAndWait();
  await waitFor(async () => (await cellState("email", "marketing"))?.startsWith("revoked"), 10000);
  check("A9 revocation is a NEW row; the grant is untouched; the cell shows Revoked",
    (await text('[data-testid="consent-notice"]')).startsWith("Revocation recorded") && (await cellState("email", "marketing")) === "revoked>no_consent_on_record|Revoked"
    && rows(K).length === 2 && rows(K)[0].startsWith("granted:verbal_phone"), rows(K).join(" | "));
  check("A10 history is collapsed by default, shows the accurate count, newest first, with method / dates / actor / note",
    !(await ev(`document.querySelector('[data-testid="consent-history"]').open`))
    && (await text('[data-testid="consent-history"] summary')) === "History (2)"
    && (await ev(`[...document.querySelectorAll('[data-testid="consent-event"]')].map(e=>e.dataset.status).join(',')`)) === "revoked,granted"
    && /Said yes to offers on the call/.test(await ev(`document.querySelector('[data-testid="consent-history-list"]').textContent`))
    && /recorded .* by /.test(await ev(`document.querySelector('[data-testid="consent-event"]').textContent`)));
  await ev(`document.querySelector('[data-testid="consent-history"]').open = true`);
  const correctButtons = await ev(`document.querySelectorAll('[data-testid="consent-correct"]').length`);
  check("A11 only the pair's latest entry offers a correction", correctButtons === 1, correctButtons);
  await click('[data-testid="consent-correct"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("method", "verbal_phone"); await click('dialog[open] [data-testid="consent-confirm"]');
  const noNote = await submitDisabled();
  await setValue('dialog[open] [data-testid="consent-note"]', "The revocation was entered for the wrong person");
  await submitAndWait();
  await waitFor(async () => (await cellState("email", "marketing"))?.startsWith("granted"), 10000);
  const r3 = rows(K);
  check("A12 correction: requires a note; records a NEW grant referencing the revocation; history keeps both, marked 'Corrects an earlier entry' / 'Corrected'",
    noNote === true && r3.length === 3 && r3[2].startsWith("granted:verbal_phone:") && !r3[2].includes(":-:")
    && /Correction recorded/.test(await text('[data-testid="consent-notice"]'))
    && /Corrects an earlier entry/.test(await ev(`document.querySelector('[data-testid="consent-history-list"]').textContent`))
    && /Corrected/.test(await ev(`document.querySelector('[data-testid="consent-history-list"]').textContent`)), r3.join(" | "));
  // stale correction: the dialog is opened, then another writer records a newer entry for the pair
  await ev(`document.querySelector('[data-testid="consent-history"]').open = true`);
  await click('[data-testid="consent-correct"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  revokeSql(K, "email", "marketing", `s6b-k-stale-${STAMP}`);
  await radio("method", "written"); await setValue('dialog[open] [data-testid="consent-note"]', "late correction");
  await submitAndWait();
  check("A13 a stale correction is refused by the database (ZW003) and explained in an alert; nothing written",
    /can no longer be corrected/.test(await text('[data-testid="consent-error"]')) && (await ev(`document.querySelector('[data-testid="consent-error"]').getAttribute('role')`)) === "alert"
    && rows(K).length === 4, await text('[data-testid="consent-error"]'));
  await key("Escape", "Escape", 27); await sleep(300);
  // stale evidence: a grant dated before the latest revocation
  await go(`/operations/growth/contacts/${K}`);
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("channel", "email"); await radio("purpose", "marketing"); await radio("method", "written"); await click('dialog[open] [data-testid="consent-confirm"]');
  const lastWeek = first(sql(`select to_char((now() at time zone (select timezone from organizations where id = '${ORG_A}'))::date - 7, 'YYYY-MM-DD')`));
  await setValue('dialog[open] [data-testid="consent-date"]', lastWeek);
  await submitAndWait();
  check("A14 a grant dated before the latest revocation is refused (stale evidence) with clear copy",
    /revocation dated after this/.test(await text('[data-testid="consent-error"]')) && rows(K).length === 4, await text('[data-testid="consent-error"]'));
  await key("Escape", "Escape", 27); await sleep(300);
  check("A15 consent writes created no Growth activity (separate from the timeline, ZD-236)", nActivities() === acts0, `${acts0} -> ${nActivities()}`);

  section("A. address-dependent channels");
  await go(`/operations/growth/contacts/${KP}`);
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  check("A16 without an email address the Email channel is disabled with the reason; SMS / calls are available",
    (await ev(`document.querySelector('dialog[open] input[name="channel"][value="email"]').disabled`)) === true
    && (await ev(`document.querySelector('dialog[open] input[name="channel"][value="sms"]').disabled`)) === false
    && /No email address on this contact\./.test(await text("dialog[open]")));
  await key("Escape", "Escape", 27); await sleep(300);

  section("B. Do not contact");
  await go(`/operations/growth/contacts/${KD}`);
  check("B1 DNC contact: prominent warning; no Record consent; Record revocation remains; every cell 'Suppressed — do not contact'",
    (await has('[data-testid="consent-dnc-warning"]')) && /Do not contact is on\./.test(await text('[data-testid="consent-dnc-warning"]'))
    && !(await has('[data-testid="consent-record"]')) && (await has('[data-testid="consent-record-revocation"]'))
    && (await ev(`[...document.querySelectorAll('[data-testid^="consent-cell-"]')].every(e => e.dataset.effective === 'suppressed_do_not_contact' && /Suppressed — do not contact/.test(e.innerText))`)));
  await click('[data-testid="consent-record-revocation"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("channel", "sms"); await radio("purpose", "marketing"); await radio("method", "verbal_phone");
  await submitAndWait();
  check("B2 a revocation can still be recorded while DNC is on", rows(KD).length === 1 && rows(KD)[0].startsWith("revoked:verbal_phone"), rows(KD).join(" | "));
  await axe("contact detail with DNC warning (1440)");
  await shot("b-dnc-1440");
  // DNC switch-on for K (granted pairs) and clear: system revocation, no revival
  grantSql(K, "sms", "service_followup", `s6b-k-sms-${STAMP}`);
  setDnc(K, true);
  await go(`/operations/growth/contacts/${K}?consentHistory=1`);
  const sysEvents = await ev(`[...document.querySelectorAll('[data-testid="consent-event"][data-method="do_not_contact"]')].length`);
  check("B3 after DNC is switched on: system revocations appear in the open history with the explanation and no correction offer; cells suppressed",
    sysEvents >= 1 && /Recorded automatically when Do not contact was switched on\./.test(await text('[data-testid="consent-history-list"]'))
    && (await ev(`[...document.querySelectorAll('[data-testid="consent-event"][data-method="do_not_contact"]')].every(e => !e.querySelector('[data-testid="consent-correct"]'))`))
    && (await cellState("sms", "service_followup"))?.endsWith("Suppressed — do not contact"), sysEvents);
  setDnc(K, false);
  await go(`/operations/growth/contacts/${K}`);
  check("B4 after DNC is cleared: nothing revives -- the database's effective state shows Revoked (no Consent recorded anywhere)",
    !(await has('[data-testid="consent-dnc-warning"]'))
    && (await ev(`[...document.querySelectorAll('[data-testid^="consent-cell-"]')].every(e => e.dataset.effective !== 'consent_on_record')`))
    && (await cellState("sms", "service_followup")) === "revoked>no_consent_on_record|Revoked");

  section("C. archived contact");
  await go(`/operations/growth/contacts/${KA}`);
  check("C1 archived: no Record consent; Record revocation remains with an explanation; cells 'Contact archived'",
    !(await has('[data-testid="consent-record"]')) && (await has('[data-testid="consent-record-revocation"]')) && (await has('[data-testid="consent-archived-note"]'))
    && (await cellState("sms", "service_followup")) === "granted>suppressed_archived|Contact archived");
  await click('[data-testid="consent-revoke-sms-service_followup"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("method", "written");
  await submitAndWait();
  check("C2 a revocation is recorded for the archived contact", rows(KA).at(-1)?.startsWith("revoked:written") === true, rows(KA).join(" | "));

  section("D. Dispatcher grants");
  setGrant("read");
  const d = await open("dispatcher", EMAIL.a2); s = d;
  await go(`/operations/growth/contacts/${K}`);
  check("D1 read-grant Dispatcher: reads the state and history, no write controls, a view-only note",
    (await has('[data-testid="contact-consents"]')) && (await has('[data-testid="consent-table"]')) && (await has('[data-testid="consent-history"]'))
    && !(await has('[data-testid="consent-record"]')) && !(await has('[data-testid="consent-record-revocation"]')) && !(await has('[data-testid^="consent-revoke-"]'))
    && (await has('[data-testid="consent-view-only"]')));
  setGrant("write");
  await go(`/operations/growth/contacts/${K}`);
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("channel", "voice"); await radio("purpose", "service_followup"); await radio("method", "in_person"); await click('dialog[open] [data-testid="consent-confirm"]');
  await submitAndWait();
  check("D2 write-grant Dispatcher records consent (recorded_by = the Dispatcher)", rows(K).at(-1) === `granted:in_person:-:${U.a2}`, rows(K).at(-1));
  // server-side enforcement: the dialog is open, then the grant is downgraded to read before submitting
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("channel", "voice"); await radio("purpose", "marketing"); await radio("method", "in_person"); await click('dialog[open] [data-testid="consent-confirm"]');
  setGrant("read");
  const n0 = rows(K).length;
  await submitAndWait();
  check("D3 hidden buttons are not the control: a stale dialog submitted after the grant became read-only is refused server-side; nothing written",
    (await has('[data-testid="consent-error"]')) && rows(K).length === n0, await text('[data-testid="consent-error"]'));
  setGrant("none");
  await go(`/operations/growth/contacts/${K}`);
  check("D4 grant revoked: the Dispatcher can't open the contact (Growth refused)", !(await has('[data-testid="contact-consents"]')), await ev("location.pathname"));

  section("E. read_only / locked");
  s = sessions[0];
  await go(`/operations/growth/contacts/${K}`);
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await radio("channel", "sms"); await radio("purpose", "marketing"); await radio("method", "written"); await click('dialog[open] [data-testid="consent-confirm"]');
  setPlus(ORG_A, "expired");
  const n1 = rows(K).length;
  await submitAndWait();
  check("E1 a dialog opened while active and submitted after Plus became read_only is refused server-side (no read_only exception); nothing written",
    (await has('[data-testid="consent-error"]')) && rows(K).length === n1, await text('[data-testid="consent-error"]'));
  await go(`/operations/growth/contacts/${K}`);
  check("E2 read_only Admin: state + history readable, no write controls, the 'recorded again when Nemryn Plus is active' note",
    (await has('[data-testid="consent-table"]')) && (await has('[data-testid="consent-history"]')) && !(await has('[data-testid="consent-record"]'))
    && !(await has('[data-testid="consent-record-revocation"]')) && !(await has('[data-testid^="consent-revoke-"]')) && !(await has('[data-testid="consent-correct"]'))
    && /recorded again when Nemryn Plus is active/.test(await text('[data-testid="consent-read-only"]')));
  await shot("e-read-only-1440");
  setPlus(ORG_A, "disabled", "no_access");
  await go(`/operations/growth/contacts/${K}`);
  check("E3 locked: no consent access (Growth route refused)", !(await has('[data-testid="contact-consents"]')), await ev("location.pathname"));
  sql(`delete from organization_modules where organization_id = '${ORG_A}'`);
  await go(`/operations/growth/contacts/${K}`);
  check("E4 no entitlement: no consent access", !(await has('[data-testid="contact-consents"]')), await ev("location.pathname"));
  setPlus(ORG_A);

  section("F. other identities, redacted and foreign contacts");
  const drv = await open("driver", EMAIL.a3); s = drv;
  await go(`/operations/growth/contacts/${K}`);
  check("F1 Driver: refused", !(await has('[data-testid="contact-consents"]')), await ev("location.pathname"));
  const bAdmin = await open("orgb", EMAIL.b1); s = bAdmin;
  await go(`/operations/growth/contacts/${K}`);
  check("F2 another organization's Admin: Org A contact is not found; no consent data", !(await has('[data-testid="contact-consents"]')) && /could not be found|not found|404/i.test(await ev("document.body.innerText")));
  const anon = await open("anon", null); s = anon;
  await go(`/operations/growth/contacts/${K}`);
  check("F3 signed out: sent to sign-in", (await ev("location.pathname")) === "/sign-in");
  s = sessions[0];
  await go(`/operations/growth/contacts/${KR}`);
  check("F4 redacted contact: not found; no consent exposure", !(await has('[data-testid="contact-consents"]')) && /could not be found|not found|404/i.test(await ev("document.body.innerText")));
  await go(`/operations/growth/contacts/${KB}`);
  check("F5 Org B contact id under the Org A session: not found", !(await has('[data-testid="contact-consents"]')));

  section("G. pagination");
  for (let i = 0; i < 22; i++) (i % 2 ? revokeSql : grantSql)(KP, "sms", "marketing", `s6b-kp-page-${i}-${STAMP}`);
  await go(`/operations/growth/contacts/${KP}?consentHistory=1`);
  const p1 = await ev(`document.querySelectorAll('[data-testid="consent-event"]').length`);
  const total = await text('[data-testid="consent-history"] summary');
  await click('[data-testid="consent-history-older"]');
  await waitFor(async () => (await ev("location.search")) === "?consentHistory=2", 10000); await sleep(800);
  const p2 = await ev(`document.querySelectorAll('[data-testid="consent-event"]').length`);
  check("G1 history pages through the RPC: 20 newest on page 1, the remainder on page 2, accurate total, history open on a paged link",
    p1 === 20 && p2 === 2 && total === "History (22)" && (await ev(`document.querySelector('[data-testid="consent-history"]').open`)), `${p1}/${p2}/${total}`);
  await go(`/operations/growth/contacts/${KP}?consentHistory=99`);
  check("G2 a page past the end falls back to the newest page", (await ev(`document.querySelectorAll('[data-testid="consent-event"]').length`)) === 20);

  section("H. responsive + accessibility");
  for (const w of [1440, 1024, 768, 390]) {
    await s.setViewport(w, 1000);
    await go(`/operations/growth/contacts/${K}`);
    const overflow = await ev("document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth");
    const tableVis = await visible('[data-testid="consent-table"]');
    const notice = /designed for tablet and desktop use/.test(await ev("document.body.innerText"));
    // Operations renders from tablet width up; below md the shell shows its approved notice instead (NP-UI-P1b)
    check(`H1 @${w}: no page-level horizontal overflow; ${w >= 768 ? "the consent table is visible and fits" : "the approved Operations tablet/desktop notice (no panel)"}`,
      overflow <= 0 && (w >= 768 ? tableVis && !notice && (await ev(`[...document.querySelectorAll('h1')].filter(h=>h.checkVisibility()).length`)) === 1 : !tableVis && notice),
      JSON.stringify({ overflow, tableVis, notice }));
    await shot(`h-contact-${w}`);
    if (w === 1440 || w === 768) await axe(`contact detail with consent panel @${w}`);
  }
  await s.setViewport(1440, 1200);
  await go(`/operations/growth/contacts/${K}`);
  await keyboardDialog("Record revocation", '[data-testid="consent-record-revocation"]');
  check("H2 table semantics: caption, column and row headers; badge text carries the state (never colour alone)",
    (await ev(`document.querySelector('[data-testid="consent-table"] caption')?.textContent`)) === "Current communication preferences"
    && (await ev(`document.querySelectorAll('[data-testid="consent-table"] th[scope="col"]').length`)) === 3
    && (await ev(`document.querySelectorAll('[data-testid="consent-table"] th[scope="row"]').length`)) === 3
    && (await ev(`[...document.querySelectorAll('[data-testid^="consent-cell-"]')].every(e => e.innerText.trim().length > 0)`)));
  check("H3 per-cell Revoke buttons have a full accessible name",
    (await ev(`[...document.querySelectorAll('[data-testid^="consent-revoke-"]')].every(b => /^Revoke (service follow-up|marketing) consent for (email|text messages \\(sms\\)|phone calls)$/.test(b.getAttribute('aria-label')))`)) === true);
  await click('[data-testid="consent-record"]');
  await waitFor(() => has('dialog[open] [data-testid="consent-form"]'), 5000);
  await axe("Record consent dialog open (1440)");
  await shot("h-record-dialog-1440");
  await key("Escape", "Escape", 27);
} catch (e) {
  fails++;
  console.log(`FAIL — unexpected error :: ${e.stack || e}`);
} finally {
  for (const x of sessions) { try { await x.close(); } catch {} }
  try { setPlus(ORG_A); setGrant("none"); } catch {}
}
writeFileSync(path.join(OUT, "summary.txt"), `fails=${fails}\n`);
console.log(`\nRESULT: ${fails === 0 ? "ALL PASS" : `${fails} FAILED`}  (artifacts: ${OUT})`);
process.exit(fails === 0 ? 0 : 1);
