// NP-P2-S6-B -- Nemryn Plus communication preferences pure rules. Run with:
//
//   node --test src/lib/plus/consents-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const c = await import("./consents-core.ts");

const TODAY = "2026-10-23";
const base = {
  mode: "grant",
  channel: "email",
  purpose: "marketing",
  method: "verbal_phone",
  capturedDate: "",
  note: "",
  correctsConsentId: "",
  idempotencyKey: "consent-0f9c1b8e-1111-4222-8333-944455556666",
  confirmed: true,
};

test("closed sets match the database CHECKs; system / future methods are never staff-selectable (ZD-229, ZD-230, ZD-238)", () => {
  assert.deepEqual([...c.CONSENT_CHANNELS], ["email", "sms", "voice"]);
  assert.deepEqual([...c.CONSENT_PURPOSES], ["service_followup", "marketing"]);
  assert.deepEqual([...c.STAFF_CAPTURE_METHODS], ["verbal_phone", "in_person", "written", "email_reply"]);
  for (const bad of ["do_not_contact", "web_form", "imported", "", null]) assert.equal(c.isStaffCaptureMethod(bad), false, String(bad));
  for (const bad of ["whatsapp", "phone", "push"]) assert.equal(c.isConsentChannel(bad), false);
  assert.equal(c.isConsentPurpose("operational"), false);
});

