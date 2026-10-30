# NP-FIN-P1 — Payment ledger re-foundation: implementation plan

**Status:** PLAN ONLY. Implementation needs owner authorization. No migration has been created.

**Decisions:** ZD-266, ZD-268, ZD-269, ZD-270, ZD-272, ZD-278, ZD-279, ZD-280 (`docs/product/decision-register.md`).

**Base:** `main` `85f2042`. Production: 98 migrations, `billing_payments` = 0 rows and 1 draft invoice (2026-10-28).

**Branch:** `np-fin-p1-ledger`, from `origin/main`.

**Data:** synthetic only, on the isolated NemrynS1Iso stack.

---

## 1. Outcome

FIN-P1 replaces the one-payment-one-invoice ledger with four records:
- **receipts**, money received;
- **allocations**, money applied to or removed from invoices;
- **refunds**, money returned;
- **receipt reversals**, entry errors.

Guarantees:
- **One receipt can be allocated to several invoices.** Each allocation is its own row against a single invoice, and their sum is bounded by the receipt.
- **Excess funds stay as payer credit.** Unallocated = gross − net allocated − refunded. A receipt may be recorded with no allocation at all.
- **Refunds can never exceed refundable funds.** Refundable = the receipt's unallocated amount. Money must be unapplied first, by an Admin.
- **BILL-P1 behaves identically** through compatibility wrappers (section 5).

---

## 2. Migrations

There are two, following the BILL-P1 split.

### 2.1 `<ts>_core_billing_ledger_foundation.sql` (tables, constraints, triggers, RLS)

**Pre-assert, first statement in the migration:**

```sql
do $$ begin
  if exists (select 1 from public.billing_payments) then
    raise exception 'NP-FIN-P1: billing_payments must be empty (found rows) -- STOP';
  end if;
end $$;
```

**Tables.** Every table has:
- an `organization_id` FK to `organizations`;
- `unique (id, organization_id)`;
- RLS enabled;
- `revoke all … from public, anon, authenticated, service_role`;
- `grant select … to authenticated` with a policy `billing_can(organization_id, 'view')` (OA only in P1);
- no write grants.

`billing_receipt_counters`:

| Column | Type / rule |
|---|---|
| `organization_id` | PK |
| `next_number` | int ≥ 1 |

Revoked from every client role, as for the invoice counter.

`billing_receipts` (append-only):

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `organization_id` | uuid | |
| `receipt_number` | int | not null; `unique (organization_id, receipt_number)` |
| `payer_kind` | text | `passenger`, `requester`, `facility` or `other` |
| `payer_passenger_id`, `payer_request_id`, `payer_facility_id` | uuid | composite FKs `(x, organization_id)`; shape check as for invoices |
| `payer_name` | text | 1..200, snapshot |
| `currency` | text | `'USD'`, check |
| `gross_cents` | bigint | 1..1e11 |
| `fee_cents` | bigint | 0..gross; default 0 |
| `net_cents` | bigint | generated always as (gross − fee) stored |
| `received_on` | date | not null; RPC bounds: ≤ org today and ≥ today − 400 days |
| `method` | text | `cash`, `check`, `card`, `ach`, `bank_transfer`, `wire`, `digital_wallet`, `other` |
| `provider` | text | null, or `stripe`, `square`, `paypal`, `zelle`, `venmo`, `bank`, `other` |
| `reference` | text | 1..100 or null; staff-entered; normalized copy in `reference_norm` (upper, alphanumeric only) |
| `provider_txn_id` | text | null in P1; set only by P5 / P6 paths |
| `note` | text | 1..500 or null |
| `idempotency_key` | text | `unique (organization_id, idempotency_key)`; same format check as BILL-P1 |
| `recorded_by` | uuid | → `auth.users` |
| `recorded_at` | timestamptz | |

Text checks on `reference` and `note`:
- a no-PAN rule: reject any run of 13 or more digits, including spaced or dashed forms (card and account numbers);
- trimmed, no control characters.

