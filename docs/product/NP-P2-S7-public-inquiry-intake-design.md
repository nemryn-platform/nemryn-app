# NP-P2-S7 — Public Inquiry Intake: Canonical Design (APPROVED)

**Status:** APPROVED by the owner on 2026-10-24: OD-S7-1 to OD-S7-17 as recommended, plus four mandatory refinements (A–D). OD-S7-18 (retention values) is DEFERRED to PD-11.
**Decisions:** ZD-243 to ZD-263 in [decision-register.md](./decision-register.md).
**Supersedes:** the proposal [docs/specs/NP-P2-S7-public-enquiry-intake-design.md](../specs/NP-P2-S7-public-enquiry-intake-design.md) and the earlier P2-S7 text in [plus-domain-model.md](./plus-domain-model.md) §13 and [plus-access-model.md](../security/plus-access-model.md) §6b.
**Review:** [NP-P2-S7-architecture-decision-review.txt](../reports/NP-P2-S7-architecture-decision-review.txt).

**Implementation status:**
- **S7-A (database) is implemented locally:** migrations `20261024100000_plus_inquiries_foundation.sql` and `20261024110000_plus_inquiries_rpcs.sql`; report `docs/reports/NP-P2-S7A-data-foundation-implementation.txt`.
- S7-B (public pages + route), S7-C (staff UI) and S7-D (closeout) are not started.

**Gates:** PD-10 (HIPAA / BAA) and PD-11 (retention / erasure) are **OPEN**. No real submission may be accepted, and no real organization enabled, until both close. The final public consent wording also needs legal review before real submissions.

> **Naming (ZD-245).**
> - The schema, routes and UI say **inquiry**. This matches the existing `stage = 'new_inquiry'`, `source = 'web_inquiry'` and `inquiry_type`, and the US market.
> - The staff navigation label is **Inquiries**.
> - The single S6 copy string that says "enquiry" should be aligned in S7-C.

---

## 1. Product boundary (PD-12 → ZD-243)

- **Core** owns transportation Requests, booking, preferred times and dispatch. Core's public form, the website-intake API (used by Zenward) and every Core intake function and table are **not modified**.
- A public inquiry creates **exactly one `plus_inquiries` row**. It creates no contact, opportunity, Core Request, Passenger, Trip, notification, consent row or audit row.
- Staff convert an inquiry (create or link a Contact, and create **one** private-pay Opportunity) or dismiss it.
- A Core Request can only follow later, through the existing `plus_convert_opportunity_to_request`.

## 2. Approved decisions

