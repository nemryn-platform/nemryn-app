// Focused unit tests for the Proof-of-Service Assurance presentation
// helpers added to presentation.ts (P1-E3-S1D §38). Run with:
//
//   node --test src/lib/operations/proof-of-service-presentation.test.mjs
//
// presentation.ts has no runtime import beyond plain types, so it loads
// cleanly under Node's test runner without a bundler or database.

import test from "node:test";
import assert from "node:assert/strict";

const {
  proofOfServiceStateLabel,
  proofOfServiceStateCategory,
  proofOfServiceReasonLabel,
  proofOfServiceWindowLabel,
} = await import("./presentation.ts");

// ---------------------------------------------------------------------
// State labels — never the raw enum value
// ---------------------------------------------------------------------

test("proofOfServiceStateLabel — READY_FOR_REVIEW -> 'Ready for review'", () => {
  assert.equal(proofOfServiceStateLabel("READY_FOR_REVIEW"), "Ready for review");
});

test("proofOfServiceStateLabel — NEEDS_REVIEW -> 'Needs review'", () => {
  assert.equal(proofOfServiceStateLabel("NEEDS_REVIEW"), "Needs review");
});

test("proofOfServiceStateLabel — never returns a raw enum-looking string (no underscores, no all-caps)", () => {
  for (const state of ["READY_FOR_REVIEW", "NEEDS_REVIEW", "NOT_APPLICABLE"]) {
    const label = proofOfServiceStateLabel(state);
    assert.equal(label.includes("_"), false, `label for ${state} leaked an underscore: ${label}`);
    assert.notEqual(label, state, `label for ${state} was returned verbatim, not translated`);
  }
});

// ---------------------------------------------------------------------
// State categories — never critical-red for an ordinary review gap
// ---------------------------------------------------------------------

test("proofOfServiceStateCategory — READY_FOR_REVIEW -> quiet positive category, never 'completed'", () => {
  assert.equal(proofOfServiceStateCategory("READY_FOR_REVIEW"), "positive");
});

test("proofOfServiceStateCategory — NEEDS_REVIEW -> warning (amber), never critical", () => {
  assert.equal(proofOfServiceStateCategory("NEEDS_REVIEW"), "warning");
});

test("proofOfServiceStateCategory — no supported state ever maps to 'critical'", () => {
  for (const state of ["READY_FOR_REVIEW", "NEEDS_REVIEW", "NOT_APPLICABLE"]) {
    assert.notEqual(proofOfServiceStateCategory(state), "critical", `state ${state} incorrectly mapped to critical`);
  }
});

// ---------------------------------------------------------------------
// Reason labels — the exact closed 3-value vocabulary
// ---------------------------------------------------------------------

test("proofOfServiceReasonLabel — MISSING_VEHICLE -> 'Vehicle not recorded'", () => {
  assert.equal(proofOfServiceReasonLabel("MISSING_VEHICLE"), "Vehicle not recorded");
});

test("proofOfServiceReasonLabel — OPEN_EXCEPTION -> 'Open issue'", () => {
  assert.equal(proofOfServiceReasonLabel("OPEN_EXCEPTION"), "Open issue");
});

test("proofOfServiceReasonLabel — EVIDENCE_INTEGRITY_GAP -> 'Service evidence incomplete'", () => {
  assert.equal(proofOfServiceReasonLabel("EVIDENCE_INTEGRITY_GAP"), "Service evidence incomplete");
});

test("proofOfServiceReasonLabel — never leaks an internal implementation detail (assignment/event/duplicate/order wording)", () => {
  const forbidden = ["assignment", "duplicate", "order", "timestamp", "sql", "postgres", "constraint"];
  for (const code of ["MISSING_VEHICLE", "OPEN_EXCEPTION", "EVIDENCE_INTEGRITY_GAP"]) {
    const label = proofOfServiceReasonLabel(code).toLowerCase();
    for (const word of forbidden) {
      assert.equal(label.includes(word), false, `reason label for ${code} leaked internal detail "${word}": ${label}`);
    }
  }
});

// ---------------------------------------------------------------------
// Window labels
// ---------------------------------------------------------------------

test("proofOfServiceWindowLabel — TODAY/YESTERDAY/LAST_7_DAYS", () => {
  assert.equal(proofOfServiceWindowLabel("TODAY"), "Today");
  assert.equal(proofOfServiceWindowLabel("YESTERDAY"), "Yesterday");
  assert.equal(proofOfServiceWindowLabel("LAST_7_DAYS"), "Last 7 days");
});

test("proofOfServiceWindowLabel — never returns a raw enum-looking string", () => {
  for (const window of ["TODAY", "YESTERDAY", "LAST_7_DAYS"]) {
    const label = proofOfServiceWindowLabel(window);
    assert.equal(label.includes("_"), false, `window label for ${window} leaked an underscore: ${label}`);
    assert.notEqual(label, window);
  }
});
