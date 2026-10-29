# NP-FIN-P1 — Security and test plan

All tests run on the isolated NemrynS1Iso stack with **synthetic data only** (ZD-280).

Concurrency scripts use the existing isolation guard: the container `supabase_db_NemrynS1Iso`, the fingerprint `2/1/0`, and loopback only.

The SQL suites are rollback-only.

---

## 1. Threat model (financial)

| Threat | Control | Tests |
|---|---|---|
| Cross-tenant read or allocation | RLS `billing_can(org,'view')`; composite FKs on receipt ↔ allocation ↔ invoice ↔ refund ↔ reversal; RPCs filter by org | T-A*, T-X* |
| Privilege escalation (dispatcher, driver, anon, other tenant) | `_billing_authorize` action catalogue; no write grants; internal functions revoked | T-A* |
| Double-spend of a receipt | Lock order; I2; exactly-once apply / unapply | K-1, K-4, K-9 |
| Overpayment of an invoice | I1 under the invoice lock | K-2, T-I* |
| Refund above funds | refund ≤ unallocated under the receipt lock; I2 | K-4, T-R* |
| Retroactive edits or deletes | Append-only triggers, owner included; `billing_payments` retired | T-M* |
| Duplicate entry (double-click, retry, re-submission) | Idempotency keys; possible-duplicate confirmation; provider id uniqueness | T-D*, K-3 |
| Manual "verification" spoofing | Event check: `provider_confirmed` / `reconciled` cannot have source `staff` | T-V* |
| Sensitive actions by ordinary billing users | SENSITIVE catalogue entries pinned to OA | T-P* |
| Data leakage (names, references, medical) | Audit allow-list; no-PAN validation; generic descriptions | T-Y* |
| Void with money applied | I5 under the invoice lock | K-5, T-I* |
| Old app writing to the old table | `_billing_payments_retired` trigger | T-M* |

---

## 2. SQL suite `supabase/tests/billing_ledger_tests.sql` (new)

### T-A Access
| ID | Test |
|---|---|
| A1 | Every new RPC as anon / unauthenticated → ZW001 |
| A2 | As driver, dispatcher, an inactive member, a suspended organization, or a Platform Admin grant alone → ZW002, with no existence oracle (same message for a missing or foreign id) |
| A3 | SELECT on each new table as each of those roles → 0 rows; as OA of org A → only org A rows |
| A4 | Direct INSERT / UPDATE / DELETE on every new table as `authenticated` → permission denied |
| A5 | Internal `_billing_*` functions are not executable by `authenticated` |

### T-X Cross-tenant
| ID | Test |
|---|---|
| X1 | Allocate an org A receipt to an org B invoice (RPC → ZW002; a forced direct insert as owner → FK violation) |
| X2 | Refund or reverse an org B receipt as org A's OA → ZW002 |
| X3 | Payer reference to org B's passenger, request or facility → refused |
| X4 | `billing_get_invoice_ledger` and `billing_list_receipts` never return org B rows |

### T-I Invariants
| ID | Test |
|---|---|
| I1 | Allocate above the invoice balance → ZW006 `amount_exceeds_balance` |
| I2 | Allocations summing above the receipt gross → ZW006 |
| I3 | Allocate to a draft or void invoice → ZW004 |
| I4 | Currency mismatch (direct owner insert) → refused by the trigger |
| I5 | Void with a net allocation > 0 → ZW004. Unapply then void → succeeds. |
| I6 | Unapply twice → second time ZW004; partial unapply not accepted |
| I7 | Deferred trigger: an owner transaction bypassing the RPC still fails at commit when an invariant breaks |

