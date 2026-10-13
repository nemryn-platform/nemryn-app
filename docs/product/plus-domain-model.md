# Nemryn Plus — Domain Model (PROPOSED)

**Work item:** NP-P0-A02, refined in **NP-P0-A02R** · **Status:** PROPOSED — not implemented, no migration exists · **Date:** 2026-10-13
**Inputs:** `docs/reports/NP-P0-A01-nemryn-plus-architecture-audit.txt`; current source at `83506b0`.
**Companion docs:** [plus-product-spec.md](./plus-product-spec.md) · [../security/plus-access-model.md](../security/plus-access-model.md) · [plus-decisions-proposed.md](./plus-decisions-proposed.md) · [NP-P1-S1 brief](./NP-P1-S1-entitlement-implementation-brief.md)

This document proposes the smallest data model for Nemryn Plus. Nothing here exists in the database. Field lists show the *intended* shape. Each implementing migration is still reviewed on its own.

> **A02R changes in this file:**
> - Every forward foreign-key dependency is removed (§3: each migration only references tables that already exist).
> - Facility opportunities may now reference a decision-maker contact (§8).
> - The entitlement table gains a `restriction` column for security disables, and the trial default is 14 days (§4).
> - New tables:
>   - `membership_module_grants` (moved earlier, §5)
>   - `plus_communication_consents` (moved earlier, §12)
>   - `plus_inquiry_forms`, `plus_inquiries`, `plus_inquiry_rate_limit_events` (§13)
>   - `plus_quotes`, as staff-created structured estimates in stage Q1 (§14)
> - `plus_opportunities` gains `source_detail` and `inquiry_id`.

---

## 1. Ground rules (inherited from Core, verified in source)

| Rule | Source evidence |
|---|---|
| Every tenant-owned row carries `organization_id uuid not null references organizations(id)` and `unique (id, organization_id)` | `supabase/migrations/20260830130600_passengers.sql`, `20260830131000_trips.sql` |
| Cross-row references use **composite FKs** `(x_id, organization_id) → parent (id, organization_id)`, so a link across tenants is structurally impossible | `20260830131000_trips.sql`; `20260921120000_website_intake_acquisition_attribution.sql:48-56` |
| A nullable FK column is added later with `alter table … add column x_id uuid` followed by `add constraint … foreign key (x_id, organization_id) references parent (id, organization_id)`. Existing rows hold NULL, so they validate at once | precedent: `20260927120000_request_recurring_care.sql:24-33` (`recurring_arrangements.request_id`) |
| `organization_id` can never change after insert | `prevent_organization_id_change` trigger (`20260830130400_memberships.sql`) |
| RLS is enabled on every table; a new table has **no** client privilege until its migration grants one | `20260921110000_production_privilege_baseline_hardening.sql:1-80` |
| Client writes go through `SECURITY DEFINER` RPCs with `set search_path = public, pg_temp`, row locks before state checks, and a `changed` idempotency signal | ZD-086, ZD-090; `set_platform_organization_status` (`20260920130000_platform_admin_foundation.sql:989-1048`) |
| Error codes: `ZW002` not found (no existence oracle), `ZW001` visible but not permitted, `ZW003` stale, `ZW004` illegal transition, `ZW006` invalid input | `docs/data/mutation-api.md:19-24` |
| Every new table and function must be added to the privilege contract, or the contract fails | `supabase/tests/privilege_contract_tests.sql:1-25` |
| No hard deletes of business records (no DELETE policy exists anywhere) | `20260921110000…:20-22` |

Plus tables reference Core; Core never references Plus. Plus changes **no** existing Core function body or policy. There are two Core schema exceptions, each called out for review:
1. P1-S3 adds an additive `unique (id, organization_id)` constraint to `memberships` (§5).
2. The optional growth-only membership role (PD-18) is a separately approved Core change in NP-P2.

---

## 2. Entity overview (final state, after NP-P3)

