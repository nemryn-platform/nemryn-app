// NP-P2-S5-O1 release -- READ-ONLY production verification of the closed-opportunity print notice (ZD-226), built on
// the S3C-R1 Test A script (Pilot Simulation tenant only).
// Signs in with the synthetic SIM identities, loads pages, emulates print media and renders PDFs LOCALLY via CDP.
// No form is submitted and no data is written (database access is SELECT-only through `supabase db query --linked`).
// MANUAL, owner-authorized only (never CI):
//   QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/print-readonly.mjs
import { writeFileSync } from "node:fs";
import { APP, ORG, q, one, simEnv, outDir, chromeSession, sleep, pdfText } from "./_prod.mjs";

const OUT = outDir("print");
const core = await import("../../../src/lib/plus/quotes-core.ts");
const opp = await import("../../../src/lib/plus/opportunities-core.ts");
const env = simEnv();
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 500) : ""}`); return !!c; };
const section = (x) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${x}`);
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(400); } return false; }
const sessions = [];
async function session(name, email, password) {
  const s = await chromeSession(name); sessions.push(s);
  await s.setViewport(1440, 1200);
  if (email) {
    await s.nav(`${APP}/sign-in`, 2500);
    await waitFor(() => s.evaluate(`!!document.querySelector('input[name="email"]')`));
    for (const [n, v] of [["email", email], ["password", password]]) await s.evaluate(`(function(){const el=document.querySelector('input[name="${n}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
    await s.evaluate(`document.querySelector('button[type="submit"]').click()`);
    await waitFor(async () => !(await s.evaluate("location.pathname")).startsWith("/sign-in"), 25000);
  }
  return s;
}
const go = async (s, p) => { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 15000); await sleep(1500); };
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const path = (s) => s.evaluate("location.pathname");
const is404 = async (s) => /could not be found|404/i.test(await s.evaluate("document.body.innerText")) && !(await has(s, '[data-testid="quote-print"]'));

const COUNTS = `select (select count(*) from public.plus_quotes where organization_id='${ORG}') || '/' || (select count(*) from public.plus_tasks where organization_id='${ORG}') || '/' || (select count(*) from public.plus_activities where organization_id='${ORG}') || '/' || (select count(*) from public.audit_events where organization_id='${ORG}') || '/' || (select count(*) from public.notification_events) || '/' || (select max(updated_at)::text from public.plus_quotes where organization_id='${ORG}') as c`;
const C0 = one(COUNTS);
const STATUS = `select string_agg(q.quote_number || ':' || q.status || ':' || q.total_cents || ':' || q.updated_at || ':' || o.stage, ',' order by q.quote_number) as s from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id where q.organization_id='${ORG}'`;
const S0 = one(STATUS);
console.log(`stored quotes (number:status:total_cents:updated_at:opportunity stage): ${S0}`);
const rows = q(`select q.*, c.display_name, c.phone as c_phone, c.email as c_email, o.title as opp_title, o.stage as opp_stage, o.lost_note as opp_lost_note,
    to_char((q.created_at at time zone o2.timezone)::date, 'YYYY-MM-DD') as created_local, to_char((q.sent_at at time zone o2.timezone)::date, 'YYYY-MM-DD') as sent_local,
    to_char((q.responded_at at time zone o2.timezone)::date, 'YYYY-MM-DD') as responded_local, q.valid_until < public._plus_org_local_today(q.organization_id) as is_expired
  from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id join public.plus_contacts c on c.id = o.primary_contact_id join public.organizations o2 on o2.id = q.organization_id
  where q.organization_id='${ORG}' order by q.quote_number`);
const n = (v) => (v === null ? 0 : Number(v));
const model = (r) => {
  // ZD-227: like plus_get_quote / plus_list_quotes, a WITHDRAWN revision is not reported as the replacement
  const succ = rows.find((x) => x.supersedes_quote_id === r.id && x.organization_id === r.organization_id && x.status !== "withdrawn");
  return core.quotePrintModel({
    kind: r.kind, quoteNumber: Number(r.quote_number), status: r.status, isExpired: r.status === "sent" && r.is_expired === true,
    serviceLabel: r.service_type ? opp.serviceTypeLabel(r.service_type) : "Not specified", roundTrip: r.round_trip === true, distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
    baseCents: n(r.base_cents), mileageCents: n(r.mileage_cents), waitCents: n(r.wait_cents), extraStopsCents: n(r.extra_stops_cents), mobilityAssistanceCents: n(r.mobility_assistance_cents),
    escortCents: n(r.escort_cents), returnLegCents: n(r.return_leg_cents), otherCents: n(r.other_cents), otherLabel: r.other_label, discountCents: n(r.discount_cents), totalCents: n(r.total_cents),
    currency: r.currency, validUntil: r.valid_until, createdDate: r.created_local, sentDate: r.status === "draft" ? null : r.sent_local, respondedDate: r.responded_local, termsNote: r.terms_note,
    customerName: r.display_name, successor: r.status === "superseded" && succ ? { kind: succ.kind, quoteNumber: Number(succ.quote_number) } : null,
    opportunityStage: r.opp_stage,
  });
};

try {
  section("sign in (synthetic SIM identities)");
  const admin = await session("-s3cr1-admin", env.SIM_ADMIN_EMAIL, env.SIM_ADMIN_PASSWORD);
  check("A0 SIM Admin signed in through the production sign-in page", !(await path(admin)).startsWith("/sign-in"), await path(admin));
  console.log(`baseline counts quotes/tasks/activities/audit/notifications(all orgs)/quotes.max(updated_at): ${C0}`);

  section("A. Entry points");
  await go(admin, "/operations/growth/quotes");
  const dirLinks = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-print"]')].map(a => a.getAttribute('href') + '|' + a.target + '|' + a.rel)`);
  check("A1 the directory lists the tenant's quotes with a Print link per row (new tab, noopener)", dirLinks.length === rows.length && rows.every((r) => dirLinks.includes(`/quote-print/${r.id}|_blank|noopener`)), JSON.stringify(dirLinks));
  const before = await path(admin);
  await admin.evaluate(`document.querySelector('[data-testid="quote-directory-print"]').click()`); await sleep(1200);
  check("A2 the directory Print link opens a new tab without navigating the directory tab", (await path(admin)) === before);
  await go(admin, `/operations/growth/pipeline/${rows.find((r) => r.status === "accepted").opportunity_id}`);
  const panelLinks = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-print-link"]')].map(a => a.getAttribute('href'))`);
  check("A3 the opportunity panel shows a Print link on every quote row (current + history)", panelLinks.length === rows.filter((r) => r.opportunity_id === rows.find((x) => x.status === "accepted").opportunity_id).length, JSON.stringify(panelLinks));

  section("A. Every existing quote: content, banner and stored snapshot");
  for (const r of rows) {
    const m = model(r);
    await go(admin, `/quote-print/${r.id}`);
    const doc = await inner(admin, '[data-testid="quote-print"]');
    const lines = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-print-line"]')].map(x => x.innerText.replace(/\\s+/g,' ').trim())`);
    const details = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-print-details"] dt')].map(dt => dt.innerText + '=' + dt.nextElementSibling.innerText)`);
    const banner = await inner(admin, '[data-testid="quote-print-banner"]');
    const ok = (await inner(admin, '[data-testid="quote-print-reference"]')) === m.reference
      && (await inner(admin, '[data-testid="quote-print-status"]')) === `Status: ${m.statusLabel}`
      && (m.banner ? banner.includes(m.banner.heading) && banner.includes(m.banner.text) : banner === "")
      && (await inner(admin, '[data-testid="quote-print-organization"]')) === "Nemryn Pilot Simulation"
      && (await inner(admin, '[data-testid="quote-print-customer"]')) === r.display_name
      && JSON.stringify(lines) === JSON.stringify(m.lines.map((l) => `${l.label} ${l.amount}`))
      && (m.discount ? (await inner(admin, '[data-testid="quote-print-discount"]')).includes(`−${m.discount}`) : !(await has(admin, '[data-testid="quote-print-discount"]')))
      && (await inner(admin, '[data-testid="quote-print-total"]')) === m.total && m.total === core.formatCents(n(r.total_cents))
      && JSON.stringify(details) === JSON.stringify(m.details.map((d) => `${d.label}=${d.value}`))
      && (m.termsNote ? (await inner(admin, '[data-testid="quote-print-terms"]')).includes(m.termsNote) : !(await has(admin, '[data-testid="quote-print-terms"]')))
      && (await inner(admin, '[data-testid="quote-print-footer"]')) === m.footer;
    const biz = (await inner(admin, '[data-testid="quote-print-business"]')).trim();
    const pv = { phone: !(r.c_phone && doc.includes(r.c_phone)), email: !(r.c_email && doc.includes(r.c_email)), oppTitle: !doc.includes(r.opp_title), reason: !(r.withdrawn_reason && doc.includes(r.withdrawn_reason)), noBusinessText: biz === "" };
    check(`P-${m.reference} (${r.status}${r.is_expired ? ", past valid" : ""}): reference, status "${m.statusLabel}", banner ${m.banner ? m.banner.heading : "none"}, organization, customer, lines, discount, stored total ${m.total}, dates, terms, footer`,
      ok, `banner=${banner.replace(/\n/g, " ")} lines=${JSON.stringify(lines)} details=${JSON.stringify(details)}`);
    check(`P-${m.reference} privacy: display name only (no contact phone / email, opportunity title, withdrawal reason); no business contact text (none set)`, Object.values(pv).every(Boolean), JSON.stringify(pv));
    const notice = await inner(admin, '[data-testid="quote-print-closed-notice"]');
    const closed = r.opp_stage === "lost" || r.opp_stage === "converted";
    check(`O1-${m.reference} (opportunity ${r.opp_stage}, stored ${r.status}): ${closed ? "the closed notice with the exact ZD-226 copy, next to the unchanged status banner" : "NO closed notice (open opportunity)"}; no lost note`,
      (closed ? notice.includes(core.QUOTE_PRINT_CLOSED_NOTICE.heading) && notice.includes(core.QUOTE_PRINT_CLOSED_NOTICE.text) && !!m.closedNotice : notice === "" && !m.closedNotice)
      && !(r.opp_lost_note && doc.includes(r.opp_lost_note)), notice.replace(/\n/g, " "));
    await admin.screenshot(`${OUT}/print-${m.reference.replace(/\s+/g, "-").toLowerCase()}.png`);
  }
  const covered = new Set(rows.map((r) => (r.status === "sent" && r.is_expired ? "expired" : r.status)));
  console.log(`statuses present live: ${[...covered].join(", ")}; absent: ${["draft", "sent", "accepted", "declined", "superseded", "withdrawn", "expired"].filter((x) => !covered.has(x)).join(", ")}`);

  section("A. Print media, PDF, toolbar, caching");
  const QA = rows.find((r) => r.status === "accepted");
  await go(admin, `/quote-print/${QA.id}`);
  check("A4 Back link points to the opportunity's quotes panel", (await admin.evaluate(`document.querySelector('[data-testid="quote-print-back"]').getAttribute('href')`)) === `/operations/growth/pipeline/${QA.opportunity_id}#quotes`);
  check("A5 no public-sharing action: no mailto / sms links and no Email / Share / Copy link / Send control on the page",
    !(await admin.evaluate(`!!document.querySelector('a[href^="mailto:"], a[href^="sms:"]') || [...document.querySelectorAll('button, a')].some(e => /\\b(Email|Share|Copy link|Send)\\b/.test(e.innerText))`)));
  const hdr = await admin.evaluate(`fetch(location.href, { credentials: 'include' }).then(r => r.status + ' ' + (r.headers.get('cache-control') || '') + ' ' + (r.headers.get('x-vercel-cache') || ''))`);
  check("A6 the rendered response is private and not cacheable", /^200 /.test(hdr) && /private/.test(hdr) && /no-store/.test(hdr) && !/HIT/.test(hdr), hdr);
  check("A7 robots noindex", await admin.evaluate(`/noindex/.test(document.querySelector('meta[name="robots"]')?.content || '')`));
  await admin.cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("A8 print media: toolbar hidden, document content shown", (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-toolbar"]')).display`)) === "none"
    && (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-charges"]')).display`)) !== "none");
  await admin.screenshot(`${OUT}/print-media-accepted.png`);
  await admin.cdp("Emulation.setEmulatedMedia", { media: "" });
  const pdf = Buffer.from((await admin.cdp("Page.printToPDF", { printBackground: false })).data, "base64");
  writeFileSync(`${OUT}/estimate-${QA.quote_number}-accepted.pdf`, pdf);
  check("A9 browser PDF rendering produces a valid PDF (saved locally only)", pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 2000, pdf.length);
  const Q6 = rows.find((r) => Number(r.quote_number) === 6);
  await go(admin, `/quote-print/${Q6.id}`);
  await admin.cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("O1-P1 print media (the O1 case, Quote 6): the closed notice is displayed; the toolbar is hidden",
    (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-closed-notice"]')).display`)) !== "none"
    && (await admin.evaluate(`getComputedStyle(document.querySelector('[data-testid="quote-print-toolbar"]')).display`)) === "none");
  await admin.screenshot(`${OUT}/o1-quote-6-print-media.png`);
  await admin.cdp("Emulation.setEmulatedMedia", { media: "" });
  const pdf6 = (await admin.cdp("Page.printToPDF", { printBackground: false })).data;
  writeFileSync(`${OUT}/quote-6-closed-notice.pdf`, Buffer.from(pdf6, "base64"));
  const text = (await pdfText(pdf6)).text;   // pinned pdfjs-dist, locally (no CDN)
  check("O1-P2 the browser-generated PDF of Quote 6 contains the closed notice, 'Status: Sent' and the stored $40.00; no toolbar text (local file only)",
    text.includes("Opportunity closed") && text.includes("Its recorded quotation status has not changed") && text.includes("still applicable before sharing or relying on it")
    && text.includes("Status: Sent") && text.includes("$40.00") && !/Print \/ Save PDF|Back to the opportunity/.test(text), text.slice(0, 200));
  await go(admin, `/quote-print/${QA.id}`);
  const back = await admin.evaluate(`document.querySelector('[data-testid="quote-print-back"]').click()`);
  await waitFor(async () => (await path(admin)) === `/operations/growth/pipeline/${QA.opportunity_id}`, 15000);
  console.log(`A10 diag: back-click=${back} path=${await path(admin)} hash=${await admin.evaluate("location.hash")}`);
  check("A10 Back navigation returns to the opportunity", (await path(admin)) === `/operations/growth/pipeline/${QA.opportunity_id}`, back);

  section("A. Authorization and safe 404");
  await go(admin, `/quote-print/00000000-0000-4000-8000-000000000000`);
  check("A11 unknown quote id: safe 404 (no document)", await is404(admin));
  await go(admin, `/quote-print/not-a-uuid`);
  check("A12 malformed id: the same safe 404", await is404(admin));
  const anon = await session("-s3cr1-anon");
  await go(anon, `/quote-print/${QA.id}`);
  check("A13 signed out: no document; redirected to sign-in", !(await has(anon, '[data-testid="quote-print"]')) && (await path(anon)).startsWith("/sign-in"), await path(anon));
  const disp = await session("-s3cr1-disp", env.SIM_DISPATCHER_EMAIL, env.SIM_DISPATCHER_PASSWORD);
  check("A14a SIM Dispatcher signed in", !(await path(disp)).startsWith("/sign-in"), await path(disp));
  await go(disp, `/quote-print/${QA.id}`);
  check("A14 Dispatcher WITHOUT a Plus grant: refused (no document; the existing Growth redirect)", !(await has(disp, '[data-testid="quote-print"]')) && !(await disp.evaluate(`document.body.innerText.includes(${JSON.stringify(QA.display_name)})`)), await path(disp));
  const drv = await session("-s3cr1-drv", env.SIM_DRIVER_A_EMAIL, env.SIM_DRIVER_A_PASSWORD);
  await go(drv, `/quote-print/${QA.id}`);
  check("A15 Driver: refused (no document)", !(await has(drv, '[data-testid="quote-print"]')) && !(await drv.evaluate(`document.body.innerText.includes(${JSON.stringify(QA.display_name)})`)), await path(drv));

  section("A. No writes");
  const C1 = one(COUNTS);
  const S1 = one(STATUS);
  check("O1-S stored quote statuses, totals, versions and opportunity stages identical before / after (display only)", S1 === S0, S1 === S0 ? "" : `${S0} -> ${S1}`);
  check("A16 nothing changed: quotes / tasks / activities / audit / notifications / quote versions identical", C1 === C0, `${C0} -> ${C1}`);
} catch (e) {
  fails++; console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