### T-R Refunds and reversals
| ID | Test |
|---|---|
| R1 | Refund ≤ unallocated → ok; refund > unallocated → ZW006 `refund_exceeds_refundable` |
| R2 | Refund with allocations outstanding: limited to the unallocated part |
| R3 | Several refunds summing to gross → state `refunded`; any further refund → ZW006 |
| R4 | Receipt reversal with allocations or refunds present → ZW004; after unapplying → ok; a second reversal → ZW004 |
| R5 | A reversed receipt cannot be allocated or refunded |
| R6 | Reason is required for refund, unapply and reversal |

### T-M Immutability
| ID | Test |
|---|---|
| M1 | Owner UPDATE / DELETE / TRUNCATE on receipts, allocations, refunds, reversals and receipt events → refused |
| M2 | `billing_payments`: INSERT / UPDATE / DELETE / TRUNCATE refused ("retired"); SELECT still allowed for OA (transition release) |
| M3 | BILL-P1 invoice freeze is unchanged (re-run of the existing assertions) |

### T-D Duplicates and idempotency
| ID | Test |
|---|---|
| D1 | Same idempotency key + same payload → same ids, `changed=false`; same key + different payload → ZW006 `idempotency_conflict` |
| D2 | Same method + reference_norm + amount + date → ZW006 `possible_duplicate` unless confirmed |
| D3 | `provider_txn_id` uniqueness per organization and provider (direct owner insert, since P1 has no writer) |
| D4 | The wrapper `billing_record_payment` keeps its BILL-P1 idempotency semantics |

### T-V Assurance facts
| ID | Test |
|---|---|
| V1 | `billing_add_receipt_evidence` accepts only `evidence_reference_noted` / `evidence_document_held` |
| V2 | A `provider_confirmed` or `reconciled` event with source `staff` → check violation (owner insert) |
| V3 | A reference given at recording → evidence `reference_noted`, never provider confirmation |
| V4 | The derived highest assurance is correct for each combination |

### T-P Permission catalogue
| ID | Test |
|---|---|
| P1 | Every action is in the catalogue; each SENSITIVE action maps to OA only |
| P2 | A simulated future `billing write` holder (catalogue test fixture) cannot run refund, unapply, reverse, void or cross-payer allocation |
| P3 | Cross-payer allocation without a reason → ZW006; with a reason → ok and audited with `different_payer=true` |

### T-Y Privacy
| ID | Test |
|---|---|
| Y1 | `audit_events.after_data` keys for every new action ⊆ the allow-list; no payer name, reference, note or reason text |
| Y2 | Reference or note with a 13+ digit run (spaced or dashed) → ZW006 `looks_like_card_or_account_number` |
| Y3 | No new function returns service_type, assistance notes or trip notes |

### T-C Compatibility
| ID | Test |
|---|---|
| C1 | `billing_record_payment` produces exactly one receipt and one allocation, returns `payment_id` = allocation id, the same paid and balance figures, and invoice version + 1 |
| C2 | `billing_reverse_payment` on a wrapper payment → unapply + reversal; balance restored; second call ZW004 |
| C3 | `billing_reverse_payment` on a shared receipt → ZW004 `use_receipt_page` |
| C4 | `billing_summary` totals equal the BILL-P1 formula on wrapper-only data |
| C5 | Legacy audit actions are still written by the wrappers |

---

## 3. Concurrency script `supabase/tests/billing_ledger_concurrency_test.sh` (new)

Parallel psql sessions with `pg_sleep` barriers, run against the isolated stack only.

| ID | Scenario | Expected |
|---|---|---|
| K-1 | Two allocations of one receipt to two invoices; sum > receipt | Exactly one commits; I2 holds |
| K-2 | Two receipts allocated to one invoice; sum > balance | Exactly one commits; I1 holds |
| K-3 | The same `record_receipt` key sent twice in parallel | One receipt; both callers get the same id |
| K-4 | Refund vs allocation on the same receipt, both orders | Never over-spent |
| K-5 | Allocation vs void on the same invoice, both orders | Either "paid, void refused" or "void, allocation refused" |
| K-6 | Five parallel `record_receipt` calls | `RCPT-` numbers 1..5, unique, no gaps |
| K-7 | Unapply vs refund racing on the same receipt | Consistent; I2 holds |
| K-8 | Receipt reversal vs allocation | One wins; I3 holds |
| K-9 | Wrapper `record_payment` ×2 from equal forms (the BILL-P1 S2 scenario) | One + ZW003 |
| K-10 | Deadlock probe: allocate(receipt R → invoices A, B) vs allocate(receipt S → invoices B, A) | No deadlock (ascending order) |

