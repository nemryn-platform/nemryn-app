// NP-P2-S5-S3C -- printable estimates & quotes (ZD-224) and the optional follow-up task offer (ZD-225). Run with:
//
//   node --test src/lib/plus/quotes-print-followup.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const q = await import("./quotes-core.ts");

const src = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const PRINT_PAGE = "src/app/quote-print/[quoteId]/page.tsx";
const TOOLBAR = "src/components/growth/QuotePrintToolbar.tsx";
const CONTROLS = "src/components/growth/QuoteDraftControls.tsx";
const PANEL = "src/components/growth/QuotesPanel.tsx";

const zeroCharges = { baseCents: 0, mileageCents: 0, waitCents: 0, extraStopsCents: 0, mobilityAssistanceCents: 0, escortCents: 0, returnLegCents: 0, otherCents: 0, otherLabel: null };
const input = (over = {}) => ({
  ...zeroCharges,
  baseCents: 7500,
  mileageCents: 1250,
  kind: "quote",
  quoteNumber: 7,
  status: "sent",
  isExpired: false,
  serviceLabel: "Dialysis",
  roundTrip: true,
  distanceMiles: 12.5,
  discountCents: 500,
  // deliberately NOT base + mileage - discount: the print view must show the STORED total
  totalCents: 8249,
  currency: "USD",
  validUntil: "2026-11-02",
  createdDate: "2026-10-19",
  sentDate: "2026-10-19",
  respondedDate: null,
  termsNote: "Payable on the day of travel.",
  customerName: "Fictional Person",
  successor: null,
  ...over,
});

test("quoteChargeLines: only non-zero lines, editor order, formatted from cents; other uses its label", () => {
  assert.deepEqual(q.quoteChargeLines({ ...zeroCharges }), []);
  assert.deepEqual(q.quoteChargeLines({ ...zeroCharges, escortCents: 2000, baseCents: 1, otherCents: 999, otherLabel: "Stair chair" }), [
    { label: "Base transportation", amount: "$0.01" },
    { label: "Escort / attendant", amount: "$20.00" },
    { label: "Other: Stair chair", amount: "$9.99" },
  ]);
  assert.deepEqual(q.quoteChargeLines({ ...zeroCharges, otherCents: 100 }), [{ label: "Other charge", amount: "$1.00" }]);
});

test("quotePrintModel: stored total (never recalculated), discount, details, reference, footer", () => {
  const m = q.quotePrintModel(input());
  assert.equal(m.total, "$82.49");
  assert.equal(m.discount, "$5.00");
  assert.equal(m.reference, "Quote 7");
  assert.equal(m.documentTitle, "Quote");
  assert.equal(m.currency, "USD");
  assert.deepEqual(m.lines.map((l) => l.label), ["Base transportation", "Mileage charge"]);
  assert.deepEqual(
    m.details.map((d) => [d.label, d.value]),
    [["Date", "Oct 19, 2026"], ["Valid until", "Nov 2, 2026"], ["Shared with the customer", "Oct 19, 2026"], ["Service", "Dialysis"], ["Round trip", "Yes"], ["Estimated miles", "12.5 mi"]],
  );
  assert.equal(m.footer, "This is a quote, not an invoice. Prices in US dollars.");
  assert.equal(q.quotePrintModel(input({ kind: "estimate", quoteNumber: 3 })).footer, "This is an estimate, not an invoice. Prices in US dollars.");
  assert.equal(q.quotePrintModel(input({ kind: "estimate", quoteNumber: 3 })).reference, "Estimate 3");
  const plain = q.quotePrintModel(input({ discountCents: 0, distanceMiles: null, sentDate: null, roundTrip: false, termsNote: "   " }));
  assert.equal(plain.discount, null);
  assert.equal(plain.termsNote, null);
  assert.deepEqual(plain.details.map((d) => d.label), ["Date", "Valid until", "Service", "Round trip"]);
  assert.equal(plain.details.find((d) => d.label === "Round trip").value, "No, one way");
});

test("quotePrintModel: customer display name only -- the model has no contact, address or opportunity fields", () => {
  const m = q.quotePrintModel(input());
  assert.equal(m.customerName, "Fictional Person");
  assert.deepEqual(Object.keys(m).sort(), ["banner", "currency", "customerName", "details", "discount", "documentTitle", "footer", "lines", "reference", "statusLabel", "termsNote", "total"]);
});

