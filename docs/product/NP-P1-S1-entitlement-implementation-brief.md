# NP-P1-S1 — Nemryn Plus Entitlement Gate: Implementation Brief

**Status:** READY FOR REVIEW (refined in NP-P0-A02R) — **do not start** until the §1 preconditions are met and the owner approves PD-02 (revised states) and PD-17 (trial duration). PD-04 (`/operations/growth`) is owner-approved. PD-03 needs no change for S1, which is Admin-only.
**Prepared in:** NP-P0-A02 (2026-10-13) · **Baseline:** `origin/main` = `83506b02ff23e68548e96f6bf3d7175510215e08`; production migration head `20260927120000` (per the R3 release report; re-verify read-only before starting).
**Design references:** [plus-domain-model.md](./plus-domain-model.md) §3 · [../security/plus-access-model.md](../security/plus-access-model.md) §3, §8 · [plus-decisions-proposed.md](./plus-decisions-proposed.md) PD-02/03/04

---

## 0. Goal (one sentence)

Let a Nemryn Platform Admin grant, extend or end Nemryn Plus for an organization, and let that organization's Admin open an **empty**, server-authorized Growth page. Core behaviour must be provably unchanged, and **no CRM customer data** may exist.

## 1. Preconditions — worktree reconciliation (must be done first, by or with the owner)

State observed read-only on 2026-10-13:

| Item | Observed |
|---|---|
| Branch | `p0-e3-s2-identity-organisations-auth`. A stale name: its HEAD equals `main` and `origin/main` (`83506b0`), with 0 commits ahead or behind |
| Modified tracked files | `src/components/operations/AppHeader.tsx`, `src/components/operations/OperationsLayoutClient.tsx` (UX1, +26/−40) |
| Untracked application code (UX1) | `src/app/day-sheet/`, `src/app/operations/notifications-actions.ts`, `src/components/operations/day-sheet/`, `src/components/operations/header/`, `src/lib/operations/day-sheet-core.ts`, `day-sheet-core.test.mjs`, `day-sheet.ts`, `header-help-core.ts` |
| Untracked docs | 31 `docs/reports/*.txt` (incl. NP-P0-A01) + the 5 NP-P0-A02 docs + the A02 report |
| Untracked QA scripts | 227 files under `.tmp-qa/` |
| Stashes | none |

UX1 is described as "LOCAL ONLY: not committed, not pushed, not deployed" (`docs/reports/p1-pilot-ux1-header-day-sheet-completion.txt:3`).

