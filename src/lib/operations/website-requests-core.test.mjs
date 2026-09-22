// Focused unit tests for the pure Website Requests product model (P1-COMM-D1).
import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./website-requests-core.ts");
const { SERVICE_OFFERING_OPTIONS } = await import("./organization-services-core.ts");
const { SERVICE_TYPE_VALUES } = await import("../public-intake/website-intake-core.ts");
const { deriveWebsiteIntegrationStatus } = await import("./website-integration-core.ts");
const { sanitizeAcquisition } = await import("../public-intake/website-intake-core.ts");

const {
  WEBSITE_REQUESTS_STATUS_LABEL, WEBSITE_REQUESTS_STATUS_EXPLANATION, CONNECTION_METHOD_CARDS, connectionMethodLabel, WEBSITE_MANAGER_OPTIONS,
  existingFormGuidance, nemrynFormPlacementGuidance, embedPlacementGuidance, derivePublicationState, publishAction, formConnectionStatus, buildHostedFormUrl, buildEmbedSnippet, buildIframeFallback, FORM_SERVICE_VALUES, FORM_LIMITS, DEFAULT_FORM_CONFIG, deriveFormState, formVersionLabel,
  validateFormInput, effectiveFormServices, formServicesNeedAttention, buildFormPreview, buildDeveloperPackage, isWebsiteManager,
} = core;

test("status wording maps the EXISTING derived status (no second state machine)", () => {
  assert.deepEqual(WEBSITE_REQUESTS_STATUS_LABEL, { NOT_CONFIGURED: "Not connected", DISABLED: "Disabled", READY_TO_TEST: "Ready to test", CONNECTED: "Connected" });
  assert.equal(deriveWebsiteIntegrationStatus(null), "NOT_CONFIGURED");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: false, requestCount: 5 }), "DISABLED");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: true, requestCount: 0 }), "READY_TO_TEST");
  assert.equal(deriveWebsiteIntegrationStatus({ isActive: true, requestCount: 1 }), "CONNECTED");
  for (const key of Object.keys(WEBSITE_REQUESTS_STATUS_LABEL)) assert.ok(WEBSITE_REQUESTS_STATUS_EXPLANATION[key].length > 20);
});

test("three connection methods with the documented copy; developer details are not exposed on the cards", () => {
  assert.deepEqual(CONNECTION_METHOD_CARDS.map((c) => c.title), ["Use a Nemryn form", "Connect my existing form", "Developer connection"]);
  assert.equal(CONNECTION_METHOD_CARDS[0].badge, "Easiest");
  assert.deepEqual(CONNECTION_METHOD_CARDS.map((c) => c.action), ["Set up form", "Connect existing form", "Developer setup"]);
  for (const card of CONNECTION_METHOD_CARDS.slice(0, 2)) assert.doesNotMatch(`${card.title} ${card.description}`, /API|endpoint|Origin|server-to-server|RPC|Supabase/i);
});

test("a connection that predates D1 is labelled 'Existing connection' -- never guessed to be an API", () => {
  assert.equal(connectionMethodLabel(null), "Existing connection");
  assert.equal(connectionMethodLabel(undefined), "Existing connection");
  assert.equal(connectionMethodLabel("nemryn_form"), "Nemryn form");
  assert.equal(connectionMethodLabel("existing_form"), "Existing form");
  assert.equal(connectionMethodLabel("developer"), "Developer connection");
  assert.doesNotMatch(connectionMethodLabel(null), /API/i);
});

test("who manages your website: the eight documented options, all recognised", () => {
  assert.deepEqual(WEBSITE_MANAGER_OPTIONS.map((o) => o.label), ["I manage it myself", "I have a developer or web agency", "WordPress", "Wix", "Squarespace", "Webflow", "Other website builder", "I'm not sure"]);
  for (const o of WEBSITE_MANAGER_OPTIONS) assert.ok(isWebsiteManager(o.value));
  assert.equal(isWebsiteManager("drupal"), false);
});

