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
  assert.equal(b.receiptNumberLabel(12, 2), "INV-000012-R2");
  for (const s of ["draft", "unpaid", "partially_paid", "paid", "void"]) assert.notEqual(b.paymentStateLabel(s), s);
  assert.equal(b.paymentStateTone("paid"), "positive");
  assert.equal(b.paymentStateTone("void"), "cancelled");
  for (const m of b.PAYMENT_METHODS) assert.ok(b.PAYMENT_METHOD_LABELS[m]);
  assert.equal(b.paymentMethodLabel(null), "—");
});

test("billing URL state: bounded, round-trips", () => {
  assert.deepEqual(b.parseBillingParams({}), { view: "ready", filter: "all", search: "", page: 1 });
  assert.deepEqual(b.parseBillingParams({ view: "invoices", filter: "bogus", page: "-2", q: " INV-12 " }), { view: "invoices", filter: "all", search: "INV-12", page: 1 });
  const p = { view: "invoices", filter: "open", search: "Smith", page: 2 };
  assert.equal(b.billingHref(p), "/operations/billing?view=invoices&filter=open&q=Smith&page=2");
  assert.deepEqual(b.parseBillingParams(Object.fromEntries(new URL(`http://x${b.billingHref(p)}`).searchParams)), p);
  assert.equal(b.billingHref({ view: "ready", filter: "open", search: "x", page: 1 }), "/operations/billing");
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
