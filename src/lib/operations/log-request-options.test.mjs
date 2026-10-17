// NC-REQUEST-SERVICE-TYPE-S1 -- Log Request "Service requested (optional)" helpers. Run with:
//
//   node --test src/lib/operations/log-request-options.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const o = await import("./log-request-options.ts");
const { SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS } = await import("../public-intake/website-intake-core.ts");
const { SERVICE_OFFERING_OPTIONS } = await import("./organization-services-core.ts");
const e = await import("./log-request-errors.ts");

const NINE = ["medical_appointment", "dialysis", "rehabilitation", "hospital_discharge", "recurring_care", "senior_medical", "wheelchair_transportation", "other", "airport_transportation"];

test("parity: one canonical list of nine services everywhere (intake values = Services settings = staff options)", () => {
  assert.deepEqual([...SERVICE_TYPE_VALUES], NINE);
  assert.deepEqual(SERVICE_OFFERING_OPTIONS.map((x) => x.value).sort(), [...NINE].sort());
  const all = o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, []);
  assert.deepEqual(all.slice(1).map((x) => x.value), NINE);
});

test("no Services configured: 'Not specified' first (the default), then all nine with the Core labels", () => {
  const opts = o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, []);
  assert.deepEqual(opts[0], { value: "", label: "Not specified" });
  assert.equal(opts.length, 10);
  for (const x of opts.slice(1)) assert.equal(x.label, SERVICE_TYPE_LABELS[x.value]);
  assert.equal(opts.find((x) => x.value === "airport_transportation").label, "Airport transportation");
});

test("Services configured: only the enabled ones, in canonical order; unknown configured values are ignored", () => {
  const opts = o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, ["wheelchair_transportation", "dialysis", "limousine"]);
  assert.deepEqual(opts.map((x) => x.value), ["", "dialysis", "wheelchair_transportation"]);
  const onlyDialysis = o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, ["dialysis"]);
  assert.deepEqual(onlyDialysis.map((x) => x.value), ["", "dialysis"]);
  // a successful answer is authoritative: nothing canonical configured -> only "Not specified" (never widened to nine)
  assert.deepEqual(o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, ["limousine"]).map((x) => x.value), [""]);
});

test("Services could NOT be loaded (null): never treated as 'none configured' -> only 'Not specified', with a calm note", () => {
  const opts = o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, null);
  assert.deepEqual(opts, [{ value: "", label: "Not specified" }]);
  // the SUCCESSFUL empty answer is different: all nine
  assert.equal(o.serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, []).length, 10);
  assert.equal(o.SERVICE_OPTIONS_UNAVAILABLE_NOTE, "Available services couldn't be loaded. You can still log this request without one.");
  assert.doesNotMatch(o.SERVICE_OPTIONS_UNAVAILABLE_NOTE, /error|ZW\d|failed|denied|permission|rpc/i);
});

test("parseServiceTypeInput: missing / empty / whitespace -> null; exact canonical -> value; nothing trimmed, folded or mapped", () => {
  for (const blank of [null, undefined, "", "   ", "\t\n "]) assert.deepEqual(o.parseServiceTypeInput(blank, SERVICE_TYPE_VALUES), { ok: true, value: null });
  for (const v of NINE) assert.deepEqual(o.parseServiceTypeInput(v, SERVICE_TYPE_VALUES), { ok: true, value: v });
  for (const bad of ["limousine", "Dialysis", "DIALYSIS", "Airport Transportation", "airport", " dialysis", "dialysis ", "dialysis\n", "wheelchair-transportation", 7, {}, ["dialysis"]])
    assert.deepEqual(o.parseServiceTypeInput(bad, SERVICE_TYPE_VALUES), { ok: false }, JSON.stringify(bad));
});

test("a staff-facing message exists for an invalid service; other messages unchanged", () => {
  assert.equal(e.logRequestErrorMessage("INVALID_SERVICE"), "Choose a service from the list, or leave Service requested as Not specified.");
  assert.match(e.logRequestErrorMessage("INVALID_INPUT"), /Check the requester details/);
  assert.equal(e.mapLogRequestError("ZW006"), "INVALID_INPUT");
});

test("wiring: the action validates the RAW value independently and passes p_service_type; the page lists configured Services", () => {
  const action = readFileSync(new URL("../../app/operations/requests/new/actions.ts", import.meta.url), "utf8");
  assert.match(action, /parseServiceTypeInput\(formData\.get\("serviceType"\), SERVICE_TYPE_VALUES\)/);
  assert.match(action, /p_service_type: serviceType\.value \?\? undefined/);
  assert.match(action, /errorCode: "INVALID_SERVICE"/);
  const page = readFileSync(new URL("../../app/operations/requests/new/page.tsx", import.meta.url), "utf8");
  assert.match(page, /getServiceOfferings\(organization\.organizationId\)/);
  assert.match(page, /serviceRequestedOptions\(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, configured\)/);
  // a failed read becomes null (not []), and the form is told so
  assert.match(page, /catch \{\s*configured = null;\s*\}/);
  assert.doesNotMatch(page, /catch \{\s*configured = \[\];/);
  assert.match(page, /serviceOptionsUnavailable=\{configured === null\}/);
  const form = readFileSync(new URL("../../components/operations/requests/LogRequestForm.tsx", import.meta.url), "utf8");
  assert.match(form, /label="Service requested \(optional\)"/);
  assert.match(form, /name="serviceType"/);
  assert.match(form, /helpText=\{serviceOptionsUnavailable \? SERVICE_OPTIONS_UNAVAILABLE_NOTE : undefined\}/);
  assert.doesNotMatch(readFileSync(new URL("./log-request-options.ts", import.meta.url), "utf8"), /^import /m, "runtime-import-free");
});
