// NP-P2-S7-C -- staff inquiry management rules. Run with:
//
//   node --test src/lib/plus/inquiries-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const c = await import("./inquiries-core.ts");
const inquiryCore = await import("../plus-inquiry/inquiry-core.ts");

test("status labels and StatusBadge tones", () => {
  assert.equal(c.inquiryStatusLabel("new"), "New");
  assert.equal(c.inquiryStatusLabel("converted"), "Converted");
  assert.equal(c.inquiryStatusLabel("dismissed"), "Dismissed");
  assert.equal(c.inquiryStatusTone("new"), "informational");
  assert.equal(c.inquiryStatusTone("converted"), "positive");
  assert.equal(c.inquiryStatusTone("dismissed"), "neutral");
});

test("dismiss reasons match the database list", () => {
  assert.deepEqual([...c.DISMISS_REASONS], ["spam", "duplicate", "not_relevant", "out_of_area", "other"]);
  for (const r of c.DISMISS_REASONS) assert.ok(c.DISMISS_REASON_LABELS[r]);
  assert.equal(c.dismissReasonLabel(null), "—");
  assert.equal(c.dismissReasonLabel("bogus"), "—");
});

test("value labels cover every public-form option", () => {
  for (const t of inquiryCore.INQUIRY_TYPES) assert.notEqual(c.inquiryTypeText(t), t);
  for (const o of inquiryCore.RELATIONSHIP_OPTIONS) assert.notEqual(c.relationshipText(o.value), o.value);
  for (const o of inquiryCore.TIMEFRAME_OPTIONS) assert.notEqual(c.timeframeText(o.value), o.value);
  for (const o of inquiryCore.PREFERRED_REPLY_OPTIONS) assert.notEqual(c.preferredReplyText(o.value), o.value);
  assert.equal(c.relationshipText(null), "Not given");
});

test("list params: bounded, unknown values fall back, href round-trips", () => {
  assert.deepEqual(c.parseInquiryListParams({}), { status: "new", search: "", page: 1 });
  assert.deepEqual(c.parseInquiryListParams({ status: "bogus", page: "-4", q: "  ann " }), { status: "new", search: "ann", page: 1 });
  assert.equal(c.parseInquiryListParams({ q: "x".repeat(500) }).search.length, 200);
  assert.equal(c.parseInquiryListParams({ page: "999999" }).page, 4000);
  assert.equal(c.parseInquiryListParams({ status: ["dismissed", "new"] }).status, "dismissed");
  const p = { status: "all", search: "a b", page: 3 };
  assert.equal(c.inquiryListHref(p), "/operations/growth/inquiries?status=all&q=a+b&page=3");
  assert.equal(c.inquiryListHref({ status: "new", search: "", page: 1 }), "/operations/growth/inquiries");
  assert.deepEqual(c.parseInquiryListParams(Object.fromEntries(new URL(`http://x${c.inquiryListHref(p)}`).searchParams)), p);
});

test("consent ticks: an unticked box is never described as permission", () => {
  const none = c.consentTicksText(false, false);
  assert.equal(none.length, 2);
  for (const line of none) assert.match(line, /^Not ticked: .*\(no permission given\)$/);
  const both = c.consentTicksText(true, true);
  for (const line of both) assert.match(line, /^Ticked: /);
  assert.deepEqual(c.consentTicksText(true, false).map((l) => l.startsWith("Ticked")), [true, false]);
});

test("skipped consent pairs are explained in plain words", () => {
  assert.equal(c.consentSkipText("email/marketing:do_not_contact"), "Email — news and offers: not recorded because the contact is marked Do not contact.");
  assert.equal(c.consentSkipText("voice/service_followup:address_mismatch"), "Phone calls — follow-up: not recorded because the contact's address differs from the one given on the form.");
  assert.match(c.consentSkipText("email/service_followup:something_new"), /not recorded\.$/);
});

test("error messages never expose codes", () => {
  for (const code of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined, "42501"]) {
    const m = c.inquiryErrorMessage(code);
    assert.ok(m.length > 10);
    assert.doesNotMatch(m, /ZW\d|SQL|exception/i);
  }
  assert.match(c.inquiryErrorMessage("ZW004", "do_not_contact_acknowledgement_required"), /Do not contact/);
  assert.match(c.inquiryErrorMessage("ZW004", "public_access_not_enabled"), /haven't been turned on/);
  assert.match(c.inquiryErrorMessage("ZW003"), /Reload/);
});

test("form settings validation", () => {
  const ok = c.validateInquiryFormSettings({ headline: "  Ask us ", introText: "  ", services: ["dialysis", "dialysis"] }, ["dialysis", "other"]);
  assert.deepEqual(ok, { ok: true, value: { headline: "Ask us", introText: null, services: ["dialysis"] } });
  const bad = c.validateInquiryFormSettings({ headline: "", introText: "x".repeat(501), services: ["airport_transportation"] }, ["dialysis"]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.headline && bad.errors.introText && bad.errors.services);
  assert.equal(c.validateInquiryFormSettings({ headline: "x".repeat(121), introText: null, services: [] }, []).ok, false);
  assert.equal(c.validateInquiryFormSettings({ headline: "x".repeat(120), introText: null, services: "dialysis" }, []).ok, true);
});

test("form status labels", () => {
  assert.deepEqual(c.inquiryFormStatusLabel(null), { label: "Not set up", tone: "neutral" });
  assert.equal(c.inquiryFormStatusLabel("draft").label, "Draft");
  assert.equal(c.inquiryFormStatusLabel("published").tone, "positive");
  assert.equal(c.inquiryFormStatusLabel("disabled").tone, "warning");
});

test("hosted link and embed snippet use the S7-B public routes", () => {
  const key = "inq_" + "a".repeat(32);
  assert.equal(c.buildInquiryHostedUrl("https://app.example.test/", key), `https://app.example.test/inquiry/${key}`);
  const snippet = c.buildInquiryEmbedSnippet("https://app.example.test//", key);
  assert.equal(snippet, `<div data-nemryn-inquiry-form="${key}"></div>\n<script src="https://app.example.test/embed/inquiry-form.js" async></script>`);
});

test("match-on text", () => {
  assert.equal(c.matchOnText("email"), "email");
  assert.equal(c.matchOnText("email,phone"), "email and phone");
  assert.equal(c.matchOnText("email,phone,name"), "email, phone and name");
  assert.equal(c.matchOnText(""), "—");
});

test("default opportunity title matches plus_convert_inquiry", () => {
  assert.equal(c.defaultOpportunityTitle("Ann", "quote"), "Ann — Price question");
  assert.equal(c.defaultOpportunityTitle("Ann", "availability"), "Ann — Availability question");
  assert.equal(c.defaultOpportunityTitle("Ann", "service_question"), "Ann — Service question");
  assert.equal(c.defaultOpportunityTitle("Ann", "booking"), "Ann — Booking interest");
  assert.equal(c.defaultOpportunityTitle("Ann", "other"), "Ann — Website inquiry");
});