Final invariants after every scenario:
- for every invoice, 0 ≤ paid ≤ total;
- for every receipt, allocated + refunded ≤ gross;
- reversed receipts are at net zero;
- void invoices have net 0;
- no rows in `billing_payments`.

The existing `billing_concurrency_test.sh` (S1 to S8) is re-run with its invariant queries retargeted.

---

## 4. Unit tests (`node --test`)

`src/lib/billing/billing-core.test.mjs` (extended):
- receipt state derivation;
- payer-credit sums;
- refundable = unallocated;
- the oldest-first allocation suggestion: exact fill, partial, credit left over, and never above a balance;
- assurance ordering and labels ("Reference noted" vs "Provider confirmed");
- no-PAN detector cases;
- `RCPT-` formatting;
- method mapping (`card_external` → `card`).

---

## 5. Browser E2E `tests/e2e/billing/billing-ledger.e2e.mjs` (new; fictional organizations A and B)

| ID | Journey |
|---|---|
| E1 | Issue two invoices for one payer, then record one receipt that covers both plus $20; the suggested allocation fills the oldest first; both invoices are paid; the receipt shows $20 credit |
| E2 | A third invoice → "Apply payer credit" → partially paid |
| E3 | Refund the remaining credit (Admin): the maximum equals refundable; a refund above it is blocked in the UI and the server |
| E4 | Unapply (reason) → invoice reopens; void now allowed |
| E5 | Returned check: unapply plus reverse receipt ("returned_check") → invoice balance restored; receipt REVERSED on print |
| E6 | Duplicate warning on a re-entered check; confirm path |
| E7 | Assurance badges: "Reference noted"; "Provider confirmed" never appears |
| E8 | Dispatcher and driver: no Billing, no receipts URL access; org B admin denied by URL (receipt, ledger and print) |
| E9 | Print receipt (`RCPT-000001`, allocations, refund history) and print invoice (allocations) |
| E10 | axe (0 serious / critical) on the Receipts tab, receipt page, dialogs and print; layouts at 390 / 820 / 1440 |

The existing `billing.e2e.mjs` (50) runs with only the R3 receipt-number assertion updated (implementation plan §9).

---

## 6. Regression chain (all must pass before the PR)

1. `billing_tests.sql` (67, retargeted) and `billing_ledger_tests.sql`.
2. `billing_concurrency_test.sh` and `billing_ledger_concurrency_test.sh`.
3. `privilege_contract_tests.sql`: 0 violations.
4. Core suites: mutation, assignment and lifecycle (unchanged areas, run as a guard).
5. `npm test`, `npm run test:release`, tsc, eslint (no new warnings), next build.
6. E2E: billing (50), billing-ledger (new), handoff, onboarding, p1b, QA2 strict, Quotes strict, consents, inquiries staff and off.

---

## 7. Release gates

| Gate | Requirement |
|---|---|
| Production preflight G1 to G6 | Implementation plan §10. **G1: `billing_payments` = 0, or STOP.** |
| Migration self-assert | The migration re-checks G1 inside its transaction |
| Post-migration read-only | Privilege contract 0 violations; new tables empty; `billing_payments` retired trigger present; grants as designed; invoice count unchanged |
| Production verification | UI load-only on the Pilot Simulation tenant. **No receipt is recorded in production.** |
| Next release | Revoke SELECT on `billing_payments` (FIN-P1+1) after the new app is confirmed live |
