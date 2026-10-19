// NP-P2-S5-S2 local browser E2E -- Quotes panel + draft create / edit / withdraw on the Growth Opportunity page.
// ISOLATED Supabase stack (NemrynS1Iso) + `next start -p 3100`; FICTIONAL seed identities and data only.
//   npm run test:e2e:quotes -- s2      (or: node tests/e2e/plus-quotes/s2-drafts.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { sleep, newChromeSession, signIn } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("s2");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 60_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK)$/.test(l))[0]?.trim() ?? "";
/** run one statement as a signed-in staff member (the REAL RPCs) -> first result line */
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
async function go(s, p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 10000); await sleep(900); }
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const val = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
const setField = (s, sel, value) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const click = (s, sel) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const memId = (uid) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${ORG_A}'`));
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (name) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by)
  values ('${ORG_A}', '${name}', '(404) 555-0173', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${U.a1}') returning id`));
const opp = (title, contactId, service = "dialysis") => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by)
  values ('${ORG_A}', '${title}', 'qualified', '${contactId}', 'phone', ${service ? `'${service}'` : "null"}, '${U.a1}') returning id`));
const quotes = (o) => sql(`select coalesce(string_agg(status || ':' || total_cents, ',' order by quote_number), '') from plus_quotes where opportunity_id = '${o}'`);
const draftOf = (o) => first(sql(`select id from plus_quotes where opportunity_id = '${o}' and status = 'draft'`));
const createRpc = (o, key, base = 5000) => asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${o}', '${key}', 'quote', null, false, null, ${base}, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 10)).quote_id`);
const ver = (q) => `(select updated_at from public.plus_quotes where id = '${q}')`;
const sessions = [];
const open = async (name, who, w = 1440, h = 1200) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
const futureDate = first(sql(`select ((now() at time zone (select timezone from organizations where id = '${ORG_A}'))::date + 14)::text`));
const today = first(sql(`select ((now() at time zone (select timezone from organizations where id = '${ORG_A}'))::date)::text`));
const SIDE = `select (select count(*) from transportation_requests) || '/' || (select count(*) from trips) || '/' || (select count(*) from passengers) || '/' || (select count(*) from notification_events) || '/' || (select count(*) from plus_tasks)`;

async function fillDraft(s, f) {
  for (const [k, v] of Object.entries(f)) await setField(s, `[data-testid="quote-${k}"]`, v);
  await sleep(300);
}