```
organizations ─┬─ organization_modules (module='plus')                      P1-S1
               ├─ membership_module_grants ── memberships (Core)             P1-S3
               ├─ plus_contacts ── (account_id → plus_accounts)              P1-S4  (+account_id in P3-S1)
               ├─ plus_activities (append-only timeline)                     P1-S4  (+opportunity P2-S1, +account P3-S1)
               ├─ plus_opportunities (private_pay | facility)                P2-S1  (+inquiry_id P2-S7, +accounts P3-S1)
               ├─ plus_tasks                                                 P2-S2  (+account_id P3-S1)
               ├─ plus_request_attributions ── transportation_requests       P2-S3  (+referral_account_id P3-S1)
               ├─ plus_quotes (staff estimates; later rule-priced)           P2-S5  (+pricing_rule_version Q2)
               ├─ plus_communication_consents (append-only ledger)           P2-S6
               ├─ plus_inquiry_forms / plus_inquiries / *_rate_limit_events  P2-S7
               ├─ plus_accounts                                              P3-S1
               └─ plus_account_facilities ── facilities (Core)               P3-S2
```

---

## 3. Migration dependency sequence

### 3.1 Forward dependencies found in the A02 draft (all now removed)

| # | A02 draft column | Target | Created in (A02) | Table created in (A02) | Problem |
|---|---|---|---|---|---|
| F1 | `plus_contacts.account_id` | `plus_accounts` | P1-S3 / P2 | P3 | forward FK |
| F2 | `plus_activities.account_id` | `plus_accounts` | P1-S3 | P3 | forward FK |
| F3 | `plus_activities.opportunity_id` | `plus_opportunities` | P1-S3 | P2-S1 | forward FK |
| F4 | `plus_opportunities.account_id` | `plus_accounts` | P2-S1 | P3 | forward FK (and **required** for facility rows) |
| F5 | `plus_opportunities.referral_account_id` | `plus_accounts` | P2-S1 | P3 | forward FK |
| F6 | `plus_tasks.account_id` | `plus_accounts` | P2-S2 | P3 | forward FK |
| F7 | `plus_request_attributions.referral_account_id` | `plus_accounts` | P2-S3 | P3 | forward FK |
| F8 | private-pay consent capture on inquiries | `plus_communication_consents` | P4 (A02 §4.2) | P4 | consent recorded before its table exists |
| F9 | `plus_quotes.pricing_rule_version` | Core `organization_pricing_rules` | P2b | not scheduled | FK to an undesigned table |

### 3.2 Corrected sequence

Every step references only objects created in an earlier step or in Core. Every later column is **nullable and additive**, and every replaced CHECK is satisfied by all existing rows (the new columns are NULL in them).

| Step | Migration content | References (all pre-existing) |
|---|---|---|
| **P1-S1** | `organization_modules` + entitlement functions | `organizations`, `audit_events`, `auth.users` |
| **P1-S2** | `plus_can_read`, `plus_can_write`, `_require_plus_write`. Functions only | P1-S1 |
| **P1-S3** | `membership_module_grants`; replace the P1-S2 helpers with grant-aware versions | `memberships` (Core), P1-S1/S2 |
| **P1-S4** | `plus_contacts` (**no** `account_id`); `plus_activities` with `contact_id` only, and subject check `num_nonnulls(contact_id) = 1` | P1-S2/S3 |
| **P2-S1** | `plus_opportunities` with `channel check (channel = 'private_pay')`, `primary_contact_id` required, **no** account columns. Then `alter table plus_activities add column opportunity_id` + composite FK, and replace the subject check with `num_nonnulls(contact_id, opportunity_id) >= 1` | `plus_contacts` |
| **P2-S2** | `plus_tasks` with `contact_id`, `opportunity_id` (typed FKs) and `num_nonnulls(contact_id, opportunity_id) = 1` | P1-S4, P2-S1 |
| **P2-S3** | `plus_request_attributions` with `contact_id`, `opportunity_id` and `num_nonnulls(contact_id, opportunity_id) >= 1`. Add `plus_activities.request_id` (composite FK → `transportation_requests`) | Core `transportation_requests`, P1-S4, P2-S1 |
| **P2-S4** | Conversion and rebooking RPCs. No tables | P2-S3, Core `log_transportation_request` |
| **P2-S5** | `plus_quotes`, stage Q1: staff estimate lines, **no** pricing-rule column | P2-S1 |
| **P2-S6** | `plus_communication_consents` | P1-S4 |
| **P2-S7** | `plus_inquiry_forms`, `plus_inquiries`, `plus_inquiry_rate_limit_events`; `alter table plus_opportunities add column inquiry_id` + `alter table plus_communication_consents add column inquiry_id`, each with a composite FK → `plus_inquiries` | P1-S1, P1-S4, P2-S1, P2-S6 |
| **P3-S1** | `plus_accounts`, then additive columns on existing tables (see below) | P1–P2 tables |
| **P3-S2** | `plus_account_facilities` | P3-S1, Core `facilities` |
| **Q2** (after PD-08) | Core `organization_pricing_rules`; `alter table plus_quotes add column pricing_rule_id` + composite FK | P2-S5 |

