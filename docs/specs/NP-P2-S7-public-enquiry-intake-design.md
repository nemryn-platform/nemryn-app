# NP-P2-S7 — Public Inquiry Intake: Technical Design (PROPOSED)

**Status:** SUPERSEDED on 2026-10-24 by the APPROVED canonical design [docs/product/NP-P2-S7-public-inquiry-intake-design.md](../product/NP-P2-S7-public-inquiry-intake-design.md) (OD-S7-1 … OD-S7-17 + refinements A–D; ZD-243 … ZD-263). Kept as the proposal record; where the two differ (for example the activation allowlist, the service-type intersection and the consent FK binding), the canonical design wins.
**Supersedes, if approved:** the P2-S7 parts of `docs/product/plus-domain-model.md` §13 and `docs/security/plus-access-model.md` §6b. Those were written before the S6 consent ledger existed and need the corrections listed in §9.
**Decisions:** OD-S7-1 to OD-S7-18 in `docs/reports/NP-P2-S7-architecture-decision-review.txt`. This spec assumes each **recommended** option; a different choice changes the marked sections.
**Gates:** PD-10 (HIPAA/BAA) and PD-11 (retention / erasure) are OPEN. No real submission may be accepted until both close (OD-S7-16).

> **Naming.** The schema keeps `inquiry`, which existing columns already use: `stage = 'new_inquiry'`, `source = 'web_inquiry'`, `inquiry_type`. The staff-facing label is decided by OD-S7-2 (recommended: "Inquiries"). In this document "inquiry" and "enquiry" mean the same thing.

---

## 1. Product boundary (unchanged, PD-12)

- **Core** owns transportation Requests, booking, preferred service times and dispatch. Its public form (`/request/<key>`, `/embed/request/<key>`, `submit_public_form_request`) and the website-intake API (`/api/public-intake/website`, used by Zenward) are **not modified**.
- **Plus** owns general business questions. A public inquiry creates **one `plus_inquiries` row and nothing else**:
  - no contact, opportunity, Core Request, Passenger, Trip, consent row or notification.
- Staff review every inquiry. They convert it (create or link a Contact, and create a private-pay Opportunity) or dismiss it.
- A Core Request can only ever follow later, through the existing, separately authorized `plus_convert_opportunity_to_request`.

## 2. Data foundation (S7-A)

All new tables follow the Plus table contract (access model §3.2):
- RLS on, with a `select` policy via `plus_can_read`;
- `grant select` to `authenticated` only;
- every write through `SECURITY DEFINER` RPCs, with `revoke all … from public, anon`;
- composite `(id, organization_id)` foreign keys.

### 2.1 `plus_inquiry_forms` (publication; one per organization in v1)

| Column | Rule |
|---|---|
| `id` uuid PK, `organization_id` | `unique (organization_id)` (v1: one form); `unique (id, organization_id)` |
| `public_key` | `inq_` + 32 lowercase hex (128-bit CSPRNG); globally unique; never derived from an id. A namespace distinct from Core `form_` keys. Stable across edits and disable / re-publish |
| `status` | `draft`, `published`, `disabled` |
| `headline` | 1–120, trimmed |
| `intro_text` | ≤ 500, nullable |
| `offered_service_types` | text[], ≤ 9 distinct values. Each must be in the Core closed set (currently 9, including `airport_transportation`) **and** in the organization's `organization_service_offerings` (via the existing internal `_public_form_service_types` semantics, read-only reuse). May be empty, in which case the service question is hidden |
| `config_version` | int ≥ 1. Incremented on every saved change; copied onto each inquiry |
| `consent_text_version` | not null. The code constant of the wording rendered (e.g. `plus-inquiry-consent-v1`); set by the server, never by the client |
| `published_at`, `published_by`, `disabled_at`, `updated_at`, `updated_by`, `version` | `version` is the optimistic-concurrency token (ZW003 on a stale token, the existing pattern) |

There is **no** draft/live snapshot split (OD-S7-4). Saving a published form updates it live, after an explicit confirmation in the UI. The inquiry records `form_config_version`.

