// NP-DRIVER-UX-02 -- Driver navigation correctness + Driver Today priority, browser + SQL E2E at 390px on the ISOLATED
// stack (NemrynS1Iso + `next start -p 3100`). FICTIONAL data only; the plus-quotes config refuses any other target.
//   node tests/e2e/driver-nav/driver-nav.e2e.mjs
// Covers: Navigate = Google Maps DRIVING DIRECTIONS (api=1, destination, travelmode=driving) to the PICKUP before
// Passenger Onboard and to the DROP-OFF after it, through real UI lifecycle taps; encoded destinations; no Navigate and
// "Address missing — contact dispatch." for a blank stop; Navigate never changes Trip state; Driver Today puts a trip in
// progress first (including one from a previous day and one with no scheduled time); other drivers / organizations
// cannot open the fixtures. Never follows the external link (no traffic to Google).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const DRIVER_A2 = "30000000-0000-0000-0000-0000000000a2", USER_A2 = "20000000-0000-0000-0000-0000000000a4";
const VAN_A2 = "50000000-0000-0000-0000-0000000000a2";
const TAG = "DRVNAV";
const OUT = artifactDir("driver-nav");
mkdirSync(OUT, { recursive: true });
let fails = 0, passes = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const one = (q) => sql(q).split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|UPDATE \d+|INSERT 0 \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
const at = (dayOffset, hm) => `((((now() at time zone 'America/New_York')::date + ${dayOffset}) + time '${hm}') at time zone 'America/New_York')`;
const nowPlus = (mins) => `(now() + interval '${mins} minutes')`;

// ---------------------------------------------------------------- fixtures
function cleanup() {
  sql(`
    delete from trip_events where trip_id in (select id from trips where pickup_description like '${TAG}%' or pickup_description = '   ');
    delete from driver_location_updates where trip_id in (select id from trips where pickup_description like '${TAG}%' or pickup_description = '   ');
    delete from trip_assignments where trip_id in (select id from trips where pickup_description like '${TAG}%' or pickup_description = '   ');
    delete from trips where pickup_description like '${TAG}%' or pickup_description = '   ';
    delete from passengers where display_name like '${TAG}%';
  `);
}
cleanup();
// Isolate Driver A2 from the seed's own active trips (isolated DB only; every suite resets the database).
sql(`update trip_assignments set ended_at = now(), end_reason = 'reassigned' where driver_id = '${DRIVER_A2}' and ended_at is null`);
const PAX = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', '${TAG} Fictional Rider', '404-555-0191') returning id`);
const PICKUP = `${TAG} 12 Fictional Lane, Fictional City, GA 30000`;
const DROPOFF = `${TAG} Fictional Clinic, 9 Test Rd & Main St, Suite #2, Fictional City, GA 30001`;
const mkTrip = (state, when, pickup, dest) => {
  const id = one(`insert into trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description, destination_description)
                  values ('${ORG_A}', '${PAX}', '${state}', ${when}, '${pickup.replace(/'/g, "''")}', '${dest.replace(/'/g, "''")}') returning id`);
  sql(`insert into trip_assignments (organization_id, trip_id, driver_id, vehicle_id) values ('${ORG_A}', '${id}', '${DRIVER_A2}', '${VAN_A2}')`);
  return id;
};
const NAV = mkTrip("scheduled", nowPlus(90), PICKUP, DROPOFF);
const EARLY = mkTrip("scheduled", nowPlus(-30), `${TAG} Early Pickup Rd, Fictional City, GA 30002`, `${TAG} Early Dropoff Ave, Fictional City, GA 30003`);
const BLANK = mkTrip("scheduled", nowPlus(240), `${TAG} 1 Known Pickup St, Fictional City, GA 30004`, "   ");
const state = (id) => one(`select state from trips where id = '${id}'`);
check("FX fixtures: NAV (today +90 min), EARLY (today -30 min, not started), BLANK (blank drop-off), all assigned to Driver A2", [PAX, NAV, EARLY, BLANK].every((v) => /^[0-9a-f-]{36}$/.test(v)));

