// Unit tests for the PUBLIC request form core (P1-COMM-D2) and for the real embed loader (public/embed/request-form.js), which
// is executed here against a minimal fake browser. Run with:  node --test src/lib/public-forms/public-form-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const core = await import("./public-form-core.ts");
const intake = await import("../public-intake/website-intake-core.ts");
const {
  isPublicFormKey, validatePublicFormValues, firstInvalidField, buildSubmissionBody, EMPTY_PUBLIC_FORM_VALUES, acquisitionFromLocation,
  sanitizeAcquisitionContext, mergeFirstTouch, acquisitionStorageKey, isEmbedMessage, clampEmbedHeight, publicFormVersionLabel, PUBLIC_FORM_COPY,
} = core;

const KEY = "form_0123456789abcdef0123456789abcdef";
const config = { services: ["dialysis", "medical_appointment"], allowRecurring: true, requireServiceChoice: false };
const good = { ...EMPTY_PUBLIC_FORM_VALUES, pickupDescription: "1 Main St", destinationDescription: "Clinic", returnTripNeeded: "no", requesterName: "Pat", requesterRelationship: "family", requesterPhone: "(555) 010-0199" };

test("public key: opaque form_<32 hex> only", () => {
  assert.ok(isPublicFormKey(KEY));
  for (const bad of ["", "form_", "form_XYZ", KEY.toUpperCase(), KEY + "0", KEY.slice(0, -1), "web_ABCDEFGHJKLM", null, undefined, 5, "form_" + "g".repeat(32)]) assert.equal(isPublicFormKey(bad), false, String(bad));
});

test("client validation: required canonical fields, focus order, service choice, recurring, phone, email", () => {
  assert.deepEqual(validatePublicFormValues(good, config), {});
  const empty = validatePublicFormValues(EMPTY_PUBLIC_FORM_VALUES, config);
  for (const k of ["pickupDescription", "destinationDescription", "returnTripNeeded", "requesterName", "requesterRelationship", "requesterPhone"]) assert.ok(empty[k], k);
  assert.equal(empty.serviceType, undefined, "service choice is optional unless the form requires it");
  assert.equal(firstInvalidField(empty), "pickupDescription");
  assert.ok(validatePublicFormValues(good, { ...config, requireServiceChoice: true }).serviceType);
  assert.equal(validatePublicFormValues({ ...good, serviceType: "dialysis" }, { ...config, requireServiceChoice: true }).serviceType, undefined);
  assert.ok(validatePublicFormValues({ ...good, serviceType: "rehabilitation" }, config).serviceType, "a service the form does not list");
  assert.equal(validatePublicFormValues(good, { ...config, services: [], requireServiceChoice: true }).serviceType, undefined, "no services listed => no choice to make");
  assert.ok(validatePublicFormValues({ ...good, requesterPhone: "12" }, config).requesterPhone);
  assert.ok(validatePublicFormValues({ ...good, requesterEmail: "not-an-email" }, config).requesterEmail);
  const rec = { ...good, recurring: true };
  const e = validatePublicFormValues(rec, config);
  assert.ok(e.recurringDays && e.recurringStartDate);
  assert.deepEqual(validatePublicFormValues({ ...rec, recurringDays: ["monday"], recurringStartDate: "2026-10-05", recurringEndDate: "2026-10-01" }, config), { recurringEndDate: "The end date can't be before the start date." });
  assert.deepEqual(validatePublicFormValues({ ...rec, recurringDays: ["monday"], recurringStartDate: "2026-10-05" }, { ...config, allowRecurring: false }), {}, "recurring fields are ignored when the form does not allow them");
});

