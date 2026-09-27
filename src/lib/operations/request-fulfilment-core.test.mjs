// Unit tests for Request fulfilment (P1-PILOT-R2B, PR-03).
//   node --test src/lib/operations/request-fulfilment-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { hasActiveTrip, isRequestFulfilled, isRequestStranded, strandedRequestsLine, STRANDED_REQUESTS_HREF } = await import("./request-fulfilment-core.ts");
const accepted = (linkedTripStates, hasLinkedArrangement = false) => ({ state: "accepted", linkedTripStates, hasLinkedArrangement });

test("accepted: no Trip -> stranded; active / completed / no_show Trip -> fulfilled", () => {
  assert.equal(isRequestStranded(accepted([])), true);
  assert.equal(isRequestStranded(accepted(["scheduled"])), false);
  assert.equal(isRequestStranded(accepted(["completed"])), false, "completed is historical fulfilment");
  assert.equal(isRequestStranded(accepted(["no_show"])), false, "no_show does not re-strand");
  assert.equal(isRequestStranded(accepted(["cancelled", "en_route_to_pickup"])), false);
});

test("cancelled-only linked Trips do NOT fulfil the Request", () => {
  assert.equal(hasActiveTrip(["cancelled", "cancelled"]), false);
  assert.equal(isRequestStranded(accepted(["cancelled"])), true);
});

test("future R3 hook: a linked arrangement fulfils without any Trip", () => {
  assert.equal(isRequestFulfilled(accepted([], true)), true);
  assert.equal(isRequestStranded(accepted(["cancelled"], true)), false);
});

test("only ACCEPTED Requests can be stranded", () => {
  for (const state of ["pending", "declined", "cancelled"]) {
    assert.equal(isRequestStranded({ state, linkedTripStates: [], hasLinkedArrangement: false }), false, state);
  }
});

test("Overview line: plain fact, singular / plural, nothing at zero", () => {
  assert.equal(strandedRequestsLine(0), null);
  assert.equal(strandedRequestsLine(1), "1 accepted request still needs a trip");
  assert.equal(strandedRequestsLine(4), "4 accepted requests still need a trip");
  assert.equal(STRANDED_REQUESTS_HREF, "/operations/requests?state=accepted&needs=trip");
});
