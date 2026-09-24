/**
 * Website Requests setup experience (P1-COMM-D3). Pure, no runtime imports -- unit-tested with node:test.
 *
 * Everything here is DERIVED from facts Nemryn already stores (connection on/off, website, chosen method, requests
 * received; form status; publication status / requests). Nothing is persisted for display, and no second state machine
 * is introduced: setup progress, the summary and the diagnostics are presentation over the existing D1/D2 statuses.
 */

// ---------------------------------------------------------------------------
// Setup progress
// ---------------------------------------------------------------------------
export interface SetupStep {
  key: string;
  /** The fact, shown in the checklist ("Connection turned on"). */
  label: string;
  /** What the operator does next when this is the first open step ("Turn on the connection"). */
  action: string;
  done: boolean;
}
export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  /** The first step that is not done (null when complete). */
  next: SetupStep | null;
  complete: boolean;
}

function progress(steps: SetupStep[]): SetupProgress {
  const next = steps.find((s) => !s.done) ?? null;
  return { steps, doneCount: steps.filter((s) => s.done).length, next, complete: next === null };
}

export interface ConnectionFacts {
  website: string | null;
  isActive: boolean;
  requestCount: number;
  connectionMethod: string | null;
}

/**
 * Website connection (existing form / developer). "Connected" needs the connection to be ON *and* a real request received,
 * so a connection that worked once but is now turned off is never shown as complete.
 */
export function connectionSetupProgress(c: ConnectionFacts): SetupProgress {
  const received = c.requestCount > 0;
  return progress([
    { key: "website", label: "Website added", action: "Add your website address", done: !!c.website },
    { key: "method", label: "Setup method chosen", action: "Choose a setup method (Connect my existing form or Developer connection)", done: !!c.connectionMethod },
    { key: "on", label: "Connection turned on", action: "Turn on the connection", done: c.isActive },
    { key: "test", label: "Test request received", action: "Send one test request from your website", done: received },
    { key: "connected", label: "Connected", action: "Turn on the connection", done: c.isActive && received },
  ]);
}

export interface FormFacts {
  /** deriveFormState(): NOT_CONFIGURED | DRAFT | READY */
  formState: string;
  publication: { status: string; requestCount: number } | null;
}

/**
 * Nemryn form. "Added to your website or shared" can't be observed directly, so it is marked done only once a request has
 * arrived through the form (which proves it is reachable) -- never assumed.
 */
export function formSetupProgress(f: FormFacts): SetupProgress {
  const published = f.publication?.status === "published";
  const received = (f.publication?.requestCount ?? 0) > 0;
  return progress([
    { key: "configured", label: "Form configured", action: "Set up your form", done: f.formState !== "NOT_CONFIGURED" },
    { key: "ready", label: "Marked Ready", action: "Mark your form Ready", done: f.formState === "READY" || !!f.publication },
    { key: "published", label: "Published", action: "Publish your form", done: published },
    { key: "shared", label: "Added to your website or shared", action: "Add the form to your website or share its link", done: published && received },
    { key: "test", label: "Test request received", action: "Send one test request through your form", done: published && received },
  ]);
}

// ---------------------------------------------------------------------------
// Connection summary (top of Website Requests)
// ---------------------------------------------------------------------------
export type SummaryStatus = "NOT_CONFIGURED" | "DISABLED" | "READY_TO_TEST" | "CONNECTED";
const STATUS_RANK: Record<SummaryStatus, number> = { CONNECTED: 3, READY_TO_TEST: 2, DISABLED: 1, NOT_CONFIGURED: 0 };

export interface SummaryCandidate {
  kind: "connection" | "form";
  /** Anchor/handle the Manage action points at. */
  ref: string;
  website: string | null;
  methodLabel: string;
  status: SummaryStatus;
  lastRequestReceived: string | null;
  progress: SetupProgress;
}

/** The setup the operator most likely cares about: the most advanced one (Connected > Ready to test > Off). */
export function pickPrimarySetup(candidates: SummaryCandidate[]): SummaryCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0];
}

// ---------------------------------------------------------------------------
// Diagnostics (derived only -- never a live probe that could create a Request)
// ---------------------------------------------------------------------------
export interface DiagnosticItem {
  label: string;
  ok: boolean;
  detail: string;
}

