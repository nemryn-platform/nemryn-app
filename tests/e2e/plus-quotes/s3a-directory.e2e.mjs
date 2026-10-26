// NP-P2-S5-S3A local browser E2E -- Growth -> Estimates & Quotes directory, navigation, filters, pagination, states,
// read-only access, tablet width, and the D1 withdraw-confirmation fix. ISOLATED Supabase stack (NemrynS1Iso) +
// `next start -p 3100`; FICTIONAL seed identities and data only.
//   npm run test:e2e:quotes -- s3a      (or: node tests/e2e/plus-quotes/s3a-directory.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { sleep, newChromeSession, signIn } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("s3a");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|ALTER TABLE|UPDATE \d+|GRANT|REVOKE)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
async function go(s, p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 10000); await sleep(900); }
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const count = (s, sel) => s.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const refs = (s) => s.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-link"]')].map(a => a.textContent.trim())`);
const path = (s) => s.evaluate("location.pathname + location.search + location.hash");
const setField = (s, sel, value) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const click = (s, sel) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const memId = (uid, org = ORG_A) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${org}'`));
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const setPlus = (org, status) => sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, status_reason, trial_started_at, trial_ends_at) values ('${org}', 'plus', '${status}', 'NP-P2-S5-S3A E2E', ${status === "expired" ? "now() - interval '20 days', now() - interval '6 days'" : "null, null"})`);
const contact = (org, name, by) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('${org}', '${name}', '(404) 555-0174', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${by}') returning id`));
const opp = (org, title, k, by) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${org}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${by}') returning id`));
const ver = (q) => `(select updated_at from public.plus_quotes where id = '${q}')`;
const create = (o, key, base = 10000, kind = "quote") => asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${o}', '${key}', '${kind}', 'dialysis', false, null, ${base}, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 10)).quote_id`);
const send = (q) => asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q}', ${ver(q)})).status`);
const respond = (q, r) => asUser(U.a1, `select (public.plus_record_quote_response('${ORG_A}', '${q}', ${ver(q)}, '${r}')).status`);
const withdraw = (q) => asUser(U.a1, `select (public.plus_withdraw_quote('${ORG_A}', '${q}', ${ver(q)}, null)).status`);
const revise = (q, key) => asUser(U.a1, `select (public.plus_revise_quote('${ORG_A}', '${q}', '${key}')).quote_id`);
const dbSummary = () => first(sql(`select count(*) filter (where status='draft') || '/' || count(*) filter (where status='sent') || '/' || count(*) filter (where status='accepted') || '/' || count(*) filter (where status='sent' and valid_until < public._plus_org_local_today('${ORG_A}')) from plus_quotes where organization_id = '${ORG_A}'`));
const sessions = [];
const open = async (name, who, w = 1440, h = 1200) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
let revoked = false;

