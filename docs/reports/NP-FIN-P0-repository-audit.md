# NP-FIN-P0 — Repository audit (financial architecture)

**Date:** 2026-10-28. **Read-only audit.** No code, migration, RLS, production or Git change.

**Base:**
- `main` = `85f2042` (PR #43 merged).
- Production has 98 migrations; the head is `20261028100000`.

**Production reads:** SELECT-only aggregate counts.

**Legend:**
- **[FACT]** confirmed in the repository or production.
- **[ASSUMPTION]** inference that needs confirmation.

---

## 0. Headline

> **[FACT]** Nemryn already has a production Core billing ledger, NP-BILL-P1 (PR #41, migrations `20261027100000` and `20261027110000`).
>
> It covers:
> - draft, issued and void invoices;
> - per-organization numbering;
> - frozen issued invoices;
> - a one-active-invoice-per-trip guard;
> - optional Plus quote import;
> - an append-only manual payment ledger with reversals;
> - print views;
> - full audit, RLS and concurrency tests.
>
> NP-FIN must **extend** this foundation, not replace it. Its post-trip design conflicts with pre-trip invoicing and multi-invoice allocation in six specific places (section 9).

**Production financial state** [FACT, aggregates on 2026-10-28]:

| Item | Count |
|---|---|
| `billing_invoices` | 1, a draft |
| `billing_payments` | 0 |
| `plus_quotes` | 9 (accepted 1, sent 1, declined 1, superseded 2, withdrawn 4) |
| `organization_service_offerings` | 11 rows |

No real payments are recorded yet. Schema changes to the payment ledger are therefore cheapest **now**.

---

## 1. Requests and trips

### transportation_requests
[FACT] Defined in `supabase/migrations/20260830131000…` and earlier core migrations. Extended by:
- `20260919130000_structured_website_intake_extension.sql`
- `20260919140000_requested_passenger_name_extension.sql`
- `20260924090000_request_decision_workflow_expand.sql`

| Aspect | Detail |
|---|---|
| States | `pending`, `accepted`, `declined`, `cancelled` (check constraint) |
| Columns | requester name / relationship / phone / email, `passenger_id` (nullable), pickup / destination descriptions, `preferred_date` / `preferred_time`, `return_trip_needed`, `assistance_notes`, `additional_notes`, `service_type`, `requested_passenger_name`, `source` (`phone`, `web`, …), `intake_integration_id` |
| Writes | `log_transportation_request`, `accept_transportation_request` (Admin / Dispatcher; pending → accepted under a row lock), `decline_transportation_request`, `cancel_transportation_request`, `link_request_passenger` |

### trips
[FACT] Defined in `supabase/migrations/20260830131000_trips.sql`.

| Aspect | Detail |
|---|---|
| States | `scheduled`, `en_route_to_pickup`, `arrived_at_pickup`, `passenger_onboard`, `en_route_to_destination`, `arrived_at_destination`, `completed`, `cancelled`, `no_show` |
| Columns | `request_id` (nullable), `passenger_id`, `scheduled_pickup_at`, `appointment_at`, facility ids, `requires_wheelchair_access`, `assistance_notes`, `instructions`, `completed_at`, `cancelled_at`, `cancellation_reason`, `no_show_at`, `recurring_arrangement_id`, `expected_duration_minutes` |

Trip write paths [FACT]:
- `create_trip`: Admin / Dispatcher. Its comment calls it "the sole controlled path to create a Trip"; the state is always `scheduled`. The latest definition is in `20260926100000_availability_capability.sql`.
- `create_trip_for_recurring_occurrence`.
- `assign_trip`: `20260831100200_controlled_trip_mutations.sql:540`, later redefined.
- `update_trip_details`, `cancel_trip`, `record_no_show`, `record_trip_completion_by_operations`.
- The driver lifecycle RPCs: `driver_start_to_pickup` … `driver_complete_trip`.

Request-to-trip cardinality:
- [FACT] `trips.request_id` lets one request produce several trips (outbound, return, and recurring occurrences through `recurring_arrangements`).
- [ASSUMPTION] Most private-pay requests become 1 or 2 trips.

### Dispatch
- [FACT] `/operations/dispatch` and `assign_trip` contain **no financial check**.
- [FACT] Assignment is the natural clearance point. Trip creation is not: it happens at acceptance, often before payment.

---

## 2. Organizations and tenancy

- [FACT] `organizations` holds `name`, `timezone`, `business_phone`, `business_email` and `business_address`. There is no tax-ID field.
- [FACT] `memberships` holds roles `organization_admin`, `dispatcher` and `driver`.
- [FACT] The helpers are `has_org_role(org, roles[])` and `is_org_member`.
- [FACT] The tenant-safety convention is a composite `(id, organization_id)` key on every org-scoped table, with composite foreign keys.
- [FACT] `organization_modules` holds the Plus entitlement.
- [FACT] `membership_module_grants` (`20261013160100_plus_member_grants.sql`) holds per-member module grants (`module`, `access`, granted / revoked by). It is a reusable pattern for a future **billing grant**.

---

## 3. Existing financial tables: NP-BILL-P1 (production)

### Migration `20261027100000_core_billing_foundation.sql` [FACT]

| Table | Purpose and key rules |
|---|---|
| `billing_invoice_counters` | Per-organization `next_number`, updated under a row lock |
| `billing_invoices` | Status is `draft`, `issued` or `void`; only draft → issued and issued → void are allowed (trigger). `bill_to_kind` is `passenger`, `requester`, `facility` or `other`, with a composite FK to each; the bill-to text is a snapshot. `passenger_id`. `source_quote_id` / `source_quote_number` / `source_quote_kind` (optional composite FK to `plus_quotes`). `subtotal_cents`, `discount_cents`, `total_cents` (bigint; total = subtotal − discount; > 0 once issued). `currency` is fixed to `'USD'` by a check. `issue_date` / `due_date`, `terms_note`, `version`, an idempotency key unique per organization, and actor columns. Issued and void invoices are frozen by trigger, including against direct owner edits. Only drafts are deletable. |
| `billing_invoice_trips` | Invoice ↔ trip links. `UNIQUE (trip_id) WHERE released_at IS NULL` puts a trip on at most one active invoice. Void releases the link. |
| `billing_invoice_lines` | `position` 1..200, `description`, `quantity numeric`, `unit_cents`, `amount_cents`, `source` (`trip`, `quote` or `manual`), and a trip FK **through** `billing_invoice_trips` so lines may reference only the invoice's own trips. Lines can change only in a draft. |
| `billing_payments` | An append-only ledger: UPDATE, DELETE and TRUNCATE are refused by trigger. `entry_kind` is `payment` or `reversal`. `amount_cents` is between 1 and 1e11. `received_on`. `method` is `cash`, `check`, `card_external`, `bank_transfer` or `other`. Also `reference`, `note`, `reverses_payment_id` (unique, so each payment can be reversed once), `reason`, and an idempotency key unique per organization. **`invoice_id NOT NULL`**. Entries are allowed only on issued invoices. |

RLS and grants [FACT]:
- RLS is on for every table.
- Only `SELECT` is granted to `authenticated`, with policies for Organization Admins of the same organization.
- There are no write grants. Counters are revoked from every client role.

### Migration `20261027110000_core_billing_rpcs.sql` [FACT]
All functions are SECURITY DEFINER with a pinned `search_path`. Errors use ZW001 to ZW006.

| RPC | Rules |
|---|---|
| `_billing_require_admin` | Organization Admin only (BILL D2) |
| `billing_create_invoice_draft` | Trips must be **`completed`** (`trip_not_completed`, ZW004) and belong to **one passenger** (`mixed_customers`). They must not already be invoiced. The bill-to must be linked to every trip. Optional quote import requires a sent or accepted quote attributed to every trip's request, and the quote lines replace the trip lines. |
| `billing_update_invoice_draft` | Lines, discount, bill-to text, terms; expected version enforced |
| `billing_discard_invoice_draft` | Releases the trips; no number is used |
| `billing_issue_invoice` | Counter lock, snapshot, freeze; default due date issue + 15 days |
| `billing_void_invoice` | Only at **net zero paid**; reason required; the number is kept |
| `billing_record_payment` | Issued invoices only; **`amount ≤ balance` (no overpayment)**; `received_on` no later than today and no more than 365 days before issue; idempotent |
| `billing_reverse_payment` | Once per payment; reason required |
| Read RPCs | `billing_list_billable_trips`, `billing_list_invoices`, `billing_get_invoice`, `billing_trip_status`, `billing_summary` |

Other facts:
- [FACT] Audit rows record ids, amounts and statuses only: no names, references or notes (BILL R4).
- [FACT] Paid amount, balance and display status are **derived**, never stored: `draft`, `issued`, `partially_paid`, `paid`, `void`, plus an overdue badge in the organization's timezone.

### Application code [FACT]
- `src/lib/billing/billing-core.ts` (+ `billing-core.test.mjs`) and `src/lib/billing/billing.ts`.
- `src/app/operations/billing/{page.tsx, actions.ts, new/page.tsx, invoices/[invoiceId]/page.tsx}`.
- `src/app/invoice-print/[invoiceId]/page.tsx` and `src/app/receipt-print/[paymentId]/page.tsx`.
- `src/components/billing/{BillingTables, NewInvoiceForm, InvoiceDraftEditor, InvoiceActions, TripBillingPanel, BillingPrintToolbar}.tsx`.
- The Trip Detail Billing panel, in `src/app/operations/trips/[tripId]/page.tsx`.

### Tests [FACT]
- `supabase/tests/billing_tests.sql`: 67 tests.
- `supabase/tests/billing_concurrency_test.sh`: isolation-guarded.
- `tests/e2e/billing/billing.e2e.mjs`: 50 checks.
- Billing objects are included in `supabase/tests/privilege_contract_tests.sql`.

### Documentation [FACT]
- `docs/reports/NP-BILL-P1-contract-and-decisions.txt`: decisions D1 to D6, approved, plus refinements R1 to R4.
- `NP-BILL-P1-implementation.txt` and the release and closeout reports.

### Other money-related data [FACT]
- There are **no** rate cards, price lists, tax tables, deposits, credits, refunds, provider ids, fees or payouts anywhere.
- `organization_service_offerings` holds service types only, with no prices.

---

## 4. Plus quotes, opportunities and conversion

### Plus quotes
[FACT] Defined in `20261018100000_plus_quotes_foundation.sql`; later changes are in `20261019100000…`, `20261020100000…` and `20261021100000…`.

| Aspect | Detail |
|---|---|
| Fields | `kind` is `estimate` or `quote`; per-organization `quote_number` through `plus_quote_counters`; itemized integer cents (base, mileage, wait, extra stops, mobility assistance, escort, return leg, other, discount, total); `currency 'USD'`; `valid_until`; `terms_note`; `service_type`; `round_trip`; `distance_miles` |
| Statuses | `draft`, `sent`, `accepted`, `declined`, `superseded`, `withdrawn` |
| Rules | Revisions supersede earlier quotes, with a single active quote per opportunity (ZD-212 to ZD-225). Quotes contain no addresses or medical data (ZD-220). |

### Conversion
[FACT] `plus_convert_opportunity_to_request` is currently defined in `20261028100000_plus_booking_passenger_handoff.sql:239`.
- It needs Plus write access plus the Core role that logs requests.
- It turns an open opportunity into **one pending Core request** through `log_transportation_request`.
- It records a `plus_request_attributions` row (`request_id` PK, `opportunity_id`, `contact_id`, `link_method`, `conversion_idempotency_key`).
- It can optionally link an existing passenger atomically (P1-D2).
- `plus_convert_inquiry` handles inquiries.

### The bridge from a quote to a Core invoice [FACT]
`transportation_requests ← plus_request_attributions.opportunity_id → plus_quotes (accepted)`.

BILL-P1 already uses this path, read-only, for quote import, and snapshots the quote number. **No Plus table or RPC needs to change** for pre-trip invoicing to use an accepted quote.

[FACT] `plus_opportunities.payment_reported_status` is a staff-entered label, not a ledger. It must stay non-authoritative.

---

## 5. Service types
- [FACT] The closed list is `medical_appointment`, `dialysis`, `rehabilitation`, `hospital_discharge`, `recurring_care`, `senior_medical`, `wheelchair_transportation`, `airport_transportation` and `other`.
- [FACT] They are enforced by a check constraint on requests and a matching list in `src/lib/public-intake/website-intake-core.ts`. Plus quotes carry `service_type`.
- [FACT] The BILL-P1 trip line description is generic ("Transportation Mon DD, YYYY") and does **not** include the service type.

---

## 6. Access roles and financial permissions [FACT]
- Billing reads and writes are **Organization Admin only** (BILL D2). Dispatchers and drivers see no billing. The sidebar's Administration → Billing is admin-only.
- `audit_events` has SELECT for Organization Admins and Platform Admins only (`20260830131700_rls_policies.sql:432-440`). Dispatchers and drivers have none.
- [FACT] `audit_events` is append-only **by grants** (no client write path); no trigger guards owner edits.
- [ASSUMPTION] This is adequate, because all writes are RPC-mediated.

---

## 7. UI navigation and test infrastructure [FACT]
- **Sidebar:** Today, Planning, Records, Growth (Plus), and Administration (Drive, Billing, Settings). The definitions are in `src/lib/operations/nav-core.ts`.
- **Database tests:** `supabase/tests/*.sql` are rollback-only suites, and the `*_concurrency_test.sh` scripts run against the isolated stack, with a fingerprint guard.
- **Privilege contract:** a single SELECT, safe to run on production.
- **Browser E2E:** `tests/e2e/*` run on NemrynS1Iso (`:3100`), plus QA2 strict and Quotes strict.
- **Unit tests:** `node --test` via `npm test`.
- **CI:** `.github/workflows/release-db-compat.yml` (report-only) and `release-gate-tests.yml` (runs only for migration and release-script changes).

---

## 8. Pending work and release constraints [FACT]
- **Branches and PRs:** every local and remote branch is merged into `origin/main`, and no PR is open. The worktree `~/Nemryn-nc-intake-airport` is merged too.
- **Working tree:** this tree (`np-pilot-p2-onboarding`, already merged) has untracked reports and `.tmp-qa` scripts only.
- **Production migration process:** read-only preflight, then a fresh encrypted backup, then owner authorization, then apply, then read-only verification. There is no automatic production smoke.
- **NP-RELEASE-01C** deployment-gate enforcement stays **paused** (report-only).
- **Open blockers:**
  - PD-10 (HIPAA / BAA gate) and PD-11 (retention / erasure) are **OPEN**.
  - NP-LAUNCH-02 / 03A: real customer data exists in the Zenward tenant; no Core erasure exists yet.
- **Canonical decision location:** `docs/product/decision-register.md` (ZD-001 to **ZD-263**), with proposals in `docs/product/plus-decisions-proposed.md`. NP-FIN decisions (FD-xx in this audit) should be recorded there as ZD-264 onward once approved.

---

## 9. Conflicts between BILL-P1 and NP-FIN goals [FACT-based]

| # | BILL-P1 rule (fact) | NP-FIN need | Effect |
|---|---|---|---|
| C1 | Invoices require **completed** trips (`trip_not_completed`) | Pre-trip invoice from an approved request | A new invoice basis is needed (request-anchored) |
| C2 | Lines and links attach to **trips** only | A request may have no trip yet, or 2+ trips later | A request link plus a cross-guard against double billing |
| C3 | `billing_payments.invoice_id NOT NULL`; one payment = one invoice | One receipt allocated to many invoices; deposits before an invoice | Separate money received (receipts) from allocations |
| C4 | Overpayment blocked (`amount ≤ balance`) | Prepayments and credit on account | An unallocated receipt balance (customer credit) |
| C5 | Reversal = correction only; no refunds; void only at net 0 | Refunds, credits and post-trip adjustments | Refund and credit-note documents |
| C6 | Method list only; no gross / net / fee / provider ids; admin-only | Provider fees, settlements, reconciliation, a finance role | New fields and tables; a billing grant |
| C7 | One passenger per invoice (R1) | Consolidated facility billing | Defer; a later facility statement |
| C8 | No financial check in `assign_trip` | Dispatch clearance | A clearance read model; enforcement only by decision |

No conflict with Plus:
- quotes stay as they are;
- the invoice reads accepted quotes through the attribution path;
- Plus must never hold a ledger.
