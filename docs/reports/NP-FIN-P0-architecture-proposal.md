# NP-FIN-P0 — Architecture proposal

**Status: DESIGN ONLY. Not approved.** Every table and RPC below is a proposal. No migration exists.

**Builds on:** the NP-BILL-P1 production ledger (see `NP-FIN-P0-repository-audit.md`). The proposal is additive, and BILL-P1 behaviour is preserved unless a decision in `NP-FIN-P0-decision-register.md` says otherwise.

**Principles:**
1. **Nemryn is the record of account, not the merchant of record.** It never holds funds, card data or bank credentials.
2. **Core owns money. Plus only reads.** Accepted quotes inform invoices through the existing attribution path.
3. **Issued documents are immutable.** Changes happen through new documents: void, credit note or adjustment invoice.
4. **Money received** (a receipt) is separate from **money applied** (an allocation), which is separate from **money returned** (a refund).
5. **Balances and clearance are derived, never stored.** Writes take database locks. Every write is idempotent and audited.
6. **Minimum necessary data.** Medical details (service type, assistance notes, diagnoses) never appear in financial lines, exports, provider metadata or audit rows.

---

## 1. Lifecycle

```
Request (pending) ─accept─▶ Request (accepted) ─▶ Trip(s) created ─assign─▶ dispatched ─▶ completed / no_show / cancelled
        │                         │                       ▲                                  │
   (Plus quote, optional)   Pre-trip invoice ──issue──▶ Receipts ─allocate─▶ Clearance ─────┘      Post-trip closeout
        accepted ──informs──▶ (request-anchored)        (deposit / full)    (derived)       ─▶ adjustment invoice / credit note / refund
                                                                                              ─▶ Reconciliation (statement lines ↔ receipts / refunds / payouts)
```

There are three independent statuses, never merged into one field:

| Status | Values | Owner |
|---|---|---|
| Booking | request `pending` / `accepted` / …; trip state machine (unchanged) | Core operations |
| Invoice | `draft` / `issued` / `void` (stored) + `partially_paid` / `paid` / `overdue` / `credited` (derived) | Core billing |
| Financial clearance | `not_required`, `cleared`, `deposit_met`, `awaiting_payment`, `exception` (derived) | Core billing, read by dispatch |

---

## 2. Pre-trip invoicing (section A)

### A1 Trigger and anchor
A pre-trip invoice is created **manually by finance staff from an ACCEPTED request**. It is not automatic. See FD-01 and FD-02.

New link table `billing_invoice_requests (invoice_id, request_id, organization_id, released_at)`:
- composite FKs;
- `UNIQUE (request_id) WHERE released_at IS NULL`, which allows one active pre-trip invoice per request;
- the same draft-only and void-release triggers as `billing_invoice_trips`.

`billing_invoices.basis` is a new column: `'trips'` (the existing post-trip path, the default for current rows) or `'request'`. A shape check requires a request basis to have request links and no trip links.

**Double-billing guard** (C2). Billing the same ride once as a request and again as a trip must be impossible:
- `billing_create_invoice_draft` (trips basis) refuses any trip whose `request_id` is on an active request-basis invoice (new error `trip_covered_by_request_invoice`).
- The reverse also holds: a request cannot be pre-invoiced while any of its trips is on an active trips-basis invoice.
- Both checks run under row locks on the request and trips.
- A trigger on both link tables re-checks this, for defence in depth.

**Eligibility:** the request is `accepted`, belongs to the same organization, and is not cancelled. A request with no trip yet is allowed. If the request is cancelled after issue, the invoice is not changed automatically; post-trip closeout handles it (section E).

### A2 Lines
Lines are pre-filled from:
- the accepted quote (via `plus_request_attributions.opportunity_id`; the latest `accepted` quote; quote number and kind snapshotted, as BILL R3 does), **or**
- one generic line: "Transportation — <preferred date>".

Line sources are `request`, `quote` or `manual`. Lines on a request-basis invoice carry no `trip_id`.

### A3 Numbering and isolation
Unchanged: the per-organization counter and `INV-000123`, assigned at issue. Pre-trip and post-trip invoices share one sequence (FD-03 confirms this).

### A4 Recipient versus passenger
Unchanged bill-to kinds: `passenger`, `requester`, `facility`, `other`.

For a request basis:
- `requester` = that request;
- `passenger` = `request.passenger_id`, when linked;
- `facility` = a facility named by the request's trips, when any exist;
- `other` = typed.

The passenger shown is a snapshot of the name. Facility payers get credit terms (section C).

### A5 Taxes and fees
A tax line is deferred (FD-14). A `line_kind` would be `service`, `fee`, `tax` or `discount`, but only `service` and `fee` are added now. Provider processing fees are **not** customer lines; they are recorded on receipts.

