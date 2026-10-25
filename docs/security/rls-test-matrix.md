# Zenward Platform — RLS Test Matrix

**Work item:** P1-E2-S1 — Supabase Schema + RLS Foundation, amended by P1-E2-S1A — SECURITY DEFINER Exposure Audit, amended by P1-E2-S2 — Controlled Mutation & Transaction Boundary, amended by P1-E2-S3 — Secure Read Models & Driver Minimum-Necessary Projection, amended by P1-E3-S0A — Controlled Internal Trip Creation Boundary
**Status:** All tests below were actually executed against a running local Supabase/Postgres instance and passed. This is not a syntax-only claim.
**Last updated:** 2026-08-31

**NP-P2-S7-A note (public inquiry intake, 2026-10-24, isolated stack):**
- New tables:
  - `plus_inquiry_forms`: RLS `plus_can_read`; authenticated SELECT only.
  - `plus_inquiries`: RLS `plus_can_read`; column-level SELECT, never `idempotency_key`.
  - `plus_inquiry_public_access` and `plus_inquiry_rate_limit_events`: class A, with no privilege for anon / authenticated / service_role.
- Results: `supabase/tests/plus_inquiries_tests.sql` 59 / 59 and `plus_inquiries_concurrency_test.sh` (see the NP-P2-S7A report). They cover the role / tenant / grant / entitlement matrix, direct DML denial, service_role-only public RPCs, a Platform Admin without membership seeing no tenant rows, and the activation allowlist.
- `privilege_contract_tests.sql` lists every new table, column grant and function: 0 violations.
- Details: [plus-access-model.md](./plus-access-model.md) §6b and T34; the report `docs/reports/NP-P2-S7A-data-foundation-implementation.txt`.

**P1-E3-S0A note:** `create_trip`'s own test results (27 SQL assertions across 3 new suites, plus 6 real-HTTP cross-validation checks) are documented in [mutation-api.md](../data/mutation-api.md) "Testing" and the P1-E3-S0A completion report, not duplicated here.

**P1-E2-S2 note:** the mutation RPC layer's own test results (131 SQL assertions across 6 suites, a genuine two-process concurrency test, and 15 real-HTTP cross-validation checks — including the P1-E2-S2A idempotent-authorization audit) are documented in [mutation-api.md](../data/mutation-api.md) "Testing" and the P1-E2-S2/P1-E2-S2A completion reports, not duplicated here.

**P1-E2-S3 note:** the Driver read API's own test results (46 SQL assertions across 4 new suites, plus 15 real-HTTP cross-validation checks) are documented in [read-api.md](../data/read-api.md) "Testing" and the P1-E2-S3 completion report. Tests F ("Driver SELECT own assigned Trip") and I ("Driver SELECT driver_visible note") in the adversarial suite below changed from ALLOW to DENY in this phase — the old/new contract is documented inline in `rls_adversarial_tests.sql` itself (work item §58), not silently changed; see ZD-096.

This page's own 4 pre-existing suites (below) were re-run in full after every P1-E2-S2 and P1-E2-S3 migration and remain 32/32, 13/13, 7/7, 20/20 — zero regressions beyond the intentional, documented F/I contract change.

## Methodology (work item §53 — how actor context was simulated)

Every test runs against the local Supabase Postgres instance (`supabase start`, project-local, ports shifted to avoid an unrelated already-running local Supabase project on this machine — see `supabase/config.toml`). Tests connect as the `postgres` superuser (which has `BYPASSRLS`) and then, **inside each test**, run:

```sql
set local role authenticated;   -- or: set local role anon;
set local request.jwt.claim.sub = '<user-uuid>';
```

`request.jwt.claim.sub` is confirmed (via `\sf auth.uid`) to be exactly the GUC Supabase's own `auth.uid()` reads. `postgres` is a superuser and would otherwise bypass RLS entirely; `SET ROLE authenticated` is what actually makes a query subject to the same policies PostgREST would evaluate for a real authenticated request — **this is not a service-role shortcut**, it genuinely exercises the same RLS the running Postgres instance would apply to any real client, including a client that bypasses the (not-yet-built) application UI and calls the Supabase REST API directly. Every test resets to `postgres`/no role immediately after (`RESET ROLE`, or automatically at the end of each autocommitted statement).

Fixtures: `supabase/seed.sql` — fictional data only (two organizations, admin/dispatcher/driver users in each, one multi-org user, one platform admin, one user with zero memberships, one inactive membership, drivers/passengers/vehicles/facilities/trips/assignments/notes/exceptions). No real patient/person data.

**Run it yourself:**
```bash
supabase db reset
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/rls_adversarial_tests.sql
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/constraint_tests.sql
```

## Adversarial RLS test results (work item §54) — 32/32 PASS

