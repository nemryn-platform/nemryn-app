// NP-PILOT-P1 -- Growth -> Core handoff rules. Run with:
//
//   node --test src/lib/plus/handoff-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const h = await import("./handoff-core.ts");

test("who is requesting: the inquiry's answer first, then an unambiguous contact kind, else nothing", () => {
  assert.equal(h.handoffPrefill({ inquiryRelationship: "facility_staff", contactKind: "individual" }).requesterRelationship, "facility_coordinator");
  assert.equal(h.handoffPrefill({ inquiryRelationship: "self" }).requesterRelationship, "self");
  assert.equal(h.handoffPrefill({ contactKind: "family_caregiver" }).requesterRelationship, "family");
  assert.equal(h.handoffPrefill({ contactKind: "individual" }).requesterRelationship, null);
  assert.equal(h.handoffPrefill({ contactKind: "referral_source" }).requesterRelationship, null);
  assert.equal(h.handoffPrefill({ inquiryRelationship: "bogus", contactKind: "other" }).requesterRelationship, null);
  assert.match(h.handoffPrefill({ inquiryRelationship: "family" }).notes[0], /website inquiry/);
});

test("return trip: only 'yes' from the newest accepted (else newest live sent) round-trip quote; never 'no'", () => {
  const q = (n, status, roundTrip, extra = {}) => ({ quoteNumber: n, kind: "quote", status, roundTrip, ...extra });
  assert.equal(h.handoffPrefill({ quotes: [q(1, "accepted", true)] }).returnTripNeeded, "yes");
  assert.equal(h.handoffPrefill({ quotes: [q(1, "accepted", true), q(2, "accepted", false)] }).returnTripNeeded, null);
  assert.equal(h.handoffPrefill({ quotes: [q(3, "sent", true), q(2, "accepted", false)] }).returnTripNeeded, null);
  assert.equal(h.handoffPrefill({ quotes: [q(3, "sent", true)] }).returnTripNeeded, "yes");
  assert.equal(h.handoffPrefill({ quotes: [q(3, "sent", true, { isExpired: true })] }).returnTripNeeded, null);
  assert.equal(h.handoffPrefill({ quotes: [q(4, "draft", true), q(5, "withdrawn", true), q(6, "superseded", true)] }).returnTripNeeded, null);
  assert.match(h.handoffPrefill({ quotes: [q(7, "accepted", true)] }).notes.join(" "), /quote 7 was priced as a round trip/);
});

test("passenger choices: previous rider, then phone, then exact name, then A-Z; never pre-selected", () => {
  const ps = [
    { id: "a", displayName: "Zed Other", phone: null },
    { id: "b", displayName: "margaret fictional", phone: "404-555-0000" },
    { id: "c", displayName: "Rose Mother", phone: "(404) 555-0142" },
    { id: "d", displayName: "Alan Prior", phone: null },
    { id: "e", displayName: "Bea Other", phone: "+1 404 555 0142" },
  ];
  const r = h.rankPassengerChoices(ps, { name: "Margaret Fictional", phone: "(404) 555-0142" }, ["d"]);
  assert.deepEqual(r.map((p) => `${p.id}:${p.match}`), ["d:previous", "e:phone", "c:phone", "b:name", "a:null"]);
  // a short / missing phone never matches by phone
  assert.deepEqual(h.rankPassengerChoices([{ id: "x", displayName: "X", phone: "555" }], { name: "Y", phone: "555" }).map((p) => p.match), [null]);
  assert.deepEqual(h.rankPassengerChoices([], { name: "Y", phone: null }), []);
});

test("passenger choice parsing: blank = decide later; a choice needs explicit confirmation; rider name XOR passenger", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(h.parsePassengerChoice({ passengerId: "", passengerConfirmed: "" }), { ok: true, passengerId: null, riderName: null });
  assert.deepEqual(h.parsePassengerChoice({ passengerId: undefined, passengerConfirmed: undefined }), { ok: true, passengerId: null, riderName: null });
  assert.equal(h.parsePassengerChoice({ passengerId: id, passengerConfirmed: "" }).ok, false);
  assert.deepEqual(h.parsePassengerChoice({ passengerId: id, passengerConfirmed: "yes" }), { ok: true, passengerId: id, riderName: null });
  assert.equal(h.parsePassengerChoice({ passengerId: "not-a-uuid", passengerConfirmed: "yes" }).ok, false);
  // rider name for a NEW passenger (D1)
  assert.deepEqual(h.parsePassengerChoice({ passengerId: "", passengerConfirmed: "", riderName: "  Rose Fictional  " }), { ok: true, passengerId: null, riderName: "Rose Fictional" });
  assert.equal(h.parsePassengerChoice({ passengerId: id, passengerConfirmed: "yes", riderName: "Rose" }).ok, false);
  assert.equal(h.parsePassengerChoice({ passengerId: "", passengerConfirmed: "", riderName: "x".repeat(201) }).ok, false);
  assert.equal(h.parsePassengerChoice({ passengerId: "", passengerConfirmed: "", riderName: "Rose\nFictional" }).ok, false);
  assert.equal(h.parsePassengerChoice({ passengerId: "", passengerConfirmed: "", riderName: "x".repeat(200) }).ok, true);
});

test("phone digits normalise US formats", () => {
  assert.equal(h.digitsOf("+1 (404) 555-0142"), "4045550142");
  assert.equal(h.digitsOf("404.555.0142"), "4045550142");
  assert.equal(h.digitsOf(null), "");
});
