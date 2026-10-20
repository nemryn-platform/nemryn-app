// NP-UI-P1a -- canonical UI foundations & accessibility: U1 contrast, U2 dialog focus return, A1-A5, error / not-found /
// loading states, DataTable row semantics, primitive keyboard behaviour, axe + overflow sweep at 1440 / 1024 / 768 / 390.
// ISOLATED local stack only (same guards as tests/e2e/plus-quotes: localhost app, NemrynS1Iso container, fictional seed).
//   node tests/e2e/ui-foundations/p1a.e2e.mjs        (fresh reset recommended; see tests/e2e/plus-quotes/README.md)
import { sleep, newChromeSession, signIn, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const OUT = artifactDir("ui-p1a");
const ORG_A = "10000000-0000-0000-0000-0000000000a1";
const U = "20000000-0000-0000-0000-0000000000a1";
const STAMP = Date.now().toString(36);
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 300) : ""}`); return !!c; };
const section = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
const first = (o) => o.split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT)$/.test(l))[0]?.trim() ?? "";
const asUser = (stmt) => first(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${U}'; ${stmt}; commit;`));
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; }
const sessions = [];
const open = async (name, who, w = 1440, h = 1000) => { const s = await newChromeSession(name); sessions.push(s); await s.setViewport(w, h); if (who) await signIn(s, who, SEED_PASSWORD); return s; };
const go = async (s, p) => { await s.nav(`${APP}${p}`, 2000); await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 15000); await sleep(900); };
const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const key = async (s, k, code, kc, extra = {}) => {
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : k.length === 1 ? { text: k } : {}), ...extra });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  await sleep(150);
};
const active = (s) => s.evaluate(`(function(){const a=document.activeElement; return a ? (a.getAttribute('data-testid') || a.getAttribute('aria-label') || a.tagName + ':' + (a.textContent||'').trim().slice(0,30)) : 'none';})()`);
const focusOn = (s, sel) => s.evaluate(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.focus(); return document.activeElement===e;})()`);
async function axe(s, include) {
  await injectAxe(s);
  return s.evaluate(`axe.run(${include ? `{ include: [${JSON.stringify(include)}] }` : "document"}, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + 'x' + v.nodes.length + (v.nodes[0]?.any?.[0]?.data?.contrastRatio ? '@' + v.nodes[0].any[0].data.contrastRatio : '')))`);
}

try {
  section("fixtures (fictional, isolated database only)");
  sql(`delete from organization_modules where organization_id='${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}','plus','active','UI-P1a')`);
  const K = first(sql(`insert into plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('${ORG_A}','P1a Pat ${STAMP}','(404) 555-0191','p1a.${STAMP}@example.test','individual','${U}') returning id`));
  const O = first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}','P1a rides ${STAMP}','qualified','${K}','phone','dialysis','${U}') returning id`));
  asUser(`select (public.plus_create_quote('${ORG_A}','${O}','p1a-${STAMP}','quote','dialysis',false,null,9000,1500,0,0,0,0,0,0,null,0,'Fictional terms',current_date+10)).quote_id`);
  // a superseded + withdrawn history so the directory renders every badge tone (U1 surface)
  const O2 = first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}','P1a history ${STAMP}','qualified','${K}','phone','dialysis','${U}') returning id`));
  const H1 = asUser(`select (public.plus_create_quote('${ORG_A}','${O2}','p1a-h1-${STAMP}','quote','dialysis',false,null,9000,0,0,0,0,0,0,0,null,0,null,current_date+10)).quote_id`);
  asUser(`select (public.plus_mark_quote_sent('${ORG_A}','${H1}',(select updated_at from plus_quotes where id='${H1}'))).status`);
  const H2 = asUser(`select (public.plus_revise_quote('${ORG_A}','${H1}','p1a-h2-${STAMP}')).quote_id`);
  asUser(`select (public.plus_mark_quote_sent('${ORG_A}','${H2}',(select updated_at from plus_quotes where id='${H2}'))).status`);
  asUser(`select (public.plus_create_task('${ORG_A}','P1a follow-up ${STAMP}',null,null,null,'${O}')).task_id`);
  const REQ = first(sql(`select id from transportation_requests where organization_id='${ORG_A}' limit 1`));
  const admin = await open("p1a-admin", "org-a-admin@example.test");

  section("U1 — muted text contrast");
  await go(admin, "/operations");
  check("U1.1 --color-text-muted resolves to #5f656b (derived token; primitive unchanged)", (await admin.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim()`)) === "#5f656b");
  const u1Pages = [["Dispatch", "/operations/dispatch"], ["Request detail", `/operations/requests/${REQ}`], ["Pipeline", "/operations/growth/pipeline"], ["Estimates & Quotes directory", "/operations/growth/quotes"]];
  for (const [label, path] of u1Pages) {
    await go(admin, path);
    const v = await axe(admin, null);
    check(`U1.2 ${label}: no serious color-contrast (or other serious / critical) axe violation`, !v.some((x) => x.startsWith("color-contrast")) && v.length === 0, JSON.stringify(v));
  }
  await go(admin, `/operations/growth/pipeline/${O}`);
  for (const [label, trigger, form] of [["create (via a second opportunity)", null, null], ["edit", '[data-testid="quote-edit-open"]', '[data-testid="quote-form"]'], ["Mark sent", '[data-testid="quote-send-open"]', '[data-testid="quote-send-form"]']]) {
    if (!trigger) continue;
    await go(admin, `/operations/growth/pipeline/${O}`);
    await admin.evaluate(`document.querySelector(${JSON.stringify(trigger)}).click()`);
    await waitFor(() => has(admin, form));
    const v = await axe(admin, "dialog[open]");
    check(`U1.3 quote ${label} dialog: 0 serious / critical axe violations`, v.length === 0, JSON.stringify(v));
  }
  const O3 = first(sql(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}','P1a empty ${STAMP}','qualified','${K}','phone','dialysis','${U}') returning id`));
  await go(admin, `/operations/growth/pipeline/${O3}`);
  await admin.evaluate(`document.querySelector('[data-testid="quote-create-open"]').click()`);
  await waitFor(() => has(admin, '[data-testid="quote-form"]'));
  const vc = await axe(admin, "dialog[open]");
  check("U1.3 quote create dialog: 0 serious / critical axe violations", vc.length === 0, JSON.stringify(vc));

  section("U2 — Dialog focus return (foundation bench + real app dialogs)");
  const bench = await open("p1a-bench", null);
  await go(bench, "/foundation");
  const closeAndCheck = async (label, closeFn, expect = "p1a-dialog-open") => {
    await focusOn(bench, '[data-testid="p1a-dialog-open"]');
    await key(bench, "Enter", "Enter", 13);
    const opened = await waitFor(() => bench.evaluate("!!document.querySelector('dialog[open]')"), 5000);
    await closeFn();
    const closed = await waitFor(async () => !(await bench.evaluate("!!document.querySelector('dialog[open]')")), 5000);
    await sleep(300);
    const where = await active(bench);
    check(`U2.${label}: dialog opened by keyboard, closed, focus returned to the invoking control`, opened && closed && where === expect, `${opened}/${closed}/${where}`);
  };
  await closeAndCheck("1 Cancel", () => focusOn(bench, '[data-testid="p1a-dialog-cancel"]').then(() => key(bench, "Enter", "Enter", 13)));
  await closeAndCheck("2 Close (X)", () => bench.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.getAttribute('aria-label') === 'Close').focus()`).then(() => key(bench, "Enter", "Enter", 13)));
  await closeAndCheck("3 Escape", () => key(bench, "Escape", "Escape", 27));
  await closeAndCheck("4 backdrop click", () => bench.evaluate(`(function(){const d=document.querySelector('dialog[open]'); d.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true;})()`));
  await closeAndCheck("5 successful completion (unmount)", () => focusOn(bench, '[data-testid="p1a-dialog-confirm"]').then(() => key(bench, "Enter", "Enter", 13)));
  await focusOn(bench, '[data-testid="p1a-vanishing-open"]');
  await key(bench, "Enter", "Enter", 13);
  await waitFor(() => bench.evaluate("!!document.querySelector('dialog[open]')"), 5000);
  await focusOn(bench, '[data-testid="p1a-vanishing-confirm"]');
  await key(bench, "Enter", "Enter", 13);
  await waitFor(async () => !(await bench.evaluate("!!document.querySelector('dialog[open]')")), 5000); await sleep(300);
  check("U2.6 the invoking button disappears after the action: focus goes to returnFocusRef, never to a removed element or <body>", (await active(bench)) === "p1a-fallback-target" && !(await has(bench, '[data-testid="p1a-vanishing-open"]')), await active(bench));
  // real app: quote dialogs (Cancel / Close X) + a non-quote dialog (Passengers edit via the new DataTable row button)
  for (const [label, trigger, btn] of [["Edit draft -> Cancel", '[data-testid="quote-edit-open"]', "Cancel"], ["Edit draft -> Close (X)", '[data-testid="quote-edit-open"]', "Close"]]) {
    await go(admin, `/operations/growth/pipeline/${O}`);
    await focusOn(admin, trigger);
    await key(admin, "Enter", "Enter", 13);
    await waitFor(() => admin.evaluate("!!document.querySelector('dialog[open]')"), 5000);
    await admin.evaluate(`(function(){const b=[...document.querySelectorAll('dialog[open] button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(btn)}); b.focus(); return true;})()`);
    await key(admin, "Enter", "Enter", 13);
    await waitFor(async () => !(await admin.evaluate("!!document.querySelector('dialog[open]')")), 5000); await sleep(400);
    check(`U2.7 quote ${label}: focus returns to the trigger`, (await active(admin)) === trigger.match(/"(.+)"/)[1], await active(admin));
  }
  await go(admin, "/operations/passengers");
  const pBtn = await admin.evaluate(`(function(){const b=document.querySelector('[data-row-action]'); if(!b) return null; b.focus(); return b.textContent.trim();})()`);
  check("U2.8 / T6 Passengers: the action row exposes a real button named 'Edit <name>' (no focusable <tr>)", !!pBtn && /^Edit /.test(pBtn) && !(await admin.evaluate(`!!document.querySelector('tbody tr[tabindex]')`)), pBtn);
  await key(admin, "Enter", "Enter", 13);
  const pOpened = await waitFor(() => admin.evaluate("!!document.querySelector('dialog[open]')"), 5000);
  await admin.evaluate(`(function(){const b=[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Cancel'); (b || document.querySelector('dialog[open] button[aria-label="Close"]')).focus(); return true;})()`);
  await key(admin, "Enter", "Enter", 13);
  await waitFor(async () => !(await admin.evaluate("!!document.querySelector('dialog[open]')")), 5000); await sleep(400);
  check("U2.9 Passengers edit dialog: Enter on the row button opens it; Cancel returns focus to that row button", pOpened && (await admin.evaluate(`document.activeElement?.hasAttribute('data-row-action') === true`)), await active(admin));

  section("A1-A4 — structure");
  await go(admin, "/operations/growth/tasks");
  check("A1 TaskList subject link is underlined without hover (not colour-only)", await admin.evaluate(`(function(){const a=document.querySelector('[data-testid="task-subject-link"]'); return !!a && getComputedStyle(a).textDecorationLine.includes('underline');})()`));
  check("A1b Tasks page: no serious link-in-text-block violation", !(await axe(admin, null)).some((v) => v.startsWith("link-in-text-block")));
  await go(admin, `/operations/requests/${REQ}`);
  const h1s = await admin.evaluate(`[...document.querySelectorAll('h1')].map(h => h.innerText.trim())`);
  check("A2 Request detail has exactly one h1 ('Request Detail'); the page's own 'Request' heading stays an h2", JSON.stringify(h1s) === JSON.stringify(["Request Detail"]) && (await admin.evaluate(`[...document.querySelectorAll('h2')].some(h => h.innerText.trim() === 'Request')`)), JSON.stringify(h1s));
  const anon = await open("p1a-anon", null);
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/no-such-page"]) {
    await go(anon, path);
    check(`A3 ${path}: exactly one main landmark`, (await anon.evaluate(`document.querySelectorAll('main').length`)) === 1);
  }
  const multi = await open("p1a-multi", "multi-org-user@example.test");
  await go(multi, "/select-organization");
  check("A3 /select-organization: exactly one main landmark", (await multi.evaluate(`document.querySelectorAll('main').length`)) === 1, await multi.evaluate("location.pathname"));
  const narrow = await open("p1a-390", "org-a-admin@example.test", 390, 844);
  await go(narrow, "/operations");
  check("A3 390 px Operations notice: one VISIBLE main landmark (the shell's main is not displayed)", await narrow.evaluate(`[...document.querySelectorAll('main, [role="main"]')].filter(m => m.checkVisibility()).length === 1 && document.querySelectorAll('main').length === 1 && /designed for tablet and desktop use/.test(document.body.innerText)`));
  await go(admin, "/operations/settings/notifications");
  const order = await admin.evaluate(`[...document.querySelectorAll('h1,h2,h3,h4')].map(h => +h.tagName[1])`);
  const skips = order.some((l, i) => i > 0 && l - order[i - 1] > 1);
  check("A4 settings / notifications: heading levels never skip (h1 -> h2 -> h3)", !skips && order[0] === 1, JSON.stringify(order));

  section("A5 / C1 / C2 — error, not-found and loading states");
  await go(admin, "/operations/settings/website-requests");
  const err = await admin.evaluate(`({ shell: !!document.querySelector('nav[aria-label="Primary"]'), boundary: !!document.querySelector('[data-testid="operations-error"]'), lang: document.documentElement.lang, title: document.title, leak: /Refusing to build|loopback|NEXT_PUBLIC_APP_URL|stack|at \\S+\\.js/.test(document.body.innerText), retry: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Try again') })`);
  check("A5 a server error inside Operations renders the in-shell error boundary (shell kept, lang + title present, Try again offered) and discloses NO internal error text",
    err.shell && err.boundary && err.lang === "en" && err.title.length > 0 && !err.leak && err.retry, JSON.stringify(err));
  await go(admin, "/operations/no-such-page");
  check("C2 unknown /operations URL: branded not-found INSIDE the shell (sidebar present), h1 'Page not found', 404 wording", (await has(admin, '[data-testid="operations-not-found"]')) && (await has(admin, 'nav[aria-label="Primary"]'))
    && (await admin.evaluate(`[...document.querySelectorAll('h1')].map(h => h.innerText.trim()).includes('Page not found') && /could not be found/.test(document.body.innerText)`)));
  await go(anon, "/no-such-page");
  check("C2 unknown public URL: branded root not-found with the canonical logo (/brand/nemryn-logo-primary.svg), lang + title", (await has(anon, '[data-testid="not-found"]'))
    && (await anon.evaluate(`!!document.querySelector('img[src*="nemryn-logo-primary"]') && document.documentElement.lang === 'en' && document.title.includes('Nemryn')`)));
  await go(admin, `/quote-print/00000000-0000-4000-8000-000000000000`);
  check("C2 notFound() from /quote-print renders the branded root not-found (same safe 404 wording)", (await has(admin, '[data-testid="not-found"]')) && /could not be found/.test(await admin.evaluate("document.body.innerText")) && !(await has(admin, '[data-testid="quote-print"]')));
  // loading: slow the network, navigate client-side, and observe the skeleton
  await go(admin, "/operations");
  await admin.cdp("Network.enable", {});
  await admin.cdp("Network.emulateNetworkConditions", { offline: false, latency: 2500, downloadThroughput: 50_000, uploadThroughput: 50_000 });
  await admin.evaluate(`document.querySelector('nav[aria-label="Primary"] a[href="/operations/trips"]').click()`);
  const sawSkeleton = await waitFor(() => has(admin, '[data-testid="page-skeleton"]'), 8000);
  const skeletonStatus = await admin.evaluate(`(function(){const s=document.querySelector('[data-testid="page-skeleton"]'); return s ? s.getAttribute('role') + '|' + s.innerText.trim() : '';})()`);
  await admin.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await waitFor(async () => (await admin.evaluate("location.pathname")) === "/operations/trips" && !(await has(admin, '[data-testid="page-skeleton"]')), 20000);
  check("C1 a slow navigation shows the route skeleton inside the shell (role=status, announced 'Loading…'), then the page", sawSkeleton && skeletonStatus === "status|Loading…", skeletonStatus);
  await admin.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await go(bench, "/foundation");
  await bench.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const anim = await bench.evaluate(`(function(){const s=document.querySelector('[data-testid="p1a-skeletons"] span.block'); const cs=getComputedStyle(s); return cs.animationName + '|' + cs.animationDuration;})()`);
  check("C1b reduced motion: skeleton blocks do not animate", anim.startsWith("none") || /0\.00001s|1e-05s|0s/.test(anim), anim);
  await bench.cdp("Emulation.setEmulatedMedia", { features: [] });

  section("T6 — DataTable navigation rows");
  await go(admin, "/operations/growth/contacts");
  check("T6.1 Contacts: rows are not separate tab stops; the row link (data-row-link) is the control", !(await admin.evaluate(`!!document.querySelector('tbody tr[tabindex]')`)) && (await has(admin, 'tbody a[data-row-link]')));
  const target = await admin.evaluate(`document.querySelector('tbody a[data-row-link]').getAttribute('href')`);
  await admin.evaluate(`document.querySelector('[data-testid="contact-row-link"]').closest('tr').querySelector('td:last-child').click()`);
  await waitFor(async () => (await admin.evaluate("location.pathname")) === target, 10000);
  check("T6.2 Contacts: clicking elsewhere on the row follows the same destination as the link", (await admin.evaluate("location.pathname")) === target, target);
  await go(admin, `/operations/growth/quotes?q=${encodeURIComponent(STAMP)}`);
  const qHref = await admin.evaluate(`document.querySelector('[data-testid="quote-directory-link"]').getAttribute('href')`);
  await admin.evaluate(`document.querySelector('[data-testid="quotes-directory-table"] tbody tr').click()`);
  await waitFor(async () => (await admin.evaluate("location.pathname + location.hash")) === qHref, 10000);
  check("T6.3 Quotes directory: tr.click() still opens the opportunity's quotes panel (unchanged destination)", (await admin.evaluate("location.pathname + location.hash")) === qHref, qHref);

  section("T5 — primitive keyboard behaviour (/foundation)");
  await go(bench, "/foundation");
  const tab = (i) => `[data-testid="p1a-primitives"] [role="tablist"] [role="tab"]:nth-child(${i})`;
  await focusOn(bench, tab(1));
  await key(bench, "ArrowRight", "ArrowRight", 39);
  await key(bench, "ArrowRight", "ArrowRight", 39);
  check("T5.1 Tabs: arrows move selection, skip the disabled tab, one tab stop", await bench.evaluate(`(function(){const t=[...document.querySelectorAll('[data-testid="p1a-primitives"] [role="tab"]')]; return t[3].getAttribute('aria-selected')==='true' && document.activeElement===t[3] && t.filter(x=>x.tabIndex===0).length===1;})()`));
  await focusOn(bench, '[role="radiogroup"][aria-label="Sample day"] [role="radio"][aria-checked="true"]');
  await key(bench, "ArrowRight", "ArrowRight", 39);
  check("T5.2 SegmentedControl: arrow moves and selects (radio semantics)", await bench.evaluate(`document.querySelector('[aria-label="Sample day"] [aria-checked="true"]').textContent.trim() === 'Tomorrow'`));
  await focusOn(bench, 'button[aria-haspopup="menu"]');
  await key(bench, "Enter", "Enter", 13);
  const menuOpen = await waitFor(() => has(bench, '[role="menu"]'), 3000);
  await key(bench, "ArrowDown", "ArrowDown", 40);
  await key(bench, "ArrowDown", "ArrowDown", 40);
  const onDelete = (await active(bench)).includes("Delete");
  await key(bench, "e", "KeyE", 69);
  const typeahead = (await active(bench)).includes("Edit") || (await active(bench)).includes("Export");
  await key(bench, "Escape", "Escape", 27);
  check("T5.3 Menu: Enter opens, arrows skip disabled, typeahead, Escape closes and returns focus to the trigger", menuOpen && onDelete && typeahead && !(await has(bench, '[role="menu"]')) && (await bench.evaluate(`document.activeElement?.getAttribute('aria-haspopup') === 'menu'`)));
  await key(bench, "Enter", "Enter", 13);
  await waitFor(() => has(bench, '[role="menu"]'), 3000);
  await key(bench, "Enter", "Enter", 13);
  check("T5.4 Menu: Enter on an item runs it and closes the menu", (await bench.evaluate(`document.querySelector('[data-testid="p1a-last-action"]').textContent`)).includes("edit") && !(await has(bench, '[role="menu"]')));
  await focusOn(bench, 'button[aria-label="About times"]');
  await sleep(200);
  check("T5.5 Tooltip: shown on keyboard focus and referenced by aria-describedby", await bench.evaluate(`(function(){const b=document.querySelector('button[aria-label="About times"]'); const id=b.getAttribute('aria-describedby'); const t=id && document.getElementById(id); return !!t && t.getAttribute('role')==='tooltip' && !t.hidden;})()`));
  await focusOn(bench, 'button[role="switch"]');
  await key(bench, " ", "Space", 32);
  check("T5.6 Switch: Space toggles aria-checked", (await bench.evaluate(`document.querySelector('button[role="switch"]').getAttribute('aria-checked')`)) === "true");
  check("T5.7 Pagination: nav landmark, aria-current page 3, gaps, Previous / Next", await bench.evaluate(`(function(){const n=document.querySelector('nav[aria-label="Pagination"]'); return !!n && n.querySelector('[aria-current="page"]')?.textContent.trim()==='3' && /Showing 51–75 of 290/.test(n.innerText) && /Previous/.test(n.innerText) && /Next/.test(n.innerText);})()`));
  const vf = await axe(bench, '[data-testid="p1a-primitives"]');
  check("T5.8 axe: 0 serious / critical violations across the new primitives", vf.length === 0, JSON.stringify(vf));

  section("Responsive + axe sweep (existing narrow-screen behaviour kept)");
  const routes = ["/operations", "/operations/requests", `/operations/requests/${REQ}`, "/operations/trips", "/operations/dispatch", "/operations/passengers", "/operations/growth", "/operations/growth/pipeline", "/operations/growth/contacts", "/operations/growth/quotes", "/operations/growth/tasks", "/operations/settings", "/operations/settings/notifications", "/operations/no-such-page"];
  for (const w of [1440, 1024, 768]) {
    const s = await open(`p1a-${w}`, "org-a-admin@example.test", w, w === 768 ? 1024 : 900);
    const bad = [];
    for (const r of routes) {
      await go(s, r);
      const o = await s.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      const v = await axe(s, null);
      if (o || v.length) bad.push(`${r}${o ? " OVERFLOW" : ""} ${v.join(",")}`);
    }
    await s.screenshot(`${OUT}sweep-${w}.png`);
    check(`R ${w} px: ${routes.length} routes — no horizontal overflow and 0 serious / critical axe violations`, bad.length === 0, bad.join(" | "));
  }
} catch (e) {
  fails++;
  console.log(`FAIL — unexpected error :: ${e?.stack ?? e}`);
} finally {
  for (const s of sessions) { try { await s.close(); } catch {} }
  console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
  process.exit(fails === 0 ? 0 : 1);
}