P3-S1 additive changes, in one migration, in this order:
1. Create `plus_accounts` with `unique (id, organization_id)`.
2. `plus_contacts add column account_id` + FK `(account_id, organization_id) → plus_accounts`.
3. `plus_opportunities`:
   - add `account_id`, `referral_account_id` + FKs;
   - drop `plus_opportunities_channel_check` and add `channel in ('private_pay','facility')`;
   - add `check (channel <> 'facility' or account_id is not null)`.

   All existing rows are `private_pay`, so every new check validates.
4. `plus_tasks add column account_id` + FK; replace the subject check with `num_nonnulls(contact_id, account_id, opportunity_id) = 1`.
5. `plus_activities add column account_id` + FK; replace the subject check with `num_nonnulls(contact_id, account_id, opportunity_id) >= 1`.
6. `plus_request_attributions add column referral_account_id` + FK; replace the check with `num_nonnulls(contact_id, opportunity_id, referral_account_id) >= 1`.
7. The Plus RPCs are replaced (`create or replace`) to accept the new optional parameters. Old call shapes keep working because the new parameters are trailing and defaulted, following the R3 pattern.

Each step ships as its own migration with its own privilege-contract update and tests. Naming CHECK constraints explicitly (e.g. `plus_tasks_subject_check`) is **required**, so that later steps can drop and replace them deterministically.

---

## 4. `organization_modules` — Plus entitlement (P1-S1)

**Owner:** Nemryn platform. Written only by Platform Admin RPCs, and later also by a billing webhook through a service-role-only RPC.

| Column | Type | Rule |
|---|---|---|
| `organization_id` | uuid not null | FK `organizations(id)` |
| `module` | text not null | `check (module in ('plus'))` |
| `status` | text not null | `trial`, `active`, `expired`, `cancelled`, `disabled` |
| `restriction` | text | **only when `status = 'disabled'`**: `read_only` or `no_access` (see below); NULL otherwise |
| `trial_ends_at` | timestamptz | required iff `status = 'trial'` |
| `access_ends_at` | timestamptz | optional end of a paid or comped `active` period; NULL = open-ended |
| `status_reason` | text not null | 3–500 chars; Nemryn-internal |
| `updated_by` | uuid | `auth.users(id)` |
| `created_at`, `updated_at` | timestamptz | `set_updated_at` trigger |

- **Keys:** `primary key (organization_id, module)`; the row is never deleted.
- **Checks:**
  - `(status = 'trial') = (trial_ends_at is not null)`
  - `(status = 'disabled') = (restriction is not null)`
  - `status <> 'trial' or access_ends_at is null`
- **RLS:** enabled, no policy, no grant (privilege-contract class A).

### Effective state (computed at read time; no scheduler)

| Stored state | Effective state | Meaning |
|---|---|---|
| `trial`, `now() < trial_ends_at` | **write** | evaluation |
| `trial`, elapsed | **read_only** | trial ended normally |
| `active`, no end or `now() < access_ends_at` | **write** | paid or comped |
| `active`, elapsed `access_ends_at` | **read_only** | period lapsed |
| `expired` | **read_only** | normal non-renewal |
| `cancelled` | **read_only** | customer-initiated end; kept distinct from `expired` for commercial reporting |
| `disabled` + `restriction = 'read_only'` | **read_only** | Nemryn froze writes (e.g. billing dispute) |
| `disabled` + `restriction = 'no_access'` | **locked** | security or abuse restriction: no tenant user can read Plus data. Data is retained and nothing is deleted |
| no row | **none** | Core only |