try {
  section("fixtures (fictional)");
  sql(`delete from organization_modules where organization_id = '${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'NP-P2-S5-S2 E2E')`);
  setGrant("none");
  const K = contact(`S5S2 Quote Pat ${STAMP}`);
  const O1 = opp(`S5S2 Weekly dialysis ${STAMP}`, K, "dialysis");
  const O2 = opp(`S5S2 Retry ${STAMP}`, K, null);
  const O3 = opp(`S5S2 Sent current ${STAMP}`, K, "rehabilitation");
  const O4 = opp(`S5S2 Lost ${STAMP}`, K);
  const O5 = opp(`S5S2 Mobile ${STAMP}`, K, "wheelchair_transportation");
  const O6 = opp(`S5S2 Became sent ${STAMP}`, K);
  const side0 = first(sql(SIDE));

  const admin = await open("s5s2-admin", "org-a-admin@example.test");

  section("E1 panel + empty state for a writer");
  await go(admin, `/operations/growth/pipeline/${O1}`);
  check("E1 Quotes panel renders on the Opportunity page, empty state, other panels intact",
    (await has(admin, '[data-testid="opportunity-quotes"]')) && (await has(admin, '[data-testid="quotes-empty"]'))
    && (await has(admin, '[data-testid="opportunity-details"]')) && (await has(admin, '[data-testid="opportunity-tasks"]')));
  check("E1b writer sees ONE create action; no Mark sent / Revise / Print controls",
    (await has(admin, '[data-testid="quote-create-open"]')) && !(await admin.evaluate(`/Mark sent|Revise|Print/.test(document.querySelector('[data-testid="opportunity-quotes"]').innerText)`)));

  section("E2 create a draft (dollars -> cents, preview, server total)");
  await click(admin, '[data-testid="quote-create-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  check("E2a the opportunity's service is the suggested value; no default validity (OD-Q10); only the 8 Plus services (no airport)",
    (await val(admin, '[data-testid="quote-service"]')) === "dialysis" && (await val(admin, '[data-testid="quote-valid-until"]')) === ""
    && (await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-service"] option')].length`)) === 9
    && !(await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-service"] option')].some(o => o.value === 'airport_transportation')`)));
  check("E2a2 the Valid until picker starts at the organization's own today (min attribute)", (await admin.evaluate(`document.querySelector('[data-testid="quote-valid-until"]').min`)) === today, today);
  check("E2b privacy help text is shown for free-text fields", /medical information/.test(await inner(admin, '[data-testid="quote-form"]')));
  await fillDraft(admin, { base: "75.00", mileage: "25.5", discount: "5" });
  check("E2c live preview total in dollars: 75.00 + 25.50 - 5.00 = $95.50", (await inner(admin, '[data-testid="quote-total-preview"]')) === "$95.50", await inner(admin, '[data-testid="quote-totals"]'));
  await fillDraft(admin, { discount: "500" });
  check("E2d discount over the charges shows an inline error and no total", /more than the charges/.test(await inner(admin, '[data-testid="quote-form"]')) && (await inner(admin, '[data-testid="quote-total-preview"]')) === "—");
  await fillDraft(admin, { discount: "5", base: "75.005" });
  check("E2e more than two decimals is refused inline", /two decimal places/.test(await inner(admin, '[data-testid="quote-form"]')));
  await fillDraft(admin, { base: "75.00" });
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-error"]'), 8000);
  check("E2f saving without Valid until is refused by the server with a field error; nothing written",
    /valid until/i.test(await inner(admin, '[data-testid="quote-form"]')) && (await quotes(O1)) === "");
  await fillDraft(admin, { "valid-until": futureDate, terms: "Fictional terms: price holds for the dates shown." });
  await admin.screenshot(`${SHOTS}e2-create-form.png`);
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 10000);
  await sleep(1200);
  check("E2g saved: confirmation shows the SERVER total; DB has one draft of 9550 cents (base 7500, mileage 2550, discount 500)",
    /Draft saved\. Total \$95\.50/.test(await inner(admin, '[data-testid="quote-saved"]'))
    && (await quotes(O1)) === "draft:9550"
    && first(sql(`select base_cents || '/' || mileage_cents || '/' || discount_cents || '/' || coalesce(service_type,'') || '/' || valid_until from plus_quotes where opportunity_id = '${O1}'`)) === `7500/2550/500/dialysis/${futureDate}`,
    await inner(admin, '[data-testid="opportunity-quotes"]'));
  check("E2h panel now shows the Active draft (Estimate, Draft badge, $95.50 USD); Edit + Withdraw offered; no second create",
    (await has(admin, '[data-testid="quotes-current"] [data-status="draft"]')) && /\$95\.50/.test(await inner(admin, '[data-testid="quotes-current"]'))
    && /Active draft/.test(await inner(admin, '[data-testid="quotes-current"]'))
    && (await has(admin, '[data-testid="quote-edit-open"]')) && (await has(admin, '[data-testid="quote-withdraw-open"]')) && !(await has(admin, '[data-testid="quote-create-open"]')));
  await admin.screenshot(`${SHOTS}e2-panel-draft.png`);

  section("E3 edit the draft (prefilled; optimistic concurrency)");
  await click(admin, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  check("E3a the editor is prefilled with the saved values", (await val(admin, '[data-testid="quote-base"]')) === "75.00" && (await val(admin, '[data-testid="quote-mileage"]')) === "25.50"
    && (await val(admin, '[data-testid="quote-discount"]')) === "5.00" && (await val(admin, '[data-testid="quote-valid-until"]')) === futureDate);
  await fillDraft(admin, { base: "80", kind: "quote", "round-trip": "yes", miles: "12.5", service: "other" });
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 10000);
  await sleep(1200);
  check("E3b saved edit: server total $100.50; kind / round trip / miles / service updated; still ONE draft",
    (await quotes(O1)) === "draft:10050"
    && first(sql(`select kind || '/' || round_trip || '/' || distance_miles || '/' || service_type from plus_quotes where opportunity_id = '${O1}'`)) === "quote/true/12.5/other"
    && /Total \$100\.50/.test(await inner(admin, '[data-testid="quote-saved"]')));

  section("E4 stale edit (someone else changed it)");
  await go(admin, `/operations/growth/pipeline/${O1}`);
  await click(admin, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  const q1 = draftOf(O1);
  asUser(U.a1, `select (public.plus_update_quote_draft('${ORG_A}', '${q1}', ${ver(q1)}, 'quote', 'other', true, 12.5, 9000, 2550, 0, 0, 0, 0, 0, 0, null, 500, 'Fictional terms: price holds for the dates shown.', '${futureDate}')).changed`);
  await fillDraft(admin, { base: "1" });
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-stale"]'), 10000);
  check("E4a the stale save is refused with a plain message + Reload; the other person's change is NOT overwritten",
    /changed this draft/.test(await inner(admin, '[data-testid="quote-stale"]')) && (await has(admin, '[data-testid="quote-reload"]'))
    && (await quotes(O1)) === "draft:11050");
  check("E4b Save is disabled after a stale refusal", await admin.evaluate(`document.querySelector('[data-testid="quote-save"]').disabled`));
  await click(admin, '[data-testid="quote-reload"]');
  await sleep(2000);
  await click(admin, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  check("E4c after Reload the editor shows the latest saved values", (await val(admin, '[data-testid="quote-base"]')) === "90.00");
  await admin.evaluate(`document.querySelector('[data-testid="quote-form"]').closest('dialog').close()`);
  await sleep(500);

  section("E5 a draft that became sent meanwhile cannot be edited or withdrawn");
  await go(admin, `/operations/growth/pipeline/${O6}`);
  const q6 = createRpc(O6, `e2e-s5s2-o6-${STAMP}`);
  await go(admin, `/operations/growth/pipeline/${O6}`);
  await click(admin, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q6}', ${ver(q6)})).status`);
  await fillDraft(admin, { base: "99", "valid-until": futureDate });
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-error"], [data-testid="quote-stale"]'), 10000);
  check("E5a saving an edit of a now-SENT quote is refused (no longer a draft); its sent snapshot is unchanged",
    /no longer a draft|changed this draft/.test(await inner(admin, '[data-testid="quote-form"]')) && (await quotes(O6)) === "sent:5000",
    await inner(admin, '[data-testid="quote-form"]'));
  await go(admin, `/operations/growth/pipeline/${O6}`);
  check("E5b after reload: no Edit / Withdraw / create; the sent quote is Current sent; the OD-Q12 note explains no independent draft is offered",
    !(await has(admin, '[data-testid="quote-edit-open"]')) && !(await has(admin, '[data-testid="quote-withdraw-open"]')) && !(await has(admin, '[data-testid="quote-create-open"]'))
    && /Current sent/.test(await inner(admin, '[data-testid="quotes-current"]')) && (await has(admin, '[data-testid="quote-sent-current-note"]')));

  section("E6 withdraw the draft (confirmation; kept as history)");
  await go(admin, `/operations/growth/pipeline/${O1}`);
  await click(admin, '[data-testid="quote-withdraw-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-withdraw-form"]'));
  check("E6a a confirmation is required (nothing changes until confirmed)", /kept in the quote history/.test(await inner(admin, '[data-testid="quote-withdraw-form"]').then(() => admin.evaluate(`document.querySelector('[data-testid="quote-withdraw-form"]').closest('dialog').innerText`))) && (await quotes(O1)) === "draft:11050");
  await click(admin, '[data-testid="quote-withdraw-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 10000);
  await sleep(1200);
  check("E6b withdrawn (never deleted): DB row kept as withdrawn; panel History shows Withdrawn; create offered again (slot free)",
    (await quotes(O1)) === "withdrawn:11050" && /Withdrawn/.test(await inner(admin, '[data-testid="quotes-history"]'))
    && (await has(admin, '[data-testid="quote-create-open"]')) && !(await has(admin, '[data-testid="quote-edit-open"]')));
  await admin.screenshot(`${SHOTS}e6-withdrawn-history.png`);

  section("E7 no duplicate draft: double click, and a retry after an ambiguous result (same key)");
  await go(admin, `/operations/growth/pipeline/${O2}`);
  await click(admin, '[data-testid="quote-create-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  await fillDraft(admin, { base: "40", "valid-until": futureDate });
  const key = await val(admin, 'input[name="idempotencyKey"]');
  // the first attempt reached the database but its response was lost: the same key is already stored
  createRpc(O2, key, 4000);
  await admin.evaluate(`(function(){const b=document.querySelector('[data-testid="quote-save"]'); b.click(); b.click(); return true;})()`);
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 10000);
  await sleep(1200);
  check("E7a retry with the SAME key + double click -> exactly ONE draft; the person is told nothing new was added",
    (await quotes(O2)) === "draft:4000" && /already been saved|nothing new/.test(await inner(admin, '[data-testid="quote-saved"]')), `${await quotes(O2)} | ${await inner(admin, '[data-testid="quote-saved"]')}`);
  check("E7b a second independent draft is refused by the database (OD-Q12): ZW004 draft_exists",
    (() => { try { createRpc(O2, `e2e-s5s2-dup-${STAMP}`); return false; } catch (e) { return /draft_exists/.test(String(e.stderr ?? e)); } })() && (await quotes(O2)) === "draft:4000");

  section("E8 closed opportunity: read-only quotes");
  createRpc(O4, `e2e-s5s2-o4-${STAMP}`);
  sql(`update plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = '${O4}'`);
  await go(admin, `/operations/growth/pipeline/${O4}`);
  check("E8 a LOST opportunity shows its draft but offers no create / edit / withdraw",
    (await has(admin, '[data-testid="quotes-current"]')) && !(await has(admin, '[data-testid="quote-edit-open"]')) && !(await has(admin, '[data-testid="quote-create-open"]')));

  section("E9 Plus READ-only Dispatcher");
  const q3 = createRpc(O3, `e2e-s5s2-o3-${STAMP}`, 12000);
  asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q3}', ${ver(q3)})).status`);
  setGrant("read");
  const disp = await open("s5s2-disp", "org-a-dispatcher@example.test");
  await go(disp, `/operations/growth/pipeline/${O2}`);
  check("E9a READ grant: sees the draft (reference, status, total) but NO create / edit / withdraw controls",
    (await has(disp, '[data-testid="quotes-current"] [data-status="draft"]')) && /\$40\.00/.test(await inner(disp, '[data-testid="opportunity-quotes"]'))
    && !(await has(disp, '[data-testid="quote-edit-open"]')) && !(await has(disp, '[data-testid="quote-withdraw-open"]')) && !(await has(disp, '[data-testid="quote-create-open"]')));
  await go(disp, `/operations/growth/pipeline/${O3}`);
  check("E9b READ grant: a current sent quote is shown; no controls, no OD-Q12 writer note", /Current sent/.test(await inner(disp, '[data-testid="quotes-current"]'))
    && !(await has(disp, '[data-testid="quote-create-open"]')) && !(await has(disp, '[data-testid="quote-sent-current-note"]')));
  check("E9c the server independently refuses a READ-grant write (the RPC as the Dispatcher -> ZW001)",
    (() => { try { asUser(U.a2, `select (public.plus_update_quote_draft('${ORG_A}', '${draftOf(O2)}', ${ver(draftOf(O2))}, 'quote', null, false, null, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, null, '${futureDate}')).changed`); return false; } catch (e) { return /unauthorized|ZW001/.test(String(e.stderr ?? e)); } })()
    && (await quotes(O2)) === "draft:4000");
  setGrant("none");
  await go(disp, `/operations/growth/pipeline/${O2}`);
  check("E9d no grant: the Dispatcher follows the existing Growth access behavior (no quotes shown)", !(await has(disp, '[data-testid="opportunity-quotes"]')));

  section("E10 narrow screens: phone width keeps the existing shell rule; tablet portrait (768 px, the narrowest supported) is fully usable");
  const phone = await open("s5s2-phone", "org-a-admin@example.test", 390, 844);
  await go(phone, `/operations/growth/pipeline/${O5}`);
  check("E10a phone width (390 px): the UNCHANGED Operations shell shows its 'tablet and desktop' notice (S2 does not redesign the shell)",
    await phone.evaluate(`(function(){const n=[...document.querySelectorAll('h1,h2,h3,p')].find(e=>/designed for tablet and desktop use/.test(e.textContent)); return !!n && n.offsetParent !== null;})()`));
  const mob = await open("s5s2-tablet", "org-a-admin@example.test", 768, 1024);
  await go(mob, `/operations/growth/pipeline/${O5}`);
  const visible = (sel) => mob.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; const r=e.getBoundingClientRect(); return e.offsetParent !== null && r.width > 0 && r.height > 0;})()`);
  check("E10b tablet (768 px): the panel and the create button are VISIBLE; no horizontal page overflow",
    (await visible('[data-testid="quote-create-open"]')) && (await mob.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")));
  await click(mob, '[data-testid="quote-create-open"]');
  await waitFor(() => visible('[data-testid="quote-form"]'));
  check("E10c tablet: the editor is visible and fits the viewport; decimal keyboard for money; two charge columns; the dialog scrolls within the screen",
    await mob.evaluate(`(function(){const d=document.querySelector('[data-testid="quote-form"]').closest('dialog').getBoundingClientRect(); const i=document.querySelector('[data-testid="quote-base"]');
      const j=document.querySelector('[data-testid="quote-mileage"]'); return d.width > 0 && d.width <= window.innerWidth && d.height <= window.innerHeight && i.inputMode === 'decimal' && j.getBoundingClientRect().left > i.getBoundingClientRect().right;})()`));
  await fillDraft(mob, { base: "60", wait: "12.50", "valid-until": futureDate });
  await mob.evaluate(`document.querySelector('[data-testid="quote-save"]').scrollIntoView()`);
  await sleep(300);
  check("E10d tablet: the Save button is reachable (visible after scrolling inside the dialog)", await visible('[data-testid="quote-save"]'));
  await mob.screenshot(`${SHOTS}e10-tablet-form.png`);
  await click(mob, '[data-testid="quote-save"]');
  await waitFor(() => has(mob, '[data-testid="quote-saved"]'), 10000);
  await sleep(1200);
  check("E10e tablet: save works; server total $72.50; service kept from the opportunity", (await quotes(O5)) === "draft:7250"
    && first(sql(`select service_type from plus_quotes where opportunity_id = '${O5}'`)) === "wheelchair_transportation");
  await mob.screenshot(`${SHOTS}e10-tablet-panel.png`);

  section("E11 side effects");
  check("E11 no Core Request / Trip / Passenger / notification / task was created; estimated value untouched",
    first(sql(SIDE)) === side0 && first(sql(`select coalesce(estimated_value_cents::text, 'null') from plus_opportunities where id = '${O1}'`)) === "null", `${side0} -> ${first(sql(SIDE))}`);
} catch (e) {
  fails++;
  console.log("FAIL — harness error :: " + String(e?.stack ?? e).slice(0, 600));
} finally {
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
