// NP-UI-P1b -- canonical shell & visual system: grouped sidebar (both states, rail tooltips, gating), slim context
// header + one-h1 title system, page-header actions, workspace switching, auth redirects, Operations Overview pilot
// (empty + seeded), responsive / axe sweep at 1440 / 1024 / 768 (+ the 390 notice), print outside the shell, and the
// visual-evidence screenshots. ISOLATED local stack only (same guards as tests/e2e/plus-quotes).
//   node tests/e2e/ui-foundations/p1b.e2e.mjs        (fresh reset recommended; see tests/e2e/plus-quotes/README.md)
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const OUT = artifactDir("ui-p1b");
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const ORG_E = "10000000-0000-0000-0000-0000000000e1"; // fictional, created here: an empty, freshly set-up workspace
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 400) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const first = (o) => o.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|DELETE \d+|INSERT \d+ \d+)$/.test(l))[0]?.trim() ?? "";
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; }
const sessions = [];
// The shared CDP harness has no per-call timeout; a stalled Chrome would hang the run forever. Here every session call
// is bounded, so a stall becomes a named failure instead.
const bounded = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${what}`)), ms))]);
function guard(s, name) {
  for (const m of ["nav", "evaluate", "cdp", "screenshot", "setViewport"]) {
    const orig = s[m].bind(s);
    s[m] = (...a) => bounded(orig(...a), 60_000, `${name}.${m}(${String(a[0]).slice(0, 80)})`);
  }
  return s;
}
const open = async (name, who, w = 1440, h = 1000) => {
  const s = guard(await bounded(newChromeSession(name), 90_000, `launch ${name}`), name);
  sessions.push(s);
  await s.setViewport(w, h);
  if (who) await bounded(signIn(s, who, SEED_PASSWORD), 90_000, `sign in ${who}`);
  return s;
};
const done = async (s) => { const i = sessions.indexOf(s); if (i >= 0) sessions.splice(i, 1); try { await s.close(); } catch {} };
const go = async (s, p) => { await s.nav(`${APP}${p}`, 2000); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 15000); await sleep(900); };
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const key = async (s, k, code, kc) => {
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  await sleep(150);
};
const focusOn = (s, sel) => s.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.focus(); return document.activeElement===e;})()`);
const h1s = (s) => s.evaluate(`[...document.querySelectorAll('h1')].filter(h => h.checkVisibility()).map(h => h.innerText.trim())`);
const sidebarModel = (s) => s.evaluate(`[...document.querySelectorAll('nav[aria-label="Primary"] [data-nav-section]')].map(sec => ({ key: sec.dataset.navSection, label: sec.querySelector('ul').getAttribute('aria-labelledby') ? document.getElementById(sec.querySelector('ul').getAttribute('aria-labelledby')).textContent.trim() : '', items: [...sec.querySelectorAll('a[data-nav-label]')].map(a => a.getAttribute('aria-label') + '=' + a.getAttribute('href')) }))`);
async function axe(s, include) {
  await injectAxe(s);
  return s.evaluate(`axe.run(${include ? `{ include: [${JSON.stringify(include)}] }` : "document"}, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + 'x' + v.nodes.length + ':' + (v.nodes[0]?.target?.[0] ?? '')))`);
}
const shot = async (s, name, sel) => {
  if (sel) {
    const r = await s.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height};})()`);
    const { data } = await s.cdp("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 1 } });
    (await import("node:fs")).writeFileSync(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  } else await s.screenshot(`${OUT}${name}.png`);
  console.log(`      screenshot: ${OUT}${name}.png`);
};

try {
  section("fixtures (fictional, isolated database only)");
  sql(`delete from organization_modules where organization_id='${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}','plus','active','UI-P1b')`);
  // An empty workspace for the "no data yet" Overview: org-a-inactive@example.test (inactive in Org A) becomes its only
  // active Organization Admin. Everything here is fictional and local.
  sql(`delete from memberships where organization_id='${ORG_E}'; delete from organizations where id='${ORG_E}';
       insert into organizations (id, name, timezone, business_stage) values ('${ORG_E}','Fictional Empty Workspace','America/New_York','starting');
       insert into memberships (organization_id, user_id, role) select '${ORG_E}', id, 'organization_admin' from auth.users where email='org-a-inactive@example.test';`);
  const REQ = first(sql(`select id from transportation_requests where organization_id='${ORG_A}' limit 1`));
  const TRIP = first(sql(`select id from trips where organization_id='${ORG_A}' order by scheduled_pickup_at limit 1`));

  const admin = await open("p1b-admin", "org-a-admin@example.test");

  section("S — canonical sidebar (desktop expanded, Organization Admin with Nemryn Plus)");
  await go(admin, "/operations");
  await admin.evaluate(`localStorage.removeItem('nemryn.sidebar.collapsed')`);
  await go(admin, "/operations");
  const model = await sidebarModel(admin);
  check("S1 sections in order: Today, Planning, Records, Growth, Administration", JSON.stringify(model.map((m) => m.label)) === JSON.stringify(["Today", "Planning", "Records", "Growth", "Administration"]), JSON.stringify(model.map((m) => m.label)));
  check("S2 Today: Operations Brief, Requests, Trips, Dispatch, Tomorrow Readiness -> existing routes",
    JSON.stringify(model[0]?.items) === JSON.stringify(["Operations Brief=/operations", "Requests=/operations/requests", "Trips=/operations/trips", "Dispatch=/operations/dispatch", "Tomorrow Readiness=/operations/tomorrow"]), JSON.stringify(model[0]?.items));
  check("S3 Planning: Standing Orders -> /operations/recurring-care; Records: Passengers, Facilities, Drivers, Vehicles(/fleet)",
    JSON.stringify(model[1]?.items) === JSON.stringify(["Standing Orders=/operations/recurring-care"]) && JSON.stringify(model[2]?.items) === JSON.stringify(["Passengers=/operations/passengers", "Facilities=/operations/facilities", "Drivers=/operations/drivers", "Vehicles=/operations/fleet"]), JSON.stringify(model.slice(1, 3)));
  const growthKids = await admin.evaluate(`[...document.querySelectorAll('[data-testid="growth-nav-child"]')].map(a => a.textContent.trim() + '=' + a.getAttribute('href'))`);
  check("S4 Growth: Dashboard, Inquiries, Pipeline, Contacts, Estimates & Quotes, Tasks (existing GrowthNavGroup hooks)", JSON.stringify(growthKids) === JSON.stringify(["Dashboard=/operations/growth", "Inquiries=/operations/growth/inquiries", "Pipeline=/operations/growth/pipeline", "Contacts=/operations/growth/contacts", "Estimates & Quotes=/operations/growth/quotes", "Tasks=/operations/growth/tasks"]), JSON.stringify(growthKids));
  check("S5 Administration: Billing + Settings (admin, NP-BILL-P1); no Reports link anywhere in the sidebar", JSON.stringify(model[4]?.items) === JSON.stringify(["Billing=/operations/billing", "Settings=/operations/settings"]) && !(await has(admin, 'nav[aria-label="Primary"] a[href*="reports"]')), JSON.stringify(model[4]?.items));
  check("S6 inverse Nemryn logo (expanded) + approved assets only; no tenant logo in the shell", await admin.evaluate(`(function(){const imgs=[...document.querySelectorAll('[data-testid="operations-sidebar"] img')].map(i=>i.getAttribute('src')); return imgs.some(s=>s.includes('nemryn-logo-inverse.svg')) && imgs.every(s=>/nemryn-(logo|symbol)-inverse\\.svg/.test(s)) && !document.querySelector('img[src*="zenward"]');})()`));
  check("S7 expanded width 256px; section labels visible", await admin.evaluate(`document.querySelector('[data-testid="operations-sidebar"]').getBoundingClientRect().width === 256 && [...document.querySelectorAll('[data-nav-section="today"] p')][0].checkVisibility()`));
  await shot(admin, "04-sidebar-expanded", '[data-testid="operations-sidebar"]');

  // every sidebar destination: loads inside the shell, aria-current on exactly its item, exactly one visible h1, one main
  const destinations = model.flatMap((m) => m.items.map((i) => i.split("=")[1])).concat(growthKids.map((g) => g.split("=")[1]));
  const destBad = [];
  for (const href of destinations) {
    await go(admin, href);
    const r = await admin.evaluate(`({ path: location.pathname, current: [...document.querySelectorAll('nav[aria-label="Primary"] [aria-current="page"]')].map(a => a.getAttribute('href')), mains: document.querySelectorAll('main').length, headerH1: !!document.querySelector('[data-testid="app-header"] h1, header h1'), err: !!document.querySelector('[data-testid="operations-error"], [data-testid="operations-not-found"]') })`);
    const hs = await h1s(admin);
    if (r.path !== href || r.current.length !== 1 || r.current[0] !== href || r.mains !== 1 || r.headerH1 || hs.length !== 1 || r.err) destBad.push(`${href} ${JSON.stringify(r)} h1=${JSON.stringify(hs)}`);
  }
  check(`S8 all ${destinations.length} sidebar destinations load in the shell with aria-current on their own item, one <main>, exactly one visible h1 (none in the header)`, destBad.length === 0, destBad.join(" | "));
  await go(admin, "/operations/growth/pipeline");
  await shot(admin, "06-growth-navigation-expanded", '[data-testid="operations-sidebar"]');

  section("S — collapsed desktop rail + rail tooltip + persistence");
  await go(admin, "/operations");
  await focusOn(admin, '[data-testid="sidebar-collapse-toggle"]');
  await key(admin, "Enter", "Enter", 13);
  await sleep(500);
  const collapsed = await admin.evaluate(`({ w: document.querySelector('[data-testid="operations-sidebar"]').getBoundingClientRect().width, labelsHidden: ![...document.querySelectorAll('[data-nav-section="today"] p')][0].checkVisibility() || getComputedStyle([...document.querySelectorAll('[data-nav-section="today"] p')][0]).position === 'absolute', symbol: [...document.querySelectorAll('[data-testid="operations-sidebar"] img')].find(i => i.checkVisibility())?.getAttribute('src'), names: [...document.querySelectorAll('nav[aria-label="Primary"] a[data-nav-label]')].every(a => a.getAttribute('aria-label')), toggle: document.querySelector('[data-testid="sidebar-collapse-toggle"]').getAttribute('aria-label') })`);
  check("S9 collapse toggle (keyboard): 64px rail, section labels visually hidden, inverse symbol shown, every item keeps its accessible name, toggle renamed 'Expand sidebar'",
    collapsed.w === 64 && collapsed.labelsHidden && /nemryn-symbol-inverse/.test(collapsed.symbol) && collapsed.names && collapsed.toggle === "Expand sidebar", JSON.stringify(collapsed));
  await focusOn(admin, 'a[data-testid="nav-item-dispatch"]');
  await sleep(250);
  const tip = await admin.evaluate(`(function(){const t=document.querySelector('[data-testid="sidebar-rail-tooltip"]'); return t ? t.textContent.trim() + '|' + t.getAttribute('aria-hidden') + '|' + t.checkVisibility() : '';})()`);
  check("S10 rail: keyboard focus on an item shows its label beside the rail (visual only; aria-hidden — the name is the aria-label)", tip === "Dispatch|true|true", tip);
  const ring = await admin.evaluate(`getComputedStyle(document.activeElement).outlineColor + '|' + getComputedStyle(document.activeElement).outlineStyle`);
  // Brand Lock v2 (D-2, 16-brand-lock-v2.md §1 `shell.focus`): expectation re-pointed from the v1 #a8bcc8 to #7fb8ff; intent unchanged.
  check("S10b focus ring on the dark chrome uses the shell focus token (#7fb8ff, 7.57:1 on the shell), not the page's teal focus colour [Brand Lock v2 D-2]", ring === "rgb(127, 184, 255)|solid", ring);
  await key(admin, "Escape", "Escape", 27);
  check("S11 rail tooltip: Escape hides it", !(await has(admin, '[data-testid="sidebar-rail-tooltip"]')));
  await shot(admin, "05-sidebar-collapsed", '[data-testid="operations-sidebar"]');
  await go(admin, "/operations/trips");
  check("S12 collapsed state persists across navigation and reload (localStorage UI preference only)", (await admin.evaluate(`document.querySelector('[data-testid="operations-sidebar"]').dataset.collapsed`)) === "true");
  await focusOn(admin, '[data-testid="growth-nav-rail-button"]');
  await key(admin, "Enter", "Enter", 13);
  const fly = await waitFor(() => has(admin, '[data-testid="growth-nav-flyout"]'), 3000);
  await sleep(200);
  const flyFocus = await admin.evaluate(`document.activeElement?.getAttribute('data-testid')`);
  const tipDuringFlyout = await has(admin, '[data-testid="sidebar-rail-tooltip"]');
  await key(admin, "Escape", "Escape", 27);
  const tipAfter = await admin.evaluate(`document.querySelector('[data-testid="sidebar-rail-tooltip"]')?.textContent.trim() ?? ''`);
  check("S13 rail Growth flyout still works: Enter opens + focuses the first link (no rail label over the flyout), Escape closes and returns focus to the Growth rail button (whose own label may show)",
    fly && flyFocus === "growth-nav-flyout-link" && !tipDuringFlyout && !(await has(admin, '[data-testid="growth-nav-flyout"]')) && (await admin.evaluate(`document.activeElement?.getAttribute('data-testid')`)) === "growth-nav-rail-button" && (tipAfter === "" || tipAfter === "Growth"), tipAfter);
  await admin.evaluate(`document.querySelector('[data-testid="sidebar-collapse-toggle"]').click()`);
  await sleep(400);
  check("S14 expand again: 256px, labels visible", await admin.evaluate(`document.querySelector('[data-testid="operations-sidebar"]').getBoundingClientRect().width === 256`));

  section("S — role / entitlement gating");
  const dispatcher = await open("p1b-dispatcher", "org-a-dispatcher@example.test");
  await go(dispatcher, "/operations");
  const dm = await sidebarModel(dispatcher);
  check("G1 Dispatcher without a Growth grant: Today / Planning / Records only (no Growth, no Settings, no empty Administration)", JSON.stringify(dm.map((m) => m.key)) === JSON.stringify(["today", "planning", "records"]) && !(await has(dispatcher, '[data-testid="growth-nav-group"]')), JSON.stringify(dm.map((m) => m.key)));
  sql(`delete from organization_modules where organization_id='${ORG_A}'`);
  await go(admin, "/operations");
  check("G2 Organization Admin without Nemryn Plus: no Growth section (entitlement gating preserved)", !(await has(admin, '[data-testid="growth-nav-group"]')) && JSON.stringify((await sidebarModel(admin)).map((m) => m.key)) === JSON.stringify(["today", "planning", "records", "administration"]));
  await go(admin, "/operations/growth");
  check("G3 …and the Growth route itself still refuses (server-side guard, not just hidden navigation)", (await admin.evaluate("location.pathname")) !== "/operations/growth" || /not available|locked|Nemryn Plus/i.test(await admin.evaluate("document.body.innerText")), await admin.evaluate("location.pathname"));
  sql(`insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}','plus','active','UI-P1b')`);
  await done(dispatcher);

  section("H — slim context header + one title system + page-header actions");
  await go(admin, "/operations");
  const hdr = await admin.evaluate(`(function(){const h=document.querySelector('[data-testid="app-header"]'); const r=h.getBoundingClientRect(); return { height: r.height, headings: h.querySelectorAll('h1,h2,h3').length, context: document.querySelector('[data-testid="app-header-context"]').innerText.replace(/\\s+/g,' ').trim(), controls: [...h.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)) };})()`);
  check("H1 header: 56px, no headings, context 'Fictional Org A / Today › Operations Brief', every control 40px", hdr.height === 56 && hdr.headings === 0 && /Fictional Org A \/ Today Operations Brief/.test(hdr.context) && hdr.controls.length >= 2 && hdr.controls.every((h) => h === 40), JSON.stringify(hdr));
  check("H2 Overview: one h1 'Today's Operations' in the page header inside <main>, with the date", JSON.stringify(await h1s(admin)) === JSON.stringify(["Today's Operations"]) && (await has(admin, 'main [data-testid="page-header"] h1')), JSON.stringify(await h1s(admin)));
  const ovActions = await admin.evaluate(`[...document.querySelectorAll('main [data-testid="page-header"] a, main [data-testid="page-header"] button')].map(e => e.textContent.trim() + '=' + (e.getAttribute('href') || e.getAttribute('data-testid')))`);
  check("H3 Overview actions moved into the page header: Export Day Sheet (secondary) then New Trip (primary, /operations/trips/new)", JSON.stringify(ovActions) === JSON.stringify(["Export Day Sheet=export-day-sheet-button", "New Trip=/operations/trips/new"]), JSON.stringify(ovActions));
  await focusOn(admin, '[data-testid="export-day-sheet-button"]');
  await key(admin, "Enter", "Enter", 13);
  const exp = await waitFor(() => has(admin, '#header-day-sheet a[href="/day-sheet?day=today"]'), 3000);
  await key(admin, "Escape", "Escape", 27);
  check("H4 Export Day Sheet menu unchanged: opens by keyboard with today's print + CSV links, Escape closes", exp && (await has(admin, '#header-day-sheet')) === false);
  await go(admin, "/operations/dispatch?day=tomorrow");
  const dActions = await admin.evaluate(`[...document.querySelectorAll('main [data-testid="page-header"] a, main [data-testid="page-header"] button')].map(e => e.textContent.trim())`);
  await admin.evaluate(`document.querySelector('[data-testid="export-day-sheet-button"]').click()`);
  const dExp = await waitFor(() => has(admin, '#header-day-sheet a[href="/day-sheet?day=tomorrow"]'), 3000);
  check("H5 Dispatch: one h1 'Dispatch', description follows the selected day ('Tomorrow'), Export (tomorrow) + New Trip, day switch intact",
    JSON.stringify(await h1s(admin)) === JSON.stringify(["Dispatch"]) && /Tomorrow/.test(await admin.evaluate(`document.querySelector('main [data-testid="page-header"] p').innerText`)) && JSON.stringify(dActions) === JSON.stringify(["Export Day Sheet", "New Trip"]) && dExp && (await has(admin, '[data-testid="dispatch-day-switch"]')), JSON.stringify(dActions));
  await go(admin, `/operations/trips/${TRIP}`);
  check("H6 Trip Detail: exactly one h1 'Trip Detail' (compact page header); passenger name stays the h2", JSON.stringify(await h1s(admin)) === JSON.stringify(["Trip Detail"]), JSON.stringify(await h1s(admin)));
  await go(admin, `/operations/requests/${REQ}`);
  check("H7 Request Detail: exactly one h1 'Request Detail' (A2 preserved)", JSON.stringify(await h1s(admin)) === JSON.stringify(["Request Detail"]), JSON.stringify(await h1s(admin)));
  const extra = ["/operations/trips/new", "/operations/requests/new", "/operations/proof-of-service", "/operations/growth/agent", "/operations/settings/team", "/operations/no-such-page"];
  const xBad = [];
  for (const p of extra) { await go(admin, p); const hs = await h1s(admin); if (hs.length !== 1 || (await has(admin, 'header h1'))) xBad.push(`${p} ${JSON.stringify(hs)}`); }
  check(`H8 ${extra.length} further routes (forms, Brief-linked pages, settings, 404): exactly one visible h1, none in the header`, xBad.length === 0, xBad.join(" | "));
  // E — error-state heading (P1b polish): the shell (layout) renders no h1 at all; page h1s come from the page segment,
  // which the in-shell error boundary replaces. website-requests fails in the isolated env (P1a A5 fixture).
  await go(admin, "/operations/settings/website-requests");
  const e1 = await admin.evaluate(`({ boundary: !!document.querySelector('[data-testid="operations-error"]'), shell: !!document.querySelector('nav[aria-label="Primary"]'), h1: [...document.querySelectorAll('h1')].filter(h => h.checkVisibility()).map(h => h.innerText.trim()), shellH1: document.querySelectorAll('[data-testid="operations-sidebar"] h1, [data-testid="app-header"] h1').length })`);
  check("E1 in-shell error state: shell kept, exactly ONE h1 (the error panel's), none from the shell", e1.boundary && e1.shell && e1.h1.length === 1 && e1.h1[0] === "This page couldn't be loaded" && e1.shellH1 === 0, JSON.stringify(e1));
  const e2 = [];
  for (const p of ["/operations", "/operations/dispatch", `/operations/trips/${TRIP}`, `/operations/requests/${REQ}`, "/operations/trips/00000000-0000-4000-8000-000000000000", "/operations/requests/00000000-0000-4000-8000-000000000000"]) {
    await go(admin, p);
    const r = await admin.evaluate(`({ h1: [...document.querySelectorAll('h1')].filter(h => h.checkVisibility()).length, inHeader: document.querySelectorAll('[data-testid="page-header"] h1').length, pageHeaderInMain: !!document.querySelector('main [data-testid="page-header"]') })`);
    if (r.h1 !== 1 || r.inHeader !== 1 || !r.pageHeaderInMain) e2.push(`${p} ${JSON.stringify(r)}`);
  }
  check("E2 Overview / Dispatch / Trip & Request Detail (incl. their 'unavailable' states): the page's own PageHeader supplies the one h1", e2.length === 0, e2.join(" | "));
  await go(admin, "/operations/proof-of-service");
  check("H9 Proof of Service stays reachable (Brief entry point) and the context header names it", /Proof of Service/.test(await admin.evaluate(`document.querySelector('[data-testid="app-header-context"]').innerText`)));

  section("W — workspace switching + auth redirects");
  const multi = await open("p1b-multi", "multi-org-user@example.test");
  await go(multi, "/select-organization");
  await multi.evaluate(`(function(){const b=[...document.querySelectorAll('button, a')].find(e => /Fictional Org A/.test(e.textContent)); b && b.click(); return !!b;})()`);
  await waitFor(async () => (await multi.evaluate("location.pathname")).startsWith("/operations"), 15000); await sleep(800);
  const sw = await multi.evaluate(`document.querySelector('[data-testid="sidebar-switch-workspace"]')?.getAttribute('href')`);
  check("W1 multi-workspace person: sidebar workspace row offers 'Switch workspace' -> /select-organization?switch=1", sw === "/select-organization?switch=1", sw);
  await multi.evaluate(`document.querySelector('[data-testid="sidebar-switch-workspace"]').click()`);
  await waitFor(async () => (await multi.evaluate("location.pathname")) === "/select-organization", 10000); await sleep(600);
  check("W2 …which opens the existing workspace picker (no auto-bounce), listing both workspaces", /Fictional Org A/.test(await multi.evaluate("document.body.innerText")) && /Fictional Org B/.test(await multi.evaluate("document.body.innerText")));
  check("W3 single-workspace admin: no switch link", !(await has(admin, '[data-testid="sidebar-switch-workspace"]')));
  check("W3b sidebar footer: workspace card (name + 'Workspace') above the user row (name + role)", await admin.evaluate(`(function(){const w=document.querySelector('[data-testid="sidebar-workspace"]'), u=document.querySelector('[data-testid="sidebar-user"]'); return !!w && !!u && /Fictional Org A/.test(w.innerText) && /Workspace/.test(w.innerText) && /Organization Admin/.test(u.innerText) && w.getBoundingClientRect().bottom <= u.getBoundingClientRect().top;})()`));
  await done(multi);
  const anon = await open("p1b-anon", null);
  await go(anon, "/operations/dispatch");
  check("W4 signed out: /operations/* redirects to sign-in", /sign-in/.test(await anon.evaluate("location.pathname")), await anon.evaluate("location.pathname"));
  await done(anon);
  const driver = await open("p1b-driver", "org-a-driver-a@example.test", 390, 844);
  await go(driver, "/operations");
  check("W5 a Driver opening /operations is sent to the driver surface (no Operations chrome)", (await driver.evaluate("location.pathname")).startsWith("/driver") && !(await has(driver, '[data-testid="operations-sidebar"]')) && !(await has(driver, '[data-testid="app-header"]')), await driver.evaluate("location.pathname"));
  await done(driver);

  section("O — Operations Overview pilot");
  await go(admin, "/operations");
  const tiles = await admin.evaluate(`[...document.querySelectorAll('[data-testid="brief-summary-tiles"] li')].map(li => li.innerText.replace(/\\s+/g,' ').trim())`);
  const exp4 = first(sql(`select count(*) from trips where organization_id='${ORG_A}' and scheduled_pickup_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York') and scheduled_pickup_at < ((date_trunc('day', now() at time zone 'America/New_York') + interval '1 day') at time zone 'America/New_York')`));
  check("O1 seeded workspace: 4 fact tiles under 'Operations Brief' (trips today / active / need attention / no current issues), real values, none 'Unavailable'",
    tiles.length === 4 && /trips today/.test(tiles[0]) && /active/.test(tiles[1]) && /need attention/.test(tiles[2]) && /no current issues/.test(tiles[3]) && !tiles.some((t) => /Unavailable/.test(t)), JSON.stringify(tiles) + ` db-today=${exp4}`);
  check("O2 'trips today' tile equals the database count of today's trips (org timezone; no fabricated value)", tiles[0]?.startsWith(`${exp4} `), `${tiles[0]} vs ${exp4}`);
  check("O3 the old inline summary strip is gone (moved, not duplicated); Upcoming / Active / Activity panels remain", !(await admin.evaluate(`[...document.querySelectorAll('main')].some(m => /trips today/.test(m.innerText.split('Operations Brief')[0]))`)) && (await has(admin, "#today-trips")) && (await has(admin, "#active-trips")) && /Activity Log/.test(await admin.evaluate("document.querySelector('main').innerText")));
  const outline = await admin.evaluate(`[...document.querySelectorAll('main h1, main h2, main h3')].map(h => +h.tagName[1])`);
  check("O4 heading outline never skips (h1 -> h2 -> h3)", outline[0] === 1 && !outline.some((l, i) => i > 0 && l - outline[i - 1] > 1), JSON.stringify(outline));
  const ov = await axe(admin, null);
  check("O5 Overview (seeded): 0 serious / critical axe violations", ov.length === 0, JSON.stringify(ov));
  await shot(admin, "08-overview-seeded-1440");

  const empty = await open("p1b-empty", "org-a-inactive@example.test");
  await go(empty, "/operations");
  const emptyPath = await empty.evaluate("location.pathname");
  const prog = await empty.evaluate(`(function(){const p=document.querySelector('[data-testid="setup-progress"] [role="progressbar"]'); return p ? { now: p.getAttribute('aria-valuenow'), max: p.getAttribute('aria-valuemax'), text: document.querySelector('[data-testid="setup-progress-count"]').innerText, steps: [...document.querySelectorAll('[data-testid="setup-step"]')].map(s => s.dataset.complete) } : null;})()`);
  check("O6 empty workspace: 'Finish setting up' derives count + segments from the real checklist (business profile only = 1 of 6)", emptyPath === "/operations" && prog && prog.now === "1" && prog.max === "6" && prog.text === "1 of 6 complete" && JSON.stringify(prog.steps) === JSON.stringify(["true", "false", "false", "false", "false", "false"]), `${emptyPath} ${JSON.stringify(prog)}`);
  check("O7 empty workspace: fresh Brief with Get started rows (first trip, business basics + timezone, website requests, I also drive); no zero tiles", (await empty.evaluate(`document.querySelector('[data-testid="brief"]').dataset.briefKind`)) === "fresh" && !(await has(empty, '[data-testid="brief-summary-tiles"]'))
    && JSON.stringify(await empty.evaluate(`[...document.querySelectorAll('[data-testid="get-started"] li a')].map(a => a.getAttribute('href'))`)) === JSON.stringify(["/operations/trips/new", "/onboarding/basics", "/operations/settings/website-requests", "/operations/settings/my-access"]) && /Timezone: America\/New_York/.test(await empty.evaluate(`document.querySelector('[data-testid="get-started-timezone"]').innerText`)));
  await focusOn(empty, '[data-testid="setup-progress-toggle"]');
  await key(empty, "Enter", "Enter", 13);
  const hidden = await empty.evaluate(`document.querySelector('[data-testid="setup-progress-toggle"]').getAttribute('aria-expanded') === 'false' && !document.querySelector('[data-testid="setup-step"]').checkVisibility()`);
  await key(empty, "Enter", "Enter", 13);
  check("O8 'Hide steps' / 'Show steps' disclosure (aria-expanded, keyboard)", hidden && (await empty.evaluate(`document.querySelector('[data-testid="setup-progress-toggle"]').getAttribute('aria-expanded') === 'true'`)));
  const ev = await axe(empty, null);
  check("O9 Overview (empty): 0 serious / critical axe violations", ev.length === 0, JSON.stringify(ev));
  await shot(empty, "07-overview-empty-1440");
  await done(empty);

  section("R — responsive + axe sweep; print outside the shell");
  const routes = ["/operations", "/operations/requests", `/operations/requests/${REQ}`, "/operations/trips", `/operations/trips/${TRIP}`, "/operations/dispatch", "/operations/tomorrow", "/operations/recurring-care", "/operations/passengers", "/operations/facilities", "/operations/drivers", "/operations/fleet", "/operations/growth", "/operations/growth/quotes", "/operations/settings"];
  for (const [w, h, name] of [[1440, 900, "01-operations-brief-1440"], [1024, 800, "02-operations-brief-1024"], [768, 1024, "03-operations-brief-768"]]) {
    const s = await open(`p1b-${w}`, "org-a-admin@example.test", w, h);
    const bad = [];
    for (const r of routes) {
      await go(s, r);
      const o = await s.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      const v = await axe(s, null);
      if (o || v.length) bad.push(`${r}${o ? " OVERFLOW" : ""} ${v.join(",")}`);
    }
    await go(s, "/operations");
    const sw2 = await s.evaluate(`document.querySelector('[data-testid="operations-sidebar"]')?.getBoundingClientRect().width ?? ('missing at ' + location.pathname)`);
    await shot(s, name);
    check(`R ${w} px: ${routes.length} routes — no page-level horizontal overflow, 0 serious / critical axe; sidebar ${w >= 1024 ? 256 : 64}px`, bad.length === 0 && sw2 === (w >= 1024 ? 256 : 64), `${sw2} ${bad.join(" | ")}`);
    if (w === 768) {
      await focusOn(s, 'a[data-testid="nav-item-trips"]');
      await sleep(250);
      check("R768 tablet rail: focus shows the item label beside the rail; items keep aria-labels", (await s.evaluate(`document.querySelector('[data-testid="sidebar-rail-tooltip"]')?.textContent.trim()`)) === "Trips" && (await s.evaluate(`[...document.querySelectorAll('nav[aria-label="Primary"] a[data-nav-label]')].every(a => a.getAttribute('aria-label'))`)));
    }
    await done(s);
  }
  const phone = await open("p1b-390", "org-a-admin@example.test", 390, 844);
  await go(phone, "/operations");
  check("R390 the existing Operations notice is kept (mobile Operations is NOT claimed): one visible main, notice text", await phone.evaluate(`[...document.querySelectorAll('main, [role="main"]')].filter(m => m.checkVisibility()).length === 1 && /designed for tablet and desktop use/.test(document.body.innerText)`));
  await shot(phone, "09-operations-390-notice");
  await done(phone);
  await go(admin, "/day-sheet?day=today");
  check("P1 Day Sheet print view stays OUTSIDE the shell (no sidebar, no app header)", !(await has(admin, 'nav[aria-label="Primary"]')) && !(await has(admin, '[data-testid="app-header"]')) && (await admin.evaluate("location.pathname")) === "/day-sheet");

  section("B — brand preservation");
  const brand = await admin.evaluate(`(function(){const cs=getComputedStyle(document.documentElement); return ['--color-chrome-background','--color-surface-app','--color-action-primary-background','--radius-xs','--radius-sm','--radius-md','--radius-lg'].map(v => v + '=' + cs.getPropertyValue(v).trim()).join(' ');})()`);
  // Brand Lock v2 (D-2 palette, D-7 radius; 16-brand-lock-v2.md §1/§3): expectations re-pointed from the v1 values; the check still asserts the active brand tokens.
  check("B1 deep slate chrome, cool canvas, teal primary action; radius scale 4 / 9 / 12 / 14 [Brand Lock v2 D-2, D-7]", brand === "--color-chrome-background=#112632 --color-surface-app=#f3f8fa --color-action-primary-background=#006e69 --radius-xs=4px --radius-sm=9px --radius-md=12px --radius-lg=14px", brand);
  await go(admin, "/operations");
  const ff = await admin.evaluate(`(function(){const f=getComputedStyle(document.querySelector('h1')).fontFamily; const btn=getComputedStyle([...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'New Trip')).backgroundColor; return f + '|' + btn;})()`);
  // Brand Lock v2 (D-1 display face, D-2 teal primary; 16-brand-lock-v2.md §1/§2): expectations re-pointed — the page title is the approved
  // self-hosted Newsreader display face (Georgia fallback) while the UI body stays Geist; New Trip is the teal primary (no graphite).
  const bodyFont = await admin.evaluate(`getComputedStyle(document.querySelector('main p') || document.body).fontFamily`);
  check("B2 page title in the approved Newsreader display face (body text stays Geist Sans); New Trip is the teal primary [Brand Lock v2 D-1, D-2]", /newsreader/i.test(ff.split("|")[0]) && /georgia/i.test(ff.split("|")[0]) && /geist/i.test(bodyFont) && /rgb\(0, 110, 105\)/.test(ff), `${ff} body=${bodyFont}`);
} catch (e) {
  fails++;
  console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  for (const s of sessions) { try { await s.close(); } catch {} }
  try { sql(`delete from memberships where organization_id='${ORG_E}'; delete from organizations where id='${ORG_E}';`); } catch {}
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
