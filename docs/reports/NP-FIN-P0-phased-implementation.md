# NP-FIN-P0 — Phased implementation (proposed)

**Status: PROPOSAL.** Nothing has started. Each phase follows the established cycle:
1. its own branch from `main`;
2. migrations;
3. rollback-only SQL suite, concurrency script, unit tests and E2E on the isolated stack;
4. PR;
5. owner review;
6. production release (read-only preflight, then fresh encrypted backup, then owner authorization, then apply, then read-only verification).

NP-RELEASE-01C stays paused. All test data is fictional.

## Refinement of the proposed sequence

The brief's order (P1 pre-trip invoice → P2 payment ledger) is **swapped**:

| Proposed | Phase | Why |
|---|---|---|
| **FIN-P1** | Payment ledger re-foundation (receipts, allocations, refunds) | Production has **0** rows in `billing_payments`. Pre-trip invoicing creates prepayments and credits that the current ledger cannot represent (conflicts C3 and C4). Changing the ledger first avoids migrating real money records later. |
| **FIN-P2** | Pre-trip (request-basis) invoices + deposits | Needs P1's allocation model for deposits and credit |
| **FIN-P3a** | Clearance read model + advisory dispatch badges | Needs P1 and P2 |
| FIN-P3b | Opt-in clearance enforcement in `assign_trip` | Separate approval (FD-08) |
| FIN-P4 | Post-trip closeout: credit notes, adjustment invoices, refunds UI, billing grant (FD-09), Plus read-display (FD-11) | Needs P1 to P3a |
| FIN-P5 | CSV statement import + reconciliation | Needs P1 (receipts, refunds) |
| FIN-P6 | Provider webhooks + accounting export | Needs P5; separate vendor, BAA and legal review |

**Smallest commercially useful MVP:** **FIN-P1 + FIN-P2 + FIN-P3a**. An agency can:
- issue a pre-trip invoice from an accepted request or quote, with a deposit;
- record full, partial or multiple external payments (credit on account included);
- see "Cleared / Deposit met / Awaiting payment" on Dispatch and Trip Detail.

Everything else is additive.

FIN-P0 (this audit) is complete when the owner approves the decision register.

---

## FIN-P1 — Payment ledger re-foundation
- **Scope:**
  - Receipts (gross, fee, net, method, provider, external id, verification level, evidence note, payer snapshot), allocations (apply / unapply) and refunds.
  - Receipt reversal for entry errors.
  - Per-org `RCPT-` numbering.
  - `billing_record_payment` and `billing_reverse_payment` re-implemented as compatibility wrappers.
  - `billing_payments` retired.
  - Payer credit balance (derived).
- **Dependencies:**
  - FD-05 and FD-06 approved.
  - Production preflight confirms `billing_payments` = 0 rows. **STOP if not 0** (a data migration plan would then be needed).
- **Schema:**
  - `billing_receipt_counters`, `billing_receipts`, `billing_allocations`, `billing_refunds`, `billing_receipt_reversals`.
  - Invariant triggers.
  - Composite FKs.
  - Partial unique `(organization_id, provider, external_txn_id)`.
  - Drop, or freeze and revoke, `billing_payments` (owner choice).
- **UI:**
  - Invoice page: "Record payment" gains method, provider, reference, fee (optional) and an allocation preview. An "Apply customer credit" action. A Receipts list.
  - Receipt print shows the `RCPT-` number.
  - A payer credit badge.
- **Security:**
  - Admin-only, as now (FD-09 comes in P4).
  - Append-only, including for the owner.
  - Lock order receipt → invoices.
  - Audit without names or references.
- **Tests:** S1 to S7, S9 and S11; K1 to K5 and K9; a BILL-P1 regression (67 SQL + 50 E2E adapted); unit tests for money and allocation math.
- **Acceptance:**
  - All existing BILL-P1 E2E journeys pass unchanged in behaviour.
  - One receipt can be allocated to two invoices.
  - Overpayment becomes credit.
  - A refund is limited to the unallocated amount.
  - Invariants hold under the concurrency script.
- **Risks:** a production table change (mitigated by the 0-row gate); receipt print URL changes. **Exclusions:** imports and providers.
- **Independent release:** YES. It can be released alone, and the UI stays BILL-P1-compatible.

## FIN-P2 — Pre-trip invoices and deposits
- **Scope:**
  - Request-basis invoices from ACCEPTED requests, with a two-way double-billing guard against trip-basis invoices.
  - Quote import (accepted only).
  - Deposit amount and due date.
  - "Accepted, not invoiced" queue.
  - Request Detail Billing panel.
- **Dependencies:** FIN-P1; FD-01 to FD-04 and FD-11.
- **Schema:**
  - `billing_invoices.basis`, `deposit_required_cents`, `deposit_due_date`.
  - `billing_invoice_requests` with partial unique index and guards.
  - Line `source` gains `request`.
  - The RPC `billing_create_request_invoice_draft`.
  - The existing trip-basis create path gains the cross-guard.
- **UI:**
  - Billing → new "Accepted requests" tab.
  - Request Detail panel.
  - Invoice print: "Pre-trip invoice", "Deposit due".