- **Trial duration:** platform default **14 days** (`PLUS_TRIAL_DEFAULT_DAYS`, a constant in the platform RPC). A Platform Admin may set 7–30 days at grant time, or extend a running trial once by up to 30 days. Every change is audited with a reason (PD-17).
- **Core independence:** no Core function reads `organization_modules`. No effective state, `locked` included, can affect Requests, dispatch, Trips, Drivers, Recurring Care or Proof of Service. `organizations.status` (suspension) still overrides Plus, because every Plus helper builds on `has_org_role`.
- **Side effects of a non-`write` state** (computed, never stored):
  - published Plus inquiry forms stop accepting submissions (§13);
  - every Plus write RPC refuses;
  - automations (NP-P4) do not run.
- **Audit:** every change writes `audit_events` with `entity_type = 'organization_module'` and `action = 'platform_plus_access_changed'`. The before/after records hold `{status, restriction, trial_ends_at, access_ends_at}`, plus the reason.

## 5. `membership_module_grants` — named-staff Plus access (P1-S3; moved from NP-P5)

| Column | Rule |
|---|---|
| `organization_id` | not null |
| `membership_id` | composite FK `(membership_id, organization_id) → memberships (id, organization_id)`. Requires the additive Core constraint described in the note |
| `module` | `check (module in ('plus'))` |
| `access` | `read`, `write` |
| `granted_by`, `granted_at` | |
| `revoked_by`, `revoked_at` | NULL while active |

- **Keys:** `id` PK; `unique (membership_id, module) where revoked_at is null`. At most one active grant per member; history rows are kept.
- **RLS:** select policy `plus_can_read(organization_id)` for Admins, plus a member's own row. Writes go through `plus_grant_member_access` / `plus_revoke_member_access` (Organization Admin only, audited as `plus_member_access_granted` / `plus_member_access_revoked`).
- **Membership state:** a grant is effective only while the membership is `active` and its role is `dispatcher` (or `growth`, if PD-18 is approved). An Admin needs no grant. A `driver` membership can never hold a grant (RPC refuses with ZW006).
- **Note (verified A02R):** `memberships` has only PK `id` and `unique (organization_id, user_id)` (`20260830130400_memberships.sql`), and no table references it today. P1-S3 therefore adds `alter table public.memberships add constraint memberships_id_organization_id_key unique (id, organization_id)`. That is an **additive Core constraint**: it cannot fail because `id` is already unique, and it changes no row, policy or function. It is the one Core schema touch in NP-P1 and must be called out in review. The alternative (a plain FK to `memberships(id)` plus an RPC check of the organization) is rejected because it breaks the composite-FK isolation convention.

## 6. `plus_contacts` (P1-S4; `account_id` added in P3-S1)

| Column | Type | Rule |
|---|---|---|
| `id`, `organization_id` | | `unique (id, organization_id)` |
| `display_name` | text not null | 1–200, trimmed |
| `phone` | text | ≤ 40 |
| `email` | text | ≤ 254, lower-cased |
| `contact_kind` | text not null | `individual`, `family_caregiver`, `facility_staff`, `referral_source`, `other` |
| `job_title` | text | ≤ 120 |
| `preferred_channel` | text not null default `'phone'` | `phone`, `email`, `none` |
| `do_not_contact` | boolean not null default false | blocks every outbound action |
| `owner_user_id` | uuid | must hold Plus write access when set |
| `status` | text not null default `'active'` | `active`, `archived`, `redacted` (PD-11) |
| `created_by`, `created_at`, `updated_at` | | |
| *(P3-S1)* `account_id` | uuid | composite FK → `plus_accounts` |

- **Indexes:** `(organization_id, status, display_name)`; non-unique `(organization_id, email)` and `(organization_id, phone)` for duplicate *warnings*, never auto-merge; *(P3-S1)* `(organization_id, account_id) where account_id is not null`.
- **Deliberately absent:** date of birth, home address, mobility or assistance needs, diagnosis, payer or insurance identifiers, medical notes, and any `passenger_id`.
- **Check:** `phone is not null or email is not null or status = 'redacted'`. A contact must be reachable unless it has been redacted.

## 7. `plus_activities` (P1-S4; extended in P2-S1, P2-S3, P3-S1) — append-only

