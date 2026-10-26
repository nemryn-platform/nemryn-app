// Unit tests for the PUBLIC Nemryn Plus inquiry form core (NP-P2-S7-B) and for the real inquiry embed loader
// (public/embed/inquiry-form.js). Run with:  node --test src/lib/plus-inquiry/inquiry-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const c = await import("./inquiry-core.ts");
const opp = await import("../plus/opportunities-core.ts");

const KEY = "inq_" + "a".repeat(32);
const valid = () => ({ ...c.EMPTY_INQUIRY_VALUES, name: "Fictional Person", phone: "(404) 555-0100", inquiryType: "quote", question: "How much is a ride to dialysis?" });
const body = (over = {}) => ({ idempotencyKey: "00000000-0000-4000-8000-000000000001", configVersion: 1, name: "Fictional Person", phone: "404 555 0100", email: null, preferredReply: "either", relationship: null, inquiryType: "quote", serviceType: null, timeframe: null, question: "How much?", consentFollowup: false, consentMarketing: false, ...over });

test("kill switch: ONLY the exact value 'on' enables public inquiries (default OFF)", () => {
  assert.equal(c.inquirySubmissionsEnabled("on"), true);
  for (const v of [undefined, "", "ON", "On", "true", "1", "yes", " on", "on ", "enabled"]) assert.equal(c.inquirySubmissionsEnabled(v), false, String(v));
});

test("key namespace: inq_ + 32 lowercase hex only; Core form_ keys are never inquiry keys", () => {
  assert.equal(c.isInquiryKey(KEY), true);
  for (const k of ["form_" + "a".repeat(32), "inq_" + "A".repeat(32), "inq_" + "a".repeat(31), "inq_" + "g".repeat(32), "", null, 7]) assert.equal(c.isInquiryKey(k), false, String(k));
});

test("closed sets are identical to the Plus opportunity contract; airport_transportation is never offered", () => {
  assert.deepEqual([...c.INQUIRY_TYPES], [...opp.INQUIRY_TYPES]);
  assert.deepEqual([...c.SERVICE_TYPES], [...opp.SERVICE_TYPES]);
  for (const s of c.SERVICE_TYPES) assert.equal(c.SERVICE_LABELS[s], opp.serviceTypeLabel(s), s);
  assert.equal(c.SERVICE_TYPES.includes("airport_transportation"), false);
  assert.deepEqual(c.serviceOptionsFor(["dialysis", "airport_transportation", "teleport", "medical_appointment"]).map((o) => o.value), ["dialysis", "medical_appointment"]);
});

test("client validation mirrors the database rules", () => {
  assert.deepEqual(c.validateInquiryValues(valid(), []), {});
  assert.ok(c.validateInquiryValues({ ...valid(), name: " " }, []).name);
  assert.ok(c.validateInquiryValues({ ...valid(), name: "x".repeat(121) }, []).name);
  assert.ok(c.validateInquiryValues({ ...valid(), phone: "", email: "" }, []).phone, "phone OR email required");
  assert.deepEqual(c.validateInquiryValues({ ...valid(), phone: "", email: "pat@example.test" }, []), {});
  assert.ok(c.validateInquiryValues({ ...valid(), phone: "12" }, []).phone, "7-20 digits");
  assert.ok(c.validateInquiryValues({ ...valid(), email: "not-an-email" }, []).email);
  assert.ok(c.validateInquiryValues({ ...valid(), preferredReply: "email" }, []).preferredReply, "email reply needs an email");
  assert.ok(c.validateInquiryValues({ ...valid(), inquiryType: "" }, []).inquiryType);
  assert.ok(c.validateInquiryValues({ ...valid(), serviceType: "dialysis" }, ["medical_appointment"]).serviceType, "service must be offered");
  assert.deepEqual(c.validateInquiryValues({ ...valid(), serviceType: "dialysis" }, ["dialysis"]), {});
  assert.ok(c.validateInquiryValues({ ...valid(), question: "x".repeat(501) }, []).question);
  assert.equal(c.firstInvalidInquiryField({ question: "q", name: "n" }), "name");
});

