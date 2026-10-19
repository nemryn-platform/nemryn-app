// NP-P2-S5-O1 local browser E2E -- closed-opportunity notice on the printable quote (ZD-226). ISOLATED Supabase stack
// (NemrynS1Iso) + `next start -p 3100`; FICTIONAL seed identities and data only. Fixtures go through the real RPCs.
//   npm run test:e2e:quotes -- o1      (or: node tests/e2e/plus-quotes/o1-closed-notice.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep, newChromeSession, signIn, pdfText } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("o1");
mkdirSync(SHOTS, { recursive: true });
const NOTICE_H = "Opportunity closed";
const NOTICE_T = "This quotation is associated with a closed opportunity. Its recorded quotation status has not changed. Confirm that the quotation is still applicable before sharing or relying on it.";
const LOST_NOTE = `Fictional O1 lost note ${STAMP}`;
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
const path = (s) => s.evaluate("location.pathname");
const memId = (uid) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${ORG_A}'`));
const setPlus = (org) => sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${org}', 'plus', 'active', 'NP-P2-S5-O1 E2E')`);
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (org, name, by) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('${org}', '${name}', '(404) 555-0178', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${by}') returning id`));
const opp = (org, title, k, by) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${org}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${by}') returning id`));
const ver = (t, id) => `(select updated_at from public.${t} where id = '${id}')`;
const create = (o, key, base = 10000, by = U.a1, org = ORG_A) =>
  asUser(by, `select (public.plus_create_quote('${org}', '${o}', '${key}', 'quote', 'dialysis', false, null, ${base}, 2500, 0, 0, 0, 0, 0, 0, null, 500, 'Fictional terms O1.', current_date + 10)).quote_id`);
const send = (q) => asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q}', ${ver("plus_quotes", q)})).status`);
const respond = (q, r) => asUser(U.a1, `select (public.plus_record_quote_response('${ORG_A}', '${q}', ${ver("plus_quotes", q)}, '${r}')).status`);
const withdraw = (q, reason) => asUser(U.a1, `select (public.plus_withdraw_quote('${ORG_A}', '${q}', ${ver("plus_quotes", q)}, ${reason ? `'${reason}'` : "null"})).status`);
const revise = (q, key) => asUser(U.a1, `select (public.plus_revise_quote('${ORG_A}', '${q}', '${key}')).quote_id`);
const lost = (o) => asUser(U.a1, `select (public.plus_mark_opportunity_lost('${ORG_A}', '${o}', ${ver("plus_opportunities", o)}, 'other', '${LOST_NOTE}')).stage`);
const convert = (o, key) => asUser(U.a1, `select r.request_id from public.plus_convert_opportunity_to_request('${ORG_A}', '${o}', ${ver("plus_opportunities", o)}, '${key}', 'self', 'Fictional pickup O1', 'Fictional destination O1', 'no', null, null, null, null) r`);
const qrow = (q) => first(sql(`select status || '|' || total_cents || '|' || updated_at from plus_quotes where id = '${q}'`));
const stage = (o) => first(sql(`select stage from plus_opportunities where id = '${o}'`));
const WRITES = () => first(sql(`select (select count(*) from plus_quotes) || '/' || (select max(updated_at) from plus_quotes) || '/' || (select count(*) from plus_opportunities) || '/' || (select max(updated_at) from plus_opportunities) || '/' || (select count(*) from audit_events) || '/' || (select count(*) from plus_activities) || '/' || (select count(*) from plus_tasks) || '/' || (select count(*) from transportation_requests) || '/' || (select count(*) from notification_events)`));
const sessions = [];
const open = async (name, who, w = 1440, h = 1200) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
const is404 = async (s) => /could not be found|404/i.test(await s.evaluate("document.body.innerText")) && !(await has(s, '[data-testid="quote-print"]'));

