# Nemryn — Database Privilege Contract

**Introduced by:** P1-SEC-01 — Production Database Privilege Baseline Hardening
**Migration:** `supabase/migrations/20260921110000_production_privilege_baseline_hardening.sql`
**Contract test (read-only, same file for local and production):** `supabase/tests/privilege_contract_tests.sql`
**Behaviour tests:** `supabase/tests/privilege_baseline_behavior_tests.sql`
**Runner:** `scripts/verify-db-privileges.sh local|production`

## 1. Model

```
DENY BY DEFAULT  +  LEAST PRIVILEGE  +  RLS AS AN ADDITIONAL ENFORCEMENT LAYER
```

Row-Level Security is necessary but not sufficient. SQL privileges are minimised independently, so a mistaken or missing policy cannot by itself expose data. The application never talks to the database from the browser (`createBrowserSupabaseClient` has no caller): every database call is made by a Next.js server process as either the signed-in user (`authenticated`; `anon` before sign-in), or, for four server-only operations, `service_role`.

## 2. Why this exists (production ≠ local)

Every migration runs as `postgres`. Hosted Supabase and the local Supabase stack ship **different default privileges** for objects `postgres` creates in `public`:

| `pg_default_acl` (owner `postgres`, schema `public`) | Hosted production (before) | Local stack | After P1-SEC-01 (both) |
|---|---|---|---|
| tables | anon `arwd`, authenticated `arwd`, service_role `arwdDxtm` | service_role `Dxtm` only | owner only |
| sequences | anon/authenticated/service_role `rwU` | `w` | owner only |
| functions | anon/authenticated/service_role `X` | owner only | owner only |
| functions (global, PUBLIC) | PUBLIC `X` (Postgres built-in) | PUBLIC `X` | **revoked** for `postgres`-created functions (global default); schema `extensions` keeps PUBLIC (§2.1) |

So an object created by a migration silently received broad client grants in production but not locally, and the local privilege tests could not see it. The effective surface (privilege **and** policy) was identical, and no tenant data was exposed, but defence rested on RLS alone. The `supabase_admin` default entries are untouched (`postgres` is not a member of that role); no object in `public` is owned by `supabase_admin`, and contract check 24 fails if that ever changes.


### 2.1 Function default privileges — final design (P1-SEC-01R)

Facts, each proven with rolled-back probes in `supabase/tests/support/default_function_privilege_probes.sql`:

* A new function is executable by PUBLIC because of PostgreSQL's **built-in** default ACL (`acldefault('f')` = `{=X/owner, owner=X/owner}`), not because of any `pg_default_acl` row.
* `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ... FROM PUBLIC` is a **no-op**: schema-scoped entries are only ever *added* to the global default, never subtracted from it. Only the **global** (no `IN SCHEMA`) form, for the owner role, removes the built-in PUBLIC grant.
* Therefore a public-schema-only deny cannot be expressed with default ACLs alone. The final design is: **global revoke for role `postgres`** (the only owner our migrations use) **plus an explicit schema-scoped PUBLIC re-grant for schema `extensions`**, which restores the previous behaviour for vendor extension functions and nothing else. Nemryn functions live in `public` and get **no** PUBLIC execute.
* Side effects, documented: a function `postgres` creates in any *new* schema also gets no PUBLIC execute (default-deny; add a schema-scoped `ALTER DEFAULT PRIVILEGES ... IN SCHEMA <s> GRANT EXECUTE ON FUNCTIONS TO PUBLIC` in the same migration if that schema genuinely needs vendor-style PUBLIC functions). Schemas owned by other roles (auth, storage, realtime, ...) are not affected. Extension installs: `CREATE EXTENSION` run by `postgres` is elevated by supautils, so extension objects are owned by `supabase_admin` and are not touched by postgres defaults (probe); production's older `pgcrypto`/`uuid-ossp`/`pg_stat_statements` objects are owned by `postgres` but their ACLs are already stored (`=X/postgres`); the `extensions` re-grant covers any future postgres-owned extension object. If a function outside `public` legitimately needs PUBLIC execute: `GRANT EXECUTE ON FUNCTION <sig> TO PUBLIC;` explicitly in the migration that creates it, and record the exception here.
* Rejected: explicit per-migration `REVOKE` only (fails **open** when forgotten); a dedicated function-owner role (migrations run as `postgres`; large operational change); a DDL event trigger (a persistent hook that can block every `CREATE FUNCTION` and cannot be pre-tested on production).
* The contract test still enforces the outcome for everything that matters: checks 13, 15, 16, 22, 23 and 28; `supabase/tests/support/prove_contract_detects_drift.py` proves 20 kinds of drift are caught.