### 2.2 `plus_inquiries` (the triage inbox)

| Column | Rule |
|---|---|
| `id`, `organization_id` | `unique (id, organization_id)` |
| `form_id` | composite FK → `plus_inquiry_forms (id, organization_id)` |
| `form_config_version` | int, the version the person saw (server-authoritative) |
| `idempotency_key` | `^[A-Za-z0-9._:-]{8,100}$`; `unique (organization_id, idempotency_key)`. Column-level privilege hides it from client roles (the ZD-240 pattern) |
| `name` | 1–120, trimmed |
| `phone` | ≤ 40, nullable (stored as entered; matching normalises digits) |
| `email` | ≤ 254, nullable, lower-cased; `check (phone is not null or email is not null)` |
| `preferred_reply` | `phone`, `email`, `either` (OD-S7-3) |
| `relationship` | nullable: `self`, `family`, `caregiver`, `facility_staff`, `other`. Maps to `plus_contacts.contact_kind` on conversion |
| `inquiry_type` | `quote`, `availability`, `service_question`, `booking`, `other`. **Identical** to `plus_opportunities.inquiry_type` (this corrects §13.2's `booking_interest`) |
| `service_type` | nullable; must be in the form's `offered_service_types` at submit time |
| `timeframe` | nullable: `asap`, `this_week`, `this_month`, `later`, `not_sure` (no date or time) |
| `question` | 1–500, trimmed. The form says "Please don't include medical details" |
| `consent_followup` | boolean not null default false. An optional, unticked box (OD-S7-9) |
| `consent_marketing` | boolean not null default false. An optional, unticked box |
| `consent_text_version` | not null, copied from the form |
| `utm_source` … `utm_term`, `landing_path`, `referrer_host` | sanitised exactly as Core S4C (import the pure sanitiser; do not edit it) |
| `status` | `new`, `converted`, `dismissed` (`spam` becomes a dismiss reason; OD-S7-5) |
| `dismiss_reason` | `spam`, `duplicate`, `not_relevant`, `out_of_area`, `other`; `check ((status = 'dismissed') = (dismiss_reason is not null))` |
| `dismiss_note` | ≤ 500, nullable; required when the reason is `other` |
| `contact_id` | composite FK → `plus_contacts`; `check ((status = 'converted') = (contact_id is not null))` |
| `triaged_by`, `triaged_at` | set on convert / dismiss; cleared on reopen |
| `received_at` | server time |
| `version` | the optimistic-concurrency token |

- **Indexes:**
  - `(organization_id, status, received_at desc)`;
  - `(organization_id, lower(email))`;
  - `(organization_id, phone_digits)`, an expression index for duplicate hints.
- **Additive columns (named-constraint replacements, the established pattern):**
  - `plus_opportunities.inquiry_id`: composite FK → `plus_inquiries`, with a `unique (organization_id, inquiry_id) where inquiry_id is not null` index (one inquiry → at most one opportunity).
  - `plus_communication_consents.inquiry_id`: composite FK → `plus_inquiries`, nullable.
  - Replace `plus_consents_captured_via_check` to add `web_form`.
  - Replace `plus_consents_text_version_check` with: `(captured_via = 'web_form') = (consent_text_version is not null)`.
  - Add `check (captured_via <> 'web_form' or inquiry_id is not null)`.
  - Replace `plus_activities_activity_type_check` to add `inquiry_converted` (OD-S7-12). It requires `opportunity_id` and no free text.

### 2.3 `plus_inquiry_rate_limit_events` (own ledger)

- Columns: `form_public_key`, `client_key` (the salted SHA-256 of the IP; the same derivation as `src/lib/public-intake/rate-limit-core.ts`, imported and not edited), `occurred_at`.
- RLS on, with **no** policy and **no** grants to anon, authenticated or service_role.
- Written only by `check_and_record_plus_inquiry_rate_limit` (service_role EXECUTE only), which is atomic.
- Proposed limits (OD-S7-11): **5 per client per hour** and **60 per form per hour**. Core's equivalents are 8 and 120.
- No purge exists until PD-11 decides one (§7).

## 3. RPC contract

| Function | Caller | Guard | Effect |
|---|---|---|---|
| `plus_get_inquiry_form(org)` | authenticated | `plus_can_read` | the form row (no other org) |
| `plus_save_inquiry_form(org, headline, intro, services[], version)` | authenticated | `_require_plus_admin_write` + an active org | creates the draft or updates the row; `config_version++`; audit `plus_inquiry_form_saved` |
| `plus_publish_inquiry_form(org, version)` / `plus_disable_inquiry_form(org, version)` | authenticated | `_require_plus_admin_write` | status change; generates the key on first publish; audit `plus_inquiry_form_published` / `_disabled` |
| `get_public_plus_inquiry_form(key)` | **service_role** | — | public config only: org display name, headline, intro, service labels, `config_version`, consent text version. Returns NULL (→ uniform 404) unless published, org `active` and `_plus_entitlement_state = 'write'` |
| `check_and_record_plus_inquiry_rate_limit(key, client_key)` | **service_role** | — | `{allowed}` only |
| `submit_plus_inquiry(key, idempotency_key, payload fields…)` | **service_role** | — | resolves the org **only** from a published key and refuses identically under the same conditions. Validates every field (closed sets, lengths, the service subset, phone-or-email). Inserts `status = 'new'`. A replay returns the same row with `changed = false`. Returns `{accepted, changed}`, with no ids |
| `plus_list_inquiries(org, status, search, page)` | authenticated | `plus_can_read` | bounded page plus total; LIKE-escaped search over name / email / phone digits |
| `plus_get_inquiry(org, id)` | authenticated | `plus_can_read` | detail plus duplicate hints: up to 5 contact matches via `_plus_contact_matches` and up to 5 other open inquiries with the same email / phone digits. Read-only, **never merges** |
| `plus_convert_inquiry(org, id, version, contact_mode, contact_id?, contact_fields?, fill_blank_contact_fields bool, title, owner_membership_id?, dnc_acknowledged bool)` | authenticated | `_require_plus_write` | one transaction; see §5 |
| `plus_dismiss_inquiry(org, id, version, reason, note?)` | authenticated | `_require_plus_write` | `new → dismissed`; audit |
| `plus_reopen_inquiry(org, id, version)` | authenticated | `_require_plus_write` | `dismissed → new` only (a converted inquiry is final) |
| `plus_count_new_inquiries(org)` | authenticated | `plus_can_read` | the nav badge and Dashboard count |

- Error codes follow the existing contract:
  - **ZW001:** read_only.
  - **ZW002:** no access, foreign tenant or locked (no oracle).
  - **ZW003:** stale version.
  - **ZW004:** state conflict (already converted / dismissed, DNC grant refused).
  - **ZW006:** invalid input.
- Every new function goes into the privilege contract (`privilege_contract_tests.sql`).

## 4. Public submission boundary (S7-B)

```
GET  /inquiry/<inq_key>                 hosted page   (frame-ancestors 'none'; X-Frame-Options DENY; noindex; no-store)
GET  /embed/inquiry/<inq_key>           iframe page   (frame-ancestors *; noindex; no-store)
GET  /embed/inquiry-form.js             NEW loader    (copy of the Core loader protocol; the Core loader is not edited)
GET  /api/plus-inquiries/<inq_key>      public config (service_role read; uniform 404)
POST /api/plus-inquiries/<inq_key>/submit
     → kill switch PLUS_INQUIRY_SUBMISSIONS !== "on" → 404 (OD-S7-16)
     → key format check → Origin ∈ Nemryn's own origins (a missing Origin is allowed; never the auth boundary)
     → 8 KB body cap → JSON → closed-key validation (pure core; unknown or forbidden keys such as
       organization_id / status / contact_id → 400)
     → check_and_record_plus_inquiry_rate_limit (per form + per client) → 429 generic
     → submit_plus_inquiry → {"ok":true} | generic 400 | uniform 404
```

- **Shared-file edits (reviewed, minimal):**
  - `src/proxy.ts`: add `inquiry\/` and `api\/plus-inquiries\/` to `NO_SESSION_PATH`. `embed\/` is already covered. Do **not** add inquiry paths to the request-form host allowlist in S7 (OD-S7-13).
  - `next.config.ts`: header rules for `/inquiry/:path*`, `/embed/inquiry/:path*`, `/embed/inquiry-form.js` and `/api/plus-inquiries/:path*`, identical in policy to the `/request` equivalents.
  - `src/lib/supabase/service-role-server.ts`: **comment only**, correcting the stale caller list (the A01 / A02R A6 finding) and adding the new module.
- **New modules:**
  - `src/lib/plus-inquiry/inquiry-core.ts` (pure, unit-tested; field rules mirror the SQL CHECKs);
  - `inquiry-public.ts` (server-only service-role calls);
  - `inquiry-copy.ts`.
- **Browser privacy:** Core D2 rules. Input lives in component state only; the only browser storage is acquisition data. No IDs and no reference number are shown on success.
- **No honeypot** (Core D2 rejected one for accessibility / autofill false positives), **no challenge provider** in v1, and no fill-time token (OD-S7-11).

### Public form copy (owner to approve; OD-S7-9)

- Footer note: "Please don't include medical details. <Organization> will reply about your question using the contact details you give."
- ☐ (unticked) "<Organization> may follow up with me about transportation services by the contact details above."
- ☐ (unticked) "Send me news and offers from <Organization>."
- After submit: "Thanks — <Organization> will get back to you." No booking promise and no reference number.

## 5. Conversion (S7-C) — `plus_convert_inquiry`, one transaction, inquiry row `FOR UPDATE`

1. **Guards.** `_require_plus_write`; inquiry `status = 'new'` (otherwise ZW004); version matches (otherwise ZW003).
2. **Contact.**
   - `contact_mode = 'create'`: `plus_create_contact` semantics (display name, phone, email, `contact_kind` mapped from relationship, preferred channel from `preferred_reply`).
   - `contact_mode = 'link'`: an **active** contact of the same organization (archived or redacted → ZW004).
   - When linking, inquiry details **never overwrite** contact fields. With `fill_blank_contact_fields = true`, only a NULL phone / email on the contact is filled from the inquiry, through the `plus_update_contact` rules.
3. **Do-not-contact precedence.** If the contact has `do_not_contact = true`:
   - conversion requires `dnc_acknowledged = true` (server-enforced, audited; the quotes ZD pattern);
   - **no consent rows are written**;
   - DNC is never changed by an inquiry.
4. **Opportunity.**
   - Created via `plus_create_opportunity` semantics: `channel = 'private_pay'`, `stage = 'new_inquiry'`, `source = 'web_inquiry'`, `inquiry_type` / `service_type` copied, `inquiry_id` set, owner resolved by `_plus_resolve_owner` (default: the converter).
   - Title defaults to "<Name> — <inquiry type label>". It is editable.
5. **Consent (only if not DNC).** For each ticked purpose (`consent_followup` → `service_followup`; `consent_marketing` → `marketing`), and for each channel whose inquiry address is given **and equals the contact's current address after step 2**:
   - email → `email`;
   - phone → `voice` **only**;
   - append a `granted` row with `captured_via = 'web_form'`, `captured_at = inquiry.received_at`, `consent_text_version`, `inquiry_id`, `recorded_by = converter`, through the existing internal ledger path. This keeps the `seq`, digest, ZD-231 stale-evidence and ZD-235 rules.
   - **SMS is never derived from a web form**: TCPA needs explicit SMS wording, which is out of scope until NP-P4.
   - An address that doesn't match is skipped and shown to staff ("consent not copied: the contact has a different email").
6. **History.**
   - one `plus_activities` row `inquiry_converted` on the new opportunity (no free text; ZD-236 still holds, since consent itself writes no activity);
   - `audit_events` `plus_inquiry_converted` with ids only;
   - the inquiry gets `status = 'converted'`, `contact_id`, `triaged_by` / `triaged_at`.
7. **Never:** a Core Request, Passenger or Trip; a notification; any send.

## 6. Staff UI (S7-C)

- **Growth → Inquiries** (`/operations/growth/inquiries`). A new Growth child after Dashboard, with a "new" count badge (OD-S7-10).
  - Tabs: New · Converted · Dismissed · All.
  - Search; a `DataTable` with `navigableRows` (the NC-UX-01 pattern); bounded pages.
  - Columns: received, name, inquiry type, service, preferred reply, status.
- **Inquiry detail** (`/operations/growth/inquiries/[id]`):
  - the submitted fields;
  - consent ticks shown as "the person ticked …" (not "consent on record");
  - acquisition;
  - duplicate hints (matching contacts, other open inquiries);
  - actions **Convert** (dialog: create vs link, the DNC acknowledgement when needed, a consent-copy preview) and **Dismiss** (reason);
  - **Reopen** for dismissed inquiries;
  - history (received, triaged by / at).
  - read_only and READ-grant users see no actions.
- **Settings → Nemryn Plus → Inquiry form** (Organization Admin, effective `write`):
  - headline, intro, offered services, consent wording preview, Save, Publish / Disable;
  - the hosted link, the embed snippet and an iframe fallback, with builder guidance copied from Core D2;
  - when the kill switch is off: "Public inquiries are not enabled for this workspace yet" (no key shown).
- **Dashboard:** the existing summary gains a "New inquiries" count linking to the inbox. Broader metrics stay in P2-S8.
- Brand Lock v2 components only: PageHeader, FilterBar, DataTable, StatusBadge, Panel, Dialog, EmptyState.

## 7. Retention (PD-11 dependent — not implemented in S7)

Proposals for the PD-11 decision. **No purge code ships until it is decided**:
- `plus_inquiry_rate_limit_events`: 30 days;
- dismissed inquiries: 90 days after dismissal;
- converted inquiries: follow the contact's retention;
- consent rows: never deleted, redacted with the contact (ZD-232).

Erasure of a contact must also redact any inquiry linked to it.

## 8. Tests (summary; detail in the report)

- **SQL:**
  - `plus_inquiries_tests.sql` (rollback-only, `pg_temp.try_as`);
  - `plus_inquiries_concurrency_test.sh` (concurrent submit replay; concurrent convert / dismiss → exactly one wins);
  - privilege contract update;
  - T18 / T26: Core intake suites with **no diff** to any Core intake function.
- **Unit:** `inquiry-core.test.mjs`.
- **Browser:**
  - `tests/e2e/plus-inquiries/inquiries.e2e.mjs` on NemrynS1Iso;
  - plus QA2 strict, Quotes strict, UI-foundations P1a / P1b, and the consents E2E.

## 9. Corrections to earlier P2-S7 text (to apply on approval)

| Earlier text | Correction | Why |
|---|---|---|
| Follow-up consent **required** to submit | Both boxes optional and unticked; replying to the question needs no ledger grant | The brief: no implicit consent; consent must be freely given; ZD-230 purposes |
| Consent booleans "copied" to the ledger | Per channel, address-bound, voice not SMS, skipped on DNC or address mismatch | The S6 ledger is per (channel, purpose) with address digests (ZD-229, ZD-232, ZD-233) |
| `inquiry_type = booking_interest` | `booking` (the same set as opportunities) | 1:1 mapping, no translation table |
| `status` includes `spam` | A dismiss reason | One terminal "dismissed" state is simpler; spam remains countable |
| `postal_code` optional | Removed in v1 | Data minimisation; staff ask on reply (OD-S7-3) |
| Honeypot + fill time | Neither in v1; rate limit + closed schema + kill switch | Core D2 rejected a honeypot; a fill-time check needs a signed token and a new secret |
| Inbox in Pipeline → "Inquiries to review" | Growth → Inquiries | The owner's brief; a distinct workflow from opportunity stages |
| `organization_id` as the form PK | `id` PK + unique org | Matches Core D2; allows multiple forms later without a key change |
