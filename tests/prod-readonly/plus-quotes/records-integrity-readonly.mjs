// NP-P2-S5-S4 B5 / B6 -- READ-ONLY production verification (Pilot Simulation only). SELECT-only database access
// (refuses anything else); signed-in page VIEWS only (no form submission, no button that writes).
// MANUAL, owner-authorized only (never CI):
//   QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/records-integrity-readonly.mjs snapshot <name>   (B6 snapshot, written outside the repo)
//   QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/records-integrity-readonly.mjs check            (B5)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { APP, ORG, q, one, simEnv, outDir, chromeSession, sleep } from "./_prod.mjs";

const SNAPSHOT = `select
  (select count(*) from public.plus_quotes where organization_id='${ORG}') as quotes,
  (select string_agg(quote_number || ':' || status || ':' || total_cents || ':' || updated_at, ',' order by quote_number) from public.plus_quotes where organization_id='${ORG}') as quote_rows,
  (select string_agg(title || ':' || stage || ':' || updated_at, ',' order by created_at) from public.plus_opportunities where organization_id='${ORG}') as opportunity_rows,
  (select string_agg(id::text || ':' || status || ':' || updated_at, ',' order by created_at) from public.plus_tasks where organization_id='${ORG}') as task_rows,
  (select count(*) from public.plus_activities where organization_id='${ORG}') as activities,
  (select count(*) from public.audit_events where organization_id='${ORG}') as audit,
  (select count(*) || '@' || coalesce(max(updated_at)::text,'-') from public.transportation_requests where organization_id='${ORG}') as requests,
  (select count(*) from public.trips where organization_id='${ORG}') as trips,
  (select count(*) from public.passengers where organization_id='${ORG}') as passengers,
  (select count(*) from public.trip_assignments where organization_id='${ORG}') as assignments,
  (select count(*) from public.notification_events where organization_id='${ORG}') as notifications,
  (select count(*) from public.plus_request_attributions where organization_id='${ORG}') as attributions,
  (select count(*) from public.membership_module_grants where organization_id='${ORG}' and revoked_at is null) as grants,
  (select string_agg(id::text || '=' || do_not_contact || '/' || preferred_channel || '/' || updated_at, ',' order by id) from public.plus_contacts where organization_id='${ORG}') as contacts,
  (select string_agg(organization_id::text || '=' || status || '/' || coalesce(trial_ends_at::text,'-') || '/' || updated_at, ',' order by organization_id) from public.organization_modules where module='plus') as plus_modules,
  (select string_agg(m.id::text || '=' || m.role || '/' || m.status, ',' order by m.id) from public.memberships m where m.organization_id='${ORG}') as memberships,
  (select count(*) || '@' || coalesce(max(updated_at)::text,'-') from public.transportation_requests where organization_id<>'${ORG}') as other_requests,
  (select count(*) from public.trips where organization_id<>'${ORG}') as other_trips,
  (select count(*) from public.plus_quotes where organization_id<>'${ORG}') as other_quotes,
  (select count(*) from public.plus_tasks where organization_id<>'${ORG}') as other_tasks,
  (select count(*) from public.plus_activities where organization_id<>'${ORG}') as other_activities,
  (select count(*) from public.plus_opportunities where organization_id<>'${ORG}') as other_opportunities,
  (select count(*) from public.notification_events where organization_id<>'${ORG}') as other_notifications,
  (select count(*) from public.audit_events where organization_id<>'${ORG}') as other_audit`;

if (process.argv[2] === "snapshot") {
  const name = (process.argv[3] || "snapshot").replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(outDir("integrity"), name.endsWith(".json") ? name : `${name}.json`);
  writeFileSync(file, JSON.stringify(q(SNAPSHOT)[0], null, 1));
  console.log(`snapshot written: ${file}   (compare two snapshots with: cmp <before> <after>)`);
  process.exit(0);
}

