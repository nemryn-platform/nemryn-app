// Focused unit tests for the pure Website Integration helpers
// (P1-PILOT-S4B-R4B). Run with:
//   node --test src/lib/operations/website-integration-core.test.mjs
//
// The origin vectors below are the SAME accept/reject vectors asserted against
// the database's _normalize_website_origin in
// supabase/tests/website_integration_self_service_tests.sql (ORIGIN-1/2).
// The database is the authority; this pins that the friendly pre-check agrees.

import test from "node:test";
import assert from "node:assert/strict";

const {
  normalizeWebsiteOrigin,
  deriveWebsiteIntegrationStatus,
  WEBSITE_INTEGRATION_STATUS_LABEL,
  buildSetupEnvExample,
  buildAcquisitionExample,
  formatIntegrationTimestamp,
  formatIntegrationDate,
  WEBSITE_INTAKE_PATH,
} = await import("./website-integration-core.ts");

const ACCEPT = [
  ["https://www.example.com", "https://www.example.com"],
  ["https://example.com", "https://example.com"],
  ["https://portal.example.com", "https://portal.example.com"],
  ["https://www.example.com/", "https://www.example.com"],
  ["  HTTPS://WWW.Example.COM/  ", "https://www.example.com"],
  ["https://example.com:443", "https://example.com"],
  ["https://example.com:8443", "https://example.com:8443"],
  ["https://example.co.uk", "https://example.co.uk"],
  ["https://xn--bcher-kva.example", "https://xn--bcher-kva.example"],
  ["https://a-b.example-site.org", "https://a-b.example-site.org"],
];

const REJECT = [
  "http://example.com", "https://example.com/path", "https://example.com/path/", "https://example.com?x=1",
  "https://example.com/?x=1", "https://example.com#fragment", "https://user:pass@example.com", "https://user@example.com",
  "https://*.example.com", "*.example.com", "https://*", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com",
  "example.com", "www.example.com", "//example.com", "https://", "https:///", "https://localhost", "https://localhost:3000",
  "http://localhost:3000", "https://127.0.0.1", "https://192.168.1.1", "https://[::1]", "https://example", "https://example.c",
  "https://exa mple.com", "https://example.com\n", "\thttps://example.com", "https://-example.com", "https://example-.com",
  "https://exa_mple.com", "https://example.com:0", "https://example.com:99999", "https://example.com:abc",
  "https://example.com//", "https://bücher.example", "", "   ", "null", "https://.example.com", "https://example..com",
  "https://example.com.", "a".repeat(300),
];

test("accepted origins normalize to canonical form", () => {
  for (const [input, expected] of ACCEPT) {
    assert.equal(normalizeWebsiteOrigin(input), expected, input);
  }
});

test("malformed / unsafe origins are all rejected", () => {
  for (const input of REJECT) {
    assert.equal(normalizeWebsiteOrigin(input), null, JSON.stringify(input));
  }
});

test("never produces a wildcard, path, query, fragment or userinfo", () => {
  for (const [input] of ACCEPT) {
    const out = normalizeWebsiteOrigin(input);
    assert.match(out, /^https:\/\/[a-z0-9.-]+(:\d+)?$/);
  }
});

test("status model is derived, never persisted", () => {
  assert.equal(deriveWebsiteIntegrationStatus(null), "NOT_CONFIGURED");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: false, requestCount: 0 }), "DISABLED");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: false, requestCount: 7 }), "DISABLED");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: true, requestCount: 0 }), "READY_TO_TEST");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: true, requestCount: 1 }), "CONNECTED");
});

test("status labels are the human wording", () => {
  assert.deepEqual(WEBSITE_INTEGRATION_STATUS_LABEL, {
    NOT_CONFIGURED: "Not configured",
    DISABLED: "Disabled",
    READY_TO_TEST: "Ready to test",
    CONNECTED: "Connected",
  });
});

test("setup env example carries only the endpoint and Integration ID, no credential", () => {
  const env = buildSetupEnvExample({ endpoint: "https://app.example.test/api/public-intake/website", integrationId: "web_ABCDEFGH2345" });
  assert.equal(
    env,
    [
      "REQUEST_INTAKE_MODE=platform",
      "PLATFORM_INTAKE_URL=https://app.example.test/api/public-intake/website",
      "PLATFORM_INTAKE_INTEGRATION_ID=web_ABCDEFGH2345",
    ].join("\n"),
  );
  assert.doesNotMatch(env, /supabase|service_role|anon|password|secret|token|database/i);
});

test("endpoint path is the frozen public-intake route", () => {
  assert.equal(WEBSITE_INTAKE_PATH, "/api/public-intake/website");
});

test("timestamps render in the organization timezone; null passes through", () => {
  assert.equal(formatIntegrationTimestamp(null, "America/New_York"), null);
  assert.equal(formatIntegrationTimestamp("not a date", "America/New_York"), null);
  assert.match(formatIntegrationTimestamp("2026-09-20T03:30:00Z", "America/New_York"), /Sep 19, 2026/);
  assert.match(formatIntegrationTimestamp("2026-09-20T03:30:00Z", "America/Los_Angeles"), /Sep 19, 2026/);
  assert.match(formatIntegrationDate("2026-09-20T03:30:00Z", "Pacific/Honolulu"), /Sep 19, 2026/);
});

test("acquisition developer example is a valid optional object with only allowed fields and no credential/full URL", () => {
  const example = buildAcquisitionExample();
  const parsed = JSON.parse(`{${example}}`);
  assert.deepEqual(Object.keys(parsed.acquisition), ["utmSource", "utmMedium", "utmCampaign", "landingPath", "submissionPath", "referrerHost", "formVersion"]);
  assert.match(parsed.acquisition.landingPath, /^\/[^?#]*$/);
  assert.doesNotMatch(example, /https?:|\?|#|key|secret|token|password|service/i);
});
