// NP-P2-S5-S4 A5 -- integrated Estimates & Quotes journey, end to end, two organizations. ISOLATED Supabase stack
// (NemrynS1Iso) + `next start -p 3100`; FICTIONAL seed identities and data only. The main journey goes through the
// real UI; side fixtures go through the real RPCs.
//   npm run test:e2e:quotes -- s4-integrated      (or: node tests/e2e/plus-quotes/s4-integrated.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep, newChromeSession, signIn, pdfText } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1", d1: "20000000-0000-0000-0000-0000000000d1" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("s4-integrated");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 320) : ""}`); return !!c; };
const must = (n, c, d) => { if (!check(n, c, d)) throw new Error(`stopping: ${n}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|ALTER TABLE|UPDATE \d+)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
const tryAsUser = (uid, stmt) => { try { return asUser(uid, stmt); } catch (e) { const m = String(e.stderr ?? e.message); return `ERROR ${(m.match(/ERROR:\s+([^\n]*)/) ?? [])[1] ?? m.slice(0, 120)}`; } };
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
async function go(s, p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 10000); await sleep(900); }
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const path = (s) => s.evaluate("location.pathname");
const setField = (s, sel, value) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const click = (s, sel) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const memId = (uid) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${ORG_A}'`));
const setPlus = (org, status) => sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, status_reason, trial_started_at, trial_ends_at) values ('${org}', 'plus', '${status}', 'NP-P2-S5-S4 E2E', ${status === "expired" ? "now() - interval '20 days', now() - interval '6 days'" : "null, null"})`);
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (org, name, by, dnc = false) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by, do_not_contact) values ('${org}', '${name}', '(404) 555-0179', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${by}', ${dnc}) returning id`));
const opp = (org, title, k, by) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${org}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${by}') returning id`));
const ver = (t, id) => `(select updated_at from public.${t} where id = '${id}')`;
const createRpc = (o, key, base = 10000, by = U.a1, org = ORG_A) =>
  asUser(by, `select (public.plus_create_quote('${org}', '${o}', '${key}', 'quote', 'dialysis', false, null, ${base}, 2500, 0, 0, 0, 0, 0, 0, null, 500, null, current_date + 10)).quote_id`);
const sendRpc = (q) => asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q}', ${ver("plus_quotes", q)})).status`);
const reviseRpc = (q, key) => asUser(U.a1, `select (public.plus_revise_quote('${ORG_A}', '${q}', '${key}')).quote_id`);
const withdrawRpc = (q, reason) => asUser(U.a1, `select (public.plus_withdraw_quote('${ORG_A}', '${q}', ${ver("plus_quotes", q)}, ${reason ? `'${reason}'` : "null"})).status`);
const quotes = (o) => sql(`select id || '|' || quote_number || '|' || kind || '|' || status || '|' || total_cents || '|' || coalesce(supersedes_quote_id::text,'-') from plus_quotes where opportunity_id='${o}' order by quote_number`).split("\n").filter(Boolean).map((l) => { const [id, n, kind, status, total, sup] = l.split("|"); return { id, n: Number(n), kind, status, total: Number(total), sup }; });
const st = (q) => first(sql(`select status from plus_quotes where id='${q}'`));
const events = (q) => first(sql(`select coalesce(string_agg(activity_type || ':' || quote_status, ',' order by recorded_at, id), '') from plus_activities where quote_id='${q}'`));
const audit = (id) => first(sql(`select coalesce(string_agg(action, ',' order by occurred_at, id), '') from audit_events where entity_id='${id}'`));
const OUTBOUND = () => first(sql(`select (select count(*) from notification_events) || '/' || (select count(*) from audit_events where action ilike '%email%' or action ilike '%sms%' or action ilike '%notif%')`));
const CORE = () => first(sql(`select (select count(*) from transportation_requests where organization_id='${ORG_A}') || '/' || (select count(*) from trips where organization_id='${ORG_A}') || '/' || (select count(*) from passengers where organization_id='${ORG_A}') || '/' || (select count(*) from trip_assignments where organization_id='${ORG_A}')`));
const sessions = [];
const open = async (name, who, w = 1440, h = 1100) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
const is404 = async (s) => /could not be found|404/i.test(await s.evaluate("document.body.innerText")) && !(await has(s, '[data-testid="quote-print"]'));
// UI actions on the opportunity page; each waits for the DATABASE to reflect it (never resubmitted)
async function uiCreateDraft(s, o, { kind, base, mileage = "", valid, terms = "" }) {
  await go(s, `/operations/growth/pipeline/${o}`);
  await click(s, '[data-testid="quote-create-open"]');
  await waitFor(() => has(s, '[data-testid="quote-form"]'));
  await setField(s, '[data-testid="quote-kind"]', kind);
  for (const [k, v] of Object.entries({ base, mileage, "valid-until": valid, terms })) if (v !== "") await setField(s, `[data-testid="quote-${k}"]`, v);
  await sleep(300);
  const before = quotes(o).length;
  await click(s, '[data-testid="quote-save"]');
  return waitFor(() => quotes(o).length === before + 1, 20000);
}
async function uiEditDraft(s, o, base) {
  await go(s, `/operations/growth/pipeline/${o}`);
  await click(s, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(s, '[data-testid="quote-form"]'));
  await setField(s, '[data-testid="quote-base"]', base);
  await sleep(300);
  const d = quotes(o).find((x) => x.status === "draft");
  await click(s, '[data-testid="quote-save"]');
  return waitFor(() => quotes(o).find((x) => x.id === d.id).total !== d.total, 20000);
}
async function uiMarkSent(s, o, { dnc = false } = {}) {
  await go(s, `/operations/growth/pipeline/${o}`);
  await click(s, '[data-testid="quote-send-open"]');
  await waitFor(() => has(s, '[data-testid="quote-send-form"]'));
  if (dnc) { await click(s, '[data-testid="quote-send-dnc-ack"]'); await sleep(250); }
  const d = quotes(o).find((x) => x.status === "draft");
  await click(s, '[data-testid="quote-send-confirm"]');
  return waitFor(() => st(d.id) === "sent", 20000) && waitFor(async () => /marked sent/i.test(await inner(s, '[data-testid="quote-saved"]')), 10000);
}