export function connectionDiagnostics(c: ConnectionFacts & { lastRequestReceived: string | null }): DiagnosticItem[] {
  return [
    {
      label: "Connection is on",
      ok: c.isActive,
      detail: c.isActive ? "Your website can send requests." : "Turn the connection on — until then every request from your website is refused.",
    },
    {
      label: "Approved website set",
      ok: !!c.website,
      detail: c.website ? `Nemryn accepts requests that identify ${c.website} as their source.` : "Add the website address that will send requests.",
    },
    {
      label: "Request received",
      ok: c.requestCount > 0,
      detail: c.requestCount > 0 ? `Last request: ${c.lastRequestReceived ?? "recently"}.` : "No request has arrived yet. Submit one test request from your website.",
    },
  ];
}

export function formDiagnostics(f: FormFacts & { lastRequestReceived: string | null }): DiagnosticItem[] {
  const published = f.publication?.status === "published";
  return [
    {
      label: "Form ready",
      ok: f.formState === "READY" || !!f.publication,
      detail: f.formState === "READY" || f.publication ? "Your form is set up." : "Finish your form and mark it Ready.",
    },
    {
      label: "Public form available",
      ok: published,
      detail: published ? "The hosted form and the embed code work." : "Publish your form so passengers can use it.",
    },
    {
      label: "Request received",
      ok: (f.publication?.requestCount ?? 0) > 0,
      detail: (f.publication?.requestCount ?? 0) > 0 ? `Last request: ${f.lastRequestReceived ?? "recently"}.` : "No request has arrived yet. Send one test request through your form.",
    },
  ];
}

// ---------------------------------------------------------------------------
// "Which setup should I use?" -- guidance per website builder (no plugin / native app is claimed anywhere)
// ---------------------------------------------------------------------------
export type Builder = "wordpress" | "wix" | "squarespace" | "webflow" | "custom" | "developer" | "not_sure";
export const BUILDER_OPTIONS: { value: Builder; label: string }[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "wix", label: "Wix" },
  { value: "squarespace", label: "Squarespace" },
  { value: "webflow", label: "Webflow" },
  { value: "custom", label: "Custom website" },
  { value: "developer", label: "Developer or agency" },
  { value: "not_sure", label: "Not sure" },
];

export interface BuilderGuide {
  method: "nemryn_form" | "existing_form" | "developer";
  methodLabel: string;
  why: string;
  where: string;
  test: string;
}

const TEST_STEP = "Submit one request with TEST in the requester name, then check that it appears in your Request Hub.";

export function builderGuide(builder: Builder): BuilderGuide {
  switch (builder) {
    case "wordpress":
      return { method: "nemryn_form", methodLabel: "Use a Nemryn form", why: "No code needed.", where: "Add a Custom HTML block to the page and paste the embed code. If your plan removes scripts, use the iframe code or link to the hosted form.", test: TEST_STEP };
    case "wix":
      return { method: "nemryn_form", methodLabel: "Use a Nemryn form", why: "No code needed.", where: "Choose Add → Embed Code → Embed HTML, pick Code, and paste the embed code.", test: TEST_STEP };
    case "squarespace":
      return { method: "nemryn_form", methodLabel: "Use a Nemryn form", why: "No code needed.", where: "Add a Code Block to the page and paste the embed code. If scripts are not allowed on your plan, use the iframe code or link to the hosted form.", test: TEST_STEP };
    case "webflow":
      return { method: "nemryn_form", methodLabel: "Use a Nemryn form", why: "No code needed.", where: "Add an Embed element where the form should appear, paste the embed code, then publish your site.", test: TEST_STEP };
    case "custom":
      return { method: "existing_form", methodLabel: "Connect my existing form", why: "Keep the form you already have.", where: "Whoever maintains the site adds a few lines of server code that send each completed request to Nemryn. Send them the setup instructions.", test: TEST_STEP };
    case "developer":
      return { method: "developer", methodLabel: "Developer connection", why: "Your developer connects your website directly.", where: "Send your developer the setup instructions — they include copy-ready examples.", test: TEST_STEP };
    case "not_sure":
      return { method: "nemryn_form", methodLabel: "Use a Nemryn form", why: "It is the easiest and works on almost any website — you can also just share the link.", where: "Share the hosted form link, or send the embed code to whoever manages your website.", test: TEST_STEP };
  }
}

