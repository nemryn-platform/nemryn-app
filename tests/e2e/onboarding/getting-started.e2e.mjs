// NP-PILOT-P2 -- Getting started: browser + SQL E2E on the ISOLATED stack (NemrynS1Iso + `next start -p 3100`, public
// inquiry switch OFF). FICTIONAL data only; the plus-quotes config refuses any other target.
//   node tests/e2e/onboarding/getting-started.e2e.mjs
// A brand-new workspace (real sign-up) starts at 0 of 4 business-setup essentials; only REAL configuration completes a
// step (opening a page does not); the four essentials ALONE complete setup (no facility / passenger / trip needed);
// first-use milestones are separate and never block; the Brief banner, the sidebar entry, the Getting started page, the
// Billing notice and the empty-state links follow the live data; admin-only steps for staff; Core-only vs Plus; mobile + axe.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
const OWNER = `onboard-${STAMP}@example.test`;
const OUT = artifactDir("onboarding");
const SHOTS = process.env.ONBOARDING_SCREENSHOT_DIR || OUT;
mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|SET|COMMIT|INSERT 0 \d+|UPDATE \d+|DELETE \d+)$/.test(l))[0] ?? "";
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }

const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const setValue = (sel, value) => ev(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
async function go(p, w = 1440, h = 1000) { await s.setViewport(w, h); await s.nav(`${APP}${p}`, 2200); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(800); }
async function open(name, email) { const x = await newChromeSession(`onboard-${name}`); sessions.push(x); await x.setViewport(1440, 1000); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
async function axe(label) {
  await injectAxe(s);
  const res = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact })))`);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`AXE ${label}: 0 serious / critical`, serious.length === 0, JSON.stringify(serious));
}
const page = () => ev(`(function(){const steps=[...document.querySelectorAll('[data-testid="getting-started-step"]')]; return {
  count: document.querySelector('[data-testid="getting-started-count"]')?.innerText ?? '',
  steps: Object.fromEntries(steps.map(e => [e.dataset.step, { state: e.dataset.complete, link: e.querySelector('[data-testid="getting-started-action"]')?.getAttribute('href') ?? null, text: e.innerText }])),
  growth: !!document.querySelector('[data-testid="getting-started-growth"]'),
  essentials: [...document.querySelectorAll('[data-testid="getting-started-essentials"] [data-testid="getting-started-step"]')].map(e => e.dataset.step),
  milestones: [...document.querySelectorAll('[data-testid="getting-started-milestones"] [data-testid="getting-started-step"]')].map(e => e.dataset.step),
  milestoneNote: document.querySelector('[data-testid="getting-started-milestones"]')?.innerText ?? '',
  scope: document.querySelector('[data-testid="getting-started-scope-note"]')?.innerText ?? '' };})()`);
const sidebar = () => ev(`({ item: !!document.querySelector('[data-testid="nav-item-setup"]'), badge: document.querySelector('[data-testid="nav-setup-remaining"]')?.innerText ?? null, label: document.querySelector('[data-testid="nav-item-setup"]')?.getAttribute('aria-label') ?? null })`);
const banner = () => ev(`({ shown: !!document.querySelector('[data-testid="setup-progress"]'), count: document.querySelector('[data-testid="setup-progress-count"]')?.innerText ?? '', steps: document.querySelectorAll('[data-testid="setup-step"]').length, done: document.querySelectorAll('[data-testid="setup-step"][data-complete="true"]').length, guide: document.querySelector('[data-testid="setup-guide-link"]')?.getAttribute('href') ?? null })`);

let ORG = null;
try {
  // ============================================================== a brand-new workspace (real sign-up)
  section("fresh workspace");
  s = await open("owner");
  await go("/sign-up");
  await setValue('input[name="fullName"]', `Onboard Owner ${STAMP}`);
  await setValue('input[name="email"]', OWNER);
  await setValue('input[name="password"]', "onboard-fictional-pw-123");
  await setValue('input[name="businessName"]', `ONBOARD Transport ${STAMP}`);
  await ev(`[...document.querySelectorAll('button[type="submit"]')].find(b => /Create account/.test(b.textContent))?.click()`);
  await waitFor(async () => (await ev("location.pathname")).startsWith("/onboarding/basics"), 25000);
  ORG = one(`select o.id from organizations o join memberships m on m.organization_id = o.id join auth.users u on u.id = m.user_id where u.email = '${OWNER}' and m.role = 'organization_admin'`);
  check("F0 sign-up created a fresh fictional workspace with an Organization Admin", /^[0-9a-f-]{36}$/.test(ORG), ORG);

  await go("/operations");
  const b0 = await banner();
  const n0 = await sidebar();
  check("F1 Brief banner: 0 of 4 business-setup essentials (nothing pre-completed), 4 steps, guide link", b0.shown && /0 of 4 complete/.test(b0.count) && b0.steps === 4 && b0.done === 0 && b0.guide === "/operations/getting-started", JSON.stringify(b0));
  check("F2 sidebar shows 'Getting started' under Today with 4 left (accessible name says so)", n0.item && n0.badge === "4" && /Getting started, 4 steps left/.test(n0.label), JSON.stringify(n0));
  await s.screenshot(path.join(SHOTS, "g01-brief-fresh.png"));

  await go("/operations/getting-started");
  const p0 = await page();
  check("F3 Getting started page: 0 of 4; essentials = business, services, vehicle, driver; milestones = facility, passenger, request/trip, team; admin links to Settings",
    /0 of 4 business setup steps complete/.test(p0.count) && JSON.stringify(p0.essentials) === JSON.stringify(["business", "services", "vehicle", "driver"])
      && JSON.stringify(p0.milestones) === JSON.stringify(["facility", "passenger", "trip", "team"])
      && ["business", "services", "vehicle", "driver", "facility", "passenger", "trip"].every((k) => p0.steps[k]?.state === "false")
      && p0.steps.business.link === "/operations/settings/organization" && p0.steps.services.link === "/operations/settings/services" && p0.steps.team.link === "/operations/settings/team", JSON.stringify(p0.steps.business));
  check("F4 Core-only workspace: no Growth steps; Team is a recommended milestone, not complete", !p0.growth && p0.steps.team?.state === "false" && /Recommended/.test(p0.steps.team.text) && !p0.steps.growth_contact, JSON.stringify(Object.keys(p0.steps)));
  check("F5 notes: setup is not a HIPAA / compliance claim; milestones do not mean the organization may handle real patient information (fictional practice records)",
    /does not make your organization HIPAA compliant/.test(p0.scope) && /do not mean your organization is approved or ready to handle real patient information/.test(p0.milestoneNote) && /fictional practice records/.test(p0.milestoneNote), p0.milestoneNote.slice(0, 200));
  await s.screenshot(path.join(SHOTS, "g02-getting-started-fresh.png"));
  await axe("Getting started page (desktop)");

  // ============================================================== opening pages completes nothing
  section("visiting is not completing");
  for (const p of ["/operations/settings/organization", "/operations/settings/services", "/onboarding/vehicle", "/onboarding/driver", "/operations/trips/new", "/operations/fleet"]) await go(p);
  await go("/operations/getting-started");
  check("V1 opening every setup page (Settings, onboarding steps, New trip) changes nothing: still 0 of 4", /0 of 4 business setup steps complete/.test((await page()).count));
  await go("/operations/fleet");
  check("V2 Vehicles empty state links to the setup steps", (await ev(`document.querySelector('[data-testid="empty-getting-started-link"]')?.getAttribute('href')`)) === "/operations/getting-started");
  await go("/operations/billing");
  check("V3 Billing says business phone / address are missing (they print on invoices), with a link to Settings", (await has('[data-testid="billing-business-details-missing"]')) && /Add your business phone and address/.test(await text('[data-testid="billing-business-details-missing"]')));

  // ============================================================== real configuration completes steps
  section("real configuration");
  await go("/operations/settings/organization");
  await setValue('input[name="businessPhone"]', "(404) 555-0170");
  await ev(`[...document.querySelectorAll('button[type="submit"]')].pop().click()`); await sleep(2500);
  await go("/operations/getting-started");
  check("R1 phone alone is not enough: business details still 'Not complete'", (await page()).steps.business.state === "false", one(`select coalesce(business_phone,'-') from organizations where id = '${ORG}'`));
  await go("/operations/settings/organization");
  await setValue('textarea[name="businessAddress"], input[name="businessAddress"]', "1 Fictional Onboarding Way\nAtlanta, GA 30301");
  await ev(`[...document.querySelectorAll('button[type="submit"]')].pop().click()`); await sleep(2500);
  await go("/operations/settings/services");
  await ev(`(function(){const c=document.querySelector('input[name="service"]'); if(c && !c.checked) c.click(); return !!c;})()`);
  await ev(`[...document.querySelectorAll('button[type="submit"]')].pop().click()`); await sleep(2500);
  await go("/operations/getting-started");
  const p1 = await page();
  check("R2 saving business phone + address and choosing a service completes exactly those two steps (2 of 4)",
    /2 of 4 business setup steps complete/.test(p1.count) && p1.steps.business.state === "true" && p1.steps.services.state === "true" && p1.steps.vehicle.state === "false",
    `${p1.count} | db: ${one(`select (business_address is not null)::text from organizations where id = '${ORG}'`)}`);
  await go("/operations/billing");
  check("R3 Billing notice disappears once business details are saved", !(await has('[data-testid="billing-business-details-missing"]')));
  // a vehicle and an active driver: the last two essentials (as the guided steps / Records pages create them)
  sql(`insert into vehicles (organization_id, label) values ('${ORG}', 'ONBOARD Van 1');
       insert into drivers (organization_id, display_name, status) values ('${ORG}', 'ONBOARD Driver', 'active');`);
  await go("/operations");
  const b1 = await banner();
  const n1 = await sidebar();
  const kind1 = await ev(`document.querySelector('[data-testid="brief"]')?.dataset.briefKind ?? ''`);
  check("R4 the four essentials ALONE complete setup -- no facility, passenger or trip: banner and sidebar entry disappear", !b1.shown && !n1.item, JSON.stringify({ b1, n1 }));
  check("R5 the Brief keeps its fresh 'Get started' view until the first trip (setup done, nothing carried yet)", kind1 === "fresh", kind1);
  await go("/operations/getting-started");
  const p2 = await page();
  check("R6 page: 'Business setup is complete'; every first-use milestone still 'Not complete' and does not block",
    /Business setup is complete/.test(p2.count) && ["facility", "passenger", "trip", "team"].every((k) => p2.steps[k]?.state === "false"), p2.count);
  await s.screenshot(path.join(SHOTS, "g03-setup-complete-milestones-open.png"));
  // first-use milestones (fictional practice records)
  const P = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG}', 'ONBOARD Practice Rider', '404-555-0171') returning id`);
  sql(`insert into facilities (organization_id, name) values ('${ORG}', 'ONBOARD Fictional Clinic');`);
  const uid = one(`select id from auth.users where email = '${OWNER}'`);
  sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}';
       select (public.create_trip('${ORG}', '${P}', 'ONBOARD 2 Pickup St', 'ONBOARD Fictional Clinic', now() + interval '2 days', null, null, null, null, null, null, 30, false)).trip_id; commit;`);
  await go("/operations/getting-started");
  const p3 = await page();
  check("R7 facility, passenger and first trip complete their milestones; the setup count is unchanged (still complete); Team stays optional",
    /Business setup is complete/.test(p3.count) && ["facility", "passenger", "trip"].every((k) => p3.steps[k]?.state === "true") && p3.steps.team.state === "false", JSON.stringify(Object.fromEntries(Object.entries(p3.steps).map(([k, v]) => [k, v.state]))));
  await go("/operations");
  check("R8 after the first trip the Brief leaves the fresh view (operational)", (await ev(`document.querySelector('[data-testid="brief"]')?.dataset.briefKind ?? ''`)) !== "fresh");
  // mobile
  await go("/operations/getting-started", 390, 844);
  const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check("M1 390 px: no horizontal page overflow on Getting started", overflow <= 0, overflow);
  await s.screenshot(path.join(SHOTS, "g04-getting-started-mobile.png"));
  await axe("Getting started page (390 px)");

  // ============================================================== staff (Dispatcher) view + Plus
  section("dispatcher + plus");
  s = await open("dispatcher", "org-a-dispatcher@example.test");
  await go("/operations/getting-started");
  const d = await page();
  check("S1 Dispatcher: admin-only steps (business, services, team) have NO Settings link and say an Organization Admin completes them",
    ["business", "services", "team"].every((k) => d.steps[k] && d.steps[k].link === null && /Organization Admin completes this in Settings/.test(d.steps[k].text)), JSON.stringify(d.steps.team));
  check("S2 Dispatcher: the team step makes no claim (admin-only fact)", d.steps.team.state === "unknown" && /Managed by an Organization Admin/.test(d.steps.team.text), d.steps.team.text);
  check("S3 Dispatcher: operational steps keep their links (e.g. First trip -> New trip)", ["vehicle", "trip"].every((k) => d.steps[k]?.link) || ["vehicle", "trip"].every((k) => d.steps[k]?.state === "true"), JSON.stringify(d.steps.trip));
  await s.screenshot(path.join(SHOTS, "g05-getting-started-dispatcher.png"));
  await go("/operations/settings/organization");
  check("S4 Dispatcher cannot open Settings directly (server guard unchanged)", !(await ev("location.pathname")).startsWith("/operations/settings"), await ev("location.pathname"));

  sql(`delete from organization_modules where organization_id = '${ORG_A}';
       insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'onboarding e2e');`);
  s = await open("admin-a", "org-a-admin@example.test");
  await go("/operations/getting-started");
  const a = await page();
  check("P1 Core + Plus: an Organization Admin with Growth sees the optional Growth steps (contacts, quotes) from real counts",
    a.growth && ["growth_contact", "growth_quote"].every((k) => ["true", "false"].includes(a.steps[k]?.state)) && a.steps.growth_contact.link === "/operations/growth/contacts", JSON.stringify({ c: a.steps.growth_contact?.state, q: a.steps.growth_quote?.state }));
  await s.screenshot(path.join(SHOTS, "g06-getting-started-plus.png"));
  await axe("Getting started page (Core + Plus)");
} catch (e) {
  fails++; console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  for (const x of sessions) await x.close().catch(() => {});
  try { sql(`delete from organization_modules where organization_id = '${ORG_A}'`); } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
  // The signed-up fictional workspace is left in place (unique name per run), like the QA2 sign-up check; a stack reset removes it.
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
