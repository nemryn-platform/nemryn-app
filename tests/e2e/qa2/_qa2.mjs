// NP-UI-QA2 -- shared helpers for the ISOLATED Core / Growth / Auth regression suites (tests/e2e/qa2). Built on the same
// guarded harness as tests/e2e/plus-quotes (localhost app, NemrynS1Iso container, fictional seed only, artifacts
// outside the repository). Suites select by role, accessible name, form-field name and visible operator wording, and
// verify OUTCOMES in the isolated database -- never just that a page rendered.
import { writeFileSync } from "node:fs";
import { newChromeSession, signIn, sleep, injectAxe } from "../plus-quotes/_harness.mjs";
import { APP, SEED_PASSWORD, artifactDir, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

export { sleep, APP, SEED_PASSWORD, sql };

export const ORG_A = "10000000-0000-0000-0000-0000000000a1";
export const ORG_B = "10000000-0000-0000-0000-0000000000b1";
export const TZ = "America/New_York";
export const STAMP = Date.now().toString(36);

/** A suite context: checks, sessions, artifacts. Every suite calls `suite(name)` first and `ctx.finish()` last. */
export function suite(name) {
  assertFictionalSeed();
  const out = artifactDir(`qa2-${name}`);
  const lines = [];
  let fails = 0;
  const sessions = [];
  const ctx = {
    out,
    check(label, cond, detail = "") {
      if (!cond) fails++;
      const line = `${cond ? "PASS" : "FAIL"} — ${label}${detail !== "" && detail !== undefined ? " :: " + String(detail).slice(0, 300) : ""}`;
      console.log(line);
      lines.push(line);
      return !!cond;
    },
    section(s) {
      console.log(`[${new Date().toISOString().slice(11, 19)}] >>> ${s}`);
    },
    /** A signed-in (or anonymous) browser session with every CDP call bounded, so a stalled browser fails by name. */
    async open(label, who, w = 1440, h = 1000) {
      const s = guard(await bounded(newChromeSession(`qa2-${name}-${label}`), 90_000, `launch ${label}`), label);
      sessions.push(s);
      await s.setViewport(w, h);
      if (who) await bounded(signIn(s, who, SEED_PASSWORD), 90_000, `sign in ${who}`);
      return s;
    },
    async close(s) {
      const i = sessions.indexOf(s);
      if (i >= 0) sessions.splice(i, 1);
      try {
        await s.close();
      } catch {}
    },
    async finish(err) {
      if (err) {
        fails++;
        const line = `FAIL — unexpected error :: ${err?.stack ?? err}`;
        console.log(line);
        lines.push(line);
      }
      for (const s of sessions.splice(0)) {
        try {
          await s.close();
        } catch {}
      }
      writeFileSync(`${out}results.txt`, lines.join("\n") + "\n");
      console.log(`=== ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
      process.exit(fails === 0 ? 0 : 1);
    },
  };
  return ctx;
}

const bounded = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${what}`)), ms))]);
function guard(s, label) {
  for (const m of ["nav", "evaluate", "cdp", "screenshot", "setViewport"]) {
    const orig = s[m].bind(s);
    s[m] = (...a) => bounded(orig(...a), 60_000, `${label}.${m}(${String(a[0]).slice(0, 80)})`);
  }
  return s;
}

