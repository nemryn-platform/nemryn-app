// NP-P1-S4 -- Nemryn Plus Contacts pure rules. Run with:
//
//   node --test src/lib/plus/contacts-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const c = await import("./contacts-core.ts");

const base = {
  displayName: "Dana Fictional",
  phone: "(404) 555-0100",
  email: "",
  contactKind: "individual",
  jobTitle: "",
  preferredChannel: "phone",
  doNotContact: false,
  ownerHandle: "",
};

test("closed sets match the database CHECKs exactly", () => {
  assert.deepEqual([...c.CONTACT_KINDS], ["individual", "family_caregiver", "facility_staff", "referral_source", "other"]);
  assert.deepEqual([...c.CONTACT_CHANNELS], ["phone", "email", "none"]);
  assert.deepEqual([...c.LOGGABLE_ACTIVITY_TYPES], ["note", "call_logged", "email_logged", "meeting_logged"]);
  for (const bad of ["patient", "", null, "INDIVIDUAL"]) assert.equal(c.isContactKind(bad), false);
  for (const bad of ["owner_changed", "record_archived", "stage_changed", "quote_sent", "consent_recorded"]) {
    assert.equal(c.isLoggableActivityType(bad), false, `${bad} is not staff-loggable`);
  }
});

test("valid contact: trimmed, email lower-cased, empty optionals become null", () => {
  const r = c.validateContactForm({ ...base, displayName: "  Dana  ", email: "  Dana.F@Example.TEST ", jobTitle: "  " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    displayName: "Dana",
    phone: "(404) 555-0100",
    email: "dana.f@example.test",
    contactKind: "individual",
    jobTitle: null,
    preferredChannel: "phone",
    doNotContact: false,
    ownerHandle: null,
  });
});

test("a phone or an email is required", () => {
  const r = c.validateContactForm({ ...base, phone: " ", email: "", preferredChannel: "none" });
  assert.equal(r.ok, false);
  assert.match(r.errors.form, /phone number or an email/);
});

test("limits and formats mirror the database", () => {
  const bad = [
    [{ displayName: "   " }, "displayName"],
    [{ displayName: "n".repeat(201) }, "displayName"],
    [{ phone: "call me" }, "phone"],
    [{ phone: "555-01" }, "phone"],
    [{ phone: "1".repeat(41) }, "phone"],
    [{ email: "not-an-email", preferredChannel: "none" }, "email"],
    [{ email: "a b@example.test", preferredChannel: "none" }, "email"],
    [{ contactKind: "patient" }, "contactKind"],
    [{ jobTitle: "t".repeat(121) }, "jobTitle"],
    [{ preferredChannel: "sms" }, "preferredChannel"],
    [{ ownerHandle: "not-a-handle" }, "ownerHandle"],
  ];
  for (const [patch, field] of bad) {
    const r = c.validateContactForm({ ...base, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.ok(r.errors[field], `${field} error for ${JSON.stringify(patch)}`);
  }
  assert.equal(c.validateContactForm({ ...base, phone: "+1 404 555 0101 x42" }).ok, true, "extension accepted");
  assert.equal(c.validateContactForm({ ...base, displayName: "n".repeat(200) }).ok, true);
});

test("preferred channel must be reachable", () => {
  assert.equal(c.validateContactForm({ ...base, phone: "", email: "x@example.test", preferredChannel: "phone" }).ok, false);
  assert.equal(c.validateContactForm({ ...base, preferredChannel: "email" }).ok, false);
  assert.equal(c.validateContactForm({ ...base, phone: "", email: "x@example.test", preferredChannel: "email" }).ok, true);
});

test("activity input: loggable type and 1-2000 char summary", () => {
  assert.deepEqual(c.validateActivityInput("call_logged", "  Called.  "), { ok: true, type: "call_logged", body: "Called." });
  assert.equal(c.validateActivityInput("note", "   ").ok, false);
  assert.equal(c.validateActivityInput("note", "b".repeat(2001)).ok, false);
  assert.equal(c.validateActivityInput("owner_changed", "x").ok, false);
  assert.equal(c.validateActivityInput(undefined, "x").ok, false);
});

test("list params: unknown values fall back to safe defaults; hrefs round-trip", () => {
  assert.deepEqual(c.parseContactListParams({}), { search: "", kind: null, status: "active", page: 1 });
  assert.deepEqual(c.parseContactListParams({ q: "  dana ", kind: "patient", status: "deleted", page: "-3" }), { search: "dana", kind: null, status: "active", page: 1 });
  const p = c.parseContactListParams({ q: "dana", kind: "facility_staff", status: "archived", page: "2" });
  assert.deepEqual(p, { search: "dana", kind: "facility_staff", status: "archived", page: 2 });
  assert.equal(c.contactListHref(p), "/operations/growth/contacts?q=dana&kind=facility_staff&status=archived&page=2");
  assert.equal(c.contactListHref(p, { page: 1, status: "active" }), "/operations/growth/contacts?q=dana&kind=facility_staff");
  assert.equal(c.pageCount(0), 1);
  assert.equal(c.pageCount(25), 1);
  assert.equal(c.pageCount(26), 2);
});

test("duplicate descriptions and error copy are plain words (no codes)", () => {
  assert.equal(c.describeMatch(["email"]), "Same email");
  assert.equal(c.describeMatch(["email", "phone", "name"]), "Same email, phone and name");
  assert.equal(c.describeMatch([]), "Similar details");
  assert.equal(c.contactErrorMessage("ZW003", "save"), c.CONTACT_STALE_MESSAGE);
  for (const code of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined]) {
    for (const op of ["save", "archive", "log", "load"]) assert.doesNotMatch(c.contactErrorMessage(code, op), /ZW\d|sqlstate/i);
  }
});

test("privacy notices: a reminder, never a guarantee; logging is not sending", () => {
  assert.match(c.NO_MEDICAL_DETAILS_NOTICE, /medical/);
  assert.doesNotMatch(c.NO_MEDICAL_DETAILS_NOTICE, /prevent|guarantee|ensure|compliant|HIPAA/i);
  assert.match(c.LOGGING_IS_NOT_SENDING_NOTICE, /doesn't send emails, place calls or schedule meetings/);
});

test("times are shown in the organization timezone; back-dated entries are recognised", () => {
  assert.equal(c.formatContactTime("2026-10-14T03:30:00Z", "America/New_York"), "Oct 13, 2026, 11:30 PM");
  assert.equal(c.formatContactTime("nope", "UTC"), "");
  assert.equal(c.isBackdated("2026-10-12T10:00:00Z", "2026-10-14T10:00:00Z"), true);
  assert.equal(c.isBackdated("2026-10-14T10:00:00Z", "2026-10-14T10:01:00Z"), false);
});
