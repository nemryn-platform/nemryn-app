// NP-P2-S5-S2 -- estimates & quotes pure rules. Run with:
//
//   node --test src/lib/plus/quotes-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const q = await import("./quotes-core.ts");
const opp = await import("./opportunities-core.ts");

const TODAY = "2026-10-19";
const base = () => ({ ...q.emptyQuoteForm("dialysis"), validUntil: "2026-11-02" });

test("parseMoneyToCents: exact decimal text -> integer cents (no floating point)", () => {
  const cases = [
    ["75", 7500], ["75.00", 7500], ["75.5", 7550], ["0.29", 29], ["0.01", 1], [".5", 50], ["$1,234.56", 123456],
    ["  12  ", 1200], ["", 0], ["0", 0], ["100000.00", 10000000], ["1,000", 100000], ["0.07", 7], ["19.99", 1999],
  ];
  for (const [raw, cents] of cases) assert.deepEqual(q.parseMoneyToCents(raw), { ok: true, cents }, raw);
  // the classic float trap: 0.29 * 100 = 28.999999999999996, 1.005 * 100 = 100.49999999999999
  assert.equal(q.parseMoneyToCents("4.35").cents, 435);
  assert.equal(q.parseMoneyToCents("1.10").cents, 110);
});

test("parseMoneyToCents: refuses more than two decimals, negatives, junk, bad separators and amounts over $100,000.00", () => {
  for (const raw of ["1.005", "-5", "abc", "1,23", "12,3456", "1.2.3", "1e3", "Infinity", "NaN", "100000.01", "1000000", "99999999999999999999", "$-1", "12 34", "0x10"]) {
    const r = q.parseMoneyToCents(raw);
    assert.equal(r.ok, false, raw);
    assert.ok(r.error.length > 0, raw);
  }
});

test("formatCents / centsToInput", () => {
  assert.equal(q.formatCents(0), "$0.00");
  assert.equal(q.formatCents(5), "$0.05");
  assert.equal(q.formatCents(123456), "$1,234.56");
  assert.equal(q.formatCents(10000000), "$100,000.00");
  assert.equal(q.centsToInput(0), "");
  assert.equal(q.centsToInput(7550), "75.50");
  assert.equal(q.centsToInput(5), "0.05");
  for (const c of [1, 29, 435, 7500, 123456, 9999999]) assert.equal(q.parseMoneyToCents(q.centsToInput(c)).cents, c, String(c));
});

test("validateQuoteForm: totals are the integer sum of the eight charges minus the discount", () => {
  const r = q.validateQuoteForm({ ...base(), base: "100", mileage: "25.50", wait: "15", extraStops: "5", mobilityAssistance: "20", escort: "10", returnLeg: "90", other: "7.50", otherLabel: "Fictional toll", discount: "12.50" }, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.totals, { subtotalCents: 27300, discountCents: 1250, totalCents: 26050 });
  assert.deepEqual(r.value.charges, { base: 10000, mileage: 2550, wait: 1500, extraStops: 500, mobilityAssistance: 2000, escort: 1000, returnLeg: 9000, other: 750 });
  assert.equal(r.value.serviceType, "dialysis");
  assert.equal(r.value.otherLabel, "Fictional toll");
  const exact = q.validateQuoteForm({ ...base(), base: "3.33", mileage: "3.33", wait: "3.34" }, TODAY);
  assert.equal(exact.totals.totalCents, 1000);
});

test("validateQuoteForm: discount greater than the charges is refused; equal is allowed (total 0)", () => {
  const over = q.validateQuoteForm({ ...base(), base: "10", discount: "10.01" }, TODAY);
  assert.equal(over.ok, false);
  assert.match(over.errors.discount, /more than the charges/);
  const equal = q.validateQuoteForm({ ...base(), base: "10", discount: "10" }, TODAY);
  assert.equal(equal.ok, true);
  assert.equal(equal.totals.totalCents, 0);
});