test("print status labels: Draft, Sent, Accepted, Declined, Superseded, Withdrawn, and the derived Expired", () => {
  const cases = [
    ["draft", false, "Draft"], ["sent", false, "Sent"], ["sent", true, "Expired"], ["accepted", false, "Accepted"],
    ["declined", false, "Declined"], ["superseded", false, "Superseded"], ["withdrawn", false, "Withdrawn"], ["bogus", false, "Unknown"],
  ];
  for (const [status, expired, label] of cases) assert.equal(q.quotePrintStatusLabel(status, expired), label, status);
});

test("print banners: every non-current status is marked; a current sent quote has none", () => {
  assert.equal(q.quotePrintBanner(input()), null);
  const b = (over) => q.quotePrintBanner(input(over));
  assert.deepEqual(b({ status: "draft", sentDate: null }), { tone: "caution", heading: "DRAFT", text: "Not yet given to the customer. The prices may still change." });
  assert.deepEqual(b({ isExpired: true }), { tone: "caution", heading: "EXPIRED", text: "The valid-until date (Nov 2, 2026) has passed." });
  assert.deepEqual(b({ status: "accepted", respondedDate: "2026-10-20" }), { tone: "record", heading: "ACCEPTED", text: "Customer acceptance recorded by staff on Oct 20, 2026." });
  assert.deepEqual(b({ status: "declined", respondedDate: "2026-10-21" }), { tone: "caution", heading: "DECLINED", text: "Customer decline recorded by staff on Oct 21, 2026." });
  assert.equal(b({ status: "superseded", successor: { kind: "quote", quoteNumber: 8 } }).text, "Replaced by Quote 8. This version is no longer the current price.");
  assert.equal(b({ status: "superseded" }).text, "Replaced by a revision. This version is no longer the current price.");
  assert.deepEqual(b({ status: "withdrawn" }), { tone: "caution", heading: "WITHDRAWN", text: "No longer offered." });
  assert.equal(b({ status: "bogus" }).heading, "NOT CURRENT");
  // staff-recorded wording only: never "online", "signed" or "verified"
  for (const s of ["accepted", "declined"]) assert.doesNotMatch(b({ status: s, respondedDate: "2026-10-20" }).text, /online|signed|verified|e-sign/i);
});

test("quotePrintHref: the staff route, never under a public prefix", () => {
  assert.equal(q.quotePrintHref("0f9c3a52-6d55-4b41-9a51-7f4e8e2a1b10"), "/quote-print/0f9c3a52-6d55-4b41-9a51-7f4e8e2a1b10");
});

test("follow-up title: references the quote; do-not-contact gets an internal review title, never call / email", () => {
  assert.equal(q.followUpTaskTitle("Quote 7", false), "Follow up on Quote 7");
  assert.equal(q.followUpTaskTitle("Estimate 2", true), "Review Estimate 2 internally");
  assert.doesNotMatch(q.followUpTaskTitle("Quote 7", true), /call|email|text|message|contact/i);
  assert.ok(q.followUpTaskTitle("Quote 9999999", false).length <= 200);
  assert.match(q.FOLLOW_UP_DNC_REMINDER, /internal reminder only/);
  assert.match(q.FOLLOW_UP_OFFER_TEXT, /optional/);
});

test("openTasksNotice: none for zero / invalid; singular and plural otherwise", () => {
  assert.equal(q.openTasksNotice(0), null);
  assert.equal(q.openTasksNotice(-1), null);
  assert.equal(q.openTasksNotice(Number.NaN), null);
  assert.equal(q.openTasksNotice(1), "This opportunity already has 1 open task. Check it before adding another.");
  assert.equal(q.openTasksNotice(3), "This opportunity already has 3 open tasks. Check them before adding another.");
});

// ---------------------------------------------------------------------------------------------------------------------
// Source rules
// ---------------------------------------------------------------------------------------------------------------------

