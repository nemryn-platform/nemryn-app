# Nemryn Plus — Access, Privacy & Security Model (PROPOSED)

**Work item:** NP-P0-A02 · **Status:** PROPOSED — not implemented · **Date:** 2026-10-13
**Builds on (unchanged):** [rls-model.md](./rls-model.md) · [database-privilege-contract.md](./database-privilege-contract.md) · [mutation-authorization.md](./mutation-authorization.md) · [application-auth-boundary.md](./application-auth-boundary.md)
**Data model:** [../product/plus-domain-model.md](../product/plus-domain-model.md) · **Refined:** NP-P0-A02R (2026-10-13)

> Nemryn has **not** had a HIPAA assessment, and HIPAA applicability and BAA availability for Nemryn Plus are **unresolved verification gates**. Nothing in this document claims compliance. All implementation and testing uses **synthetic** customer data until the gates in §9 are closed.

---

## 1. Principles carried forward (verified in source)

1. RLS on every table, deny by default. A new object has no client privilege until granted (`20260921110000_production_privilege_baseline_hardening.sql`).
2. Tenant context comes from live membership, never from a cookie alone (`src/lib/auth/organization.ts:7-46`).
3. Authorization runs in the database (`SECURITY DEFINER` + `has_org_role`) and is mirrored in server route guards (`src/lib/auth/authorization.ts`). Hiding navigation is never the control.
4. Service-role credentials are used only in `server-only` modules (5 today; see A01 §3.6). **Plus adds no service-role path until a billing webhook (NP-P5) needs one.**
5. Cross-tenant links are impossible by composite FK, not only by policy.

## 2. Who can use Plus

### 2.1 Access stages (A02R)

| Stage | Who has Plus | Purpose |
|---|---|---|
| **Technical testing** (P1-S1, P1-S2) | Organization Admin only | Prove the entitlement gate and helpers |
| **From P1-S3** | Organization Admin, **plus** named staff holding an explicit `membership_module_grants` row (`read` or `write`) | Usable by a real sales/intake person who is already a Dispatcher, without making them an Admin |
| **Before commercial beta** (PD-18, owner decision) | Above, **plus** optional growth-only members with **no** Core operational rights | Salespeople who must not see dispatch at all |

**Rule:** a salesperson is **never** made an Organization Admin merely to reach the CRM. Until PD-18 ships, a non-admin salesperson can only be a Dispatcher with a Plus grant. That is still an operational role, so for a pure salesperson the commercial beta waits for PD-18 or accepts that limitation explicitly.

| Actor | Core access (unchanged) | Plus read | Plus write |
|---|---|---|---|
| Organization Admin, effective `write` | full | ✅ | ✅ |
| Organization Admin, effective `read_only` | full | ✅ history + export | ❌ ZW001 |
| Organization Admin, effective `locked` (security disable) | full | ❌ ZW002 (UI shows "restricted") | ❌ ZW002 |
| Organization Admin, `none` | full | ❌ ZW002 | ❌ ZW002 |
| Dispatcher with active **write** grant, effective `write` | full Ops | ✅ | ✅ (except Admin-only Plus settings: publishing the inquiry form, managing grants) |
| Dispatcher with active **read** grant | full Ops | ✅ | ❌ ZW001 |
| Dispatcher with a grant, effective `read_only` | full Ops | ❌ ZW002: historical export is **Admin-only** | ❌ |
| Dispatcher without a grant | full Ops | ❌ ZW002 | ❌ ZW002 |
| Growth member (PD-18, if approved) with a grant | **none**: Core RLS and RPCs refuse, because `has_org_role` lists explicit roles | as the grant | as the grant; **cannot** convert to a Core Request (§4) |
| Driver | Driver PWA | ❌ (a grant is refused) | ❌ |
| Inactive membership / suspended organization | none | ❌ | ❌ |
| Platform Admin without membership | platform plane | ❌ tenant CRM content | ❌ (may change the entitlement only) |
| anon | Core public forms; the Plus inquiry form (P2-S7) | ❌ | only `submit_plus_inquiry` via the server boundary |

### 2.2 Named-staff grants (P1-S3) — table in domain model §5