// ---------------------------------------------------------------------------
// Getting set up: self / assisted / done-for-you. Positioning only -- no prices, no billing, never a paywall.
// ---------------------------------------------------------------------------
export const SETUP_OPTIONS: { key: "self" | "assisted" | "done_for_you"; title: string; description: string }[] = [
  { key: "self", title: "Set it up yourself", description: "Everything on this page is included. Most teams are live in minutes with a Nemryn form." },
  { key: "assisted", title: "Assisted setup", description: "We walk you or your developer through connecting your website." },
  { key: "done_for_you", title: "Done-for-you setup", description: "We connect your website for you, working with your website provider." },
];

/**
 * "Request setup help" handoff: a mailto with useful SETUP context only -- organization, website, method, who manages the
 * website. Never passenger data, never an Integration ID or any other technical identifier. Returns null when no support
 * address is configured for this deployment.
 */
export function buildSetupHelpMailto(input: {
  email: string | null | undefined;
  organizationName: string;
  website: string | null;
  methodLabel: string | null;
  managerLabel: string | null;
}): string | null {
  const email = input.email?.trim();
  if (!email || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return null;
  const subject = `Website Requests setup help — ${input.organizationName}`;
  const body = [
    "Hi Nemryn team,",
    "",
    "We'd like help setting up Website Requests.",
    "",
    `Organization: ${input.organizationName}`,
    `Website: ${input.website ?? "not added yet"}`,
    `Setup method: ${input.methodLabel ?? "not chosen yet"}`,
    `Website managed by: ${input.managerLabel ?? "not specified"}`,
    "",
    "Best time to reach us:",
  ].join("\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------
// Hosted form domain (request.<domain>)
// ---------------------------------------------------------------------------
export const PUBLIC_FORM_KEY_RE = /^form_[0-9a-f]{32}$/;

/** A configured origin (e.g. https://request.nemryn.com) without a path, or null when unset / invalid. */
export function normalizeRequestFormOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The link operators copy. With a dedicated request-form origin configured: `<origin>/<key>`; otherwise the existing
 * `<app origin>/request/<key>` (which keeps working either way).
 */
export function preferredHostedFormUrl(input: { requestFormOrigin: string | null; appOrigin: string; publicKey: string }): string {
  const dedicated = normalizeRequestFormOrigin(input.requestFormOrigin);
  if (dedicated) return `${dedicated}/${input.publicKey}`;
  return `${input.appOrigin.replace(/\/+$/, "")}/request/${input.publicKey}`;
}

/** True when the request's host is the dedicated request-form host (port-insensitive, case-insensitive). */
export function isRequestFormHost(host: string | null | undefined, requestFormOrigin: string | null | undefined): boolean {
  const origin = normalizeRequestFormOrigin(requestFormOrigin);
  if (!origin || !host) return false;
  const want = new URL(origin).hostname.toLowerCase();
  const got = host.toLowerCase().split(",")[0].trim().replace(/:\d+$/, "");
  return got === want;
}

export type RequestDomainRoute =
  | { kind: "form"; rewrite: string }
  | { kind: "passthrough" }
  | { kind: "not_found" };

/**
 * Strict allowlist for the request-form host: the hosted form, the two public form API routes it calls, and Next's own
 * static assets. Everything else -- sign-in, operations, driver, embed, the website intake API, any unknown path -- is a
 * neutral 404 on this host.
 */
export function resolveRequestDomainRoute(pathname: string): RequestDomainRoute {
  const p = pathname.replace(/\/+$/, "") || "/";
  const formMatch = /^\/(form_[0-9a-f]{32})$/.exec(p);
  if (formMatch) return { kind: "form", rewrite: `/request/${formMatch[1]}` };
  if (/^\/api\/public-forms\/form_[0-9a-f]{32}(\/submit)?$/.test(p)) return { kind: "passthrough" };
  if (p.startsWith("/_next/static/") || p.startsWith("/_next/image") || p === "/favicon.ico") return { kind: "passthrough" };
  // Public brand images only (the tab icon and the restrained "Powered by Nemryn" mark).
  if (/^\/brand\/[a-z0-9-]+\.(svg|png)$/.test(p)) return { kind: "passthrough" };
  return { kind: "not_found" };
}