test("submission body == the canonical website-intake contract (validated by the real intake validator)", () => {
  const body = buildSubmissionBody({ ...good, serviceType: "dialysis", passengerName: "Sam", preferredDate: "2026-10-05", preferredTime: "09:30", assistanceNotes: "Wheelchair", additionalNotes: "Ring twice", requesterEmail: "pat@example.test" }, config, { idempotencyKey: "abc-123", acquisition: { utmSource: "google", formVersion: "nemryn-form-v2" } });
  const r = intake.validatePublicFormPayload(body);
  assert.equal(r.ok, true);
  assert.equal(r.value.requestedPassengerName, "Sam");
  assert.equal(r.value.serviceType, "dialysis");
  assert.equal(r.value.acquisition.formVersion, "nemryn-form-v2");
  assert.equal("integrationExternalId" in r.value, false);
  const rec = buildSubmissionBody({ ...good, recurring: true, recurringDays: ["wednesday", "monday"], recurringStartDate: "2026-10-05", recurringTime: "08:15" }, config, { idempotencyKey: "k", acquisition: null });
  const rr = intake.validatePublicFormPayload(rec);
  assert.equal(rr.ok, true);
  assert.deepEqual(rr.value.recurringSchedule.daysOfWeek, ["monday", "wednesday"], "canonical weekday order");
  assert.equal("recurringSchedule" in buildSubmissionBody({ ...good, recurring: true, recurringDays: ["monday"], recurringStartDate: "2026-10-05" }, { allowRecurring: false }, { idempotencyKey: "k", acquisition: null }), false);
  // blank optionals are omitted, not sent as empty strings
  const minimal = buildSubmissionBody(good, config, { idempotencyKey: "k", acquisition: null });
  for (const k of ["requesterEmail", "preferredDate", "assistanceNotes", "serviceType", "acquisition", "recurringSchedule"]) assert.equal(k in minimal, false, k);
});

test("public payload validator: a body can never name an organization, integration, passenger, state or source", () => {
  const base = buildSubmissionBody(good, config, { idempotencyKey: "k", acquisition: null });
  assert.equal(intake.validatePublicFormPayload(base).ok, true);
  for (const extra of [{ integrationExternalId: "web_ABC" }, { organizationId: "x" }, { organization_id: "x" }, { passengerId: "x" }, { state: "confirmed" }, { source: "web" }, { publicKey: KEY }, { gclid: "x" }])
    assert.equal(intake.validatePublicFormPayload({ ...base, ...extra }).ok, false, JSON.stringify(extra));
  for (const bad of [null, [], "x", 5]) assert.equal(intake.validatePublicFormPayload(bad).ok, false);
  assert.equal(intake.validatePublicFormPayload({ ...base, requesterRelationship: "cousin" }).ok, false);
  assert.equal(intake.validatePublicFormPayload({ ...base, pickupDescription: "   " }).ok, false);
});