let revoked = false;
try {
  section("fixtures (fictional)");
  setPlus(ORG_A, "active"); setPlus(ORG_B, "active"); setGrant("none");
  const K = contact(ORG_A, `S4 Pat ${STAMP}`, U.a1);
  const KD = contact(ORG_A, `S4 DNC Dana ${STAMP}`, U.a1, true);
  const O = opp(ORG_A, `S4 Journey ${STAMP}`, K, U.a1);
  const OZ = opp(ORG_A, `S4 ZD-227 ${STAMP}`, K, U.a1);
  const OD = opp(ORG_A, `S4 DNC ${STAMP}`, KD, U.a1);
  const OW = opp(ORG_A, `S4 Write grant ${STAMP}`, K, U.a1); const QW = createRpc(OW, `s4-${STAMP}-w`);
  const KB = contact(ORG_B, `S4 Org B ${STAMP}`, U.b1); const OB = opp(ORG_B, `S4 Org B ${STAMP}`, KB, U.b1); const QB = createRpc(OB, `s4-${STAMP}-b`, 10000, U.b1, ORG_B);
  const VALID = first(sql(`select (public._plus_org_local_today('${ORG_A}') + 14)::text`));
  const OUT0 = OUTBOUND();
  const admin = await open("s4-admin", "org-a-admin@example.test");

  section("A5a. Journey through the UI");
  must("a1 Estimate draft created ($75.00 + $25.00)", await uiCreateDraft(admin, O, { kind: "estimate", base: "75.00", mileage: "25.00", valid: VALID }));
  const E = quotes(O)[0];
  check("a1b one draft Estimate, 10000 cents", E.kind === "estimate" && E.status === "draft" && E.total === 10000, JSON.stringify(E));
  must("a2 draft edited (base $80.00 -> $105.00)", await uiEditDraft(admin, O, "80.00"));
  check("a2b the stored total follows the server calculation (10500)", quotes(O)[0].total === 10500);
  await go(admin, `/operations/growth/pipeline/${O}`);
  await click(admin, '[data-testid="quote-withdraw-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-withdraw-form"]'));
  await click(admin, '[data-testid="quote-withdraw-confirm"]');
  must("a3 draft withdrawn (kept as history)", await waitFor(() => st(E.id) === "withdrawn", 20000));
  const LONG_TERMS = `Fictional S4 terms ${STAMP}: ` + "payable on the day of travel; cancellation within 24 hours may be charged. ".repeat(7);
  must("a4 Quote draft created ($90.00 + $10.00) with a 500-character terms note", await uiCreateDraft(admin, O, { kind: "quote", base: "90.00", mileage: "10.00", valid: VALID, terms: LONG_TERMS.slice(0, 500) }));
  const Q1 = quotes(O).find((x) => x.status === "draft");
  must("a5 Mark sent through the UI", await uiMarkSent(admin, O));
  check("a5b sent; snapshot immutable (a direct UPDATE by the owner role is refused by the guard trigger)", st(Q1.id) === "sent"
    && /ERROR/.test(tryAsUser(U.a1, `update plus_quotes set base_cents = 1 where id = '${Q1.id}'`))
    // the owner role inside a transaction that ALWAYS rolls back: the guard trigger must refuse it
    && /ERROR/.test((() => { try { sql(`begin; update plus_quotes set base_cents = 1 where id = '${Q1.id}'; rollback;`); return "no error"; } catch { return "ERROR"; } })())
    && first(sql(`select base_cents from plus_quotes where id='${Q1.id}'`)) === "9000");
  check("a6 the follow-up offer appears; no task was created automatically", (await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'), 8000)) && first(sql(`select count(*) from plus_tasks where opportunity_id='${O}'`)) === "0");
  await click(admin, '[data-testid="quote-follow-up-open"]');
  await waitFor(() => has(admin, '[data-testid="task-form"]'));
  check("a7 the task dialog: 'Follow up on Quote N', no due date, assigned to the sender", (await admin.evaluate(`document.querySelector('[data-testid="task-form"] input[name="title"]').value`)) === `Follow up on Quote ${Q1.n}`
    && (await admin.evaluate(`document.querySelector('[data-testid="task-form"] input[name="dueDate"]').value`)) === "" && (await admin.evaluate(`document.querySelector('[data-testid="task-form"] select[name="assigneeHandle"]').value`)) === memId(U.a1));
  await click(admin, '[data-testid="task-save"]');
  must("a8 ONE task saved (due_at NULL, assignee = sender)", await waitFor(() => first(sql(`select count(*) || '|' || bool_and(due_at is null) || '|' || bool_and(assignee_user_id = '${U.a1}') from plus_tasks where opportunity_id='${O}'`)) === "1|true|true", 20000));
  await go(admin, `/operations/growth/pipeline/${O}`);
  await click(admin, '[data-testid="quote-revise-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-revise-form"]'));
  await click(admin, '[data-testid="quote-revise-confirm"]');
  must("a9 Revise -> ONE revision draft linked to the sent quote", await waitFor(() => quotes(O).some((x) => x.sup === Q1.id && x.status === "draft"), 20000));
  const Q2 = quotes(O).find((x) => x.sup === Q1.id);
  must("a10 revision edited (base $95.00 -> $105.00)", await uiEditDraft(admin, O, "95.00"));
  must("a11 revision marked sent -> the original is superseded", await uiMarkSent(admin, O));
  check("a11b statuses: Q1 superseded, Q2 sent (OD-Q12: one sent)", st(Q1.id) === "superseded" && st(Q2.id) === "sent" && first(sql(`select count(*) from plus_quotes where opportunity_id='${O}' and status='sent'`)) === "1");
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'), 8000);
  check("a12 the offer shows the existing open task (1) by title", /already has 1 open task/.test(await inner(admin, '[data-testid="quote-follow-up-open-tasks"]')) && (await inner(admin, '[data-testid="quote-follow-up-open-tasks"]')).includes(`Follow up on Quote ${Q1.n}`));
  await click(admin, '[data-testid="quote-follow-up-dismiss"]'); await sleep(500);
  check("a13 No thanks: still 1 task", first(sql(`select count(*) from plus_tasks where opportunity_id='${O}'`)) === "1");
  await go(admin, `/operations/growth/pipeline/${O}`);
  await click(admin, '[data-testid="quote-accept-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-response-form"]'));
  await click(admin, '[data-testid="quote-response-confirm"]');
  must("a14 Record accepted -> accepted; opportunity quote_accepted", await waitFor(() => st(Q2.id) === "accepted", 20000));
  check("a14b the opportunity advanced to quote_accepted; the task untouched (open)", first(sql(`select stage from plus_opportunities where id='${O}'`)) === "quote_accepted" && first(sql(`select status from plus_tasks where opportunity_id='${O}'`)) === "open");
  const ref1 = `Quote ${Q1.n}`; const ref2 = `Quote ${Q2.n}`;
  await go(admin, `/quote-print/${Q1.id}`);
  check("a15 print the superseded original: SUPERSEDED 'Replaced by Quote N', its own $100.00, no closed notice (open)", (await inner(admin, '[data-testid="quote-print-banner"]')).includes(`Replaced by ${ref2}`)
    && (await inner(admin, '[data-testid="quote-print-total"]')) === "$100.00" && !(await has(admin, '[data-testid="quote-print-closed-notice"]')));
  await go(admin, `/quote-print/${Q2.id}`);
  check("a16 print the accepted revision: ACCEPTED, $105.00, no closed notice", /ACCEPTED/.test(await inner(admin, '[data-testid="quote-print-banner"]')) && (await inner(admin, '[data-testid="quote-print-total"]')) === "$105.00" && !(await has(admin, '[data-testid="quote-print-closed-notice"]')));

  section("A5i. Growth-to-Core: Create transportation request (the only Core write)");
  const core0 = CORE();
  const quoteRows0 = sql(`select string_agg(id || status || total_cents || updated_at, ',' order by id) from plus_quotes where opportunity_id='${O}'`);
  await go(admin, `/operations/growth/pipeline/${O}`);
  await click(admin, '[data-testid="convert-open"]');
  await waitFor(() => has(admin, '[data-testid="booking-form"]'));
  await setField(admin, '[data-testid="booking-relationship"]', "self");
  await setField(admin, '[data-testid="booking-pickup"]', `Fictional S4 pickup ${STAMP}`);
  await setField(admin, '[data-testid="booking-destination"]', `Fictional S4 clinic ${STAMP}`);
  await setField(admin, '[data-testid="booking-return"]', "no");
  await click(admin, '[data-testid="booking-review"]');
  await waitFor(() => has(admin, '[data-testid="booking-summary"]'));
  await click(admin, '[data-testid="booking-confirm"]');
  must("i1 conversion succeeded", await waitFor(() => has(admin, '[data-testid="booking-success"]'), 20000));
  const [r0, t0, p0, a0] = core0.split("/").map(Number); const [r1, t1, p1, a1] = CORE().split("/").map(Number);
  check("i2 exactly ONE Core Request; no trip, passenger or assignment", r1 === r0 + 1 && t1 === t0 && p1 === p0 && a1 === a0, `${core0} -> ${CORE()}`);
  check("i3 the opportunity is Converted; the conversion changed NO quote (status, total, version)", first(sql(`select stage from plus_opportunities where id='${O}'`)) === "converted"
    && sql(`select string_agg(id || status || total_cents || updated_at, ',' order by id) from plus_quotes where opportunity_id='${O}'`) === quoteRows0);
  await go(admin, `/quote-print/${Q2.id}`);
  check("i4 print again: ACCEPTED + the O1 'Opportunity closed' notice; no Request pickup / destination in the document", /ACCEPTED/.test(await inner(admin, '[data-testid="quote-print-banner"]'))
    && (await inner(admin, '[data-testid="quote-print-closed-notice"]')).includes("Opportunity closed") && !(await admin.evaluate(`document.body.innerText.includes(${JSON.stringify(`Fictional S4 pickup ${STAMP}`)})`)));
  await admin.screenshot(`${SHOTS}a-accepted-converted.png`);

  section("A5j. Print / PDF (500-character terms)");
  const b64 = (await admin.cdp("Page.printToPDF", { printBackground: false })).data;
  writeFileSync(`${SHOTS}j-accepted-converted.pdf`, Buffer.from(b64, "base64"));
  const { pages, text: txt } = await pdfText(b64);
  const termsTail = LONG_TERMS.slice(0, 500).trim().split(" ").slice(-4).join(" ");
  check("j1 PDF text: reference, Status: Accepted, ACCEPTED banner, Opportunity closed notice, stored lines and $105.00, the WHOLE 500-char terms note, not-an-invoice footer; no toolbar",
    txt.includes(ref2) && txt.includes("Status: Accepted") && /ACCEPTED/.test(txt) && txt.includes("Opportunity closed") && txt.includes("Base transportation") && txt.includes("$95.00") && txt.includes("$105.00")
    && txt.includes(`Fictional S4 terms ${STAMP}`) && txt.includes(termsTail) && txt.includes("not an invoice") && !/Print \/ Save PDF|Back to the opportunity/.test(txt), `pages=${pages}`);
  console.log(`NOTE — PDF pages for the 500-character terms quote: ${pages}`);

  section("A5b. ZD-227: supersede, then withdraw the revision");
  const Z1 = createRpc(OZ, `s4-${STAMP}-z1`); sendRpc(Z1); const Z2 = reviseRpc(Z1, `s4-${STAMP}-z2`); sendRpc(Z2); withdrawRpc(Z2, "Fictional S4 ZD-227 withdrawal");
  check("b1 Z1 superseded, Z2 withdrawn", st(Z1) === "superseded" && st(Z2) === "withdrawn");
  await go(admin, `/quote-print/${Z1}`);
  check("b2 the original prints SUPERSEDED 'Replaced by a revision.' (no number) -- ZD-227", (await inner(admin, '[data-testid="quote-print-banner"]')).includes("Replaced by a revision. This version is no longer the current price.")
    && !/Replaced by Quote \d/.test(await inner(admin, '[data-testid="quote-print-banner"]')));
  await go(admin, `/operations/growth/pipeline/${OZ}`);
  const zRow = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-row"]')].find(r => r.dataset.quoteId === ${JSON.stringify(Z1)})?.innerText ?? ''`);
  check("b3 the panel row for the original names no replacement ('Replaced by Quote N' absent; the status badge 'Replaced by a revision' is the existing label)", zRow !== "" && !/Replaced by (Quote|Estimate) \d/.test(zRow) && /Replaced by a revision/.test(zRow), zRow.replace(/\n/g, " "));

  section("A5c. Directory");
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(STAMP)}`);
  const dirRefs = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-status"]')].map(e => e.dataset.status).sort().join(',')`);
  check("c1 the directory lists this run's quotes with their STORED statuses (closing / converting changed nothing)", dirRefs.includes("accepted") && dirRefs.includes("superseded") && dirRefs.includes("withdrawn"), dirRefs);
  for (const f of ["draft", "sent", "accepted", "declined", "superseded", "withdrawn", "expired"]) {
    await go(admin, `/operations/growth/quotes?status=${f}&q=${encodeURIComponent(STAMP)}`);
    const sts = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-status"]')].map(e => e.dataset.status)`);
    const ok = f === "expired" ? sts.every((x) => x === "sent") : sts.every((x) => x === f);
    check(`c2 status filter '${f}' returns only matching rows (${sts.length})`, ok && (await has(admin, '[data-testid="quotes-directory-summary"]')), JSON.stringify(sts));
  }
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(STAMP)}`);
  check("c3 a Print link on every row", (await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-print"]')].every(a => /^\\/quote-print\\/[0-9a-f-]{36}$/.test(a.getAttribute('href')) && a.target === '_blank')`))
    && (await admin.evaluate(`document.querySelectorAll('[data-testid="quote-directory-print"]').length`)) >= 5);

  section("A5d. Timelines (OD-Q15)");
  check("d1 exactly one event per transition: Q1 sent+superseded; Q2 revised+sent+accepted; E (draft only) none",
    events(Q1.id) === "quote_sent:sent,quote_status_changed:superseded" && events(Q2.id) === "quote_revised:draft,quote_sent:sent,quote_status_changed:accepted" && events(E.id) === "", `${events(Q1.id)} | ${events(Q2.id)} | ${events(E.id)}`);
  check("d2 quote events carry no body (no amounts)", first(sql(`select count(*) from plus_activities where opportunity_id in ('${O}','${OZ}') and quote_id is not null and body is not null`)) === "0");
  await go(admin, `/operations/growth/pipeline/${O}`);
  const hist = await inner(admin, '[data-testid="opportunity-history"]');
  check("d3 opportunity history: staff wording ('marked sent', 'Customer acceptance … recorded', 'created as a revision', 'replaced by revision'); no $ amounts on quote lines",
    hist.includes(`${ref1} marked sent`) && hist.includes(`Customer acceptance of ${ref2} recorded`) && hist.includes(`${ref2} created as a revision of ${ref1}`) && hist.includes(`${ref1} replaced by revision ${ref2}`)
    && !hist.split("\n").filter((l) => /Quote \d/.test(l)).some((l) => /\$\d/.test(l)), hist.slice(0, 300));
  await go(admin, `/operations/growth/contacts/${K}`);
  const tl = await inner(admin, '[data-testid="contact-timeline"]');
  check("d4 contact timeline shows the quote events", tl.includes(`${ref1} marked sent`) && tl.includes(`Customer acceptance of ${ref2} recorded`));
  await go(admin, `/operations/growth`);
  check("d5 dashboard recent activity shows the latest quote events", /Quote \d+/.test(await inner(admin, '[data-testid="growth-recent-activity"]')));

  section("A5e. Do not contact (OD-Q16)");
  const QD = createRpc(OD, `s4-${STAMP}-d`);
  check("e1 a 3-argument send for a DNC contact is refused (ZW004 dnc_acknowledgment_required); nothing written",
    /dnc_acknowledgment_required/.test(tryAsUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${QD}', ${ver("plus_quotes", QD)})).status`)) && st(QD) === "draft" && events(QD) === "");
  check("e2 an explicit false acknowledgment is refused too", /dnc_acknowledgment_required/.test(tryAsUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${QD}', ${ver("plus_quotes", QD)}, false)).status`)));
  must("e3 UI send with the acknowledgment", await uiMarkSent(admin, OD, { dnc: true }));
  check("e4 audited dnc_acknowledged=true / contact_do_not_contact=true; the contact's flag unchanged", first(sql(`select (after_data->>'dnc_acknowledged') || '/' || (after_data->>'contact_do_not_contact') from audit_events where entity_id='${QD}' and action='plus_quote_sent'`)) === "true/true"
    && first(sql(`select do_not_contact from plus_contacts where id='${KD}'`)) === "t");
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'), 8000);
  check("e5 the follow-up offer is internal-only for DNC", /internal reminder only/.test(await inner(admin, '[data-testid="quote-follow-up-dnc"]')));
  await click(admin, '[data-testid="quote-follow-up-dismiss"]');

  section("A5f. Tenant isolation and permissions");
  check("f1 Org B's RPC read of an Org A quote: ZW002; Org A's read of an Org B quote: ZW002", /ZW002|not_found/.test(tryAsUser(U.b1, `select quote_id from public.plus_get_quote('${ORG_A}', '${Q2.id}')`))
    && /ZW002|not_found/.test(tryAsUser(U.a1, `select quote_id from public.plus_get_quote('${ORG_B}', '${QB}')`)));
  const bAdmin = await open("s4-admin-b", "org-b-admin@example.test");
  await go(bAdmin, `/quote-print/${Q2.id}`);
  check("f2 Org B admin: Org A print id -> 404, no data", (await is404(bAdmin)) && !(await bAdmin.evaluate(`document.body.innerText.includes(${JSON.stringify(`S4 Pat ${STAMP}`)})`)));
  await go(admin, `/quote-print/${QB}`);
  check("f3 Org A admin: Org B print id -> 404", await is404(admin));
  setGrant("write");
  const disp = await open("s4-disp", "org-a-dispatcher@example.test");
  await go(disp, `/operations/growth/pipeline/${OW}`);
  check("f4 WRITE-grant Dispatcher: quote write controls on an open opportunity", (await has(disp, '[data-testid="quote-send-open"]')) && (await has(disp, '[data-testid="quote-edit-open"]')));
  setGrant("read");
  await go(disp, `/operations/growth/pipeline/${OW}`);
  check("f5 READ-grant Dispatcher: rows + Print, NO write controls", (await has(disp, '[data-testid="quote-print-link"]')) && !(await has(disp, '[data-testid="quote-send-open"]')) && !(await has(disp, '[data-testid="quote-create-open"]')));
  await go(disp, `/quote-print/${Q2.id}`);
  check("f6 READ-grant Dispatcher prints", await has(disp, '[data-testid="quote-print"]'));
  check("f7 READ-grant Dispatcher: RPC writes refused (ZW001)", /ZW001|plus_write_required|unauthorized/.test(tryAsUser(U.a2, `select (public.plus_mark_quote_sent('${ORG_A}', '${QW}', ${ver("plus_quotes", QW)})).status`)));
  setGrant("none");
  await go(disp, `/quote-print/${Q2.id}`);
  check("f8 no-grant Dispatcher: refused", !(await has(disp, '[data-testid="quote-print"]')));
  const drv = await open("s4-driver", "org-a-driver-a@example.test");
  await go(drv, `/quote-print/${Q2.id}`);
  check("f9 Driver: refused", !(await has(drv, '[data-testid="quote-print"]')));
  const pa = await open("s4-platform", "platform-admin@example.test");
  await go(pa, `/quote-print/${Q2.id}`);
  check("f10 Platform admin (no tenant membership): no document; RPC read refused", !(await has(pa, '[data-testid="quote-print"]')) && /ERROR/.test(tryAsUser(U.d1, `select quote_id from public.plus_get_quote('${ORG_A}', '${Q2.id}')`)), await path(pa));
  const anon = await open("s4-anon", null);
  await go(anon, `/quote-print/${Q2.id}`);
  check("f11 signed out: sign-in", /sign-in/.test(await path(anon)) && !(await has(anon, '[data-testid="quote-print"]')));
  setPlus(ORG_A, "expired");
  await go(admin, `/operations/growth/pipeline/${OW}`);
  check("f12 Plus expired: Admin reads (rows, Print) but has no write controls", (await has(admin, '[data-testid="quote-print-link"]')) && !(await has(admin, '[data-testid="quote-send-open"]')));
  await go(admin, `/quote-print/${Q2.id}`);
  check("f13 Plus expired: Admin still prints", await has(admin, '[data-testid="quote-print"]'));
  setPlus(ORG_A, "active");

  section("A5g/h. Audit integrity and zero outbound");
  check("g1 audit per quote: E created+draft_updated+withdrawn; Q1 created+sent+superseded; Q2 created+draft_updated+sent+accepted",
    audit(E.id) === "plus_quote_created,plus_quote_draft_updated,plus_quote_withdrawn" && audit(Q1.id) === "plus_quote_created,plus_quote_sent,plus_quote_superseded"
    && audit(Q2.id) === "plus_quote_created,plus_quote_draft_updated,plus_quote_sent,plus_quote_accepted", `${audit(E.id)} | ${audit(Q1.id)} | ${audit(Q2.id)}`);
  check("g2 opportunity audit includes the conversion", /plus_opportunity_converted/.test(audit(O)));
  check("h1 zero outbound: notification events and email / SMS audit unchanged", OUTBOUND() === OUT0, `${OUT0} -> ${OUTBOUND()}`);
  await go(admin, `/operations/growth/pipeline/${O}`);
  check("h2 no mailto / sms / share / public link anywhere on the opportunity page", !(await admin.evaluate(`!!document.querySelector('a[href^="mailto:"], a[href^="sms:"]') || [...document.querySelectorAll('button, a')].some(e => /\\b(Share|Copy link|Send to customer|Email quote)\\b/.test(e.innerText))`)));

  section("A5k. Responsive widths");
  for (const [w, h] of [[1024, 900], [768, 1024]]) {
    const t = await open(`s4-w${w}`, "org-a-admin@example.test", w, h);
    await go(t, `/operations/growth/pipeline/${OW}`);
    const noOverflow = await t.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1");
    await click(t, '[data-testid="quote-send-open"]');
    await waitFor(() => has(t, '[data-testid="quote-send-form"]'));
    const dialogFits = await t.evaluate(`(function(){const d=document.querySelector('[data-testid="quote-send-form"]').closest('dialog'); const r=d.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1;})()`);
    await go(t, `/operations/growth/quotes`);
    const dirOk = await t.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1");
    check(`k1 ${w} px: opportunity page, Mark sent dialog and directory fit (no page overflow)`, noOverflow && dialogFits && dirOk, `${noOverflow}/${dialogFits}/${dirOk}`);
    await t.screenshot(`${SHOTS}k-${w}.png`);
  }
  const phone = await open("s4-390", "org-a-admin@example.test", 390, 844);
  await go(phone, `/operations/growth/pipeline/${O}`);
  check("k2 390 px: the Operations shell shows its 'designed for tablet and desktop' notice", await phone.evaluate(`(function(){const n=[...document.querySelectorAll('h1,h2,h3,p')].find(e=>/designed for tablet and desktop use/.test(e.textContent)); return !!n && n.offsetParent !== null;})()`));
  await go(phone, `/quote-print/${Q2.id}`);
  check("k3 390 px: the print page (outside the shell) is readable with no horizontal overflow", (await has(phone, '[data-testid="quote-print"]')) && (await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")));
  await phone.screenshot(`${SHOTS}k-390-print.png`);
} catch (e) {
  fails++;
  console.log(`FAIL — STOPPED :: ${e?.stack ?? e}`);
} finally {
  try { if (revoked) sql(`grant execute on function public.plus_get_quote(uuid, uuid) to authenticated`); } catch {}
  try { setGrant("none"); setPlus(ORG_A, "active"); } catch {}
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
