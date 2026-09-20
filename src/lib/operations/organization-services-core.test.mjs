// Focused unit tests for pure Services & Intake helpers (P1-PILOT-S4B-R4C).
//   node --test src/lib/operations/organization-services-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { SERVICE_OFFERING_OPTIONS, serviceLabel, isCanonicalService, validateServiceSelection, summarizeServices } = await import("./organization-services-core.ts");
const { SERVICE_TYPE_VALUES } = await import("../public-intake/website-intake-core.ts");

test("the offering options are exactly the platform's canonical service types (no competing list)", () => {
  assert.deepEqual(SERVICE_OFFERING_OPTIONS.map((o) => o.value).sort(), [...SERVICE_TYPE_VALUES].sort());
});

test("labels are human wording; identifiers are never shown", () => {
  for (const option of SERVICE_OFFERING_OPTIONS) {
    assert.doesNotMatch(option.label, /_/);
    assert.equal(serviceLabel(option.value), option.label);
  }
  assert.equal(serviceLabel("recurring_care"), "Recurring scheduled care");
  assert.equal(serviceLabel("dialysis"), "Dialysis");
});

test("selection validation: canonical only, canonical order, distinct, at least one", () => {
  assert.deepEqual(validateServiceSelection(["dialysis", "medical_appointment", "dialysis"]), { ok: true, services: ["medical_appointment", "dialysis"] });
  assert.equal(validateServiceSelection([]).ok, false);
  assert.equal(validateServiceSelection(["teleport"]).ok, false);
  assert.equal(validateServiceSelection(["dialysis", "DIALYSIS"]).ok, false);
  assert.equal(isCanonicalService("other"), true);
  assert.equal(isCanonicalService("Other"), false);
});

test("summary lists labels in canonical order; empty means all types", () => {
  assert.equal(summarizeServices([]), "All service types");
  assert.equal(summarizeServices(["dialysis", "medical_appointment"]), "Medical appointments, Dialysis");
});
