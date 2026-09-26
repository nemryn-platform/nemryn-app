// Unit tests for the pure wheelchair capability match (P1-OPS-PROG5B).
//   node --test src/lib/operations/capability-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { deriveCapabilityMatch, capabilityNotice, capabilityFlag, triStateToBoolean, booleanToTriState } = await import("./capability-core.ts");
const cap = (ramp, lift, positions, seats = null) => ({ wheelchairRamp: ramp, wheelchairLift: lift, wheelchairPositions: positions, seatedCapacity: seats });

test("requirement false -> NOT_APPLICABLE; requirement unknown -> REQUIREMENT_UNKNOWN (whatever the vehicle)", () => {
  assert.equal(deriveCapabilityMatch(false, cap(false, false, 0)), "NOT_APPLICABLE");
  assert.equal(deriveCapabilityMatch(null, cap(false, false, 0)), "REQUIREMENT_UNKNOWN");
  assert.equal(capabilityNotice("REQUIREMENT_UNKNOWN"), null);
});

test("required: CAPABLE only with positions >= 1 AND (ramp OR lift)", () => {
  assert.equal(deriveCapabilityMatch(true, cap(true, null, 1)), "CAPABLE");
  assert.equal(deriveCapabilityMatch(true, cap(null, true, 2)), "CAPABLE");
  assert.equal(deriveCapabilityMatch(true, cap(true, true, 4, null)), "CAPABLE", "seated capacity unknown has no effect");
});

test("required: KNOWN_MISMATCH when positions = 0 or both access methods false", () => {
  assert.equal(deriveCapabilityMatch(true, cap(true, true, 0)), "KNOWN_MISMATCH");
  assert.equal(deriveCapabilityMatch(true, cap(false, false, 2)), "KNOWN_MISMATCH");
  assert.equal(deriveCapabilityMatch(true, cap(false, false, null)), "KNOWN_MISMATCH");
});

test("required: NOT_CHECKABLE when facts are missing (UNKNOWN is never a mismatch)", () => {
  assert.equal(deriveCapabilityMatch(true, cap(null, null, null)), "NOT_CHECKABLE");
  assert.equal(deriveCapabilityMatch(true, cap(null, null, 2)), "NOT_CHECKABLE");
  assert.equal(deriveCapabilityMatch(true, cap(true, null, null)), "NOT_CHECKABLE");
  assert.equal(deriveCapabilityMatch(true, cap(false, null, 1)), "NOT_CHECKABLE", "ramp known absent, lift unknown");
  assert.equal(deriveCapabilityMatch(true, null), "NOT_CHECKABLE");
});

test("copy is factual and never a regulatory claim", () => {
  for (const m of ["KNOWN_MISMATCH", "NOT_CHECKABLE"]) {
    const text = capabilityNotice(m) + " " + capabilityFlag(m);
    assert.doesNotMatch(text, /ADA|certif|approved|authoriz|compliant|accessible certification|best|recommend/i);
  }
  assert.equal(capabilityFlag("CAPABLE"), null);
});

test("tri-state form mapping", () => {
  assert.equal(triStateToBoolean("yes"), true);
  assert.equal(triStateToBoolean("no"), false);
  assert.equal(triStateToBoolean("unspecified"), null);
  assert.equal(triStateToBoolean(""), null);
  assert.equal(booleanToTriState(null), "unspecified");
  assert.equal(booleanToTriState(false), "no");
});
