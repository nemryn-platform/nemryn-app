// NP-P2-S3 -- request attribution pure rules. Run with:
//
//   node --test src/lib/plus/attribution-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const a = await import("./attribution-core.ts");

const C = "4cb65c2d-9e82-461b-a444-d4d991ab930f";
const O = "9d0c4b62-1f1e-4b5e-9c55-6a2f1d0e7a11";

test("link method labels: a manual link is never called a conversion", () => {
  assert.equal(a.linkMethodLabel("linked_existing_request"), "Linked to an existing request");
  assert.doesNotMatch(a.linkMethodLabel("linked_existing_request"), /convert|booked|won/i);
  assert.equal(a.linkMethodLabel("something_else"), "Linked");
});

test("parseAttributionChoice: at least one dimension; malformed ids refused", () => {
  assert.deepEqual(a.parseAttributionChoice(C, ""), { ok: true, value: { contactId: C, opportunityId: null } });
  assert.deepEqual(a.parseAttributionChoice(C, O), { ok: true, value: { contactId: C, opportunityId: O } });
  assert.deepEqual(a.parseAttributionChoice("", O), { ok: true, value: { contactId: null, opportunityId: O } });
  assert.equal(a.parseAttributionChoice("", "").ok, false);
  assert.equal(a.parseAttributionChoice("x' or 1=1", "").ok, false);
  assert.equal(a.parseAttributionChoice(C, "not-a-uuid").ok, false);
});

test("validateCorrectionReason: 3-500 trimmed characters", () => {
  assert.equal(a.validateCorrectionReason("  ").ok, false);
  assert.equal(a.validateCorrectionReason("no").ok, false);
  assert.deepEqual(a.validateCorrectionReason("  Wrong person  "), { ok: true, value: "Wrong person" });
  assert.equal(a.validateCorrectionReason("x".repeat(501)).ok, false);
});

test("error messages: ZW004 points to the correction workflow; ZW002 is non-disclosing", () => {
  assert.match(a.attributionErrorMessage("ZW004"), /already linked/);
  assert.match(a.attributionErrorMessage("ZW004"), /Correct link/);
  assert.match(a.attributionErrorMessage("ZW002"), /isn't available/);
  assert.match(a.attributionErrorMessage("ZW003"), /changed since you opened it/);
});

test("request outcome line is derived from Core facts only (never from the opportunity stage)", () => {
  const base = { state: "pending", tripsTotal: 0, tripsCompleted: 0, tripsCancelled: 0, arrangementCount: 0, arrangementStatus: null };
  assert.equal(a.requestOutcomeLine(base), "Waiting for an Operations decision");
  assert.equal(a.requestOutcomeLine({ ...base, state: "declined" }), "No trips yet");
  assert.equal(a.requestOutcomeLine({ ...base, state: "accepted", tripsTotal: 3, tripsCompleted: 2, tripsCancelled: 1 }), "3 trips · 2 completed · 1 cancelled or no-show");
  assert.equal(a.requestOutcomeLine({ ...base, state: "accepted", arrangementCount: 1, arrangementStatus: "active" }), "standing order active");
  for (const s of ["pending", "accepted", "declined", "cancelled"]) {
    assert.doesNotMatch(a.requestOutcomeLine({ ...base, state: s }), /convert|won|sale/i);
  }
});

test("decision reasons: codes only, never the free-text note", () => {
  assert.equal(a.decisionReasonLabel("outside_service_area"), "Outside service area");
  assert.equal(a.decisionReasonLabel(null), null);
  assert.equal(a.decisionReasonLabel("unexpected"), "Other");
  const src = readFileSync(new URL("./attribution-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import /m, "runtime-import-free");
  assert.doesNotMatch(src, /reason_note|reasonNote/);
});

test("NP-P2-S4-R5-F1: conversion links are not correctable; manual links and rebookings stay correctable", () => {
  assert.equal(a.isLinkCorrectable("converted_from_opportunity"), false);
  assert.equal(a.isLinkCorrectable("linked_existing_request"), true);
  assert.equal(a.isLinkCorrectable("rebooking"), true);
  assert.equal(a.linkMethodLabel("converted_from_opportunity"), "Created from an opportunity");
  assert.equal(a.CONVERSION_LINK_NOTE, "This request was created from this opportunity, so the link can't be changed.");
  assert.doesNotMatch(a.CONVERSION_LINK_NOTE, /Correct link|edit/i);
});

test("NP-P2-S4-R5-F1: conversion_link_immutable has its own message; other ZW004s keep the existing one", () => {
  assert.equal(a.attributionErrorMessage("ZW004", "conversion_link_immutable"), "A request created from an opportunity stays linked to it.");
  assert.doesNotMatch(a.attributionErrorMessage("ZW004", "conversion_link_immutable"), /Correct link/);
  assert.match(a.attributionErrorMessage("ZW004", "already_linked"), /already linked.*Correct link/);
  assert.match(a.attributionErrorMessage("ZW004"), /already linked/);
  // the reason only refines ZW004; it never changes another code's message
  assert.equal(a.attributionErrorMessage("ZW006", "conversion_link_immutable"), a.attributionErrorMessage("ZW006"));
});

test("NP-P2-S4-R5-F1: the panel hides the controls for a conversion link; the correction action passes the database reason", () => {
  const panel = readFileSync(new URL("../../components/growth/RequestGrowthPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /!isLinkCorrectable\(attribution\.linkMethod\)/);
  assert.match(panel, /request-growth-conversion-note/);
  const actions = readFileSync(new URL("../../app/operations/growth/attribution/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /attributionErrorMessage\(error\?\.code, error\?\.message\)/);
});
