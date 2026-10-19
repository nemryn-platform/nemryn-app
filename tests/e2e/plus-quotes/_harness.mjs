// Nemryn Plus -- browser harness for the ISOLATED quote regression suites: binds the shared CDP tooling
// (tests/shared/cdp.mjs) to the isolated configuration (_config.mjs: local app URL, Chrome binary, artifacts outside the
// repository). Preserved behaviour of the proven .tmp-qa/local-helper.mjs. Each session uses its own throw-away
// browser profile, so no cookies or sessions are shared between suites or kept in the repository.
import { APP, ARTIFACTS_ROOT, CHROME_PATH } from "./_config.mjs";
import { newChromeSession as cdpSession, sleep } from "../../shared/cdp.mjs";

export { sleep, injectAxe, pdfText } from "../../shared/cdp.mjs";
export const APP_URL = APP;

export function newChromeSession(profileSuffix = "") {
  return cdpSession({ chromePath: CHROME_PATH, profileRoot: ARTIFACTS_ROOT, suffix: profileSuffix });
}

async function waitForSelector(session, selector, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await session.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
    await sleep(300);
  }
  return false;
}

async function fillField(session, selector, value) {
  return session.evaluate(`(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName.toLowerCase() === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/** Signs a FICTIONAL seed identity in through the local app's real sign-in page. The password is never logged. */
export async function signIn(session, email, password) {
  await session.nav(`${APP_URL}/sign-in`, 1500);
  if (!(await waitForSelector(session, 'input[name="email"]', 15000))) throw new Error("sign-in form never appeared");
  await fillField(session, 'input[name="email"]', email);
  await fillField(session, 'input[name="password"]', password);
  await session.evaluate(`document.querySelector('button[type="submit"]').click()`);
  await sleep(2500);
  return session.currentUrl();
}