**Required reconciliation (nothing here may be done without the owner's explicit instruction; no stash, revert, delete or move):**

1. **UX1 code.** *Update 2026-10-13 (P1-PILOT-UX1-CLOSEOUT):* UX1 was reviewed, its CSV formula-injection defect was repaired, and it was validated locally (tsc, lint, 732/732 unit, build, 46/46 + 7/7 E2E). It is ready for a scoped commit pending owner approval and the ZD-134 wording decision (`docs/reports/P1-PILOT-UX1-uncommitted-work-reconciliation.txt` §8). The owner still chooses one of:
   - **(a)** finish UX1 through its own release process (commit on a UX1 branch → push with the `nemryn` account → Vercel → release report), or
   - **(b)** commit it as-is to a dedicated branch (e.g. `p1-pilot-ux1-header-day-sheet`) so it is preserved off `main`.

   Either way `main` ends in a known state. NP-P1-S1 does not touch `AppHeader.tsx` or `OperationsLayoutClient.tsx`, but it must not be built on top of uncommitted shell changes.
2. **Untracked reports and A01/A02 docs.** The owner decides to commit them as a docs-only commit (separately from any code), or to leave them untracked. They must not be swept into the S1 code commit.
3. **`.tmp-qa/`.** Leave it untracked. Optionally add `.tmp-qa/` to `.gitignore` in a separate, owner-approved commit. Several scripts read `.env.sim.local`; never commit them.
4. **Start S1 on a fresh branch** from the reconciled `origin/main`, e.g. `np-p1-s1-plus-entitlement`. Do **not** continue on `p0-e3-s2-identity-organisations-auth`.
5. **Verify before the first edit (read-only):**
   - `git status` shows no modified tracked files;
   - `origin/main` equals the deployed production SHA;
   - the production migration head equals the latest migration on `main`;
   - the production privilege contract is 0 violations (`supabase db query --linked -f supabase/tests/privilege_contract_tests.sql`, SELECT-only). This needs the correct Supabase CLI login (see project memory: a 403 means the wrong account).

## 2. Scope

### In scope
1. Migration `supabase/migrations/<timestamp>_plus_entitlement_foundation.sql` (§3).
2. SQL tests `supabase/tests/plus_entitlement_tests.sql` (+ `plus_entitlement_concurrency_test.sh`) (§5).
3. Privilege contract update: `supabase/tests/privilege_contract_tests.sql` (§3.6).
4. Server access module `src/lib/plus/access.ts` (`server-only`) + pure `src/lib/plus/access-core.ts` + `access-core.test.mjs` (§4.1).
5. Route `src/app/operations/growth/layout.tsx` + `page.tsx`: an empty, authorized page (§4.2).
6. Platform Admin control on `src/app/platform/organizations/[organizationId]/page.tsx`:
   - a new `src/components/platform/PlusEntitlementControl.tsx`;
   - a new action in the existing `actions.ts`;
   - a loader in `src/lib/platform/platform.ts` (§4.3).
7. Regenerate `src/lib/supabase/database.types.ts` (generated file; part of this slice).
8. Docs: `docs/data/schema.md`, `docs/data/mutation-api.md`, `docs/security/database-privilege-contract.md`. Decision register: only formally approved decisions get a ZD number (ZD-205 is UX1; the route decision PD-04 is recorded as ZD-206). PD-02 and PD-17 are working requirements, not yet ZD entries.

### Out of scope (explicit)
- Any `plus_*` CRM table or customer data.
- Sidebar Growth nav (NP-P1-S2).
- `plus_can_read` / `plus_can_write` (NP-P1-S2; nothing needs them yet).
- Tenant Activity feed changes (`list_activity_events` is not replaced).
- Any change to Core RLS helpers, Core RPCs, public intake, `organizations.status`, `AppHeader.tsx`, `OperationsLayoutClient.tsx` or `OperationsSidebar.tsx`.
- Billing provider, trials auto-start, emails.

## 3. Database specification

### 3.1 Table `public.organization_modules`

```
organization_id uuid not null references public.organizations (id),
module          text not null check (module in ('plus')),
status          text not null check (status in ('trial','active','expired','cancelled','disabled')),
restriction     text check (restriction in ('read_only','no_access')),
trial_started_at timestamptz,          -- set on the single trial; never cleared (one-trial rule)
trial_ends_at   timestamptz,           -- kept as history after the trial ends
trial_extension_count smallint not null default 0 check (trial_extension_count between 0 and 1),
access_ends_at  timestamptz,
status_reason   text not null check (length(status_reason) between 3 and 500 and btrim(status_reason) = status_reason),
updated_by      uuid references auth.users (id),
created_at      timestamptz not null default now(),
updated_at      timestamptz not null default now(),
primary key (organization_id, module),
constraint organization_modules_trial_dates_check check ((trial_started_at is null) = (trial_ends_at is null) and (trial_ends_at is null or trial_ends_at > trial_started_at)),
constraint organization_modules_trial_check check (status <> 'trial' or trial_ends_at is not null),
constraint organization_modules_restriction_check check ((status = 'disabled') = (restriction is not null)),
constraint organization_modules_access_ends_check check (status = 'active' or access_ends_at is null)
-- (implemented: supabase/migrations/20261013100000_plus_entitlement_foundation.sql)
```

- Triggers: `set_updated_at`; `prevent_organization_id_change` (the existing shared functions).
- `alter table … enable row level security;` with **no policy** and **no grant** to anon, authenticated or service_role (privilege-contract class A).
- Table comment: "PLATFORM-OWNED entitlement. Separate from organizations.status by design (PD-02). Never read by any Core function."

### 3.2 `_plus_entitlement_state(p_organization_id uuid) returns text`

- `language sql stable security definer set search_path = public, pg_temp`.
- Returns:
  - `'write'` when the row exists and either `status = 'trial'` and `now() < trial_ends_at`, or `status = 'active'` and (`access_ends_at` is null or `now() < access_ends_at`);
  - `'locked'` when `status = 'disabled'` and `restriction = 'no_access'`;
  - `'read_only'` for any other existing row (elapsed trial or period, `expired`, `cancelled`, `disabled` + `read_only`);
  - `'none'` when there is no row.
- **No caller check.** `revoke all … from public, anon, authenticated, service_role`; owner-only, called by the definer functions below.

### 3.3 `plus_access_state(p_organization_id uuid)`

- Returns `table (state text, trial_ends_at timestamptz)` or a composite type `plus_access_state_result`, matching house style (`*_result` types).
- `'none'` (and null) unless `has_org_role(p_organization_id, array['organization_admin'])`; otherwise `_plus_entitlement_state(...)` (`write` / `read_only` / `locked`), plus `trial_ends_at` when trialling. `locked` is returned to the Admin only, so the UI can say "restricted" (S2). Grant holders arrive in P1-S3.
- **Never raises for an unauthorized caller** (no oracle). It returns `'none'`.
- `grant execute … to authenticated` only.

### 3.4 `platform_set_organization_module(p_organization_id uuid, p_module text, p_status text, p_trial_days integer, p_access_ends_at timestamptz, p_restriction text, p_reason text)`

Returns `platform_organization_module_result (organization_id, module, status, restriction, trial_ends_at, trial_extension_count, access_ends_at, effective_state, changed boolean)`. The body follows `set_platform_organization_status` (`20260920130000_platform_admin_foundation.sql:989-1048`):
1. `perform public._require_platform_admin();`
2. Validate:
   - `p_module = 'plus'`; status in the set;
   - reason 3–500 after trim;
   - `trial`:
     - `p_trial_days` null → **14** (the `PLUS_TRIAL_DEFAULT_DAYS` constant in the function);
     - otherwise it must be 7–30;
     - `trial_ends_at := now() + days`;
     - **refused (ZW004) whenever `trial_started_at` is already set** (NP-P1-S1 correction): a running trial is never restarted, and a consumed trial is never granted again. Extensions use §3.4a. A regrant needs a separately approved procedure (not implemented);
     - an organization with no row may only be given `trial` or `active`; `expired` / `cancelled` / `disabled` on a missing row → ZW004;
   - non-trial ⇒ `p_trial_days` null;
   - `p_access_ends_at` null or `> now()`, and only for `active`;
   - `p_restriction` is required for `disabled` (`read_only` | `no_access`) and must be null otherwise.
   - Anything else → ZW006.
3. Organization must exist (any `organizations.status`) → else ZW002. Lock the organization row `for update` to serialize concurrent changes, even when no module row exists yet.
4. Read the current module row (`for update`). For any non-trial request whose status, restriction and access end all match the row, return `changed = false` with no write and no audit (idempotent). Trial requests are never no-ops: they start the one trial or are refused (ZW004).
5. Upsert the row with `updated_by = auth.uid()`.
6. `insert into audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)` with `entity_type = 'organization_module'`, `entity_id = p_organization_id`, `action = 'platform_plus_access_changed'`, before/after `{module, status, restriction, trial_ends_at, access_ends_at}` (null before on first grant), and `reason`.
7. `revoke all … from public, anon; grant execute … to authenticated` (the platform pattern: authenticated may call, `_require_platform_admin` refuses non-platform callers with ZW002).

**Never touches:** `organizations.status`, Memberships, Drivers, Requests, Trips, integrations, notifications.

### 3.4a `platform_extend_plus_trial(p_organization_id uuid, p_extra_days integer, p_reason text)`

- Platform Admin only.
- The current status must be `trial` (else ZW004); `p_extra_days` must be 1–30; `trial_extension_count` must be 0 (one extension), else ZW004.
- Sets `trial_ends_at := greatest(trial_ends_at, now()) + p_extra_days` and `trial_extension_count := 1`.
- Writes the same `platform_plus_access_changed` audit row.
- `grant execute … to authenticated`.

### 3.5 `platform_get_organization_module(p_organization_id uuid, p_module text)`

Platform Admin only (`_require_platform_admin`). Returns `platform_organization_module_state (organization_id, module, provisioned, status, restriction, trial_started_at, trial_ends_at, trial_extension_count, access_ends_at, effective_state, status_reason, updated_at)`; `provisioned = false` when there is no row. Unknown module → ZW006, unknown organization → ZW002. `grant execute … to authenticated`.

> The optional `platform_list_activity` whitelist change below was **not** made in S1 (no existing function body replaced); the audit row is written regardless.

> **Optional, recommended (owner choice):** add `platform_plus_access_changed` to `platform_list_activity`'s action whitelist so the change shows in the platform activity feed. That requires `create or replace` of an existing function. Skip it if the owner prefers S1 not to replace any existing function body. The audit row is written either way.

### 3.6 Privilege contract (`supabase/tests/privilege_contract_tests.sql`)

- Add `organization_modules` to the table inventory with **no** anon/authenticated/service_role privilege (class A).
- Add the five functions with their exact signatures:
  - `_plus_entitlement_state(uuid)` → no client EXECUTE;
  - `plus_access_state(uuid)` → authenticated;
  - `platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text)` → authenticated;
  - `platform_extend_plus_trial(uuid,integer,text)` → authenticated;
  - `platform_get_organization_module(uuid,text)` → authenticated.
- Expected result: `SUMMARY … violations = 0` locally, and in production after release.

### 3.7 Deploy shape

Purely additive (new table + new functions). Apply the migration **before** the app. The previous app never references these objects, so there is no EXPAND/CONTRACT pair.

## 4. Application specification

### 4.1 `src/lib/plus/access.ts` (`import "server-only"`)

- `getPlusAccessState(organizationId): Promise<{ state: 'none'|'write'|'read_only'|'locked'; trialEndsAt: string | null }>` (all four effective states; NP-P1-S1 correction). Calls `plus_access_state` through the existing per-request server client (`src/lib/supabase/server.ts`), **never** the service-role client. Any RPC error maps to `'none'` (fail closed) with a fixed-message log.
- `requirePlusAccess(currentPath)`:
  - `const context = await requireOrganizationAdminAccess(currentPath)` (reuses the existing redirects: no session → sign-in, Driver → `/driver`, Dispatcher → `/operations`);
  - then `state = getPlusAccessState(context.organizationId)`;
  - `'none'` or `'locked'` → `redirect('/operations')` (the locked notice arrives in S2);
  - returns `{ context, plusState }`.
- `access-core.ts`: pure helpers (e.g. `trialDaysRemaining(now, trialEndsAt)`, `isPlusReadOnly(state)`) with `access-core.test.mjs`, following the `*-core.ts` + `node --test` convention.

### 4.2 `/operations/growth`

- `layout.tsx` calls `requirePlusAccess(pathname)` (pathname via `getCurrentPathname`, as the other layouts do). It renders inside the existing Operations layout and shell; no new shell.
- `page.tsx` is an empty authorized page:
  - `PageHeader` title "Growth" with a short honest description ("Nemryn Plus is enabled for this workspace. Growth tools will appear here.");
  - in `read_only`, the static notice "Nemryn Plus is not active. Your records are kept.";
  - in a trial, "Trial ends <date>" in the organization's timezone (`organizationTimezone` from the context).
- **No** data, buttons, nav item, "coming soon" teasers or fake metrics.
- The header context label falls back to "Operations" (`OperationsLayoutClient.tsx:26-29`). A "Growth" label is added in NP-P1-S2, after UX1 is reconciled, because that file is part of UX1.

### 4.3 Platform Admin control

- On the organization detail page, a **Nemryn Plus** panel beside `OrganizationLifecycleControl`. It shows:
  - the current status, trial end and access end;
  - the effective state (Full access / Read-only / Locked / Not provisioned), the restriction, trial start / end / extensions used, access end, last change and the internal reason.
- Actions:
  - Start trial (days, default 14, 7–30);
  - Extend trial (once, 1–30 days);
  - Activate (optional end date);
  - Mark expired;
  - Cancel;
  - Disable — read-only;
  - Disable — no access (security).
- Each requires a reason (3–500). The panel copy states that no Plus state affects operations.
- Server Action → `platform_set_organization_module`. Map ZW006 → a field error, and ZW002 → "Not available".
- The suspension control and the Plus control stay visually and functionally separate. The copy states "Plus does not affect operations".

## 5. Tests

### 5.1 `supabase/tests/plus_entitlement_tests.sql` (rollback-only; seed fixtures as in `platform_admin_foundation_tests.sql:1-15`)

| ID | Case | Expect |
|---|---|---|
| E1 | anon / authenticated `select/insert/update/delete` on `organization_modules` | permission denied |
| E2 | Org A admin, Org A dispatcher, driver, `e1` (no membership) call `platform_set_organization_module` | ZW002 |
| E3 | Platform Admin `d1`: trial grant → state for Org A admin = `write` | OK; one `platform_plus_access_changed` audit row with reason and actor `d1` |
| E4 | Identical non-trial update repeated (e.g. `active` twice, `active` with the same end date twice) | `changed = false`; no second audit row; reason not overwritten |
| E4b | Repeated start-trial (running trial, any days) | ZW004; trial dates unchanged; no audit |
| E4c | Start-trial after a consumed trial (e.g. after `expired`) | ZW004 |
| E5 | Trial days < 7 or > 30; non-trial with trial days; active with a past `access_ends_at`; `disabled` without restriction or a non-disabled status with one; bad module/status; blank or oversized reason | ZW006 |
| E6 | Elapsed trial (set the row directly as owner inside the test transaction) | `plus_access_state = 'read_only'` |
| E7 | `expired`, `cancelled`, `disabled`+`read_only`; `active` with elapsed `access_ends_at` | `read_only` |
| E7a | `disabled`+`no_access` | `locked` for Org A admin; `none` for everyone else |
| E8 | No row | `none` |
| E9 | Org A dispatcher / driver / inactive admin `a5`-style / Org B admin asking about Org A | `none` (never an error) |
| E10 | Org A suspended (`organizations.status = 'inactive'`) with Plus `active` | `none` for Org A admin |
| E11 | Platform Admin without membership calls `plus_access_state(OrgA)` | `none` |
| E12 | Granting Plus to Org A never changes `organizations.status`, memberships or any Core row | before/after equality |
| E13 | Suspending Org A never changes `organization_modules` | equality |
| E14 | `_plus_entitlement_state` not executable by anon / authenticated / service_role | permission denied |
| E15 | Unknown organization id | ZW002 |
| E16 | Trial with `p_trial_days` null | `trial_ends_at` = now() + 14 days (± test tolerance) |
| E17 | Extend: once OK (≤ 30 days); a second extension → ZW004; extend when not trialling → ZW004; trial → trial via the set RPC → ZW004 | as stated |
| E18 | Core happy path (request accept → create trip → assign) succeeds identically with Plus `write`, `read_only`, `locked` and no row | identical |

### 5.2 Concurrency: `supabase/tests/plus_entitlement_concurrency_test.sh`

Two sessions change Org A's Plus at once (after the `platform_lifecycle_concurrency_test.sh` pattern). Expect serialized results, exactly one audit row per real change, and no lost update.

### 5.3 Regression (unchanged suites must pass)

- `privilege_contract_tests.sql` (updated), `platform_admin_foundation_tests.sql`, `rls_adversarial_tests.sql`, `security_definer_exposure_tests.sql`, `function_privilege_tests.sql`, `request_decision_workflow_tests.sql`, `create_trip_tests.sql`, `public_request_intake_tests.sql`.
- `npm test` (all `*.test.mjs`), lint, and a type check after regenerating types.

### 5.4 Browser E2E (local, synthetic tenant only)

1. Org A admin with no Plus → `/operations/growth` redirects to `/operations`.
2. Platform Admin starts a trial → the Org A admin sees Growth with the trial date.
3. Platform Admin marks it expired → the read-only notice shows; Operations is fully usable (open Requests, Dispatch, a Trip).
4. Dispatcher → redirected to `/operations`; Driver → `/driver`.
5. The Core-only org's screens are unchanged (spot-check Overview, Requests, Dispatch, Settings).

## 6. Acceptance criteria (all required)

1. The migration applies cleanly on a fresh local reset and on top of production head `20260927120000`.
2. E1–E18 (incl. E7a) pass. The concurrency test passes. The privilege contract shows 0 violations locally.
3. No existing SQL suite changes outcome; `npm test`, lint and the type check pass.
4. `git diff` touches no Core migration, no Core RPC, no RLS helper, no public-intake file, and none of `AppHeader.tsx`, `OperationsLayoutClient.tsx` or `OperationsSidebar.tsx`.
5. No `plus_*` CRM table exists; no customer data exists.
6. Production (after release): the privilege contract is 0 violations; one synthetic-tenant smoke (grant trial → page visible → expire → read-only → Operations normal) passes; no real operator is granted Plus (PD-10).
7. A release report `docs/reports/np-p1-s1-plus-entitlement-production-release.txt` records the SHA, the migration head, the contract result and the rollback point.

## 7. Rollback

- **App:** revert the S1 commit, or promote the previous Vercel deployment. Core is unaffected because nothing in Core reads the new objects.
- **Database:** leave the table, the five functions and the three result types in place (inert without the app). If removal is required: a reviewed forward migration dropping `platform_get_organization_module`, `platform_extend_plus_trial`, `platform_set_organization_module`, `plus_access_state`, `_plus_entitlement_state`, the types `platform_organization_module_state`, `platform_organization_module_result`, `plus_access_state_result`, and `organization_modules` -- **only** if no production row exists for a real operator -- plus the matching privilege-contract entries. Audit rows stay.
- No data migration exists, so there is nothing to back-fill or restore.

## 8. Risks specific to S1

| Risk | Mitigation |
|---|---|
| Building on the dirty UX1 tree | §1 reconciliation is mandatory |
| A helper accidentally used by Core later | Code review rule + an S2 test asserting no Core function body references `organization_modules` / `plus_` |
| Platform Admin confuses Suspend with Plus disable | Separate panel, separate copy, separate audit action |
| Trial length wrong for sales (14-day default, 7–30, one +30 extension) | Owner confirms PD-17 before implementation |
| Security disable (`no_access`) mistaken for suspension | Separate control and audit action; tests E7a/E18 prove Core keeps working |
| `database.types.ts` drift | Regenerate it in the same commit; type check in acceptance |