| Column | Rule |
|---|---|
| `id`, `organization_id` | |
| `activity_type` | `note`, `call_logged`, `email_logged`, `meeting_logged`, `stage_changed`, `task_completed`, `request_linked`, `attribution_changed`, `owner_changed`, `record_archived`, `consent_recorded`, `quote_sent`, `quote_status_changed`, `inquiry_converted`, `account_facility_linked`, `account_facility_unlinked`, `member_access_changed`. The CHECK is replaced additively as features ship |
| `body` | ≤ 2000; required for `note` and `*_logged` |
| `from_stage`, `to_stage` | `stage_changed` only |
| `contact_id` (P1-S4), `opportunity_id` (P2-S1), `request_id` (P2-S3), `account_id` (P3-S1) | composite FKs; `plus_activities_subject_check` as in §3.2 |
| `actor_user_id`, `occurred_at` | |

There is no update or delete RPC and no `metadata jsonb` column.

## 8. `plus_opportunities` (P2-S1; extended in P2-S7, P3-S1)

| Column | Type | Rule |
|---|---|---|
| `id`, `organization_id` | | |
| `channel` | text not null | P2-S1: `private_pay` only. P3-S1: `private_pay`, `facility`. Immutable after insert |
| `title` | text not null | 1–200 |
| `stage` | text not null | per-channel closed set (§8.1) |
| `primary_contact_id` | uuid | composite FK → `plus_contacts` |
| `inquiry_type` | text | private-pay: `quote`, `availability`, `service_question`, `booking`, `other` |
| `service_type` | text | the Core closed set (`20260920110000…:719-724`) |
| `source` | text not null | `phone`, `website`, `web_inquiry`, `email`, `referral`, `facility`, `walk_in`, `event`, `advertising`, `other` |
| `source_detail` | text | ≤ 120, e.g. "Dr. Lee's office". Lets a referral be recorded before accounts exist |
| `campaign_code` | text | ≤ 64, `^[a-z0-9][a-z0-9_-]*$` |
| `estimated_value_cents` | bigint | ≥ 0; an **estimate**, never revenue |
| `payment_reported_status` | text not null default `'none'` | private-pay: `none`, `deposit_reported`, `paid_reported`, `refund_reported`; staff-reported, **not** settlement (PD-09) |
| `lost_reason`, `lost_note` | | closed set; the note is required for `other` |
| `owner_user_id`, `converted_at`, `closed_at` | | |
| `created_by`, `created_at`, `updated_at` | | `updated_at` is the concurrency token |
| *(P2-S7)* `inquiry_id` | uuid | composite FK → `plus_inquiries`; `unique` where not null (one inquiry → at most one opportunity) |
| *(P3-S1)* `account_id`, `referral_account_id` | uuid | composite FKs → `plus_accounts` |

**Corrected contact constraints** (replaces A02 `(channel = 'private_pay') = (primary_contact_id is not null)`, which made it impossible for a facility opportunity to name its decision-maker):

| Constraint | Introduced |
|---|---|
| `plus_opportunities_private_pay_contact_check`: `channel <> 'private_pay' or primary_contact_id is not null` | P2-S1 |
| `plus_opportunities_facility_account_check`: `channel <> 'facility' or account_id is not null` | P3-S1 |
| Facility `primary_contact_id` is **optional**. When set, the contact's `account_id` must equal the opportunity's `account_id` (RPC-enforced: cross-row) | P3-S1 |
| Facility deals may involve several decision-makers. That is modelled through contacts on the account. A many-to-many "deal roles" table is **not** added in v1 | — |

**Indexes:** `(organization_id, channel, stage, updated_at desc)`, `(organization_id, primary_contact_id)`, `(organization_id, owner_user_id) where closed_at is null`. P3-S1 adds `(organization_id, account_id)`.

### 8.1 Stages
- **Private-pay (stored):** `new_inquiry → contacted → qualified → quote_sent → quote_accepted → converted`, plus terminal `lost`. After conversion, the displayed outcome (Booking pending / Booked / Served / Declined by operator / Cancelled) is **derived** from Core at read time and never stored (PD-05).
- **Facility (stored, P3):** `identified → contacted → discovery → proposal → negotiation → won`, plus terminal `lost`. Trip outcomes never move facility stages (PD-07).
- `quote_sent` is set automatically when a `plus_quotes` row moves to `sent` (P2-S5), or manually before that.