test("existing-form guidance is precise: no claim of a plugin / one-click connector that does not exist", () => {
  for (const { value } of WEBSITE_MANAGER_OPTIONS) {
    const g = existingFormGuidance(value);
    const text = `${g.headline} ${g.paragraphs.join(" ")}`;
    assert.ok(g.paragraphs.length >= 1);
    assert.doesNotMatch(text, /one-click|automatic(ally)? connect|install the (Nemryn )?(plugin|app)|works out of the box/i, value);
  }
  for (const v of ["wordpress", "wix", "squarespace", "webflow", "other_builder"]) {
    const g = existingFormGuidance(v);
    assert.match(g.paragraphs.join(" "), /does not have a|do(es)? not connect to Nemryn by itself|Nemryn does not have/i, v);
    assert.equal(g.developerLikelyNeeded, true, v);
    assert.match(g.paragraphs.join(" "), /Nemryn form/, v);
  }
  assert.match(existingFormGuidance("developer").headline, /Send the setup instructions to your developer/);
});

test("'I'm not sure' never dead-ends: it offers both next steps", () => {
  const g = existingFormGuidance("not_sure");
  assert.equal(g.offerNextSteps, true);
  assert.match(g.paragraphs.join(" "), /Start with a Nemryn form, or send the setup instructions to whoever manages your website/);
  for (const other of WEBSITE_MANAGER_OPTIONS.filter((o) => o.value !== "not_sure")) assert.equal(existingFormGuidance(other.value).offerNextSteps, false);
});

test("embed placement guidance: concrete, precise about platform limits, never a native-integration / plugin claim", () => {
  for (const { value } of WEBSITE_MANAGER_OPTIONS) {
    const g = embedPlacementGuidance(value);
    assert.ok(g.where.length > 20, value);
    const t = `${g.where} ${g.limits ?? ""} ${nemrynFormPlacementGuidance(value)}`;
    assert.doesNotMatch(t, /plugin|app store|marketplace|one-click|automatically connects|certified|official integration/i, value);
  }
  assert.match(embedPlacementGuidance("wordpress").where, /Custom HTML block/);
  assert.match(embedPlacementGuidance("wix").where, /Embed HTML/);
  assert.match(embedPlacementGuidance("wix").limits, /own frame/);
  assert.match(embedPlacementGuidance("squarespace").where, /Code Block/);
  assert.match(embedPlacementGuidance("squarespace").limits, /depends on your Squarespace plan/);
  assert.match(embedPlacementGuidance("webflow").where, /Embed element/);
  // builders that may strip scripts always name the fallback
  for (const m of ["wordpress", "squarespace", "other_builder"]) assert.match(embedPlacementGuidance(m).limits, /iframe version|hosted form/i, m);
});

test("publication state, publish action and connection status are three separate concepts", () => {
  assert.equal(derivePublicationState(null), "NOT_PUBLISHED");
  assert.equal(derivePublicationState({ status: "published" }), "PUBLISHED");
  assert.equal(derivePublicationState({ status: "disabled" }), "DISABLED");
  assert.equal(publishAction(null, null), "not_ready");
  assert.equal(publishAction({ status: "draft", version: 1 }, null), "not_ready");
  assert.equal(publishAction({ status: "ready", version: 1 }, null), "publish");
  assert.equal(publishAction({ status: "ready", version: 3 }, { status: "published", publishedVersion: 3 }), "up_to_date");
  assert.equal(publishAction({ status: "ready", version: 4 }, { status: "published", publishedVersion: 3 }), "update");
  assert.equal(publishAction({ status: "ready", version: 3 }, { status: "disabled", publishedVersion: 3 }), "republish");
  // editing back to Draft never un-publishes: the action is just not_ready, the publication is untouched
  assert.equal(publishAction({ status: "draft", version: 5 }, { status: "published", publishedVersion: 3 }), "not_ready");
  // Published is NOT Connected
  assert.equal(formConnectionStatus(null), "NOT_CONFIGURED");
  assert.equal(formConnectionStatus({ status: "published", requestCount: 0 }), "READY_TO_TEST");
  assert.equal(formConnectionStatus({ status: "published", requestCount: 1 }), "CONNECTED");
  assert.equal(formConnectionStatus({ status: "disabled", requestCount: 9 }), "DISABLED");
});

