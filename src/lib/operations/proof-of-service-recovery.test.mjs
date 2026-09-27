// P1-PILOT-R2C (PR-02) -- Proof of Service for a completion recorded by Operations. Run with:
//
//   node --test src/lib/operations/proof-of-service-recovery.test.mjs
//
// Composes the two pure modules exactly as the loaders do: trip_events facts -> evaluateProofOfServiceEvents ->
// deriveTripProofOfService.

import test from "node:test";
import assert from "node:assert/strict";

const { deriveTripProofOfService } = await import("./trip-proof-of-service-core.ts");
const { evaluateProofOfServiceEvents, evaluateRecoveredLifecycleEventChain, driverRecordedMilestones, PROOF_OF_SERVICE_EVENT_TYPES } =
  await import("./trip-proof-of-service-evidence.ts");
const { proofOfServiceReasonLabel, operationsEventLabel, driverRecordedMilestonesLine } = await import("./presentation.ts");

const COMPLETED_AT = "2026-11-01T15:30:00.000Z";
const RECORDED_AT = "2026-11-01T16:05:00.000Z"; // when Operations recorded it (after the ride)

const DRIVER_TIMES = {
  en_route_to_pickup: "2026-11-01T14:50:00.000Z",
  arrived_at_pickup: "2026-11-01T15:00:00.000Z",
  passenger_onboard: "2026-11-01T15:05:00.000Z",
  en_route_to_destination: "2026-11-01T15:10:00.000Z",
  arrived_at_destination: "2026-11-01T15:28:00.000Z",
};

function driverEvents(types) {
  return types.map((eventType) => ({ eventType, occurredAt: DRIVER_TIMES[eventType] }));
}

function recoveryEvent(previousState, overrides = {}) {
  return { eventType: "completion_recorded_by_operations", occurredAt: RECORDED_AT, previousState, recordedCompletedAt: COMPLETED_AT, ...overrides };
}

const ONBOARD = ["en_route_to_pickup", "arrived_at_pickup", "passenger_onboard"];
const EN_ROUTE_DEST = [...ONBOARD, "en_route_to_destination"];
const ARRIVED_DEST = [...EN_ROUTE_DEST, "arrived_at_destination"];

function evaluate(events, overrides = {}) {
  const evidence = evaluateProofOfServiceEvents(events, COMPLETED_AT);
  return deriveTripProofOfService({
    tripState: "completed",
    hasPassenger: true,
    hasPickupDescription: true,
    hasDestinationDescription: true,
    completedAt: COMPLETED_AT,
    hasCompleteLifecycleEventChain: evidence.hasCompleteLifecycleEventChain,
    completionRecordedByOperations: evidence.completionRecordedByOperations,
    hasCompletionAssignment: true,
    completionAssignmentVehicleId: "vehicle-1",
    openExceptionCount: 0,
    ...overrides,
  });
}

// ------------------------------------------------------------------------------------------------ normal Driver chain

test("normal Driver-completed 6-event chain -> READY_FOR_REVIEW, unchanged", () => {
  const events = [...driverEvents(ARRIVED_DEST), { eventType: "trip_completed", occurredAt: COMPLETED_AT }];
  assert.deepEqual(evaluateProofOfServiceEvents(events, COMPLETED_AT), { completionRecordedByOperations: false, hasCompleteLifecycleEventChain: true });
  assert.deepEqual(evaluate(events), { state: "READY_FOR_REVIEW", reasons: [] });
});

test("normal Driver chain missing a step (no recovery event) -> the unchanged 6-event rule: integrity gap", () => {
  const events = [...driverEvents(EN_ROUTE_DEST), { eventType: "trip_completed", occurredAt: COMPLETED_AT }];
  assert.deepEqual(evaluate(events), { state: "NEEDS_REVIEW", reasons: ["EVIDENCE_INTEGRITY_GAP"] });
});

// ------------------------------------------------------------------------------------------------ recovered, coherent