## 9. `plus_tasks` (P2-S2; `account_id` in P3-S1)

Same shape as A02: `title`, `due_at`, `assignee_user_id`, `status open|done|cancelled`, `completed_at`, `completed_by`. Subjects are typed FKs, with `plus_tasks_subject_check` per §3.2. The assignee must hold Plus write access (an Admin, or an active write grant) at assignment time.
**Indexes:** `(organization_id, status, due_at)`, `(organization_id, assignee_user_id, status, due_at)`.

## 10. `plus_request_attributions` (P2-S3; `referral_account_id` in P3-S1)

- **One row per Request:** `request_id` is the **primary key**, with a composite FK → `transportation_requests`. The independent nullable dimensions are `contact_id`, `opportunity_id` and *(P3-S1)* `referral_account_id`. The A02 resolution of the `request_id` uniqueness conflict is unchanged (PD-06).
- **Other columns:** `link_method` (`converted_from_opportunity`, `linked_existing_request`, `rebooking`); `conversion_idempotency_key`, with `unique (organization_id, conversion_idempotency_key)` where not null; `linked_by`, `linked_at`, `updated_at`.
- **RPC consistency rules:**
  - A private-pay opportunity's `primary_contact_id` must equal `contact_id`.
  - *(P3)* A facility opportunity's `account_id` must equal `referral_account_id`.
- **Reporting:** count a Request once per dimension; never sum across dimensions.
- **Conversion** (`plus_convert_opportunity_to_request`) and **rebooking** (`plus_create_rebooking_request`) are unchanged from A02:
  - same transaction and opportunity row lock;
  - idempotency key on the attribution;
  - Core `log_transportation_request` re-checks the Core role (`has_org_role(org, [organization_admin, dispatcher])`);
  - `passenger_id` is always NULL; no Trip is created.
- **Consequence for named-staff access:** a Dispatcher with a Plus grant can convert, because they hold the Core role. An Admin can convert. A **growth-only member (PD-18) cannot create a Core Request by design.** They hand the opportunity to Operations. A Core change to let them log Requests would need its own decision.

## 11. Opportunity vs repeat bookings vs recurring care (unchanged)

- The first booking goes through opportunity conversion.
- Later bookings are **rebookings** attributed to the contact, with no new opportunity.
- Standing schedules use Core Recurring Care from the accepted Request (`create_recurring_arrangement(..., p_request_id)`, `20260927120000…:24-36`). Plus has no recurrence engine.

## 12. `plus_communication_consents` (P2-S6; moved from NP-P4) — append-only ledger

