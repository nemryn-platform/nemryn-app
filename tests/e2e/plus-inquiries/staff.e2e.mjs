// NP-P2-S7-C -- staff inquiry management: Growth -> Inquiries (list, detail, convert, dismiss, reopen), the navigation
// badge and Settings -> Nemryn Plus -> Inquiry form. Browser + SQL E2E on the ISOLATED stack (NemrynS1Iso +
// `next start -p 3100`, started WITHOUT PLUS_INQUIRY_SUBMISSIONS -- the production default). FICTIONAL data only; the
// plus-quotes config refuses any other target (assertFictionalSeed).
//   node tests/e2e/plus-inquiries/staff.e2e.mjs
// Fixtures (owner SQL on the fictional seed): Org A + Org B Plus active, an Org A published form (allowlisted for the
// fixture submissions only), inquiries submitted through the real submit_plus_inquiry RPC, and pre-existing contacts to
// match. Removed at the end. Nothing is sent.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1" };
const EMAIL = { a1: "org-a-admin@example.test", a2: "org-a-dispatcher@example.test", b1: "org-b-admin@example.test" };
const STAMP = Date.now().toString(36);
const OUT = artifactDir("s7c-staff");
mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.S7C_SCREENSHOT_DIR || OUT;
mkdirSync(SHOTS, { recursive: true });

let fails = 0, passes = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|UPDATE \d+|INSERT 0 \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
const one = (q) => first(sql(q));
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
// verbose errors carry the SQLSTATE ("ERROR:  ZW003: stale_state"), so the checks below match on the code
const asUserErr = (uid, stmt) => { try { sql(`\\set VERBOSITY verbose\nbegin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`); return "ok"; } catch (e) { return String(e.stderr ?? e.message); } };
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
const memId = (uid, org = ORG_A) => one(`select id from memberships where user_id='${uid}' and organization_id='${org}'`);
const setPlus = (org, status = "active") =>
  sql(`delete from organization_modules where organization_id = '${org}'; insert into organization_modules (organization_id, module, status, trial_started_at, trial_ends_at, status_reason) values ('${org}', 'plus', '${status}', ${status === "expired" ? "now() - interval '20 days', now() - interval '6 days'" : "null, null"}, 'NP-P2-S7-C E2E')`);
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const coreCounts = () => one(`select (select count(*) from transportation_requests) || '/' || (select count(*) from passengers) || '/' || (select count(*) from trips) || '/' || (select count(*) from notification_events)`);
const newCount = (org = ORG_A) => Number(one(`select count(*) from plus_inquiries where organization_id = '${org}' and status = 'new'`));