try {
  section("fixtures (fictional, through the real RPCs)");
  setPlus(ORG_A); setPlus(ORG_B); setGrant("none");
  const K = contact(ORG_A, `O1 Pat ${STAMP}`, U.a1);
  const mk = (label) => opp(ORG_A, `O1 ${label} ${STAMP}`, K, U.a1);
  // A. open
  const OAS = mk("open sent"); const QAS = create(OAS, `o1-${STAMP}-as`); send(QAS);
  const OAD = mk("open draft"); const QAD = create(OAD, `o1-${STAMP}-ad`);
  // B. lost
  const OLS = mk("lost sent"); const QLS = create(OLS, `o1-${STAMP}-ls`); send(QLS);
  const OLA = mk("lost accepted"); const QLA = create(OLA, `o1-${STAMP}-la`); send(QLA); respond(QLA, "accepted");
  const OLW = mk("lost withdrawn"); const QLW = create(OLW, `o1-${STAMP}-lw`); send(QLW); withdraw(QLW, "Fictional O1 withdrawal reason");
  const OLD = mk("lost declined"); const QLD = create(OLD, `o1-${STAMP}-ld`); send(QLD); respond(QLD, "declined");
  const OLE = mk("lost expired"); const QLE = create(OLE, `o1-${STAMP}-le`); send(QLE);
  sql(`begin; alter table plus_quotes disable trigger plus_quotes_guard; update plus_quotes set valid_until = public._plus_org_local_today('${ORG_A}') - 1 where id = '${QLE}'; alter table plus_quotes enable trigger plus_quotes_guard; commit;`);
  const OLX = mk("lost draft"); const QLX = create(OLX, `o1-${STAMP}-lx`);
  // C. converted
  const OCS = mk("converted sent"); const QCS = create(OCS, `o1-${STAMP}-cs`); send(QCS);
  const OCX = mk("converted superseded"); const QC1 = create(OCX, `o1-${STAMP}-c1`, 10000); send(QC1); const QC2 = revise(QC1, `o1-${STAMP}-c2`); send(QC2);
  // the stored rows BEFORE the opportunities close
  const pre = Object.fromEntries([QLS, QLA, QLW, QLD, QLE, QLX, QCS, QC1, QC2].map((q) => [q, qrow(q)]));
  for (const o of [OLS, OLA, OLW, OLD, OLE, OLX]) lost(o);
  const R1 = convert(OCS, `o1-conv-${STAMP}-1`); const R2 = convert(OCX, `o1-conv-${STAMP}-2`);
  check("F0 fixtures: 6 Lost, 2 Converted (one Core Request each, by the real conversion RPC), 2 open",
    [OLS, OLA, OLW, OLD, OLE, OLX].every((o) => stage(o) === "lost") && [OCS, OCX].every((o) => stage(o) === "converted") && /^[0-9a-f-]{36}$/.test(R1) && /^[0-9a-f-]{36}$/.test(R2) && stage(OAS) === "quote_sent" && stage(OAD) === "qualified",
    `${R1} ${R2}`);
  check("D0 closing an opportunity changed NO stored quote (status, total, version identical before and after Lost / Converted)",
    Object.entries(pre).every(([q, r]) => qrow(q) === r), JSON.stringify(Object.entries(pre).filter(([q, r]) => qrow(q) !== r)));
  const KB = contact(ORG_B, `O1 Org B ${STAMP}`, U.b1); const OB = opp(ORG_B, `O1 Org B ${STAMP}`, KB, U.b1); const QB = create(OB, `o1-${STAMP}-b`, 10000, U.b1, ORG_B);
  const admin = await open("o1-admin", "org-a-admin@example.test");
  const W0 = WRITES();

  const view = async (q) => {
    await go(admin, `/quote-print/${q}`);
    return {
      notice: await inner(admin, '[data-testid="quote-print-closed-notice"]'),
      banner: await inner(admin, '[data-testid="quote-print-banner"]'),
      status: await inner(admin, '[data-testid="quote-print-status"]'),
      total: await inner(admin, '[data-testid="quote-print-total"]'),
      terms: await inner(admin, '[data-testid="quote-print-terms"]'),
      doc: await inner(admin, '[data-testid="quote-print"]'),
    };
  };
  const noticeOk = (v) => v.notice.includes(NOTICE_H) && v.notice.includes(NOTICE_T);

  section("A. Open opportunity");
  let v = await view(QAS);
  check("A1 open + Sent: no closed notice, no banner, Status: Sent", v.notice === "" && !(await has(admin, '[data-testid="quote-print-closed-notice"]')) && v.banner === "" && v.status === "Status: Sent");
  v = await view(QAD);
  check("A2 open + Draft: the existing DRAFT banner; no closed notice", /DRAFT/.test(v.banner) && v.notice === "" && v.status === "Status: Draft");

  section("B. Lost opportunity");
  v = await view(QLS);
  check("B1 Lost + Sent: the closed notice (exact copy); status still 'Sent'; no status banner invented", noticeOk(v) && v.status === "Status: Sent" && v.banner === "", v.notice);
  check("B1b the notice names no opportunity details: no title, lost reason or lost note; no contact phone / email",
    !v.doc.includes(`O1 lost sent ${STAMP}`) && !v.doc.includes(LOST_NOTE) && !/lost reason|Other\b/i.test(v.notice) && !v.doc.includes("555-0178") && !v.doc.includes("@example.test"));
  await admin.screenshot(`${SHOTS}b1-lost-sent.png`);
  v = await view(QLA);
  check("B2 Lost + Accepted: the ACCEPTED banner AND the closed notice; status Accepted", /ACCEPTED/.test(v.banner) && /recorded by staff/.test(v.banner) && noticeOk(v) && v.status === "Status: Accepted");
  v = await view(QLW);
  check("B3 Lost + Withdrawn: the WITHDRAWN banner AND the closed notice; the withdrawal reason is not printed", /WITHDRAWN/.test(v.banner) && noticeOk(v) && v.status === "Status: Withdrawn" && !v.doc.includes("Fictional O1 withdrawal reason"));
  v = await view(QLX);
  check("B4 Lost + Draft: the DRAFT banner AND the closed notice", /DRAFT/.test(v.banner) && noticeOk(v) && v.status === "Status: Draft");

  section("C. Converted opportunity");
  v = await view(QCS);
  check("C1 Converted + Sent: the closed notice; status still Sent", noticeOk(v) && v.status === "Status: Sent" && v.banner === "");
  check("C1b no Core Request / trip details leak into the document", !v.doc.includes("Fictional pickup O1") && !v.doc.includes("Fictional destination O1") && !v.doc.includes(R1));
  v = await view(QC1);
  check("C2 Converted + Superseded: the SUPERSEDED banner (naming its replacement) AND the closed notice; its own stored total", /SUPERSEDED/.test(v.banner) && v.banner.includes(`Replaced by Quote ${first(sql(`select quote_number from plus_quotes where id='${QC2}'`))}`) && noticeOk(v) && v.status === "Status: Superseded" && v.total === "$120.00");
  v = await view(QC2);
  check("C3 Converted + the revision (Sent): the closed notice", noticeOk(v) && v.status === "Status: Sent");
  await admin.screenshot(`${SHOTS}c2-converted-superseded.png`);

  section("D. Other statuses keep their semantics");
  v = await view(QLD);
  check("D1 Lost + Declined: the DECLINED banner + the closed notice; status Declined", /DECLINED/.test(v.banner) && noticeOk(v) && v.status === "Status: Declined");
  v = await view(QLE);
  check("D2 Lost + derived Expired: the EXPIRED banner + the closed notice; status Expired; stored status still 'sent'", /EXPIRED/.test(v.banner) && noticeOk(v) && v.status === "Status: Expired" && first(sql(`select status from plus_quotes where id='${QLE}'`)) === "sent");
  await admin.screenshot(`${SHOTS}d2-lost-expired.png`);

  section("E. Print media and PDF");
  v = await view(QLA);
  const before = { total: v.total, terms: v.terms };
  await admin.cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("E1 print media: the closed notice and the status banner are visible; the toolbar is hidden",
    (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-closed-notice"]')).display`)) !== "none"
    && (await admin.evaluate(`document.querySelector('[data-testid="quote-print-closed-notice"]').getBoundingClientRect().height`)) > 0
    && (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-banner"]')).display`)) !== "none"
    && (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-toolbar"]')).display`)) === "none");
  check("E2 print media: stored price and terms unchanged", (await inner(admin, '[data-testid="quote-print-total"]')) === before.total && before.total === "$120.00" && (await inner(admin, '[data-testid="quote-print-terms"]')) === before.terms && /Fictional terms O1/.test(before.terms));
  await admin.screenshot(`${SHOTS}e1-print-media.png`);
  await admin.cdp("Emulation.setEmulatedMedia", { media: "" });
  const pdfB64 = (await admin.cdp("Page.printToPDF", { printBackground: false })).data;
  writeFileSync(`${SHOTS}e3-lost-accepted.pdf`, Buffer.from(pdfB64, "base64"));
  // extract the PDF's text with the pinned pdfjs-dist (Node; no app involvement, no CDN)
  const flat = (await pdfText(pdfB64)).text;
  check("E3 the browser-generated PDF contains the closed notice (heading + text), the ACCEPTED banner and the stored total; NOT the toolbar",
    flat.includes(NOTICE_H) && flat.includes("Its recorded quotation status has not changed") && flat.includes("still applicable before sharing or relying on it") && /ACCEPTED/.test(flat) && flat.includes("$120.00")
    && !/Print \/ Save PDF|Back to the opportunity/.test(flat), flat.slice(0, 300));

  section("F. Security");
  await go(admin, `/quote-print/${QB}`);
  check("F1 a foreign (Org B) quote id: 404, no Org B data", (await is404(admin)) && !(await admin.evaluate(`document.body.innerText.includes(${JSON.stringify(`O1 Org B ${STAMP}`)})`)));
  await go(admin, `/quote-print/00000000-0000-4000-8000-000000000000`);
  check("F2 an unknown id: the same 404", await is404(admin));
  const anon = await open("o1-anon", null);
  await go(anon, `/quote-print/${QLS}`);
  check("F3 signed out: no document; redirected to sign-in", !(await has(anon, '[data-testid="quote-print"]')) && /sign-in/.test(await path(anon)));
  setGrant("read");
  const disp = await open("o1-disp", "org-a-dispatcher@example.test");
  await go(disp, `/quote-print/${QLS}`);
  check("F4 READ-grant Dispatcher still prints, and sees the closed notice", (await has(disp, '[data-testid="quote-print"]')) && (await inner(disp, '[data-testid="quote-print-closed-notice"]')).includes(NOTICE_H));
  setGrant("none");
  await go(disp, `/quote-print/${QLS}`);
  check("F5 no-grant Dispatcher: refused", !(await has(disp, '[data-testid="quote-print"]')));
  const hdr = await admin.evaluate(`fetch('/quote-print/${QLS}', { credentials: 'include' }).then(r => r.status + ' ' + (r.headers.get('cache-control') || ''))`);
  check("F6 still dynamic / private / no-store", /^200 /.test(hdr) && /private/.test(hdr) && /no-store/.test(hdr), hdr);
  check("F7 no new public link: no share / mailto / sms action on a closed quote's page", !(await admin.evaluate(`!!document.querySelector('a[href^="mailto:"], a[href^="sms:"]') || [...document.querySelectorAll('button, a')].some(e => /\\b(Email|Share|Copy link|Send)\\b/.test(e.innerText))`)));
  const W1 = WRITES();
  check("F8 viewing / printing wrote nothing: quotes, opportunities (count + latest version), audit, activities, tasks, Requests, notifications identical", W0 === W1, `${W0} -> ${W1}`);

  section("Directory semantics unchanged");
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(`O1 lost sent ${STAMP}`)}`);
  check("G1 the directory still shows the stored status (Sent) for a Lost opportunity's quote -- no notice, no new status", (await admin.evaluate(`document.querySelector('[data-testid="quote-directory-status"]')?.dataset.status`)) === "sent"
    && /Sent/.test(await inner(admin, '[data-testid="quote-directory-status"]')) && !(await has(admin, '[data-testid="quote-print-closed-notice"]')));
} catch (e) {
  fails++;
  console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  try { setGrant("none"); } catch {}
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
