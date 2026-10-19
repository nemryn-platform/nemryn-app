// NP-P2-S5-S3C local browser E2E -- printable estimates & quotes (OD-Q10 A, ZD-224) and the optional follow-up task
// after Mark sent (OD-Q11 A, ZD-225). ISOLATED Supabase stack (NemrynS1Iso) + `next start -p 3100`; FICTIONAL seed
// identities and data only.
//   npm run test:e2e:quotes -- s3c      (or: node tests/e2e/plus-quotes/s3c-print-followup.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep, newChromeSession, signIn } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("s3c");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|ALTER TABLE|UPDATE \d+)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
async function go(s, p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 10000); await sleep(900); }
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const val = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
const click = (s, sel) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const path = (s) => s.evaluate("location.pathname");
const memId = (uid, org = ORG_A) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${org}'`));
const setPlus = (org, status) => sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, status_reason, trial_started_at, trial_ends_at) values ('${org}', 'plus', '${status}', 'NP-P2-S5-S3C E2E', ${status === "expired" ? "now() - interval '20 days', now() - interval '6 days'" : "null, null"})`);
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (org, name, by, dnc = false) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by, do_not_contact) values ('${org}', '${name}', '(404) 555-0177', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${by}', ${dnc}) returning id`));
const opp = (org, title, k, by) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${org}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${by}') returning id`));
const ver = (q) => `(select updated_at from public.plus_quotes where id = '${q}')`;
const create = (o, key, base = 10000, by = U.a1, org = ORG_A) =>
  asUser(by, `select (public.plus_create_quote('${org}', '${o}', '${key}', 'quote', 'dialysis', true, 12.5, ${base}, 2500, 0, 0, 0, 0, 0, 0, null, 500, 'Fictional terms: payable on the day of travel.', current_date + 10)).quote_id`);
const send = (q, by = U.a1, org = ORG_A) => asUser(by, `select (public.plus_mark_quote_sent('${org}', '${q}', ${ver(q)})).status`);
const respond = (q, r) => asUser(U.a1, `select (public.plus_record_quote_response('${ORG_A}', '${q}', ${ver(q)}, '${r}')).status`);
const withdraw = (q, reason = null) => asUser(U.a1, `select (public.plus_withdraw_quote('${ORG_A}', '${q}', ${ver(q)}, ${reason ? `'${reason}'` : "null"})).status`);
const revise = (q, key) => asUser(U.a1, `select (public.plus_revise_quote('${ORG_A}', '${q}', '${key}')).quote_id`);
const editBase = (q, base) => asUser(U.a1, `select (public.plus_update_quote_draft('${ORG_A}', '${q}', ${ver(q)}, 'quote', 'dialysis', true, 12.5, ${base}, 2500, 0, 0, 0, 0, 0, 0, null, 500, 'Fictional terms: payable on the day of travel.', current_date + 10)).status`);
const st = (q) => first(sql(`select status from plus_quotes where id = '${q}'`));
const num = (q) => first(sql(`select quote_number from plus_quotes where id = '${q}'`));
const tasks = (o) => first(sql(`select count(*) from plus_tasks where opportunity_id = '${o}'`));
const taskRow = (o) => first(sql(`select title || '|' || coalesce(due_at::text,'NULL') || '|' || coalesce(assignee_user_id::text,'NULL') || '|' || status || '|' || created_by || '|' || updated_at from plus_tasks where opportunity_id = '${o}' order by created_at desc limit 1`));
const comms = () => first(sql(`select (select count(*) from notification_events) || '/' || (select count(*) from audit_events where action ilike '%email%' or action ilike '%sms%' or action ilike '%notif%')`));
const sessions = [];
const open = async (name, who, w = 1440, h = 1200) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
const is404 = async (s) => /could not be found|404/i.test(await s.evaluate("document.body.innerText")) && !(await has(s, '[data-testid="quote-print"]'));
async function markSentUI(s, oid, { dnc = false } = {}) {
  await go(s, `/operations/growth/pipeline/${oid}`);
  if (!(await click(s, '[data-testid="quote-send-open"]'))) return false;
  await waitFor(() => has(s, '[data-testid="quote-send-form"]'));
  if (dnc) { await click(s, '[data-testid="quote-send-dnc-ack"]'); await sleep(200); }
  await click(s, '[data-testid="quote-send-confirm"]');
  return waitFor(async () => /marked sent/i.test(await inner(s, '[data-testid="quote-saved"]')), 20000);
}

