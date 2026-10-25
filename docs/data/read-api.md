# Zenward Platform — Driver Read API

**Work item:** P1-E2-S3 — Secure Read Models & Driver Minimum-Necessary Projection
**Status:** Implemented and verified against a running local Supabase/Postgres instance. 177 SQL test assertions, and 15 real PostgREST/GoTrue HTTP checks, all pass.
**Last updated:** 2026-08-31

This document is the contract for the Driver read API added in this phase. It complements [driver-data-minimization.md](../security/driver-data-minimization.md) (the field-by-field rationale) and [mutation-api.md](./mutation-api.md) (the write-side equivalent, whose error contract and calling conventions are reused here).

## How to call these

Same as [mutation-api.md](./mutation-api.md): `POST /rest/v1/rpc/<function_name>`, `Authorization: Bearer <user access token>`, project `apikey`. All 4 functions are `STABLE` — they never write to `trips`/`trip_assignments`/`trip_events`/`audit_events` (verified: `provolatile='s'` in `driver_read_privilege_tests.sql`, and every mutation regression suite remains green after this phase, confirming these reads never interfered with write state).

## Error contract

Reuses the same 6-code contract as the mutation API (ZD-085): `ZW001 unauthorized` (no `auth.uid()`), `ZW002 not_found` (every other denial reason — see "Organization context" below for why this layer never returns `ZW001` for an authenticated caller), `ZW006 invalid_input` (`driver_list_trip_history`'s date-range validation only).

## Organization context (work item §11, ZD-095)

`driver_get_trip_detail(p_trip_id)` derives its organization from the Trip itself — no `organization_id` parameter exists. The other 3 functions accept `p_organization_id` because there is no single Trip to derive it from; **passing an organization_id never grants authority over it** — every function independently re-validates `auth.uid() → active Membership (role=driver) → linked active Driver row` in that specific organization on every call (`current_driver_id`, corrected in this phase — ZD-100). A caller cannot use the parameter to select which organization's data they see beyond what they are genuinely a Driver in.

---

## A. `driver_get_profile(p_organization_id uuid) returns driver_profile_result`

Returns the caller's own Driver profile in the given organization. `ZW002` if the caller has no active Driver row + active Membership (role=driver) there.

```
{ driver_id, organization_id, organization_name, display_name, phone, status }
```

Own data only — no minimization tension the way Passenger data has, but still an explicit composite type (never `RETURNS drivers`), and `user_id`/timestamps are dropped from the response.

## B. `driver_list_active_trips(p_organization_id uuid) returns setof driver_active_trip_summary`

Lists only Trips with a **currently active** `trip_assignments` row for the caller in the given organization, ordered by `scheduled_pickup_at`. Never unassigned Trips, another Driver's Trips, or a Trip the caller only ever historically held.

```
{ trip_id, assignment_id, state, scheduled_pickup_at, appointment_at,
  pickup_description, destination_description,
  passenger_display_name, vehicle_label, vehicle_status }
```

No passenger phone, no notes, no assistance/instructions text — deliberately narrower than detail (ZD-097).

## C. `driver_get_trip_detail(p_trip_id uuid) returns driver_trip_detail_result`

The controlled minimum-necessary projection for a Trip the caller **currently, actively** holds. `ZW002` for: nonexistent Trip, foreign-org, never-assigned, formerly-assigned-but-reassigned-away, inactive Membership, inactive Driver row, zero-membership user, Platform Admin without Driver context (ZD-095 — every one of these collapses to the same code, no existence oracle).

```
{ trip_id, assignment_id, state, scheduled_pickup_at, appointment_at,
  pickup_description, destination_description,
  passenger_display_name, passenger_phone,
  assistance_notes, instructions,
  vehicle_label, vehicle_status,
  driver_notes }
```

`driver_notes` is a `jsonb` array of `{id, body, created_at}` objects — `visibility='driver_visible'` notes only, `operations_only` notes never appear under any condition (ZD-098). `assistance_notes`/`instructions` come from the Trip's own immutable snapshot fields, not the Passenger's general profile (ZD-097). Reassignment revokes access on the very next call — no JWT refresh required (verified over real HTTP, `driver_read_probe.js` READ-5/5B).

## D. `driver_list_trip_history(p_organization_id uuid, p_from timestamptz default null, p_to timestamptz default null) returns setof driver_trip_history_entry`

Limited, materially-redacted history of the caller's own **ended** assignments (`ended_at IS NOT NULL`) in the given organization.

```
{ trip_id, scheduled_pickup_at, assignment_started_at, assignment_ended_at,
  end_reason, trip_outcome }
```

`trip_outcome` is populated only when the Trip reached a terminal state (`completed`/`cancelled`/`no_show`) — `null` otherwise, so a past assignment never reveals what a *different*, later Driver did on the same Trip after this one's assignment ended. No passenger identity, phone, notes, pickup/destination text, or requester data ever appears here (ZD-099).

**Range:** defaults to the trailing 90 days if `p_from`/`p_to` are omitted; hard-capped at 180 days per call, and rejects an inverted range (`p_from > p_to`) — both `ZW006`. This is a query-cost/privacy safeguard, not a business retention rule (ZD-099) — it does not delete or expire any underlying data.

---

## Return contract

All 4 functions return an explicit composite type — never a canonical table rowtype (`RETURNS trips`/`RETURNS passengers` etc. is never used anywhere in this layer). PostgREST serializes each to a plain JSON object (or array, for the two `setof` functions). Every field is named explicitly; no function uses `passenger.*`/`to_jsonb`/`row_to_json`/whole-row serialization anywhere (verified structurally — see [driver-data-minimization.md](../security/driver-data-minimization.md)).

## Testing

| Suite | Assertions | Covers |
|---|---|---|
| `supabase/tests/driver_read_privilege_tests.sql` | 8 | Static ACL/ownership/search_path/volatility audit; retired-vs-retained policy inventory; Ops access untouched |
| `supabase/tests/driver_read_authorization_tests.sql` | 17 | Full Trip-detail denial matrix, reassignment revocation, inactive Membership/Driver, multi-org scoping, active-list scoping, org-context validation |
| `supabase/tests/driver_read_minimization_tests.sql` | 13 | Exact return-type column sets (future-column leak protection), note visibility, phone visibility, direct-Passenger-SELECT regression paired with controlled-path success |
| `supabase/tests/driver_read_history_tests.sql` | 8 | History visibility matrix, redaction, range validation, history-visibility-≠-current-authority |
| Real HTTP (`driver_read_probe.js` pattern) | 15 | PostgREST/GoTrue cross-validation of every function, including the exact JSON key-set match and reassignment revocation over real HTTP |

All run against `supabase db reset` fresh-seeded data; see each file's header for exact run instructions.

---

## Nemryn Plus public inquiry reads (NP-P2-S7-A)

Contract details: [NP-P2-S7-public-inquiry-intake-design.md](../product/NP-P2-S7-public-inquiry-intake-design.md) §5.

| Function | Caller | Returns |
|---|---|---|
| `get_public_plus_inquiry_form(key)` | **service_role only** (S7-B route) | zero rows unless available (allowlisted + published + active org + Plus write); else org name, headline, intro, still-offered services, `config_version`, `consent_text_version`. No ids |
| `plus_get_inquiry_form(org)` | Plus read | one row: the form (NULLs if none), `public_access_enabled`, `service_options` |
| `plus_list_inquiries(org, status, search, limit, offset)` | Plus read | a bounded page (1–100), newest first, LIKE-escaped search over name / email / phone digits; no question, consent ticks or key; `total_count` |
| `plus_get_inquiry(org, id)` | Plus read | full detail incl. question, consent ticks (not consent on record), acquisition, triage, converted contact / opportunity, `version`; ZW002 for unknown / foreign |
| `plus_list_inquiry_duplicate_hints(org, id)` | Plus read | ≤ 5 contacts + ≤ 5 other new inquiries; hints only |
| `plus_count_new_inquiries(org)` | Plus read | integer |
| `platform_get_plus_inquiry_public_access(org)` | Platform Admin | enabled, since, by whom, reason |

Tests: `supabase/tests/plus_inquiries_tests.sql`.