Uniqueness:
- `unique (organization_id, provider, provider_txn_id) where provider_txn_id is not null` (provider duplicate prevention; P5 / P6);
- a soft duplicate check for staff references: a non-unique index on `(organization_id, method, reference_norm, gross_cents, received_on)`. The RPC refuses a likely duplicate unless `p_confirm_possible_duplicate = true`.

Immutability: a trigger refuses UPDATE, DELETE and TRUNCATE for everyone, including the owner. Assurance changes are separate events.

`billing_receipt_events` (append-only assurance facts, ZD-270):

| Column | Rule |
|---|---|
| `id`, `organization_id`, `receipt_id` | composite FK |
| `kind` | `evidence_reference_noted`, `evidence_document_held`, `provider_confirmed`, `reconciled` |
| `source` | `staff`, `provider_import` or `statement_match` |
| `source_ref` | uuid, null in P1 |
| `actor_id`, `occurred_at` | |

Check: `kind in ('provider_confirmed','reconciled') ⇒ source <> 'staff'`. This makes it **impossible** to provider-confirm or reconcile by hand. In P1 only the `staff` evidence kinds are writable.

`billing_allocations` (append-only):

| Column | Rule |
|---|---|
| `id`, `organization_id` | |
| `receipt_id` | composite FK → `billing_receipts` |
| `invoice_id` | composite FK → `billing_invoices` |
| `kind` | `apply` or `unapply` |
| `amount_cents` | 1..1e11 |
| `unapplies_allocation_id` | null for `apply`; required for `unapply`; FK to an `apply` row of the **same receipt and invoice**, via a composite FK on `(id, receipt_id, invoice_id)`; unique |
| `different_payer` | bool; requires `reason` when true |
| `reason` | text; required for `unapply` |
| `idempotency_key`, `created_by`, `created_at` | |

Rules:
- Each apply row can be unapplied once and only in full. This keeps the arithmetic simple and auditable.
- The composite FKs make a cross-tenant allocation **unrepresentable**.

`billing_refunds` (append-only):

| Column | Rule |
|---|---|
| `id`, `organization_id`, `receipt_id` | composite FK |
| `refund_number` | per receipt, 1.. (unique `(receipt_id, refund_number)`) |
| `amount_cents` | |
| `refunded_on` | date |
| `method`, `provider`, `reference` | same checks as receipts |
| `reason` | required |
| `idempotency_key`, `recorded_by`, `recorded_at` | |

`billing_receipt_reversals` (append-only):

| Column | Rule |
|---|---|
| `id`, `organization_id`, `receipt_id` | composite FK; **unique**, so a receipt is reversed once |
| `reason_code` | `entry_error`, `returned_check`, `duplicate`, `other` |
| `reason` | text, required |
| `idempotency_key`, `reversed_by`, `reversed_at` | |

**Invariant triggers.** These are constraint triggers, `deferrable initially deferred`, re-checking at commit. They are defence in depth behind the RPC checks.

| ID | Invariant |
|---|---|
| I1 | Per invoice: 0 ≤ Σapply − Σunapply ≤ `total_cents`; allocations only while the invoice is `issued` |
| I2 | Per receipt: Σapply − Σunapply + Σrefunds ≤ `gross_cents` |
| I3 | A reversed receipt has net allocation 0 and refunds 0, and no new allocation or refund after reversal |
| I4 | Allocation currency = invoice currency = receipt currency |
| I5 | An invoice may move to `void` only when its net allocation = 0. This replaces BILL-P1's paid check, through `_billing_paid_cents`. |

**The old table.** In `billing_payments` the trigger `_billing_payments_guard` is replaced by `_billing_payments_retired`, which refuses INSERT, UPDATE, DELETE and TRUNCATE ("retired by NP-FIN-P1"). SELECT and its policy stay for this release (ZD-268).

### 2.2 `<ts>_core_billing_ledger_rpcs.sql` (functions)