try {
  section("fixtures (fictional, through the real RPCs)");
  setPlus(ORG_A, "active"); setPlus(ORG_B, "active"); setGrant("none");
  const K = contact(ORG_A, `S3A Dir Pat ${STAMP}`, U.a1);
  const KO = contact(ORG_A, `S3A Odd 100%_Name ${STAMP}`, U.a1);
  const opps = [];
  for (let i = 1; i <= 27; i++) opps.push(opp(ORG_A, `S3A Dir opp ${String(i).padStart(2, "0")} ${STAMP}`, i === 27 ? KO : K, U.a1));
  const qs = opps.map((o, i) => create(o, `s3a-${STAMP}-${i + 1}`, 10000 + i * 100, i % 4 === 0 ? "estimate" : "quote"));
  send(qs[0]); respond(qs[0], "accepted");
  send(qs[1]); respond(qs[1], "declined");
  withdraw(qs[2]);
  send(qs[3]); const rev = revise(qs[3], `s3a-${STAMP}-rev`); send(rev);
  send(qs[4]);
  send(qs[5]);
  sql(`begin; alter table plus_quotes disable trigger plus_quotes_guard; update plus_quotes set valid_until = public._plus_org_local_today('${ORG_A}') - 1 where id = '${qs[5]}'; alter table plus_quotes enable trigger plus_quotes_guard; commit;`);
  const expiredNum = first(sql(`select quote_number from plus_quotes where id = '${qs[5]}'`));
  const OD1 = opp(ORG_A, `S3A D1 withdraw A ${STAMP}`, K, U.a1); const qd1 = create(OD1, `s3a-${STAMP}-d1a`, 5000);
  const OD2 = opp(ORG_A, `S3A D1 withdraw B ${STAMP}`, K, U.a1); const qd2 = create(OD2, `s3a-${STAMP}-d1b`, 6000);
  const OD3 = opp(ORG_A, `S3A D1 withdraw C ${STAMP}`, K, U.a1); const qd3 = create(OD3, `s3a-${STAMP}-d1c`, 7000);
  const total = Number(first(sql(`select count(*) from plus_quotes where organization_id = '${ORG_A}'`)));
  const maxNum = first(sql(`select max(quote_number) from plus_quotes where organization_id = '${ORG_A}'`));
  sql(`delete from plus_quotes where organization_id = '${ORG_B}'`);
  console.log(`NOTE — Org A quotes: ${total}; summary ${dbSummary()}; expired #${expiredNum}`);

  const admin = await open("s3a-admin", "org-a-admin@example.test");

  section("N. Growth navigation");
  await go(admin, "/operations/growth");
  const labels = await admin.evaluate(`[...document.querySelectorAll('[data-testid="growth-nav-child"]')].map(a => a.textContent.trim())`);
  check("N1 Growth navigation: Dashboard, Inquiries, Pipeline, Contacts, Estimates & Quotes, Tasks (existing sidebar component)",
    JSON.stringify(labels) === JSON.stringify(["Dashboard", "Inquiries", "Pipeline", "Contacts", "Estimates & Quotes", "Tasks"]), JSON.stringify(labels));
  await admin.evaluate(`[...document.querySelectorAll('[data-testid="growth-nav-child"]')].find(a => a.textContent.trim() === 'Estimates & Quotes').click()`);
  await waitFor(async () => (await path(admin)).startsWith("/operations/growth/quotes"), 10000);
  await sleep(1200);
  const current = await admin.evaluate(`[...document.querySelectorAll('[data-testid="growth-nav-child"][aria-current="page"]')].map(a => a.textContent.trim())`);
  check("N2 clicking it opens /operations/growth/quotes; exactly that item is active (aria-current=page)",
    (await path(admin)) === "/operations/growth/quotes" && JSON.stringify(current) === '["Estimates & Quotes"]', `${await path(admin)} ${JSON.stringify(current)}`);
  check("N3 the existing shell is intact (sidebar, header, other Operations items present)",
    (await has(admin, '[data-testid="growth-nav-group"]')) && (await admin.evaluate(`!!document.querySelector('main') && /Requests/.test(document.body.innerText) && /Trips/.test(document.body.innerText)`)));

  section("P. The directory page");
  check("P1 header + description + summary + filters + table + pagination render",
    /Estimates & Quotes/.test(await inner(admin, "main h1")) && (await has(admin, '[data-testid="quotes-directory-summary"]')) && (await has(admin, '[data-testid="quotes-directory-filters"]'))
    && (await has(admin, '[data-testid="quotes-directory-table"]')) && (await has(admin, '[data-testid="quotes-directory-pagination"]')));
  const [d, se, ac, ex] = dbSummary().split("/");
  const strip = (await inner(admin, '[data-testid="quotes-directory-summary"]')).replace(/\s+/g, " ");
  check("P2 summary counts are the server's real counts (drafts / sent / accepted / expired)",
    strip.includes(`${d} drafts`) && strip.includes(`${se} sent`) && strip.includes(`${ac} accepted`) && strip.includes(`${ex} expired`), `${strip} vs ${dbSummary()}`);
  const page1 = await refs(admin);
  check("P3 page 1 shows 25 rows (server page size), newest first; the total is shown", page1.length === 25 && new RegExp(`${total} estimates and quotes · page 1 of ${Math.ceil(total / 25)}`).test(await inner(admin, '[data-testid="quotes-directory-pagination"]')), `${page1.length} | ${await inner(admin, '[data-testid="quotes-directory-pagination"]')}`);
  await admin.screenshot(`${SHOTS}p-directory.png`);
  await click(admin, '[data-testid="quotes-directory-next"]');
  await waitFor(async () => /page=2/.test(await path(admin)), 10000); await sleep(1000);
  const page2 = await refs(admin);
  check("P4 Next: page 2 holds the remaining rows; no row repeats across pages", page2.length === total - 25 && page1.every((r) => !page2.includes(r)), `${page2.length}`);
  await go(admin, `/operations/growth/quotes?page=99`);
  check("P5 a page past the end says so (not an empty directory) and links back to page 1", await has(admin, '[data-testid="quotes-directory-past-end"]'));

  section("F. Search, filters, sort");
  await go(admin, "/operations/growth/quotes");
  await setField(admin, '[data-testid="quotes-directory-search"]', `Dir opp 07 ${STAMP}`);
  await click(admin, '[data-testid="quotes-directory-apply"]');
  await waitFor(async () => /q=/.test(await path(admin)), 10000); await sleep(1000);
  check("F1 search by opportunity title -> exactly that opportunity's quote", JSON.stringify(await refs(admin)) === JSON.stringify([`Quote ${first(sql(`select quote_number from plus_quotes where id='${qs[6]}'`))}`]), JSON.stringify(await refs(admin)));
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent("100%_Name")}`);
  check("F2 search with % and _ is literal (contact '…100%_Name…') and never errors", (await refs(admin)).length === 1 && !(await has(admin, '[data-testid="quotes-directory-error"]')), JSON.stringify(await refs(admin)));
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent("' or 1=1 --")}`);
  check("F3 SQL-looking search text is data: the 'no match' empty state, not an error", (await has(admin, '[data-testid="quotes-directory-empty"]')) && /No estimates or quotes match these filters/.test(await inner(admin, '[data-testid="quotes-directory-empty"]')));
  await go(admin, "/operations/growth/quotes?status=expired");
  check("F4 status Expired -> only the expired quote; its badge reads Expired while the stored status stays sent",
    JSON.stringify(await refs(admin)) === JSON.stringify([`Quote ${expiredNum}`]) && /Expired/.test(await inner(admin, '[data-testid="quote-directory-status"]'))
    && (await admin.evaluate(`document.querySelector('[data-testid="quote-directory-status"]').dataset.status`)) === "sent", JSON.stringify(await refs(admin)));
  await go(admin, "/operations/growth/quotes?status=draft");
  check("F5 status Draft -> exactly the stored drafts (count equals the database)", (await count(admin, '[data-testid="quote-directory-status"][data-status="draft"]')) === Math.min(25, Number(d)) && (await count(admin, '[data-testid="quote-directory-status"]:not([data-status="draft"])')) === 0);
  await go(admin, "/operations/growth/quotes?status=sent");
  check("F6 status Sent includes the expired one (all stored sent)", (await refs(admin)).length === Number(se) && (await refs(admin)).includes(`Quote ${expiredNum}`));
  await go(admin, "/operations/growth/quotes?sort=number");
  check("F7 sort by number: highest first", (await refs(admin))[0] === `Quote ${maxNum}` || (await refs(admin))[0] === `Estimate ${maxNum}`, (await refs(admin))[0]);
  await go(admin, "/operations/growth/quotes?status=Bogus&sort=random&page=-3");
  check("F8 unknown filter values fall back to the defaults (no error)", (await refs(admin)).length === 25 && !(await has(admin, '[data-testid="quotes-directory-error"]')));

  section("R. Row opens the opportunity; existing panel still works");
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(`Dir opp 09 ${STAMP}`)}`);
  await admin.evaluate(`document.querySelector('[data-testid="quotes-directory-table"] tbody tr').click()`);
  await waitFor(async () => (await path(admin)).includes(`/operations/growth/pipeline/${opps[8]}`), 10000); await sleep(1500);
  check("R1 clicking a row opens the correct Opportunity at its Estimates & quotes panel (#quotes)", (await path(admin)) === `/operations/growth/pipeline/${opps[8]}#quotes` && (await has(admin, '[data-testid="opportunity-quotes"]')), await path(admin));
  check("R2 the existing panel shows that draft with Edit / Withdraw (the S2 workflow, reused)", (await has(admin, '[data-testid="quotes-current"] [data-status="draft"]')) && (await has(admin, '[data-testid="quote-edit-open"]')));
  check("R3 the reference is also a real link to the same place", (await (async () => { await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(`Dir opp 09 ${STAMP}`)}`); return admin.evaluate(`document.querySelector('[data-testid="quote-directory-link"]').getAttribute('href')`); })()) === `/operations/growth/pipeline/${opps[8]}#quotes`);
  check("R4 the directory offers no quote mutation: 'New estimate or quote' routes to the Pipeline; no Edit / Withdraw / Mark sent here",
    (await admin.evaluate(`document.querySelector('[data-testid="quotes-directory-new"]').getAttribute('href')`)) === "/operations/growth/pipeline"
    && !(await has(admin, '[data-testid="quote-edit-open"]')) && !(await has(admin, '[data-testid="quote-withdraw-open"]')) && !/Mark sent|Revise/.test(await inner(admin, "main"))
    // NP-P2-S5-S3C (ZD-224): the only print surface is a link to the staff print view (new tab), never a print / send action here
    && (await admin.evaluate(`[...document.querySelectorAll('main a, main button')].filter(e => /Print/.test(e.innerText)).every(e => e.tagName === 'A' && /^\\/quote-print\\/[0-9a-f-]{36}$/.test(e.getAttribute('href')) && e.target === '_blank')`)));

  section("D1. Withdraw confirmation survives revalidation (3 consecutive withdrawals)");
  let d1ok = 0;
  for (const [o, q] of [[OD1, qd1], [OD2, qd2], [OD3, qd3]]) {
    await go(admin, `/operations/growth/pipeline/${o}`);
    await click(admin, '[data-testid="quote-withdraw-open"]');
    await waitFor(() => has(admin, '[data-testid="quote-withdraw-form"]'), 10000);
    await click(admin, '[data-testid="quote-withdraw-confirm"]');
    const seen = await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000);
    await sleep(2500);   // after the revalidation has re-rendered the panel
    const msg = await inner(admin, '[data-testid="quote-saved"]');
    const role = await admin.evaluate(`document.querySelector('[data-testid="quote-saved"]')?.getAttribute('role')`);
    const ok = seen && /Draft withdrawn/.test(msg) && role === "status" && first(sql(`select status from plus_quotes where id='${q}'`)) === "withdrawn"
      && /Withdrawn/.test(await inner(admin, '[data-testid="quotes-history"]')) && !(await has(admin, '[data-testid="quote-edit-open"]'))
      && first(sql(`select count(*) from plus_quotes where opportunity_id='${o}'`)) === "1"
      && first(sql(`select count(*) from audit_events where entity_id='${q}' and action='plus_quote_withdrawn'`)) === "1";
    if (ok) d1ok++;
    console.log(`NOTE — D1 run ${o.slice(0, 8)}: seen=${seen} msg="${msg}" role=${role}`);
  }
  check("D1 every withdrawal shows the accessible confirmation (role=status) AFTER revalidation; withdrawn kept in History; no draft; one row; one withdrawal audit (3 of 3)", d1ok === 3, `${d1ok}/3`);
  await admin.screenshot(`${SHOTS}d1-withdraw-confirmation.png`);

  section("S. Empty and error states");
  const adminB = await open("s3a-admin-b", "org-b-admin@example.test");
  await go(adminB, "/operations/growth/quotes");
  check("S1 an organization without quotes: 'No estimates or quotes yet.' with a route to the Pipeline; zero counts; no Org A data",
    /No estimates or quotes yet/.test(await inner(adminB, '[data-testid="quotes-directory-empty"]')) && (await adminB.evaluate(`!!document.querySelector('[data-testid="quotes-directory-empty"] a[href="/operations/growth/pipeline"]')`))
    && /0 drafts/.test((await inner(adminB, '[data-testid="quotes-directory-summary"]')).replace(/\s+/g, " ")) && !(await adminB.evaluate(`document.body.innerText.includes(${JSON.stringify(STAMP)})`)));
  sql(`revoke execute on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) from authenticated`); revoked = true;
  await go(admin, "/operations/growth/quotes?status=draft");
  check("S2 a failed list read shows the error state with Retry (never an empty list); the summary still loads; filters are kept",
    (await has(admin, '[data-testid="quotes-directory-error"]')) && !(await has(admin, '[data-testid="quotes-directory-empty"]')) && !(await has(admin, '[data-testid="quotes-directory-table"]'))
    && (await has(admin, '[data-testid="quotes-directory-summary"]')) && (await admin.evaluate(`document.querySelector('[data-testid="quotes-directory-status"]').value`)) === "draft");
  await admin.screenshot(`${SHOTS}s2-error-state.png`);
  sql(`grant execute on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) to authenticated`); revoked = false;
  await go(admin, "/operations/growth/quotes");
  check("S3 after the read recovers, the list is back", (await refs(admin)).length === 25);

  section("A. Access");
  setGrant("read");
  const disp = await open("s3a-disp", "org-a-dispatcher@example.test");
  await go(disp, "/operations/growth/quotes");
  check("A1 READ-grant Dispatcher: the directory, summary and rows; NO 'New estimate or quote' action",
    (await refs(disp)).length === 25 && (await has(disp, '[data-testid="quotes-directory-summary"]')) && !(await has(disp, '[data-testid="quotes-directory-new"]')));
  await go(disp, `/operations/growth/pipeline/${opps[8]}#quotes`);
  check("A2 READ-grant: the opened opportunity shows the draft with NO create / edit / withdraw controls",
    (await has(disp, '[data-testid="quotes-current"]')) && !(await has(disp, '[data-testid="quote-edit-open"]')) && !(await has(disp, '[data-testid="quote-withdraw-open"]')) && !(await has(disp, '[data-testid="quote-create-open"]')));
  setGrant("write");
  await go(disp, "/operations/growth/quotes");
  check("A3 WRITE-grant Dispatcher: the directory with the 'New estimate or quote' route", (await refs(disp)).length === 25 && (await has(disp, '[data-testid="quotes-directory-new"]')));
  setGrant("none");
  await go(disp, "/operations/growth/quotes");
  check("A4 no-grant Dispatcher: the existing Growth access behaviour (no directory)", !(await has(disp, '[data-testid="quotes-directory-table"]')) && !(await has(disp, '[data-testid="quotes-directory-summary"]')), await path(disp));
  const drv = await open("s3a-driver", "org-a-driver-a@example.test");
  await go(drv, "/operations/growth/quotes");
  check("A5 Driver: no directory", !(await has(drv, '[data-testid="quotes-directory-table"]')), await path(drv));
  setPlus(ORG_A, "expired");
  await go(admin, "/operations/growth/quotes");
  check("A6 Plus expired (read-only): the Admin still reads the directory; the 'not active' notice; no New action",
    (await refs(admin)).length === 25 && /Nemryn Plus is not active/.test(await inner(admin, "main")) && !(await has(admin, '[data-testid="quotes-directory-new"]')));
  setPlus(ORG_A, "active");

  section("T. Narrowest supported Operations width (768 px)");
  const tab = await open("s3a-tablet", "org-a-admin@example.test", 768, 1024);
  await go(tab, "/operations/growth/quotes");
  const vis = (sel) => tab.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; const r=e.getBoundingClientRect(); return e.offsetParent !== null && r.width > 0;})()`);
  check("T1 768 px: summary, filters, table and pagination visible; no horizontal PAGE overflow (the table scrolls inside its own container)",
    (await vis('[data-testid="quotes-directory-summary"]')) && (await vis('[data-testid="quotes-directory-filters"]')) && (await vis('[data-testid="quotes-directory-table"]'))
    && (await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")));
  await tab.screenshot(`${SHOTS}t-tablet.png`);
} catch (e) {
  fails++;
  console.log("FAIL — harness error :: " + String(e?.stack ?? e).slice(0, 600));
} finally {
  if (revoked) { try { sql(`grant execute on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) to authenticated`); } catch {} }
  try { setPlus(ORG_A, "active"); setGrant("none"); } catch {}
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