// ---------------------------------------------------------------- browser helpers
const sessions = [];
let s;
const ev = (x) => s.evaluate(x);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const href = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('href') ?? null`);
async function go(p) { await s.setViewport(390, 844); await s.nav(`${APP}${p}`, 2200); await waitFor(async () => (await ev("document.readyState")) === "complete", 10000); await sleep(700); }
async function open(name, email) { const x = await newChromeSession(`driver-nav-${name}`); sessions.push(x); await x.setViewport(390, 844); if (email) await signIn(x, email, SEED_PASSWORD); return x; }
const tapPrimary = (label) => ev(`(function(){const b=[...document.querySelectorAll('form button[type="submit"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled); if(!b) return false; b.click(); return true;})()`);
const parse = (u) => { const url = new URL(u); return { base: url.origin + url.pathname, api: url.searchParams.get("api"), destination: url.searchParams.get("destination"), travelmode: url.searchParams.get("travelmode"), keys: [...url.searchParams.keys()].join(",") }; };
const nextCard = async () => ({ label: await ev(`(function(){const l=[...document.querySelectorAll('main p')].find(p => /^(In Progress|Next Trip)$/i.test(p.innerText.trim())); return l ? l.innerText.trim() : '';})()`),
  href: await ev(`(function(){const a=[...document.querySelectorAll('main a')].find(a => a.innerText.trim() === 'View Trip'); return a ? a.getAttribute('href') : null;})()`) });

try {
  s = await open("a2", "org-a-driver-b@example.test");

  section("Driver Today: no trip in progress -> earliest scheduled is next");
  await go("/driver");
  let card = await nextCard();
  check("T1 with nothing in progress, the dominant card is the EARLIEST scheduled trip, labelled 'Next Trip'", card.href === `/driver/trips/${EARLY}` && /next trip/i.test(card.label), JSON.stringify(card));

  section("Navigation per state, driven by the real lifecycle buttons (390px)");
  const steps = [
    ["scheduled", "pickup", "Start to Pickup"],
    ["en_route_to_pickup", "pickup", "I'VE ARRIVED"],
    ["arrived_at_pickup", "pickup", "Passenger Onboard"],
    ["passenger_onboard", "destination", "Start to Destination"],
    ["en_route_to_destination", "destination", "I'VE ARRIVED"],
    ["arrived_at_destination", "destination", null],
  ];
  for (const [st, leg, nextLabel] of steps) {
    await go(`/driver/trips/${NAV}`);
    const pickupHref = await href('[data-testid="driver-navigate-pickup"]');
    const destHref = await href('[data-testid="driver-navigate-destination"]');
    const live = leg === "pickup" ? pickupHref : destHref;
    const other = leg === "pickup" ? destHref : pickupHref;
    const p = live ? parse(live) : {};
    check(`N-${st} Navigate targets the ${leg.toUpperCase()} with official directions parameters; the other stop has no Navigate`,
      state(NAV) === st && live && p.base === "https://www.google.com/maps/dir/" && p.api === "1" && p.travelmode === "driving" && p.keys === "api,destination,travelmode"
        && p.destination === (leg === "pickup" ? PICKUP : DROPOFF) && other === null,
      JSON.stringify({ state: state(NAV), p, other }));
    const label = await text(`[data-testid="driver-navigate-${leg === "pickup" ? "pickup" : "destination"}"]`);
    check(`L-${st} the action names the stop ('Navigate to ${leg === "pickup" ? "Pickup" : "Drop-off"}') and opens externally (target=_blank, noopener)`,
      label.includes(leg === "pickup" ? "Navigate to Pickup" : "Navigate to Drop-off")
        && (await ev(`(function(){const a=document.querySelector('[data-testid="driver-navigate-${leg === "pickup" ? "pickup" : "destination"}"]'); return a.target === '_blank' && /noopener/.test(a.rel);})()`)), label);
    if (st === "scheduled") {
      // Navigate must never change Trip state: dispatch a real click with the external navigation prevented (no traffic to
      // Google), wait, re-read the database and the page.
      const before = state(NAV);
      await ev(`(function(){const a=document.querySelector('[data-testid="driver-navigate-pickup"]'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return true;})()`);
      await sleep(2500);
      await go(`/driver/trips/${NAV}`);
      check("X1 tapping Navigate does NOT change the Trip state (still 'scheduled'; the primary action still offers Start to Pickup)",
        before === "scheduled" && state(NAV) === "scheduled" && (await ev(`[...document.querySelectorAll('form button')].some(b => b.textContent.trim() === 'Start to Pickup')`)));
      await s.screenshot(path.join(OUT, "n01-scheduled-navigate-pickup-390.png"));
    }
    if (st === "passenger_onboard") await s.screenshot(path.join(OUT, "n04-onboard-navigate-dropoff-390.png"));
    if (nextLabel) {
      const target = { scheduled: "en_route_to_pickup", en_route_to_pickup: "arrived_at_pickup", arrived_at_pickup: "passenger_onboard", passenger_onboard: "en_route_to_destination", en_route_to_destination: "arrived_at_destination" }[st];
      const tapped = await tapPrimary(nextLabel);
      const moved = await waitFor(() => state(NAV) === target, 15000);
      check(`S-${st} '${nextLabel}' advances exactly one step to ${target}`, tapped && moved, state(NAV));
      if (st === "scheduled") {
        section("Driver Today: a trip in progress outranks an earlier, unstarted trip");
        await go("/driver");
        card = await nextCard();
        check("T2 once NAV is in progress it is the dominant card, labelled 'In Progress', although EARLY is scheduled earlier",
          card.href === `/driver/trips/${NAV}` && /in progress/i.test(card.label) && (await text("main")).includes(`${TAG} Early Pickup Rd`), JSON.stringify(card));
        await s.screenshot(path.join(OUT, "t02-today-in-progress-first-390.png"));
      }
    }
  }

  section("Encoded destination round-trips exactly");
  await go(`/driver/trips/${NAV}`);
  const raw = await href('[data-testid="driver-navigate-destination"]');
  check("E1 '&' and '#' are percent-encoded in the href and decode back to the recorded drop-off exactly",
    /%26/.test(raw) && /%23/.test(raw) && !raw.split("destination=")[1].split("&travelmode")[0].includes("&") && parse(raw).destination === DROPOFF, raw);

  section("Missing drop-off: no Navigate, explicit message");
  // Advance BLANK to passenger_onboard through the approved driver RPCs (as Driver A2) so the drop-off is the live leg.
  for (const [fn, from] of [["driver_start_to_pickup", "scheduled"], ["driver_arrive_at_pickup", "en_route_to_pickup"], ["driver_mark_passenger_onboard", "arrived_at_pickup"]]) {
    sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${USER_A2}'; select (public.${fn}('${BLANK}', '${from}')).*; commit;`);
  }
  await go(`/driver/trips/${BLANK}`);
  const missing = await text('[data-testid="driver-destination-address"]');
  check("M1 blank drop-off on the live leg: shows 'Address missing — contact dispatch.' and NO Navigate link (no link built from placeholder text)",
    state(BLANK) === "passenger_onboard" && missing.trim() === "Address missing — contact dispatch." && !(await has('[data-testid="driver-navigate-destination"]'))
      && !(await ev(`[...document.querySelectorAll('a')].some(a => /google\\.com\\/maps/.test(a.href))`)), JSON.stringify({ state: state(BLANK), missing }));
  check("M2 the primary lifecycle action is still available (a missing address never blocks the trip)", await ev(`[...document.querySelectorAll('form button')].some(b => b.textContent.trim() === 'Start to Destination')`));
  await s.screenshot(path.join(OUT, "m01-missing-dropoff-390.png"));

  section("Driver Today: in-progress trips from a previous day / without a time");
  const YDAY = mkTrip("passenger_onboard", at(-1, "23:10"), `${TAG} Yesterday Pickup Ln, Fictional City, GA 30005`, `${TAG} Yesterday Drop Blvd, Fictional City, GA 30006`);
  const UNTIMED = mkTrip("arrived_at_pickup", "null", `${TAG} Untimed Pickup Ct, Fictional City, GA 30007`, `${TAG} Untimed Drop Way, Fictional City, GA 30008`);
  await go("/driver");
  card = await nextCard();
  const todayText = await text("main");
  const order = ["Yesterday Pickup Ln", "12 Fictional Lane", "Untimed Pickup Ct", "Early Pickup Rd"].map((n) => todayText.indexOf(`${TAG} ${n}`));
  check("T3 Today lists the in-progress trip scheduled YESTERDAY and the in-progress trip with NO time; all in-progress trips come before the unstarted one",
    order.every((i) => i >= 0) && order[0] < order[3] && order[1] < order[3] && order[2] < order[3] && card.href === `/driver/trips/${YDAY}` && /in progress/i.test(card.label), JSON.stringify({ order, card }));
  check("T4 the untimed in-progress trip is listed with a link and shows 'Time TBD' rather than disappearing",
    todayText.includes("Time TBD") && (await has(`main a[href="/driver/trips/${UNTIMED}"]`)));
  await s.screenshot(path.join(OUT, "t03-today-previous-day-and-untimed-390.png"));
  await injectAxe(s);
  const axeRes = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id))`);
  check("A1 Driver Today (390px): 0 serious / critical axe violations", axeRes.length === 0, JSON.stringify(axeRes));
  await go(`/driver/trips/${NAV}`);
  await injectAxe(s);
  const axeTrip = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id))`);
  check("A2 Active Trip (390px): 0 serious / critical axe violations", axeTrip.length === 0, JSON.stringify(axeTrip));
  const tgt = await ev(`(function(){const a=document.querySelector('[data-testid="driver-navigate-destination"]'); const r=a.getBoundingClientRect(); return Math.round(r.height);})()`);
  check("A3 Navigate touch target ≥ 40px high at 390px", tgt >= 40, `${tgt}px`);

  section("Authorization: other drivers / organizations");
  const a1 = await open("a1", "org-a-driver-a@example.test");
  s = a1; await go(`/driver/trips/${NAV}`);
  check("Z1 another driver in the same organization cannot open the trip (Trip unavailable; no Navigate, no address)",
    /Trip unavailable/.test(await text("main")) && !(await has('[data-testid="driver-navigate-destination"]')) && !(await text("body")).includes(PICKUP));
  const b = await open("b", "org-b-driver@example.test");
  s = b; await go(`/driver/trips/${NAV}`);
  check("Z2 a driver in another organization cannot open the trip", !(await text("body")).includes(PICKUP) && !(await has('[data-testid="driver-navigate-destination"]')));
  s = sessions[0];
} catch (e) {
  check("unexpected error", false, e.stack || e.message);
} finally {
  for (const x of sessions) { try { await x.close(); } catch {} }
  try { cleanup(); } catch {}
}
console.log(`\nRESULT: ${fails === 0 ? "ALL PASS" : `${fails} FAILED`}  (${passes} passed; artifacts: ${OUT})`);
process.exit(fails === 0 ? 0 : 1);