test("validateQuoteForm: field-level errors (kind, service incl. airport, miles, other label, terms, validity)", () => {
  const e = (patch) => {
    const r = q.validateQuoteForm({ ...base(), ...patch }, TODAY);
    assert.equal(r.ok, false, JSON.stringify(patch));
    return r.errors;
  };
  assert.ok(e({ kind: "invoice" }).kind);
  assert.ok(e({ serviceType: "airport_transportation" }).serviceType);
  assert.ok(e({ serviceType: "Dialysis" }).serviceType);
  assert.ok(e({ roundTrip: "maybe" }).roundTrip);
  assert.ok(e({ distanceMiles: "12.34" }).distanceMiles);
  assert.ok(e({ distanceMiles: "-1" }).distanceMiles);
  assert.ok(e({ distanceMiles: "100000" }).distanceMiles);
  assert.ok(e({ other: "5" }).otherLabel);
  assert.ok(e({ otherLabel: "Toll" }).otherLabel);
  assert.ok(e({ other: "5", otherLabel: "x".repeat(61) }).otherLabel);
  assert.ok(e({ termsNote: "t".repeat(501) }).termsNote);
  assert.ok(e({ validUntil: "" }).validUntil);
  assert.ok(e({ validUntil: "2026-02-30" }).validUntil);
  assert.ok(e({ validUntil: "2026-10-18" }).validUntil);
  assert.ok(e({ base: "1.005" }).base);
  assert.equal(q.validateQuoteForm({ ...base(), validUntil: TODAY }, TODAY).ok, true, "today itself is allowed");
  assert.equal(q.validateQuoteForm({ ...base(), distanceMiles: "12.5" }, TODAY).value.distanceMiles, 12.5);
  assert.equal(q.validateQuoteForm({ ...base(), serviceType: "" }, TODAY).value.serviceType, null);
});

test("emptyQuoteForm: suggests the opportunity's own Plus service; no default validity (OD-Q10 open); never airport", () => {
  assert.equal(q.emptyQuoteForm("wheelchair_transportation").serviceType, "wheelchair_transportation");
  assert.equal(q.emptyQuoteForm(null).serviceType, "");
  assert.equal(q.emptyQuoteForm("airport_transportation").serviceType, "");
  assert.equal(q.emptyQuoteForm("dialysis").validUntil, "");
});

test("the quote service set is exactly the eight Plus opportunity services (no airport)", () => {
  assert.deepEqual([...q.QUOTE_SERVICE_TYPES], [...opp.SERVICE_TYPES]);
  assert.ok(!q.QUOTE_SERVICE_TYPES.includes("airport_transportation"));
});

test("status labels: derived expiry shows Expired only for a sent quote; no stored Expired status", () => {
  assert.equal(q.quoteStatusLabel("sent", true), "Expired");
  assert.equal(q.quoteStatusTone("sent", true), "warning");
  assert.equal(q.quoteStatusLabel("sent", false), "Sent");
  assert.equal(q.quoteStatusLabel("draft", true), "Draft");
  assert.equal(q.quoteStatusLabel("superseded", false), "Replaced by a revision");
  assert.ok(!q.QUOTE_STATUSES.includes("expired"));
  assert.equal(q.quoteReference("estimate", 7), "Estimate 7");
});

test("groupQuotes: one active draft, one current sent, the rest history (newest first)", () => {
  const rows = [
    { id: "a", status: "withdrawn", createdAt: "2026-10-01T00:00:00Z" },
    { id: "b", status: "sent", createdAt: "2026-10-02T00:00:00Z" },
    { id: "c", status: "superseded", createdAt: "2026-10-03T00:00:00Z" },
    { id: "d", status: "draft", createdAt: "2026-10-04T00:00:00Z" },
    { id: "e", status: "accepted", createdAt: "2026-10-05T00:00:00Z" },
  ];
  const g = q.groupQuotes(rows);
  assert.equal(g.draft.id, "d");
  assert.equal(g.sent.id, "b");
  assert.deepEqual(g.history.map((r) => r.id), ["e", "c", "a"]);
  assert.deepEqual(q.groupQuotes([]), { draft: null, sent: null, history: [] });
});