- Granted and revoked by an Organization Admin only, through an RPC, with an audit event ~~and a `plus_activities` row~~. (CORRECTED by ZD-211: every grant, change and revocation is recorded in `audit_events` only, as `plus_member_access_granted` / `plus_member_access_revoked`. It never creates a contact `plus_activities` record, because `plus_activities` is a contact-subject timeline.)
- A grant is effective only while the membership is `active` with role `dispatcher` (or `growth`). A Driver membership can never hold one.
- Grants survive entitlement expiry (they are history), but are inert unless the effective state is `write` (or `read_only`, for Admins only).
- **Reactivation (owner-approved, ZD-210):** an unrevoked grant becomes effective again when an inactive Dispatcher membership is reactivated, provided every other authorization and entitlement condition is satisfied. Grants never change a Core role and never confer subscription management.

### 2.3 Growth-only members (PD-18 — owner decision; Core change)

Recommended option: add `growth` to the `memberships.role` CHECK **and** the `staff_invites.role` CHECK (`20260920110000_team_services_operations_settings.sql:36`). Every existing `has_org_role(..., array[...])` call lists roles explicitly, so `growth` gets zero Core data access by default. A full caller audit plus the existing adversarial suites must prove it.

**Route-guard conflict to resolve with it (A02R finding):**
- Growth lives at `/operations/growth` (PD-04). The single guard for all of `/operations/*` is `requireOperationsAccess` in `src/app/operations/layout.tsx`, which today sends any non-operations role to `/access-unavailable` (`src/lib/auth/authorization.ts:47-51`).
- Letting `growth` through that layout would expose **every** Operations route shell to them. Their data stays protected (RLS and RPCs refuse), but the pages would be broken and empty.
- PD-18 must therefore also add a path-aware rule: a `growth` member passes the Operations layout **only** for `/operations/growth/*` (and `/operations/settings/my-access`). Every other path redirects to `/operations/growth`.
- The sidebar shows only the Growth group for them.
- This is a change to shared Core authorization code and gets its own tests.

## 3. Entitlement → database permissions

### 3.1 Helpers (all `SECURITY DEFINER`, `stable`, `set search_path = public, pg_temp`)

| Function | Returns | Logic | Grant |
|---|---|---|---|
| `_plus_entitlement_state(p_org)` | `'none'\|'locked'\|'read_only'\|'write'` | effective state from `organization_modules` (domain model §4), time-evaluated, no caller check | **none** (owner-internal) |
| `_plus_member_access(p_org)` | `'none'\|'read'\|'write'` | P1-S1/S2: `'write'` iff `has_org_role(p_org, ['organization_admin'])`. P1-S3: an Admin gets `'write'`, otherwise the active grant's access for the caller's active `dispatcher`/`growth` membership | none |
| `plus_can_read(p_org)` | boolean | entitlement `write` → member access ≠ `none`; entitlement `read_only` → caller is Organization Admin; `locked` / `none` → false | authenticated (used by RLS) |
| `plus_can_write(p_org)` | boolean | entitlement `write` AND member access = `write` | authenticated |
| `_require_plus_write(p_org)` | void | **ZW002** if not `plus_can_read`; **ZW001** if readable but not writable | none |
| `_require_plus_admin_write(p_org)` | void | as above, and the caller must be Organization Admin (inquiry-form publishing, grants) | none |
| `plus_access_state(p_org)` | state for the **caller**: `none`, `locked` (Admins only, so the UI can say "restricted"), `read_only`, `write`, `read` (grant holders), plus `trial_ends_at` | never raises; `none` for anyone without a relationship | authenticated |

`_plus_member_access` always goes through `has_org_role` (or the same active-membership + active-organization join). Suspension and inactive membership therefore remove Plus exactly as they remove Core.

