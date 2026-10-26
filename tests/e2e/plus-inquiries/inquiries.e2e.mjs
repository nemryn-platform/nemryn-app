// NP-P2-S7-B -- public Nemryn Plus inquiry form: browser + API E2E on the ISOLATED stack (NemrynS1Iso + `next start -p 3100`).
// FICTIONAL data only; the plus-quotes config refuses any other target (assertFictionalSeed). Run twice:
//   INQUIRY_E2E_MODE=on  node tests/e2e/plus-inquiries/inquiries.e2e.mjs   # app started with PLUS_INQUIRY_SUBMISSIONS=on
//   INQUIRY_E2E_MODE=off node tests/e2e/plus-inquiries/inquiries.e2e.mjs   # app started WITHOUT it (the production default)
// Fixtures (owner SQL, committed, removed at the end): a published form for Org A (allowlisted) and Org B (NOT allowlisted),
// Org A service offerings including airport_transportation. Nothing outside the two fictional seed organizations is touched.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { sleep, newChromeSession, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, sql, artifactDir, assertFictionalSeed } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const MODE = process.env.INQUIRY_E2E_MODE;
if (MODE !== "on" && MODE !== "off") throw new Error("set INQUIRY_E2E_MODE=on|off to match how the app was started");
const OUT = artifactDir(`plus-inquiries-${MODE}`);
const ORG_A = "10000000-0000-0000-0000-0000000000a1", ORG_B = "10000000-0000-0000-0000-0000000000b1";
const U_A = "20000000-0000-0000-0000-0000000000a1", U_B = "20000000-0000-0000-0000-0000000000b1";
const STAMP = Date.now().toString(36);
let fails = 0, passes = 0;
const check = (name, ok, detail = "") => { ok ? passes++ : fails++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail !== "" ? " :: " + String(detail).slice(0, 300) : ""}`); };
const one = (q) => sql(q).trim();

// ---------------------------------------------------------------- fixtures
const prevOfferings = one(`select coalesce(string_agg(service_type, ','), '') from organization_service_offerings where organization_id = '${ORG_A}'`);
sql(`
  delete from plus_inquiries where organization_id in ('${ORG_A}', '${ORG_B}');
  delete from plus_inquiry_forms where organization_id in ('${ORG_A}', '${ORG_B}');
  delete from plus_inquiry_public_access where organization_id in ('${ORG_A}', '${ORG_B}');
  delete from organization_modules where organization_id in ('${ORG_A}', '${ORG_B}');
  insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'S7-B e2e'), ('${ORG_B}', 'plus', 'active', 'S7-B e2e');
  delete from organization_service_offerings where organization_id = '${ORG_A}';
  insert into organization_service_offerings (organization_id, service_type) values ('${ORG_A}', 'dialysis'), ('${ORG_A}', 'medical_appointment'), ('${ORG_A}', 'airport_transportation');
  insert into plus_inquiry_forms (organization_id, status, headline, intro_text, offered_service_types, consent_text_version, published_at, published_by, created_by, updated_by)
    values ('${ORG_A}', 'published', 'Questions about our rides', 'Ask about prices, availability or services. We usually reply within one business day.', array['medical_appointment','dialysis'], 'plus-inquiry-consent-v1', now(), '${U_A}', '${U_A}', '${U_A}'),
           ('${ORG_B}', 'published', 'Org B questions', null, '{}', 'plus-inquiry-consent-v1', now(), '${U_B}', '${U_B}', '${U_B}');
  insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG_A}', 'S7-B local synthetic e2e', '${U_A}');
`);
const KEY_A = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG_A}'`);
const KEY_B = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG_B}'`);
const FORM_VER = Number(one(`select config_version from plus_inquiry_forms where organization_id = '${ORG_A}'`));
const counts = () => one(`select (select count(*) from plus_contacts) || '/' || (select count(*) from plus_opportunities) || '/' || (select count(*) from plus_communication_consents) || '/' || (select count(*) from transportation_requests) || '/' || (select count(*) from passengers) || '/' || (select count(*) from trips) || '/' || (select count(*) from notification_events)`);
const inquiries = (where = "true") => Number(one(`select count(*) from plus_inquiries where organization_id in ('${ORG_A}', '${ORG_B}') and ${where}`));
const before = counts();