const env = simEnv();
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(400); } return false; }
let s;
const ev = (x) => s.evaluate(x);
const inner = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const go = async (p) => { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 15000); await sleep(1500); };
try {
  // ---------------- B5 database reads ----------------
  const qs = q(`select q.id, q.quote_number, q.kind, q.status, q.opportunity_id, o.primary_contact_id from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id where q.organization_id='${ORG}' order by q.quote_number`);
  const ev1 = (id) => one(`select coalesce(string_agg(activity_type || ':' || quote_status, ',' order by recorded_at, id), '') from public.plus_activities where quote_id='${id}'`);
  const au = (id) => one(`select coalesce(string_agg(action, ',' order by occurred_at, id), '') from public.audit_events where entity_id='${id}'`);
  const byN = Object.fromEntries(qs.map((r) => [Number(r.quote_number), r]));
  check("B5.1 17 quote activity events in the tenant, each tenant-scoped to its own quote and opportunity, none with a body",
    Number(one(`select count(*) from public.plus_activities where organization_id='${ORG}' and quote_id is not null`)) === 17
    && Number(one(`select count(*) from public.plus_activities a join public.plus_quotes q on q.id = a.quote_id where a.organization_id='${ORG}' and (a.organization_id <> q.organization_id or a.opportunity_id <> q.opportunity_id)`)) === 0
    && Number(one(`select count(*) from public.plus_activities where organization_id='${ORG}' and quote_id is not null and body is not null`)) === 0);
  const expectedEvents = { 2: "quote_sent:sent,quote_status_changed:superseded", 3: "quote_revised:draft,quote_sent:sent,quote_status_changed:accepted", 7: "quote_sent:sent,quote_status_changed:superseded", 8: "quote_revised:draft,quote_sent:sent,quote_status_changed:withdrawn", 9: "quote_sent:sent,quote_status_changed:withdrawn" };
  const evOk = Object.entries(expectedEvents).every(([n, e]) => ev1(byN[n].id) === e);
  check("B5.2 historical event sequences intact (Estimates 2/3 from S3B; Quotes 7/8/9 from S3C-R1)", evOk, Object.keys(expectedEvents).map((n) => `${n}=${ev1(byN[n].id)}`).join(" | "));
  const expectedAudit = { 7: "plus_quote_created,plus_quote_sent,plus_quote_superseded", 8: "plus_quote_created,plus_quote_sent,plus_quote_withdrawn", 9: "plus_quote_created,plus_quote_sent,plus_quote_withdrawn" };
  check("B5.3 quote audit sequences intact (Quotes 7 / 8 / 9)", Object.entries(expectedAudit).every(([n, a]) => au(byN[n].id) === a), Object.keys(expectedAudit).map((n) => `${n}=${au(byN[n].id)}`).join(" | "));
  check("B5.4 the single task: created + cancelled audit; status cancelled", one(`select string_agg(a.action, ',' order by a.occurred_at) from public.audit_events a join public.plus_tasks t on t.id = a.entity_id where t.organization_id='${ORG}'`) === "plus_task_created,plus_task_cancelled"
    && one(`select string_agg(status, ',') from public.plus_tasks where organization_id='${ORG}'`) === "cancelled");
  check("B5.5 permissions unchanged: no active Plus grants; Admin / Dispatcher / 2 Drivers active", one(`select count(*) from public.membership_module_grants where organization_id='${ORG}' and revoked_at is null`) == 0
    && one(`select string_agg(role || '/' || status, ',' order by role) from public.memberships where organization_id='${ORG}'`) === "dispatcher/active,driver/active,driver/active,organization_admin/active");
  check("B5.6 Core boundary: the quote module never created a Request -- every tenant attribution predates the quote module or is a manual / conversion link (no attribution references a quote)",
    Number(one(`select count(*) from public.plus_request_attributions a where a.organization_id='${ORG}' and a.linked_at >= (select min(created_at) from public.plus_quotes where organization_id='${ORG}')`)) === 0);
  check("B5.7 OD-Q12 holds tenant-wide (no opportunity with > 1 draft or > 1 sent)", Number(one(`select count(*) from (select opportunity_id, status from public.plus_quotes where organization_id='${ORG}' and status in ('draft','sent') group by 1,2 having count(*) > 1) x`)) === 0);

  // ---------------- B5 UI views ----------------
  s = await chromeSession("-s4-b5"); await s.setViewport(1440, 1200);
  await s.nav(`${APP}/sign-in`, 2500);
  await waitFor(() => ev(`!!document.querySelector('input[name="email"]')`));
  for (const [n, v] of [["email", env.SIM_ADMIN_EMAIL], ["password", env.SIM_ADMIN_PASSWORD]]) await ev(`(function(){const el=document.querySelector('input[name="${n}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await ev(`document.querySelector('button[type="submit"]').click()`);
  await waitFor(async () => !(await ev("location.pathname")).startsWith("/sign-in"), 25000);
  check("B5.8 SIM Admin signed in", !(await ev("location.pathname")).startsWith("/sign-in"));
  await go("/operations/growth/quotes");
  const dir = await ev(`[...document.querySelectorAll('[data-testid="quote-directory-status"]')].map(e => e.dataset.status)`);
  const dbStatuses = qs.map((r) => r.status);
  check("B5.9 directory: all 9 quotes with their STORED statuses (no 'closed' status invented); a Print link per row",
    dir.length === 9 && JSON.stringify([...dir].sort()) === JSON.stringify([...dbStatuses].sort()) && (await ev(`document.querySelectorAll('[data-testid="quote-directory-print"]').length`)) === 9, JSON.stringify(dir));
  check("B5.10 the directory itself shows no closed-opportunity notice (O1 is print-only)", !(await ev(`!!document.querySelector('[data-testid="quote-print-closed-notice"]')`)));
  const o7 = byN[7].opportunity_id;
  await go(`/operations/growth/pipeline/${o7}`);
  const hist = await inner('[data-testid="opportunity-history"]');
  check("B5.11 opportunity history (S3C-R1 B1): staff wording for sent / revised / superseded / withdrawn; no $ amounts on quote lines",
    hist.includes("Quote 7 marked sent") && hist.includes("Quote 8 created as a revision of Quote 7") && hist.includes("Quote 7 replaced by revision Quote 8") && hist.includes("Sent Quote 8 withdrawn")
    && !hist.split("\n").filter((l) => /Quote \d/.test(l)).some((l) => /\$\d/.test(l)), hist.slice(0, 300));
  const row7 = await ev(`[...document.querySelectorAll('[data-testid="quote-row"]')].find(r => r.dataset.quoteId === ${JSON.stringify(byN[7].id)})?.innerText ?? ''`);
  check("B5.12 ZD-227 in the panel: Quote 7's row names no replacement (its revision Quote 8 was withdrawn); no write controls on the closed opportunity",
    row7 !== "" && !/Replaced by (Quote|Estimate) \d/.test(row7) && !(await ev(`!!document.querySelector('[data-testid="quote-send-open"], [data-testid="quote-create-open"], [data-testid="quote-revise-open"]')`)), row7.replace(/\n/g, " "));
  await go(`/operations/growth/contacts/${byN[7].primary_contact_id}`);
  const tl = await inner('[data-testid="contact-timeline"]');
  check("B5.13 contact timeline shows the quote events", tl.includes("Quote 7 marked sent") && tl.includes("Customer acceptance of Estimate 3 recorded"), tl.slice(0, 200));
  await go("/operations/growth");
  check("B5.14 Growth dashboard recent activity loads with quote events", /Quote \d+|Estimate \d+/.test(await inner('[data-testid="growth-recent-activity"]')));
} catch (e) {
  fails++; console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  try { await s?.close(); } catch {}
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
