# NP-FIN-P0 — Decision register (proposed)

**Status:** every entry is **PROPOSED** and needs owner approval unless it is marked "follows existing decision".

**On approval:** copy accepted entries into the canonical `docs/product/decision-register.md` as **ZD-264 onward**, with `Status: CONFIRMED`. That follows the existing pattern used for `plus-decisions-proposed.md` → ZD.

**Existing decisions this register builds on:**
- NP-BILL-P1 D1 to D6 and R1 to R4;
- ZD-206 to ZD-263 (Plus);
- PD-10 and PD-11 (open).

---

### FD-01 — Pre-trip invoice creation trigger
- **Options:**
  - (a) automatic on request acceptance;
  - (b) manual "Create pre-trip invoice" from an accepted request;
  - (c) manual from a pending request.
- **Recommended:** **(b)**.
- **Rationale:**
  - Agencies vary in whether they prepay.
  - Automatic drafts would clutter and could bill rides that never happen.
  - A pending request is not yet a commitment.
- **Implications:** no change to `accept_transportation_request`. Billing staff need a clear "Accepted, not invoiced" queue.
- **Owner approval:** YES.

### FD-02 — Invoice-to-request / trip relationship
- **Options:**
  - (a) anchor pre-trip invoices to the request through a new `billing_invoice_requests` link, plus a cross-guard against trip invoices;
  - (b) create trips first, then invoice them (force trip creation before invoicing);
  - (c) allow both links on one invoice.
- **Recommended:** **(a)**, with `billing_invoices.basis = 'request' | 'trips'`.
- **Rationale:** a request exists before trips and may yield several trips (return, recurring). Option (b) couples billing to scheduling. Option (c) makes the double-billing rules ambiguous.
- **Implications:**
  - A new link table with a partial unique index.
  - A two-way double-billing guard under locks (concurrency test K6).
  - The existing post-trip path stays as is.
- **Owner approval:** YES.

### FD-03 — Can issued invoices change? Numbering
- **Options:**
  - (a) frozen; corrections by void (net zero), credit note or adjustment invoice;
  - (b) editable with a revision history.
- **Recommended:** **(a)**. This follows BILL-P1 D4. One shared `INV-` sequence for both bases; credit notes `CN-`; receipts `RCPT-`.
- **Rationale:** an auditable, gap-free numbered document trail.
- **Implications:** P4 adds credit-note and adjustment-invoice documents.
- **Owner approval:** confirm the separate CN- / RCPT- sequences.

### FD-04 — Deposits
- **Options:**
  - (a) a deposit field on the request-basis invoice (amount, due date);
  - (b) a separate deposit invoice followed by a balance invoice;
  - (c) no deposits; full prepay only.
- **Recommended:** **(a)**.
- **Rationale:** one document for the customer. Clearance reads "deposit met". Two invoices double the paperwork.
- **Implications:** new frozen invoice columns; clearance logic; print shows "Deposit due".
- **Owner approval:** YES.

### FD-05 — Payment ledger shape (receipts + allocations)
- **Options:**
  - (a) keep `billing_payments` (one payment = one invoice; no credit);
  - (b) introduce `billing_receipts` + `billing_allocations` + `billing_refunds`, make `billing_record_payment` a compatibility wrapper, and retire `billing_payments` (0 production rows);
  - (c) add a nullable `invoice_id` plus an allocation table beside the old ledger.
- **Recommended:** **(b)**, done **before real payments accumulate**.
- **Rationale:**
  - It supports partial and multiple payments, one receipt across many invoices, prepayment credit, refunds and reconciliation.
  - Option (c) leaves two sources of truth.
- **Implications:**
  - A schema change to a production table.
  - The migration should run while production still has 0 payment rows. Verify at preflight; STOP if it is not 0.
  - Receipt print changes.
- **Owner approval:** YES (production migration).

### FD-06 — Partial payment allocation rules
- **Options:**
  - (a) staff choose the invoices and amounts explicitly;
  - (b) automatic oldest-first;
  - (c) (a) with a suggested oldest-first default.
- **Recommended:** **(c)**.
- **Rationale:** it is fast and stays under human control. Leftover money becomes customer credit, not an error.
- **Implications:**
  - A credit balance per payer becomes visible.
  - Credit applies only to the same payer and organization (FK-enforced).
- **Owner approval:** YES.

### FD-07 — Clearance policy model and verification level
- **Options:**
  - (a) one organization default only;
  - (b) organization default + payer terms + per-invoice deposit + exceptions;
  - (c) per-service-type policy.
- **Recommended:** **(b)**.
- **Rationale:** it covers private individuals (prepay or deposit) and facilities (terms). Option (c) ties money to health-indicative service types.
- **Verification:** card and ACH count once recorded with a provider reference (level 2). Cash and check count when recorded.
- **Implications:** a `billing_settings` row per organization and `billing_payer_terms`.
- **Owner approval:** YES (defaults).

### FD-08 — Dispatch enforcement
- **Options:**
  - (a) advisory only: badges plus a warning in the assign dialog;
  - (b) opt-in hard block inside `assign_trip` with exceptions;
  - (c) always a hard block.