test("print route: staff-only (requirePlusAccess before any read), dynamic, notFound on unknown / foreign, no service role", () => {
  const page = src(PRINT_PAGE);
  assert.match(page, /await requirePlusAccess\(/);
  assert.ok(page.indexOf("requirePlusAccess(") < page.indexOf("getQuote("), "authorization precedes the quote read");
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /if \(!q\) notFound\(\)/);
  assert.match(page, /if \(!isUuid\(quoteId\)\) notFound\(\)/);
  assert.match(page, /robots: \{ index: false/);
  assert.doesNotMatch(page, /generateStaticParams|export const revalidate|service-role-server|createServiceRoleSupabaseClient|SUPABASE_SERVICE/);
  // the read helpers it uses run on the per-request (cookie) client only
  for (const lib of ["src/lib/plus/quotes.ts", "src/lib/operations/organization-settings.ts"]) assert.doesNotMatch(src(lib), /service-role-server|createServiceRoleSupabaseClient/, lib);
  // customer display name only: no contact phone / email / address of the customer
  assert.doesNotMatch(page, /contactPhone|contactEmail|contact_phone|contact_email|passenger|appointment/i);
});

test("print route: not under a public or embeddable prefix; no other quote-print routes", () => {
  const root = new URL("../../../src/app/", import.meta.url).pathname;
  assert.ok(existsSync(join(root, "quote-print", "[quoteId]", "page.tsx")));
  for (const publicDir of ["(public)", "request", "embed", "api"]) {
    const walk = (dir) =>
      existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : [];
    for (const f of walk(join(root, publicDir))) assert.doesNotMatch(readFileSync(f, "utf8"), /quote-print|plus_get_quote|getQuote\(/, f);
  }
  assert.deepEqual(readdirSync(join(root, "quote-print")), ["[quoteId]"]);
  assert.deepEqual(readdirSync(join(root, "quote-print", "[quoteId]")), ["page.tsx"]);
});

test("print toolbar: browser print only, hidden on paper; no email, share, mailto or upload", () => {
  const t = src(TOOLBAR);
  assert.match(t, /print:hidden/);
  assert.match(t, /window\.print\(\)/);
  assert.match(t, /Print \/ Save PDF/);
  for (const f of [TOOLBAR, PRINT_PAGE]) assert.doesNotMatch(src(f), /mailto:|navigator\.share|sms:|fetch\(|sendEmail|resend|upload/i, f);
});

test("print view adds no branding fields: only the organization name and existing business contact fields", () => {
  const page = src(PRINT_PAGE);
  assert.match(page, /getOrganizationSettings\(context\.organizationId\)/);
  assert.doesNotMatch(page, /logo|brand|letterhead|primary_color|accent/i);
});

test("follow-up: offered only after a confirmed Mark sent, created only by an explicit save in the existing TaskDialog", () => {
  const c = src(CONTROLS);
  assert.match(c, /onDone=\{sentDone\}/);
  assert.match(c, /setOffer\(reference\)/);
  assert.match(c, /data-testid="quote-follow-up-open"/);
  // the existing task dialog and action -- no new task RPC or direct insert from the quote controls
  assert.match(c, /<TaskDialog/);
  assert.doesNotMatch(c, /createTaskAction|\.rpc\(|from\("plus_tasks"\)/);
  // no default due date; the assignee defaults to the signed-in person who marked it sent
  assert.match(c, /dueDate: "", dueTime: "", assigneeHandle: followUp\.selfHandle \?\? ""/);
  // response / revise / withdraw flows never offer or touch tasks
  for (const d of ["ResponseDialog", "ReviseDialog", "WithdrawSentDialog"]) {
    const line = c.split("\n").find((l) => l.includes(`<${d}`)) ?? "";
    assert.ok(line, d);
  }
  const lifecycle = src("src/components/growth/QuoteLifecycleDialogs.tsx") + src("src/app/operations/growth/quotes/actions.ts");
  assert.doesNotMatch(lifecycle, /plus_tasks|plus_create_task|plus_complete_task|plus_cancel_task|createTaskAction/);
});

test("follow-up: no migration -- the quote lifecycle SQL never writes tasks", () => {
  const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((f) => f.includes("plus_quote"))) {
    assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /insert into public\.plus_tasks|update public\.plus_tasks/i, f);
  }
});

test("quote panel: Print link per row opens a new tab with noopener; follow-up data read only for writers", () => {
  const p = src(PANEL);
  assert.match(p, /href=\{quotePrintHref\(q\.id\)\} target="_blank" rel="noopener"/);
  assert.match(p, /if \(canWrite && groups && \(groups\.draft \|\| groups\.sent\)\)/);
  const dir = src("src/components/growth/QuotesDirectoryTable.tsx");
  assert.match(dir, /href=\{quotePrintHref\(row\.id\)\}/);
  assert.match(dir, /rel="noopener"/);
});
