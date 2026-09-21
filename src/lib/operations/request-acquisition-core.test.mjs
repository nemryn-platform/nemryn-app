// Focused unit tests for the pure acquisition presentation helpers (P1-PILOT-S4C).
import test from "node:test";
import assert from "node:assert/strict";

const { describeAcquisition, acquisitionFromRpcRow } = await import("./request-acquisition-core.ts");

const FULL = {
  utmSource: "google", utmMedium: "cpc", utmCampaign: "Dialysis_Transport", utmContent: "ad-A", utmTerm: "ride near me",
  landingPath: "/dialysis-transportation", submissionPath: "/request-transportation", referrerHost: "google.com", formVersion: "request-v2",
};

test("full snapshot -> nine restrained rows in the documented order with the documented labels", () => {
  const rows = describeAcquisition(FULL);
  assert.deepEqual(rows.map((r) => r.label), ["Source", "Medium", "Campaign", "Content", "Search term", "Landing page", "Submitted from", "Referrer", "Form version"]);
  assert.equal(rows[2].value, "Dialysis_Transport");
});

test("absent / empty values are skipped; nothing usable => no rows (the section is omitted)", () => {
  assert.deepEqual(describeAcquisition(null), []);
  assert.deepEqual(describeAcquisition(undefined), []);
  assert.deepEqual(describeAcquisition({ ...FULL, utmSource: null, utmMedium: "  ", utmCampaign: null, utmContent: null, utmTerm: null, landingPath: null, submissionPath: null, referrerHost: null, formVersion: null }), []);
  const partial = describeAcquisition({ ...FULL, utmMedium: null, utmContent: null, utmTerm: null, submissionPath: null });
  assert.deepEqual(partial.map((r) => r.label), ["Source", "Campaign", "Landing page", "Referrer", "Form version"]);
});

test("no guessed classification is ever produced (paid / organic / social / direct)", () => {
  const text = JSON.stringify(describeAcquisition(FULL)) + JSON.stringify(describeAcquisition({ ...FULL, utmMedium: null, utmSource: null }));
  assert.doesNotMatch(text, /"(Paid|Organic|Social|Direct|Unknown)"/);
});

test("values stay plain text: no ids, no raw JSON, no internal field names in labels", () => {
  for (const row of describeAcquisition(FULL)) {
    assert.doesNotMatch(row.label, /_|utm|id\b|json/i);
    assert.equal(typeof row.value, "string");
  }
});

test("rpc row mapping: null / no-row -> null; empty row -> null; full row maps every field", () => {
  assert.equal(acquisitionFromRpcRow(null), null);
  assert.equal(acquisitionFromRpcRow(undefined), null);
  const empty = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_path: null, submission_path: null, referrer_host: null, form_version: null };
  assert.equal(acquisitionFromRpcRow(empty), null);
  assert.deepEqual(
    acquisitionFromRpcRow({ ...empty, utm_source: "google", landing_path: "/dialysis-transportation", form_version: "request-v2" }),
    { utmSource: "google", utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, landingPath: "/dialysis-transportation", submissionPath: null, referrerHost: null, formVersion: "request-v2" },
  );
});
