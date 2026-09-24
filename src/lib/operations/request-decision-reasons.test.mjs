// Unit tests for the Request decision reason taxonomy (P1-OPS-R1).
//
//   node --test src/lib/operations/request-decision-reasons.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { validateRequestReason, DECLINE_REASON_CODES, CANCEL_REASON_CODES, requestReasonLabel } = await import(
  "./request-decision-reasons.ts"
);

test("decline requires a known decline code (K)", () => {
  assert.equal(validateRequestReason("decline", "", null).ok, false);
  assert.equal(validateRequestReason("decline", null, null).ok, false);
  assert.equal(validateRequestReason("decline", "requester_cancelled", null).ok, false);
  assert.deepEqual(validateRequestReason("decline", "outside_service_area", "  "), {
    ok: true, reasonCode: "outside_service_area", reasonNote: null,
  });
});

test("cancel requires a known cancel code", () => {
  assert.equal(validateRequestReason("cancel", "outside_service_area", null).ok, false);
  assert.equal(validateRequestReason("cancel", "requester_cancelled", "Family arranged a ride").ok, true);
});

test("other requires an explanation; notes are capped at 500", () => {
  assert.equal(validateRequestReason("decline", "other", "   ").ok, false);
  assert.deepEqual(validateRequestReason("cancel", "other", " Vehicle retired "), { ok: true, reasonCode: "other", reasonNote: "Vehicle retired" });
  assert.equal(validateRequestReason("decline", "no_availability", "x".repeat(501)).ok, false);
  assert.equal(validateRequestReason("decline", "no_availability", "x".repeat(500)).ok, true);
});

test("every code has a human label", () => {
  for (const code of [...DECLINE_REASON_CODES, ...CANCEL_REASON_CODES]) {
    assert.notEqual(requestReasonLabel(code), code);
  }
});

test("code sets match the database constraint in the migration exactly", () => {
  const sql = fs.readFileSync(new URL("../../../supabase/migrations/20260924090000_request_decision_workflow_expand.sql", import.meta.url), "utf8");
  const block = sql.slice(sql.indexOf("request_events_reason_code_check"), sql.indexOf("request_events_reason_note_check"));
  const setFor = (eventType) => {
    const m = block.match(new RegExp(`event_type = '${eventType}' and reason_code in \\(([^)]*)\\)`));
    return m[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  };
  assert.deepEqual(setFor("request_declined"), [...DECLINE_REASON_CODES]);
  assert.deepEqual(setFor("request_cancelled"), [...CANCEL_REASON_CODES]);
});
