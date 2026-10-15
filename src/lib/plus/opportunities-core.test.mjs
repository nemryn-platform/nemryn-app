// NP-P2-S1 -- Nemryn Plus private-pay pipeline pure rules. Run with:
//
//   node --test src/lib/plus/opportunities-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const o = await import("./opportunities-core.ts");
const core = await import("../public-intake/website-intake-core.ts");

const base = {
  contactId: "4cb65c2d-9e82-461b-a444-d4d991ab930f",
  title: "Weekly dialysis rides",
  inquiryType: "quote",
  serviceType: "dialysis",
  source: "referral",
  sourceDetail: "",
  campaignCode: "",
  estimate: "",
  paymentReportedStatus: "none",
  ownerHandle: "",
};

test("stage sets match the database exactly; converted is never offered", () => {
  assert.deepEqual([...o.OPEN_STAGES], ["new_inquiry", "contacted", "qualified", "quote_sent", "quote_accepted"]);
  assert.deepEqual([...o.ALL_STAGES], ["new_inquiry", "contacted", "qualified", "quote_sent", "quote_accepted", "converted", "lost"]);
  assert.equal(o.OPEN_STAGE_OPTIONS.some((x) => x.value === "converted" || x.value === "lost"), false);
  assert.deepEqual(o.stageMoveOptions("qualified"), ["new_inquiry", "contacted", "quote_sent", "quote_accepted"], "forward and back, not the current one");
  assert.deepEqual(o.stageMoveOptions("lost"), []);
  assert.deepEqual(o.stageMoveOptions("converted"), []);
});

