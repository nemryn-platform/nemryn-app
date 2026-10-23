# NP-P2-S6 — Communication Consent Ledger: Design Specification

**Status:** **APPROVED** (owner decision lock, 2026-10-23).
- PD-19 → ZD-228.
- OD-S6-1 … 14 → ZD-229 … ZD-242. Approved choices: A, A, A, A, B, A, A, B, B, A, A, A, A, A.
- The three mandatory refinements R1 to R3 are incorporated (§2.6, §9, §4.1).
- Slices:
  - S6-A (database) merged (PR #30); migration 93 applied to production 2026-10-23 (NP-P2-S6C2-O2-production-migration.txt);
  - S6-B (UI) merged (PR #31) and deployed (NP-P2-S6B-consent-preferences-ui-implementation.txt; implementation notes §5.9);
  - S6-C released: readiness, backup and migration (S6-C1 / C2 / O1 / O2), synthetic production smoke PASS (S6-C3),
    closeout NP-P2-S6C4-final-production-closeout.txt.
  - Status: P2-S6 COMPLETE — PRODUCTION DEPLOYED, SYNTHETIC TESTING VERIFIED, REAL-CUSTOMER USE RESTRICTED (PD-10 /
    PD-11 open; ZD-241).
- The history of the proposal is preserved in [NP-P2-S6-decision-review.txt](../reports/NP-P2-S6-decision-review.txt); the lock is in [NP-P2-S6-decision-lock.txt](../reports/NP-P2-S6-decision-lock.txt).
- Where this document says "[OD-S6-n]", the approved option applies. Text describing a rejected option is historical.

**Date:** 2026-10-23
**Baseline:**
- origin/main `64396db`, which is the Production deployment;
- migration head `20261021100000`: 92 files in the repository and 92 versions in production, per NP-P2-S5-S3C / O1. V2-1 to V2-4 added no migration.

**Canonical sources (unchanged):**
- [plus-product-spec.md](plus-product-spec.md) §8 (P2-S6 row);
- [plus-domain-model.md](plus-domain-model.md) §12;
- [plus-access-model.md](../security/plus-access-model.md) §3, §6 and §8 (T20);
- [plus-decisions-proposed.md](plus-decisions-proposed.md) PD-10, PD-11, PD-19.

**Findings:** [NP-P2-S6-design-audit.txt](../reports/NP-P2-S6-design-audit.txt).

> S6 **records** what a person told the organization about being contacted. It does not send, schedule, call or automate anything. It does not decide whether a communication is lawful. Nemryn has had no HIPAA assessment; PD-10 and PD-11 are open. Every environment uses synthetic data until they close.

Decision references in the form **[OD-S6-n]** point to the decision review. Every one is now approved (ZD-229 … ZD-242).

---

## 1. Scope

| In S6 | Not in S6 |
|---|---|
| `plus_communication_consents`, an append-only ledger | Any sending, scheduling, telephony, SMS provider or automation (NP-P4) |
| Record-consent and revoke-consent RPCs | Web-form consent capture (P2-S7 adds `inquiry_id`, `web_form` and the text version) |
| Read RPCs: the current state and the history | Lawful-basis evaluation (concept C, §3) |
| Internal effective-consent resolver, for NP-P4 later | CSV export of consent (P2-S8, Admin-only) |
| Contact Detail → **Communication preferences** panel | Bulk import of consent (`imported` needs its own decision, OD-S6-10) |
| Revocation rows written when Do not contact is switched on [OD-S6-5] | WhatsApp, chat, push, mail or any new channel [OD-S6-1] |
| Neutral rewording of the Growth Agent consent caveat [OD-S6-9] | Erasure or redaction workflow (PD-11) |

---

## 2. Data model — `public.plus_communication_consents`

### 2.1 Columns

| Column | Type / rule | Set by | Notes |
|---|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | server | |
| `organization_id` | uuid not null → `organizations(id)` | RPC, from the server session's organization | Never trusted from the browser alone; `_require_plus_write` checks it |
| `contact_id` | uuid not null; composite FK `(contact_id, organization_id)` → `plus_contacts(id, organization_id)` | RPC | A tenant-isolating FK (T12): a row cannot point at another tenant's contact |
| `seq` | bigint `generated always as identity` | database | **The ordering key.** Assigned at insert, after the contact row lock, so per-contact order equals commit order [OD-S6-3] |
| `channel` | text, CHECK in (`email`, `sms`, `voice`) | staff | UI labels: Email / Text messages (SMS) / Phone calls. `voice` follows the domain model; `phone` is avoided so SMS and calls are never conflated [OD-S6-1] |
| `purpose` | text, CHECK in (`service_followup`, `marketing`) | staff | Service follow-up means responding to this person's own enquiry or booking. Marketing means promotional. Neither implies the other. Core operational / trip messages are **not** a Plus purpose [OD-S6-2] |
| `status` | text, CHECK in (`granted`, `revoked`) | staff (or the system for the DNC revocation) | Ledger event, not mutable state |
| `captured_via` | text, CHECK in (`verbal_phone`, `in_person`, `written`, `email_reply`, `do_not_contact`) | staff; `do_not_contact` by the system only | `web_form` is added by P2-S7 through a named-constraint replacement. `imported` needs a decision [OD-S6-10] |
| `captured_at` | timestamptz not null | staff (a date, defaulting to today) | When the person said it. ≤ now + 5 min; ≥ now − 366 days (the same window as activity logging) |
| `address_digest` | text, nullable; `^[0-9a-f]{64}$` | **server-computed** from the contact's current email (email) or phone digits (sms / voice) | Required when `status = 'granted'`. It binds the consent to the address it was given for [OD-S6-4] |
| `evidence_note` | text, nullable; trimmed; 1–500 characters | staff | The C6 "Don't record medical details" notice applies. Required when `corrects_consent_id` is set. No attachments, recordings or images |
| `corrects_consent_id` | uuid, nullable; composite FK `(corrects_consent_id, organization_id, contact_id)` → this table's `(id, organization_id, contact_id)` | staff | Marks the row as a correction of an earlier entry for the same contact [OD-S6-6] |
| `consent_text_version` | text, nullable; ≤ 40 | — | Reserved for P2-S7 (`web_form`). Always NULL in S6 |
| `idempotency_key` | text not null; validated by the existing `_plus_require_idempotency_key` (8–200 characters, `[A-Za-z0-9._:-]`) | client (one per dialog open) | Replay identity only |
| `recorded_by` | uuid not null → `auth.users(id)` | **server: `auth.uid()`** | Never a parameter |
| `recorded_at` | timestamptz not null default `now()` | **server** | Never a parameter |

**Deliberate deviation from domain model §12:** the domain model has a `captured_by` that is NULL for `web_form`. This design always records `recorded_by`, the staff member who wrote the row; in P2-S7 that is the staff member who converts the enquiry. Who *gave* the consent is the contact. Each row therefore has one accountable recorder, and §12 should be updated to match when S6 is approved.

### 2.2 Constraints

- `unique (id, organization_id)` and `unique (id, organization_id, contact_id)`. The second is the target of the correction FK.
- `unique (organization_id, idempotency_key)`.
- `plus_consents_granted_address_check`: `status <> 'granted' or address_digest is not null`.
- `plus_consents_dnc_check`: `captured_via <> 'do_not_contact' or (status = 'revoked' and corrects_consent_id is null)`.
- `plus_consents_correction_note_check`: `corrects_consent_id is null or evidence_note is not null`.
- `plus_consents_not_self_check`: `corrects_consent_id is distinct from id`.
- `plus_consents_captured_check`: `captured_at <= recorded_at + interval '5 minutes'`.
- `plus_consents_text_version_check`: `consent_text_version is null`. S7 replaces it with "required iff `web_form`".
- Every CHECK is **named**, so later slices replace it additively. This follows the `plus_activities_*_check` pattern (T27).
- No `json` / `jsonb` column, matching contacts and activities K-tests.

### 2.3 Indexes

- `(organization_id, contact_id, channel, purpose, seq desc)`: the resolver's "latest row per pair" lookup.
- `(organization_id, contact_id, seq desc)`: the history list.
- The unique indexes above.

### 2.4 Append-only enforcement (T20)

1. Privileges:
   - `revoke all … from public, anon, authenticated, service_role`;
   - `grant select … to authenticated`;
   - no insert / update / delete / truncate privilege for any client role.
2. RLS is enabled. The only policy is `for select to authenticated using (plus_can_read(organization_id))`.
3. No function in the contract updates or deletes this table. T20 extends to it.
4. **Defense in depth:** a `before update or delete` row trigger and a `before truncate` statement trigger raise `append_only` for every role, including the owner.
   - A future PD-11 erasure procedure would need a reviewed migration to work around them.
   - This matches the quote immutability guard style (`_plus_quotes_guard`).

### 2.5 What the model deliberately does not hold

- No plaintext copy of the email or phone: only the digest.
- No IP address, user agent, recording or file.
- No trip, appointment, health or Core Request reference. S7 adds only `inquiry_id` → `plus_inquiries`, never a Core table (PD-12).
- No lawful-basis field. Recording consent is not a legal determination (§3 C).

### 2.6 Address digest (APPROVED OD-S6-4 A, with refinement R1)

- `_plus_consent_address_digest(p_organization_id, p_channel, p_phone, p_email)` is internal, `stable`, and has no grant. It returns lowercase hex:

  ```
  sha256( 'nemryn.plus.consent-address.v1|' || organization_id || '|' || kind || '|' || normalized )
  ```

  - kind = `email` for the email channel, `phone` for SMS and voice;
  - normalized = `lower(btrim(email))`, or the phone's digits only.
  - It returns NULL when the contact has no address for that channel.
  - It uses the built-in `sha256()` (PostgreSQL ≥ 11), not pgcrypto, so it has no extension dependency.
- **R1 outcome:** plain SHA-256 with domain separation was selected; keyed HMAC was not. The full comparison is in NP-P2-S6-decision-lock.txt §3. In short:
  - the digest is used only for an equality comparison with the plaintext address that sits in the same tenant row (`plus_contacts`);
  - HMAC would protect only against an attacker who holds the database but not the key, and such an attacker already reads the plaintext;
  - HMAC would need new secret custody (Vault provisioning in every environment), key versioning and rotation, which is a new operational dependency.
  - Domain separation (organization id + kind + version) removes cross-tenant equality: the same phone in two organizations produces different digests. The version label allows a future algorithm change.
- **Privacy limits, stated plainly:**
  - the digest is **not** anonymisation and **not** irreversible removal of personal data;
  - a phone-number digest can be reversed by enumerating about 10¹⁰ candidates, and email digests by dictionary;
  - it is personal data, treated like the address itself;
  - PD-11 erasure must remove or neutralise digests together with the plaintext.
- **Normalisation consequence:** a reformatted phone with different digits (for example, adding a leading country code "1") changes the digest and makes the grant `address_changed`. That is the conservative direction: consent stops being effective until staff re-record it.
- **No plaintext copy** of the address on the ledger.
- Granting consent on a channel with no address (for example, email with no email on file) is refused (ZW006).

---

## 3. Effective-consent rules

Three separate concepts. The UI and the RPCs never merge them.

### A. Recorded affirmative consent

`recorded_status(org, contact, channel, purpose)` is the `status` of the row with the **highest `seq`** for that pair, or `none` if there is no row.

- Ordering uses the recording sequence, not `captured_at`. Backdating cannot reorder history [OD-S6-3].
- **Protection against stale evidence:** `plus_record_consent` refuses (ZW004 `stale_evidence`) a grant whose `captured_at` is earlier than the `captured_at` of the pair's latest **revoked** row (the highest `seq`). The one exception is the row this call corrects (a correction of an erroneous revocation). A revocation is always accepted, whatever its date.
- **A system `do_not_contact` revocation can never be corrected** (ZW004). Otherwise a correction could revive a pre-DNC grant (ZD-233).
- `none` never means consent. No row means no recorded consent.
- A correction row is an ordinary grant or revoke with a back-reference. Latest-row semantics are unchanged.
- `do_not_contact` revocation rows count like any other revocation.

### B. Effective consent (after suppression)

`_plus_effective_consent(org, contact, channel, purpose)` is internal, with no client grant in S6. NP-P4's sending check will call it. Evaluated in order, the first match wins:

| # | Condition | Result |
|---|---|---|
| 1 | The contact doesn't exist in this organization, or is `redacted` | `not_found` |
| 2 | Contact `status = 'archived'` | `suppressed_archived` |
| 3 | `plus_contacts.do_not_contact = true` | `suppressed_do_not_contact` (**overrides every grant**) |
| 4 | Recorded status is `none` or `revoked` | `no_consent_on_record` |
| 5 | Recorded status is `granted`, but its `address_digest` ≠ the digest of the contact's **current** address for the channel (or there is no address now) | `address_changed` |
| 6 | Otherwise | `consent_on_record` |

Properties:
- deterministic;
- read-time, with no cache, so revocation takes effect on the next check (access model §6.5);
- tenant-bound, since every lookup is keyed by `organization_id` and the composite FK;
- history is never erased.

### C. Lawful permission

**Not computed by Nemryn in S6.** Whether a specific message is lawful (TCPA, CAN-SPAM, state law, HIPAA marketing rules, the operator's own basis) is decided by the operator and counsel. For SMS it is also part of the NP-P4 TCPA / 10DLC gate.

- `consent_on_record` is a necessary input for NP-P4. It is not a sufficient permission.
- The UI never says "Allowed to contact", "Can contact" or "Opted in", and never shows a green "OK to send".
- The approved labels are in §5.3.

### Do-not-contact interaction [OD-S6-5 = B, APPROVED, ZD-233]

- While `do_not_contact = true`:
  - `plus_record_consent` refuses **grants** (ZW004 `do_not_contact`);
  - **revocations are always accepted**.
- When Do not contact changes from false to true (through `plus_update_contact`), the same transaction appends one `revoked` row (`captured_via = 'do_not_contact'`) for each pair whose recorded status is `granted`.
  - The note is NULL. The system generates the idempotency key. `recorded_by` is the staff member who set Do not contact.
  - Clearing Do not contact later therefore **never silently revives** an old grant; fresh consent must be recorded.
- `plus_create_contact` with Do not contact set has nothing to revoke and is unchanged.
- No other path changes `do_not_contact`. The consent RPCs never change it.

---

## 4. Server, RPC and RLS design

### 4.1 Permission matrix

| Actor | Read state / history | Record grant | Record revocation |
|---|---|---|---|
| Organization Admin, Plus `write` | ✅ | ✅ | ✅ |
| Organization Admin, Plus `read_only` | ✅ (history kept) | ❌ ZW001 | ❌ ZW001 [OD-S6-11] |
| Organization Admin, `locked` / `none` | ❌ ZW002 / 0 rows | ❌ ZW002 | ❌ ZW002 |
| Dispatcher with a **write** grant, Plus `write` | ✅ | ✅ | ✅ |
| Dispatcher with a **read** grant, Plus `write` | ✅ | ❌ ZW001 | ❌ ZW001 |
| Dispatcher with a grant, Plus `read_only` / `locked` | ❌ ZW002 / 0 rows | ❌ ZW002 | ❌ ZW002 |
| Dispatcher with no grant, or a revoked one | ❌ ZW002 / 0 rows | ❌ ZW002 | ❌ ZW002 |
| Driver | ❌ | ❌ ZW002 | ❌ ZW002 |
| Inactive membership / suspended organization | ❌ | ❌ ZW002 | ❌ ZW002 |
| Platform Admin without membership | ❌ | ❌ ZW002 | ❌ ZW002 |
| Another organization's member | 0 rows; ZW002 (no oracle) | ZW002 | ZW002 |
| `anon` | permission denied (42501) | 42501 | 42501 |
| `service_role` | no table privilege; **no service-role path** in S6 | — | — |

**`read_only` and revocations (APPROVED OD-S6-11 A, refinement R3):** in `read_only` even revocations are refused, because the established contract is that read_only never writes. No helper or RPC bypasses it.

**Mandatory NP-P4 prerequisite (R3):**
- Before any Plus outbound communication is enabled, a separately reviewed, **subscription-independent opt-out mechanism** must exist.
- It must remain usable while Plus is expired, cancelled, read_only or otherwise unable to accept CRM writes.
- It is not part of S6, and S6 creates no read_only write exception.
- The panel then says: "Changes to communication preferences can be recorded again when Nemryn Plus is active."
- Do not contact can't be changed in `read_only` either, because `plus_update_contact` also requires Plus write. No Plus suppression is recordable in that state.
- That is acceptable only because nothing sends in `read_only`. It is listed as risk R6 and OD-S6-11.

### 4.2 Functions

All are `security definer`, `set search_path = public, pg_temp`, and fully schema-qualified. Each starts with `revoke all … from public, anon, authenticated, service_role` and then explicit grants. Every function is added to the privilege contract (§7.1).

| Function | Kind | Grant | Guard / behaviour |
|---|---|---|---|
| `_plus_consent_address_digest(uuid, text, text, text)` | internal, stable | none | §2.6 (R1: the organization id is part of the input) |
| `_plus_append_consent(...)` | internal | none | Shared body of the two write RPCs (§4.3); status fixed by the caller |
| `_plus_consents_revoke_for_dnc(uuid, uuid)` | internal | none | The ZD-233 DNC step, called only by `plus_update_contact` |
| `_plus_consents_append_only()` | trigger | none | §2.4 |
| `_plus_effective_consent(uuid, uuid, text, text)` | internal, stable | none | §3 B. No caller check (internal callers only) |
| `plus_get_contact_consents(p_organization_id, p_contact_id)` | read, stable | authenticated | `plus_can_read` or ZW002, ZW001 without a uid. A foreign / unknown / redacted contact gives ZW002 (no oracle). Returns exactly 6 rows (3 channels × 2 purposes): `channel, purpose, recorded_status, effective_status, latest_consent_id, captured_via, captured_at, recorded_at, recorded_by_name, is_correction`. **No digest and no note** |
| `plus_list_contact_consent_events(p_organization_id, p_contact_id, p_limit, p_offset)` | read, stable | authenticated | Same guard. Newest first by `seq`. Limit 1–100, default 50. Returns `id, channel, purpose, status, captured_via, captured_at, recorded_at, recorded_by_name, evidence_note, corrects_consent_id, total_count` (total_count via `count(*) over ()`, the `plus_list_contact_activities` precedent; an addition made in S6-A for the UI's "History (n)"). **No digest, no idempotency key** |
| `plus_record_consent(p_organization_id, p_contact_id, p_channel, p_purpose, p_captured_via, p_captured_at, p_evidence_note, p_corrects_consent_id, p_idempotency_key)` | write | authenticated | §4.3 (grant) |
| `plus_revoke_consent(...)`, same parameters | write | authenticated | §4.3 (revoke) |
| `plus_update_contact` (existing; **body replaced**, signature unchanged) | write | unchanged | Adds the DNC revocation step (§3) [OD-S6-5] |

There are no named parameters for `recorded_by`, `recorded_at`, `seq`, `address_digest` or `status`. Status is implied by which RPC is called, so a forged status, actor, time or address is impossible.

### 4.3 Write algorithm (both RPCs)

1. `perform _require_plus_write(p_organization_id)`. This gives ZW002 or ZW001 with no oracle.
2. Validate the key: `v_key := _plus_require_idempotency_key(p_idempotency_key)` (ZW006).
3. Validate the enumerations:
   - channel and purpose against the CHECK sets;
   - `captured_via` in the **staff set** (`verbal_phone`, `in_person`, `written`, `email_reply`). `do_not_contact` and `web_form` from a caller give ZW006.
4. Validate the date: `p_captured_at` (NULL means now) must be ≤ now + 5 min and ≥ now − 366 days, else ZW006. The note is trimmed, 1–500 characters, else ZW006.
5. `select … from plus_contacts where id = p_contact_id and organization_id = p_organization_id for no key update`.
   - This serializes per contact, like `plus_log_contact_activity`.
   - Not found or `redacted` gives ZW002.
6. **Idempotent replay:** if a row with `(organization_id, idempotency_key) = (org, v_key)` exists:
   - same contact, channel, purpose and status: return it with `changed = false`;
   - otherwise ZW006 `idempotency_conflict`.
   A `unique_violation` on insert is mapped the same way, covering a concurrent first use.
7. State rules:
   - **Grant:**
     - contact `archived` → ZW004;
     - `do_not_contact` → ZW004;
     - no address for the channel → ZW006;
     - `captured_at` earlier than the latest revocation's `captured_at` for the pair → ZW004 `stale_evidence`.
   - **Revoke:** allowed for `active` **and** `archived` contacts [OD-S6-7]. When the recorded status is already `revoked`, the RPC still appends; a re-confirmed revocation is evidence, and replays are handled by step 6.
8. Correction: if `p_corrects_consent_id` is given, the referenced row must belong to the same organization, contact, channel and purpose, and be the pair's **current latest** row. Otherwise ZW003 `stale_state`. A note is required (ZW006). A `do_not_contact` system row cannot be corrected (ZW004).
9. Insert:
   - `address_digest` is computed from the locked contact row for grants. For revokes it is NULL; a revocation covers the channel whatever the address.
   - `recorded_by = auth.uid()`; `recorded_at` and `seq` are server defaults.
10. Audit: one `audit_events` row.
    - `entity_type = 'plus_contact'`, `entity_id = contact`;
    - `action = 'plus_consent_granted' | 'plus_consent_revoked'`;
    - `after_data = {consent_id, channel, purpose, captured_via, correction: bool}`.
    - **No note and no address**, following the "names, not values" rule.
11. Return `(consent_id, changed boolean, recorded_status, effective_status)`.

Errors use the existing codes only:
- ZW001 read-only;
- ZW002 not found / no access;
- ZW003 stale;
- ZW004 illegal transition;
- ZW006 invalid input.

### 4.4 Server layer (Next.js)

- New `src/lib/plus/consents-core.ts` (pure):
  - labels and enumerations;
  - date-window validation;
  - status-to-copy mapping;
  - unit tests in `consents-core.test.mjs`.
- New server actions beside the existing contact actions. Each one:
  - re-binds the organization from the session (`requirePlusAccess`);
  - re-checks `canWrite`;
  - sends the client-generated idempotency key;
  - never sends the actor, time, status or digest.
- The RPC remains the authority.
- No new route handler, no service-role client, no proxy or `next.config.ts` change.

### 4.5 Activities timeline [OD-S6-8 = B, APPROVED, ZD-236]

- S6 writes **no** `plus_activities` row, and `plus_activities_activity_type_check` is **not** replaced.
- The consent history lives in its own panel; the audit trail is in `audit_events`.
- The timeline contract (types, rendering, `plus_list_recent_activities`, Dashboard recent activity) is untouched.
- A later slice may add `consent_recorded` through the named-constraint replacement pattern.

---

## 5. Contact Detail UI — "Communication preferences"

### 5.1 Placement and anatomy (Brand Lock v2; no new design system)

- A new `Panel surface="raised"` directly **after the Details panel** and before Open tasks.
- Contact navigation, the header actions (Edit contact / Create another transportation request), Tasks, Linked requests, Opportunities and the Timeline are unchanged.
- `SectionHeader`:
  - title "Communication preferences";
  - icon from the existing Phosphor set, e.g. `ChatCircleText`, with `tone="accent"`;
  - description: "What this person told your team about being contacted by Nemryn Plus users. Recorded consent isn't permission to send — Nemryn sends nothing.";
  - header action, writers only: **Record consent** (`variant="outline"`, `size="sm"`).
  - The page's single teal action stays in the page header (V2-4 F1).
- `data-testid="contact-consents"`.

### 5.2 Do-not-contact warning

When `do_not_contact = true`, an `AttentionState level="warning"` appears at the top of the panel:
- **"Do not contact is on."** "This person asked not to be contacted. Any consent recorded below is suppressed. To change this, edit the contact."
- It links to the existing Edit contact page. The DNC control itself stays where it is.
- "Record consent" is hidden. A revocation can still be recorded.
- Existing DNC reminders (the booking dialog, the quote Mark-sent acknowledgment from ZD-223, Growth Agent exclusion) are unchanged.

### 5.3 Current state (a semantic table, not colour-only)

A `<table>` with a `<caption class="sr-only">Current communication preferences</caption>`:
- rows: Email / Text messages (SMS) / Phone calls (`<th scope="row">`);
- columns: Service follow-up / Marketing (`<th scope="col">`).

Each cell is a `StatusBadge` with text, plus a small line "Verbal on a call · 12 Oct 2026 · by Dana":

| effective_status | Badge text | Category |
|---|---|---|
| `consent_on_record` | "Consent recorded" | neutral / positive tone (**not** "Allowed") |
| `no_consent_on_record`, recorded `none` | "No record" | neutral |
| `no_consent_on_record`, recorded `revoked` | "Revoked" | warning |
| `address_changed` | "Recorded for a previous address" | warning |
| `suppressed_do_not_contact` | "Suppressed — do not contact" | critical |
| `suppressed_archived` | "Contact archived" | cancelled |

- Writers see a per-cell **"Revoke"** text button (`variant="ghost"`, `size="sm"`) on cells whose recorded status is `granted`. Its accessible name is "Revoke marketing consent for email".
- A footnote states that the preferred channel shown in Details is a convenience, not consent.

### 5.4 Dialogs (existing `Dialog`; focus in, Escape, focus return)

**Record consent:**
- `RadioGroup` Channel (3) and Purpose (2), each with a one-line explanation. Marketing reads: "Promotional news and offers. Separate from follow-up."
- `RadioGroup` "How did they tell you?" (phone call / in person / in writing / replied by email).
- Date given (default today; the 366-day window).
- Optional note (`Textarea`, 500 characters) with `NO_MEDICAL_DETAILS_NOTICE`.
- Required `Checkbox`: "This person gave this consent themselves, for this channel and purpose."
- Commit: **Record consent** (teal, the positive commit), next to Cancel (outline). It stays disabled until valid.
- If the channel has no address, the option is disabled with the reason ("No email address on this contact").

**Revoke consent:**
- Channel and purpose prefilled and read-only.
- The method and date, as for Record consent.
- Optional note.
- Copy: "Revoking keeps the history. It takes effect immediately."
- Commit: **Record revocation** (teal; it is the protective direction, not a destructive action).

**Correct an entry:** "This entry was recorded in error" from the history.
- It opens Record or Revoke with `corrects_consent_id` set and a required note.
- The original row stays visible, marked "Corrected".

Errors map to the existing inline `AttentionState` copy:
- ZW001: "Nemryn Plus is read-only";
- ZW004 DNC: "Do not contact is on";
- ZW004 stale_evidence: "A later revocation is already recorded";
- ZW003: "This changed — reload".

Success is announced through the existing `role="status"` notice.

### 5.5 History

- A `<details>` disclosure ("History (n)"), closed by default, containing `<ol aria-label="Consent history">`, newest first:
  - "Email · Marketing · **Revoked**";
  - the method, the date given and "recorded <time> by <name>";
  - the note;
  - "Corrects an earlier entry" or "Corrected" tags;
  - "Recorded automatically when Do not contact was switched on" for `do_not_contact` rows.
- Paged at 50, with a "Show more" button.

### 5.6 Empty state

When no rows exist and Do not contact is off: the V2 `EmptyState` (mint icon).
- **"No communication preferences recorded."**
- "Nemryn never assumes consent. Record it only when this person has told your team how they want to be contacted."
- Writers get "Record consent"; read-only users get the same wording without the action.

### 5.7 States

- Plus `read_only`: the existing "Nemryn Plus is not active" notice, the full history, no actions.
- Archived contact: revocation only.
- The read RPC fails: `AttentionState level="critical"` "Communication preferences couldn't be loaded" with Retry. It is distinct from the empty state.
- Responsive: at 768 and 390 the table becomes stacked definition lists per channel, with no horizontal overflow.

### 5.8 Growth Agent caveat [OD-S6-9]

- `CONSENT_CAVEAT` (`src/lib/plus/agent-core.ts:24`) would become potentially false once records exist.
- Recommended copy-only change: "Check this person's communication preferences before using this draft. A recorded consent isn't permission to send, and Nemryn sends nothing."
- No logic change: drafts still never claim consent and are still suppressed for DNC.

---

### 5.9 S6-B implementation notes (differences from §5.1 – §5.8, all within the approved decisions)

- **Header actions:** writers get **Record consent** (when a grant is possible) and **Record revocation** (Plus write; also
  for archived and do-not-contact contacts). Both are outline, so the page header keeps its single teal action.
  - A revocation can be recorded for any channel / purpose, not only for a cell that currently shows a grant. For
    example: "never text me".
  - The per-cell **Revoke** (text button, full accessible name) remains on granted cells.
- **No stacked phone layout:** the Operations shell renders its approved "designed for tablet and desktop use" notice
  below `md` (768), so no Contact page is shown at phone width. The semantic table is used at every width where the panel
  renders, and it fits at 768 with no overflow. The §5.7 stacked lists were therefore not built.
- **History:** a native `<details>` collapsed by default, with 20 entries per page. The pages are server-rendered from
  `plus_list_contact_consent_events` through `?consentHistory=N` (which opens the disclosure). A page past the end
  falls back to the newest page.
- **Correction:** "This entry was recorded in error" appears only on the pair's latest entry, and never on a
  `do_not_contact` system entry. It records the OPPOSITE state with `corrects_consent_id` and a required note.
  - It is offered only when that opposite write is itself allowed: correcting a grant needs revoke rights; correcting a
    revocation needs grant rights (active contact, Do not contact off).
- **Idempotency:** one key per dialog (`consent-<uuid>`), reused by any retry of the same submit.
- **Capture date:** organization-local. Today (or empty) is sent as NULL, so the server records now. A past date is
  sent as midday local time.

## 6. Privacy and retention

| Topic | Design position | Depends on |
|---|---|---|
| Minimisation | Only enumerations, dates, actor and a ≤ 500-character note. A digest instead of an address copy. No recordings, files, IP or device data | — |
| Real data | Synthetic tenants only, in every environment, until PD-10 **and** PD-11 close. This is the same gate as every Plus slice | **PD-10, PD-11** |
| Retention of events | Kept for the life of the contact. No purge or redaction function in S6 | **PD-11** (owner + counsel): how long consent evidence is kept after a contact is archived |
| Erasure | When a person asks to be erased, a record that they **opted out** is normally kept as a suppression record (statutory exceptions vary by law). S6 builds no erasure. The append-only trigger means erasure needs a reviewed procedure | **PD-11** (counsel): which fields survive redaction (e.g. keep channel / purpose / status / dates, drop the note, digest and actor name?) |
| Staff access to evidence | All Plus readers (Admin; read- or write-grant Dispatchers in `write`) see notes, the same as activity bodies. `audit_events` (Admin-readable) carries no note | APPROVED OD-S6-14 = A (ZD-242): visible to every Plus reader |
| API exposure | Only the two read RPCs and the RLS select. Both are `plus_can_read`-gated. The digest and idempotency key are never returned by the RPCs. Column-level SELECT grants exclude both from `authenticated` | APPROVED OD-S6-12 = A (ZD-240) |
| Exports | None in S6. P2-S8 CSV may include current consent state: Admin only, `write` / `read_only`, formula-neutralised, no notes | P2-S8 design |
| Future public enquiries (S7) | The form shows two versioned checkboxes: follow-up (required), marketing (optional, unticked). On **staff conversion** only, S7 writes rows with `captured_via = 'web_form'`, `consent_text_version`, `inquiry_id`, `recorded_by` = the converter. Follow-up consent maps to `service_followup` for **email and voice only** (the form says "by phone or email"); never SMS, never marketing unless ticked | P2-S7; PD-10 / PD-11 |
| Operational vs promotional | Core transactional / trip messages are not Plus purposes and never read this ledger. `service_followup` ≠ `marketing` | — |
| Health-adjacent content | The note carries the C6 notice. Promotional content must never include trip or health data (access model §6.1) | PD-10 |

**Safe to build and test now with fictional data:**
- the whole schema, RPCs, resolver, UI, SQL / unit / E2E / a11y tests;
- a production release of the empty table and UI;
- a smoke test on the synthetic "Nemryn Pilot Simulation" tenant.

**Not safe until PD-10 / PD-11 close:** any real operator's consent records.

---

## 7. Security test plan

The harness is the existing rollback-only `pg_temp.try_as` SQL suites plus bash concurrency scripts. Test IDs are proposals.

### 7.1 SQL — new `supabase/tests/plus_communication_consents_tests.sql`

| # | Test | Expected |
|---|---|---|
| P1 | Cross-tenant read: an Org A Admin selects Org B rows; calls the read RPCs with Org B's org or contact | 0 rows; ZW002 |
| P2 | Cross-tenant mutation: Org A writer calls record / revoke with Org B's organization, an Org B contact, or mixed ids (Org A org + Org B contact) | ZW002; nothing written |
| P3 | Direct DML: anon / authenticated `insert`, `update`, `delete`, `truncate` | 42501 (permission denied) |
| P4 | Owner-level update / delete / truncate (the trigger) | raises `append_only` |
| P5 | Forged references: an unknown contact, a redacted contact, a correction id from another contact / pair / org | ZW002 / ZW003; FK violation if inserted directly |
| P6 | Forged actor / time / status / digest: no such parameters exist (catalog check of the signatures); named-call attempts with extra args | function does not exist |
| P7 | `read_only`: Admin reads; grants refused ZW001 for both RPCs; grant holders read 0 rows | as stated |
| P8 | `locked`, `none`, suspended org, inactive membership, Platform Admin without membership, Driver, no-grant Dispatcher | 0 rows / ZW002 |
| P9 | Read RPC output columns are exactly the allow-list (no digest, key or note in the state RPC) | as stated |
| P10 | Grants: read-grant Dispatcher ZW001; write-grant writes; revoke the grant → ZW002 at once; reactivation per ZD-210 | as stated |
| P11 | Ordering: grant → revoke → state `revoked`; revoke → grant (later `captured_at`) → `granted`; a grant with `captured_at` before the latest revocation → ZW004 `stale_evidence` | as stated |
| P12 | Backdating cannot reorder: a revoke recorded last with an older `captured_at` still wins | `revoked` |
| P13 | Idempotency: same key twice → one row, `changed=false`; same key with a different pair or status → ZW006; invalid key → ZW006 | as stated |
| P14 | DNC precedence: grant while DNC → ZW004; revoke while DNC → accepted; effective state `suppressed_do_not_contact` for every pair | as stated |
| P15 | DNC switch-on (OD-S6-5 B): `plus_update_contact` false → true appends exactly one `do_not_contact` revoke per granted pair, none for others; clearing DNC leaves every pair `revoked` (no revival); a DNC no-op update writes nothing | as stated |
| P16 | Address binding: grant email, then change the contact's email → `address_changed`; grant on a missing address → ZW006 | as stated |
| P17 | Archived contact: grant ZW004; revoke accepted; effective `suppressed_archived` | as stated |
| P18 | Corrections: must reference the pair's current latest row (else ZW003), needs a note (ZW006); the original row is unchanged | as stated |
| P19 | `captured_via` from a caller = `do_not_contact` / `web_form` / `imported` → ZW006; date window ±; note length; channel or purpose outside the sets | ZW006 |
| P20 | Audit: one `audit_events` row per write, no note / address in `after_data`; replays write none | as stated |
| P21 | No side effects: request / trip / passenger / assignment / notification / task / activity / contact counts unchanged (except P15's contact update) | unchanged |
| P22 | Tenant FK: the composite FK and correction FK exist; every FK targets `organizations`, `auth.users`, `plus_contacts` or this table | catalog |
| P23 | Effective resolver: has no client EXECUTE; each of the 6 outcomes is reachable | as stated |

### 7.2 Concurrency — new `supabase/tests/plus_communication_consents_concurrency_test.sh`

- Concurrent grant and revoke on the same pair: both rows written, the final state equals the higher `seq`, seq order equals commit order.
- Concurrent same-key replays: exactly one row.
- A concurrent DNC switch-on and grant: either the grant is refused (ZW004), or it lands first and is then revoked by the DNC step. Never "DNC on + granted unrevoked".
- Concurrent corrections of the same latest row: exactly one wins, the other gets ZW003.

### 7.3 Existing suites changed deliberately (never weakened)

| File | Change | Why |
|---|---|---|
| `supabase/tests/privilege_contract_tests.sql` | Add `plus_communication_consents` to `c_tables` and `(…, 'SELECT')` to `c_auth_tbl`; add every new function with its EXECUTE class (`''` internal, `'u'` authenticated); update the replaced `plus_update_contact` entry if its ACL is restated | Checks 01 / 08 deliberately fail for an unlisted object |
| `supabase/tests/client_privilege_surface_tests.sql` / `function_privilege_tests.sql` | Add the new surface | Same contract |
| `supabase/tests/plus_contacts_activities_tests.sql` | **Extend** with the DNC switch-on assertions (P15) for `plus_update_contact`. K8 (line ~198) and L4 (line ~330) stay **unchanged and must still pass**: K8 constrains only FKs *on* contacts / activities, and L4 keeps `consent_recorded` non-loggable | Strengthen only |
| `src/lib/plus/contacts-core.test.mjs:26` | Unchanged; must pass | `consent_recorded` stays non-loggable |
| `supabase/tests/plus_quotes_lifecycle_tests.sql` (D5) | **Strengthen** `pg_temp.side()` to also count `plus_communication_consents` | "creates no consent record" becomes literally checked |
| `src/lib/plus/agent-core` tests | Update the expected `CONSENT_CAVEAT` text only if OD-S6-9 B is approved | Copy |

**Correction to NP-POST-UI-product-completion-audit.txt:** that report named `plus_contacts_activities_tests.sql:198` as the negative schema assertion S6 must change. It is not. Line 198 (K8) only asserts the FK targets of `plus_contacts` / `plus_activities` and that `plus_accounts` is absent. The assertions S6 must change deliberately are the **privilege contract allow-lists** above. No existing test asserts that `plus_communication_consents` is absent.

### 7.4 Application, E2E and accessibility

- Unit (`consents-core.test.mjs`): labels never contain "allowed / can contact / opted in"; date window; status-to-copy mapping; idempotency key format.
- E2E: a new guarded suite `tests/e2e/plus-consents/`, following the `plus-quotes/_config.mjs` local-only guard.
  - Admin records → revokes → corrects.
  - A write-grant Dispatcher records.
  - A read-grant Dispatcher sees no actions.
  - `read_only` Admin sees history, no actions.
  - Locked / Core-only / Driver / signed-out are refused.
  - DNC on hides Record and shows the warning; switching DNC on revokes.
  - Archived contact allows revoke only.
  - Database-verified outcomes.
- Accessibility:
  - axe has 0 serious / critical violations on Contact Detail in each state (1440 / 1024 / 768 / 390);
  - keyboard: each dialog opens with Enter, has focus inside, closes with Escape, returns focus to its trigger;
  - radio groups move with the arrow keys;
  - the disabled commit announces why;
  - screen reader: table caption and headers; the badge text carries the state (not colour); the success notice is `role="status"`; errors use `role="alert"`; the per-cell Revoke has a full accessible name; the history `<details>` summary includes its count.
- Regression: QA2 strict 199, P1a 48, P1b 52, Quotes strict 272, the 15 SQL suites, unit tests, and the full a11y sweep. All must stay at baseline.

---

## 8. Implementation slices (each needs separate owner authorization)

| Slice | Content | Gate |
|---|---|---|
| **S6-A Database** | One migration: table, constraints, triggers, RLS, digest / resolver helpers, 4 RPCs, the `plus_update_contact` body replacement (if OD-S6-5 B). The new SQL suite, concurrency script, privilege-contract updates, D5 strengthening | All SQL suites pass; T27 forward safety (applies on head `20261021100000` alone) |
| **S6-B Application** | `consents-core.ts` plus tests, server actions, the Communication preferences panel and dialogs, Agent caveat copy, E2E plus a11y | The full browser regression at baseline; no change to Core files |
| **S6-C Release** | Owner merge; production migration (owner-run); read-only verification (head 93 = repository, privilege contract 0 violations); synthetic-tenant smoke | PD-10 / PD-11 still gate **real data**, not the release |

## 9. Concurrency contract (refinement R2)

- **Per-contact lock order:**
  - `plus_record_consent` / `plus_revoke_consent` take `FOR NO KEY UPDATE` on the contact row;
  - `plus_update_contact` takes `FOR UPDATE`.
  These conflict, so every consent write and every contact edit on the same contact are serialized.
- **Sequence order:**
  - `seq` is allocated at INSERT, after the lock is held, so for one contact `seq` order equals the serialized write order;
  - across contacts, `seq` only needs to be unique.
- **DNC switch-on vs grant:**
  - If the grant waits for the edit, it re-reads the contact after the lock (READ COMMITTED returns the new row version), sees `do_not_contact = true`, and is refused (ZW004).
  - If the edit waits for the grant, its revocation step is a new statement and sees the committed grant, which is then revoked.
  - Either way no effective grant survives DNC switch-on.
- **Same idempotency key:**
  - On the same contact, the replay check runs under the contact lock.
  - On different contacts, the unique index `(organization_id, idempotency_key)` makes the loser wait and then fail. The `unique_violation` is caught and resolved as a replay (`changed = false`) or a conflict (ZW006).
- **Rollback:** each RPC is one statement-level transaction. Any error after the insert (for example, the audit insert) rolls back the consent row with it. There are no partial ledgers.
- The release-blocking invariant is verified by `plus_communication_consents_concurrency_test.sh`: turning DNC on cannot leave an effective grant active, and clearing DNC cannot revive a previously recorded grant.

## 10. Risks and release gates

| # | Risk | Mitigation |
|---|---|---|
| R1 | Staff read "Consent recorded" as permission to send | Wording rules (§3 C, §5.3); nothing sends; NP-P4 adds the lawful-basis gate |
| R2 | An old grant revives when DNC is cleared | OD-S6-5 B revocation rows; test P15 |
| R3 | Consent carries over to a new phone or email | Address digest; `address_changed`; test P16 |
| R4 | Backdated grant overrides a real revocation | Seq ordering plus the stale-evidence refusal; P11 / P12 |
| R5 | Changing a released RPC (`plus_update_contact`) | Signature unchanged; the body diff is limited to the DNC step; the existing contacts suites must pass unchanged plus P15 |
| R6 | In `read_only`, a revocation cannot be recorded | Nothing sends in `read_only`; document it; OD-S6-11 |
| R7 | A free-text note holds health details | C6 notice; 500-character limit; PD-10 gate |
| R8 | Erasure conflicts with append-only | PD-11; a reviewed procedure; triggers make any bypass explicit |
| R9 | S7 couples consent to Core intake | `inquiry_id` → `plus_inquiries` only; PD-12; no Core FK (P22) |
| R10 | Privilege drift | The privilege contract allow-list; column-level SELECT recommendation |

**Release gates:**
1. The owner closes the blocking decisions (decision review).
2. S6-A and S6-B gates are green on the isolated stack.
3. Owner merge.
4. Production migration with read-only verification.
5. Synthetic smoke.
6. **Real-operator use only after PD-10 and PD-11 close.**