**Authorization catalogue (ZD-272):**
- `_billing_authorize(p_org uuid, p_action text)`: ZW001 if unauthenticated. ZW002 unless `p_action` maps to a role the caller holds. In P1 every action maps to `organization_admin`.
- Actions: `view`, `invoice_write`, `receipt_write`, `allocate`, `evidence_add`, `void`, `unapply`, `reverse`, `refund`, `cross_payer_allocate`.
- `billing_can(p_org, p_action)` is a boolean variant used by RLS.
- `_billing_require_admin` is kept and delegates to `_billing_authorize(org, 'invoice_write')`, so existing BILL-P1 functions stay unchanged.

**New write RPCs.** All are SECURITY DEFINER with `search_path` pinned, idempotent, audited and ZW-coded.

| RPC | Behaviour |
|---|---|
| `billing_record_receipt(org, payer jsonb, gross, fee, received_on, method, provider, reference, note, evidence_kind, allocations jsonb [{invoice_id, expected_version, amount_cents}], confirm_possible_duplicate, idempotency_key)` | Creates the receipt, an optional evidence event and 0..N allocations atomically |
| `billing_allocate_receipt(org, receipt_id, expected_receipt_version?, allocations jsonb, different_payer_reason?, idempotency_key)` | Applies existing payer credit |
| `billing_unapply_allocation(org, allocation_id, reason, idempotency_key)` | **Sensitive** |
| `billing_record_refund(org, receipt_id, amount, refunded_on, method, provider, reference, reason, idempotency_key)` | **Sensitive**; amount ≤ unallocated |
| `billing_reverse_receipt(org, receipt_id, reason_code, reason, idempotency_key)` | **Sensitive**; requires net allocation 0 and refunds 0 |
| `billing_add_receipt_evidence(org, receipt_id, kind, idempotency_key)` | Staff evidence kinds only |

**New read RPCs:**

| RPC | Returns |
|---|---|
| `billing_get_receipt` | Header, derived amounts, allocations, refunds, reversal, assurance facts |
| `billing_list_receipts` | Filters: unallocated, reversed, method; search by number or payer; paged |
| `billing_payer_credit` | Payer → unallocated receipts and total |
| `billing_get_invoice_ledger(org, invoice_id)` | Allocations with receipt number, date, method and assurance; replaces the app's direct `billing_payments` read |

**Re-defined BILL-P1 functions** (same signatures; section 5): `billing_record_payment`, `billing_reverse_payment`, `billing_void_invoice` (via I5 / `_billing_paid_cents`), `billing_summary`, `_billing_paid_cents`, `_billing_payment_state`, and `billing_get_invoice` / `billing_list_invoices` where they read the ledger.

Grants: `execute` to `authenticated` only on public RPCs. Internal `_billing_*` functions are revoked from every client role.

---

## 3. Fixed lock order

Every write follows the **same global order**. The concurrency suite proves there is no deadlock or double-spend.

1. **Counter row**: receipt counter, then invoice counter, only when a number is assigned.
2. **Receipt rows**, `FOR UPDATE`, ascending `id`.
3. **Invoice rows**, `FOR UPDATE`, ascending `id`.
4. Inserts, then the invariant checks (I1 to I5) within the same transaction.

| RPC | Locks |
|---|---|
| record_receipt | counter, then the new receipt (implicit), then invoices ↑ |
| allocate | receipt, then invoices ↑ |
| unapply | receipt, then its invoice |
| refund | receipt only |
| reverse_receipt | receipt, then all invoices it has touched ↑ (re-read under lock) |
| void_invoice | invoice only. It never takes a receipt lock after the invoice. It reads the invoice's net allocation under the invoice lock; a concurrent allocate already holds the receipt and waits on the same invoice lock, so the two serialize. |
| BILL-P1 draft / issue | invoice (and invoice counter), unchanged |

---

## 4. Derivations (never stored)

