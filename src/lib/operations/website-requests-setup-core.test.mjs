// Unit tests for the Website Requests setup experience (P1-COMM-D3).
//
//   node --test src/lib/operations/website-requests-setup-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./website-requests-setup-core.ts");
const pkgCore = await import("./website-requests-core.ts");

const conn = (o = {}) => ({ website: "https://www.acme.example", isActive: true, requestCount: 0, connectionMethod: "developer", ...o });

test("connection progress is derived: a disabled connection is never complete, even after it received requests", () => {
  const fresh = core.connectionSetupProgress(conn({ isActive: false, connectionMethod: null }));
  assert.deepEqual(fresh.steps.map((s) => s.done), [true, false, false, false, false]);
  assert.equal(fresh.next.key, "method");
  const off = core.connectionSetupProgress(conn({ isActive: false }));
  assert.equal(off.next.key, "on");
  assert.equal(off.complete, false);
  const readyToTest = core.connectionSetupProgress(conn());
  assert.equal(readyToTest.next.key, "test");
  const connected = core.connectionSetupProgress(conn({ requestCount: 3 }));
  assert.equal(connected.complete, true);
  const usedButOff = core.connectionSetupProgress(conn({ requestCount: 3, isActive: false }));
  assert.equal(usedButOff.complete, false);
  assert.equal(usedButOff.next.key, "on");
});

test("form progress: 'added / shared' is never assumed -- only proven by a received request", () => {
  assert.equal(core.formSetupProgress({ formState: "NOT_CONFIGURED", publication: null }).next.key, "configured");
  assert.equal(core.formSetupProgress({ formState: "DRAFT", publication: null }).next.key, "ready");
  assert.equal(core.formSetupProgress({ formState: "READY", publication: null }).next.key, "published");
  const live = core.formSetupProgress({ formState: "READY", publication: { status: "published", requestCount: 0 } });
  assert.equal(live.next.key, "shared");
  assert.equal(core.formSetupProgress({ formState: "READY", publication: { status: "published", requestCount: 1 } }).complete, true);
  assert.equal(core.formSetupProgress({ formState: "READY", publication: { status: "disabled", requestCount: 5 } }).complete, false);
});

test("summary picks the most advanced setup", () => {
  const mk = (status, ref) => ({ kind: "connection", ref, website: null, methodLabel: "x", status, lastRequestReceived: null, progress: core.connectionSetupProgress(conn()) });
  assert.equal(core.pickPrimarySetup([]), null);
  assert.equal(core.pickPrimarySetup([mk("DISABLED", "a"), mk("CONNECTED", "b"), mk("READY_TO_TEST", "c")]).ref, "b");
});

test("diagnostics are derived facts with plain-language details", () => {
  const d = core.connectionDiagnostics({ ...conn({ isActive: false }), lastRequestReceived: null });
  assert.deepEqual(d.map((i) => i.ok), [false, true, false]);
  assert.match(d[0].detail, /Turn the connection on/);
  const f = core.formDiagnostics({ formState: "READY", publication: { status: "published", requestCount: 2 }, lastRequestReceived: "Sep 24, 10:00" });
  assert.deepEqual(f.map((i) => i.ok), [true, true, true]);
});

test("builder guidance: builders -> Nemryn form via an embed/HTML block, never a plugin/app claim; custom/dev -> server setup", () => {
  for (const b of core.BUILDER_OPTIONS) {
    const g = core.builderGuide(b.value);
    assert.ok(g.methodLabel && g.where && g.test, b.value);
    assert.doesNotMatch(`${g.why} ${g.where}`, /plugin|app store|marketplace|one-click|install our/i, b.value);
    assert.match(g.test, /TEST/);
  }
  for (const b of ["wordpress", "wix", "squarespace", "webflow"]) {
    assert.equal(core.builderGuide(b).method, "nemryn_form");
    assert.match(core.builderGuide(b).where, /HTML|Embed|Code Block/);
  }
  assert.equal(core.builderGuide("custom").method, "existing_form");
  assert.equal(core.builderGuide("developer").method, "developer");
});

test("setup options: no prices, no paywall wording; self setup comes first", () => {
  assert.equal(core.SETUP_OPTIONS[0].key, "self");
  for (const o of core.SETUP_OPTIONS) assert.doesNotMatch(`${o.title} ${o.description}`, /\$|£|€|price|fee|per month|upgrade|paid/i);
});

