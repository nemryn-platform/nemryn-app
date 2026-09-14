// Focused unit tests for the pure origin-normalization helpers behind the
// driver-invitation-email link builder (P0-S2A). Zero new dependencies —
// Node's own built-in test runner. Run with:
//
//   node --test src/lib/app-url-core.test.mjs
//
// Deliberately tests real behavior (URL parsing edge cases), not mocks
// against mocks — every case here is a malformed/edge-case input this
// review was specifically asked to prevent from producing a broken
// `/join/<token>` invitation link.

import test from "node:test";
import assert from "node:assert/strict";

// This file has NO `server-only`/`next/headers` import, so it can be
// imported directly under plain Node — see the file's own header comment.
const { resolveConfiguredOrigin, isLoopbackOrigin } = await import("./app-url-core.ts");

test("resolveConfiguredOrigin — accepts a clean production URL", () => {
  assert.equal(resolveConfiguredOrigin("https://app.zenwardmobility.com"), "https://app.zenwardmobility.com");
});

test("resolveConfiguredOrigin — accepts a clean local dev URL", () => {
  assert.equal(resolveConfiguredOrigin("http://localhost:3000"), "http://localhost:3000");
});

test("resolveConfiguredOrigin — strips a single trailing slash", () => {
  assert.equal(resolveConfiguredOrigin("https://app.zenwardmobility.com/"), "https://app.zenwardmobility.com");
});

test("resolveConfiguredOrigin — strips a double trailing slash (no //join possible downstream)", () => {
  assert.equal(resolveConfiguredOrigin("https://app.zenwardmobility.com//"), "https://app.zenwardmobility.com");
});

test("resolveConfiguredOrigin — strips an accidental path/query so it can never leak into the built link", () => {
  assert.equal(resolveConfiguredOrigin("https://app.zenwardmobility.com/some/base?x=1#y"), "https://app.zenwardmobility.com");
});

test("resolveConfiguredOrigin — rejects a bare hostname with no scheme (missing protocol)", () => {
  assert.equal(resolveConfiguredOrigin("app.zenwardmobility.com"), null);
});

test("resolveConfiguredOrigin — rejects a non-http(s) scheme", () => {
  assert.equal(resolveConfiguredOrigin("javascript:alert(1)"), null);
  assert.equal(resolveConfiguredOrigin("data:text/html,hi"), null);
  assert.equal(resolveConfiguredOrigin("ftp://x.com"), null);
});

test("resolveConfiguredOrigin — rejects blank/whitespace/undefined/null", () => {
  assert.equal(resolveConfiguredOrigin(""), null);
  assert.equal(resolveConfiguredOrigin("   "), null);
  assert.equal(resolveConfiguredOrigin(undefined), null);
  assert.equal(resolveConfiguredOrigin(null), null);
});

test("resolveConfiguredOrigin — never returns a trailing slash for any accepted input", () => {
  for (const value of [
    "https://app.zenwardmobility.com",
    "https://app.zenwardmobility.com/",
    "https://app.zenwardmobility.com//",
    "http://localhost:3000",
    "http://localhost:3000/",
  ]) {
    const result = resolveConfiguredOrigin(value);
    assert.ok(result, `expected ${value} to resolve`);
    assert.ok(!result.endsWith("/"), `${result} (from ${value}) must not end with a slash`);
  }
});

test("isLoopbackOrigin — flags localhost and 127.0.0.1", () => {
  assert.equal(isLoopbackOrigin("http://localhost:3000"), true);
  assert.equal(isLoopbackOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isLoopbackOrigin("http://[::1]:3000"), true);
});

test("isLoopbackOrigin — does not flag the real production origin", () => {
  assert.equal(isLoopbackOrigin("https://app.zenwardmobility.com"), false);
});

test("isLoopbackOrigin — does not flag a hostname that merely contains 'localhost' as a substring", () => {
  // Guards against a naive `.includes("localhost")` implementation, which
  // would incorrectly flag a legitimate host like this one.
  assert.equal(isLoopbackOrigin("https://notlocalhost.example.com"), false);
});

test("isLoopbackOrigin — false (not throw) for a malformed origin", () => {
  assert.equal(isLoopbackOrigin("not a url"), false);
});

// --- End-to-end shape check: exactly what the invite-email link builder does ---
test("simulated buildDriverInviteUrl — production config produces the exact expected link, no double slash", () => {
  const origin = resolveConfiguredOrigin("https://app.zenwardmobility.com/");
  const token = "8940e6ec-b2e8-452b-8bf8-dd8d57266c06";
  const url = `${origin}/join/${encodeURIComponent(token)}`;
  assert.equal(url, "https://app.zenwardmobility.com/join/8940e6ec-b2e8-452b-8bf8-dd8d57266c06");
  assert.ok(!url.includes("//join"), "must never double-slash before /join");
});

test("simulated buildDriverInviteUrl — a misconfigured value without a scheme does not silently produce a broken link", () => {
  // This is the case getAppOrigin() falls back past (to request headers)
  // rather than building a link from — confirmed here at the pure-function
  // level: a bare hostname resolves to null, not a malformed string.
  const origin = resolveConfiguredOrigin("app.zenwardmobility.com");
  assert.equal(origin, null);
});