| Value | Formula |
|---|---|
| invoice `paid_cents` | Σ apply − Σ unapply allocations on the invoice |
| invoice `balance_cents` | `total_cents` − `paid_cents` |
| display state | draft / issued / partially_paid / paid / void; overdue as now (BILL-P1 `billing-core.ts`) |
| receipt `allocated_cents` | Σ apply − Σ unapply on the receipt |
| receipt `refunded_cents` | Σ refunds |
| receipt `unallocated_cents` (= payer credit = refundable) | `gross` − allocated − refunded, or 0 if reversed |
| receipt state | `reversed` / `refunded` (refunded = gross) / `fully_allocated` / `partially_allocated` / `unallocated` |
| receipt assurance | the highest of recorded < evidence < provider_confirmed < reconciled, plus each fact individually |
| payer credit | Σ `unallocated_cents` over the payer's non-reversed receipts |

`billing-core.ts` gains pure helpers mirroring the database formulas, with unit tests.

---

## 5. Backward compatibility (BILL-P1)

| BILL-P1 element | FIN-P1 behaviour |
|---|---|
| `billing_record_payment(org, invoice, expected_version, amount, received_on, method, reference, note, key)` | One transaction: `record_receipt` with payer = invoice bill-to snapshot, gross = amount, fee 0, the mapped method, evidence `reference_noted` if a reference is given, and one allocation. It keeps the same checks and messages: issued only, `amount_exceeds_balance` (ZW006), `stale_state` on the invoice version (ZW003), date bounds, the same idempotency key semantics (same key returns the same result with `changed=false`). It returns `billing_payment_write_result` with `payment_id` = the **allocation id**, and paid, balance and version. |
| Method values | `card_external` maps to `card` (provider null); `bank_transfer`, `cash`, `check` and `other` are unchanged |
| `billing_reverse_payment(org, payment_id, expected_version, reason, key)` | When `payment_id` is a wrapper-created allocation whose receipt is allocated only to that invoice: one transaction unapplies plus reverses the receipt (reason_code `entry_error`). Same rules: reason required; reversed once (ZW004 on a second attempt); stale version (ZW003); the balance reopens. If the receipt is shared across invoices, refuse with ZW004 `use_receipt_page`. |
| Void only at net zero | Unchanged, now computed from allocations (I5) |
| `billing_summary` "collected this month" | Σ receipts (gross, not reversed) received this month − refunds this month. Equal to BILL-P1 for wrapper-only data. |
| Invoice page payments list | The data source changes to `billing_get_invoice_ledger`. The UI shows allocations as payments, with the "Reversed" badge when the source receipt is reversed. |
| Receipt print | Route `/receipt-print/[receiptId]` with number `RCPT-000123`. For a wrapper receipt it also shows "Payment on INV-000045". There is no legacy route traffic (0 production payments). |
| `INV-000001-R1` receipt numbering | Replaced by `RCPT-` (ZD-266). The E2E assertion is updated deliberately (section 9). |
| Audit actions `billing_payment_recorded` / `billing_payment_reversed` | The wrappers write them **as well as** the new receipt and allocation actions, so existing audit consumers keep working |
| Direct table read `billing_payments` (app) | Removed from `src/lib/billing/billing.ts:221` and `src/app/receipt-print/[paymentId]/page.tsx:27`; replaced by the RPCs |
| Test cleanup `delete from billing_payments` (`tests/e2e/handoff/handoff.e2e.mjs:35`, `tests/e2e/demo/pilot-demo.mjs:51`) | Retargeted to the new tables, using the same replica-mode bypass limited to fictional organizations (append-only triggers) |

---

## 6. UI changes (Concept B, Organization Admin only in P1)

- **Billing page:** a new tab **Receipts** (number, payer, date, method, gross, allocated, unallocated, state, assurance badge). A tile "Payer credit" (Σ unallocated). The existing tabs are unchanged.
- **Record payment dialog** on the invoice page. The fields are the same as now, plus:
  - optional provider;
  - optional processing fee, with help text "Your cost, not charged to the customer";
  - evidence: "I have the check, slip or remittance";
  - amount above the balance: "Record the extra as payer credit?". This opens the full receipt dialog.
