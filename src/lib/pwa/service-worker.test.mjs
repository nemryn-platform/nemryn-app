// Runs the REAL emitted service worker source in a sandbox and asserts the cache policy (P1-PILOT-S5A).
//   node --test src/lib/pwa/service-worker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const { buildServiceWorkerSource } = await import("./service-worker.ts");
const { OFFLINE_PATH } = await import("./pwa-core.ts");
const ORIGIN = "https://app.nemryn.test";

class FakeResponse {
  constructor(body = "", init = {}) { this.body = body; this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 300; this.type = init.type ?? "basic"; this.headers = init.headers ?? {}; }
  clone() { return new FakeResponse(this.body, { status: this.status, type: this.type, headers: this.headers }); }
  async text() { return String(this.body); }
}
class FakeRequest {
  constructor(url, init = {}) { this.url = new URL(url, ORIGIN).href; this.method = init.method ?? "GET"; this.mode = init.mode ?? "cors"; this.headers = init.headers ?? {}; }
}

function makeWorker({ network }) {
  const stores = new Map(); // cacheName -> Map(url -> Response)
  const listeners = {};
  const fetched = [];
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      return {
        async match(req) { return s.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url); },
        async put(req, res) { s.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res); },
        async delete(req) { return s.delete(req.url ?? new URL(req, ORIGIN).href); },
        async keys() { return [...s.keys()].map((u) => new FakeRequest(u)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const state = { skipWaiting: 0, claimed: 0 };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() { state.skipWaiting += 1; },
    clients: { async claim() { state.claimed += 1; } },
  };
  const sandbox = {
    self, caches, URL, Response: FakeResponse, Set, Promise, Error, console,
    fetch: async (input) => { const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url; fetched.push(url); return network(url, typeof input === "string" ? null : input); },
  };
  return { sandbox, listeners, stores, fetched, state, run(src) { vm.createContext(sandbox); vm.runInContext(src, sandbox); } };
}

const OFFLINE_HTML = `<html><link rel="stylesheet" href="/_next/static/css/app.abc.css"/><script src="/_next/static/chunks/main.def.js"></script></html>`;
const network = (extra = {}) => async (url) => {
  const u = new URL(url);
  if (extra[u.pathname]) return extra[u.pathname]();
  if (u.pathname === "/offline") return new FakeResponse(OFFLINE_HTML);
  if (u.pathname === "/_next/static/css/app.abc.css") return new FakeResponse("@font-face{src:url(/_next/static/media/geist.woff2)}");
  if (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/pwa/") || u.pathname.startsWith("/brand/")) return new FakeResponse("asset:" + u.pathname);
  return new FakeResponse("SECRET-OPERATIONAL-DATA " + u.pathname);
};

async function fireInstall(w) {
  let done; w.listeners.install({ waitUntil: (p) => { done = p; } }); await done;
}
async function fetchEvent(w, request) {
  let response, called = false;
  w.listeners.fetch({ request, respondWith: (p) => { called = true; response = p; } });
  return { intercepted: called, response: called ? await response : undefined };
}

test("source is versioned per build and sanitised", () => {
  assert.match(buildServiceWorkerSource("abc123"), /const BUILD = "abc123"/);
  assert.notEqual(buildServiceWorkerSource("a"), buildServiceWorkerSource("b"));
  assert.match(buildServiceWorkerSource('x";alert(1);//'), /const BUILD = "[A-Za-z0-9._-]+"/);
  assert.match(buildServiceWorkerSource("v1"), new RegExp(`const OFFLINE_URL = "${OFFLINE_PATH}"`));
  assert.doesNotMatch(buildServiceWorkerSource('x";alert(1);//'), /alert\(1\)/);
});

test("install precaches ONLY the public offline page, icons and its own build assets; never waits/skips", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v1"));
  await fireInstall(w);
  const cache = [...w.stores.get("nemryn-driver-static-v1").keys()].map((u) => new URL(u).pathname).sort();
  assert.deepEqual(cache, ["/_next/static/css/app.abc.css", "/_next/static/chunks/main.def.js", "/_next/static/media/geist.woff2", "/brand/nemryn-symbol-primary.svg", "/offline", "/pwa/apple-touch-icon.png", "/pwa/icon-192.png", "/pwa/icon-512.png"].sort());
  assert.equal(w.state.skipWaiting, 0, "install must NOT skipWaiting (updates never interrupt a trip action)");
});

