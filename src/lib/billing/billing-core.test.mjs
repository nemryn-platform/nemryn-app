// NP-BILL-P1 -- Core billing rules. Run with:
//
//   node --test src/lib/billing/billing-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const b = await import("./billing-core.ts");

test("money parsing is exact (no floating point) and bounded", () => {
  assert.deepEqual(b.parseMoneyToCents("75"), { ok: true, cents: 7500 });
  assert.deepEqual(b.parseMoneyToCents("$1,234.5"), { ok: true, cents: 123450 });
  assert.deepEqual(b.parseMoneyToCents("0.07"), { ok: true, cents: 7 });
  assert.deepEqual(b.parseMoneyToCents(".5"), { ok: true, cents: 50 });
  assert.deepEqual(b.parseMoneyToCents(""), { ok: true, cents: 0 });
  assert.equal(b.parseMoneyToCents("-1").ok, false);
  assert.equal(b.parseMoneyToCents("1.234").ok, false);
  assert.equal(b.parseMoneyToCents("12,34").ok, false);
  assert.equal(b.parseMoneyToCents("100000001").ok, false);
  assert.equal(b.formatCents(123450), "$1,234.50");
  assert.equal(b.formatCents(-5), "−$0.05");
  assert.equal(b.centsToInput(4500), "45.00");
});

test("quantity and line amount match the database's round(quantity x unit)", () => {
  assert.deepEqual(b.parseQuantity("12.5"), { ok: true, hundredths: 1250 });
  assert.deepEqual(b.parseQuantity(""), { ok: true, hundredths: 100 });
  assert.equal(b.parseQuantity("0").ok, false);
  assert.equal(b.parseQuantity("1.234").ok, false);
  assert.equal(b.parseQuantity("100000").ok, false);
  assert.equal(b.lineAmountCents(1250, 199), 2488); // 2487.5 -> 2488 (half away from zero, like Postgres numeric)
  assert.equal(b.lineAmountCents(100, 4500), 4500);
  assert.equal(b.lineAmountCents(33, 100), 33);
  assert.equal(b.lineAmountCents(150, 1), 2); // 1.5 -> 2
  assert.equal(b.lineAmountCents(149, 1), 1);
});

test("totals preview flags a discount above the subtotal", () => {
  assert.deepEqual(b.previewTotals([{ amountCents: 4500 }, { amountCents: 2488 }], 500), { subtotal: 6988, discount: 500, total: 6488, discountTooHigh: false });
  assert.equal(b.previewTotals([{ amountCents: 100 }], 500).discountTooHigh, true);
});

test("invoice / receipt numbers and state labels", () => {
  assert.equal(b.invoiceNumberLabel(12), "INV-000012");
  assert.equal(b.invoiceNumberLabel(null), "Draft");
  // NP-FIN-P1 (ZD-266, OD-4): receipts have their own per-organization numbers (was INV-000012-R2 in NP-BILL-P1)
  assert.equal(b.receiptNumberLabel(12), "RCPT-000012");
  assert.equal(b.receiptNumberLabel(1234567), "RCPT-1234567");
  for (const s of ["draft", "unpaid", "partially_paid", "paid", "void"]) assert.notEqual(b.paymentStateLabel(s), s);
  assert.equal(b.paymentStateTone("paid"), "positive");
  assert.equal(b.paymentStateTone("void"), "cancelled");
  for (const m of b.PAYMENT_METHODS) assert.ok(b.PAYMENT_METHOD_LABELS[m]);
  assert.equal(b.paymentMethodLabel(null), "—");
});

test("billing URL state: bounded, round-trips", () => {
  assert.deepEqual(b.parseBillingParams({}), { view: "ready", filter: "all", receiptFilter: "all", search: "", page: 1 });
  assert.deepEqual(b.parseBillingParams({ view: "invoices", filter: "bogus", page: "-2", q: " INV-12 " }), { view: "invoices", filter: "all", receiptFilter: "all", search: "INV-12", page: 1 });
  const p = { view: "invoices", filter: "open", receiptFilter: "all", search: "Smith", page: 2 };
  assert.equal(b.billingHref(p), "/operations/billing?view=invoices&filter=open&q=Smith&page=2");
  assert.deepEqual(b.parseBillingParams(Object.fromEntries(new URL(`http://x${b.billingHref(p)}`).searchParams)), p);
  assert.equal(b.billingHref({ view: "ready", filter: "open", receiptFilter: "credit", search: "x", page: 1 }), "/operations/billing");
  // NP-FIN-P1 Payments received view
  const r = { view: "receipts", filter: "all", receiptFilter: "credit", search: "RCPT-3", page: 1 };
  assert.equal(b.billingHref(r), "/operations/billing?view=receipts&rfilter=credit&q=RCPT-3");
  assert.deepEqual(b.parseBillingParams(Object.fromEntries(new URL(`http://x${b.billingHref(r)}`).searchParams)), r);
  assert.equal(b.parseBillingParams({ view: "receipts", rfilter: "bogus" }).receiptFilter, "all");
});

test("dates: default terms and calendar arithmetic", () => {
  assert.equal(b.DEFAULT_TERMS_DAYS, 15);
  assert.equal(b.addDays("2026-10-26", 15), "2026-11-10");
  assert.equal(b.addDays("2026-12-25", 15), "2027-01-09");
  assert.equal(b.addDays("2028-02-20", 15), "2028-03-06"); // leap year
  assert.equal(b.formatIsoDate("2026-11-10"), "Nov 10, 2026");
  assert.equal(b.formatIsoDate(null), "—");
  assert.equal(b.isIsoDate("2026-13-01"), false);
});

