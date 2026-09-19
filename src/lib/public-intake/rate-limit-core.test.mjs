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
