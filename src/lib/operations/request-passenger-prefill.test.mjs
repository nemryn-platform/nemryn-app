// Unit tests for the Request -> Add New Passenger prefill (P1-OPS-R1A).
//
//   node --test src/lib/operations/request-passenger-prefill.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const { requestPassengerPrefill } = await import("./request-passenger-prefill.ts");

test("A: requested passenger name prefills Full Name", () => {
  assert.equal(requestPassengerPrefill("Angela Example").displayName, "Angela Example");
});

test("surrounding whitespace is trimmed; the value is otherwise untouched", () => {
  assert.equal(requestPassengerPrefill("  Angela  N. Example ").displayName, "Angela  N. Example");
});

test("F: no requested passenger name -> blank (no fallback)", () => {
  assert.equal(requestPassengerPrefill(null).displayName, "");
  assert.equal(requestPassengerPrefill(undefined).displayName, "");
  assert.equal(requestPassengerPrefill("   ").displayName, "");
});

test("G/H: only the snapshot is an input -- phone is always blank, no requester data can reach the prefill", () => {
  assert.deepEqual(requestPassengerPrefill("Angela Example"), { displayName: "Angela Example", phone: "" });
  assert.equal(requestPassengerPrefill.length, 1);
});