// ---------------------------------------------------------------- fixtures
function cleanup() {
  sql(`
    set session_replication_role = replica;
    delete from plus_communication_consents where organization_id in ('${ORG_A}', '${ORG_B}') and contact_id in (select id from plus_contacts where display_name like 'S7C %');
    delete from plus_activities where organization_id in ('${ORG_A}', '${ORG_B}') and (contact_id in (select id from plus_contacts where display_name like 'S7C %') or opportunity_id in (select id from plus_opportunities where inquiry_id is not null));
    delete from plus_opportunities where organization_id in ('${ORG_A}', '${ORG_B}') and (inquiry_id is not null or primary_contact_id in (select id from plus_contacts where display_name like 'S7C %'));
    delete from plus_inquiries where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from plus_contacts where organization_id in ('${ORG_A}', '${ORG_B}') and display_name like 'S7C %';
    delete from plus_inquiry_forms where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from plus_inquiry_public_access where organization_id in ('${ORG_A}', '${ORG_B}');
    set session_replication_role = origin;
  `);
}
cleanup();
setPlus(ORG_A); setPlus(ORG_B); setGrant("none");
const prevOfferings = one(`select coalesce(string_agg(service_type, ','), '') from organization_service_offerings where organization_id = '${ORG_A}'`);
sql(`
  delete from organization_service_offerings where organization_id = '${ORG_A}';
  insert into organization_service_offerings (organization_id, service_type) values ('${ORG_A}', 'dialysis'), ('${ORG_A}', 'medical_appointment'), ('${ORG_A}', 'wheelchair_transportation');
  insert into plus_inquiry_forms (organization_id, status, headline, intro_text, offered_service_types, consent_text_version, published_at, published_by, created_by, updated_by)
    values ('${ORG_A}', 'published', 'Questions about our rides', 'Ask about prices or availability.', array['medical_appointment','dialysis'], 'plus-inquiry-consent-v1', now(), '${U.a1}', '${U.a1}', '${U.a1}'),
           ('${ORG_B}', 'published', 'Org B questions', null, '{}', 'plus-inquiry-consent-v1', now(), '${U.b1}', '${U.b1}', '${U.b1}');
  insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG_A}', 'S7-C local synthetic e2e', '${U.a1}'), ('${ORG_B}', 'S7-C local synthetic e2e', '${U.b1}');
`);
const KEY_A = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG_A}'`);
const KEY_B = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG_B}'`);
const VER_A = Number(one(`select config_version from plus_inquiry_forms where organization_id = '${ORG_A}'`));
const VER_B = Number(one(`select config_version from plus_inquiry_forms where organization_id = '${ORG_B}'`));
const q = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
function submit(key, ver, { name, phone = null, email = null, type = "quote", service = null, followup = false, marketing = false, question = "Fictional question about a ride.", acq = "{}" }) {
  const idem = `s7c-${STAMP}-${Math.random().toString(36).slice(2, 10)}`;
  sql(`select (public.submit_plus_inquiry(${q(key)}, '${idem}', ${ver}, ${q(name)}, ${q(phone)}, ${q(email)}, 'either', 'family', '${type}', ${q(service)}, 'this_week', ${q(question)}, ${followup}, ${marketing}, '${acq}'::jsonb)).*`);
  return one(`select id from plus_inquiries where idempotency_key = '${idem}'`);
}
const contact = (org, name, { phone = null, email = null, dnc = false } = {}) =>
  one(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, do_not_contact, created_by) values ('${org}', ${q(name)}, ${q(phone)}, ${q(email)}, 'individual', ${dnc}, '${org === ORG_A ? U.a1 : U.b1}') returning id`);

const C_MATCH = contact(ORG_A, "S7C Morgan Match", { email: "s7c.morgan@example.test" });
const C_DNC = contact(ORG_A, "S7C Dana Donot", { phone: "(404) 555-0191", email: "s7c.dana@example.test", dnc: true });
const C_NAME = contact(ORG_A, "S7C Casey Same", { phone: "(404) 555-0199" });
const I = {
  create: submit(KEY_A, VER_A, { name: "S7C Riley Fresh", phone: "(404) 555-0181", email: "s7c.riley@example.test", type: "availability", service: "dialysis", followup: true, question: "Do you run Saturday dialysis rides? (fictional)", acq: '{"utmSource":"newsletter","utmCampaign":"spring","landingPath":"/contact"}' }),
  link: submit(KEY_A, VER_A, { name: "S7C Morgan Match", phone: "(404) 555-0182", email: "s7c.morgan@example.test", followup: true, marketing: true }),
  dnc: submit(KEY_A, VER_A, { name: "S7C Dana Donot", phone: "(404) 555-0191", email: "s7c.dana@example.test", followup: true, marketing: true }),
  dup: submit(KEY_A, VER_A, { name: "S7C Casey Same", phone: "(404) 555-0199", type: "booking" }),
  dismiss: submit(KEY_A, VER_A, { name: "S7C Spammy Sender", email: "s7c.spam@example.test", type: "other", question: "Fictional spam message." }),
  stale: submit(KEY_A, VER_A, { name: "S7C Stale Version", email: "s7c.stale@example.test" }),
  race: submit(KEY_A, VER_A, { name: "S7C Race Twice", email: "s7c.race@example.test" }),
  b: submit(KEY_B, VER_B, { name: "S7C Org B Person", email: "s7c.orgb@example.test" }),
};
// the fixture allowlist is only for the submissions above; Settings is tested with Org A NOT allowlisted
sql(`delete from plus_inquiry_public_access where organization_id in ('${ORG_A}', '${ORG_B}')`);
check("FX fixtures: 7 Org A + 1 Org B new inquiries submitted through submit_plus_inquiry", Object.values(I).every(Boolean) && newCount() === 7 && newCount(ORG_B) === 1, JSON.stringify(I));
const coreBefore = coreCounts();

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
async function go(p, w, h) { if (w) await s.setViewport(w, h ?? 1100); await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(900); }
async function open(name, email, w = 1440, h = 1200) { const x = await newChromeSession(`s7c-${name}`); sessions.push(x); await x.setViewport(w, h); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function shot(name) { const h = await ev("Math.ceil(document.documentElement.scrollHeight)"); const w = await ev("window.innerWidth"); await s.setViewport(w, Math.min(Math.max(900, h), 3200)); await sleep(300); await s.screenshot(path.join(SHOTS, `${name}.png`)); }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target?.join(' ') })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical violations${res.length ? ` (${res.length} lower: ${res.map((v) => v.id).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
}
const noHScroll = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
async function convertAndWait() {
  await click('[data-testid="inquiry-convert-submit"]');
  return waitFor(async () => (await has('[data-testid="inquiry-convert-success"]')) || (await has('[data-testid="inquiry-convert-message"]')), 15000);
}
const runParallel = (cmds) => Promise.all(cmds.map((input) => new Promise((resolve) => {
  const p = spawn("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
  p.stdin.end(`\\set VERBOSITY verbose\n${input}`);
})));

try {
  // ================================================================ navigation + list
  section("navigation + list");
  s = await open("a1", EMAIL.a1);
  await go("/operations/growth/inquiries");
  const nav = await ev(`[...document.querySelectorAll('[data-testid="growth-nav-child"]')].map(a => a.innerText.replace(/\\s+/g,' ').trim())`);
  check("N1 Growth children in canonical order with Inquiries after Dashboard; badge shows the new count", JSON.stringify(nav) === JSON.stringify(["Dashboard", "Inquiries 7 7 new", "Pipeline", "Contacts", "Estimates & Quotes", "Tasks"]) || (nav[1]?.startsWith("Inquiries") && nav[0] === "Dashboard" && nav.length === 6), JSON.stringify(nav));
  const badge = await ev(`(function(){const b=document.querySelector('[data-testid="growth-nav-inquiries-badge"]'); return b ? { visible: b.querySelector('[aria-hidden]').textContent, sr: b.querySelector('.sr-only').textContent } : null;})()`);
  check("N2 badge: visible number 7 + screen-reader text '7 new'", badge?.visible === "7" && badge?.sr === "7 new", JSON.stringify(badge));
  check("N3 Inquiries is the current page (aria-current)", await ev(`[...document.querySelectorAll('[data-testid="growth-nav-child"]')].find(a=>a.getAttribute('href')==='/operations/growth/inquiries')?.getAttribute('aria-current') === 'page'`));
  const listNames = await ev(`[...document.querySelectorAll('[data-testid="inquiry-row-link"]')].map(a=>a.textContent)`);
  check("L1 default filter New: the 7 Org A new inquiries, newest first; no Org B row", listNames.length === 7 && listNames[0] === "S7C Race Twice" && !listNames.includes("S7C Org B Person"), JSON.stringify(listNames));
  await axe("inquiries list 1440");
  await shot("s7c-inquiries-list-1440");
  await go("/operations/growth/inquiries?q=riley");
  check("L2 search narrows to one row", JSON.stringify(await ev(`[...document.querySelectorAll('[data-testid="inquiry-row-link"]')].map(a=>a.textContent)`)) === '["S7C Riley Fresh"]');
  await go("/operations/growth/inquiries?status=converted");
  check("L3 empty state for a filter with no rows (Converted, before any conversion)", await has('[data-testid="inquiries-empty"]'), await text("main"));
  await go("/operations/growth/inquiries?status=bogus&page=-3");
  check("L4 malformed params fall back to New / page 1", (await ev(`document.querySelector('[data-testid="inquiries-status"]').value`)) === "new" && (await ev(`document.querySelectorAll('[data-testid="inquiry-row-link"]').length`)) === 7);
  await go("/operations/growth/inquiries");
  await ev(`document.querySelector('[data-testid="inquiry-row-link"]').focus()`);
  check("L5 keyboard: the row link is focusable and points at the detail page", await ev(`document.activeElement?.dataset.testid === 'inquiry-row-link' && /\\/operations\\/growth\\/inquiries\\/[0-9a-f-]{36}$/.test(document.activeElement.href)`));
  await go("/operations/growth/inquiries", 820, 1100);
  check("L6 820px (rail): no horizontal page scroll; rail button names the count; dot shown", (await noHScroll()) && (await ev(`document.querySelector('[data-testid="growth-nav-rail-button"]').getAttribute('aria-label')`)) === "Growth, 7 new inquiries" && (await has('[data-testid="growth-nav-rail-dot"]')));
  await shot("s7c-inquiries-list-820");
  await s.setViewport(1440, 1200);

  // ================================================================ detail
  section("detail");
  await go(`/operations/growth/inquiries/${I.create}`);
  const det = await text('[data-testid="inquiry-details"]');
  check("D1 detail shows what was sent (phone, email, type, service, relationship, timeframe, question)", /\(404\) 555-0181/.test(det) && /s7c\.riley@example\.test/.test(det) && /Availability/.test(det) && /Dialysis/.test(det) && /A family member/.test(det) && /This week/.test(det) && /Saturday dialysis/.test(det), det);
  const ticks = await text('[data-testid="inquiry-consent-ticks"]');
  check("D2 consent ticks: follow-up ticked; news and offers 'Not ticked … (no permission given)'", /Ticked: follow-up/.test(ticks) && /Not ticked: news and offers \(no permission given\)/.test(ticks) && /never permission/.test(ticks), ticks);
  check("D3 acquisition panel shows the campaign and page", /newsletter/.test(await text('[data-testid="inquiry-acquisition"]')) && /\/contact/.test(await text('[data-testid="inquiry-acquisition"]')));
  check("D4 no possible match for a fresh person", /No existing contact/.test(await text('[data-testid="inquiry-duplicates"]')));
  await axe("inquiry detail");
  await shot("s7c-inquiry-detail-1440");
  await go(`/operations/growth/inquiries/${I.link}`);
  const hints = await text('[data-testid="inquiry-duplicates"]');
  check("D5 duplicate hints: the matching contact (email) is listed as a hint only", /S7C Morgan Match/.test(hints) && /matches on/.test(hints), hints);
  await go(`/operations/growth/inquiries/00000000-0000-0000-0000-000000000000`);
  const nf1 = await text("body");
  await go(`/operations/growth/inquiries/${I.b}`);
  check("D6 a foreign (Org B) inquiry id renders the same not-found as an unknown id", nf1 === (await text("body")) && !/S7C Org B Person/.test(nf1));
  await go(`/operations/growth/inquiries/not-a-uuid`);
  check("D7 malformed id -> not found", !(await has('[data-testid="inquiry-details"]')));

  // ================================================================ convert: create
  section("convert: create");
  await go(`/operations/growth/inquiries/${I.create}`);
  await click('[data-testid="inquiry-convert-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-convert-form"]'), 5000);
  const cform = await ev(`(function(){const d=document.querySelector('dialog[open]'); return { mode: d.querySelector('input[name="modeChoice"]:checked')?.value, linkDisabled: d.querySelector('input[name="modeChoice"][value="link"]')?.disabled, consent: d.querySelector('[data-testid="inquiry-convert-consent"]').innerText, title: d.querySelector('input[name="title"]').placeholder, focusInside: d.contains(document.activeElement) };})()`);
  check("C1 dialog: Create selected, Link disabled (no matches), consent explanation names only follow-up, default title = DB default, focus inside",
    cform.mode === "create" && cform.linkDisabled === true && /follow-up/.test(cform.consent) && !/news and offers/.test(cform.consent) && /Text messages are never included/.test(cform.consent) && cform.title === "S7C Riley Fresh — Availability question" && cform.focusInside, JSON.stringify(cform));
  await axe("convert dialog");
  await shot("s7c-convert-dialog");
  await convertAndWait();
  const okText = await text('[data-testid="inquiry-convert-success"]');
  const conv = one(`select i.status || '|' || (i.contact_id is not null) || '|' || o.channel || '|' || o.stage || '|' || o.source || '|' || o.title || '|' || c.display_name from plus_inquiries i join plus_opportunities o on o.inquiry_id = i.id join plus_contacts c on c.id = i.contact_id where i.id = '${I.create}'`);
  const consents = sql(`select channel || '/' || purpose || '/' || status || '/' || captured_via from plus_communication_consents where contact_id = (select contact_id from plus_inquiries where id = '${I.create}') order by channel, purpose`).split("\n").filter(Boolean);
  check("C2 converted: new contact + ONE private-pay opportunity (new_inquiry, web_inquiry, default title) linked to the inquiry",
    /^converted\|true\|private_pay\|new_inquiry\|web_inquiry\|S7C Riley Fresh — Availability question\|S7C Riley Fresh$/.test(conv), conv);
  check("C3 consent: ONLY the ticked purpose (follow-up) for email + voice via web_form; marketing (unticked) and SMS never",
    JSON.stringify(consents) === JSON.stringify(["email/service_followup/granted/web_form", "voice/service_followup/granted/web_form"]), JSON.stringify(consents));
  check("C4 success feedback: links to the opportunity and contact, consent note, 'No booking request'", /No booking request/.test(okText) && /2 website-form consent entries were recorded/.test(okText) && (await has('[data-testid="inquiry-convert-success"] a[href^="/operations/growth/pipeline/"]')), okText);
  check("C5 no Core Request / Passenger / Trip / notification created", coreCounts() === coreBefore, `${coreBefore} -> ${coreCounts()}`);
  await shot("s7c-convert-success");
  await click('[data-testid="inquiry-convert-success"] button');
  await waitFor(async () => /Converted/.test(await text('[data-testid="inquiry-status"]')), 8000);
  check("C6 after Done: status Converted with contact + opportunity links; Convert/Dismiss gone", (await has('[data-testid="inquiry-converted-links"] a[href^="/operations/growth/contacts/"]')) && !(await has('[data-testid="inquiry-convert-open"]')));
  const badge2 = await ev(`document.querySelector('[data-testid="growth-nav-inquiries-badge"] [aria-hidden]')?.textContent`);
  check("C7 badge decremented to 6 after the conversion", badge2 === "6", badge2);
  const contactId = one(`select contact_id from plus_inquiries where id = '${I.create}'`);
  await go(`/operations/growth/contacts/${contactId}?consentHistory=1`);
  check("C8 Communication preferences shows the web_form method as 'Website inquiry form'", /Website inquiry form/.test(await text("main")));
  const again = asUserErr(U.a1, `select (public.plus_convert_inquiry('${ORG_A}', '${I.create}', 1, 'create', null, true, false, null, null, false)).outcome`);
  check("C9 converting again (old version) is refused (ZW003 stale) -- still ONE opportunity", /ZW003|stale_state/.test(again) && one(`select count(*) from plus_opportunities where inquiry_id = '${I.create}'`) === "1", again);

  // ================================================================ convert: link + fill blanks
  section("convert: link");
  await go(`/operations/growth/inquiries/${I.link}`);
  await click('[data-testid="inquiry-convert-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-convert-form"]'), 5000);
  const lform = await ev(`(function(){const d=document.querySelector('dialog[open]'); return { mode: d.querySelector('input[name="modeChoice"]:checked')?.value, contact: d.querySelector('input[name="contactId"]:checked')?.value, fill: !!d.querySelector('input[name="fillBlanks"]'), dnc: !!d.querySelector('[data-testid="inquiry-convert-dnc"]'), consent: d.querySelector('[data-testid="inquiry-convert-consent"]').innerText };})()`);
  check("K1 link mode preselected with the matching contact; fill-blanks offered (contact has no phone); no DNC warning", lform.mode === "link" && lform.contact === C_MATCH && lform.fill && !lform.dnc && /follow-up and news and offers/.test(lform.consent), JSON.stringify(lform));
  await click('dialog[open] input[name="fillBlanks"]');
  await setValue('dialog[open] input[name="title"]', "S7C custom opportunity title");
  await convertAndWait();
  const linked = one(`select i.contact_id || '|' || c.phone || '|' || c.email || '|' || o.title from plus_inquiries i join plus_contacts c on c.id = i.contact_id join plus_opportunities o on o.inquiry_id = i.id where i.id = '${I.link}'`);
  check("K2 linked to the EXISTING contact; blank phone filled, email unchanged; custom title kept", linked === `${C_MATCH}|(404) 555-0182|s7c.morgan@example.test|S7C custom opportunity title`, linked);
  const lc = sql(`select channel || '/' || purpose from plus_communication_consents where contact_id = '${C_MATCH}' and captured_via = 'web_form' order by 1`).split("\n").filter(Boolean);
  check("K3 consent for both ticked purposes on email + voice (addresses match after fill)", JSON.stringify(lc) === JSON.stringify(["email/marketing", "email/service_followup", "voice/marketing", "voice/service_followup"]), JSON.stringify(lc));
  check("K4 no second contact was created for Morgan", one(`select count(*) from plus_contacts where organization_id='${ORG_A}' and display_name = 'S7C Morgan Match'`) === "1");

  // ================================================================ convert: DNC
  section("convert: do not contact");
  await go(`/operations/growth/inquiries/${I.dnc}`);
  await click('[data-testid="inquiry-convert-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-convert-form"]'), 5000);
  const d1 = await ev(`(function(){const d=document.querySelector('dialog[open]'); return { warn: d.querySelector('[data-testid="inquiry-convert-dnc"]')?.innerText ?? null, submitDisabled: d.querySelector('[data-testid="inquiry-convert-submit"]').disabled };})()`);
  check("X1 DNC contact chosen: warning shown and Convert disabled until acknowledged", /Do not contact/.test(d1.warn ?? "") && d1.submitDisabled === true, JSON.stringify(d1));
  await shot("s7c-convert-dnc");
  const noAck = asUserErr(U.a1, `select (public.plus_convert_inquiry('${ORG_A}', '${I.dnc}', 1, 'link', '${C_DNC}', false, false, null, null, false)).outcome`);
  check("X2 server refuses a DNC link without acknowledgement (ZW004 do_not_contact_acknowledgement_required); nothing written", /do_not_contact_acknowledgement_required/.test(noAck) && one(`select status from plus_inquiries where id='${I.dnc}'`) === "new", noAck);
  await click('dialog[open] input[name="dncAcknowledged"]');
  await sleep(200);
  check("X3 acknowledgement enables Convert", (await ev(`document.querySelector('[data-testid="inquiry-convert-submit"]').disabled`)) === false);
  await convertAndWait();
  const dncNotes = await text('[data-testid="inquiry-convert-consent-notes"]');
  check("X4 converted; NO consent recorded; each skipped pair explained as Do not contact; DNC stays on",
    one(`select count(*) from plus_communication_consents where contact_id = '${C_DNC}'`) === "0" && /No consent was recorded/.test(dncNotes) && (dncNotes.match(/marked Do not contact/g) ?? []).length === 4 && one(`select do_not_contact from plus_contacts where id='${C_DNC}'`) === "t", dncNotes);

  // ================================================================ convert: possible duplicate on create
  section("convert: duplicate warning");
  await go(`/operations/growth/inquiries/${I.dup}`);
  await click('[data-testid="inquiry-convert-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-convert-form"]'), 5000);
  await click('dialog[open] input[name="modeChoice"][value="create"]');
  await sleep(200);
  const nContacts = one(`select count(*) from plus_contacts where organization_id='${ORG_A}'`);
  await convertAndWait();
  const dupMsg = await text('[data-testid="inquiry-convert-message"]');
  const dupBtn = await text('[data-testid="inquiry-convert-submit"]');
  check("U1 create with a possible duplicate: warning, nothing written, button becomes 'Create a new contact anyway'", /may already exist/.test(dupMsg) && /anyway/.test(dupBtn) && one(`select count(*) from plus_contacts where organization_id='${ORG_A}'`) === nContacts && one(`select status from plus_inquiries where id='${I.dup}'`) === "new", `${dupMsg} | ${dupBtn}`);
  await click('[data-testid="inquiry-convert-submit"]');
  await waitFor(() => has('[data-testid="inquiry-convert-success"]'), 15000);
  check("U2 confirmed: a second contact with the same name is created (never merged) and the inquiry is converted", (await has('[data-testid="inquiry-convert-success"]')) && one(`select count(*) from plus_contacts where organization_id='${ORG_A}' and display_name='S7C Casey Same'`) === "2" && one(`select contact_id from plus_inquiries where id='${I.dup}'`) !== C_NAME);

  // ================================================================ stale version
  section("stale + concurrency");
  await go(`/operations/growth/inquiries/${I.stale}`);
  await click('[data-testid="inquiry-convert-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-convert-form"]'), 5000);
  asUser(U.a1, `select (public.plus_dismiss_inquiry('${ORG_A}', '${I.stale}', 1, 'duplicate', null)).status`);
  asUser(U.a1, `select (public.plus_reopen_inquiry('${ORG_A}', '${I.stale}', 2)).status`);
  await convertAndWait();
  const staleMsg = await text('[data-testid="inquiry-convert-message"]');
  check("S1 a dialog opened before someone else changed the inquiry is refused with 'Reload' -- nothing created", /Someone else changed this/.test(staleMsg) && one(`select count(*) from plus_opportunities where inquiry_id='${I.stale}'`) === "0", staleMsg);
  const stmt = `begin; set local role authenticated; set local request.jwt.claim.sub = '${U.a1}'; select (public.plus_convert_inquiry('${ORG_A}', '${I.race}', 1, 'create', null, true, false, null, null, false)).outcome; commit;`;
  const race = await runParallel([stmt, stmt, stmt]);
  const ok = race.filter((r) => r.code === 0).length, stale = race.filter((r) => /ZW003|ZW004/.test(r.err)).length;
  check("S2 three concurrent conversions of one inquiry: exactly one succeeds, the others ZW003/ZW004; ONE opportunity, ONE contact",
    ok === 1 && stale === 2 && one(`select count(*) from plus_opportunities where inquiry_id='${I.race}'`) === "1" && one(`select count(*) from plus_contacts where display_name='S7C Race Twice'`) === "1", JSON.stringify(race.map((r) => [r.code, r.err.slice(0, 80)])));

  // ================================================================ dismiss + reopen
  section("dismiss + reopen");
  await go(`/operations/growth/inquiries/${I.dismiss}`);
  await click('[data-testid="inquiry-dismiss-open"]');
  await waitFor(() => has('dialog[open] [data-testid="inquiry-dismiss-form"]'), 5000);
  await setValue('dialog[open] select[name="reason"]', "other");
  await sleep(200);
  check("R1 reason 'Other' makes the note required", await ev(`document.querySelector('dialog[open] textarea[name="note"]').required`));
  await axe("dismiss dialog");
  await setValue('dialog[open] select[name="reason"]', "spam");
  await setValue('dialog[open] textarea[name="note"]', "Fictional automated message.");
  await click('[data-testid="inquiry-dismiss-submit"]');
  await waitFor(async () => /Dismissed/.test(await text('[data-testid="inquiry-status"]')) && !(await has("dialog[open]")), 10000);
  const dism = one(`select status || '|' || dismiss_reason || '|' || dismiss_note from plus_inquiries where id='${I.dismiss}'`);
  check("R2 dismissed with reason + note; page shows the reason; Reopen offered", dism === "dismissed|spam|Fictional automated message." && /Spam/.test(await text('[data-testid="inquiry-status"]')) && (await has('[data-testid="inquiry-reopen"]')), dism);
  await shot("s7c-inquiry-dismissed");
  await click('[data-testid="inquiry-reopen"]');
  await waitFor(async () => /New/.test(await text('[data-testid="inquiry-status"]')), 10000);
  check("R3 reopened -> New, reason cleared, Convert available again", one(`select status || '|' || coalesce(dismiss_reason,'-') from plus_inquiries where id='${I.dismiss}'`) === "new|-" && (await has('[data-testid="inquiry-convert-open"]')));
  const dupDismiss = asUserErr(U.a1, `select (public.plus_dismiss_inquiry('${ORG_A}', '${I.dismiss}', 1, 'spam', null)).status`);
  check("R4 a stale dismiss is refused (ZW003)", /ZW003|stale_state/.test(dupDismiss), dupDismiss);
  await go("/operations/growth/inquiries?status=converted");
  check("L7 Converted filter lists the 5 conversions", (await ev(`document.querySelectorAll('[data-testid="inquiry-row-link"]').length`)) === 5);
  await go("/operations/growth/inquiries?status=all");
  check("L8 All lists the 7 Org A inquiries", (await ev(`document.querySelectorAll('[data-testid="inquiry-row-link"]').length`)) === 7);

  // ================================================================ roles + read_only + cross-tenant
  section("roles");
  s = await open("a2", EMAIL.a2);
  await go("/operations/growth/inquiries");
  check("P1 Dispatcher WITHOUT a grant: no Growth navigation, the route redirects away", !(await has('[data-testid="growth-nav-group"]')) && !(await has('[data-testid="inquiries-filters"]')));
  setGrant("read");
  await go(`/operations/growth/inquiries/${I.dismiss}`);
  check("P2 Dispatcher with a READ grant: detail visible, 'View only', no Convert / Dismiss", (await has('[data-testid="inquiry-details"]')) && /View only/.test(await text("main")) && !(await has('[data-testid="inquiry-convert-open"]')));
  check("P3 READ grant: the convert RPC refuses (ZW001)", /ZW001/.test(asUserErr(U.a2, `select (public.plus_convert_inquiry('${ORG_A}', '${I.dismiss}', 3, 'create', null, true, false, null, null, false)).outcome`)));
  setGrant("write");
  await go(`/operations/growth/inquiries/${I.dismiss}`);
  check("P4 Dispatcher with a WRITE grant: Convert / Dismiss shown", await has('[data-testid="inquiry-convert-open"]'));
  await go("/operations/settings/plus");
  check("P5 Dispatcher can't open Settings -> Nemryn Plus (Organization Admin only)", !(await has('[data-testid="plus-inquiry-form"]')));
  setGrant("none");
  setPlus(ORG_A, "expired");
  s = sessions[0];
  await go(`/operations/growth/inquiries/${I.dismiss}`);
  check("P6 read_only workspace: Admin sees the inquiry + 'Nemryn Plus is not active', View only, no actions", /Nemryn Plus is not active/.test(await text("main")) && /View only/.test(await text("main")) && !(await has('[data-testid="inquiry-convert-open"]')));
  check("P7 read_only: the dismiss RPC refuses (ZW001)", /ZW001/.test(asUserErr(U.a1, `select (public.plus_dismiss_inquiry('${ORG_A}', '${I.dismiss}', 3, 'spam', null)).status`)));
  setPlus(ORG_A, "active");
  const sb = await open("b1", EMAIL.b1);
  s = sb;
  await go("/operations/growth/inquiries?status=all");
  const bNames = await ev(`[...document.querySelectorAll('[data-testid="inquiry-row-link"]')].map(a=>a.textContent)`);
  check("T1 Org B Admin sees only Org B's inquiry", JSON.stringify(bNames) === '["S7C Org B Person"]', JSON.stringify(bNames));
  await go(`/operations/growth/inquiries/${I.dismiss}`);
  check("T2 Org B Admin opening an Org A inquiry id -> not found", !(await has('[data-testid="inquiry-details"]')) && !/S7C Spammy/.test(await text("body")));
  check("T3 Org B Admin: the convert RPC on an Org A inquiry is refused (ZW002 in B's org, ZW002 in A's org)",
    /ZW002/.test(asUserErr(U.b1, `select (public.plus_convert_inquiry('${ORG_B}', '${I.dismiss}', 3, 'create', null, true, false, null, null, false)).outcome`)) &&
    /ZW002/.test(asUserErr(U.b1, `select (public.plus_convert_inquiry('${ORG_A}', '${I.dismiss}', 3, 'create', null, true, false, null, null, false)).outcome`)));
  check("T4 Org B badge counts Org B only (1)", (await ev(`document.querySelector('[data-testid="growth-nav-inquiries-badge"] [aria-hidden]')?.textContent`)) === "1");

  // ================================================================ settings -> inquiry form
  section("settings");
  s = sessions[0];
  await go("/operations/settings/plus");
  const st = await text('[data-testid="plus-inquiry-form"]');
  check("F1 Inquiry form section: Published, activation explained (workspace not turned on; servers not accepting)", /Published/.test(st) && /Public inquiries aren't turned on yet/.test(st) && /This workspace: not turned on yet/.test(st) && /Nemryn servers: not accepting/.test(st), st);
  // `next start` is a production build: getAppOrigin() refuses the loopback origin by design, so on this stack the share
  // area must degrade (the page keeps working); with a real origin it shows the link + code (unit-tested builders).
  const link = await text('[data-testid="plus-inquiry-form-link"]');
  const snippet = await text('[data-testid="plus-inquiry-form-snippet"]');
  const shareFallback = await has('[data-testid="plus-inquiry-form-share-unavailable"]');
  check("F2 share area: link + website code with the form's key, or (loopback production build) the plain fallback -- Status panel unaffected",
    (await has('[data-testid="plus-settings-status"]')) && (shareFallback ? link === "" && snippet === "" : link.endsWith(`/inquiry/${KEY_A}`) && snippet.includes(`data-nemryn-inquiry-form="${KEY_A}"`)), `${shareFallback} ${link} | ${snippet}`);
  const svc = await ev(`[...document.querySelectorAll('[data-testid="plus-inquiry-form-services"] input[name="services"]')].map(i => i.value + ':' + i.checked)`);
  check("F3 service choices = the workspace's offerings; offered ones ticked", JSON.stringify(svc) === JSON.stringify(["medical_appointment:true", "dialysis:true", "wheelchair_transportation:false"]), JSON.stringify(svc));
  await axe("settings inquiry form");
  await ev(`document.querySelector('[data-testid="plus-inquiry-form"]').scrollIntoView({ block: "start" })`);
  await sleep(300);
  await s.screenshot(path.join(SHOTS, "s7c-settings-inquiry-form.png"));
  const v0 = one(`select config_version || '|' || version from plus_inquiry_forms where organization_id='${ORG_A}'`);
  await setValue('[data-testid="plus-inquiry-form-headline"]', "S7C questions about rides");
  await click('[data-testid="plus-inquiry-form-save"]');
  await waitFor(() => has('dialog[open] [data-testid="plus-inquiry-form-save-confirm"]'), 5000);
  check("F4 saving a published form asks for confirmation first (nothing saved yet)", (await has('dialog[open]')) && one(`select config_version || '|' || version from plus_inquiry_forms where organization_id='${ORG_A}'`) === v0);
  await click('[data-testid="plus-inquiry-form-save-confirm"]');
  await waitFor(async () => /Saved/.test(await text('[data-testid="plus-inquiry-form-message"]')), 10000);
  const v1 = one(`select headline || '|' || config_version || '|' || status from plus_inquiry_forms where organization_id='${ORG_A}'`);
  check("F5 confirmed save: headline updated live, config_version incremented, still published", v1 === `S7C questions about rides|${VER_A + 1}|published`, v1);
  await setValue('[data-testid="plus-inquiry-form-headline"]', "   ");
  await click('[data-testid="plus-inquiry-form-save"]');
  await waitFor(() => has('dialog[open] [data-testid="plus-inquiry-form-save-confirm"]'), 5000);
  await click('[data-testid="plus-inquiry-form-save-confirm"]');
  await waitFor(async () => /highlighted/.test(await text('[data-testid="plus-inquiry-form-message"]')), 10000);
  check("F6 an empty headline is rejected with a field error; nothing saved", /Enter a headline/.test(await text('[data-testid="plus-inquiry-form"]')) && one(`select headline from plus_inquiry_forms where organization_id='${ORG_A}'`) === "S7C questions about rides");
  await go("/operations/settings/plus");
  await click('[data-testid="plus-inquiry-form-disable"]');
  await waitFor(async () => /turned off/.test(await text('[data-testid="plus-inquiry-form-message"]')), 10000);
  check("F7 Turn off -> disabled", one(`select status from plus_inquiry_forms where organization_id='${ORG_A}'`) === "disabled");
  await go("/operations/settings/plus");
  await click('[data-testid="plus-inquiry-form-publish"]');
  await waitFor(async () => (await text('[data-testid="plus-inquiry-form-message"]')).length > 0, 10000);
  const pubMsg = await text('[data-testid="plus-inquiry-form-message"]');
  check("F8 Publish WITHOUT Nemryn's activation is refused with a plain explanation; stays disabled", /haven't been turned on/.test(pubMsg) && one(`select status from plus_inquiry_forms where organization_id='${ORG_A}'`) === "disabled", pubMsg);
  check("F9 the allowlist and server switch were never changed from Settings", one(`select count(*) from plus_inquiry_public_access where organization_id='${ORG_A}'`) === "0");
  const r = await fetch(`${APP}/api/plus-inquiries/${KEY_A}`);
  check("F10 public config stays unavailable (404) with the switch off", r.status === 404, r.status);
  sql(`insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG_A}', 'S7-C local synthetic e2e (publish)', '${U.a1}')`);
  await go("/operations/settings/plus");
  await click('[data-testid="plus-inquiry-form-publish"]');
  await waitFor(async () => /Published/.test(await text('[data-testid="plus-inquiry-form-message"]')), 10000);
  const st2 = await text('[data-testid="plus-inquiry-form"]');
  check("F11 with the (local) activation: Publish succeeds; servers-switch notice still shown", one(`select status from plus_inquiry_forms where organization_id='${ORG_A}'`) === "published" && /Nemryn servers: not accepting/.test(st2), st2);
  setPlus(ORG_A, "expired");
  await go("/operations/settings/plus");
  check("F12 read_only workspace: the form can be viewed but not changed", (await ev(`document.querySelector('[data-testid="plus-inquiry-form-headline"]').disabled`)) && !(await has('[data-testid="plus-inquiry-form-save"]')));
  setPlus(ORG_A, "active");
  await go("/operations/settings/plus", 820, 1100);
  check("F13 settings at 820px: no horizontal page scroll", await noHScroll());
  await s.setViewport(1440, 1200);
  check("Z1 Core unaffected throughout: no Request / Passenger / Trip / notification", coreCounts() === coreBefore, `${coreBefore} -> ${coreCounts()}`);
} catch (e) {
  fails++;
  console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  try {
    cleanup();
    sql(`delete from organization_service_offerings where organization_id = '${ORG_A}';${prevOfferings ? ` insert into organization_service_offerings (organization_id, service_type) select '${ORG_A}', unnest(string_to_array('${prevOfferings}', ','));` : ""}`);
    setGrant("none");
  } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
