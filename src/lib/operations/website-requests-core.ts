/**
 * Pure product model for Settings -> Website Requests (P1-COMM-D1) -- no runtime imports (type-only at most),
 * unit-testable under plain Node (website-requests-core.test.mjs).
 *
 * Website Requests is the customer-facing name of tenant website intake. There is ONE intake engine
 * (POST /api/public-intake/website -> submit_public_transportation_request). The connection method and the
 * "who manages your website" choice only select instructions and language; they never change what the engine
 * accepts. Nothing in this module talks about, or grants, any capability that does not exist yet: there is no
 * hosted form, no embed and no website-builder plugin in D1.
 */

// ---------------------------------------------------------------------------
// Connection status (customer wording over the EXISTING derived status -- no second state machine)
// ---------------------------------------------------------------------------
export type WebsiteRequestsStatus = "NOT_CONFIGURED" | "DISABLED" | "READY_TO_TEST" | "CONNECTED";

export const WEBSITE_REQUESTS_STATUS_LABEL: Record<WebsiteRequestsStatus, string> = {
  NOT_CONFIGURED: "Not connected",
  DISABLED: "Disabled",
  READY_TO_TEST: "Ready to test",
  CONNECTED: "Connected",
};

export const WEBSITE_REQUESTS_STATUS_EXPLANATION: Record<WebsiteRequestsStatus, string> = {
  NOT_CONFIGURED: "No website is connected yet. Connect your website to start receiving requests in Nemryn.",
  DISABLED: "Requests from your website are switched off. Turn it on when your website is ready.",
  READY_TO_TEST: "Your website is approved to send requests. Submit one test request through your website to confirm it works.",
  CONNECTED: "Nemryn has received a real request from your website. New requests appear in your Request Hub.",
};

// ---------------------------------------------------------------------------
// Connection methods
// ---------------------------------------------------------------------------
export type ConnectionMethod = "nemryn_form" | "existing_form" | "developer";
export const CONNECTION_METHOD_VALUES: readonly ConnectionMethod[] = ["nemryn_form", "existing_form", "developer"];

export interface ConnectionMethodCard {
  value: ConnectionMethod;
  title: string;
  description: string;
  action: string;
  badge?: string;
  href: string;
}

export const CONNECTION_METHOD_CARDS: ConnectionMethodCard[] = [
  {
    value: "nemryn_form",
    title: "Use a Nemryn form",
    description: "Add a ready-made transportation request form to your website.",
    action: "Set up form",
    badge: "Easiest",
    href: "/operations/settings/website-requests/form",
  },
  {
    value: "existing_form",
    title: "Connect my existing form",
    description: "Keep the transportation request form you already use.",
    action: "Connect existing form",
    href: "/operations/settings/website-requests/existing-form",
  },
  {
    value: "developer",
    title: "Developer connection",
    description: "Connect your website directly using Nemryn's website intake API.",
    action: "Developer setup",
    href: "/operations/settings/website-requests/developer",
  },
];

/** What a stored method means to the customer. NULL (a connection that predates D1) is "Existing connection" -- never guessed to be an API. */
export function connectionMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "nemryn_form":
      return "Nemryn form";
    case "existing_form":
      return "Existing form";
    case "developer":
      return "Developer connection";
    default:
      return "Existing connection";
  }
}

// ---------------------------------------------------------------------------
// Who manages your website
// ---------------------------------------------------------------------------
export type WebsiteManager = "self" | "developer" | "wordpress" | "wix" | "squarespace" | "webflow" | "other_builder" | "not_sure";

export const WEBSITE_MANAGER_OPTIONS: { value: WebsiteManager; label: string }[] = [
  { value: "self", label: "I manage it myself" },
  { value: "developer", label: "I have a developer or web agency" },
  { value: "wordpress", label: "WordPress" },
  { value: "wix", label: "Wix" },
  { value: "squarespace", label: "Squarespace" },
  { value: "webflow", label: "Webflow" },
  { value: "other_builder", label: "Other website builder" },
  { value: "not_sure", label: "I'm not sure" },
];

export function isWebsiteManager(value: unknown): value is WebsiteManager {
  return typeof value === "string" && WEBSITE_MANAGER_OPTIONS.some((option) => option.value === value);
}

export interface ManagerGuidance {
  headline: string;
  paragraphs: string[];
  /** True when a developer (or someone comfortable with website code) will most likely be needed. */
  developerLikelyNeeded: boolean;
  /** "I'm not sure": show the two next actions instead of a dead end. */
  offerNextSteps: boolean;
}

/**
 * Guidance for "Connect my existing form". Precise on purpose: it states what NEMRYN offers today (no
 * plugin, no one-click connector) instead of making claims about third-party products.
 */
