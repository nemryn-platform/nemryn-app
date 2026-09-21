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

/** Placement guidance for "Use a Nemryn form". The embed itself is the NEXT phase; D1 configures and previews the form only. */
export function nemrynFormPlacementGuidance(manager: WebsiteManager): string {
  const generic = "The next step will give you an embed that works with an HTML or embed block.";
  switch (manager) {
    case "wordpress":
      return `${generic} On WordPress that is typically a Custom HTML block.`;
    case "wix":
      return `${generic} On Wix that is typically an HTML embed element.`;
    case "squarespace":
      return `${generic} On Squarespace that is typically a Code or Embed block; which blocks are available depends on your plan.`;
    case "webflow":
      return `${generic} On Webflow that is typically an Embed element.`;
    case "developer":
      return `${generic} Your developer or agency will only need to paste it into a page.`;
    case "other_builder":
    case "self":
      return `${generic} Most website builders have one.`;
    case "not_sure":
      return `${generic} Whoever manages your website will know where it goes.`;
  }
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
  kind: "text" | "tel" | "email" | "date" | "time" | "select" | "radio" | "textarea" | "checkbox";
  required: boolean;
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
    trip.push({ key: "recurring", label: "This trip repeats on a regular schedule", kind: "checkbox", required: false, help: "You can tell us the days and dates after you check this." });
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
    safetyNote: "If this is an emergency, call 911.",
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

export function buildDeveloperPackage(input: DeveloperPackageInput): string {
  const site = input.website ?? "<your approved website address>";
  const lines: string[] = [
    "NEMRYN WEBSITE REQUESTS -- SETUP INSTRUCTIONS",
    "",
    "Goal: when someone submits the transportation request form on your website, your website's server sends that request to Nemryn,",
    "where it appears in the operator's Request Hub. No Nemryn account is needed for your visitors.",
    "",
    "CONNECTION",
    `  Endpoint:            POST ${input.endpoint}`,
    `  Integration ID:      ${input.integrationId}`,
    `  Approved website:    ${site}`,
    "  Content-Type:        application/json",
    `  Required header:     Origin: ${site}`,
    "                       Nemryn only accepts requests that name the approved website above. It restricts where requests may come",
    "                       from; it is not a password. Do not share any Nemryn login, database credential or service key.",
    "",
    "REQUEST BODY (JSON)",
    "  Required:",
    "    integrationExternalId   the Integration ID above",
    "    idempotencyKey          a unique value for each submission (for example a UUID). Re-sending the same key never creates a second request.",
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
    "  Any other top-level field is rejected.",
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
  lines.push(
    "",
    "EXAMPLE",
    "  {",
    `    "integrationExternalId": "${input.integrationId}",`,
    "    \"idempotencyKey\": \"3f2b9c7e-4c1d-4e8a-9a55-0d7c2e1b6f10\",",
    "    \"requesterName\": \"Jordan Rivera\",",
    "    \"requesterRelationship\": \"family\",",
    "    \"requesterPhone\": \"555-0100\",",
    "    \"pickupDescription\": \"123 Main St\",",
    "    \"destinationDescription\": \"456 Oak Ave\",",
    "    \"returnTripNeeded\": \"yes\",",
    "    \"acquisition\": { \"utmSource\": \"google\", \"landingPath\": \"/dialysis-transportation\" }",
    "  }",
    "",
    "RESPONSE",
    "  200 {\"ok\":true}   accepted.   400 or 429   not accepted (the response never says why).",
    "",
    "EXAMPLE SERVER CONFIGURATION (names are examples; use your own)",
    "  REQUEST_INTAKE_MODE=platform",
    `  PLATFORM_INTAKE_URL=${input.endpoint}`,
    `  PLATFORM_INTAKE_INTEGRATION_ID=${input.integrationId}`,
    "",
    "TEST",
    "  1. Ask the Nemryn account owner to turn the connection on.",
    "  2. Submit one clearly labelled test request through your website.",
    "  3. It appears in the Nemryn Request Hub and the connection status changes to Connected.",
  );
  if (input.websiteManagerLabel) {
    lines.splice(2, 0, `Website managed by: ${input.websiteManagerLabel}`);
  }
  return lines.join("\n");
}