test("error messages explain the rule and never expose codes", () => {
  assert.match(b.billingErrorMessage("ZW004", "trip_already_invoiced"), /already on another invoice/);
  assert.match(b.billingErrorMessage("ZW006", "amount_exceeds_balance"), /more than the balance/);
  assert.match(b.billingErrorMessage("ZW006", "mixed_customers"), /same passenger/);
  assert.match(b.billingErrorMessage("ZW003"), /Reload/);
  for (const code of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined, "42501"]) {
    assert.doesNotMatch(b.billingErrorMessage(code), /ZW\d|SQL|exception/i);
  }
});

test("organization-timezone dates", () => {
  assert.equal(b.formatInstantDate("2026-10-27T02:30:00Z", "America/New_York"), "Oct 26, 2026");
  assert.equal(b.formatInstantDate(null, "America/New_York"), "—");
  assert.equal(b.todayInTimezone("America/New_York", new Date("2026-10-27T02:30:00Z")), "2026-10-26");
  assert.equal(b.todayInTimezone("UTC", new Date("2026-10-27T02:30:00Z")), "2026-10-27");
});

// ---------------------------------------------------------------------------------------------------------------------
// NP-FIN-P1 ledger rules (mirror the database; the database stays authoritative)
// ---------------------------------------------------------------------------------------------------------------------
test("receipt state mirrors the database derivation", () => {
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 0, refundedCents: 0, reversed: true }), "reversed");
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 0, refundedCents: 1000, reversed: false }), "refunded");
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 1000, refundedCents: 0, reversed: false }), "fully_allocated");
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 600, refundedCents: 400, reversed: false }), "fully_allocated");
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 600, refundedCents: 0, reversed: false }), "partially_allocated");
  assert.equal(b.receiptState({ grossCents: 1000, allocatedCents: 0, refundedCents: 0, reversed: false }), "unallocated");
  for (const st of ["reversed", "refunded", "fully_allocated", "partially_allocated", "unallocated"]) assert.ok(b.receiptStateLabel(st));
});

test("oldest-first suggestion: same payer only, never above a balance, the rest is payer credit", () => {
  const inv = [
    { id: "a", balanceCents: 6000, samePayer: true },
    { id: "x", balanceCents: 9000, samePayer: false },
    { id: "b", balanceCents: 4000, samePayer: true },
    { id: "c", balanceCents: 3000, samePayer: true },
  ];
  assert.deepEqual(b.suggestAllocations(15000, inv), { allocations: [{ id: "a", cents: 6000 }, { id: "b", cents: 4000 }, { id: "c", cents: 3000 }], creditCents: 2000 });
  assert.deepEqual(b.suggestAllocations(7000, inv), { allocations: [{ id: "a", cents: 6000 }, { id: "b", cents: 1000 }], creditCents: 0 });
  assert.deepEqual(b.suggestAllocations(500, [{ id: "x", balanceCents: 9000, samePayer: false }]), { allocations: [], creditCents: 500 });
  assert.deepEqual(b.suggestAllocations(0, inv), { allocations: [], creditCents: 0 });
  assert.deepEqual(b.suggestAllocations(-5, inv), { allocations: [], creditCents: 0 });
});

test("card numbers are detected like the database (Luhn), other long references are allowed", () => {
  assert.equal(b.looksLikeCardNumber("4111 1111 1111 1111"), true);
  assert.equal(b.looksLikeCardNumber("ref 5555-5555-5555-4444 ok"), true);
  assert.equal(b.looksLikeCardNumber("card 378282246310005"), true);
  assert.equal(b.looksLikeCardNumber("021000021234568"), false); // ACH trace number, fails Luhn
  assert.equal(b.looksLikeCardNumber("CHK-1001"), false);
  assert.equal(b.looksLikeCardNumber("411111111111"), false); // 12 digits
  assert.equal(b.looksLikeCardNumber(""), false);
});

test("assurance labels never call staff evidence provider confirmation; methods / providers are labelled", () => {
  assert.equal(b.assuranceLabel("recorded"), "Recorded by staff");
  assert.equal(b.assuranceLabel("evidence_reference_noted"), "Reference noted");
  assert.equal(b.assuranceLabel("evidence_document_held"), "Document held");
  assert.equal(b.assuranceLabel("provider_confirmed"), "Provider confirmed");
  assert.equal(b.assuranceLabel("bogus"), "Recorded by staff");
  assert.notEqual(b.assuranceTone("evidence_reference_noted"), "positive");
  assert.equal(b.assuranceTone("reconciled"), "positive");
  for (const m of b.RECEIPT_METHODS) assert.notEqual(b.paymentMethodLabel(m), "—");
  assert.equal(b.paymentMethodLabel("card_external"), "Card (outside terminal)");
  for (const pr of b.RECEIPT_PROVIDERS) assert.ok(b.providerLabel(pr));
  assert.equal(b.providerLabel(null), null);
});

test("ledger error rules explain the rule (refund limits, credit, duplicates, card numbers)", () => {
  for (const rule of ["amount_exceeds_receipt", "refund_exceeds_refundable", "receipt_reversed", "receipt_has_allocations", "receipt_has_refunds",
                      "already_unapplied", "different_payer_confirmation_required", "possible_duplicate", "looks_like_card_number", "invalid_fee",
                      "invalid_allocations", "use_receipt_page"]) {
    const m = b.billingErrorMessage("ZW006", rule);
    assert.ok(m && !/ZW0|_/.test(m), `${rule}: ${m}`);
  }
});