> **Implementation status (NP-P1-S2, migration `20261013120000`):** `plus_can_read`, `plus_can_write`, `_require_plus_write` and `_require_plus_admin_write` exist with the S2 (Admin-only) rule. `_plus_member_access` and the grant-aware bodies arrive with named-staff grants in NP-P1-S3, which replaces these function bodies.
>
> **Implementation status (NP-P1-S3, migrations `20261013160000` and `20261013160100`, local only; decisions owner-approved 2026-10-14 as ZD-209 (constraint, was PD-20) and ZD-210 (named-staff grants, was PD-03), including the approved reactivation behaviour, section 2.2):**
> - `_plus_member_access` and the grant-aware `plus_can_read`, `plus_can_write` and `plus_access_state` exist. `plus_access_state` keeps the four states and adds `access` (`none` / `read` / `write`). It never returns a state value `read`, so the four effective states stay unchanged.
> - **Deviation, stricter:** `membership_module_grants` has **no** client SELECT policy or privilege (class A). Admins read it through `plus_list_member_access`, and a member learns their own access through `plus_access_state`.
> - ~~**Deferred:** the `plus_activities` row for each grant change (section 2.2) waits for P1-S4, which creates that table.~~ (CORRECTED by ZD-211: no `plus_activities` row is written for grant changes, in S4 or later, without a separately approved workspace-feed design.) Grant changes are audited in `audit_events`.
> - `requirePlusAccess` now resolves through `requireOperationsAccess`. Settings, including Team access, stays Organization-Admin-only through `requireOrganizationAdminAccess`.
>
> **Implementation status (NP-P1-S4, migration `20261014100000`, local only):**
> - `plus_contacts` and `plus_activities` follow section 3.2 exactly: RLS `plus_can_read`, `SELECT` only, and writes only through `_require_plus_write` RPCs. Tests T1–T9, T12, T19 and T20 are covered by `plus_contacts_activities_tests.sql`.
> - Free text (notes, logged interactions, archive reasons) carries the C6 notice "Don't record medical…". It is a reminder, not a control.
> - Nothing is sent, called or scheduled. `do_not_contact` is stored for future outreach to enforce.
> - **Gate:** synthetic data only until PD-10 and PD-11 are resolved.

### 3.1a Entitlement states — behaviour summary

| Effective state | Plus UI | Plus data | Writes / automations | Inquiry form submissions | Core |
|---|---|---|---|---|---|
| `write` | full | Admin + grants | yes | accepted | unaffected |
| `read_only` (elapsed trial, elapsed period, `expired`, `cancelled`, `disabled`+`read_only`) | Admin read + export, banner | Admin only | **no** | refused (uniform 404) | unaffected |
| `locked` (`disabled`+`no_access`) | Growth hidden; Settings shows "Nemryn Plus access is restricted — contact Nemryn" | **no tenant read** (retained, not deleted) | no | refused | unaffected |
| `none` | hidden | none exists | no | refused | unaffected |

- A `locked` organization's data can be exported for the customer **only** by Nemryn, through a reviewed operational procedure. No product feature does this in v1.
- Restoring access is a Platform Admin status change, audited.

Because every helper calls `has_org_role`, suspension and inactive membership are covered automatically and consistently with Core.

### 3.2 Table permissions (every `plus_*` table)

```
alter table … enable row level security;
grant select on … to authenticated;                    -- reads only; nothing else
create policy <t>_select_plus on … for select to authenticated
  using (public.plus_can_read(organization_id));
-- NO insert/update/delete grant, NO write policy.
```
- Writes happen only through Plus RPCs that call `_require_plus_write(p_organization_id)` first, then lock and validate.
- **Read-only state works automatically:** `plus_can_read` stays true for the Organization Admin, so history and export keep working, while every write RPC raises ZW001. Grant holders lose access in `read_only`. In `locked`, `plus_can_read` is false for everyone. No data is touched in any state.
- `organization_modules`: no grant and no policy (class A). It is read via `plus_access_state` and the platform RPCs.
- **Core functions never call any Plus helper.** Plus expiry therefore cannot affect Requests, dispatch, Trips, Drivers or Recurring Care.

### 3.3 Server guards (mirror, not replacement)

- `requirePlusAccess(currentPath)` (new module `src/lib/plus/access.ts`):
  - **P1-S1/S2:** resolves the context exactly like `requireOrganizationAdminAccess`.
  - **From P1-S3:** resolves it like `requireOperationsAccess`, so Dispatchers can pass with a grant.
  - Then calls `plus_access_state`:
    - `none` → redirect to `/operations`;
    - `locked` → redirect to `/operations/settings` (Admins see the "restricted" card);
    - otherwise returns `{ context, plusState }`.
  - Admin-only Plus pages (grants, inquiry-form settings) additionally require `organization_admin`.
- Plus Server Actions additionally rely on the RPC's own checks.
- Sidebar visibility is computed from the same `plus_access_state` (cosmetic only).

## 4. CRM ↔ Core boundary