test("acquisition from a page visit: UTM values + pathname + referrer HOSTNAME only; never a URL, query, click id or own host", () => {
  const a = acquisitionFromLocation({ search: "?utm_source=google&utm_medium=cpc&utm_campaign=dialysis_transport&utm_content=ad1&utm_term=nemt&gclid=EAIaIQ&fbclid=x&foo=bar", pathname: "/request/" + KEY, referrer: "https://www.Google.com/search?q=secret&x=1#f", ownHost: "app.example.test" });
  assert.deepEqual(a, { utmSource: "google", utmMedium: "cpc", utmCampaign: "dialysis_transport", utmContent: "ad1", utmTerm: "nemt", landingPath: "/request/" + KEY, submissionPath: "/request/" + KEY, referrerHost: "www.google.com" });
  const json = JSON.stringify(a);
  assert.doesNotMatch(json, /gclid|fbclid|EAIaIQ|secret|http|\?|#|foo|bar/);
  assert.equal(acquisitionFromLocation({ search: "", pathname: "/x", referrer: "https://app.example.test/other", ownHost: "app.example.test" }).referrerHost, undefined, "same-site referrer is not a source");
  assert.deepEqual(acquisitionFromLocation({ search: "?utm_source=%00bad&utm_medium=", pathname: "https://evil.example/x?y", referrer: "not a url" }), {});
  assert.equal(acquisitionFromLocation({ search: "?utm_source=" + "a".repeat(121), pathname: "/", referrer: "" }).utmSource, undefined);
  // agrees with the server-side sanitizer (nothing the client produces is dropped by it, and it adds nothing)
  assert.deepEqual(intake.sanitizeAcquisition(a), a);
});

test("stored / received acquisition context: closed keys, strings, bounded; first-touch is preserved, submissionPath refreshed", () => {
  assert.equal(sanitizeAcquisitionContext(null), null);
  assert.equal(sanitizeAcquisitionContext([]), null);
  assert.deepEqual(sanitizeAcquisitionContext({ utmSource: " google ", landingPath: "/a", gclid: "x", ipAddress: "1.2.3.4", userAgent: "UA", referrerHost: "Google.COM", name: "Pat", phone: "555" }), { utmSource: "google", landingPath: "/a", referrerHost: "google.com" });
  assert.deepEqual(sanitizeAcquisitionContext({ landingPath: "https://x.example/a?b", referrerHost: "http://x/y" }), null);
  const first = { utmSource: "google", landingPath: "/dialysis-transportation", referrerHost: "google.com", submissionPath: "/dialysis-transportation" };
  const later = { landingPath: "/request", submissionPath: "/request", referrerHost: "example.test" };
  assert.deepEqual(mergeFirstTouch(first, later), { ...first, submissionPath: "/request" });
  assert.deepEqual(mergeFirstTouch(null, later), later);
  assert.equal(acquisitionStorageKey(KEY), `nemryn:request-form:${KEY}:acquisition`);
});

test("formVersion label + iframe/loader protocol guards", () => {
  assert.equal(publicFormVersionLabel(3), "nemryn-form-v3");
  assert.equal(publicFormVersionLabel(0), "nemryn-form-v1");
  const ok = { source: "nemryn-request-form", v: 1, type: "resize", key: KEY, height: 500 };
  assert.ok(isEmbedMessage(ok, KEY, "resize"));
  assert.equal(isEmbedMessage({ ...ok, source: "x" }, KEY, "resize"), false);
  assert.equal(isEmbedMessage({ ...ok, v: 2 }, KEY, "resize"), false);
  assert.equal(isEmbedMessage({ ...ok, key: "form_" + "1".repeat(32) }, KEY, "resize"), false, "a message for another form");
  assert.equal(isEmbedMessage(ok, KEY, "context"), false);
  for (const bad of [null, "resize", 5, [], undefined]) assert.equal(isEmbedMessage(bad, KEY, "resize"), false);
  assert.equal(clampEmbedHeight(50), 200);
  assert.equal(clampEmbedHeight(720.2), 721);
  assert.equal(clampEmbedHeight(1e9), 6000);
  for (const bad of [NaN, Infinity, "500", null, undefined, {}]) assert.equal(clampEmbedHeight(bad), null);
});

test("passenger-facing copy: no codes, no internals, no country-specific emergency number", () => {
  const text = JSON.stringify(PUBLIC_FORM_COPY);
  assert.doesNotMatch(text, /ZW\d|postgres|supabase|rpc|rate.?limit|429|stack|911/i);
  assert.match(PUBLIC_FORM_COPY.emergency, /non-emergency.*local emergency service/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The REAL embed loader, run against a minimal fake browser
// ---------------------------------------------------------------------------------------------------------------------------------
const LOADER = fs.readFileSync(new URL("../../../public/embed/request-form.js", import.meta.url), "utf8");
const ORIGIN = "https://app.example.test";

function fakeBrowser({ search = "", pathname = "/dialysis-transportation", referrer = "", hostname = "www.tenant.example", containers = [KEY], storage = {} } = {}) {
  const listeners = { window: {}, document: {} };
  const posted = [];
  const created = [];
  const nodes = containers.map((k) => {
    const attrs = { "data-nemryn-request-form": k };
    const events = [];
    return { attrs, events, children: [], getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => { attrs[n] = v; }, appendChild(c) { this.children.push(c); }, dispatchEvent: (e) => { events.push(e); return true; } };
  });
  const doc = {
    currentScript: { src: ORIGIN + "/embed/request-form.js" },
    readyState: "complete",
    referrer,
    getElementsByTagName: () => [],
    querySelectorAll: () => nodes,
    addEventListener: (t, f) => { (listeners.document[t] ||= []).push(f); },
    createEvent: () => ({ initCustomEvent(type, b, c, detail) { this.type = type; this.detail = detail; } }),
    createElement: () => {
      const style = { cssText: "", height: "" };
      const attrs = {};
      const iframe = { style, attrs, contentWindow: { postMessage: (m, o) => posted.push({ m, o, to: "iframe" }) }, setAttribute: (n, v) => { attrs[n] = v; } };
      created.push(iframe);
      return iframe;
    },
  };
  const store = { ...storage };
  const win = {
    location: { search, pathname, hostname },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener: (t, f) => { (listeners.window[t] ||= []).push(f); },
  };
  win.window = win;
  new vm.Script(LOADER).runInContext(vm.createContext({ window: win, document: doc, URL, URLSearchParams, Array, Math, isFinite, Object, JSON, String, Number }));
  return {
    nodes, created, posted, store, win,
    send: (event) => (listeners.window.message || []).forEach((f) => f(event)),
    ready: () => (listeners.document.DOMContentLoaded || []),
  };
}
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects created inside the loader's vm context have another prototype
const msg = (type, extra = {}) => ({ source: "nemryn-request-form", v: 1, type, key: KEY, ...extra });

test("loader: mounts an isolated iframe for a valid container, ignores an invalid key, is idempotent", () => {
  const b = fakeBrowser({ containers: [KEY, "form_nope", KEY] });
  assert.equal(b.created.length, 2, "one iframe per VALID, not-yet-mounted container");
  const f = b.created[0];
  assert.equal(f.src, `${ORIGIN}/embed/request/${KEY}`);
  assert.equal(f.title, "Transportation request form");
  assert.match(f.style.cssText, /width:100%/);
  assert.match(f.style.cssText, /border:0/);
  assert.equal(b.nodes[1].children.length, 0);
  b.win.NemrynRequestForm.mount();
  assert.equal(b.created.length, 2, "mount() again does not double-mount");
});

test("loader: only messages from OUR iframe window AND the Nemryn origin are honoured; height is clamped", () => {
  const b = fakeBrowser();
  const f = b.created[0];
  b.send({ origin: "https://evil.example", source: f.contentWindow, data: msg("resize", { height: 900 }) });
  assert.equal(f.style.height, "", "wrong origin ignored");
  b.send({ origin: ORIGIN, source: {}, data: msg("resize", { height: 900 }) });
  assert.equal(f.style.height, "", "wrong source window ignored (another frame / popup)");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: { ...msg("resize", { height: 900 }), source: "other" } });
  assert.equal(f.style.height, "", "wrong protocol ignored");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: 900.4 }) });
  assert.equal(f.style.height, "901px");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: 5 }) });
  assert.equal(f.style.height, "200px");
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: 99999999 }) });
  assert.equal(f.style.height, "6000px");
  for (const bad of ["900", NaN, Infinity, null, {}]) { b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("resize", { height: bad }) }); assert.equal(f.style.height, "6000px", String(bad)); }
  b.send({ origin: ORIGIN, source: f.contentWindow, data: { ...msg("resize", { height: 300 }), key: "form_" + "2".repeat(32) } });
  assert.equal(f.style.height, "6000px", "a message naming a different form is ignored");
});