| Column | Rule |
|---|---|
| `id`, `organization_id`, `contact_id` (composite FK) | |
| `inquiry_id` | composite FK → `plus_inquiries`, added in P2-S7 (nullable). Records that consent arrived with a web inquiry |
| `channel` | `email`, `sms`, `voice` |
| `purpose` | `service_followup` (responding to this person's own inquiry or booking), `marketing` (promotional) |
| `status` | `granted`, `revoked` |
| `captured_via` | `verbal_phone`, `web_form`, `written`, `email_reply`, `imported` |
| `consent_text_version` | text ≤ 40, required for `web_form`; the exact wording version shown |
| `evidence_note` | ≤ 500 |
| `captured_by` (NULL for `web_form`), `captured_at` | |

- **Current consent** = the latest row per `(contact_id, channel, purpose)`. `do_not_contact` overrides everything.
- **Moved earlier because** the web inquiry form (P2-S7) captures consent, and the ledger must exist before that.
- **Sending** is still NP-P4. In P2, consent is *recorded* only.

## 13. Plus public inquiry (P2-S7) — separate from Core public intake

### 13.1 `plus_inquiry_forms` — publication

| Column | Rule |
|---|---|
| `organization_id` | PK (one form per organization in v1) |
| `public_key` | text, globally unique, opaque random (the same generation approach as the Core form's public key), **distinct namespace** from Core keys |
| `status` | `draft`, `published`, `disabled` |
| `headline` | ≤ 120 |
| `intro_text` | ≤ 500 |
| `offered_service_types` | text[], a subset of the organization's Core `organization_service_offerings` at publish time (snapshot) |
| `consent_text_version` | text, the version id of the consent wording rendered |
| `published_at`, `published_by`, `updated_at` | |

- **RLS:** select via `plus_can_read`. Writes through `plus_save_inquiry_form` / `plus_publish_inquiry_form` / `plus_disable_inquiry_form` (Plus write). No anon access.
- **Publishing** requires: effective entitlement `write`, Organization Admin (not a grant holder, since this is a public-facing setting), and an active organization.

### 13.2 `plus_inquiries` — the triage inbox

Web submissions land **here**. They do not land in contacts, opportunities or Core.

| Column | Rule |
|---|---|
| `id`, `organization_id` | `unique (id, organization_id)` |
| `form_public_key_snapshot` | the key used (audit of which publication) |
| `idempotency_key` | ≤ 100; `unique (organization_id, idempotency_key)` |
| `name` | 1–120 |
| `phone` | ≤ 40 |
| `email` | ≤ 254; `check (phone is not null or email is not null)` |
| `relationship` | `self`, `family`, `caregiver`, `facility_staff`, `other` |
| `inquiry_type` | `quote`, `availability`, `service_question`, `booking_interest`, `other` |
| `service_type` | must be in the form's `offered_service_types` |
| `postal_code` | ≤ 10, optional (service-area check). **No street addresses** |
| `timeframe` | `asap`, `this_week`, `this_month`, `later`, `not_sure` (no exact date/time) |
| `question` | ≤ 500; the form shows "Please don't include medical details" |
| `consent_followup` | boolean not null (required true to submit) |
| `consent_marketing` | boolean not null default false (separate, unticked) |
| `consent_text_version` | not null |
| `utm_source` … `utm_term`, `landing_path`, `referrer_host` | same sanitisation rules as Core attribution (pathnames, bare host, no IP/cookie/click id) |
| `status` | `new`, `converted`, `dismissed`, `spam` |
| `triaged_by`, `triaged_at`, `dismiss_reason` (closed set) | |
| `contact_id` | composite FK → `plus_contacts`, set on conversion |
| `received_at` | |

- **Indexes:** `(organization_id, status, received_at desc)`.
- **RLS:** select via `plus_can_read`. Writes:
  - the **public submission RPC** (service-role only, below);
  - `plus_convert_inquiry` (Plus write). It creates or links a contact, creates a private-pay opportunity (`source = 'web_inquiry'`, `inquiry_id`) and copies the consent booleans into `plus_communication_consents` rows (`captured_via = 'web_form'`);
  - `plus_dismiss_inquiry` (Plus write, reason).
- **Conversion never creates a Core Request, Passenger or Trip.** A Request can only follow later, through the opportunity conversion path (§10).
- **Retention:** `spam` and `dismissed` rows are candidates for automatic purge after a fixed period. This is part of the PD-11 decision. Until it is decided, no purge exists and no real data is accepted.

### 13.3 `plus_inquiry_rate_limit_events` — own ledger

The same shape as Core `public_intake_rate_limit_events` (`20260919120000…:77-93`): `form_public_key`, `client_key` (salted SHA-256 of the client IP, the same derivation as `src/lib/public-intake/rate-limit-core.ts:28-29`, never the raw IP), `occurred_at`.
- RLS on, **no** grants.
- Written only by `check_and_record_plus_inquiry_rate_limit` (service_role only).
- It is a **separate table and function**. The Core ledger and its function are not reused or modified.

### 13.4 Submission boundary (application side)

```
browser → /inquiry/<publicKey> (hosted)  or  /embed/inquiry/<publicKey> (iframe)
        → POST /api/plus-inquiries/<publicKey>/submit
        → closed-key validation (pure core, unit-tested) + 8 KB body cap + Origin check (Nemryn's own origins only)
        → honeypot field + minimum fill time (server-checked; silently accepted-and-dropped on trip)
        → check_and_record_plus_inquiry_rate_limit (service_role) — per form + per client, rolling window
        → submit_plus_inquiry(p_public_key, p_idempotency_key, …) (service_role)
              resolves the organization ONLY from the published form row;
              refuses (uniform 404) if: no form / not published / organization suspended /
              Plus effective state ≠ 'write' / service_type not offered;
              inserts plus_inquiries (status 'new'); replay → same row, changed = false
        → uniform minimal response {"ok":true} or a generic message (no ids, no reasons)
```

- **New code paths only:**
  - `src/lib/plus-inquiry/*`
  - the new route handler, pages and RPCs
  - one **reviewed** change to the shared `src/proxy.ts`: add `/inquiry/`, `/embed/inquiry/` and `/api/plus-inquiries/` to `NO_SESSION_PATH`, and decide whether the hosted inquiry form is also served on `REQUEST_FORM_ORIGIN`
  - matching header rules in `next.config.ts` (the same framing and noindex policy as `/request` and `/embed/request`)
- **Not touched:** `submit_public_form_request`, `submit_public_transportation_request`, `_create_public_request`, `check_and_record_public_intake_rate_limit`, `public_intake_rate_limit_events`, `website_request_forms` / `_publications`, and `src/lib/public-intake/*` (pure helpers such as the attribution sanitiser may be **imported**, not edited).
- **Staff alert:** in-app "New inquiries" count on Growth Overview. An email alert would need a new `notification_events.event_type` (a Core CHECK change) and is deferred (PD-16).
- **Bot protection:** honeypot, fill time and rate limits in v1. A challenge provider (e.g. Cloudflare Turnstile) is a vendor decision (PD-16).

## 14. Quotes — staged (PD-08 revised)

### Stage Q1 (P2-S5): structured staff estimates (`plus_quotes`)

| Column | Rule |
|---|---|
| `id`, `organization_id`, `opportunity_id` (composite FK) | |
| `quote_number` | per organization, sequential, display only |
| `kind` | `estimate` (non-binding) or `quote` (operator commits to the price until `valid_until`) |
| `service_type` | Core set |
| `round_trip` | boolean |
| Line columns (staff-entered, each ≥ 0, cents) | `base_fare_cents`, `distance_miles numeric(7,1)` (staff-entered), `distance_cents`, `wheelchair_cents`, `assistance_cents`, `wait_cents`, `return_leg_cents`, `other_cents` + `other_label ≤ 60`, `discount_cents` |
| `total_cents` | computed by the RPC as the sum of the lines minus the discount; `check (total_cents >= 0)` |
| `currency` | default `'USD'` |
| `terms_note` | ≤ 500 |
| `valid_until` | |
| `status` | `draft`, `sent`, `accepted`, `declined`, `expired`, `superseded` |
| `supersedes_quote_id` | composite self-FK |
| `created_by`, `sent_at`, `responded_at` | |

- **Immutable once `sent`.** A revision creates a new row and marks the old one `superseded`.
- **Labelled everywhere** as "Estimate" or "Quote", **never** "Invoice", "Bill" or "Payment". Accepting a quote changes the opportunity's stage only. It records no money movement, creates no Request, and creates no receivable.
- "Sending" in Q1 means **marking it as sent**. Staff share it themselves: printed or read out on a call. Emailing a quote PDF is NP-P4 and consent-gated.

### Stage Q2 (after PD-08 pricing approval): Core pricing rules + calculation
- Core `organization_pricing_rules` (versioned, fixed columns: base fare, included miles, per-mile, wheelchair, assistance, included wait + wait fee, round-trip multiplier, minimum fare, after-hours fee) is owned by Core.
- A pure calculation function prefills the Q1 line columns.
- `plus_quotes` gains `pricing_rule_id` (nullable composite FK). Staff may still override any line, and the override is recorded.

### Stage Q3 (separate decision): payment processing
- A hosted payment-provider flow (no card data in Nemryn; PCI SAQ-A scope) on a separate ledger.
- **Not** part of Plus foundations, and not a billing system. `payment_reported_status` remains "staff-reported" until then.

## 15. Data lifecycle

- No hard deletes of business records. `archived` hides; `redacted` (PD-11 proposal) replaces a contact's name, phone and email with placeholders while keeping ids and links.
- Plus expiry or downgrade changes **access**, never **data**.
- `src/lib/supabase/database.types.ts` is regenerated in each implementing slice.