const ORG_FIELDS = first(sql(`select coalesce(business_phone,'∅') || '¦' || coalesce(business_email,'∅') || '¦' || coalesce(business_address,'∅') from organizations where id = '${ORG_A}'`));
let revoked = false;
try {
  section("fixtures (fictional, through the real RPCs)");
  setPlus(ORG_A, "active"); setPlus(ORG_B, "active"); setGrant("none");
  sql(`update organizations set business_phone = '(404) 555-0100', business_email = 'office@fictional-transport.example.test', business_address = '100 Fictional Way, Atlanta, GA 30301' where id = '${ORG_A}'`);
  const COMMS0 = comms();
  const K = contact(ORG_A, `S3C Pat ${STAMP}`, U.a1);
  const KD = contact(ORG_A, `S3C DNC Dana ${STAMP}`, U.a1, true);
  // print fixtures: one per status
  const OP = opp(ORG_A, `S3C Print sent ${STAMP}`, K, U.a1); const QS = create(OP, `s3c-${STAMP}-s`); send(QS);
  const OPD = opp(ORG_A, `S3C Print draft ${STAMP}`, K, U.a1); const QDR = create(OPD, `s3c-${STAMP}-d`);
  const OPA = opp(ORG_A, `S3C Print accepted ${STAMP}`, K, U.a1); const QA = create(OPA, `s3c-${STAMP}-a`); send(QA); respond(QA, "accepted");
  const OPX = opp(ORG_A, `S3C Print declined ${STAMP}`, K, U.a1); const QX = create(OPX, `s3c-${STAMP}-x`); send(QX); respond(QX, "declined");
  const OPS = opp(ORG_A, `S3C Print superseded ${STAMP}`, K, U.a1); const QOLD = create(OPS, `s3c-${STAMP}-o`, 10000); send(QOLD);
  const QNEW = revise(QOLD, `s3c-${STAMP}-n`); editBase(QNEW, 20000); send(QNEW);
  const OPW = opp(ORG_A, `S3C Print withdrawn ${STAMP}`, K, U.a1); const QW = create(OPW, `s3c-${STAMP}-w`); send(QW); withdraw(QW, "Fictional: customer chose another option");
  const QWD = create(OPW, `s3c-${STAMP}-wd`); withdraw(QWD);
  const OPE = opp(ORG_A, `S3C Print expired ${STAMP}`, K, U.a1); const QE = create(OPE, `s3c-${STAMP}-e`); send(QE);
  sql(`begin; alter table plus_quotes disable trigger plus_quotes_guard; update plus_quotes set valid_until = public._plus_org_local_today('${ORG_A}') - 1 where id = '${QE}'; alter table plus_quotes enable trigger plus_quotes_guard; commit;`);
  const KB = contact(ORG_B, `S3C Org B ${STAMP}`, U.b1); const OB = opp(ORG_B, `S3C Org B opp ${STAMP}`, KB, U.b1); const QB = create(OB, `s3c-${STAMP}-b`, 10000, U.b1, ORG_B);
  // follow-up fixtures
  const OF1 = opp(ORG_A, `S3C Follow-up ${STAMP}`, K, U.a1); create(OF1, `s3c-${STAMP}-f1`);
  const OF2 = opp(ORG_A, `S3C Dismiss ${STAMP}`, K, U.a1); create(OF2, `s3c-${STAMP}-f2`);
  const OF3 = opp(ORG_A, `S3C Existing task ${STAMP}`, K, U.a1); create(OF3, `s3c-${STAMP}-f3`);
  asUser(U.a1, `select (public.plus_create_task('${ORG_A}', 'Fictional earlier call-back ${STAMP}', null, null, null, '${OF3}')).task_id`);
  const OFD = opp(ORG_A, `S3C DNC follow-up ${STAMP}`, KD, U.a1); create(OFD, `s3c-${STAMP}-fd`);
  const OFT = opp(ORG_A, `S3C Tablet ${STAMP}`, K, U.a1); create(OFT, `s3c-${STAMP}-ft`);
  console.log(`statuses: sent=${st(QS)} draft=${st(QDR)} accepted=${st(QA)} declined=${st(QX)} old=${st(QOLD)} new=${st(QNEW)} withdrawn=${st(QW)}/${st(QWD)} expired-sent=${st(QE)} orgB=${st(QB)}`);
  const admin = await open("s3c-admin", "org-a-admin@example.test");

  section("P. Printable view: content (stored values; customer display name only)");
  await go(admin, `/quote-print/${QS}`);
  const doc = await inner(admin, '[data-testid="quote-print"]');
  check("P1 a sent quote prints: organization name, existing business phone / email / address, 'Quote N', status Sent, no banner",
    (await inner(admin, '[data-testid="quote-print-organization"]')).length > 0 && /\(404\) 555-0100/.test(doc) && /office@fictional-transport\.example\.test/.test(doc) && /100 Fictional Way/.test(doc)
    && (await inner(admin, '[data-testid="quote-print-reference"]')) === `Quote ${num(QS)}` && /Status: Sent/.test(await inner(admin, '[data-testid="quote-print-status"]')) && !(await has(admin, '[data-testid="quote-print-banner"]')), doc);
  check("P2 dates, service, round trip, miles; only non-zero itemized charges; discount; stored total (USD); terms; not-an-invoice footer",
    /Valid until/.test(doc) && /Date/.test(doc) && /Shared with the customer/.test(doc) && /Dialysis/.test(doc) && /Round trip\s+Yes/.test(doc) && /12\.5 mi/.test(doc)
    && (await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-print-line"]')].map(r=>r.innerText.replace(/\\s+/g,' ')).join('|')`)) === "Base transportation $100.00|Mileage charge $25.00"
    && /−\$5\.00/.test(await inner(admin, '[data-testid="quote-print-discount"]'))
    && (await inner(admin, '[data-testid="quote-print-total"]')) === first(sql(`select '$' || to_char(total_cents / 100.0, 'FM999,999,990.00') from plus_quotes where id = '${QS}'`))
    && /Total \(USD\)/.test(doc) && /payable on the day of travel/.test(await inner(admin, '[data-testid="quote-print-terms"]'))
    && (await inner(admin, '[data-testid="quote-print-footer"]')) === "This is a quote, not an invoice. Prices in US dollars.", doc);
  check("P3 customer display name only: no contact phone / email, no opportunity title, no staff names",
    (await inner(admin, '[data-testid="quote-print-customer"]')) === `S3C Pat ${STAMP}` && !/555-0177/.test(doc) && !/@example\.test/.test(doc.replace("office@fictional-transport.example.test", "")) && !doc.includes(`S3C Print sent ${STAMP}`)
    && !/Org A Admin|created by|marked sent by/i.test(doc));
  check("P4 the toolbar: 'Print / Save PDF' and 'Back to the opportunity' (to its quotes panel); no email, share or link action",
    (await has(admin, '[data-testid="quote-print-button"]')) && (await admin.evaluate(`document.querySelector('[data-testid="quote-print-back"]').getAttribute('href')`)) === `/operations/growth/pipeline/${OP}#quotes`
    && !(await admin.evaluate(`!!document.querySelector('a[href^="mailto:"], a[href^="sms:"]') || /\\b(Email|Share|Copy link|Send)\\b/.test(document.querySelector('[data-testid="quote-print-toolbar"]').innerText)`)));
  const headers = await admin.evaluate(`fetch(location.href, { credentials: 'include' }).then(r => r.status + ' ' + (r.headers.get('cache-control') || ''))`);
  check("P5 the response is dynamic and not cacheable (no-store / private)", /^200 /.test(headers) && /no-store|private/.test(headers), headers);
  check("P6 robots noindex", await admin.evaluate(`/noindex/.test(document.querySelector('meta[name="robots"]')?.content || '')`));
  await admin.screenshot(`${SHOTS}p1-sent-screen.png`);

  section("P. Print media and Save as PDF");
  await admin.cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("P7 print media: the toolbar is hidden on paper; the document content stays", (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-toolbar"]')).display`)) === "none"
    && (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-charges"]')).display`)) !== "none");
  await admin.cdp("Emulation.setEmulatedMedia", { media: "" });
  const pdf = await admin.cdp("Page.printToPDF", { printBackground: false });
  const bytes = Buffer.from(pdf.data, "base64");
  writeFileSync(`${SHOTS}p8-sent-quote.pdf`, bytes);
  check("P8 the browser's Save as PDF produces a PDF of the view (local file only; nothing stored by Nemryn)", bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length > 2000, bytes.length);

  section("P. Status banners (every status prints)");
  const banner = async (q) => { await go(admin, `/quote-print/${q}`); return { b: await inner(admin, '[data-testid="quote-print-banner"]'), s: await inner(admin, '[data-testid="quote-print-status"]'), t: await inner(admin, '[data-testid="quote-print-total"]') }; };
  let r = await banner(QDR);
  check("P9 draft: DRAFT banner, status Draft, no 'shared with the customer' date", /DRAFT/.test(r.b) && /Not yet given to the customer/.test(r.b) && /Status: Draft/.test(r.s) && !/Shared with the customer/.test(await inner(admin, '[data-testid="quote-print-details"]')), r.b);
  await admin.screenshot(`${SHOTS}p9-draft.png`);
  r = await banner(QA);
  check("P10 accepted: staff-recorded acceptance with the date, status Accepted", /ACCEPTED/.test(r.b) && /Customer acceptance recorded by staff on [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(r.b) && /Status: Accepted/.test(r.s) && !/online|signed|verified/i.test(r.b), r.b);
  r = await banner(QX);
  check("P11 declined: staff-recorded decline with the date, status Declined", /DECLINED/.test(r.b) && /Customer decline recorded by staff on/.test(r.b) && /Status: Declined/.test(r.s), r.b);
  r = await banner(QOLD);
  const rNew = await banner(QNEW);
  check("P12 superseded: SUPERSEDED banner naming its replacement, status Superseded, and its OWN stored amounts (not the revision's)",
    /SUPERSEDED/.test(r.b) && r.b.includes(`Replaced by Quote ${num(QNEW)}`) && /Status: Superseded/.test(r.s) && r.t === "$120.00" && rNew.t === "$220.00" && rNew.b === "" && /Status: Sent/.test(rNew.s), `${r.b} ${r.t} / ${rNew.t}`);
  await go(admin, `/quote-print/${QOLD}`); await admin.screenshot(`${SHOTS}p12-superseded.png`);
  r = await banner(QW);
  const wd = await banner(QWD);
  check("P13 withdrawn (sent and draft): WITHDRAWN banner, status Withdrawn; the internal withdrawal reason is not printed",
    /WITHDRAWN/.test(r.b) && /No longer offered/.test(r.b) && /Status: Withdrawn/.test(r.s) && /WITHDRAWN/.test(wd.b) && !(await admin.evaluate(`document.body.innerText.includes('customer chose another option')`)), r.b);
  await go(admin, `/quote-print/${QW}`);
  check("P13b the sent withdrawal's reason is not printed", !(await admin.evaluate(`document.body.innerText.includes('customer chose another option')`)));
  r = await banner(QE);
  check("P14 expired (derived): EXPIRED banner with the passed date, status Expired", /EXPIRED/.test(r.b) && /valid-until date \(.+\) has passed/.test(r.b) && /Status: Expired/.test(r.s), r.b);

  section("P. Tenant isolation and access");
  await go(admin, `/quote-print/${QB}`);
  check("P15 an Org B quote id from Org A's session: 404 (no Org B data)", (await is404(admin)) && !(await admin.evaluate(`document.body.innerText.includes(${JSON.stringify(`S3C Org B ${STAMP}`)})`)));
  await go(admin, `/quote-print/00000000-0000-4000-8000-000000000000`);
  check("P16 an unknown quote id: the same 404", await is404(admin));
  await go(admin, `/quote-print/not-a-uuid`);
  check("P17 a malformed id: the same 404", await is404(admin));
  const adminB = await open("s3c-admin-b", "org-b-admin@example.test");
  await go(adminB, `/quote-print/${QS}`);
  check("P18 Org B's Admin opening an Org A quote: 404", (await is404(adminB)) && !(await adminB.evaluate(`document.body.innerText.includes(${JSON.stringify(`S3C Pat ${STAMP}`)})`)));
  await go(adminB, `/quote-print/${QB}`);
  check("P19 Org B's Admin prints its own quote", (await has(adminB, '[data-testid="quote-print"]')) && (await inner(adminB, '[data-testid="quote-print-customer"]')) === `S3C Org B ${STAMP}`);
  const anon = await open("s3c-anon", null);
  await go(anon, `/quote-print/${QS}`);
  check("P20 signed out: no document; sent to sign-in (no public quote URL)", !(await has(anon, '[data-testid="quote-print"]')) && /sign-in/.test(await path(anon)), await path(anon));
  setGrant("read");
  const disp = await open("s3c-disp", "org-a-dispatcher@example.test");
  await go(disp, `/quote-print/${QS}`);
  check("P21 READ-grant Dispatcher: can print (Plus read is enough)", (await has(disp, '[data-testid="quote-print"]')) && /Status: Sent/.test(await inner(disp, '[data-testid="quote-print-status"]')));
  await go(disp, `/operations/growth/pipeline/${OP}`);
  check("P22 READ-grant: the Print link is on the panel rows; no write controls and no follow-up offer",
    (await has(disp, '[data-testid="quote-print-link"]')) && !(await has(disp, '[data-testid="quote-sent-actions"]')) && !(await has(disp, '[data-testid="quote-follow-up-offer"]')));
  setGrant("none");
  await go(disp, `/quote-print/${QS}`);
  check("P23 no-grant Dispatcher: no document (the existing Growth access behaviour)", !(await has(disp, '[data-testid="quote-print"]')), await path(disp));
  const drv = await open("s3c-driver", "org-a-driver-a@example.test");
  await go(drv, `/quote-print/${QS}`);
  check("P24 Driver: no document", !(await has(drv, '[data-testid="quote-print"]')), await path(drv));
  setPlus(ORG_A, "expired");
  await go(admin, `/quote-print/${QS}`);
  check("P25 Plus expired (read-only): the Admin can still print the record", await has(admin, '[data-testid="quote-print"]'));
  setPlus(ORG_A, "active");
  sql(`revoke execute on function public.plus_get_quote(uuid, uuid) from authenticated`); revoked = true;
  await go(admin, `/quote-print/${QS}`);
  check("P26 a failed quote read shows an error, never a blank or partial document", !(await has(admin, '[data-testid="quote-print"]')));
  sql(`grant execute on function public.plus_get_quote(uuid, uuid) to authenticated`); revoked = false;

  section("P. Entry points");
  await go(admin, `/operations/growth/pipeline/${OPS}`);
  const links = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-print-link"]')].map(a => a.getAttribute('href') + '|' + a.target + '|' + a.rel).join(',')`);
  check("P27 the opportunity panel: a Print link on every row (current and history), new tab, noopener",
    links.split(",").length === 2 && links.includes(`/quote-print/${QOLD}|_blank|noopener`) && links.includes(`/quote-print/${QNEW}|_blank|noopener`), links);
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(`S3C Print sent ${STAMP}`)}`);
  const dl = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-print"]')].map(a => a.getAttribute('href') + '|' + a.target).join(',')`);
  check("P28 the directory: a Print link per row (new tab)", dl.includes(`/quote-print/${QS}|_blank`), dl);
  const before = await path(admin);
  await click(admin, '[data-testid="quote-directory-print"]'); await sleep(800);
  check("P29 the directory Print link doesn't also trigger the row navigation in this tab", (await path(admin)) === before, await path(admin));

  section("F. Follow-up offer after Mark sent (never automatic)");
  const t0 = tasks(OF1);
  check("F1 Mark sent through the UI", await markSentUI(admin, OF1));
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'));
  const offerText = await inner(admin, '[data-testid="quote-follow-up-offer"]');
  check("F2 the optional offer appears with 'Add follow-up task' and 'No thanks'; NO task was created", /optional/.test(offerText) && (await has(admin, '[data-testid="quote-follow-up-open"]')) && (await has(admin, '[data-testid="quote-follow-up-dismiss"]')) && tasks(OF1) === t0 && t0 === "0", offerText);
  check("F3 no existing-open-task notice when there are none; no do-not-contact reminder for this contact", !(await has(admin, '[data-testid="quote-follow-up-open-tasks"]')) && !(await has(admin, '[data-testid="quote-follow-up-dnc"]')));
  await admin.screenshot(`${SHOTS}f2-offer.png`);
  await click(admin, '[data-testid="quote-follow-up-open"]');
  await waitFor(() => has(admin, '[data-testid="task-form"]'));
  const fq = first(sql(`select quote_number from plus_quotes where opportunity_id = '${OF1}' and status = 'sent'`));
  check("F4 the existing task dialog: fixed to this opportunity, suggested title 'Follow up on Quote N', NO due date or time, assigned to the person who marked it sent",
    (await inner(admin, '[data-testid="task-subject"]')) === `Opportunity: S3C Follow-up ${STAMP}` && (await val(admin, '[data-testid="task-form"] input[name="title"]')) === `Follow up on Quote ${fq}`
    && (await val(admin, '[data-testid="task-form"] input[name="dueDate"]')) === "" && (await val(admin, '[data-testid="task-form"] input[name="dueTime"]')) === ""
    && (await val(admin, '[data-testid="task-form"] select[name="assigneeHandle"]')) === memId(U.a1), await val(admin, '[data-testid="task-form"] select[name="assigneeHandle"]'));
  await admin.screenshot(`${SHOTS}f4-task-dialog.png`);
  await admin.evaluate(`[...document.querySelectorAll('[data-testid="task-form"] button')].find(b => b.innerText.trim() === 'Cancel').click()`); await sleep(600);
  check("F5 Cancel creates nothing; the offer stays available", tasks(OF1) === "0" && (await has(admin, '[data-testid="quote-follow-up-offer"]')));
  await click(admin, '[data-testid="quote-follow-up-open"]');
  await waitFor(() => has(admin, '[data-testid="task-form"]'));
  // double activation of Save: the dialog's single-submit guard + plus_create_task's 30 s duplicate window
  await admin.evaluate(`(function(){const b=document.querySelector('[data-testid="task-save"]'); b.click(); b.click();})()`);
  await waitFor(async () => /Task added|already added/.test(await inner(admin, '[data-testid="quote-saved"]')), 15000);
  const tr = taskRow(OF1).split("|");
  check("F6 an explicit save creates EXACTLY ONE open opportunity task: suggested title, due date NULL, assignee = the sender",
    tasks(OF1) === "1" && tr[0] === `Follow up on Quote ${fq}` && tr[1] === "NULL" && tr[2] === U.a1 && tr[3] === "open" && tr[4] === U.a1, taskRow(OF1));
  const f7msg = await inner(admin, '[data-testid="quote-saved"]');
  const f7offer = await has(admin, '[data-testid="quote-follow-up-offer"]');
  const f7list = await waitFor(async () => (await inner(admin, '[data-testid="opportunity-tasks"]')).includes(`Follow up on Quote ${fq}`), 8000);
  // a double activation is answered by plus_create_task's duplicate window ("That task was already added.") -- still one task
  check("F7 the confirmation (Task added / already added); the offer is gone; the task shows under Open tasks", /Task added|task was already added/.test(f7msg) && !f7offer && f7list, `msg=${f7msg} offer=${f7offer} list=${f7list}`);
  check("F8 audited once as plus_task_created (the existing task audit)", first(sql(`select count(*) from audit_events where action = 'plus_task_created' and entity_id = (select id from plus_tasks where opportunity_id = '${OF1}')`)) === "1");
  await go(admin, `/operations/growth/pipeline/${OF1}`);
  check("F9 after a reload no offer reappears (it's only offered right after Mark sent)", !(await has(admin, '[data-testid="quote-follow-up-offer"]')));

  check("F10 Mark sent on a second opportunity", await markSentUI(admin, OF2));
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'));
  await click(admin, '[data-testid="quote-follow-up-dismiss"]'); await sleep(500);
  check("F11 'No thanks' dismisses the offer; no task", !(await has(admin, '[data-testid="quote-follow-up-offer"]')) && tasks(OF2) === "0");

  check("F12 Mark sent where the opportunity already has an open task", await markSentUI(admin, OF3));
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'));
  const dup = await inner(admin, '[data-testid="quote-follow-up-open-tasks"]');
  check("F13 the offer shows the existing open task (count and title) to discourage a duplicate", /already has 1 open task/.test(dup) && dup.includes(`Fictional earlier call-back ${STAMP}`), dup);
  await click(admin, '[data-testid="quote-follow-up-open"]');
  await waitFor(() => has(admin, '[data-testid="task-form"]'));
  check("F14 ... and inside the task dialog too", /already has 1 open task/.test(await inner(admin, '[data-testid="quote-follow-up-notice"]')) && tasks(OF3) === "1");
  await admin.evaluate(`[...document.querySelectorAll('[data-testid="task-form"] button')].find(b => b.innerText.trim() === 'Cancel').click()`); await sleep(400);

  section("F. Do not contact: internal reminders only");
  const dnc0 = first(sql(`select do_not_contact from plus_contacts where id = '${KD}'`));
  check("F15 Mark sent for a do-not-contact contact (with the OD-Q16 acknowledgment)", await markSentUI(admin, OFD, { dnc: true }));
  await waitFor(() => has(admin, '[data-testid="quote-follow-up-offer"]'));
  check("F16 the offer carries the internal-reminder-only notice", /internal reminder only/.test(await inner(admin, '[data-testid="quote-follow-up-dnc"]')) && tasks(OFD) === "0");
  await click(admin, '[data-testid="quote-follow-up-open"]');
  await waitFor(() => has(admin, '[data-testid="task-form"]'));
  const dq = first(sql(`select quote_number from plus_quotes where opportunity_id = '${OFD}' and status = 'sent'`));
  const dTitle = await val(admin, '[data-testid="task-form"] input[name="title"]');
  check("F17 the dialog suggests an INTERNAL review title (no call / email wording) and shows the do-not-contact warning",
    dTitle === `Review Quote ${dq} internally` && !/call|email|text|contact/i.test(dTitle) && /Internal reminder only/.test(await inner(admin, '[data-testid="quote-follow-up-notice"]')), dTitle);
  await admin.screenshot(`${SHOTS}f17-dnc-dialog.png`);
  await click(admin, '[data-testid="task-save"]');
  await waitFor(async () => /Task added/.test(await inner(admin, '[data-testid="quote-saved"]')), 15000);
  check("F18 the internal task is saved; the contact's do-not-contact flag is unchanged; no consent / preference row changes",
    tasks(OFD) === "1" && first(sql(`select do_not_contact from plus_contacts where id = '${KD}'`)) === dnc0 && dnc0 === "t", taskRow(OFD));

  section("F. Accept / decline / withdraw never touch tasks");
  const before1 = taskRow(OF1);
  const QF1 = first(sql(`select id from plus_quotes where opportunity_id = '${OF1}' and status = 'sent'`));
  respond(QF1, "accepted");
  const QF3 = first(sql(`select id from plus_quotes where opportunity_id = '${OF3}' and status = 'sent'`)); const before3 = taskRow(OF3);
  respond(QF3, "declined");
  const QFD = first(sql(`select id from plus_quotes where opportunity_id = '${OFD}' and status = 'sent'`)); const beforeD = taskRow(OFD);
  withdraw(QFD, "Fictional: no longer needed");
  check("F19 recording accepted / declined and withdrawing leave every task exactly as it was (open, same version)",
    st(QF1) === "accepted" && st(QF3) === "declined" && st(QFD) === "withdrawn" && taskRow(OF1) === before1 && taskRow(OF3) === before3 && taskRow(OFD) === beforeD && before1.split("|")[3] === "open");
  check("F20 no other task anywhere was created, completed or cancelled by the run (only the 2 explicit saves + 1 fixture)",
    first(sql(`select count(*) || '/' || count(*) filter (where status = 'open') from plus_tasks where opportunity_id in ('${OF1}','${OF2}','${OF3}','${OFD}','${OFT}','${OP}','${OPD}','${OPA}','${OPX}','${OPS}','${OPW}','${OPE}')`)) === "3/3");

  section("T. Narrowest supported Operations width (768 px)");
  const tab = await open("s3c-tablet", "org-a-admin@example.test", 768, 1024);
  check("T1 768 px: Mark sent and the offer", await markSentUI(tab, OFT));
  const vis = (sel) => tab.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; const r=e.getBoundingClientRect(); return e.offsetParent !== null && r.width > 0 && r.right <= window.innerWidth + 1;})()`);
  await waitFor(() => has(tab, '[data-testid="quote-follow-up-offer"]'));
  check("T2 768 px: the offer and its buttons are visible inside the viewport; no horizontal page overflow",
    (await vis('[data-testid="quote-follow-up-offer"]')) && (await vis('[data-testid="quote-follow-up-open"]')) && (await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")));
  await tab.screenshot(`${SHOTS}t2-offer-768.png`);
  await click(tab, '[data-testid="quote-follow-up-dismiss"]');
  await go(tab, `/quote-print/${QS}`);
  check("T3 768 px: the print view fits (no horizontal overflow), toolbar visible on screen", (await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")) && (await vis('[data-testid="quote-print-button"]')));
  await tab.screenshot(`${SHOTS}t3-print-768.png`);

  section("N. No communication");
  check("N1 nothing was sent: notification events and email / SMS audit rows unchanged across the whole run", comms() === COMMS0, `${COMMS0} -> ${comms()}`);
} catch (e) {
  fails++;
  console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  try { if (revoked) sql(`grant execute on function public.plus_get_quote(uuid, uuid) to authenticated`); } catch {}
  try { setGrant("none"); setPlus(ORG_A, "active"); } catch {}
  try {
    const [p, e, a] = ORG_FIELDS.split("¦").map((v) => (v === "∅" ? "null" : `'${v.replace(/'/g, "''")}'`));
    sql(`update organizations set business_phone = ${p}, business_email = ${e}, business_address = ${a} where id = '${ORG_A}'`);
  } catch {}
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
