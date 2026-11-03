// NP-CORE-PLUS-REQUEST-02C -- "Add contact" from Core Request Details (ZD-294..ZD-301): isolated browser regression.
//
//   npm run test:e2e:request-contact            (see README.md; ISOLATED NemrynS1Iso + `next start -p 3100`, FICTIONAL data)
//
// Covers the role matrix (Organization Admin, Dispatcher with a write / read grant, an organization without Plus), the
// synthetic-only activation gate (hidden when disabled, refused by the database when called directly), duplicates
// (link an active match, explicit "Create a separate contact", archived matches not linkable, no merge), concurrent
// browser submissions, an existing attribution, invalid data, Core integrity, axe-core + keyboard checks and the
// review screenshots at 1440 / 1024 / 768.
//
// Shared-stack etiquette: the suite does NOT reset the database. It refuses to start unless the fictional seed is
// present and no request-contact enablement exists; every fixture carries a per-run stamp; the finally block removes
// exactly what the run added (the enablement through the approved Platform Admin RPC) and FAILS the run unless every
// watched table is back to its starting row count.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_B = "10000000-0000-0000-0000-0000000000b1";
const PAX_A = "40000000-0000-0000-0000-0000000000a1"; // seed: Org A's fictional passenger
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2", b1: "20000000-0000-0000-0000-0000000000b1", pa: "20000000-0000-0000-0000-0000000000d1" };
const MIGRATION = "20261102100000";
const STAMP = Date.now().toString(36);
const WIDTHS = [[1440, 1000], [1024, 900], [768, 1024]];
const SHOTS = process.argv.includes("--no-screenshots") ? null : artifactDir("request-contact");