| Direction | Allowed | Mechanism |
|---|---|---|
| Plus → Core **write** | Only to create a `pending` Request | `plus_convert_opportunity_to_request` / `plus_create_rebooking_request` call Core's `log_transportation_request`, which re-checks the Core role. `passenger_id` is always null |
| Plus → Core **link** | Attribution rows referencing Requests / facilities | Composite FKs; Plus tables only |
| Plus → Core **read** | Minimum-necessary summaries | `plus_get_request_summaries(p_org, p_request_ids uuid[])` returns: request id, state, source, created_at, preferred_date, service_type, decline/cancel `reason_code`, counts of linked Trips by state, first completed_at, linked arrangement count + status. **Never**: requester phone or email, pickup or destination text, assistance or additional notes, trip instructions, trip notes, exceptions, passenger fields |
| Core → Plus | **Nothing.** Core never reads or writes Plus tables | — |

> - For Admins and for Dispatchers with a grant, both of whom can already read Core tables through RLS, the read RPC is a **data-minimisation** boundary.
> - For growth-only members (PD-18) it is the **security** boundary: it must check `plus_can_read` and must **not** require a Core role. It must therefore be built and tested as a security boundary from the start.
>
> **Conversion requires a Core role.** `log_transportation_request` re-checks `has_org_role(org, [organization_admin, dispatcher])`, so a growth-only member gets ZW002 and hands the opportunity to Operations. That is intentional: only operations staff create Core work.

**Passenger identity:** Plus never matches a contact to a Passenger by name, phone or email. The Passenger link is made only by staff in Core (`link_request_passenger`) and is visible to Plus only as "a passenger is linked: yes/no".

## 5. Data categories

| Category | Examples | Where it lives | Plus may hold it? |
|---|---|---|---|
| C1 Business contact | facility name, coordinator name, work phone/email, title | `plus_accounts`, `plus_contacts` | ✅ |
| C2 Consumer contact | private-pay customer or caregiver name, phone, email | `plus_contacts` | ✅ (subject to PD-11 retention and the PD-10 HIPAA gate) |
| C3 Commercial | stage, estimate, quote, contract status, reported payment status | `plus_opportunities`, `plus_quotes` | ✅ |
| C4 Attribution | source, campaign code, UTM snapshot | `plus_opportunities`; Core `request_acquisition_attributions` | ✅ (no IP, cookie, click id or full URL, matching the existing rule `20260921120000…:28-31`) |
| C5 Operational / health-adjacent | pickup/destination, appointment type, assistance needs, trip notes, exceptions, passenger record | **Core only** | ❌ never copied. A `service_type` category (e.g. `dialysis`) on an opportunity **is** health-adjacent; it is allowed in Plus but is **never** exported to ad or analytics systems |
| C6 Free text | notes, logged calls | `plus_activities.body` | ✅ with a UI rule: "Don't record medical details", mirroring the public form's privacy copy (`src/lib/public-forms/public-form-core.ts:45`) |

## 6. Communications and consent (recorded from P2-S6; sending from NP-P4)

1. **Transactional vs promotional are separate systems.**
   - Trip and booking messages, if ever built, are Core transactional messages.
   - Plus sends only relationship follow-ups (`service_followup`) and promotional messages (`marketing`).
   - A Plus message never includes trip, appointment or assistance content.
2. **No send without consent.** A Plus outbound email or SMS requires the latest consent row for `(contact, channel, purpose)` = `granted`, and `do_not_contact = false`.
3. **Manual logging is not sending.** In NP-P2/P3, staff *log* calls and emails they made themselves; Plus sends nothing.
3a. **Consent capture starts in P2-S6.** Staff record verbal or written consent, and the web inquiry form records it in P2-S7:
    - `consent_followup` is required, so the operator may respond to this inquiry by the channels given;
    - `consent_marketing` is optional, unticked, and worded separately;
    - each stores `consent_text_version`.
    A follow-up consent never implies marketing consent.
4. **SMS** additionally requires a TCPA/10DLC review, a provider decision and a BAA determination before activation.
5. **Revocation** takes effect on the next send check (a ledger row, no cache).
6. **Sender identity:** reuse the Resend platform-sender boundary (`src/lib/email/send.ts`). Per-tenant sender domains remain a deferred white-label capability, as that file documents.

## 6b. Plus public inquiry boundary (P2-S7) — security requirements