test("phone / email rules equal the plus_contacts CHECKs", () => {
  for (const p of ["(404) 555-0100", "+1 404.555.0100", "404 555 0100 x123", "4045550100 ext. 9"]) assert.equal(c.isValidInquiryPhone(p), true, p);
  for (const p of ["555-01", "phone 404", "404#5550100", "1".repeat(21)]) assert.equal(c.isValidInquiryPhone(p), false, p);
  assert.equal(c.isValidInquiryEmail(" Pat@Example.TEST "), true);
  assert.equal(c.isValidInquiryEmail("a@b"), false);
});

test("buildInquiryBody: trimmed values, explicit nulls, consent booleans, no organization / form / status field", () => {
  const b = c.buildInquiryBody({ ...valid(), name: "  Fictional Person ", email: " ", consentFollowup: true }, { idempotencyKey: "k-12345678", configVersion: 3, acquisition: { utmSource: "news" } });
  assert.equal(b.name, "Fictional Person");
  assert.equal(b.email, null);
  assert.equal(b.consentFollowup, true);
  assert.equal(b.consentMarketing, false);
  assert.equal(b.configVersion, 3);
  assert.deepEqual(b.acquisition, { utmSource: "news" });
  for (const k of ["organizationId", "formId", "status", "contactId", "ownerId"]) assert.equal(k in b, false);
  const round = c.validateInquiryPayload(JSON.parse(JSON.stringify(b)));
  assert.equal(round.ok, true, "the browser body passes the server validator");
});