// --- reporting ------------------------------------------------------------------------------------------------------
let fails = 0;
const notes = [];
const findings = [];
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
const note = (n) => { notes.push(n); console.log(`NOTE — ${n}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);

// --- database helpers (isolated container only; values are fictional fixtures) ----------------------------------------
const one = (q) => sql(q).split("\n").filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|SET)$/.test(l))[0]?.trim() ?? "";
const lit = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
/** Runs `stmt` as a signed-in user (role authenticated + JWT subject), the way PostgREST would. Returns ok / error text. */
function asUser(uid, stmt) {
  const input = `\\set VERBOSITY verbose\nbegin; set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true); ${stmt}; commit;`;
  try {
    const out = execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }).toString();
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, err: `${e.stderr ?? ""}`.trim() };
  }
}
const setEnabled = (on) => asUser(U.pa, `select (public.platform_set_plus_request_contact_enablement('${ORG_A}', ${on}, ${on ? "'synthetic'" : "null"}, 'NP-CORE-PLUS-REQUEST-02C e2e (isolated, fictional)')).changed`);
const directCreate = (uid, org, rid, name) =>
  asUser(uid, `select (public.plus_create_contact_for_request('${org}', '${rid}', ${lit(name)}, '(404) 555-0199', null, 'individual', 'phone', false, null, false)).outcome`);

const WATCHED = [
  "organization_modules", "membership_module_grants", "plus_request_contact_enablements", "transportation_requests", "passengers", "trips",
  "billing_invoices", "billing_payments", "plus_contacts", "plus_request_attributions", "plus_activities", "plus_opportunities",
  "plus_communication_consents", "plus_tasks", "plus_quotes", "audit_events",
];
const counts = () => Object.fromEntries(sql(`select ${WATCHED.map((t) => `'${t}=' || (select count(*) from public.${t})`).join(" || ',' || ")}`).split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
const CORE = ["transportation_requests", "passengers", "trips", "trip_assignments", "trip_events", "trip_exceptions", "trip_notes", "billing_invoices", "billing_invoice_lines", "billing_invoice_trips", "billing_payments", "billing_invoice_counters"];
/** Byte-level fingerprint of every Core row (ctid catches no-op UPDATEs as well). */
const coreFingerprint = () => Object.fromEntries(CORE.map((t) => [t, one(`select md5(coalesce(string_agg(ctid::text || (x.*)::text, ',' order by ctid::text), '')) from public.${t} x`)]));

// --- guards ---------------------------------------------------------------------------------------------------------
assertFictionalSeed();
if (one(`select count(*) from supabase_migrations.schema_migrations where version = '${MIGRATION}'`) !== "1") throw new Error(`refusing to run: migration ${MIGRATION} is not applied in ${DB}`);
if (one(`select count(*) from public.plus_request_contact_enablements`) !== "0") throw new Error("refusing to run: a request-contact enablement already exists (another run or workstream may be using the stack)");
/** Another local project can grab the same port; make sure the app under test is still this Nemryn build. */
async function assertNemrynApp() {
  const res = await fetch(`${APP}/sign-in`).catch(() => null);
  const body = res ? await res.text() : "";
  if (!res?.ok || !/Nemryn/.test(body)) throw new Error(`the app at ${APP} is not answering as Nemryn (another local server may own the port)`);
}
await assertNemrynApp();
const RUN_START = one("select now()::text");
const BASELINE = counts();
const MODULES = one(`select coalesce(json_agg(m), '[]') from public.organization_modules m where organization_id in ('${ORG_A}', '${ORG_B}')`);
console.log(`request-contact e2e -- app ${APP}, database ${DB}, stamp ${STAMP}, start ${RUN_START}`);
console.log(`baseline ${JSON.stringify(BASELINE)}`);

// --- fixtures (fictional, stamped) ----------------------------------------------------------------------------------
const NAME = (label) => `RC02C ${label} ${STAMP} Fictional`;
const MAIL = (label) => `${label.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${STAMP}@example.test`;
const requestIds = [];
function request(label, { phone = "(404) 555-0150", email = MAIL(label), rel = "self", passenger = false, org = ORG_A } = {}) {
  const id = one(`insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, return_trip_needed, state, source, service_type, passenger_id, requested_passenger_name)
    values ('${org}', ${lit(NAME(label))}, '${rel}', ${lit(phone)}, ${lit(email)}, 'RC02C fictional pickup', 'RC02C fictional clinic', 'no', 'pending', 'phone', 'dialysis',
    ${passenger ? `'${PAX_A}'` : "null"}, ${passenger ? lit(`RC02C Passenger Zed ${STAMP} Fictional`) : "null"}) returning id`);
  requestIds.push(id);
  return id;
}
const fixtureContacts = [];
function contact(name, email, status = "active", phone = null) {
  const id = one(`insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by, status)
    values ('${ORG_A}', ${lit(name)}, ${lit(phone)}, ${lit(email)}, 'individual', '${U.a1}', '${status}') returning id`);
  fixtureContacts.push(id);
  return id;
}
const contactRow = (id) => one(`select display_name || '|' || coalesce(phone, '') || '|' || coalesce(email, '') || '|' || status || '|' || updated_at || '|' || ctid from public.plus_contacts where id = '${id}'`);
const attributionOf = (rid) => one(`select coalesce(contact_id::text, '') from public.plus_request_attributions where request_id = '${rid}'`);
const contactsNamed = (name) => one(`select count(*) from public.plus_contacts where organization_id = '${ORG_A}' and display_name = ${lit(name)}`);

// --- browser helpers ------------------------------------------------------------------------------------------------
let s; // the session the helpers act on
const actAs = (session) => (s = session);
const ev = (x) => s.evaluate(x);
const q = (sel) => JSON.stringify(sel);
const has = (sel) => ev(`!!document.querySelector(${q(sel)})`);
const text = (sel) => ev(`document.querySelector(${q(sel)})?.innerText?.trim() ?? null`);
const val = (sel) => ev(`document.querySelector(${q(sel)})?.value ?? null`);
const click = (sel) => ev(`(function(){const el=document.querySelector(${q(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const setVal = (sel, v) => ev(`(function(){const el=document.querySelector(${q(sel)}); if(!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(v)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true;})()`);
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
const waitSel = (sel, ms) => waitFor(() => has(sel), ms);
const overflow = () => ev("document.documentElement.scrollWidth - document.documentElement.clientWidth");
const T = {
  panel: '[data-testid="request-growth-panel"]', unlinked: '[data-testid="request-growth-unlinked"]', add: '[data-testid="growth-add-contact"]',
  track: '[data-testid="growth-track"]', correct: '[data-testid="growth-correct"]', editor: '[data-testid="growth-add-contact-editor"]',
  form: '[data-testid="growth-add-contact-form"]', name: '[data-testid="growth-add-name"]', phone: '[data-testid="growth-add-phone"]',
  email: '[data-testid="growth-add-email"]', kind: '[data-testid="growth-add-kind"]', channel: '[data-testid="growth-add-channel"]',
  owner: '[data-testid="growth-add-owner"]', dnc: '[data-testid="growth-add-dnc"]', save: '[data-testid="growth-add-save"]',
  confirm: '[data-testid="growth-add-confirm-duplicate"]', dups: '[data-testid="growth-add-duplicates"]', dup: '[data-testid="growth-add-duplicate"]',
  linkMatch: '[data-testid="growth-add-link-match"]', error: '[data-testid="growth-add-error"]', notice: '[data-testid="growth-add-notice"]',
  status: '[data-testid="growth-status"]', dupMessage: '[data-testid="growth-add-duplicates-message"]',
  requesterNotice: '[data-testid="growth-add-requester-notice"]', openInPlus: '[data-testid="request-growth-open-in-plus"]', contact: '[data-testid="request-growth-contact"]',
};
/**
 * Opens Request Details. The local stack's API gateway occasionally answers 502 ("upstream prematurely closed
 * connection") for any PostgREST call; when that hits the Growth read, the panel shows its released "couldn't be
 * loaded" state. Reload (at most twice) and record every retry as a NOTE so the report can count them.
 */
async function openRequest(rid) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await s.nav(`${APP}/operations/requests/${rid}`, 2000);
    await waitFor(async () => (await ev("document.readyState")) === "complete", 10000);
    await waitFor(async () => (await has(T.panel)) || (await ev("!!document.querySelector('main h1, main h2')")), 15000);
    await sleep(500);
    if (!(await has('[data-testid="request-growth-error"]'))) return;
    note(`RETRY Growth panel showed "couldn't be loaded" (local gateway 502) on request ${rid}; reloading`);
  }
}
/** Opens the Add contact form where it is expected. The offer check fails closed, so a gateway 502 hides it: reload. */
async function openForm(rid) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await openRequest(rid);
    if (await click(T.add)) return waitSel(T.form, 10000);
    note(`RETRY Add contact not offered on request ${rid} (offer check fails closed on a local gateway 502); reloading`);
  }
  return false;
}
/** Waits until the add-contact submission has settled into one of its end states. */
const settled = () => waitFor(async () => (await has(T.openInPlus)) || (await has(T.error)) || (await has(T.dups)) || (await ev(`!!document.querySelector('${T.name}[aria-invalid="true"]')`)) || (await has(T.notice)), 20000);
const snapshotForm = async () => ({ name: await val(T.name), phone: await val(T.phone), email: await val(T.email), kind: await val(T.kind), channel: await val(T.channel), owner: await val(T.owner), dnc: await ev(`document.querySelector(${q(T.dnc)})?.checked ?? null`) });
const key = async (k, code, keyCode, shift = false) => {
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 });
  await sleep(150);
};
const focused = () => ev(`(function(){const a=document.activeElement; if(!a||a===document.body) return 'BODY'; return a.getAttribute('data-testid') || (a.tagName + ':' + (a.textContent||'').trim().slice(0, 30));})()`);