- **Recommended:** **(a) in P3a**, then **(b) as a separate owner-approved P3b**. Never (c).
- **Rationale:**
  - Blocking assignment touches the core operational RPC and could strand a rider.
  - Advisory delivers most of the value.
  - Opt-in enforcement still requires an exception path.
- **Implications:**
  - P3b changes `assign_trip` (Core): regression across dispatch, mutation, assignment and concurrency suites.
  - A rider-safety review.
- **Owner approval:** YES, for each of P3a and P3b.

### FD-09 — Financial roles
- **Options:**
  - (a) Organization Admin only (current BILL D2);
  - (b) add a `billing` module grant (`read` / `write`) through `membership_module_grants`, with Admin implicit write and dispatchers seeing clearance status only;
  - (c) a new membership role "finance".
- **Recommended:** **(b)**.
- **Rationale:**
  - It reuses the proven grant pattern (Plus team access).
  - No change to the role enum.
  - Dispatchers need status, not amounts.
- **Implications:**
  - `has_billing_access(org, 'read'|'write')` helper.
  - RLS policies updated from admin-only to the helper. This is a **change to existing billing policies, made more permissive**, which needs review.
  - Refunds and exceptions are possibly Admin-only (sub-decision).
- **Owner approval:** YES.

### FD-10 — Post-trip adjustments, cancellation and no-show
- **Options:**
  - (a) credit notes + adjustment invoices + refunds, all manual;
  - (b) reopen invoices for edit;
  - (c) automatic cancellation fees.
- **Recommended:** **(a)**.
- **Rationale:** immutable trail; no surprise charges.
- **Sub-decisions:**
  - whether a cancellation or no-show fee is allowed, and its default (none);
  - whether refunds over a threshold need an Admin.
- **Owner approval:** YES.

### FD-11 — Accepted Plus quote → Core invoice
- **Options:**
  - (a) read-only import of the latest **accepted** quote via `plus_request_attributions`, snapshotting the number, kind and components; Plus is not modified;
  - (b) a Plus button "Create invoice" calling Core;
  - (c) copy the quote into the invoice automatically on conversion.
- **Recommended:** **(a)**. This extends BILL R3 to request-basis invoices.
- **Plus may display** "Invoiced · Paid / Balance" on the opportunity through a Core read RPC, gated by the billing-read permission.
- **Rationale:**
  - Preserves Plus ownership and quote versioning.
  - Avoids a second ledger.
  - Avoids automatic financial documents.
- **Implications:**
  - Only accepted quotes import for pre-trip invoices. Post-trip keeps sent or accepted per BILL R3.
  - A quote revised after import does not change the issued invoice.
- **Owner approval:** YES (the read-display in Plus).

### FD-12 — Consolidated / facility billing
- **Options:**
  - (a) defer;
  - (b) multi-passenger invoices;
  - (c) periodic facility statements that aggregate existing invoices.
- **Recommended:** **(a) now, (c) later**.
- **Rationale:**
  - R1 (one passenger per invoice) keeps privacy and line clarity.
  - Statements give facilities a monthly view without mixing riders on one document.
- **Owner approval:** YES (deferral).

### FD-13 — Accounting source of truth
- **Options:**
  - (a) Nemryn is authoritative; one-way export to accounting;
  - (b) the accounting system is authoritative;
  - (c) two-way sync.
- **Recommended:** **(a)**.
- **Rationale:** operational billing lives with the trip. Two-way sync creates conflicts.
- **Implications:** external ids stored; documents are never edited from accounting.
- **Owner approval:** YES.

### FD-14 — Tax
- **Options:**
  - (a) no tax (current);
  - (b) a manual tax line per invoice;
  - (c) a tax engine.
- **Recommended:** **(a)** until a customer needs tax, then (b).
- **Rationale:** most private-pay NEMT rides are not taxed. State rules vary, so counsel or a CPA should confirm per state.
- **Owner approval:** YES; flag for CPA review.

### FD-15 — Refund versus settlement reconciliation
- **Options:**
  - (a) refunds recorded manually and matched to statement lines in P5;
  - (b) refunds only through provider webhooks (P6).
- **Recommended:** **(a)**, then auto-proposals from webhooks in P6.
- **Rationale:** a manual-first, provider-agnostic workflow that works for cash and check too.
- **Owner approval:** YES.

### FD-16 — Data minimization in financial records
- **Options:**
  - (a) generic descriptions; no service_type or notes in lines, receipts, exports, provider metadata or audit;
  - (b) allow the service type on invoices.
- **Recommended:** **(a)**. Generic descriptions extend the BILL-P1 practice.
- **Rationale:** the PD-10 / PD-11 gates are open, and the data is health-indicative.
- **Owner approval:** YES; counsel to confirm (links NP-LAUNCH-02 Q-C2).

### FD-17 — Real-data gate
- **Options:**
  - (a) NP-FIN features follow the NP-LAUNCH-02 GO checklist; synthetic data until then, except the owner-operated Zenward tenant;
  - (b) no gate.
- **Recommended:** **(a)**.
- **Owner approval:** YES.