test("quote stages are always labelled as staff-reported; no quote is implied", () => {
  assert.equal(o.stageDisplayLabel("quote_sent"), "Quote sent (reported)");
  assert.equal(o.stageDisplayLabel("quote_accepted"), "Quote accepted (reported)");
  assert.equal(o.stageDisplayLabel("qualified"), "Qualified");
  assert.match(o.REPORTED_QUOTE_STAGE_NOTE, /hasn't created, sent or received a quote/);
  assert.match(o.CONVERTED_RESERVED_NOTE, /isn't available yet/);
});

test("service types mirror Core's closed set and labels exactly", () => {
  assert.deepEqual([...o.SERVICE_TYPES], [...core.SERVICE_TYPE_VALUES]);
  for (const v of o.SERVICE_TYPES) assert.equal(o.serviceTypeLabel(v), core.SERVICE_TYPE_LABELS[v]);
});

test("closed sets: sources, inquiry types, lost reasons, payment statuses", () => {
  assert.deepEqual([...o.SOURCES], ["phone", "website", "web_inquiry", "email", "referral", "facility", "walk_in", "event", "advertising", "other"]);
  assert.deepEqual([...o.INQUIRY_TYPES], ["quote", "availability", "service_question", "booking", "other"]);
  assert.deepEqual([...o.PAYMENT_REPORTED_STATUSES], ["none", "deposit_reported", "paid_reported", "refund_reported"]);
  // owner-approved canonical vocabulary (NP-P2-S1-R1A), exact set and order
  assert.deepEqual([...o.LOST_REASONS], ["no_response", "price", "chose_competitor", "outside_service_area", "service_not_offered", "no_availability", "not_a_fit", "duplicate", "other"]);
  for (const retired of ["chose_another_provider", "no_longer_needed"]) assert.equal(o.isLostReason(retired), false, retired);
  for (const label of o.LOST_REASON_OPTIONS.map((x) => x.label)) assert.doesNotMatch(label, /diagnos|medical|health|insur/i, "non-medical reasons");
});

test("payment and estimate wording never claims settlement or revenue", () => {
  for (const s of o.PAYMENT_REPORTED_STATUSES.filter((s) => s !== "none")) assert.match(o.paymentReportedLabel(s), /reported by staff/);
  assert.match(o.PAYMENT_REPORTED_NOTE, /not a settlement record/);
  assert.match(o.ESTIMATE_NOTE, /not revenue/);
  assert.equal(o.formatEstimate(125000), "$1,250");
  assert.equal(o.formatEstimate(125050), "$1,250.50");
  assert.equal(o.formatEstimate(null), "");
});

test("estimate parsing", () => {
  assert.equal(o.parseEstimate(""), null);
  assert.equal(o.parseEstimate("1,250"), 125000);
  assert.equal(o.parseEstimate("$1250.5"), 125050);
  assert.equal(o.parseEstimate("0"), 0);
  for (const bad of ["-1", "abc", "1.234", "1000000.01", "12e3"]) assert.equal(o.parseEstimate(bad), undefined, bad);
  assert.equal(o.parseEstimate("1000000"), 100000000);
});

test("form validation mirrors the database; campaign code lower-cased", () => {
  const ok = o.validateOpportunityForm({ ...base, title: "  Weekly dialysis rides  ", campaignCode: " Spring_2026 ", estimate: "1,250", sourceDetail: " Dr. Lee " });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.title, "Weekly dialysis rides");
  assert.equal(ok.value.campaignCode, "spring_2026");
  assert.equal(ok.value.estimatedValueCents, 125000);
  assert.equal(ok.value.sourceDetail, "Dr. Lee");
  const bad = [
    [{ contactId: "x" }, "contactId"],
    [{ title: " " }, "title"],
    [{ title: "t".repeat(201) }, "title"],
    [{ inquiryType: "consult" }, "inquiryType"],
    [{ serviceType: "surgery" }, "serviceType"],
    [{ source: "billboard" }, "source"],
    [{ sourceDetail: "d".repeat(121) }, "sourceDetail"],
    [{ campaignCode: "Bad Code!" }, "campaignCode"],
    [{ estimate: "-5" }, "estimate"],
    [{ paymentReportedStatus: "paid_in_full" }, "paymentReportedStatus"],
    [{ ownerHandle: "nope" }, "ownerHandle"],
  ];
  for (const [patch, field] of bad) {
    const r = o.validateOpportunityForm({ ...base, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.ok(r.errors[field], field);
  }
});

test("lost and reopen input rules", () => {
  assert.equal(o.validateLostInput("", "").ok, false);
  assert.equal(o.validateLostInput("other", "  ").ok, false, "other needs a note");
  assert.deepEqual(o.validateLostInput("price", "  "), { ok: true, reason: "price", note: null });
  assert.equal(o.validateLostInput("price", "n".repeat(501)).ok, false);
  assert.equal(o.validateReopenInput("converted", "They called back").ok, false);
  assert.equal(o.validateReopenInput("lost", "They called back").ok, false);
  assert.equal(o.validateReopenInput("contacted", "no").ok, false, "reason required");
  assert.deepEqual(o.validateReopenInput("contacted", "  They called back. "), { ok: true, stage: "contacted", reason: "They called back." });
});

test("pipeline params: safe defaults; contradictory filters dropped; board only for open", () => {
  assert.deepEqual(o.parsePipelineParams({}), { search: "", view: "open", stage: null, source: null, owner: null, layout: "board" });
  assert.equal(o.parsePipelineParams({ view: "converted" }).view, "open", "no converted view in P2-S1");
  assert.equal(o.parsePipelineParams({ stage: "lost" }).stage, null, "lost stage in the open view is dropped");
  assert.equal(o.parsePipelineParams({ view: "lost", stage: "qualified" }).stage, null);
  assert.equal(o.parsePipelineParams({ view: "lost" }).layout, "list");
  assert.equal(o.parsePipelineParams({ stage: "converted", view: "all" }).stage, null);
  const p = o.parsePipelineParams({ q: " pat ", view: "open", stage: "qualified", source: "referral", layout: "list" });
  assert.equal(o.pipelineHref(p), "/operations/growth/pipeline?q=pat&stage=qualified&source=referral&layout=list");
  assert.equal(o.pipelineHref(p, { view: "lost", stage: null, layout: "list" }), "/operations/growth/pipeline?q=pat&view=lost&source=referral");
});

test("error copy: plain words, no codes", () => {
  for (const code of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined]) {
    for (const op of ["save", "stage", "lost", "reopen"]) assert.doesNotMatch(o.opportunityErrorMessage(code, op), /ZW\d|sqlstate/i);
  }
  assert.match(o.opportunityErrorMessage("ZW006", "stage"), /Converted isn't available yet/);
});

test("NP-P2-S3-R2: a contact change refused for linked Requests gets its own message; closed stays closed", () => {
  assert.equal(
    o.opportunityErrorMessage("ZW004", "save", o.LINKED_REQUESTS_REASON),
    "This opportunity has linked transportation requests. Correct those request links before changing its contact.",
  );
  assert.equal(o.LINKED_REQUESTS_REASON, "linked_requests", "matches the database exception message");
  assert.match(o.opportunityErrorMessage("ZW004", "save"), /This opportunity is closed/);
  assert.match(o.opportunityErrorMessage("ZW004", "save", "illegal_transition"), /This opportunity is closed/);
  assert.match(o.opportunityErrorMessage("ZW004", "reopen", o.LINKED_REQUESTS_REASON), /Only a lost opportunity can be reopened/);
  assert.doesNotMatch(o.opportunityErrorMessage("ZW004", "stage", o.LINKED_REQUESTS_REASON), /linked transportation requests/);
});
