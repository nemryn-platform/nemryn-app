// Focused unit tests for the pure Recurring Care bulk missing-Trip
// review helpers (P1-PILOT-S2). Run with:
//
//   node --test src/lib/operations/recurring-care-bulk-core.test.mjs
//
// Tests the pure module only, which has no runtime import of any kind,
// matching operations-brief-core.test.mjs's own established pattern.

import test from "node:test";
import assert from "node:assert/strict";

const { flattenMissingOccurrences, occurrenceKey, parseOccurrenceKey, dedupeOccurrenceKeys, summarizeBatchResults } = await import(
  "./recurring-care-bulk-core.ts"
);

function row(overrides = {}) {
  return {
    arrangementId: "11111111-1111-1111-1111-111111111111",
    passengerDisplayName: "Patricia Cole",
    pickupDescription: "Home",
    destinationDescription: "Cascade Dialysis",
    pickupTime: "08:00:00",
    timezone: "America/New_York",
    occurrences: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// flattenMissingOccurrences
// ---------------------------------------------------------------------

test("flattenMissingOccurrences — aggregates MISSING occurrences across arrangements", () => {
  const rows = [
    row({
      arrangementId: "11111111-1111-1111-1111-111111111111",
      occurrences: [
        { serviceDate: "2026-09-21", state: "MISSING" },
        { serviceDate: "2026-09-18", state: "SCHEDULED" },
      ],
    }),
    row({
      arrangementId: "22222222-2222-2222-2222-222222222222",
      passengerDisplayName: "Aaron Miles",
      occurrences: [{ serviceDate: "2026-09-19", state: "MISSING" }],
    }),
  ];
  const result = flattenMissingOccurrences(rows);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((r) => r.serviceDate),
    ["2026-09-19", "2026-09-21"],
  );
});

test("flattenMissingOccurrences — SCHEDULED occurrences excluded", () => {
  const rows = [row({ occurrences: [{ serviceDate: "2026-09-18", state: "SCHEDULED" }] })];
  assert.deepEqual(flattenMissingOccurrences(rows), []);
});

test("flattenMissingOccurrences — SKIPPED occurrences excluded", () => {
  const rows = [row({ occurrences: [{ serviceDate: "2026-09-18", state: "SKIPPED" }] })];
  assert.deepEqual(flattenMissingOccurrences(rows), []);
});

test("flattenMissingOccurrences — no active-only filter: a non-active arrangement's own MISSING occurrence is still included (mirrors OccurrenceRow's own existing single-occurrence behavior)", () => {
  const rows = [
    row({
      arrangementId: "33333333-3333-3333-3333-333333333333",
      occurrences: [{ serviceDate: "2026-09-18", state: "MISSING" }],
    }),
  ];
  // No `status` field is even part of the input shape -- this test
  // documents the DELIBERATE absence of any status-based filtering.
  const result = flattenMissingOccurrences(rows);
  assert.equal(result.length, 1);
});

test("flattenMissingOccurrences — empty input -> empty output", () => {
  assert.deepEqual(flattenMissingOccurrences([]), []);
});

test("flattenMissingOccurrences — carries the arrangement's own descriptive fields onto each row", () => {
  const rows = [
    row({
      passengerDisplayName: "Patricia Cole",
      pickupDescription: "Home",
      destinationDescription: "Cascade Dialysis",
      pickupTime: "08:00:00",
      timezone: "America/New_York",
      occurrences: [{ serviceDate: "2026-09-18", state: "MISSING" }],
    }),
  ];
  const result = flattenMissingOccurrences(rows);
  assert.deepEqual(result[0], {
    arrangementId: "11111111-1111-1111-1111-111111111111",
    serviceDate: "2026-09-18",
    passengerDisplayName: "Patricia Cole",
    pickupDescription: "Home",
    destinationDescription: "Cascade Dialysis",
    pickupTime: "08:00:00",
    timezone: "America/New_York",
  });
});

// ---------------------------------------------------------------------
// occurrenceKey / parseOccurrenceKey — stable, round-tripping
// ---------------------------------------------------------------------

test("occurrenceKey / parseOccurrenceKey — round-trips exactly", () => {
  const key = occurrenceKey("11111111-1111-1111-1111-111111111111", "2026-09-18");
  assert.equal(key, "11111111-1111-1111-1111-111111111111::2026-09-18");
  assert.deepEqual(parseOccurrenceKey(key), { arrangementId: "11111111-1111-1111-1111-111111111111", serviceDate: "2026-09-18" });
});

test("parseOccurrenceKey — structurally malformed input returns null, never throws", () => {
  // This function validates SHAPE only (a UUID, "::", a YYYY-MM-DD-shaped
  // string) -- calendar validity (e.g. a genuinely nonexistent date) is
  // deliberately NOT re-validated here, since that would duplicate the
  // RPC's own authoritative service-date validation (§10/§28 -- this
  // module holds no business authority). A shape-valid but
  // calendar-invalid date safely reaches the RPC, which correctly
  // rejects it with its own ZW006.
  assert.equal(parseOccurrenceKey(""), null);
  assert.equal(parseOccurrenceKey("not-a-key"), null);
  assert.equal(parseOccurrenceKey("11111111-1111-1111-1111-111111111111"), null);
  assert.equal(parseOccurrenceKey("<script>::2026-09-18"), null);
  assert.equal(parseOccurrenceKey("11111111-1111-1111-1111-111111111111::09-18-2026"), null);
});

// ---------------------------------------------------------------------
// dedupeOccurrenceKeys
// ---------------------------------------------------------------------

test("dedupeOccurrenceKeys — duplicate input deduped, first-seen order preserved", () => {
  const a = occurrenceKey("11111111-1111-1111-1111-111111111111", "2026-09-18");
  const b = occurrenceKey("22222222-2222-2222-2222-222222222222", "2026-09-19");
  const result = dedupeOccurrenceKeys([a, b, a, a, b]);
  assert.deepEqual(result, [a, b]);
});

test("dedupeOccurrenceKeys — malformed keys silently dropped, never crash the batch", () => {
  const valid = occurrenceKey("11111111-1111-1111-1111-111111111111", "2026-09-18");
  const result = dedupeOccurrenceKeys([valid, "garbage", "", valid]);
  assert.deepEqual(result, [valid]);
});

test("dedupeOccurrenceKeys — empty input -> empty output", () => {
  assert.deepEqual(dedupeOccurrenceKeys([]), []);
});

// ---------------------------------------------------------------------
// summarizeBatchResults
// ---------------------------------------------------------------------

function res(status, overrides = {}) {
  return { arrangementId: "11111111-1111-1111-1111-111111111111", serviceDate: "2026-09-18", status, ...overrides };
}

test("summarizeBatchResults — CREATED result counting", () => {
  const summary = summarizeBatchResults([res("CREATED"), res("CREATED")]);
  assert.deepEqual(summary, { total: 2, created: 2, alreadyScheduled: 0, failed: 0 });
});

test("summarizeBatchResults — ALREADY_SCHEDULED result counting", () => {
  const summary = summarizeBatchResults([res("ALREADY_SCHEDULED")]);
  assert.deepEqual(summary, { total: 1, created: 0, alreadyScheduled: 1, failed: 0 });
});

test("summarizeBatchResults — FAILED result counting", () => {
  const summary = summarizeBatchResults([res("FAILED", { errorCode: "ILLEGAL_STATE" })]);
  assert.deepEqual(summary, { total: 1, created: 0, alreadyScheduled: 0, failed: 1 });
});

test("summarizeBatchResults — mixed batch summary (5 created, 1 already scheduled, 1 failed)", () => {
  const results = [
    res("CREATED"),
    res("CREATED"),
    res("CREATED"),
    res("CREATED"),
    res("CREATED"),
    res("ALREADY_SCHEDULED"),
    res("FAILED", { errorCode: "ILLEGAL_STATE" }),
  ];
  const summary = summarizeBatchResults(results);
  assert.deepEqual(summary, { total: 7, created: 5, alreadyScheduled: 1, failed: 1 });
});

test("summarizeBatchResults — empty batch -> all zero", () => {
  assert.deepEqual(summarizeBatchResults([]), { total: 0, created: 0, alreadyScheduled: 0, failed: 0 });
});

test("summarizeBatchResults — no raw error leakage: a FAILED result's errorCode is passed through unchanged, never inspected/transformed by this pure function", () => {
  const summary = summarizeBatchResults([res("FAILED", { errorCode: "UNKNOWN" })]);
  assert.equal(summary.failed, 1);
  // This function itself never renders/logs the errorCode -- it only
  // counts. Presentation-safe mapping is the caller's own job
  // (recurring-arrangement-errors.ts, unchanged, reused).
});