async function axe(label) {
  await injectAxe(s);
  const run = (include) => ev(`axe.run(${include ? `{ include: [${q(include)}] }` : "document"}, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, target: v.nodes[0]?.target?.join(' '), html: v.nodes[0]?.html?.slice(0, 160), summary: (v.nodes[0]?.failureSummary || '').slice(0, 240) })))`);
  const panel = await run(T.panel);
  const page = await run(null);
  for (const v of panel) findings.push({ state: label, scope: "growth panel", ...v });
  for (const v of page.filter((p) => !panel.some((x) => x.id === p.id))) findings.push({ state: label, scope: "rest of page (informational)", ...v });
  const serious = panel.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: Growth panel has 0 serious / critical violations${panel.length ? ` (${panel.length} lower-impact: ${panel.map((v) => `${v.id}/${v.impact}`).join(", ")})` : ""}`, serious.length === 0, JSON.stringify(serious));
  if (page.length) note(`axe ${label}, whole page (informational): ${page.map((v) => `${v.id}/${v.impact}x${v.nodes}`).join(", ")}`);
}

const formHeights = {};
/**
 * Full-page AND Growth-panel screenshots. The app shell scrolls inside its content area (not the window), so the viewport
 * is grown until neither the window nor any inner scroll container has hidden content -- nothing is cut off.
 */
const hiddenHeight = () => ev(`Math.max(0, document.documentElement.scrollHeight - window.innerHeight, ...[...document.querySelectorAll('*')]
  .filter(e => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1; })
  .map(e => e.scrollHeight - e.clientHeight))`);
async function shoot(name, width, baseHeight) {
  if (!SHOTS) return;
  await sleep(300);
  let height = baseHeight;
  for (let i = 0; i < 4; i++) {
    const extra = await hiddenHeight();
    if (extra <= 0) break;
    height += extra;
    await s.setViewport(width, height);
    await sleep(500);
  }
  await s.screenshot(path.join(SHOTS, `${name}-${width}-page.png`));
  const r = await ev(`(function(){const p=document.querySelector(${q(T.panel)}); if(!p) return null; const b=p.getBoundingClientRect(); return {x:b.x + window.scrollX, y:b.y + window.scrollY, w:b.width, h:b.height};})()`);
  if (r) {
    const { data } = await s.cdp("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.w + 24, height: r.h + 24, scale: 1 } });
    writeFileSync(path.join(SHOTS, `${name}-${width}-panel.png`), Buffer.from(data, "base64"));
  }
  await s.setViewport(width, baseHeight);
  await sleep(300);
}

// ======================================================================================================================
const sessions = [];
const session = async (label, email) => { const x = await newChromeSession(`-rc-${label}`); sessions.push(x); await x.setViewport(1440, 1000); await signIn(x, email, SEED_PASSWORD); return x; };
let core0;
try {
  section("fixtures (fictional, stamped)");
  sql(`delete from public.organization_modules where organization_id = '${ORG_A}'; insert into public.organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'NP-CORE-PLUS-REQUEST-02C e2e')`);
  check("Org B has no Plus module (scenario 4 precondition)", one(`select count(*) from public.organization_modules where organization_id = '${ORG_B}' and module = 'plus'`) === "0");
  const R = {
    admin: request("Ann Requester", { phone: "(404) 555-0151", rel: "family", passenger: true }),
    disabled: request("Disabled Dee", { phone: "(404) 555-0152", rel: "self" }),
    revoked: request("Revoked Ray", { phone: "(404) 555-0153", rel: "self" }),
    bad: request("Bad Phone", { phone: "call after 5pm", email: null, rel: "facility_coordinator" }),
    dupLink: request("Dup Pat", { phone: "(404) 555-0154", rel: "self" }),
    dupSep: request("Sep Lee", { phone: "(404) 555-0155", rel: "caregiver" }),
    dupVis: request("Vis Dup Kim", { phone: "(404) 555-0156", rel: "self" }),
    linked: request("Linked Lou", { phone: "(404) 555-0157", rel: "self" }),
    stale: request("Stale Sam", { phone: "(404) 555-0158", rel: "other" }),
    conc1: request("Race One", { phone: "(404) 555-0159", rel: "self", passenger: true }),
    conc2: request("Race Two", { phone: "(404) 555-0160", rel: "self" }),
    kbd: request("Keyboard Kai", { phone: "(404) 555-0161", rel: "self" }),
    vis: request("Visual Val", { phone: "(404) 555-0162", rel: "family", passenger: true }),
    vs1440: request("Visual OK 1440", { phone: "(404) 555-0163" }),
    vs1024: request("Visual OK 1024", { phone: "(404) 555-0164" }),
    vs768: request("Visual OK 768", { phone: "(404) 555-0165" }),
    disp: request("Dispatcher Dot", { phone: "(404) 555-0166", rel: "caregiver" }),
    ro: request("Read Only Rae", { phone: "(404) 555-0167", rel: "other" }),
    orgB: request("Org B Bea", { phone: "(404) 555-0168", rel: "self", org: ORG_B }),
  };
  const K = {
    dup: contact(NAME("Dup Pat"), MAIL("Dup Pat")),
    arch: contact(NAME("Archived Pat"), MAIL("Dup Pat"), "archived"),
    sep: contact(NAME("Sep Lee"), MAIL("Sep Lee")),
    vis: contact(NAME("Vis Dup Kim"), MAIL("Vis Dup Kim")),
    pre: contact(NAME("Existing Pre"), MAIL("Existing Pre")),
  };
  check("fixture: Linked Lou is linked to an existing contact (plus_link_request as the Org A Admin)", asUser(U.a1, `select (public.plus_link_request('${ORG_A}', '${R.linked}', '${K.pre}', null)).request_id`).ok && attributionOf(R.linked) === K.pre);
  const kRows0 = Object.fromEntries(Object.entries(K).map(([k, id]) => [k, contactRow(id)]));
  core0 = coreFingerprint();

  // ---------------------------------------------------------------------------------------------------------------
  section("5. feature DISABLED (default): hidden, and refused by the database when called directly");
  const admin = await session("admin", "org-a-admin@example.test");
  actAs(admin);
  await openRequest(R.disabled);
  check("5 Org Admin sees the Growth panel (Plus active)", await has(T.panel));
  check("5 disabled: no Add contact; Link existing contact is still offered", !(await has(T.add)) && (await text(T.track)) === "Link existing contact");
  check("5 disabled: no notice about the hidden feature", !(await ev(`/isn't available|not enabled|synthetic|allowlist/i.test(document.querySelector(${q(T.panel)}).innerText)`)));
  let r = directCreate(U.a1, ORG_A, R.disabled, NAME("Direct Disabled"));
  check("5 direct RPC by an Org Admin while disabled: refused with ZW004 request_contact_not_enabled; nothing written",
    !r.ok && /ZW004/.test(r.err) && /request_contact_not_enabled/.test(r.err) && contactsNamed(NAME("Direct Disabled")) === "0" && attributionOf(R.disabled) === "", r.err.split("\n")[0]);
  await click(T.track);
  check("5 disabled: Link existing contact still opens its editor", await waitSel('[data-testid="growth-link-editor"]', 5000));

  section("enable Org A (synthetic) through the Platform Admin RPC");
  r = setEnabled(true);
  check("Platform Admin enables Org A (data class synthetic)", r.ok && /\bt\b/.test(r.out), r.err ?? r.out);

  // ---------------------------------------------------------------------------------------------------------------
  section("1. Organization Admin with Plus write: prefill, edit, save, Open in Plus");
  await openRequest(R.admin);
  check("1 enabled + unlinked: Add contact (primary) and Link existing contact (secondary)", (await has(T.add)) && (await has(T.track)) && (await text(T.add)) === "Add contact");
  await click(T.add);
  await waitSel(T.form);
  let f = await snapshotForm();
  check("1 prefill = requester name, phone, email; family -> family_caregiver; channel phone; no owner; DNC off",
    f.name === NAME("Ann Requester") && f.phone === "(404) 555-0151" && f.email === MAIL("Ann Requester") && f.kind === "family_caregiver" && f.channel === "phone" && f.owner === "" && f.dnc === false, JSON.stringify(f));
  check("1 the passenger is never prefilled or shown in the form", !(await ev(`(function(){const e=document.querySelector(${q(T.editor)}); return /Zed/.test(e.innerText + [...e.querySelectorAll('input,select')].map(i => i.value).join(' '));})()`)));
  check("1 requester-not-passenger notice is exact", (await text(T.requesterNotice)) === "Requester — the person who contacted you. This is not necessarily the passenger.");
  check("1 no consent field in the form", !(await ev(`!!document.querySelector('${T.form} [name*="consent" i]')`)));
  const ownerValue = await ev(`[...document.querySelector(${q(T.owner)}).options].map(o => o.value).find(v => v) ?? ''`);
  await setVal(T.name, NAME("Ann Reviewed"));
  await setVal(T.email, MAIL("Ann Reviewed"));
  await setVal(T.channel, "email");
  await setVal(T.kind, "individual");
  await setVal(T.owner, ownerValue);
  f = await snapshotForm();
  check("1 every field is editable (name, email, kind, channel, owner changed)", f.name === NAME("Ann Reviewed") && f.email === MAIL("Ann Reviewed") && f.kind === "individual" && f.channel === "email" && f.owner === ownerValue && ownerValue !== "", JSON.stringify(f));
  await ev(`document.querySelector(${q(T.status)}).__rcMarker = 'before-save'; true`);
  await click(T.save);
  await settled();
  check("1 success: the form closes and the panel shows the linked contact + Open in Plus", (await has(T.openInPlus)) && !(await has(T.form)));
  check("1 success notice is shown inside the status region that existed BEFORE the save (same node, role=status)",
    (await waitSel(T.notice, 5000)) && (await ev(`(function(){const r=document.querySelector(${q(T.status)}); return r?.__rcMarker === 'before-save' && r.getAttribute('role') === 'status' && r.contains(document.querySelector(${q(T.notice)}));})()`)));
  check("1 A3: focus moves to the new contact link (not <body>)", await waitFor(async () => (await focused()) === "request-growth-contact", 3000), await focused());
  const kAdmin = attributionOf(R.admin);
  check("1 exactly one contact with the reviewed name and one attribution to it", contactsNamed(NAME("Ann Reviewed")) === "1" && contactsNamed(NAME("Ann Requester")) === "0" && kAdmin !== "" && one(`select count(*) from public.plus_request_attributions where request_id = '${R.admin}'`) === "1");
  check("1 stored values are the staff-reviewed ones (phone kept, owner = the admin, DNC off)",
    one(`select display_name || '|' || phone || '|' || email || '|' || contact_kind || '|' || preferred_channel || '|' || coalesce(owner_user_id::text, '') || '|' || do_not_contact from public.plus_contacts where id = '${kAdmin}'`)
      === `${NAME("Ann Reviewed")}|(404) 555-0151|${MAIL("Ann Reviewed")}|individual|email|${U.a1}|false`);
  check("1 provenance audit holds the request id only", one(`select after_data::text from public.audit_events where action = 'plus_contact_created_from_request' and entity_id = '${kAdmin}'`) === `{"request_id": "${R.admin}"}`);
  check("1 linked state: Add contact gone, Correct link offered", !(await has(T.add)) && (await has(T.correct)));
  await axe("successful linked state");
  check("1 Open in Plus points at the new contact", (await ev(`document.querySelector(${q(T.openInPlus)}).getAttribute('href')`)) === `/operations/growth/contacts/${kAdmin}`);
  await click(T.openInPlus);
  check("1 Open in Plus opens that contact in Growth", (await waitFor(async () => (await s.currentUrl()) === `/operations/growth/contacts/${kAdmin}`, 15000)) && (await waitFor(() => ev(`document.body.innerText.includes(${q(NAME("Ann Reviewed"))})`), 10000)));

  section("5b. disabled while a form is open: the server refuses the submission");
  await openForm(R.revoked);
  r = setEnabled(false);
  check("Platform Admin disables Org A (row removed)", r.ok && one(`select count(*) from public.plus_request_contact_enablements`) === "0");
  await click(T.save);
  await settled();
  check("5b submission refused with the non-disclosing message; nothing written",
    (await text(T.error)) === "Adding a contact from a request isn't available for this organization. You can still link an existing contact." && contactsNamed(NAME("Revoked Ray")) === "0" && attributionOf(R.revoked) === "");
  check("5b typed values are kept after the refusal", (await val(T.name)) === NAME("Revoked Ray"));
  check("5b A2: focus moves to the server error message (announced once, on focus; no live region)",
    (await focused()) === "growth-add-error" && (await ev(`document.querySelector(${q(T.error)}).closest('[role=alert],[role=status],[aria-live]') === null`)), await focused());
  r = setEnabled(true);
  check("Platform Admin re-enables Org A", r.ok);

  // ---------------------------------------------------------------------------------------------------------------
  section("9. invalid data: field errors, values kept, nothing written");
  await openForm(R.bad);
  f = await snapshotForm();
  check("9 the Core phone is prefilled as given; facility_coordinator -> facility_staff; no email -> channel phone", f.phone === "call after 5pm" && f.kind === "facility_staff" && f.email === "" && f.channel === "phone", JSON.stringify(f));
  await click(T.save);
  await settled();
  const phoneErr = await ev(`(function(){const i=document.querySelector(${q(T.phone)}); const ids=(i.getAttribute('aria-describedby')||'').split(' ').filter(Boolean); return { invalid: i.getAttribute('aria-invalid'), described: ids.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' | ') };})()`);
  check("9 invalid phone: aria-invalid + an error message tied to the field (aria-describedby)", phoneErr.invalid === "true" && phoneErr.described.length > 0, JSON.stringify(phoneErr));
  check("9 typed values are preserved after the refusal", (await val(T.name)) === NAME("Bad Phone") && (await val(T.phone)) === "call after 5pm");
  check("9 A2: focus moves to the first invalid field (Phone)", (await focused()) === "growth-add-phone", await focused());
  await axe("validation errors");
  await setVal(T.name, "");
  await setVal(T.phone, "");
  await click(T.save);
  await settled();
  await sleep(500);
  const nameErr = await ev(`(function(){const i=document.querySelector(${q(T.name)}); return i.getAttribute('aria-invalid');})()`);
  const described = (sel) => ev(`(function(){const i=document.querySelector(${q(sel)}); return (i.getAttribute('aria-invalid') || '') + ':' + (i.getAttribute('aria-describedby')||'').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent?.trim()).join(' | ');})()`);
  const phoneDesc = await described(T.phone);
  const emailDesc = await described(T.email);
  const missing = /^true:A phone number or an email address is required\.$/;
  check("9 empty name and no phone / email: Name invalid; Phone AND Email invalid and described by 'phone or email required'", nameErr === "true" && missing.test(phoneDesc) && missing.test(emailDesc), JSON.stringify({ nameErr, phoneDesc, emailDesc }));
  check("9 A2: focus moves to the first invalid field (Name)", (await focused()) === "growth-add-name", await focused());
  check("9 nothing written for the refused submissions", attributionOf(R.bad) === "" && one(`select count(*) from public.plus_contacts where organization_id = '${ORG_A}' and created_at >= '${RUN_START}' and display_name in ('', ${lit(NAME("Bad Phone"))})`) === "0");

  // ---------------------------------------------------------------------------------------------------------------
  section("6. duplicates: list, link an active match, archived not linkable, explicit separate contact, no merge");
  await openForm(R.dupLink);
  await click(T.save);
  await settled();
  const dupList = await ev(`[...document.querySelectorAll(${q(T.dup)})].map(li => ({ text: li.innerText, linkable: !!li.querySelector(${q(T.linkMatch)}) }))`);
  check("6 candidate matches are shown; nothing created", (await has(T.dups)) && dupList.length >= 2 && contactsNamed(NAME("Dup Pat")) === "1", JSON.stringify(dupList));
  check("6 focus moves to the duplicate explanation (read once, on focus)", (await focused()) === "growth-add-duplicates-message", await focused());
  check("6 the active match offers Link this contact", dupList.some((d) => d.text.includes(NAME("Dup Pat")) && d.linkable));
  check("6 the archived match is labelled and cannot be linked", dupList.some((d) => d.text.includes(NAME("Archived Pat")) && /archived/i.test(d.text) && !d.linkable));
  check("6 duplicates: the plain save is replaced by the explicit 'Create a separate contact'", !(await has(T.save)) && (await text(T.confirm)) === "Create a separate contact");
  await axe("duplicate warning");
  await click(T.linkMatch);
  await waitFor(() => attributionOf(R.dupLink) !== "", 15000);
  check("6 Link this contact links the EXISTING active contact; no contact created", attributionOf(R.dupLink) === K.dup && contactsNamed(NAME("Dup Pat")) === "1");
  check("6 the panel shows the linked existing contact", await waitFor(async () => (await text(T.contact)) === NAME("Dup Pat"), 10000));
  check("6 after Link this contact, focus moves to the linked contact", await waitFor(async () => (await focused()) === "request-growth-contact", 3000), await focused());

  await openForm(R.dupSep);
  await click(T.save);
  await settled();
  check("6 second request: duplicate warning first, nothing created", (await has(T.dups)) && contactsNamed(NAME("Sep Lee")) === "1");
  await click(T.confirm);
  // the duplicate box stays on screen while this submission runs, so wait for its own end state
  await waitFor(async () => (await has(T.openInPlus)) || (await has(T.error)), 20000);
  const kSep = attributionOf(R.dupSep);
  check("6 Create a separate contact (explicit) creates a NEW contact and links it", kSep !== "" && kSep !== K.sep && contactsNamed(NAME("Sep Lee")) === "2" && (await has(T.openInPlus)));
  check("6 no merge: every pre-existing contact is byte-identical (fields, status, updated_at, ctid)", Object.entries(K).every(([k, id]) => contactRow(id) === kRows0[k]));

  // ---------------------------------------------------------------------------------------------------------------
  section("8. existing attribution: linked state shown, no new contact (incl. a stale open form)");
  await openRequest(R.linked);
  check("8 already-linked request: contact shown, no Add contact, Correct link offered", (await text(T.contact)) === NAME("Existing Pre") && !(await has(T.add)) && (await has(T.correct)));
  const admin2 = await session("admin2", "org-a-admin@example.test");
  actAs(admin2);
  check("8 stale form: the second session opened the Add contact form", await openForm(R.stale));
  check("8 stale form: another person links the request while this form is open", asUser(U.a1, `select (public.plus_link_request('${ORG_A}', '${R.stale}', '${K.pre}', null)).request_id`).ok);
  await click(T.save);
  await settled();
  check("8 stale submission: 'already linked, no contact was added' and the current link is shown",
    (await text(T.notice)) === "This request is already linked in Growth, so no contact was added. Its current link is shown." && (await waitFor(async () => (await text(T.contact)) === NAME("Existing Pre"), 10000)));
  check("8 stale submission created no contact and kept the existing attribution", contactsNamed(NAME("Stale Sam")) === "0" && attributionOf(R.stale) === K.pre);

  // ---------------------------------------------------------------------------------------------------------------
  section("7. concurrent browser submissions (two signed-in sessions, same request)");
  for (const [label, rid, name] of [["round 1", R.conc1, NAME("Race One")], ["round 2", R.conc2, NAME("Race Two")]]) {
    actAs(admin); const openA = await openForm(rid);
    actAs(admin2); const openB = await openForm(rid);
    check(`7 ${label}: both sessions have the Add contact form open`, openA && openB);
    const clickSave = `(function(){const b=document.querySelector(${q(T.save)}); if(!b) return false; b.click(); return true;})()`;
    const both = await Promise.all([admin.evaluate(clickSave), admin2.evaluate(clickSave)]);
    const outcome = {};
    for (const [who, x] of [["A", admin], ["B", admin2]]) {
      actAs(x);
      await settled();
      await sleep(800);
      outcome[who] = (await has(T.error)) ? `error: ${await text(T.error)}` : (await has(T.notice)) ? `notice: ${await text(T.notice)}` : (await has(T.openInPlus)) ? "linked (no notice)"
        : `UNSETTLED (page shows: ${(await ev("(document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 160)")) ?? ""})`;
    }
    note(`7 ${label}: session A -> ${outcome.A}; session B -> ${outcome.B}`);
    check(`7 ${label}: both submissions were sent`, both[0] && both[1]);
    check(`7 ${label}: exactly one attribution and exactly one new contact (no orphan from the losing submission)`,
      one(`select count(*) from public.plus_request_attributions where request_id = '${rid}'`) === "1" && contactsNamed(name) === "1" && one(`select display_name from public.plus_contacts where id = '${attributionOf(rid)}'`) === name);
    const okMsgs = [/^notice: Contact added and linked/, /^notice: This request is already linked in Growth, so no contact was added/, /^error: This request was linked in Growth by someone else just now, so no contact was added/];
    check(`7 ${label}: each session shows a success or a clear conflict message`, Object.values(outcome).every((o) => okMsgs.some((m) => m.test(o))), JSON.stringify(outcome));
    check(`7 ${label}: exactly one session reports creating the contact`, Object.values(outcome).filter((o) => /Contact added and linked/.test(o)).length === 1, JSON.stringify(outcome));
  }
  await admin2.close();
  sessions.splice(sessions.indexOf(admin2), 1);

  // ---------------------------------------------------------------------------------------------------------------
  section("accessibility: axe on the unlinked panel and the open form; keyboard-only walkthrough");
  actAs(admin);
  await admin.setViewport(1440, 1000);
  await openRequest(R.vis);
  await axe("unlinked Growth panel");
  await click(T.add);
  await waitSel(T.form);
  await axe("Add contact form");

  await openRequest(R.kbd);
  await ev(`document.querySelector(${q(T.add)}).focus()`);
  check("KEY Add contact is reachable by focus", (await focused()) === "growth-add-contact");
  await key("Enter", "Enter", 13);
  check("KEY Enter opens the inline form and focus moves to Name", (await waitSel(T.form, 5000)) && (await focused()) === "growth-add-name");
  const order = [];
  for (let i = 0; i < 8; i++) { await key("Tab", "Tab", 9); order.push(await focused()); }
  const expectedOrder = ["growth-add-phone", "growth-add-email", "growth-add-kind", "growth-add-channel", "growth-add-owner", "growth-add-dnc", "growth-add-save", "BUTTON:Cancel"];
  check("KEY Tab order follows the visual order: Phone, Email, Contact type, Preferred channel, Owner, Do not contact, Add and link contact, Cancel", JSON.stringify(order) === JSON.stringify(expectedOrder), JSON.stringify(order));
  await key("Tab", "Tab", 9, true);
  check("KEY Shift+Tab moves back (Cancel -> Add and link contact)", (await focused()) === "growth-add-save");
  await key("Tab", "Tab", 9);
  await key("Enter", "Enter", 13);
  await sleep(500);
  const afterCancel = await focused();
  check("KEY Enter on Cancel closes the form", !(await has(T.form)));
  check("KEY A1: focus returns to Add contact after Cancel", afterCancel === "growth-add-contact", afterCancel);
  findings.push({ state: "keyboard", scope: "focus after Cancel", id: "focus-after-cancel", impact: afterCancel === "growth-add-contact" ? "ok" : "moderate", summary: afterCancel });
  if (afterCancel !== "growth-add-contact") await ev(`document.querySelector(${q(T.add)}).focus()`);
  await key("Enter", "Enter", 13); // reopen from the restored focus, keyboard only
  await waitSel(T.form, 5000);
  await key("Tab", "Tab", 9); // Name -> Phone
  await ev(`document.activeElement.select()`);
  await s.cdp("Input.insertText", { text: "call after 5pm" });
  await key("Enter", "Enter", 13); // implicit submission from the Phone field
  await settled();
  await sleep(500);
  const afterError = await focused();
  check("KEY Enter in a field submits; the phone error is shown", (await ev(`document.querySelector(${q(T.phone)})?.getAttribute('aria-invalid')`)) === "true");
  check("KEY A2: focus lands on the invalid Phone field after the refused submission", afterError === "growth-add-phone", afterError);
  findings.push({ state: "keyboard", scope: "focus after validation error", id: "focus-after-error", impact: afterError === "growth-add-phone" ? "ok" : "moderate", summary: afterError });
  // fix the phone where focus already is (keyboard only): select all, type the corrected number
  await ev(`document.activeElement.select()`);
  await s.cdp("Input.insertText", { text: "(404) 555-0161" });
  // pending + success, observed while the keyboard submission is in flight: the submit button and the status region
  await ev(`window.__busy = []; window.__live = []; window.__obs = new MutationObserver(() => { const b = document.querySelector(${q(T.save)}); if (b) window.__busy.push((b.disabled ? 'disabled' : '') + '/' + (b.getAttribute('aria-busy') || ''));
    const r = document.querySelector(${q(T.status)}); const t = (r?.textContent || '').trim(); if (window.__live.at(-1) !== t) window.__live.push(t); }); window.__obs.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    document.querySelector(${q(T.status)}).__rcMarker = 'kbd'; true`);
  await key("Enter", "Enter", 13);
  await settled();
  await sleep(800);
  const busySeen = await ev("(window.__busy || []).join(',')");
  check("KEY pending state: the submit button became disabled with aria-busy=true while saving", /disabled\/true/.test(busySeen), busySeen.slice(0, 200));
  await waitFor(async () => (await focused()) === "request-growth-contact", 3000);
  const afterSuccess = await focused();
  check("KEY keyboard submission succeeded (Open in Plus shown; status notice present)", (await has(T.openInPlus)) && (await has(T.notice)));
  check("KEY A3: focus moves to the linked contact after success", afterSuccess === "request-growth-contact", afterSuccess);
  findings.push({ state: "keyboard", scope: "focus after success", id: "focus-after-success", impact: afterSuccess === "request-growth-contact" ? "ok" : "minor", summary: afterSuccess });
  const live = await ev("window.__live || []");
  note(`SR status region text sequence during the keyboard save: ${JSON.stringify(live)}`);
  check("SR A4: the persistent status region announced the pending state ('Adding the contact…')", live.includes("Adding the contact…"), JSON.stringify(live));
  check("SR A4: the same status region (not a new node) then announced the success", live.at(-1) === "Contact added and linked in Growth. The request itself is unchanged." && (await ev(`document.querySelector(${q(T.status)})?.__rcMarker === 'kbd'`)), JSON.stringify(live));
  const liveRegions = await ev(`(function(){ return [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].filter(e => e.closest(${q(T.panel)})).map(e => (e.getAttribute('data-testid') || e.tagName) + '=' + e.textContent.trim()); })()`);
  check("SR A4: exactly one live region in the panel after success, and the success text appears once (no duplicate announcement)",
    liveRegions.length === 1 && liveRegions[0].startsWith("growth-status=") && (await ev(`document.querySelector(${q(T.panel)}).textContent.split('Contact added and linked in Growth').length - 1`)) === 1, JSON.stringify(liveRegions));

  // ---------------------------------------------------------------------------------------------------------------
  section("visual review: unlinked, form, validation, duplicates, success at 1440 / 1024 / 768");
  for (const [w, h] of WIDTHS) {
    await admin.setViewport(w, h);
    await openRequest(R.vis);
    check(`VIS ${w}: no horizontal overflow (unlinked)`, (await overflow()) <= 0, String(await overflow()));
    await shoot("01-unlinked", w, h);
    await click(T.add);
    await waitSel(T.form);
    formHeights[w] = await ev(`Math.round(document.querySelector(${q(T.editor)}).getBoundingClientRect().height) + 'px editor / ' + Math.round(document.querySelector(${q(T.panel)}).getBoundingClientRect().width) + 'px panel width'`);
    check(`VIS ${w}: no horizontal overflow (form)`, (await overflow()) <= 0, String(await overflow()));
    await shoot("02-form", w, h);
    await openForm(R.bad);
    await click(T.save);
    await settled();
    check(`VIS ${w}: no horizontal overflow (validation error)`, (await overflow()) <= 0);
    await shoot("03-validation", w, h);
    await openForm(R.dupVis);
    await click(T.save);
    await settled();
    check(`VIS ${w}: duplicate warning shown, no horizontal overflow`, (await has(T.dups)) && (await overflow()) <= 0);
    await shoot("04-duplicates", w, h);
    await openForm(R[`vs${w}`]);
    await click(T.save);
    await settled();
    check(`VIS ${w}: success with notice + Open in Plus, no horizontal overflow`, (await has(T.notice)) && (await has(T.openInPlus)) && (await overflow()) <= 0);
    await shoot("05-success", w, h);
  }
  note(`form height (editor) by width: ${JSON.stringify(formHeights)}`);
  check("VIS duplicate-warning visits created nothing", contactsNamed(NAME("Vis Dup Kim")) === "1" && attributionOf(R.dupVis) === "" && contactsNamed(NAME("Bad Phone")) === "0");

  // ---------------------------------------------------------------------------------------------------------------
  section("2. Dispatcher with a WRITE grant: same workflow");
  check("fixture: write grant for the Org A Dispatcher", sql(`insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    select '${ORG_A}', id, 'plus', 'write', '${U.a1}' from public.memberships where organization_id = '${ORG_A}' and user_id = '${U.a2}' returning access`).includes("write"));
  const disp = await session("dispatcher", "org-a-dispatcher@example.test");
  actAs(disp);
  await openRequest(R.disp);
  check("2 write grant: Add contact + Link existing contact offered", (await has(T.add)) && (await has(T.track)));
  await click(T.add);
  await waitSel(T.form);
  f = await snapshotForm();
  check("2 prefill = requester; caregiver -> family_caregiver", f.name === NAME("Dispatcher Dot") && f.phone === "(404) 555-0166" && f.kind === "family_caregiver", JSON.stringify(f));
  await setVal(T.name, NAME("Dispatcher Dot Edited"));
  await click(T.dnc);
  await click(T.save);
  await settled();
  const kDisp = attributionOf(R.disp);
  check("2 dispatcher save: one contact (edited name, DNC on) linked; Open in Plus shown",
    kDisp !== "" && contactsNamed(NAME("Dispatcher Dot Edited")) === "1" && one(`select do_not_contact::text || '|' || created_by from public.plus_contacts where id = '${kDisp}'`) === `true|${U.a2}` && (await has(T.openInPlus)));
  check("2 Do not contact recorded no consent row (no consent inferred)", one(`select count(*) from public.plus_communication_consents where organization_id = '${ORG_A}'`) === "0");
  await click(T.openInPlus);
  check("2 Open in Plus opens the contact", await waitFor(async () => (await s.currentUrl()) === `/operations/growth/contacts/${kDisp}`, 15000));

  // ---------------------------------------------------------------------------------------------------------------
  section("3. Dispatcher with a READ grant: sees Growth, cannot create or link");
  sql(`update public.membership_module_grants set access = 'read' where organization_id = '${ORG_A}' and granted_at >= '${RUN_START}'`);
  check("fixture: the Dispatcher's grant is now read", one(`select string_agg(access, ',') from public.membership_module_grants where organization_id = '${ORG_A}' and revoked_at is null and granted_at >= '${RUN_START}'`) === "read");
  for (const [w, h] of WIDTHS) {
    await disp.setViewport(w, h);
    await openRequest(R.ro);
    check(`3 ${w}: read grant sees the Growth panel (unlinked) with no Add contact / Link existing contact`, (await has(T.panel)) && (await has(T.unlinked)) && !(await has(T.add)) && !(await has(T.track)) && (await overflow()) <= 0);
    await shoot("06-read-only", w, h);
  }
  await disp.setViewport(1440, 1000);
  await openRequest(R.admin);
  check("3 read grant sees an existing link (contact + Open in Plus) but no Correct link", (await text(T.contact)) === NAME("Ann Reviewed") && (await has(T.openInPlus)) && !(await has(T.correct)));
  r = directCreate(U.a2, ORG_A, R.ro, NAME("Direct Read"));
  check("3 direct RPC with a read grant: refused (ZW001); nothing written", !r.ok && /ZW001/.test(r.err) && contactsNamed(NAME("Direct Read")) === "0" && attributionOf(R.ro) === "", r.err.split("\n")[0]);
  r = asUser(U.a2, `select (public.plus_link_request('${ORG_A}', '${R.ro}', '${K.vis}', null)).request_id`);
  check("3 direct link with a read grant: refused; nothing linked", !r.ok && attributionOf(R.ro) === "", r.err?.split("\n")[0]);

  // ---------------------------------------------------------------------------------------------------------------
  section("4. organization without Plus: no Growth panel");
  const orgB = await session("org-b", "org-b-admin@example.test");
  actAs(orgB);
  await openRequest(R.orgB);
  check("4 Org B Admin opens its own request: page renders", await ev(`document.body.innerText.includes(${q(NAME("Org B Bea"))})`));
  check("4 no Growth panel, heading or control for an organization without Plus", !(await has(T.panel)) && !(await has(T.add)) && !(await has(T.track)) && !(await ev(`[...document.querySelectorAll('h2,h3')].some(h => h.textContent.trim() === 'Growth')`)));
  await openRequest(R.vis);
  check("4 Org B Admin cannot see an Org A request (no Org A requester or Growth panel)", !(await has(T.panel)) && !(await ev(`document.body.innerText.includes(${q(NAME("Visual Val"))})`)));
  r = directCreate(U.b1, ORG_A, R.vis, NAME("Direct Cross Org"));
  check("4 direct RPC from Org B into Org A: refused; nothing written", !r.ok && contactsNamed(NAME("Direct Cross Org")) === "0", r.err.split("\n")[0]);
  r = directCreate(U.b1, ORG_B, R.orgB, NAME("Direct Org B"));
  check("4 direct RPC in Org B (no Plus): refused; nothing written", !r.ok && one(`select count(*) from public.plus_contacts where organization_id = '${ORG_B}'`) === "0", r.err.split("\n")[0]);

  // ---------------------------------------------------------------------------------------------------------------
  section("10. Core integrity and side effects");
  const core1 = coreFingerprint();
  const changed = CORE.filter((t) => core0[t] !== core1[t]);
  check("10 every Core row (requests incl. state / passenger, passengers, trips + children, invoices, lines, payments, counters) is byte-identical", changed.length === 0, changed.join(", "));
  check("10 no opportunity, consent, task or quote was created", ["plus_opportunities", "plus_communication_consents", "plus_tasks", "plus_quotes"].every((t) => one(`select count(*) from public.${t} where organization_id = '${ORG_A}'`) === "0"));
  const created = sql(`select id from public.plus_contacts where organization_id = '${ORG_A}' and created_at >= '${RUN_START}' and id not in (${fixtureContacts.map(lit).join(",")})`).split("\n").filter(Boolean);
  check("10 every contact created through the UI is linked to exactly one request (no orphans)", created.length > 0 && one(`select count(*) from public.plus_contacts k where k.id in (${created.map(lit).join(",")}) and (select count(*) from public.plus_request_attributions a where a.contact_id = k.id) <> 1`) === "0", `${created.length} created`);
  check("10 exactly 9 contacts were created through the UI (admin, separate, 2 races, keyboard, 3 visual, dispatcher)", created.length === 9, String(created.length));
  check("10 the provenance audit exists once per created contact and holds the request id only",
    one(`select count(*) from public.audit_events where action = 'plus_contact_created_from_request' and occurred_at >= '${RUN_START}'`) === String(created.length)
      && one(`select count(*) from public.audit_events where action = 'plus_contact_created_from_request' and occurred_at >= '${RUN_START}' and (select array_agg(k) from jsonb_object_keys(after_data) k) <> array['request_id']`) === "0");
  await assertNemrynApp();
  check("the app under test was still this Nemryn build at the end of the run", true);
} catch (e) {
  fails++;
  console.log(`FAIL — suite aborted :: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  section("cleanup: remove exactly this run's fixtures; restore the shared isolated stack");
  try {
    if (one(`select count(*) from public.plus_request_contact_enablements where organization_id = '${ORG_A}'`) !== "0") {
      const r = setEnabled(false);
      console.log(`cleanup: Platform Admin RPC disable -> ${r.ok ? "ok" : r.err.split("\n")[0]}`);
    }
    const ids = requestIds.map(lit).join(",") || "null";
    sql(`begin;
      delete from public.plus_request_attributions where request_id in (${ids});
      delete from public.plus_activities where organization_id = '${ORG_A}' and recorded_at >= '${RUN_START}';
      delete from public.plus_contacts where organization_id = '${ORG_A}' and created_at >= '${RUN_START}' and (display_name like 'RC02C %${STAMP} Fictional' or id in (${fixtureContacts.map(lit).join(",") || "null"}));
      delete from public.membership_module_grants where organization_id = '${ORG_A}' and granted_at >= '${RUN_START}';
      delete from public.organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');
      insert into public.organization_modules select * from json_populate_recordset(null::public.organization_modules, '${MODULES}');
      delete from public.transportation_requests where id in (${ids});
      delete from public.audit_events where occurred_at >= '${RUN_START}';
      commit;`);
  } catch (e) {
    fails++;
    console.log(`FAIL — cleanup error :: ${String(e.stderr ?? e.message).slice(0, 300)}`);
  }
  const after = counts();
  const diff = WATCHED.filter((t) => after[t] !== BASELINE[t]).map((t) => `${t} ${BASELINE[t]} -> ${after[t]}`);
  check("CLEANUP every watched table is back to its starting row count", diff.length === 0, diff.join("; "));
  check("CLEANUP no request-contact enablement remains", one("select count(*) from public.plus_request_contact_enablements") === "0");
  check("CLEANUP Org A / Org B modules restored exactly", one(`select coalesce(json_agg(m), '[]') from public.organization_modules m where organization_id in ('${ORG_A}', '${ORG_B}')`) === MODULES);
  if (SHOTS) writeFileSync(path.join(SHOTS, "findings.json"), JSON.stringify({ stamp: STAMP, notes, findings, formHeights }, null, 2));
  console.log(`\nRESULT: ${fails === 0 ? "all checks passed" : `${fails} check(s) failed`}${SHOTS ? ` -- screenshots and findings in ${SHOTS}` : ""}`);
  process.exit(fails === 0 ? 0 : 1);
}