| Control | Requirement |
|---|---|
| Separation | New route handler, pages, RPCs, rate-limit ledger and tables (domain model §13). **No change** to Core public-intake functions, tables or `src/lib/public-intake/*` (importing pure helpers is allowed) |
| Tenant resolution | Only from the opaque `public_key` of a **published** `plus_inquiry_forms` row, inside the service-role RPC. The body can never name an organization, contact, opportunity or status (closed key set) |
| Publication | Draft / published / disabled. Publishing requires an Organization Admin and effective state `write`. Submissions are refused (uniform 404) when the form is unpublished, the organization is suspended, or the effective state is not `write` (elapsed trial, expiry, any disable) |
| Abuse | Durable atomic rate limit per form and per client (salted SHA-256 of the IP, never the raw IP); 8 KB body cap; Origin restricted to Nemryn's own origins; honeypot + minimum fill time; idempotency key unique per organization; uniform minimal responses (no ids, reasons or limits disclosed). Challenge provider: PD-16 |
| Minimisation | Name, phone and/or email, relationship, inquiry type, offered service type, optional postal code, coarse timeframe, ≤ 500-char question with a "no medical details" notice. **No** street address, date of birth, diagnosis, insurance, appointment details or free-form attachments |
| Consent | Separate follow-up (required) and marketing (optional, unticked) checkboxes; text versioned; copied to the consent ledger only when staff convert the inquiry |
| No auto-creation | A submission creates **only** a `plus_inquiries` row. No contact, opportunity, Core Request, Passenger or Trip is created until staff act, and even then never a Core record |
| Privileges | `submit_plus_inquiry` and `check_and_record_plus_inquiry_rate_limit`: `service_role` only. Callers are `server-only` modules. Per the A01 finding, the service-role client's doc comment must be updated to list its real callers |
| Headers | Hosted page: `frame-ancestors 'none'`, `X-Frame-Options: DENY`; embed: `frame-ancestors *`; both `noindex`, `no-store`, trimmed referrer, matching `next.config.ts` for `/request` and `/embed/request` |
| Real data | Not before PD-10 and PD-11 close. Synthetic data only in every environment until then |

## 7. Advertising & analytics

- Attribution is **inbound only**: UTM, landing path and referrer host, captured as today.
- **No** tracking pixel, tag manager or analytics script on `/operations/**`, `/request/**`, `/inquiry/**`, `/embed/**` or the driver PWA.
- **No** outbound conversion upload (Google/Meta offline conversions) in the beta. Any future upload must:
  - contain aggregated or hashed non-health data only;
  - exclude `service_type`;
  - be reviewed under PD-10.

## 8. Required tests (each implementing phase extends these)

Harness: the existing `pg_temp.try_as(role, uid, stmt)` pattern (`supabase/tests/platform_admin_foundation_tests.sql:17-30`). All suites must be **rollback-only**: no committed fixtures (A01 risk P1-4).