- **Security:** request ownership re-check; quote read only through attribution and Plus read; no Plus writes.
- **Tests:** S3 and S4 (request variants), S6 for deposit columns, K6, quote-import cases (accepted only; revised quote after issue doesn't change the invoice); E2E: request → quote → pre-trip invoice → deposit → balance.
- **Acceptance:**
  - A ride can never be invoiced twice through request and trip paths, in either order, including concurrently.
  - The deposit is shown and frozen at issue.
- **Risks:** a cancelled request with a paid invoice needs P4 tools. Until then, show "Needs closeout", and the void and refund path through P1 refunds applies.
- **Independent release:** YES, after P1.

## FIN-P3a — Clearance read model + advisory dispatch
- **Scope:**
  - `billing_settings` (organization default policy) and `billing_payer_terms` (facility terms).
  - `billing_dispatch_exceptions`.
  - `billing_trip_clearance()`, which returns status only.
  - Badges on Dispatch board, Trip Detail and the assign dialog (warning text only).
- **Dependencies:** P1, P2; FD-07 and FD-08(a).
- **Schema:** the three tables above + the read function. **No change to `assign_trip`.**
- **UI:**
  - Billing settings card (policy, deposit default).
  - Facility terms on the Facility page (admin).
  - Exception dialog (admin).
- **Security:**
  - Dispatchers receive status only, never amounts.
  - Exceptions are append-only with an expiry.
  - Payer terms are admin-only.
- **Tests:** S8 and S1; the dispatch E2E with each policy; a dispatcher sees status without amounts; a performance check on the dispatch board (batch function).
- **Acceptance:** the status is correct for every policy, terms and exception combination; dispatch behaviour is unchanged apart from badges.
- **Risks:** stale clearance shown (derived per request, so it is not cached). **Exclusions:** blocking.
- **Independent release:** YES.

## FIN-P3b — Opt-in enforcement (only if approved)
- **Scope:** per-organization `enforce_clearance_on_assign`; `assign_trip` calls `billing_assert_trip_cleared`; an exception path.
- **Dependencies:** P3a in production use plus a separate owner approval.
- **Schema:** a settings flag + a change to the core `assign_trip` RPC.
- **Tests:** the full Core mutation, assignment, concurrency and dispatch regression; K8; rider-safety cases (an exception lets the trip proceed).
- **Independent release:** YES.
- **Risk:** HIGH. It touches the core operational path.

## FIN-P4 — Post-trip closeout and roles
- **Scope:**
  - Closeout queue (completed, no-show and cancelled trips with open balances).
  - Credit notes (`CN-`) and adjustment invoices.
  - A refunds UI.
  - Cancellation and no-show fee policy (FD-10).
  - **Billing module grant** (FD-09), with RLS policies moved to `has_billing_access`.
  - Plus opportunity read-display of invoice status (FD-11).
- **Schema:** `billing_credit_notes` (+ lines, counter), `adjusts_invoice_id`, grant helper, policy updates.
- **Tests:** S6 (credit notes), S10 (grants), cross-tenant credit notes; E2E closeout journeys; Plus read-display gating.
- **Risk:** the RLS policy change on existing billing tables (more permissive) needs a security review.
- **Independent release:** YES.

## FIN-P5 — CSV import and reconciliation
- **Scope:**
  - Statement imports (bank, Stripe and Square CSV exports).
  - Column mapping.
  - Idempotent line insert.
  - Match proposals, human approval and an unmatched queue.
  - Payout grouping and fee variance.
  - Verification level 3.
- **Schema:** `billing_statement_imports`, `billing_statement_lines`, `billing_payouts`, `billing_matches`.
- **Security:**
  - Server-side parsing with a size cap.
  - No service role in the browser.
  - Description truncation and a medical-content warning.
  - Imports are org-scoped and admin or billing-write only.
- **Tests:** S7 (file and line duplicates), K7, matching accuracy on fixtures, a privacy check on stored descriptions.
- **Independent release:** YES.

## FIN-P6 — Provider and accounting integrations
- **Scope:**
  - Stripe / Square webhook receivers creating **proposed** receipts and refunds.
  - `billing_provider_events` (unique event id).
  - Signing-secret verification.
  - One-way accounting export (QuickBooks / Xero), with external ids stored.
- **Dependencies:**
  - P5.
  - Vendor DPAs or BAAs (PD-10).
  - Counsel on what data leaves Nemryn.
  - Per-tenant credentials stored server-side, encrypted.
- **Security:** webhook replay and signature tests; tenant routing by connected account; no medical data in provider metadata.
- **Independent release:** YES, per provider.

---

## Cross-phase priorities and dependencies

```
FD approvals ─▶ FIN-P1 ─▶ FIN-P2 ─▶ FIN-P3a ─▶ (FIN-P3b optional)
                  │          └────▶ FIN-P4
                  └────────────────▶ FIN-P5 ─▶ FIN-P6
```

Phases P4 and P5 can run in parallel after P3a and P1 respectively. Only one migration-bearing branch should be active at a time (the established practice).

**Estimated size** [ASSUMPTION, based on BILL-P1 actuals: about 1,250 lines of SQL, 2,300 of app code and 1,150 of tests]:

| Phase | SQL lines | App lines | Notes |
|---|---|---|---|
| P1 | ~900 | ~1,200 | |
| P2 | ~700 | ~1,200 | |
| P3a | ~500 | ~900 | |
| P4 | ~1,000 | ~1,500 | |
| P5 | ~800 | ~1,500 | |
| P6 | | | Vendor-dependent |