| OD | Decision | ZD |
|---|---|---|
| OD-S7-1 A | Hosted page + iframe embed + loader, on the app host | ZD-244 |
| OD-S7-2 A | Schema, route and UI say "inquiry"; the nav label is "Inquiries" | ZD-245 |
| OD-S7-3 B | Required: name, phone and/or email, inquiry type, question (≤ 500). Optional: preferred reply, relationship, service, timeframe. **No** postal code, address, date of birth, diagnosis, insurance, exact date or attachment | ZD-246 |
| OD-S7-4 A | One form per organization; draft / published / disabled; Organization Admin + Plus write; edits apply live and increment `config_version` | ZD-247 |
| OD-S7-5 A | Inquiry lifecycle: new → converted (final) / new → dismissed (reason) → new (reopen) | ZD-248 |
| OD-S7-6 A | No assignee on inquiries; the owner is set on the opportunity at conversion | ZD-249 |
| OD-S7-7 A | Idempotent replay + hint-only duplicate matching; never auto-merge or auto-dismiss | ZD-250 |
| OD-S7-8 A | Create or link a contact (never overwrite; optionally fill blanks) + always one NEW private-pay opportunity | ZD-251 |
| OD-S7-9 B | Both consent boxes optional and unticked; ledger rows only at conversion, per ticked purpose × matching address; email → email, phone → voice, never SMS; none for do-not-contact | ZD-252 |
| OD-S7-10 A | Growth → **Inquiries** (after Dashboard), with a new-count badge | ZD-253 |
| OD-S7-11 A | Core's controls (closed schema, publication, durable rate limit 5 / client / h and 60 / form / h, body cap, Origin, idempotency, uniform responses) + the kill switch; no honeypot, challenge or fill-time token in the synthetic phase | ZD-254 |
| OD-S7-12 A | One `inquiry_converted` activity on the new opportunity + audit rows for every triage and form action; consent writes no activity (ZD-236) | ZD-255 |
| OD-S7-13 A | App host only; the request-form host allowlist is not changed in S7 | ZD-256 |
| OD-S7-14 A | No developer / API intake for inquiries in S7 | ZD-257 |
| OD-S7-15 A | READ grant views; WRITE grant triages; Organization Admin configures and publishes; read_only Admin reads only | ZD-258 |
| OD-S7-16 A (amended) | S7 may be released inert. Public use needs BOTH the global kill switch ON **and** the organization on a Platform-Admin allowlist (refinement A). Synthetic tenants only until PD-10 + PD-11 close | ZD-259 |
| OD-S7-17 A | New-inquiry alerts are in-app only (count); no email or other notification | ZD-260 |
| OD-S7-18 | Retention values DEFERRED to PD-11; no purge code exists | — |
| PD-16 | (a) No challenge provider in the synthetic phase, re-decided before real data; (b) in-app count only | ZD-261 |
| Refinement A | Server-enforced activation allowlist, empty by default; publishing and every public call require it | ZD-262 |
| Refinement C | Inquiries carry only the eight Plus opportunity service types, intersected with the organization's offerings; never `airport_transportation` | ZD-263 |

Refinements B (S6 consent compatibility) and D (conversion safety) are part of ZD-252 and ZD-251.

## 3. Public activation safety (refinement A, ZD-262, ZD-259)

A form is publicly reachable **only when all five hold**:

| # | Condition | Enforced by | Default |
|---|---|---|---|
| 1 | `PLUS_INQUIRY_SUBMISSIONS = "on"` (global kill switch) | the S7-B server-only route, before any database call (hosted page, embed page, config GET and submit POST) | **OFF** |
| 2 | The organization is on `plus_inquiry_public_access` | the database: `_plus_inquiry_public_form`, used by `get_public_plus_inquiry_form` and `submit_plus_inquiry`; also required by `plus_publish_inquiry_form` | **EMPTY** |
| 3 | The form is `published` | the database | draft |
| 4 | The organization is `active` (not suspended) | the database | — |
| 5 | Plus effective state = `write` | the database (`_plus_entitlement_state`) | — |

- **Why this is the least-complex secure design:**
  - The allowlist is one tiny class-A table, written only by the Platform Admin RPC `platform_set_plus_inquiry_public_access`.
    - It requires a reason and is audited (`platform_plus_inquiry_public_access_changed`).
    - An Organization Admin can never enable their own organization.
  - Enabling one organization cannot expose another: the check is per organization, inside the same database function that resolves the key.
  - The kill switch is an environment variable read only by server code. It needs no deploy-time secret and no database change.
  - Removing either the switch or the allowlist row stops the form immediately, with no data change.
- **Staff configuration cannot bypass activation:** publishing is refused (ZW004 `public_access_not_enabled`) unless the organization is allowlisted. Saving a draft exposes nothing.
- No organization is allowlisted by any migration or seed. The allowlist starts empty in every environment, production included.

## 4. Data model (S7-A, implemented)

All tables follow the Plus contract:
- RLS on;
- SELECT policy via `plus_can_read`;
- no client INSERT / UPDATE / DELETE;
- `SECURITY DEFINER` RPCs with a pinned `search_path`;
- composite `(id, organization_id)` foreign keys.

### 4.1 `plus_inquiry_public_access` (class A)

`organization_id` PK → organizations; `reason` 1–500; `enabled_by`; `enabled_at`.
- No policy, and no privilege for anon / authenticated / service_role.