test("labels: the approved state labels, and no label ever claims permission or legal authorization", () => {
  assert.deepEqual(c.consentStateBadge("granted", "consent_on_record"), { label: "Consent recorded", category: "positive" });
  assert.equal(c.consentStateBadge("none", "no_consent_on_record").label, "No record");
  assert.equal(c.consentStateBadge("revoked", "no_consent_on_record").label, "Revoked");
  assert.equal(c.consentStateBadge("granted", "address_changed").label, "Recorded for a previous address");
  assert.equal(c.consentStateBadge("granted", "suppressed_do_not_contact").label, "Suppressed — do not contact");
  assert.equal(c.consentStateBadge("revoked", "suppressed_archived").label, "Contact archived");
  assert.equal(c.consentChannelLabel("sms"), "Text messages (SMS)");
  assert.equal(c.consentChannelLabel("voice"), "Phone calls");
  assert.equal(c.consentPurposeLabel("service_followup"), "Service follow-up");
  assert.match(c.consentPurposeDescription("marketing"), /Separate from follow-up/);
  const copy = [
    ...["consent_on_record", "no_consent_on_record", "address_changed", "suppressed_do_not_contact", "suppressed_archived"].flatMap((e) =>
      ["granted", "revoked", "none"].map((r) => c.consentStateBadge(r, e).label)),
    c.CONSENT_PANEL_DESCRIPTION, c.CONSENT_EMPTY_TITLE, c.CONSENT_EMPTY_DESCRIPTION, c.CONSENT_READ_ONLY_NOTE, c.CONSENT_DNC_TITLE,
    c.CONSENT_DNC_DESCRIPTION, c.CONSENT_PREFERRED_CHANNEL_NOTE, c.CONSENT_DNC_SYSTEM_NOTE, c.CONSENT_SELF_CONFIRMATION,
    c.consentEventLabel("granted"), c.consentEventLabel("revoked"),
    ...["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined].flatMap((code) =>
      ["do_not_contact", "stale_evidence", "illegal_transition", "idempotency_conflict", "invalid_input"].flatMap((m) =>
        [c.consentErrorMessage(code, m, "grant"), c.consentErrorMessage(code, m, "revoke")])),
  ];
  for (const text of copy) for (const re of c.FORBIDDEN_CONSENT_PHRASES) assert.doesNotMatch(text, re, text);
  assert.match(c.CONSENT_PANEL_DESCRIPTION, /isn't permission to send, and Nemryn sends nothing/);
});

test("validateConsentForm: a grant needs the staff confirmation; a revocation does not", () => {
  assert.equal(c.validateConsentForm(base, TODAY).ok, true);
  assert.deepEqual(c.validateConsentForm({ ...base, confirmed: false }, TODAY), { ok: false, error: "Confirm that this person gave this consent themselves." });
  const r = c.validateConsentForm({ ...base, mode: "revoke", confirmed: false }, TODAY);
  assert.equal(r.ok, true);
});

test("validateConsentForm: closed sets, key format and mode are enforced", () => {
  for (const [field, value] of [["mode", "granted"], ["channel", "fax"], ["purpose", "operational"], ["method", "do_not_contact"], ["method", "web_form"], ["idempotencyKey", "short"], ["idempotencyKey", "bad key!"], ["correctsConsentId", "not-a-uuid"]]) {
    assert.equal(c.validateConsentForm({ ...base, [field]: value }, TODAY).ok, false, `${field}=${value}`);
  }
});

test("validateConsentForm: capture date window (today -> null = now; at most a year back; never future)", () => {
  const ok = (d) => c.validateConsentForm({ ...base, capturedDate: d }, TODAY);
  assert.equal(ok("").value.capturedDate, null);
  assert.equal(ok(TODAY).value.capturedDate, null);
  assert.equal(ok("2026-10-01").value.capturedDate, "2026-10-01");
  assert.equal(c.earliestCaptureDate(TODAY), "2025-10-23");
  assert.equal(ok("2025-10-23").ok, true);
  assert.equal(ok("2025-10-22").ok, false);
  assert.equal(ok("2026-10-24").ok, false);
  assert.equal(ok("10/01/2026").ok, false);
});

test("validateConsentForm: note limit; a correction requires a note and a valid id", () => {
  assert.equal(c.validateConsentForm({ ...base, note: "n".repeat(500) }, TODAY).ok, true);
  assert.equal(c.validateConsentForm({ ...base, note: "n".repeat(501) }, TODAY).ok, false);
  assert.equal(c.validateConsentForm({ ...base, note: "   " }, TODAY).value.note, null);
  const id = "0f9c1b8e-1111-4222-8333-944455556666";
  assert.deepEqual(c.validateConsentForm({ ...base, correctsConsentId: id }, TODAY), { ok: false, error: "Explain the correction in the note." });
  assert.equal(c.validateConsentForm({ ...base, correctsConsentId: id, note: "Entered for the wrong person" }, TODAY).value.correctsConsentId, id);
});

test("channelHasAddress: email needs an email; SMS and calls need a phone", () => {
  assert.equal(c.channelHasAddress("email", { phone: "404 555 0100", email: null }), false);
  assert.equal(c.channelHasAddress("sms", { phone: "404 555 0100", email: null }), true);
  assert.equal(c.channelHasAddress("voice", { phone: null, email: "a@b.test" }), false);
  assert.equal(c.channelHasAddress("email", { phone: null, email: "a@b.test" }), true);
});

test("consentErrorMessage: each database refusal maps to clear copy", () => {
  assert.match(c.consentErrorMessage("ZW001", "unauthorized", "revoke"), /read-only/);
  assert.match(c.consentErrorMessage("ZW003", "stale_state", "grant"), /can no longer be corrected/);
  assert.match(c.consentErrorMessage("ZW004", "do_not_contact", "grant"), /Do not contact is on/);
  assert.match(c.consentErrorMessage("ZW004", "stale_evidence", "grant"), /revocation dated after this/);
  assert.match(c.consentErrorMessage("ZW004", "illegal_transition", "grant"), /Archived contacts accept revocations only/);
  assert.match(c.consentErrorMessage("ZW006", "idempotency_conflict", "grant"), /already used/);
  assert.match(c.consentErrorMessage("ZW006", "invalid_input", "grant"), /needs an address/);
  assert.match(c.consentErrorMessage(undefined, undefined, "grant"), /Try again/);
  assert.equal(c.consentSuccessMessage("grant", false, false), "That entry was already recorded.");
  assert.match(c.consentSuccessMessage("revoke", true, true), /earlier entry is kept/);
});