## 3. The contract

### 3.1 Roles

| Role | Tables | Sequences | Functions |
|---|---|---|---|
| `anon` | **none** | none | EXECUTE only `get_driver_invite_preview`, `get_staff_invite_preview` |
| `authenticated` | only the grants in §3.2 — never DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN | none | the 72 product-RPC / RLS-helper functions (the baseline 71 + `get_request_acquisition`, S4C) |
| `service_role` | `SELECT` on `request_intake_integrations` only | none | EXECUTE on the four server-only RPCs (`check_and_record_public_intake_rate_limit`, `submit_public_transportation_request`, `claim_notification_dispatch`, `complete_notification_dispatch`) |
| PUBLIC | none | none | none |

### 3.2 Tables — classification and rationale

Codes: **A** no client access (RPC / server only) · **B** authenticated read · **C** authenticated limited write · (D/E/F are the function / anon / service categories in §3.3).

| Table | Class | authenticated | Why it remains / why it is revoked |
|---|---|---|---|
| audit_events | **A** | — | Read only through `list_activity_events` (whitelisted, human-projected). Raw before/after JSON must never reach a browser. *Revoked in P1-SEC-01 (was SELECT): no direct caller exists.* |
| platform_admin_grants | **A** | — | Read only through `is_platform_admin()` (SECURITY DEFINER). *Revoked (was SELECT): no direct caller.* |
| notification_events, organization_notification_settings, organization_service_offerings, public_intake_rate_limit_events, staff_invites | **A** | — | Server / RPC only (already so locally). |
| request_acquisition_attributions (S4C) | **A** | — | Immutable acquisition snapshot of a website Request (UTM / landing+submission path / referrer host / form version). RLS on, NO policy, NO privilege for anon / authenticated / service_role. Written only by the SECURITY DEFINER intake function (as owner), read only through `get_request_acquisition` (Org Admin / Dispatcher of the Request's organization; Driver, inactive, foreign and Platform Admin without Membership get ZW002). service_role gained NO table privilege. |
| request_intake_integrations | **A** + service | — | Integration secrets. Client access via RPCs; service_role SELECT for the website-intake CORS lookup (`src/lib/public-intake/cors.ts`). |
| driver_invites | B | SELECT | Drivers page lists pending invites (2 callers). |
| driver_location_updates | B | SELECT | Dispatch live location (1 caller). |
| drivers | B + C | SELECT; UPDATE (display_name, phone, status) | Directory / Dispatch / Brief read it (5 callers). The column-scoped Organization Admin UPDATE has **no current caller** but is the only Driver edit/deactivate path and was deliberately preserved by S5A1R; `user_id`, `organization_id`, `id` are not updatable and there is **no INSERT**. |
| facilities | B + C | SELECT, INSERT; UPDATE (7 cols) | Facilities screen (insert + update callers). |
| vehicles | B + C | SELECT, INSERT; UPDATE (label, status) | Fleet screen (insert + update callers). |
| passengers | B + C | SELECT, INSERT; UPDATE (4 cols) | Passenger screens / new-trip flow (insert + update callers). |
| trip_notes | B + C | SELECT, INSERT, UPDATE | INSERT has a caller (trip detail). UPDATE has no caller; RLS policy `trip_notes_update_operations` exists by design — retained (see §6). |
| user_profiles | B + C | SELECT, INSERT, UPDATE | Sign-up / invite flows upsert the caller's own profile (3 callers); RLS `id = auth.uid()`. |
| organizations, memberships | B | SELECT | Workspace resolution and embedded reads; policies also reference `memberships`. Writes only via RPCs. |
| recurring_arrangements, recurring_occurrence_exceptions, request_events, transportation_requests, trip_assignments, trip_events, trip_exceptions, trips | B (+C column UPDATE on trips, transportation_requests) | SELECT | Read paths (1–10 callers each). The column-scoped UPDATE on `trips` (8 cols) and `transportation_requests` (12 cols) has no current caller (mutations moved to RPCs) and is retained (see §6). |

**Revoked everywhere (why unnecessary):** all `anon` table privileges — website intake is server → controlled `service_role` RPC, never browser → table; all `authenticated` DELETE (no DELETE policy exists and no code deletes rows); INSERT/UPDATE on tables whose only writers are SECURITY DEFINER RPCs (trips, trip_assignments, trip_events, memberships, organizations, driver_invites, drivers INSERT, audit_events, platform_admin_grants, request_events, recurring_*); TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for every client role and for `service_role`.

### 3.3 Functions

* **D — authenticated RPC (72):** every function the application calls with a user session, plus the RLS helpers that policies evaluate as the invoker (`has_org_role`, `is_org_member`, `current_driver_id`, `is_driver_assigned_to_trip`, `is_platform_admin`) and `is_valid_iana_timezone`. Every application `.rpc()` name was cross-checked against this list.
* **E — anon (2):** `get_driver_invite_preview`, `get_staff_invite_preview`: the `/join/[token]` and `/team-invite/[token]` pages render before sign-in with the publishable key. They are token-based and return nothing for an unknown token.
* **F — service_role only (4):** `submit_public_transportation_request` (S4C: gained the optional trailing `p_acquisition jsonb`; the old 21-argument signature was dropped so there is one overload; EXECUTE restated service_role-only), `check_and_record_public_intake_rate_limit` (website intake), `claim_notification_dispatch`, `complete_notification_dispatch` (notification dispatch).
* **A — internal (17):** underscore helpers (incl. `_sanitize_acquisition`, S4C), trigger functions and `signup_create_organization` (called only from inside SECURITY DEFINER functions as the owner). No client role holds EXECUTE.
* Every SECURITY DEFINER function pins `search_path` (contract check 19). Functions executable by clients that contain no inline `auth.uid()` / role check are: the three service-only RPCs (validate the integration / dispatch event themselves), the six `driver_*` transition wrappers (delegate to `_driver_execute_trip_transition`, which authorises), the two anon previews (token-scoped), and `is_valid_iana_timezone` (pure).

## 4. What a new object must do

1. Create it. It receives **no** client privileges from defaults.
2. In the same migration, `grant` exactly what the product path needs (table/column privileges to `authenticated`; `execute` to the specific role).
3. Add it to the contract CTEs in `privilege_contract_tests.sql` **and** the arrays in the baseline migration's design (the migration is idempotent, so a follow-up "contract" migration can re-run the same reset-and-grant pattern). Check 01 (tables) and 13 (functions) fail for an unlisted object — deliberately.
4. Run `scripts/verify-db-privileges.sh local`, then `production` after release.

## 5. Verifying production

```
scripts/verify-db-privileges.sh production        # or: supabase db query --linked -f supabase/tests/privilege_contract_tests.sql
```
The file is a single SELECT. Expect every row `ok = true` and `SUMMARY (violations = 0 of 28 checks)`. Drift after a release means an object was created outside the contract or a platform default changed.

## 6. Retained without a current caller (owner review candidates)

Not changed in P1-SEC-01 to avoid removing designed capabilities without a roadmap decision; each is column- or policy-constrained by RLS:
`drivers` UPDATE (display_name, phone, status), `trips` UPDATE (8 columns), `transportation_requests` UPDATE (12 columns), `trip_notes` UPDATE, `is_org_member()` EXECUTE. They can be revoked in a later migration by removing them from the contract.

## 7. Owner-approved invariants

* **`service_role` narrowing is a Nemryn security invariant (owner-approved, P1-SEC-01R). Do not restore broad `service_role` access.** A server-side feature does **not** automatically receive database access merely because it uses the service role. Required capabilities must be explicitly granted: a migration that adds a server path must `GRANT` exactly the table privilege or function `EXECUTE` it needs to `service_role`, and add that grant to the contract (`c_service_tbl` / the `s` functions in `privilege_contract_tests.sql` and the arrays in the baseline migration pattern). The audited call sites today are `src/lib/public-intake/{cors,rate-limit,website-intake}.ts` and `src/lib/notifications/dispatch.ts`.
* `audit_events` / `platform_admin_grants` have no direct client SELECT (RLS policies retained as the second layer); they are read only through SECURITY DEFINER RPCs.