test("recovered from each eligible state with its coherent partial chain -> NEEDS_REVIEW, COMPLETION_RECORDED_BY_OPERATIONS only", () => {
  for (const [previousState, prior] of [
    ["passenger_onboard", ONBOARD],
    ["en_route_to_destination", EN_ROUTE_DEST],
    ["arrived_at_destination", ARRIVED_DEST],
  ]) {
    const events = [...driverEvents(prior), recoveryEvent(previousState)];
    assert.equal(evaluateRecoveredLifecycleEventChain(events, COMPLETED_AT), true, previousState);
    assert.deepEqual(evaluate(events), { state: "NEEDS_REVIEW", reasons: ["COMPLETION_RECORDED_BY_OPERATIONS"] }, previousState);
  }
});

test("a recovered Trip is never READY_FOR_REVIEW, even with every other fact in place", () => {
  const result = evaluate([...driverEvents(ARRIVED_DEST), recoveryEvent("arrived_at_destination")]);
  assert.notEqual(result.state, "READY_FOR_REVIEW");
});

// ------------------------------------------------------------------------------------------------ recovered, broken

const GAP = { state: "NEEDS_REVIEW", reasons: ["EVIDENCE_INTEGRITY_GAP", "COMPLETION_RECORDED_BY_OPERATIONS"] };

test("recovered, broken partial chain (a Driver step before previous_state missing) -> + EVIDENCE_INTEGRITY_GAP", () => {
  const events = [...driverEvents(["en_route_to_pickup", "passenger_onboard"]), recoveryEvent("passenger_onboard")];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered, a Driver event AFTER previous_state exists (inconsistent previous_state) -> integrity gap", () => {
  const events = [...driverEvents(EN_ROUTE_DEST), recoveryEvent("passenger_onboard")];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered, duplicated Driver event -> integrity gap", () => {
  const events = [...driverEvents(ONBOARD), ...driverEvents(["arrived_at_pickup"]), recoveryEvent("passenger_onboard")];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered, Driver events out of order -> integrity gap", () => {
  const events = [
    { eventType: "en_route_to_pickup", occurredAt: DRIVER_TIMES.arrived_at_pickup },
    { eventType: "arrived_at_pickup", occurredAt: DRIVER_TIMES.en_route_to_pickup },
    { eventType: "passenger_onboard", occurredAt: DRIVER_TIMES.passenger_onboard },
    recoveryEvent("passenger_onboard"),
  ];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered with trip_completed ALSO present -> integrity gap", () => {
  const events = [...driverEvents(ARRIVED_DEST), { eventType: "trip_completed", occurredAt: COMPLETED_AT }, recoveryEvent("arrived_at_destination")];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered with duplicate recovery events -> integrity gap (still marked as recorded by operations)", () => {
  const events = [...driverEvents(ONBOARD), recoveryEvent("passenger_onboard"), recoveryEvent("passenger_onboard")];
  assert.deepEqual(evaluateProofOfServiceEvents(events, COMPLETED_AT), { completionRecordedByOperations: true, hasCompleteLifecycleEventChain: false });
  assert.deepEqual(evaluate(events), GAP);
});

test("recovery event occurring BEFORE a required prior Driver event -> integrity gap", () => {
  const events = [...driverEvents(ONBOARD), recoveryEvent("passenger_onboard", { occurredAt: "2026-11-01T15:02:00.000Z" })];
  assert.deepEqual(evaluate(events), GAP);
});

test("recovered: unknown / missing previous_state -> integrity gap", () => {
  assert.deepEqual(evaluate([...driverEvents(ONBOARD), recoveryEvent("arrived_at_pickup")]), GAP);
  assert.deepEqual(evaluate([...driverEvents(ONBOARD), recoveryEvent(null)]), GAP);
});

