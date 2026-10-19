// NP-P2-S5-S3B local browser E2E -- quote lifecycle UI (Mark sent review, responses, revise, sent withdrawal), Growth
// timelines (OD-Q15) and the do-not-contact acknowledgment (OD-Q16). ISOLATED Supabase stack (NemrynS1Iso) +
// `next start -p 3100`; FICTIONAL seed identities and data only.
//   npm run test:e2e:quotes -- s3b      (or: node tests/e2e/plus-quotes/s3b-lifecycle.e2e.mjs; see README.md)
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { sleep, newChromeSession, signIn } from "./_harness.mjs";
import { APP, DB, SEED_PASSWORD, artifactDir, assertFictionalSeed } from "./_config.mjs";

const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const U = { a1: "20000000-0000-0000-0000-0000000000a1", a2: "20000000-0000-0000-0000-0000000000a2" };
const PW = SEED_PASSWORD;
const STAMP = Date.now().toString(36);
assertFictionalSeed();
const SHOTS = artifactDir("s3b");
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();
const first = (out) => out.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT|ROLLBACK|ALTER TABLE|UPDATE \d+)$/.test(l))[0]?.trim() ?? "";
const asUser = (uid, stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
async function go(s, p) { await s.nav(`${APP}${p}`, 2500); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 10000); await sleep(900); }
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const inner = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const setField = (s, sel, value) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const click = (s, sel) => s.evaluate(`(function(){const el=document.querySelector(${JSON.stringify(sel)}); if(!el||el.disabled) return false; el.click(); return true;})()`);
const disabled = (s, sel) => s.evaluate(`document.querySelector(${JSON.stringify(sel)})?.disabled === true`);
const memId = (uid) => first(sql(`select id from memberships where user_id='${uid}' and organization_id='${ORG_A}'`));
function setGrant(access) {
  sql(`update membership_module_grants set revoked_at = now(), revoked_by = '${U.a1}' where membership_id = '${memId(U.a2)}' and revoked_at is null`);
  if (access !== "none") sql(`insert into membership_module_grants (organization_id, membership_id, module, access, granted_by) values ('${ORG_A}', '${memId(U.a2)}', 'plus', '${access}', '${U.a1}')`);
}
const contact = (name, dnc = false) => first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by, do_not_contact) values ('${ORG_A}', '${name}', '(404) 555-0176', '${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test', 'individual', '${U.a1}', ${dnc}) returning id`));
const opp = (title, k) => first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}', '${title}', 'qualified', '${k}', 'phone', 'dialysis', '${U.a1}') returning id`));
const ver = (q) => `(select updated_at from public.plus_quotes where id = '${q}')`;
const create = (o, key, base = 10000) => asUser(U.a1, `select (public.plus_create_quote('${ORG_A}', '${o}', '${key}', 'quote', 'dialysis', false, null, ${base}, 2500, 0, 0, 0, 0, 0, 0, null, 500, null, current_date + 10)).quote_id`);
const send = (q) => asUser(U.a1, `select (public.plus_mark_quote_sent('${ORG_A}', '${q}', ${ver(q)})).status`);
const st = (q) => first(sql(`select status from plus_quotes where id = '${q}'`));
const num = (q) => first(sql(`select quote_number from plus_quotes where id = '${q}'`));
const acts = (q) => first(sql(`select coalesce(string_agg(activity_type || ':' || quote_status, ',' order by recorded_at, id), '') from plus_activities where quote_id = '${q}'`));
const sessions = [];
const open = async (name, who, w = 1440, h = 1200) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, PW); return s; };
const history = (s) => inner(s, '[data-testid="opportunity-history"]');