// ------------------------------------------------------------------ SQL helpers (isolated DB only; fixtures + outcomes)
/** First value of a statement's output (skips psql command tags). */
export const one = (q) => sql(q).split("\n").filter((l) => l && !/^(BEGIN|COMMIT|SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/.test(l))[0]?.trim() ?? "";
/** An org-local timestamp expression: day offset from today + "HH:MM" in the org timezone. */
export const at = (dayOffset, hm, tz = TZ) => `((((now() at time zone '${tz}')::date + ${dayOffset}) + time '${hm}') at time zone '${tz}')`;
export const localDate = (dayOffset, tz = TZ) => one(`select (((now() at time zone '${tz}')::date + ${dayOffset}))::text`);
export const userId = (email) => one(`select id from auth.users where email='${email}'`);

// ------------------------------------------------------------------ browser helpers
export async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}
/** Navigate and wait for a loaded document plus a short settle for client components. */
export async function go(s, path, settle = 900) {
  await s.nav(`${APP}${path}`, 1500);
  await waitFor(async () => (await s.evaluate("document.readyState")) === "complete", 20000);
  await sleep(settle);
}
export const path = (s) => s.evaluate("location.pathname + location.search");
export const text = (s) => s.evaluate("document.body.innerText");
export const mainText = (s) => s.evaluate("(document.querySelector('main') || document.body).innerText");
export const waitText = (s, needle, ms = 20000) => waitFor(async () => (await text(s)).includes(needle), ms);
export const has = (s, sel) => s.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
export const h1s = (s) => s.evaluate(`[...document.querySelectorAll('h1')].filter(h => h.checkVisibility()).map(h => h.innerText.trim())`);
export const overflowX = (s) => s.evaluate("document.documentElement.scrollWidth - window.innerWidth");
const ROOT = (scope) => (scope === "dialog" ? "Array.from(document.querySelectorAll('dialog')).find(x => x.open)" : scope === "main" ? "document.querySelector('main')" : "document");
/** Visible control labels (buttons + links) in a scope. */
export const controls = (s, scope = "main") =>
  s.evaluate(`(function(){const r=${ROOT(scope)}; return r ? Array.from(r.querySelectorAll('button, a')).filter(e => e.checkVisibility()).map(e => (e.getAttribute('aria-label') || e.textContent).trim()).filter(Boolean) : [];})()`);
/** Click the first enabled button / link whose visible text (or aria-label) equals `label`. */
export const click = (s, label, scope = "document", tags = "button, a") =>
  s.evaluate(`(function(){const r=${ROOT(scope)}; const b=r && Array.from(r.querySelectorAll(${JSON.stringify(tags)})).find(e => ((e.textContent||'').trim()===${JSON.stringify(label)} || e.getAttribute('aria-label')===${JSON.stringify(label)}) && !e.disabled && e.checkVisibility()); if(!b) return false; b.click(); return true;})()`);
/** Set a form control's value the way React sees user input (input / textarea / select), optionally within a dialog. */
export const setField = (s, selector, value, scope = "document") =>
  s.evaluate(`(function(){const r=${ROOT(scope)}; const el=r && r.querySelector(${JSON.stringify(selector)}); if(!el) return false;
    const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== !!${JSON.stringify(value)}) el.click(); return true; }
    Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
export const value = (s, selector, scope = "document") => s.evaluate(`(function(){const r=${ROOT(scope)}; const el=r && r.querySelector(${JSON.stringify(selector)}); return el ? el.value : null;})()`);
export const dialogOpen = (s) => s.evaluate(`!!Array.from(document.querySelectorAll('dialog')).find(x => x.open)`);
export const dialogText = (s) => s.evaluate(`(function(){const d=Array.from(document.querySelectorAll('dialog')).find(x => x.open); return d ? d.innerText : '';})()`);
/** Pick an option from the shared Combobox by typing a query and choosing the first match. */
export async function comboPick(s, query, scope = "document") {
  await s.evaluate(`(function(){const r=${ROOT(scope)}; const el=r.querySelector('input[role="combobox"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(query)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await waitFor(() => s.evaluate(`!!document.querySelector('[role="listbox"] [role="option"]')`), 5000);
  return s.evaluate(`(function(){const o=[...document.querySelectorAll('[role="listbox"] [role="option"]')].find(x => x.textContent.includes(${JSON.stringify(query)})); if(!o) return false; o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return true;})()`);
}
/** Real keyboard input through CDP (Tab, Enter, Escape, arrows, Space). */
export async function key(s, k) {
  const map = { Tab: ["Tab", 9], Enter: ["Enter", 13], Escape: ["Escape", 27], " ": ["Space", 32], ArrowDown: ["ArrowDown", 40], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowLeft: ["ArrowLeft", 37] };
  const [code, kc] = map[k];
  await s.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, ...(k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await s.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  await sleep(150);
}
export const activeLabel = (s) => s.evaluate(`(function(){const a=document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0,60) : '';})()`);
/** axe-core (pinned 4.10.2): serious / critical violation ids, optionally scoped. */
export async function axe(s, include) {
  await injectAxe(s);
  return s.evaluate(`axe.run(${include ? `{ include: [${JSON.stringify(include)}] }` : "document"}, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + 'x' + v.nodes.length + ':' + (v.nodes[0]?.target?.[0] ?? '')))`);
}
export async function shot(s, out, name) {
  await s.screenshot(`${out}${name}.png`);
}