### A6 Deposits and due dates
New invoice columns, for request-basis invoices only, fixed at issue:
- `deposit_required_cents` (0..total);
- `deposit_due_date`;
- `due_date` (the existing column).

Clearance uses whichever the org or payer policy requires.

### A7 Snapshots and history
Already enforced by BILL-P1 triggers (bill-to, lines, totals, quote reference). New columns join the frozen set.

### A8 Corrections
- **Void**: unchanged. Only at net zero. The number is kept.
- **Credit note** (P4): a new numbered document `CN-000045` that references the issued invoice, has negative effect, and is allocated like a payment.
- **Adjustment invoice** (P4): a new invoice with `adjusts_invoice_id`, used for post-trip extra charges such as waiting time or an extra stop.

### A9 PDF and printing
The existing `/invoice-print/[id]` and `/receipt-print/[id]` are extended with a deposit line, "Pre-trip invoice", and a request reference date. There are no public links and no email (deferred).

### A10 Consolidated billing
**Deferred** (FD-12). R1 (one passenger per invoice) stays. A later facility statement would aggregate several invoices; it would not be a multi-passenger invoice.

---

## 3. Payment recording (section B)

### Ledger redesign (FD-05)
This is the core change. Production has **0 payment rows**, so this is the moment to make it.

`billing_receipts` is an append-only record of money received:

| Field group | Fields |
|---|---|
| Identity | `id`, `organization_id`, `receipt_number` (`RCPT-000001`, its own counter) |
| Payer | `payer_kind` / ids / name snapshot |
| Money | `received_on`, `currency`, `gross_cents` > 0, `fee_cents` ≥ 0, `net_cents` = gross − fee (check) |
| Method and provider | `method` (cash, check, card_external, ach, bank_transfer, wire, stripe, square, paypal, zelle, other), `provider`, `provider_reference` |
| Verification | `external_txn_id`, `verification_level` (`recorded`, `evidence_attached`, `matched_to_statement`) |
| Evidence and keys | `evidence_note`, `idempotency_key`, actor columns |
| Uniqueness | `UNIQUE (organization_id, idempotency_key)`; `UNIQUE (organization_id, provider, external_txn_id) WHERE external_txn_id IS NOT NULL` (duplicate prevention) |

`billing_allocations` is append-only money applied:

| Field group | Fields |
|---|---|
| Columns | `id`, `organization_id`, `receipt_id` or `credit_note_id` (exactly one), `invoice_id`, `amount_cents` > 0, `kind` (`apply` or `unapply`), `reverses_allocation_id` (unique), `idempotency_key`, actor columns |
| Tenant safety | Composite FKs, so a receipt and an invoice must share `organization_id`. **Cross-tenant allocation is impossible at the FK level.** |

`billing_refunds` is append-only money returned:
- `receipt_id` (composite FK), `amount_cents`, `refunded_on`, `method`, `provider_reference`, `reason`, `idempotency_key`.
- Before a refund, the receipt must be unallocated by at least the refund amount (allocations are unapplied first).

`billing_receipt_reversals` is for a receipt recorded in error, kept separate from a refund. It must be fully unallocated first.

### Derived amounts
| Amount | Formula |
|---|---|
| Invoice paid | Σ apply − Σ unapply allocations on the invoice |
| Invoice balance | total − paid − credited |
| Receipt unallocated (customer credit) | gross − Σ allocations (net of unapply) − Σ refunds − reversal |

### Invariants
These are enforced inside RPCs under `FOR UPDATE` locks, in a fixed lock order (receipt, then invoices by id), and re-checked by constraint triggers:
- invoice paid ≤ total, so there is no over-allocation;
- receipt allocations plus refunds ≤ gross;
- allocation only to issued invoices of the same organization and currency.

### BILL-P1 compatibility
- `billing_record_payment` becomes a wrapper that creates one receipt plus one allocation atomically, so the current UI keeps working.
- The `billing_payments` table is **retired** (it has no production rows): it is kept read-only or dropped by an owner-approved migration (FD-05).
- Receipt print moves to receipt numbers.

### Gross and net
Customers are credited with the **gross** amount. The provider fee is the agency's cost, used in reconciliation; it is never charged to the customer's balance.

### Payment verification levels
1. Staff recorded it.
2. Evidence noted: a check number or a provider reference.
3. Matched to a statement line (P5).

Clearance can require level ≥ 2 for card or ACH (FD-07).

---

## 4. Dispatch payment policies (section C)

### Policy model
Policies resolve per trip in this order:
1. an active **exception** (if any);
2. the **payer terms**: a facility on `net_N` credit terms;
3. the **request-invoice** deposit requirement;
4. the **organization default**.