test("hosted URL / embed snippet / iframe fallback: opaque key only, no credentials, no internal ids", () => {
  const key = "form_0123456789abcdef0123456789abcdef";
  assert.equal(buildHostedFormUrl("https://app.example.test/", key), "https://app.example.test/request/" + key);
  const snippet = buildEmbedSnippet("https://app.example.test", key);
  assert.equal(snippet, `<div data-nemryn-request-form="${key}"></div>\n<script src="https://app.example.test/embed/request-form.js" async></script>`);
  const iframe = buildIframeFallback("https://app.example.test", key);
  assert.match(iframe, /^<iframe src="https:\/\/app\.example\.test\/embed\/request\/form_[0-9a-f]{32}"/);
  for (const t of [snippet, iframe]) assert.doesNotMatch(t, /supabase|service_role|eyJ|sb_|integration|web_[A-Z0-9]{6}|[0-9a-f]{8}-[0-9a-f]{4}-/i);
});


test("service list parity: form, Services & Intake and the intake allow-list are the same closed set", () => {
  assert.deepEqual([...FORM_SERVICE_VALUES], SERVICE_OFFERING_OPTIONS.map((o) => o.value));
  assert.deepEqual([...FORM_SERVICE_VALUES], [...SERVICE_TYPE_VALUES]);
  for (const o of SERVICE_OFFERING_OPTIONS) assert.equal(core.FORM_SERVICE_LABELS[o.value], o.label);
});

test("form state is independent of connection status; version label is stable and safe", () => {
  assert.equal(deriveFormState(null), "NOT_CONFIGURED");
  assert.equal(deriveFormState({ status: "draft" }), "DRAFT");
  assert.equal(deriveFormState({ status: "ready" }), "READY");
  assert.equal(formVersionLabel(1), "nemryn-form-v1");
  assert.equal(formVersionLabel(12), "nemryn-form-v12");
  assert.equal(formVersionLabel(0), "nemryn-form-v1");
  assert.equal(formVersionLabel(2.5), "nemryn-form-v1");
  // the S4C acquisition sanitiser accepts it unchanged (no internal ids as formVersion)
  assert.equal(sanitizeAcquisition({ formVersion: formVersionLabel(7) }).formVersion, "nemryn-form-v7");
});

test("form validation: bounds, trimming, status, services", () => {
  const base = { status: "draft", title: "  Request transportation ", introText: "  Hello  ", submitLabel: " Send ", confirmationMessage: " Thanks. ", serviceSelection: [], everyService: true, allowRecurring: true, requireServiceChoice: false };
  const ok = validateFormInput(base);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { status: "draft", title: "Request transportation", introText: "Hello", submitLabel: "Send", confirmationMessage: "Thanks.", offeredServiceTypes: null, allowRecurring: true, requireServiceChoice: false });
  assert.equal(validateFormInput({ ...base, introText: "   " }).value.introText, null);
  assert.equal(validateFormInput({ ...base, title: "" }).field, "title");
  assert.equal(validateFormInput({ ...base, title: "t".repeat(FORM_LIMITS.title + 1) }).field, "title");
  assert.equal(validateFormInput({ ...base, title: "a\tb" }).field, "title");
  assert.equal(validateFormInput({ ...base, submitLabel: "s".repeat(FORM_LIMITS.submitLabel + 1) }).field, "submitLabel");
  assert.equal(validateFormInput({ ...base, confirmationMessage: "" }).field, "confirmationMessage");
  assert.equal(validateFormInput({ ...base, introText: "i".repeat(FORM_LIMITS.intro + 1) }).field, "introText");
  assert.equal(validateFormInput({ ...base, status: "published" }).field, "status");
  assert.equal(validateFormInput({ ...base, confirmationMessage: "Line one\nLine two" }).ok, true);
  assert.equal(validateFormInput({ ...base, everyService: false, serviceSelection: [] }).field, "services");
  assert.equal(validateFormInput({ ...base, everyService: false, serviceSelection: ["bogus"] }).field, "services");
  assert.deepEqual(validateFormInput({ ...base, everyService: false, serviceSelection: ["other", "dialysis", "dialysis"] }).value.offeredServiceTypes, ["dialysis", "other"]);
});