| Test | Scenario | Expected | Result |
|---|---|---|---|
| A | Org A Admin SELECT Org A Trip | ALLOW | **PASS** |
| B | Org A Admin SELECT Org B Trip | DENY | **PASS** |
| C | Org A Dispatcher SELECT Org A Passenger | ALLOW | **PASS** |
| D | Org A Dispatcher SELECT Org B Passenger | DENY | **PASS** |
| E | Org A Driver directly SELECT Passenger | DENY | **PASS** — confirms ZD-080 holds even for the passenger on the driver's own assigned trip |
| F | Driver A SELECT own assigned Trip | ALLOW | **PASS** |
| G | Driver A SELECT Driver B's Trip in same Org | DENY | **PASS** |
| H | Driver A SELECT Org B Trip | DENY | **PASS** |
| I | Driver A SELECT driver_visible note on own assigned Trip | ALLOW | **PASS** |
| J | Driver A SELECT operations_only note | DENY | **PASS** |
| K | Driver A SELECT driver_visible note on another Driver's Trip | DENY | **PASS** |
| L | Driver A arbitrary Trip state UPDATE | DENY | **PASS** — denied at the column-privilege layer ("permission denied for table trips") before RLS is even reached |
| M | Driver A TripAssignment INSERT | DENY | **PASS** — RLS `WITH CHECK` violation |
| N | Driver A organization_id mutation | DENY | **PASS** — column-privilege denial |
| O | Inactive Membership attempts formerly valid Trip SELECT | DENY | **PASS** |
| P | Multi-org user does not inherit strongest role globally | — | **PASS** — org_admin-in-A/driver-in-B sees other members' rows in Org A, but only their own row in Org B (see note in the test file: `memberships_select_self` correctly always shows a user their own row, which is not a leak) |
| Q | Unauthenticated TransportationRequest SELECT | DENY | **PASS** — no grant at all, not just no policy |
| R | Unauthenticated Passenger SELECT | DENY | **PASS** |
| S | Org Admin PlatformAdminGrant mutation | DENY | **PASS** — no self-escalation path exists |
| T | Normal role TripEvent DELETE | DENY | **PASS** |
| U | Normal role AuditEvent DELETE | DENY | **PASS** |
| V | Cross-org Trip → Passenger relationship | DATABASE REJECTS | **PASS** — composite FK violation |
| W | Cross-org TripAssignment → Driver relationship | DATABASE REJECTS | **PASS** — composite FK violation |
| X | Cross-org TripAssignment → Vehicle relationship | DATABASE REJECTS | **PASS** — composite FK violation |
| Y | Second active TripAssignment | DATABASE REJECTS | **PASS** — partial unique index violation |
| Z | Direct REST-style request vs. UI-intended path | same decision | **PASS by construction** — every test in this suite already is a direct-to-Postgres request under a real role; there is no separate "UI path" in this database-only phase to diverge from |
| AA | Authenticated user without Membership attempts tenant SELECT | DENY | **PASS** |
| AB | Inactive Driver Membership while auth session remains valid | DENY | **PASS** (same live-membership mechanism as O, applied to a different table) |
| AC | User sends forged organization_id on permitted insert | DENY | **PASS** — RLS `WITH CHECK` catches it at INSERT time (the trigger only guards UPDATE) |
| AD | Driver guesses another Trip UUID | DENY | **PASS** |
| AE | Driver guesses another TripNote UUID | DENY | **PASS** |
| AF | Dispatcher attempts cross-org child entity access | DENY | **PASS** — zero rows across assignments, notes, and exceptions simultaneously |

**One test required a fixture/assertion correction during development, documented here for transparency rather than silently fixed:** Test P's first draft asserted the multi-org user should see zero membership rows in Org B; the actual (correct) result was one row — their own. This was a test-design flaw, not a security flaw: `memberships_select_self` is an approved, intentional policy (a user can always read their own membership record). The test was corrected to assert the meaningful property — no visibility into *other* members' Org B rows — and passes. Tests W/X were also adjusted to target a deliberately unassigned trip fixture (`trip_a3`) so they exercise the intended composite-FK constraint rather than incidentally tripping the one-active-assignment constraint on an already-assigned trip; both now report the correct FK violation.

## Constraint test results (work item §55) — 13/13 PASS

Run as `postgres` (bypasses RLS entirely) to isolate schema constraints from the RLS layer — these must hold regardless of who's asking.

| Constraint | Result |
|---|---|
| Unique user Membership per organization | **PASS** |
| Valid `memberships.role` values only | **PASS** |
| Valid `memberships.status` values only | **PASS** |
| Valid `transportation_requests.state` values only | **PASS** |
| Valid `trips.state` values only (rejects the ambiguous `en_route`) | **PASS** |
| Valid `trip_notes.visibility` values only (rejects `patient_visible`) | **PASS** |
| Valid `trip_exceptions.status` values only (rejects `dismissed`) | **PASS** |
| Trip/Request organization consistency | **PASS** |
| Trip/Facility relationship consistency | **PASS** |
| Child record (TripNote) / Trip organization consistency | **PASS** |
| Child record (TripException) / Trip organization consistency | **PASS** |
| Child record (TripEvent) / Trip organization consistency | **PASS** |
| `organization_id` immutability trigger (independent of RLS/grants — fires even for the `postgres` superuser) | **PASS** |

