// Focused unit tests for the pure public-intake rate-limit helpers
// (P1-PILOT-S4B). Run with:
//
//   node --test src/lib/public-intake/rate-limit-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { hashClientIp, resolveClientIpFromHeaders } = await import("./rate-limit-core.ts");

function headersFrom(obj) {
  return { get: (name) => obj[name.toLowerCase()] ?? null };
}

// ---------------------------------------------------------------------
// hashClientIp
// ---------------------------------------------------------------------

test("hashClientIp — deterministic: the same IP always hashes to the same value", () => {
  const a = hashClientIp("203.0.113.42");
  const b = hashClientIp("203.0.113.42");
  assert.equal(a, b);
});

test("hashClientIp — different IPs hash to different values", () => {
  const a = hashClientIp("203.0.113.42");
  const b = hashClientIp("203.0.113.43");
  assert.notEqual(a, b);
});

test("hashClientIp — never returns the raw IP itself (one-way)", () => {
  const hash = hashClientIp("203.0.113.42");
  assert.equal(hash.includes("203.0.113.42"), false);
});

test("hashClientIp — produces a fixed-length hex digest (SHA-256, 64 hex chars)", () => {
  const hash = hashClientIp("203.0.113.42");
  assert.equal(hash.length, 64);
  assert.equal(/^[0-9a-f]{64}$/.test(hash), true);
});

test("hashClientIp — handles the 'unknown' fallback bucket deterministically", () => {
  const a = hashClientIp("unknown");
  const b = hashClientIp("unknown");
  assert.equal(a, b);
});

// ---------------------------------------------------------------------
// resolveClientIpFromHeaders
// ---------------------------------------------------------------------

test("resolveClientIpFromHeaders — uses x-forwarded-for's first entry", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({ "x-forwarded-for": "203.0.113.42, 10.0.0.1, 10.0.0.2" }));
  assert.equal(ip, "203.0.113.42");
});

test("resolveClientIpFromHeaders — trims whitespace around the first entry", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({ "x-forwarded-for": "  203.0.113.42  , 10.0.0.1" }));
  assert.equal(ip, "203.0.113.42");
});

test("resolveClientIpFromHeaders — single-value x-forwarded-for", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({ "x-forwarded-for": "203.0.113.42" }));
  assert.equal(ip, "203.0.113.42");
});

test("resolveClientIpFromHeaders — falls back to x-real-ip when x-forwarded-for is absent", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({ "x-real-ip": "198.51.100.7" }));
  assert.equal(ip, "198.51.100.7");
});

test("resolveClientIpFromHeaders — falls back to 'unknown' when neither header is present (never null, never skips rate-limiting)", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({}));
  assert.equal(ip, "unknown");
});

test("resolveClientIpFromHeaders — empty x-forwarded-for value falls through to x-real-ip", () => {
  const ip = resolveClientIpFromHeaders(headersFrom({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" }));
  assert.equal(ip, "198.51.100.7");
});

// ---------------------------------------------------------------------------
// P1-COMM-D3R -- verified-connection classification + bucket selection
// ---------------------------------------------------------------------------
const { isVerifiedWebsiteConnection, websiteIntakeRateLimitKeys } = await import("./rate-limit-core.ts");
const live = { integration_type: "website", is_active: true, retired_at: null, allowed_origins: ["https://www.acme.example"] };

test("verified = exact live website connection + exact Origin (same rule as the intake RPC)", () => {
  assert.equal(isVerifiedWebsiteConnection(live, "https://www.acme.example"), true);
  assert.equal(isVerifiedWebsiteConnection(null, "https://www.acme.example"), false, "unknown id");
  assert.equal(isVerifiedWebsiteConnection({ ...live, is_active: false }, "https://www.acme.example"), false, "turned off");
  assert.equal(isVerifiedWebsiteConnection({ ...live, retired_at: "2026-09-24T00:00:00Z" }, "https://www.acme.example"), false, "retired");
  assert.equal(isVerifiedWebsiteConnection({ ...live, integration_type: "nemryn_form" }, "https://www.acme.example"), false, "form binding");
  assert.equal(isVerifiedWebsiteConnection(live, "https://acme.example"), false, "www mismatch");
  assert.equal(isVerifiedWebsiteConnection(live, "http://www.acme.example"), false, "scheme mismatch");
  assert.equal(isVerifiedWebsiteConnection(live, null), false, "missing Origin");
  assert.equal(isVerifiedWebsiteConnection({ ...live, allowed_origins: null }, null), true, "no allow-list: RPC does not check Origin either");
});

test("verified traffic: integration bucket + per-submission client key (never the IP)", () => {
  const a1 = websiteIntakeRateLimitKeys({ verified: true, integrationExternalId: "web_A", idempotencyKey: "k1", clientIp: "203.0.113.9" });
  const a2 = websiteIntakeRateLimitKeys({ verified: true, integrationExternalId: "web_A", idempotencyKey: "k2", clientIp: "203.0.113.9" });
  const a1again = websiteIntakeRateLimitKeys({ verified: true, integrationExternalId: "web_A", idempotencyKey: "k1", clientIp: "198.51.100.1" });
  const b1 = websiteIntakeRateLimitKeys({ verified: true, integrationExternalId: "web_B", idempotencyKey: "k1", clientIp: "203.0.113.9" });
  assert.equal(a1.integrationKey, "web_A");
  assert.notEqual(a1.clientKey, a2.clientKey, "distinct submissions from one IP never share a client bucket");
  assert.equal(a1.clientKey, a1again.clientKey, "replays of one submission share a bucket regardless of IP");
  assert.notEqual(a1.clientKey, b1.clientKey, "same key under another integration is a different bucket");
  assert.notEqual(a1.clientKey, hashClientIp("203.0.113.9"), "never the IP bucket");
  assert.match(a1.clientKey, /^[0-9a-f]{64}$/);
});

test("unverified traffic: per-IP abuse bucket + a separate 'unverified:' integration bucket", () => {
  const u = websiteIntakeRateLimitKeys({ verified: false, integrationExternalId: "web_A", idempotencyKey: "k1", clientIp: "203.0.113.9" });
  assert.equal(u.clientKey, hashClientIp("203.0.113.9"));
  assert.equal(u.integrationKey, "unverified:web_A", "garbage naming a real id cannot consume that connection's capacity");
});
