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

// ---------------------------------------------------------------------------------------------------------------------
// NP-CORE-PLUS-REQUEST-02B: "Add contact" from Request Details
// ---------------------------------------------------------------------------------------------------------------------
const c = await import("./contacts-core.ts");
const REQUESTER = { requesterName: "  Ann Requester Fictional ", requesterPhone: " (404) 555-0142 ", requesterEmail: "ann.requester@example.test", requesterRelationship: "family" };

test("02B relationship -> contact kind (ZD-297): every Core relationship maps to a valid contact kind", () => {
  assert.equal(a.contactKindForRelationship("self"), "individual");
  assert.equal(a.contactKindForRelationship("family"), "family_caregiver");
  assert.equal(a.contactKindForRelationship("caregiver"), "family_caregiver");
  assert.equal(a.contactKindForRelationship("facility_coordinator"), "facility_staff");
  assert.equal(a.contactKindForRelationship("other"), "other");
  assert.equal(a.contactKindForRelationship("unknown_value"), "other");
  assert.equal(a.contactKindForRelationship(null), "other");
  for (const rel of ["self", "family", "caregiver", "facility_coordinator", "other"]) assert.ok(c.isContactKind(a.contactKindForRelationship(rel)));
});

test("02B requester prefill: requester values only (trimmed, never reformatted), Growth defaults, no consent, no owner", () => {
  assert.deepEqual(a.buildRequesterPrefill(REQUESTER), {
    displayName: "Ann Requester Fictional",
    phone: "(404) 555-0142",
    email: "ann.requester@example.test",
    contactKind: "family_caregiver",
    jobTitle: "",
    preferredChannel: "phone",
    doNotContact: false,
    ownerHandle: "",
  });
  assert.equal(a.buildRequesterPrefill({ ...REQUESTER, requesterEmail: null }).email, "");
  assert.equal(a.buildRequesterPrefill({ ...REQUESTER, requesterPhone: "" }).preferredChannel, "email");
  // the prefill is a valid Growth contact as-is
  assert.equal(c.validateContactForm(a.buildRequesterPrefill(REQUESTER)).ok, true);
});

test("02B passenger information is never used: extra passenger fields are ignored and never appear in the prefill", () => {
  const withPassenger = { ...REQUESTER, passengerName: "Passenger Zed Fictional", requestedPassengerName: "Passenger Zed Fictional", passengerId: "4cb65c2d-9e82-461b-a444-d4d991ab930f" };
  const prefill = a.buildRequesterPrefill(withPassenger);
  assert.deepEqual(prefill, a.buildRequesterPrefill(REQUESTER));
  assert.doesNotMatch(JSON.stringify(prefill), /Zed|passenger/i);
  assert.equal(a.REQUESTER_NOT_PASSENGER_NOTICE, "Requester — the person who contacted you. This is not necessarily the passenger.");
});

test("02B a Core requester phone that breaks the contact rules is prefilled as given and refused by validation (staff correct it)", () => {
  const bad = a.buildRequesterPrefill({ ...REQUESTER, requesterPhone: "call after 5pm" });
  assert.equal(bad.phone, "call after 5pm");
  const v = c.validateContactForm(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.phone);
  const badEmail = c.validateContactForm({ ...a.buildRequesterPrefill(REQUESTER), email: "not-an-email" });
  assert.equal(badEmail.ok, false);
  assert.ok(badEmail.errors.email);
  assert.equal(c.validateContactForm({ ...a.buildRequesterPrefill(REQUESTER), phone: "", email: "" }).ok, false);
});

test("02B canOfferAddContact (ZD-300): only unlinked + Growth writer + enabled", () => {
  assert.equal(a.canOfferAddContact({ linked: false, canWrite: true, enabled: true }), true);
  assert.equal(a.canOfferAddContact({ linked: false, canWrite: true, enabled: false }), false, "disabled organization");
  assert.equal(a.canOfferAddContact({ linked: false, canWrite: false, enabled: true }), false, "read-only / read grant");
  assert.equal(a.canOfferAddContact({ linked: true, canWrite: true, enabled: true }), false, "already linked");
});