let ip = 10;
const post = async (key, body, { origin, forwardedFor, raw } = {}) => {
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor ?? `198.51.100.${(ip++ % 250) + 1}` };
  if (origin !== undefined) headers.Origin = origin;
  const r = await fetch(`${APP}/api/plus-inquiries/${key}/submit`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
};
const payload = (over = {}) => ({ idempotencyKey: `e2e-${STAMP}-${Math.random().toString(36).slice(2, 10)}`, configVersion: FORM_VER, name: "Fictional Asker", phone: "(404) 555-0170", email: null, preferredReply: "either", relationship: "family", inquiryType: "quote", serviceType: null, timeframe: "this_week", question: "How much is a ride to the dialysis center?", consentFollowup: false, consentMarketing: false, ...over });

let staticServer = null;
const s = await newChromeSession(`plus-inquiries-${MODE}`);
const ev = (x) => s.evaluate(x);
const go = async (url, w = 1280, h = 1000) => { await s.setViewport(w, h); await s.nav(url, 2200); await sleep(300); };
try {
  if (MODE === "off") {
    // ================================================================ kill switch OFF (production default)
    const cfg = await fetch(`${APP}/api/plus-inquiries/${KEY_A}`);
    check("OFF1 config GET for an allowlisted, published form -> 404", cfg.status === 404, cfg.status);
    const r = await post(KEY_A, payload());
    check("OFF2 a valid submission to an allowlisted, published form -> 404, nothing stored", r.status === 404 && inquiries() === 0, `${r.status} ${r.body}`);
    await go(`${APP}/inquiry/${KEY_A}`);
    check("OFF3 hosted page shows the neutral unavailable state (no form)", (await ev(`!!document.querySelector('[data-testid="public-inquiry-unavailable"]') && !document.querySelector('[data-testid="public-inquiry-form"]')`)));
    await go(`${APP}/embed/inquiry/${KEY_A}`);
    check("OFF4 embed page shows the neutral unavailable state", (await ev(`!!document.querySelector('[data-testid="public-inquiry-unavailable"]')`)));
    check("OFF5 no Plus / Core side effects", counts() === before, `${before} -> ${counts()}`);
  } else {
    // ================================================================ hosted page + availability
    await go(`${APP}/inquiry/${KEY_A}`);
    const hosted = await ev(`(function(){const f=document.querySelector('[data-testid="public-inquiry-form"]'); const svc=document.getElementById('iq-serviceType'); return { form: !!f, h1: [...document.querySelectorAll('h1')].map(h=>h.textContent.trim()), org: document.body.innerText.includes('Fictional Org A') || document.body.innerText.length>0, services: svc ? [...svc.options].map(o=>o.value).filter(Boolean) : null, consent: [...document.querySelectorAll('[data-testid="public-inquiry-consent"] input[type=checkbox]')].map(i=>i.checked), robots: document.querySelector('meta[name=robots]')?.content };})()`);
    check("H1 hosted form renders: one h1 (the headline), services = offered ∩ organization offerings (no airport), consent boxes present and UNTICKED, noindex",
      hosted.form && JSON.stringify(hosted.h1) === JSON.stringify(["Questions about our rides"]) && JSON.stringify(hosted.services) === JSON.stringify(["medical_appointment", "dialysis"]) && JSON.stringify(hosted.consent) === "[false,false]" && /noindex/.test(hosted.robots ?? ""), JSON.stringify(hosted));
    const hdr = await fetch(`${APP}/inquiry/${KEY_A}`);
    check("H2 hosted page headers: frame-ancestors 'none', X-Frame-Options DENY, noindex, no-store",
      /frame-ancestors 'none'/.test(hdr.headers.get("content-security-policy") ?? "") && hdr.headers.get("x-frame-options") === "DENY" && /noindex/.test(hdr.headers.get("x-robots-tag") ?? "") && /no-store/.test(hdr.headers.get("cache-control") ?? ""));
    await s.screenshot(path.join(OUT, "hosted-1280.png"));
    await go(`${APP}/inquiry/${KEY_B}`);
    check("H3 Org B (published but NOT allowlisted) -> the same neutral unavailable page", (await ev(`!!document.querySelector('[data-testid="public-inquiry-unavailable"]') && !document.querySelector('form')`)));
    await go(`${APP}/inquiry/inq_${"0".repeat(32)}`);
    const unknown = await ev(`document.body.innerText`);
    await go(`${APP}/inquiry/not-a-key`);
    check("H4 unknown and malformed keys -> the identical unavailable page (no enumeration)", unknown === (await ev(`document.body.innerText`)) && /isn't available/.test(unknown));
    const cfgB = await fetch(`${APP}/api/plus-inquiries/${KEY_B}`);
    const cfgA = await (await fetch(`${APP}/api/plus-inquiries/${KEY_A}`)).json();
    check("H5 config API: Org A public fields only (no ids / settings); Org B -> 404",
      cfgB.status === 404 && cfgA.ok && JSON.stringify(Object.keys(cfgA.form).sort()) === JSON.stringify(["configVersion", "consentTextVersion", "headline", "introText", "organizationName", "services"]) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(cfgA)), JSON.stringify(cfgA));

    // ================================================================ UI validation + accessibility + submission
    await go(`${APP}/inquiry/${KEY_A}`);
    await ev(`document.querySelector('[data-testid="public-inquiry-submit"]').click()`); await sleep(400);
    const v = await ev(`(function(){const b=document.querySelector('[data-testid="public-inquiry-banner"]'); return { banner: b.innerText, focused: document.activeElement === b, invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map(e=>e.id).sort() };})()`);
    check("V1 empty submit: error summary focused, invalid fields marked (aria-invalid), nothing sent",
      /check the highlighted/.test(v.banner) && v.focused && JSON.stringify(v.invalid) === JSON.stringify(["iq-inquiryType", "iq-name", "iq-phone", "iq-question"]) && inquiries() === 0, JSON.stringify(v));
    const fill = (id, value) => ev(`(function(){const el=document.getElementById(${JSON.stringify(id)}); const proto = el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    await fill("iq-name", "Fictional Asker One");
    await fill("iq-phone", "(404) 555-0181");
    await fill("iq-email", "asker-one@example.test");
    await fill("iq-inquiryType", "availability");
    await fill("iq-serviceType", "dialysis");
    await fill("iq-timeframe", "this_month");
    await fill("iq-question", "Do you have rides on Saturdays to the dialysis center? (fictional)");
    await ev(`document.getElementById('iq-consentFollowup').click()`);
    await ev(`document.querySelector('[data-testid="public-inquiry-submit"]').click()`); await sleep(2000);
    const done = await ev(`(function(){const c=document.querySelector('[data-testid="public-inquiry-confirmation"]'); return { shown: !!c, focused: document.activeElement === c, text: c?.innerText };})()`);
    const row = one(`select name || '|' || coalesce(email,'') || '|' || inquiry_type || '|' || coalesce(service_type,'') || '|' || consent_followup || '|' || consent_marketing || '|' || status || '|' || form_config_version || '|' || coalesce(landing_path,'') from plus_inquiries where organization_id = '${ORG_A}' and name = 'Fictional Asker One'`);
    check("S1 valid UI submission: confirmation shown + focused; ONE inquiry stored (status new, consent as ticked, landing path)",
      done.shown && done.focused && row === `Fictional Asker One|asker-one@example.test|availability|dialysis|true|false|new|${FORM_VER}|/inquiry/${KEY_A}`, `${JSON.stringify(done)} ${row}`);
    check("S2 the submission created NO contact, opportunity, consent, Core Request, Passenger, Trip or notification", counts() === before, `${before} -> ${counts()}`);
    await s.screenshot(path.join(OUT, "hosted-confirmation-1280.png"));

    // ================================================================ API: idempotency, concurrency, closed schema, origin, size
    const p = payload({ name: "Fictional Replay" });
    const r1 = await post(KEY_A, p), r2 = await post(KEY_A, p);
    check("A1 the same idempotency key twice -> 200 both, ONE row", r1.status === 200 && r2.status === 200 && inquiries(`name = 'Fictional Replay'`) === 1, `${r1.status} ${r2.status}`);
    const pc = payload({ name: "Fictional Concurrent" });
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(KEY_A, pc)));
    check("A2 six concurrent submissions with one key -> all 200, ONE row", rs.every((r) => r.status === 200) && inquiries(`name = 'Fictional Concurrent'`) === 1, rs.map((r) => r.status).join(","));
    const forb = await post(KEY_A, { ...payload({ name: "Fictional Forbidden" }), organizationId: ORG_B });
    check("A3 a forbidden key (organizationId) -> 400, nothing stored", forb.status === 400 && inquiries(`name = 'Fictional Forbidden'`) === 0, forb.status);
    const evil = await post(KEY_A, payload({ name: "Fictional Evil Origin" }), { origin: "https://evil.example" });
    check("A4 a foreign browser Origin -> 400, nothing stored", evil.status === 400 && inquiries(`name = 'Fictional Evil Origin'`) === 0, evil.status);
    const big = await post(KEY_A, null, { raw: JSON.stringify(payload({ question: "x" })) + " ".repeat(9000) });
    check("A5 a body over 8 KB -> 400", big.status === 400, big.status);
    const bad = await post(KEY_A, null, { raw: "{not json" });
    check("A6 malformed JSON -> 400", bad.status === 400, bad.status);
    const airport = await post(KEY_A, payload({ name: "Fictional Airport", serviceType: "airport_transportation" }));
    const notOffered = await post(KEY_A, payload({ name: "Fictional Rehab", serviceType: "rehabilitation" }));
    check("A7 airport_transportation (even though the org offers it) and a service the form does not offer -> 400, nothing stored",
      airport.status === 400 && notOffered.status === 400 && inquiries(`name in ('Fictional Airport','Fictional Rehab')`) === 0, `${airport.status} ${notOffered.status}`);
    const stale = await post(KEY_A, payload({ name: "Fictional Stale", configVersion: FORM_VER + 5 }));
    check("A8 a config version other than the live one -> 409 form_changed, nothing stored", stale.status === 409 && /form_changed/.test(stale.body) && inquiries(`name = 'Fictional Stale'`) === 0, stale.status);
    const crossB = await post(KEY_B, payload({ name: "Fictional Cross Tenant" }));
    check("A9 cross-tenant: a submission to Org B's (not allowlisted) key -> 404, nothing stored in either org", crossB.status === 404 && inquiries(`name = 'Fictional Cross Tenant'`) === 0, crossB.status);
    const minimal = (r) => !/[0-9a-f]{8}-[0-9a-f]{4}-|ZW\d|sql|plus_/i.test(r.body);
    check("A10 responses never expose ids, ZW codes or database names", [r1, forb, evil, stale, crossB, airport].every(minimal));
    const limited = [];
    for (let i = 0; i < 6; i++) limited.push((await post(KEY_A, payload({ name: `Fictional Rate ${i}` }), { forwardedFor: "203.0.113.77" })).status);
    check("A11 rate limit: 5 per client per hour, the 6th -> 429 (generic body)", JSON.stringify(limited) === "[200,200,200,200,200,429]" && inquiries(`name like 'Fictional Rate %'`) === 5, limited.join(","));

    // ================================================================ disabled / un-allowlisted at runtime
    sql(`update plus_inquiry_forms set status = 'disabled', disabled_at = now(), disabled_by = '${U_A}' where organization_id = '${ORG_A}'`);
    const dis = await post(KEY_A, payload({ name: "Fictional After Disable" }));
    sql(`update plus_inquiry_forms set status = 'published', disabled_at = null where organization_id = '${ORG_A}'`);
    sql(`delete from plus_inquiry_public_access where organization_id = '${ORG_A}'`);
    const unl = await post(KEY_A, payload({ name: "Fictional After Removal" }));
    sql(`insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG_A}', 'S7-B local synthetic e2e', '${U_A}')`);
    check("D1 a disabled form and a removed allowlist entry -> 404 immediately, nothing stored",
      dis.status === 404 && unl.status === 404 && inquiries(`name in ('Fictional After Disable','Fictional After Removal')`) === 0, `${dis.status} ${unl.status}`);

    // ================================================================ embed on a separate origin
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s7b-embed-"));
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional agency site</title></head><body style="font-family:sans-serif;margin:0;padding:24px;background:#f4f4f5"><h1>Fictional Agency — Questions</h1><div data-nemryn-inquiry-form="${KEY_A}"></div><script src="${APP}/embed/inquiry-form.js" async></script></body></html>`);
    staticServer = spawn("python3", ["-m", "http.server", "3199", "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
    await sleep(1200);
    await go(`http://127.0.0.1:3199/?utm_source=newsletter&gclid=dropme`, 1280, 1100);
    await sleep(2500);
    const emb = await ev(`(function(){const f=document.querySelector('iframe'); return f ? { src: f.src, height: f.style.height, title: f.title } : null;})()`);
    check("E1 the loader mounts ONE iframe on a foreign-origin agency page and auto-resizes it (height reported by the form)",
      emb && emb.src === `${APP}/embed/inquiry/${KEY_A}` && emb.title === "Ask a question" && /^\d+px$/.test(emb.height) && emb.height !== "720px", JSON.stringify(emb));
    await s.screenshot(path.join(OUT, "embed-agency-page-1280.png"));
    const ehdr = await fetch(`${APP}/embed/inquiry/${KEY_A}`);
    const lhdr = await fetch(`${APP}/embed/inquiry-form.js`);
    check("E2 embed page frameable (frame-ancestors *) + noindex; loader nosniff + short public cache",
      /frame-ancestors \*/.test(ehdr.headers.get("content-security-policy") ?? "") && /noindex/.test(ehdr.headers.get("x-robots-tag") ?? "") && lhdr.headers.get("x-content-type-options") === "nosniff" && /max-age=300/.test(lhdr.headers.get("cache-control") ?? ""));

    // ================================================================ mobile + axe
    for (const w of [390, 768]) {
      await go(`${APP}/inquiry/${KEY_A}`, w, 900);
      const m = await ev(`({ overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth, form: !!document.querySelector('[data-testid="public-inquiry-form"]'), smallTargets: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea,button')].filter(e=>e.getBoundingClientRect().height<40).map(e=>e.id||e.textContent.trim()) })`);
      check(`M1 ${w}px: form usable, no horizontal overflow, inputs / buttons at least 40px tall`, m.form && m.overflow <= 0 && m.smallTargets.length === 0, JSON.stringify(m));
      await s.screenshot(path.join(OUT, `hosted-${w}.png`));
    }
    for (const [url, w] of [[`${APP}/inquiry/${KEY_A}`, 1280], [`${APP}/inquiry/${KEY_A}`, 390], [`${APP}/inquiry/${KEY_B}`, 1280]]) {
      await go(url, w); await injectAxe(s);
      const ax = await ev(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id))`);
      check(`X1 axe ${url.includes(KEY_B) ? "unavailable page" : "form"} @${w}: 0 serious / critical`, ax.length === 0, ax.join(","));
    }
    check("Z1 across the whole run: no contact, opportunity, consent, Core Request, Passenger, Trip or notification created", counts() === before, `${before} -> ${counts()}`);
  }
} catch (e) {
  fails++;
  console.log("FAIL — unexpected :: " + (e.stack || e));
} finally {
  await s.close();
  if (staticServer) staticServer.kill();
  sql(`
    delete from plus_inquiries where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from plus_inquiry_rate_limit_events where form_public_key in ('${KEY_A}', '${KEY_B}');
    delete from plus_inquiry_forms where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from plus_inquiry_public_access where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from organization_service_offerings where organization_id = '${ORG_A}';
    ${prevOfferings ? `insert into organization_service_offerings (organization_id, service_type) select '${ORG_A}', unnest(string_to_array('${prevOfferings}', ','));` : ""}
  `);
}
console.log(`\nRESULT (${MODE}): ${fails === 0 ? "ALL PASS" : fails + " FAILED"} (${passes} passed)  artifacts: ${OUT}`);
process.exit(fails ? 1 : 0);