### 4.2 `plus_inquiry_forms`

| Column | Rule |
|---|---|
| `id`, `organization_id` | `unique (organization_id)` (one per organization in v1); `unique (id, organization_id)` |
| `public_key` | server default `'inq_' || encode(gen_random_bytes(16), 'hex')`; unique; `^inq_[0-9a-f]{32}$`; stable across edits, disable and re-publish |
| `status` | `draft`, `published`, `disabled` (published / disabled require their timestamp and actor) |
| `headline` | 1–120, trimmed |
| `intro_text` | ≤ 500, nullable |
| `offered_service_types` | no NULL or duplicate; only the eight Plus service types (`_plus_inquiry_service_types_valid`); canonical order |
| `config_version` | +1 on every saved content change |
| `consent_text_version` | set by the server (`plus-inquiry-consent-v1`); `^plus-inquiry-consent-v[1-9][0-9]*$` |
| `version` | the optimistic-concurrency token for staff writes (ZW003) |

- `authenticated` holds table-level SELECT through RLS.

### 4.3 `plus_inquiries`

| Column | Rule |
|---|---|
| `form_id`, `form_config_version` | composite FK to the form; the live config version at submit |
| `idempotency_key` | `^[A-Za-z0-9._:-]{8,100}$`; `unique (organization_id, idempotency_key)`; **never client-readable** (column privileges) |
| `name` | 1–120, trimmed, no control characters |
| `phone`, `email` | **exactly the `plus_contacts` CHECKs** (so conversion always yields a valid contact); at least one is required |
| `preferred_reply` | `either` (default), `phone` (needs a phone), `email` (needs an email) |
| `relationship` | optional: `self`, `family`, `caregiver`, `facility_staff`, `other` |
| `inquiry_type` | `quote`, `availability`, `service_question`, `booking`, `other` (identical to opportunities) |
| `service_type` | optional; one of the eight Plus types |
| `timeframe` | optional: `asap`, `this_week`, `this_month`, `later`, `not_sure` |
| `question` | 1–500, trimmed |
| `consent_followup`, `consent_marketing` | default false: **what the person ticked, not consent on record** |
| `consent_text_version` | the form's version at submit |
| UTM ×5, `landing_path`, `referrer_host` | Core's `request_acquisition_attributions` rules; values pass through Core's `_sanitize_acquisition` (read-only reuse) |
| `status` | `new`, `converted`, `dismissed` |
| `dismiss_reason` | `spam`, `duplicate`, `not_relevant`, `out_of_area`, `other`. Present iff `dismissed`; the note (≤ 500) is required for `other` |
| `contact_id` | composite FK; present iff `converted` |
| `triaged_by`, `triaged_at` | NULL iff `new` |
| `version` | the optimistic-concurrency token |

### 4.4 `plus_inquiry_rate_limit_events` (class A)