The organization default (`billing_settings.clearance_policy`) is one of:
- `none`;
- `full_prepay`;
- `deposit` (a percentage or fixed amount);
- `pay_on_completion`.

### Facility credit terms
`billing_payer_terms (facility_id, terms: net_15 | net_30 | prepay, credit_limit_cents?, approved_by/at, active)`.

A facility with approved terms is `cleared` while under its limit and with no overdue invoice. The limit is optional.

### Derived clearance
The read function is `billing_trip_clearance(org, trip_ids[])`. It is SECURITY DEFINER and returns **status only, never amounts**, so dispatchers can see it.

| Status | When |
|---|---|
| `not_required` | Policy is none or pay_on_completion |
| `cleared` | Paid in full, or credit terms apply |
| `deposit_met` | The deposit is paid |
| `awaiting_payment` | Payment is required and not yet met |
| `exception` | An active exception exists |

### Exceptions
`billing_dispatch_exceptions` is append-only:
- `trip_id` or `request_id`, `reason` (a closed list plus a note), `granted_by` (finance role), `expires_at`, `revoked_at` / `revoked_by`;
- exactly one active exception per trip.

### Enforcement (FD-08)
- **P3a:** advisory badges on the Dispatch board, Trip Detail and the assign dialog. No change to `assign_trip`.
- **P3b:** optional per-organization `enforce_clearance_on_assign`. `assign_trip` would call `billing_assert_trip_cleared`. This **modifies a core operational RPC**, needs a separate owner approval, and must fail open only through exceptions, never silently.

Booking state, invoice state and clearance are never written into one another.

---

## 5. Post-trip financial closeout (section E, P4)

Triggered per trip reaching `completed`, `no_show` or `cancelled`. The closeout task appears in Billing ("Needs closeout"). There are no automatic money movements.

| Outcome | Action |
|---|---|
| Completed as quoted | Mark financially closed (a derived "closed" when the balance is 0 and no open adjustment exists) |
| Extra charges | Adjustment invoice (waiting, extra stop, mileage) |
| Cancelled or no-show | Keep the invoice (cancellation fee policy), issue a credit note, or void if nothing was paid; then a refund or credit on account |
| Overpayment after adjustment | Unapply, then refund or keep as customer credit |

Authorization: credit notes, refunds and exceptions require the **finance write** permission. Refunds above a threshold could need an Organization Admin (FD-09).

---

## 6. Reconciliation (section D, P5)

| Table | Purpose |
|---|---|
| `billing_statement_imports` | Source (bank, Stripe, Square, other), file name, `file_sha256` (`UNIQUE (organization_id, file_sha256)` prevents duplicate imports), period, row counts, imported_by / at, status |
| `billing_statement_lines` | `import_id`, `posted_on`, `amount_cents` (signed), `currency`, `description` (trimmed and length-capped), `external_txn_id`, `payout_id`, `line_hash`, unique per org, source and txn / hash |
| `billing_payouts` | Grouped provider payouts: `provider_payout_id`, gross, fees and net totals |
| `billing_matches` | Append-only; statement line ↔ receipt / refund / payout; `match_kind` (exact, grouped, fee_difference, manual); `status` (proposed, approved, rejected); approved_by / at |

Process:
1. Upload a CSV.
2. Server-side parse into a staging area (server action; no service role in the browser).
3. Map the columns.
4. Insert lines idempotently.
5. Auto-propose matches: exact amount and date ± 3 days, external id, payout groups.
6. A human approves or rejects.
7. Unmatched lines stay in a queue.
8. Approved matches raise receipt verification to level 3.

Fee differences (payout net vs. Σ receipts gross) are recorded as fee variance and need approval.

**Statement lines must not store payer card data.** Description text is truncated, and a privacy note warns not to import memo fields with medical content.

### Accounting (P6)
- Nemryn stays the source of truth for invoices, receipts, allocations, credit notes and refunds.
- The accounting system (QuickBooks or Xero) is **downstream**: one-way export or sync of posted documents with external ids stored.
- There is no two-way editing (FD-13).
- Provider webhooks (Stripe or Square, P6) are received by a server route using a provider signing secret, stored idempotently in `billing_provider_events (provider, event_id UNIQUE)`, and turned into **proposed** receipts that need approval, or auto-approved only by an explicit decision.

---

## 7. Database and security requirements (mapping)