test("02B outcome and error messages: never disclose why an organization is disabled; never promise consent or conversion", () => {
  assert.match(a.requestContactOutcomeMessage("linked"), /request itself is unchanged/);
  assert.match(a.requestContactOutcomeMessage("already_linked"), /no contact was added/);
  assert.match(a.requestContactOutcomeMessage("possible_duplicates"), /Nothing has been created yet/);
  const disabled = a.requestContactErrorMessage("ZW004", "request_contact_not_enabled");
  assert.match(disabled, /isn't available for this organization/);
  assert.doesNotMatch(disabled, /synthetic|allowlist|privacy|PD-1|real/i);
  assert.match(a.requestContactErrorMessage("ZW004", "already_attributed"), /linked in Growth by someone else/);
  assert.match(a.requestContactErrorMessage("ZW001"), /can view Growth links but not add contacts/);
  assert.match(a.requestContactErrorMessage("ZW002"), /isn't available/);
  assert.match(a.requestContactErrorMessage("ZW006"), /Check the details/);
  assert.match(a.requestContactErrorMessage(undefined), /Try again/);
  assert.match(a.ADD_CONTACT_NOTICE, /doesn't change the request/);
  assert.match(a.ADD_CONTACT_NOTICE, /doesn't create an opportunity or record any communication consent/);
});

test("02B boundaries in source: one atomic RPC, codes-only logging, requester-only props, no consent field, gated offer", () => {
  const actions = readFileSync(new URL("../../app/operations/growth/attribution/actions.ts", import.meta.url), "utf8");
  const fn = actions.slice(actions.indexOf("export async function createContactForRequestAction"));
  assert.match(fn, /rpc\("plus_create_contact_for_request"/);
  assert.doesNotMatch(fn, /rpc\("plus_create_contact"|rpc\("plus_link_request"/, "no two-call fallback");
  for (const line of fn.split("\n").filter((l) => l.includes("console."))) {
    assert.doesNotMatch(line, /input\.|values|formData|displayName|phone|email/, `logs codes only: ${line.trim()}`);
  }
  assert.match(fn, /g\.context\.organizationId/, "organization from the session, never the form");
  assert.doesNotMatch(fn, /consent/i);

  const page = readFileSync(new URL("../../app/operations/requests/[requestId]/page.tsx", import.meta.url), "utf8");
  const panelUse = page.slice(page.indexOf("<RequestGrowthPanel"), page.indexOf("/>", page.indexOf("<RequestGrowthPanel")));
  assert.match(panelUse, /requesterName: request\.requesterName/);
  assert.doesNotMatch(panelUse, /passenger/i, "no passenger field reaches the Growth panel");

  const form = readFileSync(new URL("../../components/growth/RequestAddContactForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /name="[^"]*consent/i, "no consent field");
  assert.match(form, /REQUESTER_NOT_PASSENGER_NOTICE/);
  assert.match(form, /d\.status === "active" &&/, "only active matches can be linked");

  const panel = readFileSync(new URL("../../components/growth/RequestGrowthPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /isRequestContactEnabled\(organizationId\)/);
  assert.match(panel, /canOfferAddContact\(/);
  assert.match(panel, /request-growth-open-in-plus/);
});

test("02C-R1 accessibility in source: focus after Cancel / error / success, one status region, errors focused not live", () => {
  assert.equal(a.contactLinkId(C), `request-growth-contact-${C}`);

  const controls = readFileSync(new URL("../../components/growth/RequestGrowthControls.tsx", import.meta.url), "utf8");
  assert.match(controls, /ref=\{addButtonRef\}/, "Cancel can return focus to Add contact");
  assert.match(controls, /focusAddButton\.current = true;\s*setAdding\(false\)/, "A1: Cancel asks for focus back");
  assert.match(controls, /getElementById\(contactLinkId\(requestId\)\)/, "A3: focus moves to the linked contact");
  const region = controls.slice(controls.indexOf('<div role="status"'), controls.indexOf('data-testid="growth-status"'));
  assert.ok(region.length > 0, "A4: one persistent status region");
  assert.equal((controls.match(/role="status"/g) ?? []).length, 1, "A4: no second status region (no duplicate announcement)");

  const form = readFileSync(new URL("../../components/growth/RequestAddContactForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /role="alert"/, "errors are focused, not live regions (no double announcement)");
  assert.match(form, /querySelector<HTMLElement>\('\[aria-invalid="true"\]'\)/, "A2: focus the first invalid field");
  assert.match(form, /"aria-describedby": hintId/, "A2: phone-or-email error is tied to both fields");
  assert.match(form, /@container/, "SP-1: layout follows the panel width, not the window");
  assert.match(form, /@lg:grid-cols-2/, "SP-1: two columns only when the panel is wide");
  assert.match(form, /\{DO_NOT_CONTACT_HELP\}/, "approved Do-not-contact wording kept");
  assert.match(form, /\{ADD_CONTACT_NOTICE\}/, "approved consent / scope wording kept");
  const order = ["growth-add-name", "growth-add-phone", "growth-add-email", "growth-add-kind", "growth-add-channel", "growth-add-owner", "growth-add-dnc"].map((id) => form.indexOf(id));
  assert.deepEqual([...order].sort((x, y) => x - y), order, "field order unchanged");
});