`form_public_key` (`inq_` format), `client_key` (64 hex: the server's salted SHA-256 of the IP, never a raw IP), `occurred_at`.

### 4.5 Additive changes to existing Plus tables

- `plus_opportunities.inquiry_id`:
  - composite FK;
  - unique where not null (one inquiry → at most one opportunity);
  - set-once trigger (`_plus_opportunity_inquiry_immutable`, ZW004).
- `plus_communication_consents` (refinement B):
  - a new `inquiry_id` column with a composite FK `(inquiry_id, organization_id, contact_id)` → `plus_inquiries (id, organization_id, contact_id)`, so a web_form grant can only cite an inquiry converted to **the same contact**;
  - `captured_via` + `web_form`;
  - `consent_text_version` required **iff** `web_form`, in the server's format;
  - new `plus_consents_web_form_check`: web_form ⇔ `inquiry_id`, and web_form rows are grants only, never corrections, with no note;
  - `inquiry_id` added to the client's column-level SELECT.
- `plus_activities`: `activity_type` + `inquiry_converted`. New `plus_activities_inquiry_subject_check` requires an opportunity and a contact, and no body.

## 5. Functions (S7-A, implemented)

| Function | Caller / guard | Behaviour |
|---|---|---|
| `platform_set_plus_inquiry_public_access(org, enabled, reason)` | authenticated, `_require_platform_admin` | allowlist add / remove; reason required; audited; no-op → changed=false |
| `platform_get_plus_inquiry_public_access(org)` | Platform Admin | enabled, since, by whom, why |
| `get_public_plus_inquiry_form(key)` | **service_role** | zero rows unless available (§3); org name, headline, intro, offered ∩ still-offered services, config version, consent text version |
| `check_and_record_plus_inquiry_rate_limit(form_key, client_key)` | **service_role** | atomic (advisory locks); 5 / client / h, 60 / form / h; malformed → false |
| `submit_plus_inquiry(key, idem, config_version, name, phone, email, reply, relationship, type, service, timeframe, question, followup, marketing, acquisition)` | **service_role** | `unavailable` / `form_changed` / `invalid` / `accepted` (+changed). One row only; replay → changed=false |
| `plus_get_inquiry_form(org)` | Plus read | one row: the form, `public_access_enabled`, `service_options` |
| `plus_save_inquiry_form(org, headline, intro, services, expected_version)` | Org Admin + Plus write | create (NULL version) or live edit; ZW006 / ZW003; audited |
| `plus_publish_inquiry_form(org, v)` / `plus_disable_inquiry_form(org, v)` | Org Admin + Plus write | publish needs the allowlist (ZW004); disabling a draft is ZW004; audited |
| `plus_list_inquiries(org, status, search, limit, offset)` | Plus read | bounded page, LIKE-escaped search (name, email, phone digits); no question or consent ticks |
| `plus_get_inquiry(org, id)` | Plus read | full detail without the idempotency key; ZW002 for unknown / foreign |
| `plus_list_inquiry_duplicate_hints(org, id)` | Plus read | ≤ 5 matching contacts + ≤ 5 other new inquiries; hints only |
| `plus_count_new_inquiries(org)` | Plus read | the in-app count |
| `plus_convert_inquiry(org, id, v, mode, contact, confirm_duplicate, fill_blanks, title, owner_membership, dnc_ack)` | Plus write | §6 |
| `plus_dismiss_inquiry(org, id, v, reason, note)` / `plus_reopen_inquiry(org, id, v)` | Plus write | lifecycle §2; audited (the reason, never the note) |

- **Internal (no EXECUTE for any role):**
  - `_plus_inquiry_service_type_list`, `_plus_inquiry_service_types_valid`, `_plus_inquiry_service_options`;
  - `_plus_inquiry_public_access_enabled`, `_plus_inquiry_public_form`;
  - `_plus_inquiry_append_web_form_consent`, `_plus_opportunity_inquiry_immutable`.
- **Error codes:**
  - **ZW001:** no uid, read_only, or READ grant writing.
  - **ZW002:** no access, foreign, or unknown.
  - **ZW003:** stale version.
  - **ZW004:** illegal transition, allowlist missing, or DNC acknowledgement missing.
  - **ZW006:** invalid input.

## 6. Conversion (refinement D, ZD-251; refinement B, ZD-252)

One transaction, under the inquiry row lock (`FOR UPDATE`): the inquiry must be `new` and the version must match.

1. **Contact.**
   - **create:** the released `plus_create_contact`, unchanged. It applies the duplicate warning: possible duplicates without confirmation → outcome `possible_duplicates`, **nothing written**. It also applies owner eligibility, validation and audit.
     - relationship → contact kind: self → individual, family / caregiver → family_caregiver, facility_staff → facility_staff, other → other.
     - preferred reply → preferred channel.
   - **link:** an ACTIVE contact of the same organization, locked `FOR UPDATE`. This serializes with `plus_update_contact` (the DNC switch), consent writes and archiving.
     - unknown / foreign / redacted → ZW002; archived → ZW004.
     - With `fill_blank_contact_fields`, only a NULL phone / email is filled; populated fields are **never** overwritten. The fill is audited (`plus_contact_updated`, source `inquiry_conversion`).
2. **Do not contact.** Linking a DNC contact needs `p_dnc_acknowledged` (ZW004 otherwise); the acknowledgement is recorded in the conversion audit. DNC is never changed by an inquiry.
3. **Opportunity.** The released `plus_create_opportunity`, unchanged: private_pay, new_inquiry, `source = 'web_inquiry'`, inquiry type and service copied, owner per the existing rules (no owner → unowned).
   - Its 30-second duplicate guard returning an EXISTING opportunity is refused (ZW004), so an inquiry is never attached to a hand-made opportunity.
   - `inquiry_id` is then set; it is unique and set once.
4. **Inquiry.** `converted`, with `contact_id`, triaged by / at and version +1.
5. **Consent.**
   - For each **ticked** purpose × channel with an inquiry address (email → `email`, phone → `voice`, **never `sms`**), one web_form grant is appended (`_plus_inquiry_append_web_form_consent`). It is written only when:
     - the contact is active;
     - the contact is not DNC;
     - the inquiry's address digest equals the contact's;
     - the evidence is ≤ 366 days old;
     - the evidence is not older than the pair's latest revocation (ZD-231).
   - Each grant records `captured_at` = the submission time, the inquiry's consent text version and `inquiry_id`; `recorded_by` = the converter.
   - Skipped pairs are returned (`<channel>/<purpose>:<reason>`): `do_not_contact`, `address_mismatch`, `no_contact_address`, `stale_evidence`, `evidence_too_old`.
6. **History.**
   - one `inquiry_converted` activity (ids only);
   - one `plus_inquiry_converted` audit row, with ids, mode, filled field names, the DNC acknowledgement and the consent counts;
   - one minimised `plus_consent_granted` audit row per grant (S6 shape + `inquiry_id`).
7. **Never:** a Core Request, Passenger, Trip, notification or send.

**S6 compatibility (verified):**
- every deployed S6 row satisfies the replaced and added constraints;
- no S6 function is replaced, and the S6 staff path still refuses `web_form`;
- the append-only triggers cover web_form rows;
- switching DNC on later revokes web_form grants like any other (ZD-233).

## 7. Service types (refinement C, ZD-263)

| Source | Values |
|---|---|
| Core organization offerings / requests | 9, including `airport_transportation` |
| Core hosted request form | 8 (airport deliberately excluded) |
| Plus opportunities | 8 (airport deferred; the CHECK is unchanged) |
| Plus contacts | none |
| Opportunity → Request conversion | passes the opportunity's value (8 ⊂ 9) |
| **Plus inquiry (S7)** | **the 8 Plus types ∩ the organization's current offerings** (no offerings = all 8); never airport |

- Every inquiry service therefore converts to an opportunity service unchanged, and no Plus enum is widened.
- A service the organization stops offering disappears from the public config and is refused at submission.

## 8. Remaining slices

- **S7-B:**
  - pages `/inquiry/<key>` and `/embed/inquiry/<key>`, the loader `/embed/inquiry-form.js`, and `/api/plus-inquiries/<key>` (GET config, POST submit);
  - the global kill switch `PLUS_INQUIRY_SUBMISSIONS` (default OFF) checked first;
  - pure validation core, 8 KB cap, Origin check, the salted-hash client key, uniform responses;
  - `src/proxy.ts` NO_SESSION_PATH (+`inquiry/`, `api/plus-inquiries/`);
  - `next.config.ts` headers;
  - a comment-only fix to the service-role client.
- **S7-C:** Growth → Inquiries, the inquiry detail, the convert and dismiss dialogs, Settings → Nemryn Plus → Inquiry form, the badge and Dashboard count, and a "Website inquiry form" label for `web_form` in Communication preferences.
- **S7-D:** integrated verification, a synthetic production smoke test with the kill switch and allowlist temporarily on for the synthetic tenant only, then off.
