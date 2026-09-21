// Focused unit tests for owner-operator self-service Driver access helpers (P1-PILOT-S5A1).
//   node --test src/lib/operations/self-driver-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const {
  deriveDriverAccess, normalizeSelfDriverInput, classifySelfDriverError, operationsAccessLabel,
  SELF_DRIVER_FAILURE_MESSAGE, SELF_DRIVER_INPUT_MESSAGE, DISPLAY_NAME_MAX, PHONE_MAX,
} = await import("./self-driver-core.ts");

test("driver access state: none / active / inactive / ambiguous", () => {
  assert.equal(deriveDriverAccess([]), "not_set_up");
  assert.equal(deriveDriverAccess([{ status: "active" }]), "active");
  assert.equal(deriveDriverAccess([{ status: "inactive" }]), "inactive");
  assert.equal(deriveDriverAccess([{ status: "inactive" }, { status: "active" }]), "active");
  assert.equal(deriveDriverAccess([{ status: "inactive" }, { status: "inactive" }]), "needs_support");
  assert.equal(deriveDriverAccess([{ status: "something_else" }]), "needs_support");
});

test("operations access is shown as a label, never a raw role code", () => {
  assert.equal(operationsAccessLabel("organization_admin"), "Organization Admin");
  assert.equal(operationsAccessLabel("dispatcher"), "Dispatcher");
  assert.equal(operationsAccessLabel("nonsense"), "Team member");
});

test("input: the name is required and trimmed; phone is optional and bounded", () => {
  assert.deepEqual(normalizeSelfDriverInput("  Victor Owner ", " 555-0100 "), { ok: true, displayName: "Victor Owner", phone: "555-0100" });
  assert.deepEqual(normalizeSelfDriverInput("Victor", ""), { ok: true, displayName: "Victor", phone: null });
  assert.deepEqual(normalizeSelfDriverInput("Victor", null), { ok: true, displayName: "Victor", phone: null });
  assert.equal(normalizeSelfDriverInput("   ", "1").ok, false);
  assert.equal(normalizeSelfDriverInput(undefined, "1").error, "name_required");
  assert.equal(normalizeSelfDriverInput("x".repeat(DISPLAY_NAME_MAX + 1), "").error, "name_too_long");
  assert.equal(normalizeSelfDriverInput("x", "9".repeat(PHONE_MAX + 1)).error, "phone_too_long");
  assert.equal(normalizeSelfDriverInput("x".repeat(DISPLAY_NAME_MAX), "9".repeat(PHONE_MAX)).ok, true);
});

test("database error codes map to stable failures; nothing is parsed from message text", () => {
  assert.equal(classifySelfDriverError("ZW001"), "not_allowed");
  assert.equal(classifySelfDriverError("ZW002"), "not_allowed");
  assert.equal(classifySelfDriverError("ZW003"), "conflict");
  assert.equal(classifySelfDriverError("ZW006"), "invalid");
  assert.equal(classifySelfDriverError("23505"), "failed");
  assert.equal(classifySelfDriverError(undefined), "failed");
  assert.equal(classifySelfDriverError(null), "failed");
});

test("customer copy is plain: no ids, codes or jargon", () => {
  const all = [...Object.values(SELF_DRIVER_FAILURE_MESSAGE), ...Object.values(SELF_DRIVER_INPUT_MESSAGE)];
  for (const text of all) {
    assert.doesNotMatch(text, /ZW0|uuid|SQLSTATE|organization_admin|persona|orchestrat|\bAI\b|smart/i, text);
  }
  assert.match(SELF_DRIVER_FAILURE_MESSAGE.conflict, /support/i);
});