test("services: Services & Intake is the only truth; the form only narrows it", () => {
  assert.deepEqual(effectiveFormServices(["dialysis", "other"], null), ["dialysis", "other"]);
  assert.deepEqual(effectiveFormServices(["dialysis", "other"], ["dialysis"]), ["dialysis"]);
  assert.deepEqual(effectiveFormServices(["dialysis"], ["dialysis", "wheelchair_transportation"]), ["dialysis"]); // a disabled service disappears
  assert.deepEqual(effectiveFormServices([], null), [...FORM_SERVICE_VALUES]); // never configured => intake never restricted
  assert.deepEqual(effectiveFormServices([], ["other"]), ["other"]);
  assert.equal(formServicesNeedAttention(["dialysis"], ["dialysis", "wheelchair_transportation"]), true);
  assert.equal(formServicesNeedAttention(["dialysis", "other"], ["dialysis"]), false);
  assert.equal(formServicesNeedAttention(["dialysis"], null), false);
});

test("preview: canonical fields only; required fields cannot be hidden; services and copy reflect the config", () => {
  const p = buildFormPreview({ organizationName: "Acme Transport", config: { ...DEFAULT_FORM_CONFIG, allowRecurring: false, requireServiceChoice: true }, services: ["dialysis", "other"], version: 4 });
  const fields = p.sections.flatMap((s) => s.fields);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  for (const key of ["requesterName", "requesterRelationship", "requesterPhone", "pickupDescription", "destinationDescription", "returnTripNeeded"]) {
    assert.ok(byKey[key], key);
    assert.equal(byKey[key].required, true, key);
  }
  assert.equal(byKey.serviceType.required, true);
  assert.deepEqual(byKey.serviceType.options.map((o) => o.value), ["dialysis", "other"]);
  assert.equal(byKey.recurring, undefined);
  assert.equal(p.formVersion, "nemryn-form-v4");
  assert.equal(p.submitLabel, "Send request");
  const withRecurring = buildFormPreview({ organizationName: "A", config: DEFAULT_FORM_CONFIG, services: [], version: 1 });
  assert.ok(withRecurring.sections.flatMap((s) => s.fields).some((f) => f.key === "recurring"));
  assert.equal(withRecurring.sections.flatMap((s) => s.fields).some((f) => f.key === "serviceType"), false);
  // every preview field key exists in the canonical intake payload
  const allowed = new Set(["serviceType", "pickupDescription", "destinationDescription", "preferredDate", "preferredTime", "returnTripNeeded", "recurring", "assistanceNotes", "passengerName", "requesterName", "requesterRelationship", "requesterPhone", "requesterEmail", "additionalNotes", "recurringDays", "recurringStartDate", "recurringEndDate", "recurringTime"]);
  for (const f of fields) assert.ok(allowed.has(f.key), f.key);
});

test("preview copy makes no operational claims (emergency / guaranteed / ambulance / Medicaid / wheelchair capability)", () => {
  const p = buildFormPreview({ organizationName: "Acme", config: DEFAULT_FORM_CONFIG, services: [...FORM_SERVICE_VALUES], version: 1 });
  const text = JSON.stringify({ t: p.title, i: p.intro, c: p.confirmationMessage, s: p.submitLabel });
  assert.doesNotMatch(text, /guarantee|ambulance|emergency service|medicaid|24\/7|available now|we will pick you up/i);
  assert.match(p.safetyNote, /non-emergency.*local emergency service/);
});

test("developer package: required technical content, and no secrets / internal ids / RPC names", () => {
  const pkg = buildDeveloperPackage({ endpoint: "https://app.example.test/api/public-intake/website", integrationId: "web_ABCDEFGH2345", website: "https://www.acme.example", formVersion: "nemryn-form-v2", websiteManagerLabel: "WordPress" });
  for (const needle of ["POST https://app.example.test/api/public-intake/website", "web_ABCDEFGH2345", "Origin: https://www.acme.example", "idempotencyKey", "acquisition", "utmSource", "formVersion \"nemryn-form-v2\"", "returnTripNeeded", "requesterRelationship", "TEST", "WordPress"]) {
    assert.ok(pkg.includes(needle), needle);
  }
  assert.doesNotMatch(pkg, /service_role|supabase|submit_public|rpc\(|sb_secret|eyJ|api[_-]?key/i);
  const withoutExample = pkg.replace("3f2b9c7e-4c1d-4e8a-9a55-0d7c2e1b6f10", "");
  assert.doesNotMatch(withoutExample, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(buildDeveloperPackage({ endpoint: "https://x.test/api", integrationId: "web_X", website: null }), /undefined|null/);
});