try {
  section("fixtures (fictional, through the real RPCs)");
  sql(`delete from organization_modules where organization_id = '${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'NP-P2-S5-S3B E2E')`);
  setGrant("none");
  const K = contact(`S3B Pat ${STAMP}`);
  const KD = contact(`S3B DNC Dana ${STAMP}`, true);
  const KR = contact(`S3B Race Rae ${STAMP}`);
  const O1 = opp(`S3B Lifecycle ${STAMP}`, K); const Q1 = create(O1, `s3b-${STAMP}-1`);
  const O2 = opp(`S3B Decline ${STAMP}`, K); const Q2 = create(O2, `s3b-${STAMP}-2`); send(Q2);
  const O3 = opp(`S3B Withdraw ${STAMP}`, K); const Q3 = create(O3, `s3b-${STAMP}-3`); send(Q3);
  const OD = opp(`S3B DNC ${STAMP}`, KD); const QD = create(OD, `s3b-${STAMP}-d`);
  const OR = opp(`S3B DNC race ${STAMP}`, KR); const QR = create(OR, `s3b-${STAMP}-r`);
  const OE = opp(`S3B Expired ${STAMP}`, K); const QE = create(OE, `s3b-${STAMP}-e`); send(QE);
  sql(`begin; alter table plus_quotes disable trigger plus_quotes_guard; update plus_quotes set valid_until = public._plus_org_local_today('${ORG_A}') - 1 where id = '${QE}'; alter table plus_quotes enable trigger plus_quotes_guard; commit;`);
  const OX = opp(`S3B Double ${STAMP}`, K); const QX = create(OX, `s3b-${STAMP}-x`);
  const admin = await open("s3b-admin", "org-a-admin@example.test");

  section("M. Mark sent (review the server snapshot, confirm)");
  await go(admin, `/operations/growth/pipeline/${O1}`);
  check("M0 the Stage note is truthful: staff-recorded stages; Nemryn doesn't send quotes or verify delivery / acceptance",
    /doesn't send quotes or verify delivery or acceptance/.test(await inner(admin, '[data-testid="stage-controls"]')) && !/hasn't created/.test(await inner(admin, "main")));
  check("M1 a draft offers Mark sent / Edit draft / Withdraw draft", (await has(admin, '[data-testid="quote-send-open"]')) && (await has(admin, '[data-testid="quote-edit-open"]')) && (await has(admin, '[data-testid="quote-withdraw-open"]')));
  await click(admin, '[data-testid="quote-send-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-form"]'));
  const review = await inner(admin, '[data-testid="quote-send-review"]');
  check("M2 the review shows the server snapshot: kind, service, itemized charges, discount, total USD, valid until; and that prices become final",
    /Quote · Dialysis transportation/.test(review) && /Base transportation/.test(review) && /\$100\.00/.test(review) && /Mileage charge/.test(review) && /\$25\.00/.test(review)
    && /Discount/.test(review) && /−\$5\.00/.test(review) && (await inner(admin, '[data-testid="quote-send-total"]')) === "$120.00" && /Valid until/.test(review)
    && /prices can't be changed/.test(await admin.evaluate(`document.querySelector('[data-testid="quote-send-form"]').closest('dialog').innerText`)), review);
  check("M3 a non-DNC contact: no do-not-contact warning; confirm is enabled", !(await has(admin, '[data-testid="quote-send-dnc"]')) && !(await disabled(admin, '[data-testid="quote-send-confirm"]')));
  await admin.screenshot(`${SHOTS}m-send-review.png`);
  await click(admin, '[data-testid="quote-send-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("M4 marked sent: status sent; stage quote_sent; ONE quote_sent event; the success message is shown",
    st(Q1) === "sent" && first(sql(`select stage from plus_opportunities where id='${O1}'`)) === "quote_sent" && acts(Q1) === "quote_sent:sent"
    && /Marked sent/.test(await inner(admin, '[data-testid="quote-saved"]')));
  check("M5 the Opportunity history shows 'Quote N marked sent' (no amount)", (await history(admin)).includes(`Quote ${num(Q1)} marked sent`) && !/\$\d/.test(await history(admin)), await history(admin));
  check("M6 the current sent quote offers Record accepted / Record declined / Revise / Withdraw sent quote; the draft actions are gone",
    (await has(admin, '[data-testid="quote-accept-open"]')) && (await has(admin, '[data-testid="quote-decline-open"]')) && (await has(admin, '[data-testid="quote-revise-open"]'))
    && (await has(admin, '[data-testid="quote-withdraw-sent-open"]')) && !(await has(admin, '[data-testid="quote-send-open"]')));

  section("R. Revise -> edit with the existing editor -> mark the revision sent (supersedes the original)");
  await click(admin, '[data-testid="quote-revise-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-revise-form"]'));
  check("R1 the revise dialog explains the consequences (new draft; the original stays sent until the revision is sent)", /stays sent and unchanged until the revision is marked sent/.test(await admin.evaluate(`document.querySelector('[data-testid="quote-revise-form"]').closest('dialog').innerText`)));
  await admin.evaluate(`(function(){const b=document.querySelector('[data-testid="quote-revise-confirm"]'); b.click(); b.click(); return true;})()`);
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  const REV = first(sql(`select id from plus_quotes where supersedes_quote_id = '${Q1}'`));
  check("R2 exactly ONE revision draft (double click), prefilled from the original; the original still sent; ONE quote_revised event",
    first(sql(`select count(*) from plus_quotes where supersedes_quote_id = '${Q1}'`)) === "1" && st(REV) === "draft" && st(Q1) === "sent"
    && first(sql(`select total_cents from plus_quotes where id='${REV}'`)) === "12000" && acts(REV) === "quote_revised:draft");
  check("R3 the panel shows the revision as Active draft 'Revision of Quote N' next to the current sent quote", /Revision of Quote/.test(await inner(admin, '[data-testid="quotes-current"]')) && (await has(admin, '[data-testid="quotes-current"] [data-status="sent"]')));
  await click(admin, '[data-testid="quote-edit-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  await setField(admin, '[data-testid="quote-base"]', "90.00");
  await sleep(300);
  await click(admin, '[data-testid="quote-save"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("R4 the revision is edited with the EXISTING editor (base 90 -> total 11000); the original's snapshot is unchanged (12000)",
    first(sql(`select total_cents from plus_quotes where id='${REV}'`)) === "11000" && first(sql(`select total_cents from plus_quotes where id='${Q1}'`)) === "12000");
  await click(admin, '[data-testid="quote-send-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-form"]'));
  check("R5 the Mark sent review of a revision says which quote it replaces", new RegExp(`replaces Quote ${num(Q1)}`).test(await inner(admin, '[data-testid="quote-send-replaces"]')));
  await click(admin, '[data-testid="quote-send-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("R6 sending the revision supersedes the original atomically: original superseded (snapshot kept), revision sent, exactly one sent; events superseded + sent",
    st(Q1) === "superseded" && st(REV) === "sent" && first(sql(`select count(*) from plus_quotes where opportunity_id='${O1}' and status='sent'`)) === "1"
    && acts(Q1) === "quote_sent:sent,quote_status_changed:superseded" && acts(REV) === "quote_revised:draft,quote_sent:sent");
  const h = await history(admin);
  check("R7 the history shows the revision lifecycle in plain words", h.includes(`Quote ${num(REV)} created as a revision of Quote ${num(Q1)}`) && h.includes(`Quote ${num(Q1)} replaced by revision Quote ${num(REV)}`) && h.includes(`Quote ${num(REV)} marked sent`), h);

  section("A. Record accepted (staff-reported)");
  await click(admin, '[data-testid="quote-accept-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-response-form"]'));
  check("A1 the dialog says it records what the customer told the team (not an online / verified acceptance)", /isn't an online or verified acceptance/.test(await admin.evaluate(`document.querySelector('[data-testid="quote-response-form"]').closest('dialog').innerText`)));
  await click(admin, '[data-testid="quote-response-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("A2 accepted; stage quote_accepted; ONE quote_status_changed:accepted; history 'Customer acceptance of Quote N recorded'; no Core Request",
    st(REV) === "accepted" && first(sql(`select stage from plus_opportunities where id='${O1}'`)) === "quote_accepted"
    && acts(REV) === "quote_revised:draft,quote_sent:sent,quote_status_changed:accepted"
    && (await history(admin)).includes(`Customer acceptance of Quote ${num(REV)} recorded`)
    && first(sql(`select count(*) from plus_request_attributions where opportunity_id='${O1}'`)) === "0");
  await admin.screenshot(`${SHOTS}a-accepted-history.png`);
  await go(admin, `/operations/growth/contacts/${K}`);
  check("A3 the CONTACT timeline shows the same quote events, with a link to the opportunity's quotes",
    (await inner(admin, '[data-testid="contact-timeline"]')).includes(`Customer acceptance of Quote ${num(REV)} recorded`)
    && (await admin.evaluate(`[...document.querySelectorAll('[data-testid="timeline-quote-link"]')].some(a => a.getAttribute('href') === '/operations/growth/pipeline/${O1}#quotes')`)));

  section("D. Record declined");
  await go(admin, `/operations/growth/pipeline/${O2}`);
  await click(admin, '[data-testid="quote-decline-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-response-form"]'));
  await click(admin, '[data-testid="quote-response-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("D1 declined; the opportunity is NOT marked lost (stays quote_sent); one event; history line",
    st(Q2) === "declined" && first(sql(`select stage from plus_opportunities where id='${O2}'`)) === "quote_sent"
    && acts(Q2) === "quote_sent:sent,quote_status_changed:declined" && (await history(admin)).includes(`Customer decline of Quote ${num(Q2)} recorded`));

  section("W. Withdraw a SENT quote (reason required)");
  await go(admin, `/operations/growth/pipeline/${O3}`);
  await click(admin, '[data-testid="quote-withdraw-sent-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-withdraw-sent-form"]'));
  check("W1 confirmation required; the confirm button stays disabled without a reason; the dialog says it stays in history with its prices", (await disabled(admin, '[data-testid="quote-withdraw-sent-confirm"]'))
    && /stays in the history as withdrawn with its prices/.test(await admin.evaluate(`document.querySelector('[data-testid="quote-withdraw-sent-form"]').closest('dialog').innerText`)));
  await setField(admin, '[data-testid="quote-withdraw-sent-reason"]', "Fictional: customer postponed (private note)");
  await sleep(300);
  await click(admin, '[data-testid="quote-withdraw-sent-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("W2 withdrawn (kept, amounts intact); slot free (create offered); ONE withdrawn event; the reason is on the quote but NOT on the timeline; no stage change",
    st(Q3) === "withdrawn" && first(sql(`select total_cents from plus_quotes where id='${Q3}'`)) === "12000" && (await has(admin, '[data-testid="quote-create-open"]'))
    && acts(Q3) === "quote_sent:sent,quote_status_changed:withdrawn" && (await history(admin)).includes(`Sent Quote ${num(Q3)} withdrawn`)
    && !(await history(admin)).includes("postponed") && first(sql(`select stage from plus_opportunities where id='${O3}'`)) === "quote_sent");

  section("N. Do-not-contact (OD-Q16)");
  await go(admin, `/operations/growth/pipeline/${OD}`);
  await click(admin, '[data-testid="quote-send-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-form"]'));
  const dncText = await inner(admin, '[data-testid="quote-send-dnc"]');
  check("N1 DNC contact: a prominent warning; it says the acknowledgment isn't consent, changes no preference and allows no email / texts; confirm disabled until acknowledged",
    /asked not to be contacted/.test(dncText) && /isn't consent/.test(dncText) && /doesn't change their preference/.test(dncText) && /doesn't allow emails, texts/.test(dncText)
    && (await disabled(admin, '[data-testid="quote-send-confirm"]')), dncText);
  await admin.screenshot(`${SHOTS}n-dnc-warning.png`);
  await click(admin, '[data-testid="quote-send-dnc-ack"]');
  await sleep(300);
  check("N2 after ticking the acknowledgment the confirm button is enabled", !(await disabled(admin, '[data-testid="quote-send-confirm"]')));
  const kdBefore = first(sql(`select do_not_contact || '|' || preferred_channel || '|' || updated_at from plus_contacts where id='${KD}'`));
  await click(admin, '[data-testid="quote-send-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("N3 sent with the acknowledgment; audit: contact_do_not_contact = true, dnc_acknowledged = true; the contact is UNCHANGED; no notification",
    st(QD) === "sent" && first(sql(`select (after_data->>'contact_do_not_contact') || '/' || (after_data->>'dnc_acknowledged') from audit_events where entity_id='${QD}' and action='plus_quote_sent'`)) === "true/true"
    && first(sql(`select do_not_contact || '|' || preferred_channel || '|' || updated_at from plus_contacts where id='${KD}'`)) === kdBefore
    && first(sql(`select count(*) from notification_events where entity_id='${QD}'`)) === "0");
  const QDB = create(opp(`S3B DNC direct ${STAMP}`, KD), `s3b-${STAMP}-db`);
  check("N4 a direct RPC call without the acknowledgment cannot bypass it (database refusal)",
    (() => { try { send(QDB); return false; } catch (e) { return /dnc_acknowledgment_required/.test(String(e.stderr ?? e)); } })() && st(QDB) === "draft");
  // the preference changes AFTER the dialog opened
  await go(admin, `/operations/growth/pipeline/${OR}`);
  await click(admin, '[data-testid="quote-send-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-form"]'));
  const noWarnAtOpen = !(await has(admin, '[data-testid="quote-send-dnc"]'));
  sql(`update plus_contacts set do_not_contact = true where id = '${KR}'`);
  await click(admin, '[data-testid="quote-send-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-dnc-required"]'), 15000);
  check("N5 do-not-contact turned ON after the dialog opened: the server refuses; the warning + acknowledgment now appear; nothing was written",
    noWarnAtOpen && (await has(admin, '[data-testid="quote-send-dnc"]')) && st(QR) === "draft" && acts(QR) === "" && (await disabled(admin, '[data-testid="quote-send-confirm"]')));
  await click(admin, '[data-testid="quote-send-dnc-ack"]');
  await sleep(300);
  await click(admin, '[data-testid="quote-send-confirm"]');
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("N6 after acknowledging, the same dialog records it sent (audited true/true)", st(QR) === "sent"
    && first(sql(`select (after_data->>'contact_do_not_contact') || '/' || (after_data->>'dnc_acknowledged') from audit_events where entity_id='${QR}' and action='plus_quote_sent'`)) === "true/true");

  section("X. Duplicate click, expiry, read-only, directory");
  await go(admin, `/operations/growth/pipeline/${OX}`);
  await click(admin, '[data-testid="quote-send-open"]');
  await waitFor(() => has(admin, '[data-testid="quote-send-form"]'));
  await admin.evaluate(`(function(){const b=document.querySelector('[data-testid="quote-send-confirm"]'); b.click(); b.click(); return true;})()`);
  await waitFor(() => has(admin, '[data-testid="quote-saved"]'), 15000); await sleep(1500);
  check("X1 a double click on Mark sent: one transition, ONE event, ONE audit row", st(QX) === "sent" && acts(QX) === "quote_sent:sent"
    && first(sql(`select count(*) from audit_events where entity_id='${QX}' and action='plus_quote_sent'`)) === "1");
  await go(admin, `/operations/growth/pipeline/${OE}`);
  check("X2 an EXPIRED sent quote: no Record accepted / declined; the expired note; Revise and Withdraw remain",
    !(await has(admin, '[data-testid="quote-accept-open"]')) && !(await has(admin, '[data-testid="quote-decline-open"]')) && (await has(admin, '[data-testid="quote-expired-note"]'))
    && (await has(admin, '[data-testid="quote-revise-open"]')) && (await has(admin, '[data-testid="quote-withdraw-sent-open"]')));
  setGrant("read");
  const disp = await open("s3b-disp", "org-a-dispatcher@example.test");
  await go(disp, `/operations/growth/pipeline/${O2}`);
  check("X3 READ-grant Dispatcher: sees the quotes and the history, but NO lifecycle controls",
    (await has(disp, '[data-testid="opportunity-quotes"]')) && (await history(disp)).includes(`Customer decline of Quote ${num(Q2)} recorded`)
    && !(await has(disp, '[data-testid="quote-send-open"]')) && !(await has(disp, '[data-testid="quote-accept-open"]')) && !(await has(disp, '[data-testid="quote-revise-open"]')) && !(await has(disp, '[data-testid="quote-withdraw-sent-open"]')));
  setGrant("none");
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(STAMP)}`);
  const dirStatuses = await admin.evaluate(`[...document.querySelectorAll('[data-testid="quote-directory-status"]')].map(e => e.dataset.status).sort().join(',')`);
  check("X4 the directory reflects the stored statuses after the actions (accepted, declined, superseded, withdrawn, sent ...)",
    ["accepted", "declined", "superseded", "withdrawn", "sent"].every((x) => dirStatuses.includes(x)), dirStatuses);
  await go(admin, "/operations/growth");
  check("X5 the Growth dashboard feed shows quote events in plain words", /marked sent|acceptance of|decline of|replaced by revision|withdrawn/.test(await inner(admin, '[data-testid="growth-recent-activity"]')));
  const tab = await open("s3b-tablet", "org-a-admin@example.test", 768, 1024);
  const OT = opp(`S3B Tablet ${STAMP}`, KD); create(OT, `s3b-${STAMP}-t`);
  await go(tab, `/operations/growth/pipeline/${OT}`);
  await click(tab, '[data-testid="quote-send-open"]');
  await waitFor(() => has(tab, '[data-testid="quote-send-form"]'));
  check("X6 768 px: the Mark sent dialog (review + DNC warning) fits the viewport and the acknowledgment / confirm are reachable",
    await tab.evaluate(`(function(){const d=document.querySelector('[data-testid="quote-send-form"]').closest('dialog').getBoundingClientRect(); return d.width <= window.innerWidth && d.height <= window.innerHeight && !!document.querySelector('[data-testid="quote-send-dnc-ack"]');})()`));
  await tab.screenshot(`${SHOTS}x-tablet-send.png`);
} catch (e) {
  fails++;
  console.log("FAIL — harness error :: " + String(e?.stack ?? e).slice(0, 600));
} finally {
  try { setGrant("none"); } catch {}
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