Assignment/Trip/Driver/Vehicle organization consistency and the one-active-assignment-per-trip constraint are covered above under the adversarial suite (V, W, X, Y) rather than duplicated here.

## RLS inspection summary (work item §56)

- **RLS enabled on all 15 tables** — confirmed via direct query against `pg_class.relrowsecurity` (see the completion report for the full output).
- **52 policies total**, listed exhaustively in [rls-model.md](./rls-model.md) "Policy inventory."
- **No `USING (true)` policy exists anywhere** — every policy calls `is_org_member`/`has_org_role`/`is_platform_admin`/`is_driver_assigned_to_trip`, or checks `user_id = auth.uid()` / `id = auth.uid()` directly.
- **No policy grants Driver direct SELECT on `passengers`** — confirmed by listing all policies on that table (exactly three, all `_org_operations`).
- **No table grants anything to `anon`** — confirmed via `information_schema.column_privileges` / table-privilege inspection; `anon`-role tests (Q, R) fail at the privilege layer, not merely the policy layer.

## SECURITY DEFINER exposure test results (P1-E2-S1A) — 22/22 PASS

Dedicated suite: `supabase/tests/security_definer_exposure_tests.sql`. Same `SET ROLE`/`request.jwt.claim.sub` methodology as above, extended to directly probe the 5 RLS helper functions rather than table access.

| # | Scenario | Result |
|---|---|---|
| 1 | `anon` direct invocation of all 5 helpers | PASS — denied 5/5 |
| 2 | Authenticated user, zero memberships anywhere | PASS — every helper fails closed (`false`/`null`), no error |
| 3/4 | Driver, own org vs. foreign org | PASS — own Driver id / `null`; own trip `true` / foreign-org trip `false` |
| 5/6 | Dispatcher, own org vs. foreign org | PASS — `true` / `false` |
| 7/8 | Organization Admin, own org vs. foreign org | PASS — `true` / `false` |
| 9 | Inactive membership | PASS — fails closed at the **function** layer, not just RLS |
| 10 | Guessed/non-existent organization UUID | PASS — `false`/`null`, indistinguishable from a real foreign org (no existence oracle) |
| 11 | Guessed/non-existent trip UUID | PASS — `false`, no error |
| 12 | `current_driver_id()` ID-disclosure deep check (two different drivers, same org) | PASS — each gets only their own id, never a colleague's |
| 13 | Platform Admin positive check | PASS |
| 14 | Organization Admin cannot manufacture Platform Admin (function-level) | PASS — `organization_admin` has zero influence on `is_platform_admin()` |
| 15/16/17 | Public schema CREATE denial for `PUBLIC`/`anon`/`authenticated` | PASS x3 |
| 18 | Function ownership (all 5 helpers) | PASS — all owned by `postgres` |
| 19 | `search_path` assertion (all 5 helpers) | PASS — all explicit `public, pg_temp` |
| 20a/20b | Function ACL shape (helpers vs. trigger functions) | PASS x2 |
| 21 | `has_org_role()` with a forged/non-canonical role array (`platform_admin`, `super_admin`, `root`) | PASS — never matches, no bypass (the underlying `memberships.role` CHECK constraint makes this structurally impossible, verified behaviorally) |
| 22 | Multi-org user driver resolution (admin in Org A, driver in Org B) | PASS — `null` in the org where they have no Driver row, correct own id in the org where they do |

## Corrective migration and its regression impact

`supabase/migrations/20260831090000_revoke_public_execute_trigger_functions.sql` revoked the two trigger-support functions' leftover default `PUBLIC` EXECUTE grant (found during the audit; confirmed **not exploitable** via either direct SQL — Postgres refuses non-trigger-context calls to a `RETURNS trigger` function outright — or PostgREST, which never lists trigger-returning functions in its RPC schema cache at all). Full `supabase db reset` + re-run of all four suites after this migration: **32/32 RLS, 13/13 constraints, 7/7 function-privilege, 22/22 exposure** — zero regressions.

## Cross-validation against real PostgREST/GoTrue

Beyond the SQL-level suite above, the helper functions were additionally exercised over HTTP against the actual local PostgREST endpoint, using genuinely GoTrue-issued access tokens (not manually-minted JWTs) obtained through the real `/auth/v1/token?grant_type=password` flow. Results were identical to the SQL-level tests for every actor and every helper — see `docs/reports/P1-E2-S1A-security-definer-audit.txt` for the full transcript. Building this cross-validation surfaced and fixed two real, permanent gaps in `supabase/seed.sql` (NULL token columns GoTrue's client can't scan; missing `auth.identities` rows for the email provider) — both now fixed for any future session that wants to test via real tokens.