| Requirement | Mechanism |
|---|---|
| Deny-by-default RLS | RLS on every new table; SELECT policies only for the finance-read permission; no client INSERT / UPDATE / DELETE grants; RPC-only writes |
| Database-enforced tenant isolation | Composite `(id, organization_id)` FKs on every link (allocation ↔ receipt ↔ invoice, refund ↔ receipt, match ↔ line ↔ receipt); RPCs filter by `organization_id` and re-check membership |
| No cross-tenant allocation | The FKs make it unrepresentable, plus explicit tests |
| No client-exposed service role | Only the publishable key in the browser; imports and webhooks are server routes; provider secrets are server env only |
| Immutable issued history | BILL-P1 triggers extended to the new columns; receipts, allocations, refunds, credit notes, exceptions and matches are append-only (UPDATE / DELETE / TRUNCATE refused, including for the owner) |
| Minor units | `bigint` cents; `currency char(3)` fixed to `'USD'` by check; a currency-exponent table is added only when another currency is approved; quantity × unit rounding stays in the database (half-up, as BILL-P1) |
| Idempotency | `idempotency_key` unique per organization on every write; `external_txn_id` and `provider event_id` uniqueness; `file_sha256` uniqueness |
| Transaction-safe allocation | Single RPC transaction; lock order receipt → invoices (sorted by id); expected versions; invariant triggers |
| Concurrency | Counter row lock for invoice, credit-note and receipt numbers; partial unique indexes for active links; `FOR UPDATE` on invoice and receipt |
| Strict roles | A finance permission via `membership_module_grants` (module `billing`, access `read` / `write`); Organization Admin implicitly has write; dispatchers get clearance status only |
| Audit | `audit_events` row per action with ids, amounts and statuses only: no names, references, notes, descriptions or service type |
| No medical data | Generic line descriptions; no service_type, assistance notes or diagnoses in lines, receipts, exports, provider metadata or audit; CSV export columns allow-listed |

---

## 8. Adversarial security and concurrency tests (required)

### SQL (rollback-only suites)
| ID | Test |
|---|---|
| S1 | anon, unauthenticated, driver, dispatcher without a grant, and another tenant's admin: every new RPC returns ZW001 / ZW002, and SELECT on every new table returns 0 rows |
| S2 | Direct INSERT / UPDATE / DELETE / TRUNCATE on every new table as `authenticated` is refused; as the owner, append-only tables are refused |
| S3 | Cross-tenant: allocate org A's receipt to org B's invoice (FK and RPC refuse); a credit note across orgs; a statement match to another org's receipt; a request from org B on an org A invoice |
| S4 | Double billing: request invoice, then a trip invoice for its trip (refused), and the reverse; void releases both directions correctly |
| S5 | Over-allocation: allocations above the invoice balance; above the receipt's unallocated amount; refund above the unallocated amount; allocation to a draft or void invoice; currency mismatch |
| S6 | Immutability: change frozen fields on issued invoices, credit notes and receipts (including the new deposit columns) |
| S7 | Idempotency: same key returns the same row; same `external_txn_id` with a different key is refused; re-importing the same file is refused; the same provider event processed twice yields one receipt |
| S8 | Clearance: every policy and exception combination; an expired exception; a revoked exception; a facility over its credit limit; status-only output for dispatchers (no amounts leaked) |
| S9 | Privacy: audit rows and export functions contain no names, notes, references, service_type or assistance notes |
| S10 | Grants: finance read cannot write; revoking a grant takes effect immediately |
| S11 | Privilege contract: 0 violations including the new objects |

### Concurrency scripts (isolated stack)
| ID | Test |
|---|---|
| K1 | Two allocations of one receipt to two invoices whose sum exceeds the receipt: exactly one succeeds |
| K2 | Two receipts allocated to one invoice beyond its balance: exactly one succeeds |
| K3 | Allocation against a concurrent void: one wins; invariants hold |
| K4 | Refund against a concurrent allocation of the same receipt |
| K5 | Five parallel issues of invoices and credit notes: unique, gap-free numbers per sequence |
| K6 | Request invoice and trip invoice created concurrently for the same ride: one succeeds |
| K7 | The same statement file imported in parallel: one import |
| K8 | Exception granted against a concurrent assign (P3b only) |
| K9 | Unapply and refund racing |

### Browser E2E (fictional data)
- Full pre-trip journey; deposit clearance badge on Dispatch.
- Dispatcher sees status but no amounts; driver sees nothing.
- Org B is denied by URL.
- Print views; axe accessibility; 390 / 820 / 1440 layouts.

---

## 9. What this proposal does NOT do
- No card capture, no merchant-of-record role, and no funds custody.
- No Medicaid or broker claims (837 / EDI).
- No tax engine.
- No multi-currency.
- No automatic charges.
- No public payment links or emailing (deferred, and tied to PD-10 and the vendor BAA question).
- No change to Plus quotes.
- No activation of NP-RELEASE-01C.
- No real customer data.
