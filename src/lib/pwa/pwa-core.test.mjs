// Unit tests for the Driver PWA definitions (P1-PILOT-S5A).
//   node --test src/lib/pwa/pwa-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = await import("./pwa-core.ts");

test("manifest: installable, tenant-neutral, Nemryn identity", () => {
  const m = core.buildDriverManifest();
  assert.equal(m.name, "Nemryn Driver");
  assert.equal(m.short_name, "Nemryn");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/driver");
  assert.equal(m.id, "/driver");
  assert.equal(m.scope, "/");
  assert.ok(m.start_url.startsWith("/") && !/https?:/.test(m.start_url));
  assert.equal(m.theme_color, "#171A1D");
  assert.equal(m.background_color, "#F7F7F4");
  assert.equal(m.prefer_related_applications, false);
  const text = JSON.stringify(m);
  assert.doesNotMatch(text, /zenward/i, "no tenant identity in the manifest");
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-/, "no ids in the manifest");
});

test("manifest icons: 192, 512, maskable 512 exist on disk with the declared sizes", () => {
  const m = core.buildDriverManifest();
  const sizes = m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  assert.deepEqual(sizes, ["192x192/any", "512x512/any", "512x512/maskable"]);
  for (const icon of m.icons) {
    const buf = fs.readFileSync(new URL(`../../../public${icon.src}`, import.meta.url));
    assert.equal(buf.subarray(1, 4).toString("ascii"), "PNG");
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  const apple = fs.readFileSync(new URL("../../../public/pwa/apple-touch-icon.png", import.meta.url));
  assert.equal(`${apple.readUInt32BE(16)}x${apple.readUInt32BE(20)}`, "180x180");
});

test("network failure classification separates 'offline' from other errors", () => {
  assert.equal(core.isNetworkFailure(new TypeError("Failed to fetch")), true);
  assert.equal(core.isNetworkFailure(new TypeError("Load failed")), true);
  assert.equal(core.isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource.")), true);
  assert.equal(core.isNetworkFailure(new Error("boom")), false);
  assert.equal(core.isNetworkFailure(new TypeError("x is not a function")), false);
  assert.equal(core.isNetworkFailure({ status: 500 }), false);
  assert.equal(core.isNetworkFailure(new Error("anything"), false), true, "navigator.onLine=false is a network failure");
  assert.equal(core.isNetworkFailure(new Error("anything"), true), false);
});

test("install-environment detection", () => {
  assert.equal(core.isStandaloneDisplay(true, undefined), true);
  assert.equal(core.isStandaloneDisplay(false, true), true);
  assert.equal(core.isStandaloneDisplay(false, undefined), false);
  assert.equal(core.isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5), true);
  assert.equal(core.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true, "iPadOS desktop UA");
  assert.equal(core.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false, "a real Mac");
  assert.equal(core.isIosDevice("Mozilla/5.0 (Linux; Android 14; SM-F946U)", 5), false);
});

test("network indicator timing constants are restrained", () => {
  assert.ok(core.OFFLINE_DEBOUNCE_MS >= 1500, "brief blips must not flash a banner");
  assert.ok(core.OFFLINE_PROBE_INTERVAL_MS >= 3000);
  assert.ok(core.RECONNECTED_VISIBLE_MS <= 5000);
});

test("service worker scope covers the /driver start page itself (no trailing slash) and nothing outside the Driver surface", () => {
  assert.equal(core.SERVICE_WORKER_SCOPE, "/driver");
  const covers = (path) => path === core.SERVICE_WORKER_SCOPE || path.startsWith(core.SERVICE_WORKER_SCOPE + "/");
  for (const p of ["/driver", "/driver/trips", "/driver/trips/abc", "/driver/history", "/driver/profile"]) assert.equal(covers(p), true, p);
  for (const p of ["/", "/operations", "/platform", "/sign-in", "/api/ping"]) assert.equal(covers(p), false, p);
});
