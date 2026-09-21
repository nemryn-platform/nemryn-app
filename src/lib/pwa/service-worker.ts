/** Import-free on purpose (runs under plain Node in tests). Must equal OFFLINE_PATH in pwa-core.ts (asserted by a test). */
const OFFLINE_PATH = "/offline";

/**
 * The Nemryn Driver service worker (P1-PILOT-S5A), emitted as source text so it
 * can be versioned per build and executed unchanged by the unit tests
 * (service-worker.test.mjs runs THIS exact text in a sandbox).
 *
 * PURPOSE: app-shell resilience only. NOT an offline database.
 *
 * WHAT IT MAY STORE (one cache, `nemryn-driver-static-<build>`):
 *   /_next/static/**   content-hashed build assets (JS, CSS, fonts)   cache-first
 *   /pwa/**, /brand/** public icons and brand SVGs                     cache-first
 *   /offline           the public, tenant-free offline page (precached at install)
 * NOTHING ELSE. In particular no HTML of any authenticated page, no RSC payload,
 * no API/Server Action response, no Trip/Passenger/address/notes/exception/proof
 * data, no personal data. Anything outside the allowlist is not intercepted at
 * all: the request goes straight to the network (network-first with NO fallback
 * copy), so an offline Driver is never shown stale operational data as current.
 *
 * NAVIGATIONS: network only. If the network is unreachable the cached /offline
 * page is shown. A server answer (including 401/403/404/5xx) is passed through
 * unchanged -- server errors are not "offline".
 *
 * MUTATIONS (POST / Server Actions): never intercepted, never queued, never
 * replayed. There is no background sync.
 *
 * UPDATES: a new worker installs and WAITS. It takes over only when the Driver
 * taps "Update" (message SKIP_WAITING) or all app windows close -- never in the
 * middle of a trip action.
 *
 * LOGOUT: message LOGOUT deletes every cache this worker does not own for the
 * allowlist and any cached entry that is not an allowlisted public asset.
 */
export function buildServiceWorkerSource(buildId: string): string {
  const safeBuild = buildId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "dev";
  return `/* Nemryn Driver service worker -- build ${safeBuild} -- see src/lib/pwa/service-worker.ts */
"use strict";
const BUILD = ${JSON.stringify(safeBuild)};
const PREFIX = "nemryn-driver-";
const STATIC_CACHE = PREFIX + "static-" + BUILD;
const OFFLINE_URL = ${JSON.stringify(OFFLINE_PATH)};
const PRECACHE = [OFFLINE_URL, "/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/apple-touch-icon.png", "/brand/nemryn-symbol-primary.svg"];

/** The ONLY things this worker will ever store or serve from cache. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return p.startsWith("/_next/static/") || p.startsWith("/pwa/") || p.startsWith("/brand/") || p === OFFLINE_URL;
}

function assetUrlsIn(text) {
  const out = new Set();
  const re = /(?:href=|src=|url\\()["']?(\\/_next\\/static\\/[^"')\\s>\\\\]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1].replace(/&amp;/g, "&"));
  return out;
}

async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  // Public, credential-free fetches: the shell must never be built from an authenticated response.
  const offline = await fetch(OFFLINE_URL, { cache: "reload", credentials: "omit" });
  if (!offline.ok) throw new Error("offline page unavailable");
  const html = await offline.clone().text();
  await cache.put(OFFLINE_URL, offline);
  const assets = assetUrlsIn(html);
  for (const url of PRECACHE.slice(1)) assets.add(url);
  const fonts = new Set();
  for (const url of assets) {
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) continue;
      if (url.endsWith(".css")) for (const f of assetUrlsIn(await res.clone().text())) fonts.add(f);
      await cache.put(url, res);
    } catch (e) { /* a missing optional asset must not break install */ }
  }
  for (const url of fonts) {
    try { const res = await fetch(url, { credentials: "omit" }); if (res.ok) await cache.put(url, res); } catch (e) { /* optional */ }
  }
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: the new version waits until the Driver chooses to update.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== STATIC_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // mutations are never touched

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(OFFLINE_URL)) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
    );
    return;
  }

  if (!isCacheableAsset(url)) return; // authenticated data, RSC, APIs: network only, never stored

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && res.type === "basic") await cache.put(request, res.clone());
    return res;
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "LOGOUT") {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== STATIC_CACHE) await caches.delete(name);
      }
      const cache = await caches.open(STATIC_CACHE);
      for (const req of await cache.keys()) {
        if (!isCacheableAsset(new URL(req.url))) await cache.delete(req);
      }
    })());
  }
});
`;
}
