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
| `authenticated` | only the grants in §3.2 — never DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN | none | the 81 product-RPC / RLS-helper functions (the baseline 71 + `get_request_acquisition`, S4C + `get_website_request_form`, `save_website_request_form`, `set_request_intake_integration_setup`, P1-COMM-D1 + `get_website_request_form_publication`, `publish_website_request_form`, `disable_website_request_form_publication`, P1-COMM-D2 + `delete_unused_request_intake_integration`, `retire_request_intake_integration`, `list_previous_website_connections`, P1-COMM-D2A) |
| `service_role` | `SELECT` on `request_intake_integrations` only | none | EXECUTE on the six server-only RPCs (`check_and_record_public_intake_rate_limit`, `submit_public_transportation_request`, `claim_notification_dispatch`, `complete_notification_dispatch`, and, P1-COMM-D2, `get_public_request_form` + `submit_public_form_request`) |
| PUBLIC | none | none | none |

### 3.2 Tables — classification and rationale

Codes: **A** no client access (RPC / server only) · **B** authenticated read · **C** authenticated limited write · (D/E/F are the function / anon / service categories in §3.3).

| Table | Class | authenticated | Why it remains / why it is revoked |
|---|---|---|---|
| audit_events | **A** | — | Read only through `list_activity_events` (whitelisted, human-projected). Raw before/after JSON must never reach a browser. *Revoked in P1-SEC-01 (was SELECT): no direct caller exists.* |
| platform_admin_grants | **A** | — | Read only through `is_platform_admin()` (SECURITY DEFINER). *Revoked (was SELECT): no direct caller.* |
| notification_events, organization_notification_settings, organization_service_offerings, public_intake_rate_limit_events, staff_invites | **A** | — | Server / RPC only (already so locally). |
| website_request_form_publications (P1-COMM-D2) | **A** | — | WHERE/HOW the Nemryn form is public (Published / Disabled; no row = not published): opaque public key, a SNAPSHOT of the published form content + version, the hidden intake binding. RLS on, NO policy, NO privilege for anon / authenticated / service_role. Written only by `publish_website_request_form` / `disable_website_request_form_publication` (Organization Admin of an ACTIVE organization; everyone else ZW002), read by `get_website_request_form_publication` (Admin) and by the two service_role public RPCs. service_role gained NO table privilege. |
| website_request_forms (P1-COMM-D1) | **A** | — | One Nemryn-form configuration per organization (copy, optional service subset, two switches, status draft / ready, content version → S4C `formVersion`). RLS on, NO policy, NO privilege for anon / authenticated / service_role. Read/written only through `get_website_request_form` / `save_website_request_form` (Organization Admin of an ACTIVE organization; Dispatcher, Driver, inactive Membership, suspended organization, foreign organization and Platform Admin without Membership get ZW002). service_role gained NO table privilege. |
| request_acquisition_attributions (S4C) | **A** | — | Immutable acquisition snapshot of a website Request (UTM / landing+submission path / referrer host / form version). RLS on, NO policy, NO privilege for anon / authenticated / service_role. Written only by the SECURITY DEFINER intake function (as owner), read only through `get_request_acquisition` (Org Admin / Dispatcher of the Request's organization; Driver, inactive, foreign and Platform Admin without Membership get ZW002). service_role gained NO table privilege. |
| organization_modules (NP-P1-S1) | **A** | — | Nemryn Plus entitlement, platform-owned. RLS on, NO policy, NO privilege for anon / authenticated / service_role. Written only by `platform_set_organization_module` / `platform_extend_plus_trial` (Platform Admin), read only through `plus_access_state` (caller's own Organization Admin view; everyone else `none`) and `platform_get_organization_module` (Platform Admin). Never read by any Core function. |
| request_intake_integrations | **A** + service | — | Integration secrets. Client access via RPCs; service_role SELECT for the website-intake CORS lookup (`src/lib/public-intake/cors.ts`). P1-COMM-D2A added a nullable `retired_at timestamptz` column (no privilege change — the table remains class A) with `CHECK (retired_at is null or is_active = false)`; a retired `integration_type = 'website'` row is permanent and immutable through every existing tenant RPC (see the RPC list below). The org/origin uniqueness index now excludes retired rows so a fresh connection can reuse the same address under a brand-new id. |
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

* **D — authenticated RPC (82):** every function the application calls with a user session, plus the RLS helpers that policies evaluate as the invoker (`has_org_role`, `is_org_member`, `current_driver_id`, `is_driver_assigned_to_trip`, `is_platform_admin`) and `is_valid_iana_timezone`. Every application `.rpc()` name was cross-checked against this list. P1-OPS-R1 added `accept_transportation_request(uuid, uuid)` and replaced `decline_transportation_request` / `cancel_transportation_request` with reason-aware `(uuid, uuid, text, text)` signatures (authenticated EXECUTE only, like their predecessors).
* **E — anon (2):** `get_driver_invite_preview`, `get_staff_invite_preview`: the `/join/[token]` and `/team-invite/[token]` pages render before sign-in with the publishable key. They are token-based and return nothing for an unknown token.
* **F — service_role only (6):** P1-COMM-D2 added exactly two: `get_public_request_form(text)` (public passenger-facing config of an ACTIVE published form; no row for any unavailable key) and `submit_public_form_request(text, … , jsonb)` (creates a Request from a published form through the shared internal primitive). **No table privilege was added for service_role**; `website_request_form_publications` stays class A. The internal helpers `_create_public_request(uuid, …)` (the extracted canonical Request-creation logic shared by website intake and the published form) and `_public_form_service_types(uuid, text[])` have **no** EXECUTE for any role. Previously (4): `submit_public_transportation_request` (S4C: gained the optional trailing `p_acquisition jsonb`; the old 21-argument signature was dropped so there is one overload; EXECUTE restated service_role-only), `check_and_record_public_intake_rate_limit` (website intake), `claim_notification_dispatch`, `complete_notification_dispatch` (notification dispatch).
* **NP-P1-S1 additions:** D gains `plus_access_state(uuid)`, `platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text)`, `platform_extend_plus_trial(uuid, integer, text)` and `platform_get_organization_module(uuid, text)` (authenticated EXECUTE only; each re-checks authority inside: Organization Admin for the first, PlatformAdminGrant for the other three). A gains `_plus_entitlement_state(uuid)` (no client EXECUTE). The counts in the bullets above and below predate NP-P1-S1.
* **NP-P1-S2 additions:** D gains `plus_can_read(uuid)` and `plus_can_write(uuid)` (authenticated). A gains `_require_plus_write(uuid)` and `_require_plus_admin_write(uuid)` (no client EXECUTE).
* **NP-P1-S2-R1 additions:** D gains the versioned overloads `platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text, timestamptz)` and `platform_extend_plus_trial(uuid, integer, text, timestamptz)` (authenticated EXECUTE only; PlatformAdminGrant re-checked inside; ZW003 when the entitlement's `updated_at` differs from the expected version under the row locks). The unversioned S1 signatures stay (EXPAND).
* **NP-P1-S3 additions:**
  * Table `membership_module_grants` is class **A**, like `organization_modules`: RLS on, no policy, no anon / authenticated / service_role privilege.
  * D gains `plus_list_member_access(uuid)`, `plus_grant_member_access(uuid, uuid, text, uuid)` and `plus_revoke_member_access(uuid, uuid, uuid)`. Each grants authenticated EXECUTE only and re-checks Organization Admin and the entitlement inside.
  * A gains `_plus_member_access(uuid)`.
  * `plus_can_read`, `plus_can_write` and `plus_access_state` keep their signatures and grants (bodies replaced).
  * Core schema: an additive `memberships unique (id, organization_id)` constraint (PD-20, owner-approved as ZD-209). No Core privilege, policy or function changes.
* **NP-P1-S4 additions:**
  * Tables `plus_contacts` and `plus_activities` are class **B**: authenticated `SELECT` only, through the single policy `plus_can_read(organization_id)`. There is no insert, update or delete privilege or policy for any client role, and no update or delete path for activities at all.
  * D gains nine RPCs, authenticated EXECUTE only, each re-checking Plus read or write inside: `plus_list_contacts`, `plus_get_contact`, `plus_list_contact_activities`, `plus_find_contact_matches`, `plus_list_contact_owner_options`, `plus_create_contact`, `plus_update_contact`, `plus_archive_contact`, `plus_log_contact_activity`.
  * A gains `_plus_user_can_write`, `_plus_contact_matches`, `_plus_staff_name` and `_plus_resolve_owner`.
  * No Core object is changed.
* **NP-P2-S1 additions:**
  * Table `plus_opportunities` is class **B**: authenticated `SELECT` only, through the policy `plus_can_read(organization_id)`. There is no client write privilege or policy.
  * D gains eight RPCs: `plus_list_opportunities`, `plus_get_opportunity`, `plus_list_opportunity_activities`, `plus_create_opportunity`, `plus_update_opportunity`, `plus_change_opportunity_stage`, `plus_mark_opportunity_lost`, `plus_reopen_opportunity`.
  * A gains `_plus_require_active_contact` and the trigger function `_plus_opportunity_channel_immutable`.
  * `plus_activities` gains `opportunity_id`, with its privileges unchanged.
* **NP-P2-S2 additions:**
  * Tables `plus_tasks` and `plus_agent_recommendations` are class **B**: authenticated `SELECT` only, through the single policy `plus_can_read(organization_id)`. There is no client write privilege or policy.
  * D gains 14 RPCs:
    * tasks: `plus_list_tasks`, `plus_get_task`, `plus_create_task`, `plus_update_task`, `plus_reassign_task`, `plus_complete_task`, `plus_cancel_task`;
    * Growth Agent: `plus_run_growth_agent_review`, `plus_list_agent_recommendations`, `plus_approve_agent_recommendation`, `plus_dismiss_agent_recommendation`;
    * dashboard: `plus_growth_dashboard`, `plus_list_attention_opportunities`, `plus_list_recent_activities`.
  * A gains six internals: `_plus_org_day_bounds`, `_plus_require_task_subject`, `_plus_insert_task`, `_plus_agent_threshold`, `_plus_agent_candidates`, `_plus_agent_review`. `_plus_agent_review` is the boundary a future, separately approved scheduler would call; no scheduler or job exists and none holds EXECUTE.
  * No Core object is changed. No agent or dashboard function uses `pg_net`, `http`, `dblink`, email or SMS (asserted by `plus_growth_agent_tests.sql` S5).
* **NP-P2-S3 additions:**
  * Table `plus_request_attributions` is class **B**: authenticated `SELECT` only, through the single policy `plus_can_read(organization_id) AND has_org_role(organization_id, [organization_admin, dispatcher])`. There is no client write privilege or policy.
  * D gains five RPCs: `plus_link_request`, `plus_update_request_attribution`, `plus_get_request_attribution`, `plus_list_request_attributions`, `plus_get_request_summaries`.
  * A gains `_plus_require_core_request_read` and `_plus_resolve_attribution`.
  * `plus_activities` gains `request_id` (composite FK to `transportation_requests`), with its privileges unchanged.
  * No Core object is changed. No Core function or policy references a Plus object, and no Plus function writes or locks a Core table (`plus_request_attributions_tests.sql` K1-K3).
* **NP-P2-S4 additions:**
  * No new table.
  * D gains two RPCs: `plus_convert_opportunity_to_request` and `plus_create_rebooking_request`. Each creates the Core Request only through `log_transportation_request`, called as the caller.
  * A gains `_plus_opportunity_conversion_guard` (a deferred constraint-trigger function), `_plus_core_request_source` and `_plus_require_idempotency_key`.
  * `plus_update_request_attribution` is replaced with the same signature and grants.
  * Constraints added: `plus_request_attributions_method_shape_check` and the partial unique `plus_request_attributions_one_conversion_idx`.
  * No Core object is changed.
* **NP-P2-S4.1-S2 changes (Plus):**
  * `plus_convert_opportunity_to_request`: same signature and grants (CREATE OR REPLACE); it now passes the opportunity's own `service_type` to Core.
  * `plus_create_rebooking_request` gains a trailing `p_service_type text DEFAULT NULL`. It is replaced by DROP + CREATE (exact 12-argument identity, no CASCADE): one function, no overload. Contract signature: `(uuid,uuid,text,text,text,text,text,text,date,time without time zone,text,text,text)`. It stays SECURITY DEFINER with `search_path` pinned, and EXECUTE is `authenticated` only.
  * No table, column, CHECK, policy or table grant changes.
* **NC-REQUEST-SERVICE-TYPE-S1 changes (Core):**
  * `log_transportation_request` gains a trailing `p_service_type text DEFAULT NULL`. It is replaced by DROP + CREATE (exact 14-argument identity, no CASCADE): ONE function remains, never an overload. Its new contract signature is `(uuid,text,text,text,text,text,text,text,text,uuid,date,time without time zone,text,text,text)`. It stays SECURITY DEFINER with `search_path` pinned, and EXECUTE is `authenticated` only (no PUBLIC, `anon` or `service_role`).
  * `get_organization_service_offerings` (owner-approved, read-only) now admits an active Organization Admin OR Dispatcher of that organization. The signature, grant and SECURITY DEFINER are unchanged, and it returns only the enabled service identifiers. `set_organization_service_offerings` stays Organization Admin only, and `organization_service_offerings` keeps RLS on, with no policy and no client grant.
  * No table, column, CHECK, policy or grant on a table changes.
* **A — internal (17):** underscore helpers (incl. `_sanitize_acquisition`, S4C; `_validate_request_decision_reason`, P1-OPS-R1), trigger functions and `signup_create_organization` (called only from inside SECURITY DEFINER functions as the owner). No client role holds EXECUTE.
* Every SECURITY DEFINER function pins `search_path` (contract check 19). Functions executable by clients that contain no inline `auth.uid()` / role check are: the three service-only RPCs (validate the integration / dispatch event themselves), the six `driver_*` transition wrappers (delegate to `_driver_execute_trip_transition`, which authorises), the two anon previews (token-scoped), and `is_valid_iana_timezone` (pure).

## 4. What a new object must do

1. Create it. It receives **no** client privileges from defaults.
2. In the same migration, `grant` exactly what the product path needs (table/column privileges to `authenticated`; `execute` to the specific role).
3. Add it to the contract CTEs in `privilege_contract_tests.sql` **and** the arrays in the baseline migration's design (the migration is idempotent, so a follow-up "contract" migration can re-run the same reset-and-grant pattern). Check 01 (tables) and 13 (functions) fail for an unlisted object — deliberately.
4. Run `scripts/verify-db-privileges.sh local`, then `production` after release.
5. **Expand / contract releases (P1-OPS-R1).** When a release must keep an old function alive for the previously deployed app, list it in `c_fn_transitional` instead of `c_fn`. Its ACL is still checked (checks 13 and 16–18), it is not required to exist (check 14), and **check 29 fails while it exists**. Between EXPAND and CONTRACT the expected result is therefore exactly `1 of 29` (check 29 only); after CONTRACT it is `0 of 29`. Remove entries from `c_fn_transitional` in a later cleanup once no environment can still hold them.

## 5. Verifying production

```
scripts/verify-db-privileges.sh production        # or: supabase db query --linked -f supabase/tests/privilege_contract_tests.sql
```
The file is a single SELECT. Expect every row `ok = true` and `SUMMARY (violations = 0 of 29 checks)` (28 checks before P1-OPS-R1 added check 29; exactly `1 of 29` — check 29 only — is expected between an EXPAND and its CONTRACT migration). Drift after a release means an object was created outside the contract or a platform default changed.

## 6. Retained without a current caller (owner review candidates)

Not changed in P1-SEC-01 to avoid removing designed capabilities without a roadmap decision; each is column- or policy-constrained by RLS:
`drivers` UPDATE (display_name, phone, status), `trips` UPDATE (8 columns), `transportation_requests` UPDATE (12 columns), `trip_notes` UPDATE, `is_org_member()` EXECUTE. They can be revoked in a later migration by removing them from the contract.

## 7. Owner-approved invariants

* **`service_role` narrowing is a Nemryn security invariant (owner-approved, P1-SEC-01R). Do not restore broad `service_role` access.** A server-side feature does **not** automatically receive database access merely because it uses the service role. Required capabilities must be explicitly granted: a migration that adds a server path must `GRANT` exactly the table privilege or function `EXECUTE` it needs to `service_role`, and add that grant to the contract (`c_service_tbl` / the `s` functions in `privilege_contract_tests.sql` and the arrays in the baseline migration pattern). The audited call sites today are `src/lib/public-intake/{cors,rate-limit,website-intake}.ts` and `src/lib/notifications/dispatch.ts`.
* `audit_events` / `platform_admin_grants` have no direct client SELECT (RLS policies retained as the second layer); they are read only through SECURITY DEFINER RPCs.
