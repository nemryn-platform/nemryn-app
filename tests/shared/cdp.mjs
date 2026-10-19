// Nemryn -- shared, configuration-free test tooling: a minimal Chrome DevTools Protocol harness (no Playwright /
// Puppeteer), the pinned axe-core injector and the pinned pdf.js text extractor. Used by the isolated suites
// (tests/e2e/plus-quotes) and the production read-only scripts (tests/prod-readonly/plus-quotes); each caller supplies
// its own Chrome binary and an artifacts directory OUTSIDE the repository for throw-away browser profiles.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Randomized per-process base avoids port collisions with a Chrome left over from an earlier run.
let portCounter = 9500 + Math.floor(Math.random() * 400);
const RUN_STAMP = Date.now();

// Every spawned Chrome is detached into its own process group; kill the whole group on close() AND on process exit.
const spawnedChromePids = new Set();
function killChromeGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  spawnedChromePids.delete(pid);
}
process.on("exit", () => {
  for (const pid of [...spawnedChromePids]) killChromeGroup(pid);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(130));
}

export async function newChromeSession({ chromePath, profileRoot, suffix = "" }) {
  const port = portCounter++;
  const profileDir = path.join(profileRoot, ".chrome-profiles", `${RUN_STAMP}-${port}${suffix}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", `--user-data-dir=${profileDir}`], {
    stdio: "ignore",
    detached: true,
  });
  chrome.unref();
  spawnedChromePids.add(chrome.pid);
  await sleep(1200);

  let version;
  let lastErr;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await versionRes.json();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(800);
    }
  }
  if (lastErr) throw lastErr;

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  let msgId = 1;
  async function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.id === id) {
          ws.removeEventListener("message", handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Network.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  return {
    port,
    pid: chrome.pid,
    async nav(url, waitMs = 2000) {
      await send("Page.navigate", { url }, sessionId);
      await sleep(waitMs);
    },
    async setViewport(width, height) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    },
    cdp: (method, params = {}) => send(method, params, sessionId),
    async screenshot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
    async evaluate(expression) {
      const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (res.exceptionDetails) throw new Error("evaluate error: " + JSON.stringify(res.exceptionDetails));
      return res.result.value;
    },
    async currentUrl() {
      return this.evaluate("window.location.pathname + window.location.search");
    },
    async close() {
      try {
        await send("Target.closeTarget", { targetId });
      } catch {}
      ws.close();
      killChromeGroup(chrome.pid);
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Locally managed, pinned tools (devDependencies; no CDN at test time)
// -------------------------------------------------------------------------------------------------------------------
const require = createRequire(import.meta.url);

/** Injects the pinned axe-core (node_modules/axe-core, devDependency 4.10.2) into the current page. */
export async function injectAxe(session) {
  if (await session.evaluate("typeof window.axe === 'object'")) return;
  const source = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  await session.evaluate(`${source}\n;true`);
}

let pdfjs;
/**
 * Extracts the text of a browser-generated PDF (Page.printToPDF base64) with the pinned pdfjs-dist (devDependency
 * 4.10.38, Node legacy build, eval disabled). Returns { pages, text } with whitespace collapsed.
 */
export async function pdfText(base64) {
  pdfjs ??= await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const data = new Uint8Array(Buffer.from(base64, "base64"));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + " ";
  return { pages: doc.numPages, text: text.replace(/\s+/g, " ") };
}