test("setup-help mailto: setup context only, no ids / secrets; null when no address configured", () => {
  const input = { email: "setup@nemryn.example", organizationName: "Acme Transport", website: "https://www.acme.example", methodLabel: "Developer connection", managerLabel: "WordPress" };
  const m = core.buildSetupHelpMailto(input);
  assert.match(m, /^mailto:setup@nemryn\.example\?subject=/);
  const body = decodeURIComponent(m.split("body=")[1]);
  for (const s of ["Acme Transport", "https://www.acme.example", "Developer connection", "WordPress"]) assert.ok(body.includes(s), s);
  assert.doesNotMatch(m, /web_[A-Z0-9]|form_[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-|service|supabase/i);
  assert.equal(core.buildSetupHelpMailto({ ...input, email: "" }), null);
  assert.equal(core.buildSetupHelpMailto({ ...input, email: "not an email" }), null);
});

test("hosted link: dedicated origin preferred, existing app link otherwise", () => {
  const key = "form_0123456789abcdef0123456789abcdef";
  assert.equal(core.preferredHostedFormUrl({ requestFormOrigin: "https://request.nemryn.com", appOrigin: "https://app.nemryn.com", publicKey: key }), `https://request.nemryn.com/${key}`);
  assert.equal(core.preferredHostedFormUrl({ requestFormOrigin: "https://request.nemryn.com/", appOrigin: "https://app.nemryn.com", publicKey: key }), `https://request.nemryn.com/${key}`);
  assert.equal(core.preferredHostedFormUrl({ requestFormOrigin: null, appOrigin: "https://app.nemryn.com/", publicKey: key }), `https://app.nemryn.com/request/${key}`);
  assert.equal(core.preferredHostedFormUrl({ requestFormOrigin: "https://request.nemryn.com/extra", appOrigin: "https://app.nemryn.com", publicKey: key }), `https://app.nemryn.com/request/${key}`);
  assert.equal(core.normalizeRequestFormOrigin("javascript:alert(1)"), null);
});

test("request-form host detection is exact (port / case insensitive, no suffix tricks)", () => {
  const o = "https://request.nemryn.com";
  assert.equal(core.isRequestFormHost("request.nemryn.com", o), true);
  assert.equal(core.isRequestFormHost("REQUEST.nemryn.com:443", o), true);
  assert.equal(core.isRequestFormHost("app.nemryn.com", o), false);
  assert.equal(core.isRequestFormHost("request.nemryn.com.evil.test", o), false);
  assert.equal(core.isRequestFormHost("evil-request.nemryn.com", o), false);
  assert.equal(core.isRequestFormHost("request.nemryn.com", undefined), false);
  assert.equal(core.isRequestFormHost(null, o), false);
});

test("request-domain allowlist: only the form, its two API routes and static assets", () => {
  const key = "form_0123456789abcdef0123456789abcdef";
  assert.deepEqual(core.resolveRequestDomainRoute(`/${key}`), { kind: "form", rewrite: `/request/${key}` });
  assert.deepEqual(core.resolveRequestDomainRoute(`/${key}/`), { kind: "form", rewrite: `/request/${key}` });
  for (const p of [`/api/public-forms/${key}`, `/api/public-forms/${key}/submit`, "/_next/static/chunks/a.js", "/brand/nemryn-app-icon.svg"]) {
    assert.equal(core.resolveRequestDomainRoute(p).kind, "passthrough", p);
  }
  for (const p of ["/", "/sign-in", "/operations", "/operations/requests", "/driver", "/embed/request-form.js", `/embed/request/${key}`, `/request/${key}`,
    "/api/public-intake/website", "/api/ping", "/form_notakey", `/${key}/extra`, "/auth/confirm", "/platform", "/join/abc", "/brand/../x.svg"]) {
    assert.equal(core.resolveRequestDomainRoute(p).kind, "not_found", p);
  }
});

test("developer examples: server-side, Origin header, integration id, idempotency, error handling, acquisition; no credentials", () => {
  const ex = pkgCore.buildDeveloperExamples({ endpoint: "https://app.example.test/api/public-intake/website", integrationId: "web_ABCDEFGH2345", website: "https://www.acme.example" });
  for (const [name, code] of Object.entries(ex)) {
    assert.ok(code.includes("https://app.example.test/api/public-intake/website") || name === "nextjs", `${name}: endpoint`);
    assert.match(code, /Origin/, `${name}: Origin`);
    assert.match(code, /application\/json/, `${name}: json`);
    assert.match(code, /integrationExternalId/, `${name}: integration id`);
    assert.match(code, /idempotencyKey/, `${name}: idempotency`);
    assert.match(code, /acquisition/, `${name}: acquisition`);
    assert.doesNotMatch(code, /service_role|supabase|submit_public|rpc\(|sb_secret|sb_publishable|eyJ|api[_-]?key|organization_id/i, `${name}: no credential`);
  }
  for (const name of ["node", "nextjs", "php"]) {
    assert.match(ex[name], /429/, `${name}: handles 429`);
    assert.match(ex[name], /SERVER|server/, `${name}: server-side`);
  }
  assert.match(ex.nextjs, /NEMRYN_INTAKE_URL=https:\/\/app\.example\.test/);
  assert.match(ex.curl, /-H "Origin: https:\/\/www\.acme\.example"/);
});

test("developer package has every required section in order", () => {
  const pkg = pkgCore.buildDeveloperPackage({ endpoint: "https://app.example.test/api/public-intake/website", integrationId: "web_ABCDEFGH2345", website: "https://www.acme.example" });
  const sections = ["WHAT THIS DOES", "CONNECTION DETAILS", "REQUIRED HEADERS", "REQUEST BODY", "OPTIONAL ACQUISITION", "NODE/JAVASCRIPT EXAMPLE", "NEXT.JS EXAMPLE", "CURL EXAMPLE", "PHP EXAMPLE", "EXPECTED RESPONSE", "TESTING", "COMMON ISSUES"];
  let at = -1;
  for (const s of sections) { const i = pkg.indexOf("\n" + s); assert.ok(i > at, s); at = i; }
  for (const issue of ["not turned on", "Origin header", "Integration ID", "serviceType", "Invalid payload", "Rate limit"]) assert.ok(pkg.includes(issue), issue);
  assert.match(pkg, /Send requests from your website's server, not directly from the visitor's browser/);
  assert.match(pkg, /must send this Origin header/);
});
