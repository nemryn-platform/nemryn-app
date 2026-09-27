// P1-PILOT-R2C (PR-02) -- pure completion-recovery policy + error copy. Run with:
//
//   node --test src/lib/operations/trip-completion-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { canRecordCompletion, checkRecoveryNote, checkCompletionTime, completionRecordOf, RECORD_COMPLETION_ELIGIBLE_STATES } =
  await import("./trip-completion-core.ts");
const { mapTripCompletionError, tripCompletionErrorMessage, NOTE_ERROR_CODES, TIME_ERROR_CODES } = await import("./trip-completion-errors.ts");

test("eligibility: exactly passenger_onboard / en_route_to_destination / arrived_at_destination", () => {
  assert.deepEqual([...RECORD_COMPLETION_ELIGIBLE_STATES], ["passenger_onboard", "en_route_to_destination", "arrived_at_destination"]);
  for (const s of RECORD_COMPLETION_ELIGIBLE_STATES) assert.equal(canRecordCompletion(s), true, s);
  for (const s of ["scheduled", "en_route_to_pickup", "arrived_at_pickup", "completed", "cancelled", "no_show", "", "unknown"]) {
    assert.equal(canRecordCompletion(s), false, s);
  }
});

test("note: trimmed, required, 10..500", () => {
  assert.deepEqual(checkRecoveryNote(undefined), { ok: false, problem: "NOTE_REQUIRED" });
  assert.deepEqual(checkRecoveryNote("    "), { ok: false, problem: "NOTE_REQUIRED" });
  assert.deepEqual(checkRecoveryNote("  123456789 "), { ok: false, problem: "NOTE_TOO_SHORT" });
  assert.deepEqual(checkRecoveryNote("  1234567890 "), { ok: true, note: "1234567890" });
  assert.deepEqual(checkRecoveryNote("x".repeat(500)), { ok: true, note: "x".repeat(500) });
  assert.deepEqual(checkRecoveryNote("x".repeat(501)), { ok: false, problem: "NOTE_TOO_LONG" });
});

test("completion time: <= now + 5 min and >= the latest lifecycle event", () => {
  const now = Date.parse("2026-11-01T16:00:00.000Z");
  assert.equal(checkCompletionTime("2026-11-01T16:05:00.000Z", now, null), "ok");
  assert.equal(checkCompletionTime("2026-11-01T16:05:01.000Z", now, null), "TIME_IN_FUTURE");
  assert.equal(checkCompletionTime("2026-11-01T15:05:00.000Z", now, "2026-11-01T15:05:00.000Z"), "ok");
  assert.equal(checkCompletionTime("2026-11-01T15:04:59.000Z", now, "2026-11-01T15:05:00.000Z"), "TIME_BEFORE_LAST_STEP");
});

test("completionRecordOf: reads the recovery event's actor / time / stated completion, never a note", () => {
  const events = [
    { event_type: "note_added", occurred_at: "2026-11-01T16:10:00Z", actor_user_id: "u2", metadata: {} },
    {
      event_type: "completion_recorded_by_operations",
      occurred_at: "2026-11-01T16:05:00Z",
      actor_user_id: "u1",
      metadata: { previous_state: "passenger_onboard", recorded_completed_at: "2026-11-01T15:30:00Z", note_present: true },
    },
  ];
  const record = completionRecordOf(events);
  assert.deepEqual(record, { actorUserId: "u1", recordedAt: "2026-11-01T16:05:00Z", completedAt: "2026-11-01T15:30:00Z" });
  assert.equal(completionRecordOf(events.slice(0, 1)), null);
  assert.deepEqual(completionRecordOf([{ ...events[1], metadata: null }]), { actorUserId: "u1", recordedAt: "2026-11-01T16:05:00Z", completedAt: null });
});

test("errors: ZW codes map to calm copy; never a raw code; the owner-approved stale / illegal wording", () => {
  assert.equal(mapTripCompletionError("ZW001"), "UNAUTHORIZED");
  assert.equal(mapTripCompletionError("ZW002"), "NOT_FOUND");
  assert.equal(mapTripCompletionError("ZW003"), "STALE");
  assert.equal(mapTripCompletionError("ZW004"), "NOT_ELIGIBLE");
  assert.equal(mapTripCompletionError("ZW006"), "INVALID_INPUT");
  assert.equal(mapTripCompletionError("PGRST202"), "UNKNOWN");
  assert.equal(mapTripCompletionError(undefined), "UNKNOWN");
  assert.equal(tripCompletionErrorMessage("STALE"), "This trip changed. Refresh and review the latest status.");
  assert.equal(tripCompletionErrorMessage("NOT_ELIGIBLE"), "This trip can no longer be completed this way.");
  for (const code of ["UNAUTHORIZED", "NOT_FOUND", "STALE", "NOT_ELIGIBLE", "NO_ACTIVE_ASSIGNMENT", "NOTE_REQUIRED", "NOTE_TOO_SHORT",
    "NOTE_TOO_LONG", "TIME_REQUIRED", "TIME_IN_FUTURE", "TIME_BEFORE_LAST_STEP", "TIME_UNRESOLVABLE", "INVALID_INPUT", "UNKNOWN"]) {
    const message = tripCompletionErrorMessage(code);
    assert.ok(message && !/ZW0|SQLSTATE|PGRST|record_trip/.test(message), code);
  }
  assert.ok(NOTE_ERROR_CODES.has("NOTE_TOO_SHORT") && TIME_ERROR_CODES.has("TIME_IN_FUTURE") && !NOTE_ERROR_CODES.has("STALE"));
});