test("navigation: network first; a server answer (even 401/500) is passed through; offline -> cached offline page", async () => {
  const w = makeWorker({ network: network({ "/driver/trips": () => new FakeResponse("TRIPS-HTML") }) });
  w.run(buildServiceWorkerSource("v1"));
  await fireInstall(w);
  const nav = new FakeRequest("/driver/trips", { mode: "navigate" });
  const online = await fetchEvent(w, nav);
  assert.equal(online.response.body, "TRIPS-HTML");
  assert.equal([...w.stores.get("nemryn-driver-static-v1").keys()].some((u) => u.includes("/driver/trips")), false, "authenticated HTML is NEVER cached");

  const w500 = makeWorker({ network: network({ "/driver": () => new FakeResponse("boom", { status: 500 }) }) });
  w500.run(buildServiceWorkerSource("v1")); await fireInstall(w500);
  assert.equal((await fetchEvent(w500, new FakeRequest("/driver", { mode: "navigate" }))).response.status, 500, "server errors are not 'offline'");

  const wOff = makeWorker({ network: network() });
  wOff.run(buildServiceWorkerSource("v1")); await fireInstall(wOff);
  wOff.sandbox.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const off = await fetchEvent(wOff, new FakeRequest("/driver/trips/trip-zzz-9", { mode: "navigate" }));
  assert.match(off.response.body, /html/);
  assert.doesNotMatch(String(off.response.body), /SECRET|trip-zzz/, "offline page carries no operational data");
});

test("authenticated data, RSC payloads, APIs and Server Actions are NOT intercepted and NOT stored", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v1")); await fireInstall(w);
  const before = w.stores.get("nemryn-driver-static-v1").size;
  const cases = [
    new FakeRequest("/driver/trips/9ccb51dc?_rsc=abc", { headers: { RSC: "1" } }),
    new FakeRequest("/driver?_rsc=zzz", { headers: { RSC: "1" } }),
    new FakeRequest("/api/anything"),
    new FakeRequest("/rest/v1/trips"),
    new FakeRequest("/driver/trips/abc", { method: "POST" }),
    new FakeRequest("https://project.supabase.co/rest/v1/trips"),
    new FakeRequest("/driver/history"),
  ];
  for (const c of cases) assert.equal((await fetchEvent(w, c)).intercepted, false, c.url);
  assert.equal(w.stores.get("nemryn-driver-static-v1").size, before, "nothing was written");
});

test("static assets: cache-first, written once, served from cache thereafter", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v1")); await fireInstall(w);
  w.fetched.length = 0;
  const r1 = await fetchEvent(w, new FakeRequest("/_next/static/chunks/new.123.js"));
  assert.equal(r1.intercepted, true);
  assert.equal(w.fetched.length, 1);
  const r2 = await fetchEvent(w, new FakeRequest("/_next/static/chunks/new.123.js"));
  assert.equal(r2.response.body, "asset:/_next/static/chunks/new.123.js");
  assert.equal(w.fetched.length, 1, "second request served from cache");
  // only same-origin, ok, basic responses are stored
  const wErr = makeWorker({ network: network({ "/_next/static/chunks/bad.js": () => new FakeResponse("x", { status: 404 }) }) });
  wErr.run(buildServiceWorkerSource("v1")); await fireInstall(wErr);
  await fetchEvent(wErr, new FakeRequest("/_next/static/chunks/bad.js"));
  assert.equal([...wErr.stores.get("nemryn-driver-static-v1").keys()].some((u) => u.includes("bad.js")), false);
});

test("activate removes older builds' caches and claims clients", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v2"));
  await w.sandbox.caches.open("nemryn-driver-static-v1");
  await w.sandbox.caches.open("some-other-app-cache");
  let done; w.listeners.activate({ waitUntil: (p) => { done = p; } }); await done;
  assert.deepEqual([...w.stores.keys()].sort(), ["some-other-app-cache"], "old Nemryn build cache deleted, foreign caches untouched");
  assert.equal(w.state.claimed, 1);
});

test("update: SKIP_WAITING is honoured only on message", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v1"));
  w.listeners.message({ data: { type: "SOMETHING_ELSE" }, waitUntil() {} });
  assert.equal(w.state.skipWaiting, 0);
  w.listeners.message({ data: { type: "SKIP_WAITING" }, waitUntil() {} });
  assert.equal(w.state.skipWaiting, 1);
});

test("LOGOUT purges anything that is not a public static asset (defence in depth), keeps the shell", async () => {
  const w = makeWorker({ network: network() });
  w.run(buildServiceWorkerSource("v1")); await fireInstall(w);
  const cache = await w.sandbox.caches.open("nemryn-driver-static-v1");
  await cache.put("/driver/trips/abc", new FakeResponse("PASSENGER DATA"));   // simulate an accidental entry
  await cache.put("/api/thing", new FakeResponse("DATA"));
  const stray = await w.sandbox.caches.open("nemryn-driver-runtime-x");
  await stray.put("/driver", new FakeResponse("HTML"));
  let done; w.listeners.message({ data: { type: "LOGOUT" }, waitUntil: (p) => { done = p; } }); await done;
  const keys = [...w.stores.get("nemryn-driver-static-v1").keys()].map((u) => new URL(u).pathname);
  assert.equal(keys.includes("/driver/trips/abc") || keys.includes("/api/thing"), false);
  assert.equal(keys.includes("/offline"), true, "shell survives logout");
  assert.equal(w.stores.has("nemryn-driver-runtime-x"), false, "stray Nemryn caches removed");
});
