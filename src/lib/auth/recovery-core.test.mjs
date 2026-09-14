// Focused unit tests for the pure password-recovery input-validation
// helpers (P0-S2B). Node's own built-in test runner, zero new
// dependencies — mirrors src/lib/app-url-core.test.mjs's own pattern.
//
//   node --test src/lib/auth/recovery-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { isPlausibleEmail, validateNewPassword, MIN_PASSWORD_LENGTH } = await import("./recovery-core.ts");

test("isPlausibleEmail — accepts an ordinary address", () => {
  assert.equal(isPlausibleEmail("owner@example.test"), true);
});

test("isPlausibleEmail — accepts an address with a subdomain/plus-tag", () => {
  assert.equal(isPlausibleEmail("owner+tag@mail.example.test"), true);
});

test("isPlausibleEmail — rejects empty/whitespace-only input", () => {
  assert.equal(isPlausibleEmail(""), false);
  assert.equal(isPlausibleEmail("   "), false);
});

test("isPlausibleEmail — rejects missing @ or domain", () => {
  assert.equal(isPlausibleEmail("not-an-email"), false);
  assert.equal(isPlausibleEmail("missing-domain@"), false);
  assert.equal(isPlausibleEmail("@missing-local.test"), false);
  assert.equal(isPlausibleEmail("no-tld@example"), false);
});

test("isPlausibleEmail — rejects embedded whitespace", () => {
  assert.equal(isPlausibleEmail("has space@example.test"), false);
  assert.equal(isPlausibleEmail("has@ex ample.test"), false);
});

test("isPlausibleEmail — rejects non-string / absent input", () => {
  assert.equal(isPlausibleEmail(undefined), false);
  assert.equal(isPlausibleEmail(null), false);
  assert.equal(isPlausibleEmail(42), false);
  assert.equal(isPlausibleEmail(["owner@example.test"]), false);
});

test("isPlausibleEmail — rejects an absurdly long value", () => {
  const local = "a".repeat(260);
  assert.equal(isPlausibleEmail(`${local}@example.test`), false);
});

test("validateNewPassword — accepts a matching password at the minimum length", () => {
  const pw = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(validateNewPassword(pw, pw), { valid: true });
});

test("validateNewPassword — accepts a matching password well above the minimum", () => {
  assert.deepEqual(validateNewPassword("a-genuinely-long-passphrase-2026", "a-genuinely-long-passphrase-2026"), {
    valid: true,
  });
});

test("validateNewPassword — rejects a password shorter than the minimum, even if it matches its confirmation", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.deepEqual(validateNewPassword(short, short), { valid: false, reason: "weak" });
});

test("validateNewPassword — rejects mismatched passwords that are individually strong enough", () => {
  assert.deepEqual(validateNewPassword("correct-horse-battery", "correct-horse-battery-STAPLE"), {
    valid: false,
    reason: "mismatch",
  });
});

test("validateNewPassword — weak check takes priority over mismatch when both are true", () => {
  // A caller only needs one field to react to; "weak" is the more
  // actionable of the two (fix length before worrying about matching).
  assert.deepEqual(validateNewPassword("short", "different"), { valid: false, reason: "weak" });
});

test("validateNewPassword — rejects non-string / absent input", () => {
  assert.deepEqual(validateNewPassword(undefined, undefined), { valid: false, reason: "weak" });
  assert.deepEqual(validateNewPassword(null, null), { valid: false, reason: "weak" });
});

test("MIN_PASSWORD_LENGTH — matches the sign-up policy (src/app/sign-up/actions.ts: password.length < 8)", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});