test("loader: `ready` -> context sent ONLY to the Nemryn origin (never '*'), containing S4C-safe values only", () => {
  const b = fakeBrowser({ search: "?utm_source=google&utm_medium=cpc&gclid=EAIaIQ&fbclid=zzz&email=pat@example.test", pathname: "/dialysis-transportation", referrer: "https://www.google.com/search?q=private", hostname: "www.tenant.example" });
  const f = b.created[0];
  b.send({ origin: ORIGIN, source: f.contentWindow, data: msg("ready") });
  assert.equal(b.posted.length, 1);
  const { m, o } = b.posted[0];
  assert.equal(o, ORIGIN);
  assert.notEqual(o, "*");
  assert.equal(m.type, "context");
  assert.equal(m.key, KEY);
  assert.deepEqual(plain(m.acquisition), { utmSource: "google", utmMedium: "cpc", landingPath: "/dialysis-transportation", submissionPath: "/dialysis-transportation", referrerHost: "www.google.com" });
  assert.doesNotMatch(JSON.stringify(m), /gclid|fbclid|EAIaIQ|private|email|pat@|http|\?/);
  // a `ready` from anything but the iframe gets nothing
  b.send({ origin: ORIGIN, source: {}, data: msg("ready") });
  b.send({ origin: "https://evil.example", source: f.contentWindow, data: msg("ready") });
  assert.equal(b.posted.length, 1);
});