- **Record receipt** (Receipts tab, "Record payment received"):
  - payer chosen like bill-to;
  - an allocation table of the payer's open invoices, with an oldest-first suggestion and editable amounts;
  - the remainder is shown as credit.
- **Receipt page** `/operations/billing/receipts/[id]`:
  - summary, allocations, refunds, assurance timeline;
  - actions **Apply credit**, **Add evidence**, **Unapply** (Admin, reason), **Refund** (Admin, reason; maximum = refundable), **Reverse receipt** (Admin, reason code).
  - Each shows an explicit confirmation and result.
- **Invoice page:**
  - the payments section lists allocations (receipt number, date, method, amount, assurance, Reversed / Unapplied);
  - "Apply payer credit" when the payer has credit;
  - the void dialog explains "unapply payments first" when paid.
- **Trip Detail Billing panel:** unchanged.
- **Print:** the receipt print uses `RCPT-`, lists allocations, a REVERSED banner and the refund history. The invoice print lists allocations.
- **Copy rules:** "Provider confirmed" appears only when the fact exists, and it never exists in P1. A typed reference shows as "Reference noted".

---

## 7. Audit and privacy

- `audit_events` gets one row per action: `billing_receipt_recorded`, `billing_allocation_applied`, `billing_allocation_unapplied`, `billing_refund_recorded`, `billing_receipt_reversed`, `billing_receipt_evidence_added`, plus the wrapper's legacy actions.
- `after_data` contains **ids, amounts, method, provider, kind / reason_code and assurance kind only**. It never contains payer name, reference, note, free-text reason, service type or trip details (ZD-279). The reason text lives only on the row and is visible to OA.
- No-PAN validation on reference and note; length caps.
- Server actions log error codes only.
- Print routes stay behind the OA guard plus RLS; there are no public links.
- Screenshots and E2E use fictional data only (ZD-280).

---

## 8. Files (expected change surface)

| Type | Files | Size [estimate] |
|---|---|---|
| New migrations | `supabase/migrations/<ts>_core_billing_ledger_foundation.sql`, `<ts>_core_billing_ledger_rpcs.sql` | ~900 lines |
| New tests | `supabase/tests/billing_ledger_tests.sql`, `billing_ledger_concurrency_test.sh`; `tests/e2e/billing/billing-ledger.e2e.mjs` | |
| New app | `src/app/operations/billing/receipts/[receiptId]/page.tsx`; `src/components/billing/{ReceiptsTable, RecordReceiptDialog, ReceiptActions, AllocationEditor}.tsx`; `src/app/receipt-print/[receiptId]/page.tsx` (replaces `[paymentId]`) | ~1,200 lines |
| Modified | `src/lib/billing/billing.ts`, `billing-core.ts` (+ test), `src/app/operations/billing/{actions.ts, page.tsx, invoices/[invoiceId]/page.tsx}`, `src/components/billing/{InvoiceActions, BillingTables}.tsx`, `src/lib/supabase/database.types.ts` (regenerated), `supabase/tests/{billing_tests.sql, billing_concurrency_test.sh, privilege_contract_tests.sql}`, `tests/e2e/billing/billing.e2e.mjs`, `tests/e2e/handoff/handoff.e2e.mjs`, `tests/e2e/demo/pilot-demo.mjs` | |
| Not touched | trips, requests, assignments, Proof of Service, Plus tables and RPCs, intake, deployment gate | |

---

## 9. Preserving the BILL-P1 regression (exact)