test("server validator: closed key set and types -- any forbidden key rejects the whole body", () => {
  assert.equal(c.validateInquiryPayload(body()).ok, true);
  for (const k of ["organizationId", "organization_id", "formId", "status", "contactId", "opportunityId", "ownerMembershipId", "publicKey"]) {
    assert.equal(c.validateInquiryPayload(body({ [k]: "x" })).ok, false, k);
  }
  for (const bad of [null, [], "x", 7]) assert.equal(c.validateInquiryPayload(bad).ok, false);
  const cases = [
    { idempotencyKey: "short" }, { idempotencyKey: "has space 12345" }, { configVersion: 0 }, { configVersion: "1" }, { name: "" },
    { name: "x".repeat(121) }, { phone: null, email: null }, { phone: "12" }, { email: "nope" }, { preferredReply: "fax" },
    { preferredReply: "email" }, { relationship: "boss" }, { inquiryType: "invoice" }, { serviceType: "airport_transportation" },
    { serviceType: "teleport" }, { timeframe: "tuesday 3pm" }, { question: "" }, { question: "x".repeat(501) },
    { consentFollowup: "yes" }, { acquisition: [] }, { name: "line\u0007bell" },
  ];
  for (const over of cases) assert.equal(c.validateInquiryPayload(body(over)).ok, false, JSON.stringify(over));
  const ok = c.validateInquiryPayload(body({ email: " Pat@Example.TEST ", acquisition: { utmSource: "x", gclid: "dropped" } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.email, "pat@example.test");
  assert.deepEqual(ok.value.acquisition, { utmSource: "x" }, "unknown acquisition keys are dropped, not an error");
  assert.equal(ok.value.consentFollowup, false, "consent defaults false");
});

test("status -> HTTP: uniform, minimal bodies with no ids or reasons", () => {
  const map = Object.fromEntries(["accepted", "unavailable", "form_changed", "invalid", "rate_limited", "error"].map((s) => [s, c.httpForInquiryStatus(s)]));
  assert.deepEqual(map.accepted, { status: 200, body: { ok: true } });
  assert.equal(map.unavailable.status, 404);
  assert.equal(map.form_changed.status, 409);
  assert.equal(map.invalid.status, 400);
  assert.equal(map.rate_limited.status, 429);
  assert.equal(map.error.status, 503);
  for (const r of Object.values(map)) assert.doesNotMatch(JSON.stringify(r.body), /"[a-z_]*id"\s*:|ZW\d|limit|organization|sql|threshold/i);
});

test("consent copy: two separate optional sentences; marketing never implied by follow-up; versioned", () => {
  assert.equal(c.INQUIRY_CONSENT_TEXT_VERSION, "plus-inquiry-consent-v1");
  assert.match(c.INQUIRY_COPY.consentFollowup("Fictional Org"), /^Fictional Org may follow up/);
  assert.match(c.INQUIRY_COPY.consentMarketing("Fictional Org"), /news and offers from Fictional Org/);
  assert.doesNotMatch(c.INQUIRY_COPY.consentFollowup("X"), /news|offers|marketing/i);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The REAL inquiry embed loader, run against a minimal fake browser
// ---------------------------------------------------------------------------------------------------------------------------------
const LOADER = fs.readFileSync(new URL("../../../public/embed/inquiry-form.js", import.meta.url), "utf8");
const ORIGIN = "https://app.example.test";

function fakeBrowser({ search = "", pathname = "/questions", referrer = "", hostname = "www.agency.example", containers = [KEY], storage = {} } = {}) {
  const listeners = { window: {}, document: {} };
  const posted = [];
  const created = [];
  const nodes = containers.map((k) => {
    const attrs = { "data-nemryn-inquiry-form": k };
    return { attrs, children: [], getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => { attrs[n] = v; }, appendChild(ch) { this.children.push(ch); }, dispatchEvent: () => true };
  });
  const doc = {
    currentScript: { src: ORIGIN + "/embed/inquiry-form.js" },
    readyState: "complete",
    referrer,
    getElementsByTagName: () => [],
    querySelectorAll: (sel) => (sel === "[data-nemryn-inquiry-form]" ? nodes : []),
    addEventListener: (t, f) => { (listeners.document[t] ||= []).push(f); },
    createEvent: () => ({ initCustomEvent(type, b, x, detail) { this.type = type; this.detail = detail; } }),
    createElement: () => {
      const iframe = { style: { cssText: "", height: "" }, attrs: {}, contentWindow: { postMessage: (m, o) => posted.push({ m, o }) }, setAttribute(n, v) { this.attrs[n] = v; } };
      created.push(iframe);
      return iframe;
    },
  };
  const store = { ...storage };
  const win = { location: { search, pathname, hostname }, sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, addEventListener: (t, f) => { (listeners.window[t] ||= []).push(f); } };
  win.window = win;
  new vm.Script(LOADER).runInContext(vm.createContext({ window: win, document: doc, URL, URLSearchParams, Array, Math, isFinite, Object, JSON, String, Number }));
  return { nodes, created, posted, store, win, send: (event) => (listeners.window.message || []).forEach((f) => f(event)) };
}
const msg = (type, extra = {}) => ({ source: "nemryn-inquiry-form", v: 1, type, key: KEY, ...extra });
const plain = (x) => JSON.parse(JSON.stringify(x));

test("loader: one isolated iframe per valid inq_ container; Core form_ keys and request-form containers are ignored", () => {
  const b = fakeBrowser({ containers: [KEY, "form_" + "b".repeat(32), KEY] });
  assert.equal(b.created.length, 2);
  assert.equal(b.created[0].src, `${ORIGIN}/embed/inquiry/${KEY}`);
  assert.equal(b.created[0].title, "Ask a question");
  b.win.NemrynInquiryForm.mount();
  assert.equal(b.created.length, 2, "idempotent");
});

test("loader: only OUR iframe window + the Nemryn origin + this protocol are honoured; the request-form protocol is not", () => {
  const b = fakeBrowser();
  const f = b.created[0];
  b.send({ origin: "https://evil.example", source: f.contentWindow, data: msg("resize", { height: 900 }) });
  b.send({ origin: ORIGIN, source: {}, data: msg("resize", { height: 900 }) });
  b.send({ origin: ORIGIN, source: f.contentWindow, data: { ...msg("resize", { height: 900 }), source: "nemryn-request-form" } });
  assert.equal(f.style.height, "");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: 900.2 }) });
  assert.equal(f.style.height, "901px");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: 1e9 }) });
  assert.equal(f.style.height, "6000px");
});

test("loader: context goes ONLY to the Nemryn origin, S4C-safe values only, namespaced storage only", () => {
  const b = fakeBrowser({ search: "?utm_source=google&gclid=x&email=pat@example.test", pathname: "/questions", referrer: "https://www.google.com/search?q=private" });
  b.send({ origin: ORIGIN, source: b.created[0].contentWindow, data: msg("ready") });
  assert.equal(b.posted.length, 1);
  assert.equal(b.posted[0].o, ORIGIN);
  assert.deepEqual(plain(b.posted[0].m.acquisition), { utmSource: "google", landingPath: "/questions", submissionPath: "/questions", referrerHost: "www.google.com" });
  assert.doesNotMatch(JSON.stringify(b.posted[0].m), /gclid|private|pat@/);
  assert.deepEqual(Object.keys(b.store), [c.inquiryAcquisitionStorageKey(KEY)]);
});