| # | Test | Expected |
|---|---|---|
| T1 | Cross-tenant read: Org A admin selects Org B `plus_*` rows | 0 rows |
| T2 | Cross-tenant write: Org A admin calls a Plus RPC with Org B's id or Org B's record ids | ZW002 |
| T3 | Wrong role: Dispatcher / Driver calls each Plus RPC and selects each Plus table | ZW002 / 0 rows |
| T4 | Suspended organization: admin of a suspended organization with Plus `active` | read 0 rows, write ZW002; Core behaviour unchanged (existing suites) |
| T5 | Inactive membership | as T4 |
| T6 | Read-only Plus (`expired`, `cancelled`, `disabled`+`read_only`, elapsed trial, elapsed `access_ends_at`) | Admin reads succeed; grant holders read 0 rows; every write RPC raises ZW001 |
| T6a | Locked Plus (`disabled`+`no_access`) | Admin and grant holders read 0 rows; writes ZW002; `plus_access_state = 'locked'` for Admin only; Core unaffected |
| T7 | No entitlement row | reads 0 rows; writes ZW002; `plus_access_state = 'none'` |
| T8 | Core unaffected by Plus state: run the request / trip / dispatch happy-path with Plus `none`, `read_only`, `locked` and `write` | identical results |
| T9 | Privileged misuse: anon / authenticated direct `insert/update/delete` on every Plus table and `organization_modules` | permission denied |
| T10 | Platform function misuse: an Org Admin calls `platform_set_organization_module` | ZW002 |
| T11 | Platform Admin without membership: `plus_can_read` | false; no tenant CRM rows readable |
| T12 | Cross-tenant relationship linking: attribution to an Org B Request / contact / account / facility | FK violation or ZW002 (never a link) |
| T13 | Duplicate conversion: same idempotency key twice, sequential and concurrent (bash concurrency test, like `request_decision_concurrency_test.sh`) | exactly one Request, one attribution, `changed=false` on replay |
| T14 | Request double attribution: a second `plus_link_request` for an attributed Request | ZW004 |
| T15 | Attribution consistency: an opportunity whose contact ≠ the attribution contact | ZW006 |
| T16 | CRM → Core minimisation: `plus_get_request_summaries` output columns | exactly the allow-listed columns |
| T17 | Conversion never sets a passenger and never creates a Trip | Request `passenger_id` null; trip count unchanged |
| T18 | Public intake unchanged: the existing `public_request_intake_tests.sql`, `public_intake_rate_limit_tests.sql` and concurrency scripts pass with no diff to any intake function | pass |
| T19 | Privilege contract: every new table/function listed; `privilege_contract_tests.sql` | 0 violations |
| T20 | Append-only: no RPC can update or delete `plus_activities` / `plus_communication_consents` rows | no such function in the contract |
| T21 | Grants: an Admin grants write to a Dispatcher → Dispatcher reads/writes; revoke → ZW002; grant to a Driver membership or a foreign membership → ZW006 / ZW002; a Dispatcher cannot grant | as stated |
| T22 | Grant holder in `read_only` cannot export; Admin can | as stated |
| T23 | Inquiry abuse: direct anon/authenticated call to `submit_plus_inquiry` → permission denied; unknown, draft, disabled, suspended-org, read-only and locked forms → identical 404; extra or forbidden keys (organization_id, status, contact_id) → 400; rate limit trips after the threshold; replay with the same key → one row | as stated |
| T24 | Inquiry never creates a contact, opportunity, Request, Passenger or Trip on submission; conversion creates a contact + opportunity only | counts |
| T25 | Inquiry consent: missing follow-up consent → refused; marketing defaults false; conversion writes ledger rows with `captured_via = 'web_form'` and the text version | as stated |
| T26 | Core public intake regression (T18) re-run after P2-S7 with no diff to any Core intake function | pass |
| T27 | Forward-FK safety: each Plus migration applies on top of the previous slice alone (fresh reset to that point), and later additive migrations validate every existing row | apply cleanly |
| T28 | Quotes: totals computed server-side; a `sent` quote is immutable; no quote state changes `payment_reported_status`, a Request or any Core row | as stated |
| T29 | Concurrent Platform Admin entitlement changes from the same rendered version (NP-P1-S2-R1; `plus_entitlement_versioned_tests.sql`, `plus_entitlement_versioned_concurrency_test.sh`) | exactly one applies; the other ZW003, nothing written, no audit |

## 9. Compliance and vendor gates (unresolved — do not claim compliance)

| Gate | Blocks | Owner |
|---|---|---|
| **PD-10 HIPAA applicability** — is the operator a covered entity or business associate for private-pay riders? Is Nemryn then a business associate? | Storing **real** C2 data in production Plus | Owner + counsel |
| **BAA availability** (Supabase, Vercel, Resend; any future SMS / telephony / payment vendor) | Same | Owner |
| **PD-11 retention / erasure** for CRM personal data | Same | Owner + counsel |
| **TCPA / 10DLC** | Any SMS | NP-P4 |
| **PCI scope** — hosted payment page only (no card data in Nemryn) | Any online payment | NP-P5+ |
| **State privacy laws** (consumer data requests) | Production Plus beta at scale | Owner |

Until these close: synthetic data only (e.g. the existing "Nemryn Pilot Simulation" tenant pattern), and no production Plus entitlement for a real operator.

## 10. Vendor dependencies

| Vendor | Today | Plus use |
|---|---|---|
| Supabase (Postgres, Auth) | system of record | all Plus data |
| Vercel | hosting | `/operations/growth` |
| Resend | transactional staff email | NP-P4 follow-up / marketing email (consent-gated) |
| SMS / telephony provider | none | NP-P4+ candidate, gated |
| Payment processor | none | NP-P5+ candidate, hosted flow only |
| Bot-challenge provider (e.g. Cloudflare Turnstile) | none | optional for the P2-S7 inquiry form (PD-16) |
| Ad platforms / analytics | none | not in beta |