export function existingFormGuidance(manager: WebsiteManager): ManagerGuidance {
  const requirement =
    "Your website sends each completed request to Nemryn from its server. Someone who can add or change code on your website needs to set this up.";
  switch (manager) {
    case "self":
      return {
        headline: "You manage your website",
        paragraphs: [
          requirement,
          "If you are comfortable adding server-side code, copy the setup instructions below. If not, a Nemryn form is the simpler route.",
        ],
        developerLikelyNeeded: false,
        offerNextSteps: false,
      };
    case "developer":
      return {
        headline: "Send the setup instructions to your developer",
        paragraphs: [requirement, "Copy the setup instructions below and send them to your developer or web agency. They contain everything needed."],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "wordpress":
      return {
        headline: "WordPress",
        paragraphs: [
          "Nemryn does not have a WordPress plugin yet, and a WordPress form does not connect to Nemryn by itself.",
          requirement,
          "Send the setup instructions to whoever maintains your WordPress site, or use a Nemryn form instead.",
        ],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "wix":
      return {
        headline: "Wix",
        paragraphs: [
          "Nemryn does not have a Wix app yet, and a Wix form does not connect to Nemryn by itself.",
          requirement,
          "Send the setup instructions to whoever manages your Wix site, or use a Nemryn form instead.",
        ],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "squarespace":
      return {
        headline: "Squarespace",
        paragraphs: [
          "Nemryn does not have a Squarespace extension yet, and a Squarespace form does not connect to Nemryn by itself.",
          requirement,
          "Send the setup instructions to whoever manages your Squarespace site, or use a Nemryn form instead.",
        ],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "webflow":
      return {
        headline: "Webflow",
        paragraphs: [
          "Nemryn does not have a Webflow connector yet, and a Webflow form does not connect to Nemryn by itself.",
          requirement,
          "Send the setup instructions to whoever manages your Webflow site, or use a Nemryn form instead.",
        ],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "other_builder":
      return {
        headline: "Another website builder",
        paragraphs: [
          "Nemryn does not have a ready-made connection for your website builder yet.",
          requirement,
          "Send the setup instructions to whoever manages your website, or use a Nemryn form instead.",
        ],
        developerLikelyNeeded: true,
        offerNextSteps: false,
      };
    case "not_sure":
      return {
        headline: "That's okay",
        paragraphs: ["Start with a Nemryn form, or send the setup instructions to whoever manages your website."],
        developerLikelyNeeded: false,
        offerNextSteps: true,
      };
  }
}

/**
 * Where to paste the embed code, per website builder (P1-COMM-D2). Precise about platform constraints and never a claim of native
 * marketplace integration: every builder below just accepts an HTML / embed block. Whether a builder runs <script> in that block
 * depends on the builder and the customer's plan, so each answer names the safe fallback (the iframe, or a link to the hosted form).
 */
export interface EmbedPlacementGuidance {
  where: string;
  limits: string | null;
}
export function embedPlacementGuidance(manager: WebsiteManager): EmbedPlacementGuidance {
  const fallback = "If your website removes the script, use the iframe version below or link to the hosted form instead.";
  switch (manager) {
    case "wordpress":
      return {
        where: "In the WordPress editor add a Custom HTML block on the page where the form should appear, then paste the embed code.",
        limits: `Some WordPress plans and user roles remove scripts from posts. ${fallback}`,
      };
    case "wix":
      return {
        where: "In the Wix editor choose Add → Embed Code → Embed HTML, choose Code, and paste the embed code.",
        limits: "Wix runs embedded code inside its own frame, so the form works but Nemryn can only see limited page details (campaign and page-level attribution may be missing).",
      };
    case "squarespace":
      return {
        where: "Add a Code Block to the page and paste the embed code (leave \"Display Source\" off).",
        limits: `Running scripts in a Code Block depends on your Squarespace plan. ${fallback}`,
      };
    case "webflow":
      return {
        where: "Add an Embed element to the page where the form should appear and paste the embed code, then publish the site.",
        limits: null,
      };
    case "developer":
      return {
        where: "Send your developer or agency the embed code: it is one small snippet to paste where the form should appear.",
        limits: null,
      };
    case "other_builder":
      return {
        where: "Find your builder's HTML, embed or custom code block, place it where the form should appear, and paste the embed code.",
        limits: fallback,
      };
    case "self":
      return {
        where: "Paste the embed code into your page's HTML where the form should appear.",
        limits: null,
      };
    case "not_sure":
      return {
        where: "Whoever manages your website will know where it goes: send them the embed code, or link to the hosted form from your site.",
        limits: null,
      };
  }
}

/** Single-string placement guidance (kept for the Nemryn-form editor's "where will this form go?" helper). */
export function nemrynFormPlacementGuidance(manager: WebsiteManager): string {
  const g = embedPlacementGuidance(manager);
  return g.limits ? `${g.where} ${g.limits}` : g.where;
}

// ---------------------------------------------------------------------------
// Publication (P1-COMM-D2): three distinct concepts -- FORM authoring state, PUBLICATION state, CONNECTION status
// ---------------------------------------------------------------------------
export type PublicationState = "NOT_PUBLISHED" | "PUBLISHED" | "DISABLED";
export const PUBLICATION_STATE_LABEL: Record<PublicationState, string> = { NOT_PUBLISHED: "Not published", PUBLISHED: "Published", DISABLED: "Disabled" };
export function derivePublicationState(publication: { status: string } | null): PublicationState {
  if (!publication) return "NOT_PUBLISHED";
  return publication.status === "published" ? "PUBLISHED" : "DISABLED";
}

export type PublishAction = "not_ready" | "publish" | "update" | "republish" | "up_to_date";
/**
 * What the operator can do next. Editing a form never changes a live publication -- only an explicit publish does.
 * `not_ready`: the (saved) form is not Ready, so it can't be published (an existing publication keeps running its snapshot).
 */
export function publishAction(
  form: { status: string; version: number } | null,
  publication: { status: string; publishedVersion: number } | null,
): PublishAction {
  if (!form || form.status !== "ready") return "not_ready";
  if (!publication) return "publish";
  if (publication.status !== "published") return "republish";
  return form.version > publication.publishedVersion ? "update" : "up_to_date";
}

/**
 * Connection status for a published form, from EXISTING semantics: Published never means Connected. Disabled / not published
 * map to the existing labels; Ready to test until the first real Request arrives through the form, then Connected.
 */
export function formConnectionStatus(publication: { status: string; requestCount: number } | null): WebsiteRequestsStatus {
  if (!publication) return "NOT_CONFIGURED";
  if (publication.status !== "published") return "DISABLED";
  return publication.requestCount > 0 ? "CONNECTED" : "READY_TO_TEST";
}

/** Explanation for a published FORM's connection status (the website wording of WEBSITE_REQUESTS_STATUS_EXPLANATION does not fit a hosted / embedded form). */
export const FORM_CONNECTION_EXPLANATION: Record<WebsiteRequestsStatus, string> = {
  NOT_CONFIGURED: "Publish your form to start receiving requests.",
  DISABLED: "The public form is turned off. New requests can't be sent through it.",
  READY_TO_TEST: "Your form is live. Send one test request through it to confirm everything works.",
  CONNECTED: "Nemryn has received a real request through your form. New requests appear in your Request Hub.",
};

export function buildHostedFormUrl(origin: string, publicKey: string): string {
  return `${origin.replace(/\/+$/, "")}/request/${publicKey}`;
}
export function buildEmbedSnippet(origin: string, publicKey: string): string {
  const o = origin.replace(/\/+$/, "");
  return [`<div data-nemryn-request-form="${publicKey}"></div>`, `<script src="${o}/embed/request-form.js" async></script>`].join("\n");
}
/** For builders that strip scripts: a plain iframe. No automatic height and no page attribution (the loader provides both). */
export function buildIframeFallback(origin: string, publicKey: string): string {
  const o = origin.replace(/\/+$/, "");
  return `<iframe src="${o}/embed/request/${publicKey}" title="Transportation request form" width="100%" height="900" style="border:0;max-width:100%" loading="lazy"></iframe>`;
}

// ---------------------------------------------------------------------------
// Nemryn form configuration
// ---------------------------------------------------------------------------
export const FORM_LIMITS = { title: 120, intro: 600, submitLabel: 40, confirmation: 400 } as const;

/** Canonical closed service list -- identical to the database CHECK, the intake allow-list and Services & Intake (asserted by the unit tests). */
export const FORM_SERVICE_VALUES = [
  "medical_appointment",
  "dialysis",
  "rehabilitation",
  "hospital_discharge",
  "recurring_care",
  "senior_medical",
  "wheelchair_transportation",
  "other",
] as const;

export const FORM_SERVICE_LABELS: Record<string, string> = {
  medical_appointment: "Medical appointments",
  dialysis: "Dialysis",
  rehabilitation: "Rehabilitation",
  hospital_discharge: "Hospital discharge",
  recurring_care: "Recurring scheduled care",
  senior_medical: "Senior medical transportation",
  wheelchair_transportation: "Wheelchair transportation",
  other: "Other",
};

export type FormStatus = "draft" | "ready";

export interface FormConfig {
  status: FormStatus;
  title: string;
  introText: string | null;
  submitLabel: string;
  confirmationMessage: string;
  /** null = every service the organization currently offers. */
  offeredServiceTypes: string[] | null;
  allowRecurring: boolean;
  requireServiceChoice: boolean;
}

export const DEFAULT_FORM_CONFIG: FormConfig = {
  status: "draft",
  title: "Request transportation",
  introText: "Tell us about the trip you need. We'll review your request and contact you to confirm the details.",
  submitLabel: "Send request",
  confirmationMessage: "Thank you. We received your request and will contact you to confirm your trip.",
  offeredServiceTypes: null,
  allowRecurring: true,
  requireServiceChoice: false,
};

/** Form state shown in Settings: independent of the connection status. */
export type FormState = "NOT_CONFIGURED" | "DRAFT" | "READY";
export const FORM_STATE_LABEL: Record<FormState, string> = { NOT_CONFIGURED: "Not configured", DRAFT: "Draft", READY: "Ready" };
export function deriveFormState(config: { status: string } | null): FormState {
  if (!config) return "NOT_CONFIGURED";
  return config.status === "ready" ? "READY" : "DRAFT";
}

/** The stable S4C formVersion for a form version number: "nemryn-form-v3". Never an internal id. */
export function formVersionLabel(version: number): string {
  const n = Number.isInteger(version) && version >= 1 ? version : 1;
  return `nemryn-form-v${n}`;
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINE_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export type FormInputResult =
  | { ok: true; value: FormConfig }
  | { ok: false; field: "title" | "introText" | "submitLabel" | "confirmationMessage" | "services" | "status"; message: string };

function cleanLine(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function cleanMultiline(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

/**
 * Validates the operator's form input BEFORE the round trip (the database re-validates authoritatively).
 * `serviceSelection` is the checked service values; `everyService` true means "everything the organization offers" (stored as null).
 */
export function validateFormInput(input: {
  status: unknown;
  title: unknown;
  introText: unknown;
  submitLabel: unknown;
  confirmationMessage: unknown;
  serviceSelection: string[];
  everyService: boolean;
  allowRecurring: boolean;
  requireServiceChoice: boolean;
}): FormInputResult {
  const title = cleanLine(input.title);
  if (title.length === 0 || title.length > FORM_LIMITS.title || CONTROL_RE.test(title)) {
    return { ok: false, field: "title", message: `Enter a headline of up to ${FORM_LIMITS.title} characters.` };
  }
  const intro = cleanMultiline(input.introText);
  if (intro.length > FORM_LIMITS.intro || CONTROL_EXCEPT_NEWLINE_RE.test(intro)) {
    return { ok: false, field: "introText", message: `Keep the introduction under ${FORM_LIMITS.intro} characters.` };
  }
  const submitLabel = cleanLine(input.submitLabel);
  if (submitLabel.length === 0 || submitLabel.length > FORM_LIMITS.submitLabel || CONTROL_RE.test(submitLabel)) {
    return { ok: false, field: "submitLabel", message: `Enter a button label of up to ${FORM_LIMITS.submitLabel} characters.` };
  }
  const confirmation = cleanMultiline(input.confirmationMessage);
  if (confirmation.length === 0 || confirmation.length > FORM_LIMITS.confirmation || CONTROL_EXCEPT_NEWLINE_RE.test(confirmation)) {
    return { ok: false, field: "confirmationMessage", message: `Enter a confirmation message of up to ${FORM_LIMITS.confirmation} characters.` };
  }
  if (input.status !== "draft" && input.status !== "ready") {
    return { ok: false, field: "status", message: "Choose Draft or Ready." };
  }
  let services: string[] | null = null;
  if (!input.everyService) {
    const unique = [...new Set(input.serviceSelection)];
    if (unique.length === 0 || unique.some((s) => !(FORM_SERVICE_VALUES as readonly string[]).includes(s))) {
      return { ok: false, field: "services", message: "Choose at least one service, or offer everything your organization provides." };
    }
    services = FORM_SERVICE_VALUES.filter((v) => unique.includes(v));
  }
  return {
    ok: true,
    value: {
      status: input.status,
      title,
      introText: intro.length > 0 ? intro : null,
      submitLabel,
      confirmationMessage: confirmation,
      offeredServiceTypes: services,
      allowRecurring: input.allowRecurring,
      requireServiceChoice: input.requireServiceChoice,
    },
  };
}

/**
 * The services the form may show RIGHT NOW: what the organization currently offers (Services & Intake is the only
 * source of truth), optionally narrowed by the form's subset. An organization that has never configured offerings
 * (empty list) has never restricted intake, so every canonical service is available -- exactly like the intake function.
 */
export function effectiveFormServices(orgServices: string[], offered: string[] | null): string[] {
  const base = orgServices.length > 0 ? FORM_SERVICE_VALUES.filter((v) => orgServices.includes(v)) : [...FORM_SERVICE_VALUES];
  return offered === null ? base : base.filter((v) => offered.includes(v));
}

/** True when the saved subset now contains a service the organization no longer offers (the form quietly shows fewer services; tell the operator). */
export function formServicesNeedAttention(orgServices: string[], offered: string[] | null): boolean {
  if (offered === null) return false;
  return effectiveFormServices(orgServices, offered).length < offered.length;
}

// ---------------------------------------------------------------------------
// Preview model (what the passenger will see) -- pure data, never submitted anywhere
// ---------------------------------------------------------------------------
export interface PreviewField {
  key: string;
  label: string;
  kind: "text" | "tel" | "email" | "date" | "time" | "select" | "radio" | "textarea" | "checkbox" | "weekdays";
  required: boolean;
  /** Shown only while the "recurring" checkbox is ticked. */
  showWhen?: "recurring";
  help?: string;
  options?: { value: string; label: string }[];
}
export interface PreviewSection {
  heading: string;
  fields: PreviewField[];
}
export interface FormPreview {
  organizationName: string;
  title: string;
  intro: string | null;
  submitLabel: string;
  confirmationMessage: string;
  sections: PreviewSection[];
  safetyNote: string;
  privacyNote: string;
  formVersion: string;
}

export function buildFormPreview(input: { organizationName: string; config: FormConfig; services: string[]; version: number }): FormPreview {
  const { config } = input;
  const serviceOptions = input.services.map((value) => ({ value, label: FORM_SERVICE_LABELS[value] ?? "Other" }));
  const trip: PreviewField[] = [];
  if (serviceOptions.length > 0) {
    trip.push({ key: "serviceType", label: "What is the trip for?", kind: "select", required: config.requireServiceChoice, options: serviceOptions });
  }
  trip.push(
    { key: "pickupDescription", label: "Pickup address", kind: "textarea", required: true },
    { key: "destinationDescription", label: "Where are you going?", kind: "textarea", required: true },
    { key: "preferredDate", label: "Preferred date", kind: "date", required: false },
    { key: "preferredTime", label: "Preferred pickup time", kind: "time", required: false },
    {
      key: "returnTripNeeded",
      label: "Do you need a ride back?",
      kind: "radio",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
      ],
    },
  );
  if (config.allowRecurring) {
    trip.push(
      { key: "recurring", label: "This trip repeats on a regular schedule", kind: "checkbox", required: false, help: "You can tell us the days and dates after you check this." },
      { key: "recurringDays", label: "Which days of the week?", kind: "weekdays", required: true, showWhen: "recurring" },
      { key: "recurringStartDate", label: "First date", kind: "date", required: true, showWhen: "recurring" },
      { key: "recurringEndDate", label: "Last date", kind: "date", required: false, showWhen: "recurring", help: "Leave blank if the rides continue until you tell us otherwise." },
      { key: "recurringTime", label: "Appointment time", kind: "time", required: false, showWhen: "recurring" },
    );
  }
  trip.push({ key: "assistanceNotes", label: "Help the passenger may need", kind: "textarea", required: false, help: "For example, mobility aids or someone to help at the door." });

  return {
    organizationName: input.organizationName,
    title: config.title,
    intro: config.introText,
    submitLabel: config.submitLabel,
    confirmationMessage: config.confirmationMessage,
    sections: [
      { heading: "About the trip", fields: trip },
      {
        heading: "About the passenger",
        fields: [{ key: "passengerName", label: "Passenger's name", kind: "text", required: false, help: "If different from the person sending this request." }],
      },
      {
        heading: "Your contact details",
        fields: [
          { key: "requesterName", label: "Your name", kind: "text", required: true },
          {
            key: "requesterRelationship",
            label: "Your relationship to the passenger",
            kind: "select",
            required: true,
            options: [
              { value: "self", label: "I am the passenger" },
              { value: "family", label: "Family member" },
              { value: "caregiver", label: "Caregiver" },
              { value: "facility_coordinator", label: "Facility coordinator" },
              { value: "other", label: "Other" },
            ],
          },
          { key: "requesterPhone", label: "Phone number", kind: "tel", required: true },
          { key: "requesterEmail", label: "Email", kind: "email", required: false },
        ],
      },
      { heading: "Anything else?", fields: [{ key: "additionalNotes", label: "Other details", kind: "textarea", required: false }] },
    ],
    safetyNote: "This form is for non-emergency transportation requests. If this is an emergency, contact your local emergency service.",
    privacyNote: "Please don't include medical record numbers or detailed medical information.",
    formVersion: formVersionLabel(input.version),
  };
}

// ---------------------------------------------------------------------------
// Developer package (copy-ready). Contains what a developer needs -- and nothing internal or secret.
// ---------------------------------------------------------------------------
export interface DeveloperPackageInput {
  endpoint: string;
  integrationId: string;
  website: string | null;
  /** Provided for Nemryn-form setups so the developer can send it as acquisition.formVersion. */
  formVersion?: string | null;
  websiteManagerLabel?: string | null;
}

/** The request body fields shared by every example (fictional values). */
const EXAMPLE_FIELDS: [string, string][] = [
  ["requesterName", "TEST Jordan Rivera"],
  ["requesterRelationship", "family"],
  ["requesterPhone", "555-0100"],
  ["pickupDescription", "123 Main St"],
  ["destinationDescription", "456 Oak Ave"],
  ["returnTripNeeded", "yes"],
];

export interface DeveloperExamples {
  node: string;
  nextjs: string;
  curl: string;
  php: string;
}

/**
 * Copy-ready, server-side examples (P1-COMM-D3). Every one: POSTs from the website's SERVER (never the visitor's browser),
 * sends JSON with an explicit Origin header (server HTTP clients do not add one), carries integrationExternalId and an
 * idempotencyKey that is created once per submission and reused on retries, handles 200 / 400 / 429 / network failure,
 * and shows the optional acquisition object. Nothing here is a credential; no internal name or identifier appears.
 */
export function buildDeveloperExamples(input: { endpoint: string; integrationId: string; website: string | null }): DeveloperExamples {
  const site = input.website ?? "https://www.your-website.example";
  const jsFields = EXAMPLE_FIELDS.map(([k]) => `    ${k}: form.${k},`).join("\n");
  const node = [
    "// Node.js 18+ -- runs on your website's SERVER, never in the visitor's browser.",
    'import { randomUUID } from "node:crypto";',
    "",
    `const NEMRYN_ENDPOINT = "${input.endpoint}";`,
    `const NEMRYN_INTEGRATION_ID = "${input.integrationId}";`,
    `const APPROVED_WEBSITE = "${site}"; // must match the approved website in Nemryn exactly`,
    "",
    "/**",
    " * Call after your own form is submitted and validated.",
    " * Create submissionId ONCE per submission and reuse it if you retry, so a retry never creates a duplicate request.",
    " */",
    "export async function sendToNemryn(form, submissionId = randomUUID(), acquisition) {",
    "  const body = {",
    "    integrationExternalId: NEMRYN_INTEGRATION_ID,",
    "    idempotencyKey: submissionId,",
    jsFields,
    "  };",
    "  if (acquisition) body.acquisition = acquisition; // optional, e.g. { utmSource: \"google\", landingPath: \"/dialysis-transportation\" }",
    "",
    "  let response;",
    "  for (let attempt = 1; ; attempt++) {",
    "    try {",
    "      response = await fetch(NEMRYN_ENDPOINT, {",
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json", Origin: APPROVED_WEBSITE },',
    "        body: JSON.stringify(body),",
    "      });",
    "      break;",
    "    } catch {",
    "      // Network problem (e.g. a dropped keep-alive connection). One immediate retry is safe: the same idempotencyKey",
    "      // never creates a second request. After that, retry later with the SAME submissionId.",
    "      if (attempt >= 2) return { ok: false, retryLater: true };",
    "    }",
    "  }",
    "  if (response.ok) return { ok: true };",
    "  if (response.status === 429) return { ok: false, retryLater: true }; // too many requests: retry later",
    "  return { ok: false, retryLater: false }; // 400: not accepted -- check the connection is on, the Origin and the fields",
    "}",
  ].join("\n");

  const nextjs = [
    "// app/api/transport-request/route.ts -- a Next.js Route Handler (runs on your server).",
    "// Your own form posts here; this handler forwards the request to Nemryn.",
    "// Set NEMRYN_INTAKE_URL, NEMRYN_INTEGRATION_ID and NEMRYN_APPROVED_WEBSITE in your server environment.",
    'import { randomUUID } from "node:crypto";',
    "",
    "export async function POST(request: Request) {",
    "  const form = await request.json();",
    "  // Validate your own form fields here before forwarding.",
    '  const idempotencyKey = typeof form.submissionId === "string" ? form.submissionId : randomUUID();',
    "",
    "  const payload = JSON.stringify({",
    "    integrationExternalId: process.env.NEMRYN_INTEGRATION_ID,",
    "    idempotencyKey,",
    EXAMPLE_FIELDS.map(([k]) => `    ${k}: form.${k},`).join("\n"),
    "    ...(form.acquisition ? { acquisition: form.acquisition } : {}), // optional",
    "  });",
    "",
    "  let nemryn: Response | false = false;",
    "  for (let attempt = 1; attempt <= 2 && !nemryn; attempt++) {",
    "    try {",
    "      nemryn = await fetch(process.env.NEMRYN_INTAKE_URL as string, {",
    '        method: "POST",',
    "        headers: {",
    '          "Content-Type": "application/json",',
    "          Origin: process.env.NEMRYN_APPROVED_WEBSITE as string, // must match the approved website in Nemryn",
    "        },",
    "        body: payload,",
    '        cache: "no-store",',
    "      });",
    "    } catch {",
    "      // Network problem (e.g. a dropped keep-alive connection): one immediate retry is safe with the same idempotencyKey.",
    "    }",
    "  }",
    "  if (!nemryn) return Response.json({ ok: false }, { status: 503 }); // still failing: ask the visitor to try again",
    "",
    "  if (nemryn.ok) return Response.json({ ok: true });",
    "  // 429 = too many requests (retry later); 400 = not accepted (check the connection is on, the Origin and the fields).",
    '  console.error("Nemryn did not accept the request", nemryn.status);',
    "  return Response.json({ ok: false }, { status: nemryn.status === 429 ? 503 : 502 });",
    "}",
    "",
    "// Environment:",
    `//   NEMRYN_INTAKE_URL=${input.endpoint}`,
    `//   NEMRYN_INTEGRATION_ID=${input.integrationId}`,
    `//   NEMRYN_APPROVED_WEBSITE=${site}`,
  ].join("\n");

  const curlBody = [
    "{",
    `    "integrationExternalId": "${input.integrationId}",`,
    '    "idempotencyKey": "3f2b9c7e-4c1d-4e8a-9a55-0d7c2e1b6f10",',
    ...EXAMPLE_FIELDS.map(([k, v]) => `    "${k}": "${v}",`),
    '    "acquisition": { "utmSource": "google", "landingPath": "/dialysis-transportation" }',
    "  }",
  ].join("\n");
  const curl = [
    "# From a terminal or your server. Use a NEW idempotencyKey for each new test request.",
    `curl -sS -X POST "${input.endpoint}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Origin: ${site}" \\`,
    '  -w "\\nHTTP %{http_code}\\n" \\',
    `  --data '${curlBody}'`,
  ].join("\n");

  const php = [
    "<?php",
    "// PHP 7.4+ with the curl extension -- runs on your website's SERVER.",
    `const NEMRYN_ENDPOINT = '${input.endpoint}';`,
    `const NEMRYN_INTEGRATION_ID = '${input.integrationId}';`,
    `const NEMRYN_APPROVED_WEBSITE = '${site}'; // must match the approved website in Nemryn exactly`,
    "",
    "// Create $submissionId ONCE per submission (e.g. bin2hex(random_bytes(16))) and reuse it on retries.",
    "function send_to_nemryn(array $form, string $submissionId, array $acquisition = []): array",
    "{",
    "    $payload = [",
    "        'integrationExternalId' => NEMRYN_INTEGRATION_ID,",
    "        'idempotencyKey' => $submissionId,",
    ...EXAMPLE_FIELDS.map(([k]) => `        '${k}' => $form['${k}'],`),
    "    ];",
    "    if (!empty($acquisition)) {",
    "        $payload['acquisition'] = $acquisition; // optional",
    "    }",
    "",
    "    $ch = curl_init(NEMRYN_ENDPOINT);",
    "    curl_setopt_array($ch, [",
    "        CURLOPT_POST => true,",
    "        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Origin: ' . NEMRYN_APPROVED_WEBSITE],",
    "        CURLOPT_POSTFIELDS => json_encode($payload),",
    "        CURLOPT_RETURNTRANSFER => true,",
    "        CURLOPT_TIMEOUT => 15,",
    "    ]);",
    "    $responseBody = curl_exec($ch);",
    "    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);",
    "    curl_close($ch);",
    "",
    "    if ($responseBody === false) {",
    "        return ['ok' => false, 'retryLater' => true]; // network problem: retry with the SAME $submissionId",
    "    }",
    "    if ($status === 200) {",
    "        return ['ok' => true];",
    "    }",
    "    // 429 = too many requests (retry later); 400 = not accepted (check the connection is on, the Origin and the fields).",
    "    return ['ok' => false, 'retryLater' => $status === 429];",
    "}",
  ].join("\n");

  return { node, nextjs, curl, php };
}

export function buildDeveloperPackage(input: DeveloperPackageInput): string {
  const site = input.website ?? "<your approved website address>";
  const examples = buildDeveloperExamples({ endpoint: input.endpoint, integrationId: input.integrationId, website: input.website });
  const lines: string[] = [
    "NEMRYN WEBSITE REQUESTS -- SETUP INSTRUCTIONS",
    "",
    "WHAT THIS DOES",
    "  When someone submits the transportation request form on your website, your website's SERVER sends that request to",
    "  Nemryn, where it appears in the operator's Request Hub as a new Pending request. Visitors never need a Nemryn account.",
    "  Send requests from your website's server, not directly from the visitor's browser: this protects your connection",
    "  setup and gives you control over validation and retries.",
    "",
    "CONNECTION DETAILS",
    `  Endpoint:            POST ${input.endpoint}`,
    `  Integration ID:      ${input.integrationId}`,
    `  Approved website:    ${site}`,
    "  Status:              the connection must be turned ON in Nemryn (Settings -> Website Requests) before requests are accepted.",
    "",
    "REQUIRED HEADERS",
    "  Content-Type: application/json",
    `  Origin: ${site}`,
    "  Your server must send this Origin header itself -- server HTTP clients do not add one automatically. Nemryn accepts",
    "  requests that identify the approved website as their source. It restricts where requests may come from; it is not a",
    "  password. Do not share any Nemryn login, database credential or service key.",
    "",
    "REQUEST BODY (JSON)",
    "  Required:",
    "    integrationExternalId   the Integration ID above",
    "    idempotencyKey          a unique value per submission (for example a UUID). Create it once and reuse it on retries:",
    "                            re-sending the same key never creates a second request.",
    "    requesterName           text, up to 200 characters",
    "    requesterRelationship   self | family | caregiver | facility_coordinator | other",
    "    requesterPhone          text, up to 50 characters",
    "    pickupDescription       text, up to 2000 characters",
    "    destinationDescription  text, up to 2000 characters",
    "    returnTripNeeded        yes | no | not_sure",
    "  Optional:",
    "    requesterEmail, passengerName (text)",
    "    preferredDate           YYYY-MM-DD",
    "    preferredTime           HH:MM",
    "    assistanceNotes, additionalNotes (text, up to 4000 characters)",
    "    serviceType             medical_appointment | dialysis | rehabilitation | hospital_discharge | recurring_care | senior_medical | wheelchair_transportation | other",
    "                            (only services the organization has enabled in Nemryn are accepted)",
    "    recurringSchedule       { daysOfWeek: [\"monday\", ...], startDate, endDate, appointmentTime, returnTripExpected }",
    "    acquisition             see below",
    "  Any other top-level field is rejected. Maximum body size 8 KB.",
    "",
    "OPTIONAL ACQUISITION (where the request came from) -- every property optional, the object itself optional",
    "  \"acquisition\": {",
    "    \"utmSource\": \"google\",  \"utmMedium\": \"cpc\",  \"utmCampaign\": \"dialysis_transport\",  \"utmContent\": \"...\",  \"utmTerm\": \"...\",",
    "    \"landingPath\": \"/dialysis-transportation\",  \"submissionPath\": \"/request-transportation\",",
    "    \"referrerHost\": \"google.com\",  \"formVersion\": \"request-v2\"",
    "  }",
    "  Send paths and a bare host only -- no full URLs, query strings or click IDs. Do not send anything about the customer as attribution.",
    "  A request is still accepted when the acquisition details are missing or unusable.",
  ];
  if (input.formVersion) {
    lines.push(`  This setup uses a Nemryn form: send formVersion "${input.formVersion}".`);
  }
  const indent = (code: string) => code.split("\n").map((l) => `  ${l}`).join("\n");
  lines.push(
    "",
    "NODE/JAVASCRIPT EXAMPLE",
    indent(examples.node),
    "",
    "NEXT.JS EXAMPLE",
    indent(examples.nextjs),
    "",
    "CURL EXAMPLE",
    indent(examples.curl),
    "",
    "PHP EXAMPLE",
    indent(examples.php),
    "",
    "EXPECTED RESPONSE",
    "  200 {\"ok\":true}   accepted -- the request is in Nemryn.",
    "  400               not accepted. Nemryn deliberately does not say why; check the items under COMMON ISSUES.",
    "  429               over the connection's limit (120 requests per rolling hour) -- wait and retry with the same idempotencyKey.",
    "",
    "TESTING",
    "  1. Make sure the connection is turned ON in Nemryn (Settings -> Website Requests).",
    "  2. Submit one request through your website with TEST in the requester name.",
    "  3. It appears in the Nemryn Request Hub as Pending, and the connection status changes to Connected.",
    "",
    "COMMON ISSUES (each returns 400 -- the response does not say which)",
    "  - Connection not turned on in Nemryn.",
    `  - Origin header missing or different from the approved website (${site}) -- scheme and www must match.`,
    "  - Integration ID does not match the one above (or the connection was removed).",
    "  - serviceType is a service the organization has not enabled in Nemryn.",
    "  - Invalid payload: a required field missing, a value outside the allowed list, an unknown field, or body over 8 KB.",
    "  - Rate limit reached (429): a connection accepts up to 120 requests per rolling hour (and a single submission can be",
    "    retried a few times) -- wait and retry with the same idempotencyKey.",
  );
  if (input.websiteManagerLabel) {
    lines.splice(2, 0, `Website managed by: ${input.websiteManagerLabel}`);
  }
  return lines.join("\n");
}