test("quoteErrorMessage: plain words for every code; never SQL or constraint text", () => {
  for (const [code, reason] of [["ZW003"], ["ZW004", "draft_exists"], ["ZW004", "quote_not_draft"], ["ZW004", "opportunity_closed"], ["ZW004", "x"], ["ZW006"], ["ZW006", "contact_not_active"], ["ZW001"], ["ZW002"], [undefined], ["23505", "plus_quotes_one_draft_per_opportunity_idx"]]) {
    const m = q.quoteErrorMessage(code, reason);
    assert.ok(m.length > 10);
    assert.doesNotMatch(m, /plus_|_idx|constraint|duplicate key|ZW0/i);
  }
  assert.match(q.quoteErrorMessage("ZW004", "draft_exists"), /already has a draft/);
  assert.match(q.quoteErrorMessage("ZW003"), /changed this draft/);
});

test("isQuoteKey mirrors the database key shape", () => {
  assert.equal(q.isQuoteKey("quote-0b9b5d1e-6a1e-4a8e-9b51-0d9f1b8c2a11"), true);
  assert.equal(q.isQuoteKey("short"), false);
  assert.equal(q.isQuoteKey("has spaces in it"), false);
  assert.equal(q.isQuoteKey(42), false);
});

test("copy: never calls a quote an invoice / bill / payment request, and reminds staff not to record medical details", () => {
  assert.match(q.QUOTE_NOT_INVOICE_NOTE, /not invoices/);
  assert.match(q.QUOTE_PRIVACY_HELP, /medical/);
  const src = readFileSync(new URL("./quotes-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Math\.round|parseFloat|toFixed/, "no floating-point rounding of money (only integer cents arithmetic)");
});

test("server actions: re-check access, organization binding and write capability; server validation; no client total; per-request client only", () => {
  const src = readFileSync(new URL("../../app/operations/growth/quotes/actions.ts", import.meta.url), "utf8");
  assert.match(src, /^"use server";/);
  assert.match(src, /requirePlusAccess\(pathname\)/);
  assert.match(src, /text\(formData, "organizationId"\) !== context\.organizationId/);
  assert.match(src, /canWriteGrowth\(plus\.state, plus\.capability\)/);
  assert.equal((src.match(/validateQuoteForm\(values, today\)/g) ?? []).length, 2, "create and update both validate on the server");
  assert.match(src, /localDateKeyOf\(Date\.now\(\), guard\.context\.organizationTimezone\)/, "today is the organization-local date");
  assert.doesNotMatch(src, /p_total|totalCents:\s*parsed/, "the client total is never sent");
  assert.doesNotMatch(src, /service[_-]?role|createAdminClient|SUPABASE_SERVICE/i, "no service-role bypass");
  assert.match(src, /createServerSupabaseClient\(\)/);
  assert.match(src, /p_organization_id: guard\.context\.organizationId/, "the organization comes from the session, never the form");
  assert.match(src, /isQuoteKey\(key\)/, "create requires the client's stable idempotency key");
  assert.match(src, /p_expected_updated_at: expected/, "edits and withdrawals carry the opened version");
  // the S2 draft withdrawal stays draft-only (no reason); the S3B sent withdrawal is a separate action with a reason
  assert.match(src, /current\.status !== "draft"/);
  assert.match(src, /p_reason: null/);
  assert.match(src, /validateSentWithdrawReason\(/);
  // NP-P2-S5-S3B lifecycle: the existing RPCs only; the acknowledgment is only ever what the person ticked
  assert.match(src, /rpc\("plus_mark_quote_sent"/);
  assert.match(src, /p_dnc_acknowledged: parseAcknowledgment\(formData\.get\("dncAcknowledged"\)\)/);
  assert.match(src, /rpc\("plus_record_quote_response"/);
  assert.match(src, /rpc\("plus_revise_quote"/);
  assert.doesNotMatch(src, /p_dnc_acknowledged: true/, "never a hard-coded acknowledgment");
});

test("UI boundaries: lifecycle controls (S3B) but no print, send, email / SMS or invoice; read-only users get no write controls", () => {
  const controls = readFileSync(new URL("../../components/growth/QuoteDraftControls.tsx", import.meta.url), "utf8");
  const dialogs = readFileSync(new URL("../../components/growth/QuoteLifecycleDialogs.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/growth/QuotesPanel.tsx", import.meta.url), "utf8");
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const src of [controls, dialogs, panel]) {
    assert.doesNotMatch(code(src), /Print|PDF|Send to customer|Send email|Send SMS|\binvoice\b|mailto:|sms:/);
  }
  assert.match(code(controls), /Mark sent/);
  assert.match(code(controls), /Record accepted/);
  assert.match(code(controls), /Revise/);
  assert.match(panel, /showControls = canWrite &&/, "write controls only for Plus writers on an open opportunity");
  const page = readFileSync(new URL("../../app/operations/growth/pipeline/[opportunityId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<QuotesPanel[\s\S]*?canWrite=\{canWrite && open\}[\s\S]*?contactDoNotContact=\{o\.contactDoNotContact\}/);
  // one key per intended draft, kept across an ambiguous failure / reload
  assert.match(controls, /nemryn\.plus\.quote\.create\./);
  assert.match(controls, /sessionStorage\.setItem\(storageKey, idempotencyKey\)/);
});

test("OD-Q12 migration: fails safely on existing duplicates, partial unique indexes, supersede BEFORE send", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261019100000_plus_quotes_single_active.sql", import.meta.url), "utf8");
  assert.match(sql, /od_q12_preflight_failed/);
  assert.doesNotMatch(sql, /\bdelete from\b|\btruncate\b/i, "never repairs data");
  assert.match(sql, /create unique index plus_quotes_one_draft_per_opportunity_idx\s+on public\.plus_quotes \(organization_id, opportunity_id\) where status = 'draft'/);
  assert.match(sql, /create unique index plus_quotes_one_sent_per_opportunity_idx\s+on public\.plus_quotes \(organization_id, opportunity_id\) where status = 'sent'/);
  const send = sql.slice(sql.indexOf("create or replace function public.plus_mark_quote_sent"));
  assert.ok(send.indexOf("set status = 'superseded'") < send.indexOf("set status = 'sent'"), "the predecessor is superseded first");
  assert.doesNotMatch(sql, /drop function/i, "CREATE OR REPLACE keeps signatures and grants");
});

// ---------------------------------------------------------------------------------------------------------------------
// NP-P2-S5-S3A -- organization-wide directory
// ---------------------------------------------------------------------------------------------------------------------

test("parseDirectoryParams: safe defaults; unknown status / sort / page fall back; search trimmed and bounded", () => {
  assert.deepEqual(q.parseDirectoryParams({}), { search: "", status: "all", sort: "newest", page: 1 });
  assert.deepEqual(q.parseDirectoryParams({ q: "  Pat  ", status: "expired", sort: "valid_until", page: "3" }), { search: "Pat", status: "expired", sort: "valid_until", page: 3 });
  for (const status of ["Draft", "expired_soon", "' or 1=1", ""]) assert.equal(q.parseDirectoryParams({ status }).status, "all", status);
  for (const sort of ["random", "NEWEST", "created_at desc"]) assert.equal(q.parseDirectoryParams({ sort }).sort, "newest", sort);
  for (const page of ["0", "-2", "abc", ""]) assert.equal(q.parseDirectoryParams({ page }).page, 1, page);
  assert.equal(q.parseDirectoryParams({ page: "999999999" }).page, 4001, "capped at the database's max offset");
  assert.equal(q.parseDirectoryParams({ q: "x".repeat(500) }).search.length, 200);
  assert.equal(q.parseDirectoryParams({ q: ["first", "second"] }).search, "first");
});

test("directory statuses mirror the database contract (derived expired; no stored Expired status)", () => {
  assert.deepEqual([...q.DIRECTORY_STATUSES], ["all", "draft", "sent", "accepted", "declined", "withdrawn", "superseded", "expired"]);
  assert.deepEqual([...q.DIRECTORY_SORTS], ["newest", "oldest", "valid_until", "number"]);
  const sql = readFileSync(new URL("../../../supabase/migrations/20261020100000_plus_quotes_directory.sql", import.meta.url), "utf8");
  assert.match(sql, /v_status not in \('all', 'draft', 'sent', 'accepted', 'declined', 'withdrawn', 'superseded', 'expired'\)/);
  assert.match(sql, /v_sort not in \('newest', 'oldest', 'valid_until', 'number'\)/);
  assert.ok(!q.QUOTE_STATUSES.includes("expired"));
});

test("directoryHref / directoryRange / directoryPageCount", () => {
  const p = { search: "Pat & Co", status: "sent", sort: "number", page: 2 };
  assert.equal(q.directoryHref(p), "/operations/growth/quotes?q=Pat+%26+Co&status=sent&sort=number&page=2");
  assert.equal(q.directoryHref(p, { page: 1, status: "all", sort: "newest", search: "" }), "/operations/growth/quotes");
  assert.deepEqual(q.directoryRange(1), { limit: 25, offset: 0 });
  assert.deepEqual(q.directoryRange(3), { limit: 25, offset: 50 });
  assert.equal(q.directoryRange(10_000_000).offset, 100_000);
  assert.equal(q.directoryPageCount(0), 1);
  assert.equal(q.directoryPageCount(25), 1);
  assert.equal(q.directoryPageCount(26), 2);
});

test("formatQuoteDate: a calendar date, never shifted by a timezone", () => {
  assert.equal(q.formatQuoteDate("2026-11-02"), "Nov 2, 2026");
  assert.equal(q.formatQuoteDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(q.formatQuoteDate("bad"), "bad");
});

test("directory page: server-side reads only (one bounded page + counts), no mutation, no service role; errors are not empty lists", () => {
  const page = readFileSync(new URL("../../app/operations/growth/quotes/page.tsx", import.meta.url), "utf8");
  const helpers = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8");
  assert.match(page, /requirePlusAccess\(pathname\)/);
  assert.match(page, /listOrganizationQuotes\(context\.organizationId, \{ search: params\.search, status: params\.status, sort: params\.sort, limit, offset \}\)/);
  assert.match(page, /getQuoteDirectorySummary\(context\.organizationId\)/);
  assert.match(page, /list === null \?/, "a failed read renders the error state, never the empty state");
  assert.match(page, /data-testid="quotes-directory-error"/);
  assert.doesNotMatch(page, /Action\(|plus_create_quote|plus_update_quote_draft|plus_withdraw_quote|plus_mark_quote_sent|plus_revise_quote/);
  assert.match(page, /canWrite \? \(\s*<LinkButton href=\{PIPELINE\}/, "new quotes start from an opportunity (Pipeline); no second editor");
  assert.match(helpers, /plus_list_organization_quotes/);
  assert.match(helpers, /plus_quote_directory_summary/);
  assert.doesNotMatch(helpers.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /service[_-]?role|createAdminClient|SERVICE_ROLE/i, "no service-role client in code");
  const table = readFileSync(new URL("../../components/growth/QuotesDirectoryTable.tsx", import.meta.url), "utf8");
  assert.match(table, /\/operations\/growth\/pipeline\/\$\{opportunityId\}#quotes/, "a row opens its opportunity at the Quotes panel");
});

test("D1: the edit / withdraw dialog acts on the draft captured when it opened (survives revalidation)", () => {
  const src = readFileSync(new URL("../../components/growth/QuoteDraftControls.tsx", import.meta.url), "utf8");
  assert.match(src, /setTarget\(\["edit", "withdraw", "send"\]\.includes\(mode\) \? draft : null\)/);
  assert.match(src, /setSentTarget\(\["accept", "decline", "revise", "withdraw-sent"\]\.includes\(mode\) \? sent : null\)/);
  assert.match(src, /open === "withdraw" && target &&/);
  assert.match(src, /open === "edit" && target &&/);
  assert.match(src, /open === "send" && target &&/);
  assert.match(src, /open === "withdraw-sent" && sentLifecycle &&/);
  assert.doesNotMatch(src, /open === "withdraw" && draft &&/);
  assert.match(src, /role="status"[^>]*data-testid="quote-saved"/);
});

// ---------------------------------------------------------------------------------------------------------------------
// NP-P2-S5-S3B -- lifecycle helpers, timeline wording, OD-Q16 copy
// ---------------------------------------------------------------------------------------------------------------------

test("quoteActivityLine: staff-recorded wording for every quote event; never an amount; never 'online' acceptance", () => {
  assert.equal(q.quoteActivityLine("quote_sent", "estimate", 3, "sent", null), "Estimate 3 marked sent");
  assert.equal(q.quoteActivityLine("quote_status_changed", "quote", 4, "accepted", null), "Customer acceptance of Quote 4 recorded");
  assert.equal(q.quoteActivityLine("quote_status_changed", "quote", 4, "declined", null), "Customer decline of Quote 4 recorded");
  assert.equal(q.quoteActivityLine("quote_status_changed", "quote", 4, "superseded", 6), "Quote 4 replaced by revision Quote 6");
  assert.equal(q.quoteActivityLine("quote_status_changed", "quote", 4, "withdrawn", null), "Sent Quote 4 withdrawn");
  assert.equal(q.quoteActivityLine("quote_revised", "quote", 6, "draft", 4), "Quote 6 created as a revision of Quote 4");
  for (const line of [q.quoteActivityLine("quote_status_changed", "quote", 1, "accepted", null), q.quoteActivityLine("quote_sent", "quote", 1, "sent", null)]) {
    assert.doesNotMatch(line, /\$|online|verified|email|SMS/i);
  }
  assert.equal(q.isQuoteActivity("quote_revised"), true);
  assert.equal(q.isQuoteActivity("note"), false);
});

test("parseAcknowledgment: only an explicit 'true' / 'on' counts (never a default)", () => {
  assert.equal(q.parseAcknowledgment("true"), true);
  assert.equal(q.parseAcknowledgment("on"), true);
  for (const v of ["false", "", null, undefined, "1", "yes", "TRUE"]) assert.equal(q.parseAcknowledgment(v), false, String(v));
});

test("validateSentWithdrawReason: required, trimmed, at most 200 characters", () => {
  assert.equal(q.validateSentWithdrawReason("  ").ok, false);
  assert.equal(q.validateSentWithdrawReason("x".repeat(201)).ok, false);
  assert.deepEqual(q.validateSentWithdrawReason("  Fictional: plans changed "), { ok: true, value: "Fictional: plans changed" });
});

test("OD-Q16 copy: Nemryn sends nothing; the acknowledgment is not consent and changes no preference", () => {
  assert.match(q.MARK_SENT_NOTE, /outside Nemryn/);
  assert.match(q.MARK_SENT_NOTE, /isn't proof of delivery/);
  assert.match(q.DNC_WARNING_TEXT, /doesn't change their preference/);
  assert.match(q.DNC_WARNING_TEXT, /isn't consent/);
  assert.match(q.DNC_WARNING_TEXT, /doesn't allow emails, texts or future outreach/);
  assert.match(q.RESPONSE_NOTE, /isn't an online or verified acceptance/);
  assert.match(q.quoteErrorMessage("ZW004", "dnc_acknowledgment_required"), /do not contact/);
  const dialogs = readFileSync(new URL("../../components/growth/QuoteLifecycleDialogs.tsx", import.meta.url), "utf8");
  assert.match(dialogs, /needsAck && !ack/, "the confirm button stays disabled until the acknowledgment is ticked");
  assert.match(dialogs, /doNotContact \|\| state\.dncRequired === true/, "a server refusal (flag turned on meanwhile) shows the warning too");
});

test("OD-Q15 / OD-Q16 migration: activity linkage, DNC enforcement in the database, one Mark sent function", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261021100000_plus_quote_lifecycle_activity.sql", import.meta.url), "utf8");
  assert.match(sql, /foreign key \(quote_id, organization_id, opportunity_id\) references public\.plus_quotes \(id, organization_id, opportunity_id\)/);
  assert.match(sql, /drop function public\.plus_mark_quote_sent\(uuid, uuid, timestamptz\);/);
  assert.match(sql, /p_dnc_acknowledged boolean default false/);
  assert.match(sql, /raise exception 'dnc_acknowledgment_required' using errcode = 'ZW004'/);
  assert.match(sql, /for share;/, "the current preference is read under a lock");
  assert.doesNotMatch(sql, /update public\.plus_contacts/i, "the contact is never modified");
  assert.doesNotMatch(sql, /\bdelete from\b/i);
});