| Suite | Today | FIN-P1 handling |
|---|---|---|
| `supabase/tests/billing_tests.sql` | 67 tests; 10 direct `billing_payments` refs; 4 `record_payment` and 5 `reverse_payment` calls | Every RPC-level assertion is kept **unchanged**: idempotency, stale version, overpayment, dates, methods, reversal once, reason, void rules, audit without names, RLS, cross-tenant. The 10 direct-table assertions (append-only, owner UPDATE / DELETE / TRUNCATE refused, row shapes) are retargeted to `billing_receipts` / `billing_allocations`, plus one new assertion that `billing_payments` refuses INSERT. Target: 67 / 67 plus the new suite. |
| `supabase/tests/billing_concurrency_test.sh` | S1 to S8; 7 refs | Scenarios unchanged, including "two payments from equal forms → one + ZW003" and "payment vs void both orders". The invariant queries are retargeted to the derived allocation sums. |
| `tests/e2e/billing/billing.e2e.mjs` | 50 checks | Journeys unchanged. One **intentional** assertion change: R3 expects `RCPT-000001` (plus "Payment on INV-000001") instead of `INV-000001-R1`. Receipt URLs come from the ledger read. |
| `privilege_contract_tests.sql` | includes billing | New tables and functions added. `billing_payments` keeps SELECT this release. |
| handoff / demo cleanups | delete from `billing_payments` | Retargeted (section 5) |
| Wider regression | | QA2 strict, Quotes strict, consents, p1b, inquiries, handoff, onboarding E2E; `npm test`, `test:release`, tsc, lint, build |

---

## 10. Production release, preflight and rollback

**Release order (established):**
1. A read-only preflight.
2. A fresh encrypted backup (custody policy, NP-LAUNCH-03A).
3. Owner authorization.
4. Apply both migrations.
5. A read-only post-migration check.
6. Merge, then the Vercel production deploy.
7. Read-only UI verification (no payment recorded in production).

**Preflight gates (read-only SQL; any failure means STOP):**

| Gate | Check |
|---|---|
| G1 | `select count(*) from billing_payments` = 0 |
| G2 | `billing_invoices` status counts are recorded. Any issued invoice gets no allocations created by the migration (there are none to migrate). |
| G3 | The migration head equals the expected base (98 / `20261028100000`, or the current head at release time) |
| G4 | No objects with the new names already exist |
| G5 | The privilege contract shows 0 violations before |
| G6 | The backup is verified (decrypt-to-hash) |

**Post-migration:**
- the privilege contract shows 0 violations;
- the new tables are empty;
- `billing_payments` refuses INSERT (checked by catalog inspection, not by attempting a write);
- function grants are as designed;
- the invoice count is unchanged.

**Rollback:**
- An emergency reversal SQL is prepared with the release. It drops the new objects, restores the BILL-P1 function bodies from `20261027110000` and restores `_billing_payments_guard`.
- It is valid **only while the new tables hold 0 rows**. After any real receipt, the policy is forward-fix only.
- The app rolls back by redeploying the previous build. That build still works during the transition release because `billing_payments` SELECT is retained, and its `record_payment` calls hit the compatible wrapper.

---

## 11. Implications for FIN-P2 (pre-trip invoices and deposits)

- **Deposits:** a deposit is met when the invoice's net allocation (with the ZD-270 assurance rules, applied in P3a) ≥ `deposit_required_cents`. FIN-P1's allocations already support partial amounts, so P2 adds no ledger work.
- **Prepayment before an invoice exists:** a receipt can be recorded unallocated (payer credit) and applied when the pre-trip invoice is issued.
- **Cancellation (ZD-273):** unapply → void at net zero → payer credit → refund or rebooking credit. All of these are FIN-P1 primitives. P2 adds only the "Needs financial review" flag.
- **Double billing (ZD-265):** independent of the ledger. P2 adds the request link plus the two-way guard. FIN-P1 must not add any trip or request coupling to receipts; they relate only to invoices.
- **Rebooking:** credit from a cancelled ride applies to the new request's invoice through `allocate` (same payer). Cross-payer application is sensitive (OA plus reason).
- **No fee retention** until FIN-P4, unless an interim method is approved.