test("loader acquisition == the shared core rules (parity), including first-touch across pages in one session", () => {
  const cases = [
    { search: "?utm_source=news&utm_term=a+b", pathname: "/a/b-c", referrer: "https://t.co/x?y=1", hostname: "www.tenant.example" },
    { search: "", pathname: "/", referrer: "", hostname: "www.tenant.example" },
    { search: "?utm_source=", pathname: "//evil", referrer: "javascript:alert(1)", hostname: "www.tenant.example" },
    { search: "?utm_campaign=" + "x".repeat(161), pathname: "/ok", referrer: "https://www.tenant.example/prev", hostname: "www.tenant.example" },
  ];
  for (const c of cases) {
    const b = fakeBrowser(c);
    b.send({ origin: ORIGIN, source: b.created[0].contentWindow, data: msg("ready") });
    const expected = acquisitionFromLocation({ search: c.search, pathname: c.pathname, referrer: c.referrer, ownHost: c.hostname });
    assert.deepEqual(plain(b.posted[0].m.acquisition), expected, JSON.stringify(c));
  }
  // first touch: page 1 (the landing) then page 2 (the request page) in the same session storage
  const p1 = fakeBrowser({ search: "?utm_source=google&utm_medium=cpc", pathname: "/dialysis-transportation", referrer: "https://www.google.com/" });
  p1.send({ origin: ORIGIN, source: p1.created[0].contentWindow, data: msg("ready") });
  const key = acquisitionStorageKey(KEY);
  assert.ok(p1.store[key]);
  const p2 = fakeBrowser({ search: "", pathname: "/request-transportation", referrer: "https://www.tenant.example/dialysis-transportation", storage: p1.store });
  p2.send({ origin: ORIGIN, source: p2.created[0].contentWindow, data: msg("ready") });
  assert.deepEqual(plain(p2.posted[0].m.acquisition), { utmSource: "google", utmMedium: "cpc", landingPath: "/dialysis-transportation", referrerHost: "www.google.com", submissionPath: "/request-transportation" });
});

test("loader storage: ONLY the namespaced acquisition key, ONLY S4C values -- no passenger data can ever be stored", () => {
  const b = fakeBrowser({ search: "?utm_source=google&name=Pat&phone=5550100&gclid=x", pathname: "/x", referrer: "https://google.com" });
  b.send({ origin: ORIGIN, source: b.created[0].contentWindow, data: msg("ready") });
  assert.deepEqual(Object.keys(b.store), [acquisitionStorageKey(KEY)]);
  const stored = JSON.parse(b.store[acquisitionStorageKey(KEY)]);
  for (const k of Object.keys(stored)) assert.ok(["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPath", "submissionPath", "referrerHost"].includes(k), k);
  assert.doesNotMatch(JSON.stringify(stored), /\bPat\b|5550100|gclid/);
  // a tampered stored value is re-sanitised, not trusted
  const t = fakeBrowser({ pathname: "/x", storage: { [acquisitionStorageKey(KEY)]: JSON.stringify({ utmSource: "ok", landingPath: "https://x.example/a?b", ipAddress: "1.2.3.4", name: "Pat" }) } });
  t.send({ origin: ORIGIN, source: t.created[0].contentWindow, data: msg("ready") });
  const acq = t.posted[0].m.acquisition;
  assert.equal(acq.utmSource, "ok");
  assert.equal("ipAddress" in acq || "name" in acq, false);
  assert.notEqual(acq.landingPath, "https://x.example/a?b");
});

test("loader: `submitted` becomes a DOM event on the container with no passenger data", () => {
  const b = fakeBrowser();
  b.send({ origin: ORIGIN, source: b.created[0].contentWindow, data: msg("submitted") });
  assert.equal(b.nodes[0].events.length, 1);
  assert.equal(b.nodes[0].events[0].type, "nemryn:request-form:submitted");
  assert.deepEqual(plain(b.nodes[0].events[0].detail), { key: KEY });
});

test("loader: no third-party origin, no cookie / localStorage use, no fetch / XHR, no '*' target", () => {
  const code = LOADER.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /document\.cookie|localStorage|indexedDB|XMLHttpRequest|fetch\(|navigator\.sendBeacon|eval\(|new Function|https?:\/\/(?!www\.)/);
  assert.doesNotMatch(code, /postMessage\([^)]*"\*"/);
});