test("recovered: recorded completion time != trips.completed_at, or before the last Driver event -> integrity gap", () => {
  assert.deepEqual(evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard", { recordedCompletedAt: "2026-11-01T15:31:00.000Z" })]), GAP);
  assert.deepEqual(evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard", { recordedCompletedAt: null })]), GAP);
  const early = "2026-11-01T15:04:00.000Z"; // before passenger_onboard (15:05)
  const events = [...driverEvents(ONBOARD), recoveryEvent("passenger_onboard", { recordedCompletedAt: early })];
  assert.equal(evaluateRecoveredLifecycleEventChain(events, early), false);
});

test("recovered: null completedAt -> fails closed", () => {
  assert.equal(evaluateRecoveredLifecycleEventChain([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard")], null), false);
});

// ------------------------------------------------------------------------------------------------ combinations

test("recovered + missing vehicle -> COMPLETION_RECORDED_BY_OPERATIONS + MISSING_VEHICLE", () => {
  const result = evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard")], { completionAssignmentVehicleId: null });
  assert.deepEqual(result, { state: "NEEDS_REVIEW", reasons: ["COMPLETION_RECORDED_BY_OPERATIONS", "MISSING_VEHICLE"] });
});

test("recovered + open exception -> COMPLETION_RECORDED_BY_OPERATIONS + OPEN_EXCEPTION", () => {
  const result = evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard")], { openExceptionCount: 2 });
  assert.deepEqual(result, { state: "NEEDS_REVIEW", reasons: ["COMPLETION_RECORDED_BY_OPERATIONS", "OPEN_EXCEPTION"] });
});

test("recovered + broken chain + missing vehicle + open exception -> all four, in the fixed order", () => {
  const result = evaluate([recoveryEvent("passenger_onboard")], { completionAssignmentVehicleId: null, openExceptionCount: 1 });
  assert.deepEqual(result.reasons, ["EVIDENCE_INTEGRITY_GAP", "COMPLETION_RECORDED_BY_OPERATIONS", "MISSING_VEHICLE", "OPEN_EXCEPTION"]);
});

test("recovered without a completion assignment -> integrity gap (the assignment rule is unchanged)", () => {
  const result = evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard")], { hasCompletionAssignment: false, completionAssignmentVehicleId: null });
  assert.deepEqual(result, GAP);
});

test("non-completed Trip with a recovery-looking fact -> still NOT_APPLICABLE", () => {
  const result = deriveTripProofOfService({
    tripState: "passenger_onboard", hasPassenger: true, hasPickupDescription: true, hasDestinationDescription: true, completedAt: null,
    hasCompleteLifecycleEventChain: false, completionRecordedByOperations: true, hasCompletionAssignment: false,
    completionAssignmentVehicleId: null, openExceptionCount: 0,
  });
  assert.deepEqual(result, { state: "NOT_APPLICABLE", reasons: [] });
});

// ------------------------------------------------------------------------------------------------ presentation

test("labels: reason + timeline event read 'Completion recorded by operations', never 'completed by driver'", () => {
  assert.equal(proofOfServiceReasonLabel("COMPLETION_RECORDED_BY_OPERATIONS"), "Completion recorded by operations");
  assert.equal(operationsEventLabel("completion_recorded_by_operations"), "Completion recorded by operations");
  assert.doesNotMatch(proofOfServiceReasonLabel("COMPLETION_RECORDED_BY_OPERATIONS"), /driver/i);
});

test("driver milestones: only the ones that exist, in order; never a fabricated chain", () => {
  const events = [recoveryEvent("passenger_onboard"), ...driverEvents(["passenger_onboard", "en_route_to_pickup", "arrived_at_pickup"])];
  assert.deepEqual(driverRecordedMilestones(events), ["en_route_to_pickup", "arrived_at_pickup", "passenger_onboard"]);
  assert.equal(driverRecordedMilestonesLine(driverRecordedMilestones(events)), "Driver recorded: started to pickup, arrived at pickup, passenger on board");
  assert.doesNotMatch(driverRecordedMilestonesLine(driverRecordedMilestones(events)), /destination|completed/);
  assert.equal(driverRecordedMilestonesLine([]), "Driver recorded: no milestones");
});

test("no note leakage: the loader's event filter and facts carry no free text", () => {
  assert.deepEqual([...PROOF_OF_SERVICE_EVENT_TYPES].sort(), [
    "arrived_at_destination", "arrived_at_pickup", "completion_recorded_by_operations", "en_route_to_destination",
    "en_route_to_pickup", "passenger_onboard", "trip_completed",
  ]);
  const result = evaluate([...driverEvents(ONBOARD), recoveryEvent("passenger_onboard", { note: "Driver phone died; confirmed by phone" })]);
  assert.doesNotMatch(JSON.stringify(result), /phone|confirmed/i);
});
