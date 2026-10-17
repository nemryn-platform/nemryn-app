# Zenward Platform — Controlled Mutation API

**Work item:** P1-E2-S2 — Controlled Mutation & Transaction Boundary, amended by P1-E3-S0A — Controlled Internal Trip Creation Boundary (`create_trip`, ZD-101/ZD-102)
**Status:** Implemented and verified against a running local Supabase/Postgres instance. Not a syntax-only claim — 204 SQL test assertions, a genuine two-process concurrency test, and 18 real PostgREST/GoTrue HTTP checks all pass.
**Last updated:** 2026-08-31

This document is the contract for every mutation RPC added in P1-E2-S2. It complements [mutation-authorization.md](../security/mutation-authorization.md) (the authorization architecture and reasoning) and [rls-model.md](../security/rls-model.md) (the underlying table/column privilege posture, unchanged except where noted below).

## How to call these

Every function below is a normal Supabase/PostgREST RPC: `POST /rest/v1/rpc/<function_name>` with a JSON body of named parameters, `Authorization: Bearer <user access token>`, and the project `apikey`. None of them accept or require a service-role key — they run under the caller's own authenticated session, elevating internally via `SECURITY DEFINER` only for the specific writes each one is documented to make.

## Error contract (ZD-085)

Every rejection is a Postgres exception with a custom SQLSTATE, surfaced by PostgREST as `body.code` in the JSON error response (confirmed by direct HTTP test — see `docs/reports/P1-E2-S2-completion-report.txt`). **Branch on `code`, never on the message text.**

| Code | Meaning | Typical HTTP status via PostgREST |
|---|---|---|
| `ZW001` | `unauthorized` — caller has a real, visible relationship to the resource but lacks the specific permission for this action | 400 (PostgREST does not remap custom codes to a specific 4xx by default; the code field is authoritative) |
| `ZW002` | `not_found` — resource does not exist, OR the caller has no legitimate visibility into it under RLS. Cross-tenant and nonexistent are deliberately indistinguishable (no existence oracle) | 400 |
| `ZW003` | `stale_state` — the Trip's actual current state does not match what this call requires (either the caller's `expected_current_state` or the function's own fixed from-state) | 400 |
| `ZW004` | `illegal_transition` — the requested change is not a legal edge from the Trip's current state, independent of any `expected_current_state` mismatch (e.g. cancelling an already-`completed` Trip, or (re)assigning past `arrived_at_pickup`) | 400 |
| `ZW005` | `assignment_conflict` — a `trip_assignments` precondition failed: an active assignment already exists with a different driver/vehicle when calling `assign_trip`; no active assignment exists when calling `reassign_trip`; OR (P1-E3-S5A) `reassign_trip`'s `p_expected_assignment_id` no longer matches the currently-active assignment — the Dispatcher's decision is based on a since-superseded assignment | 400 |
| `ZW006` | `invalid_input` — malformed or missing parameter (blank/oversized reason, unknown or inactive driver/vehicle, null required id) | 400 |

Every anon (unauthenticated) call is rejected before any of this logic runs — no function below grants `EXECUTE` to `anon` or `PUBLIC`, so an anonymous call fails at the privilege layer with a standard Postgres `insufficient_privilege` (42501), not one of the six codes above.

## Idempotency (ZD-090, amended by ZD-093)

Every lifecycle mutation RPC returns a `changed: boolean` field. `changed: false` means the call was a safe no-op — the requested end state already held, nothing was written, and no duplicate `trip_events`/`audit_events` row was created. Callers should treat a `changed: false` response as success, not as an error to retry differently. See ZD-090 for the exact precedence rule between the idempotent-no-op check and the active-assignment check.

**For the 6 Driver transition RPCs specifically (ZD-093):** the target-state-already-holds no-op is granted only to the Driver who can be verified, via the trusted `trip_events.actor_user_id` history, to have actually performed that exact transition — never merely because the caller has *some* historical relationship to the Trip. A formerly-assigned Driver retrying an action a *different* Driver performed after a reassignment is denied (`ZW001`), not handed a false success. See [mutation-authorization.md](../security/mutation-authorization.md) "Idempotent no-op is actor-scoped, not relationship-scoped" and `docs/reports/P1-E2-S2A-idempotent-authorization-audit.txt`.

## Return types

Two composite types (`supabase/migrations/20260831100100_mutation_result_types.sql`), serialized by PostgREST as plain JSON objects:

```
trip_transition_result: { trip_id, previous_state, current_state, changed }
trip_assignment_result: { trip_id, assignment_id, driver_id, vehicle_id, changed }
trip_creation_result:   { trip_id, organization_id, state, created }
```

---

## Trip creation

### `create_trip(p_organization_id uuid, p_passenger_id uuid, p_pickup_description text, p_destination_description text, p_scheduled_pickup_at timestamptz default null, p_appointment_at timestamptz default null, p_pickup_facility_id uuid default null, p_destination_facility_id uuid default null, p_assistance_notes text default null, p_instructions text default null, p_request_id uuid default null) returns trip_creation_result`

Organization Admin / Dispatcher only (`has_org_role`, same `ZW002` convention as every other ops function — a Driver, an inactive Membership, and a foreign organization all produce the identical error). The sole controlled path to create a Trip — **`state` is never a parameter**, hard-coded `'scheduled'` internally, so a caller has no mechanism to request any other initial state (ZD-102).

**Validates, all `ZW006 invalid_input` on failure (no existence oracle — nonexistent and foreign-tenant are indistinguishable):**
- `pickup_description`/`destination_description`: required, non-blank, ≤2000 chars each
- if both timestamps are given, `appointment_at >= scheduled_pickup_at`
- `passenger_id`: required; must exist, same organization, `status='active'`
- `pickup_facility_id`/`destination_facility_id` (optional): if given, must exist, same organization, `status='active'`
- `request_id` (optional): if given, must exist, same organization, and be `state` `accepted` (P1-OPS-R1; `pending`/`declined`/`cancelled` → ZW006), and its linked `passenger_id` must equal `p_passenger_id`

**Request lifecycle side effect:** none (P1-OPS-R1). Acceptance is exclusively `accept_transportation_request`; an accepted request may produce any number of Trips — Request→Trip is never assumed 1:1.

**Does not assign a Driver/Vehicle.** Trip creation and assignment remain separate commands by design (ZD-102) — call `assign_trip` afterward.

**Writes:** `trips` INSERT (`state='scheduled'`, all terminal timestamps `NULL`); the conditional `transportation_requests` UPDATE above; one `trip_events` row (`request_converted_to_trip` if `request_id` was supplied, `trip_scheduled` otherwise — both already-existing values in the event-type vocabulary, no schema change needed); one `audit_events` row (`trip_created`, minimal metadata — `state`/`passenger_id`/`request_id` only, no Passenger PII, no free-text address).

**Idempotency:** none. `create_trip` is deliberately non-idempotent (ZD-102) — two legitimate Trips can share the same passenger/time/address, so no duplicate-detection heuristic is attempted. `created` in the response is always `true`; application code is responsible for preventing accidental double-submission (e.g. disabling the submit button while the request is in flight).

**Example:**
```
POST /rest/v1/rpc/create_trip
{ "p_organization_id": "...", "p_passenger_id": "...", "p_pickup_description": "...", "p_destination_description": "..." }
→ 200 { "trip_id": "...", "organization_id": "...", "state": "scheduled", "created": true }
```

### Direct table access is retired (ZD-101)

As of this phase, `authenticated` has **no** direct INSERT grant on `trips` at all — `create_trip` is the only creation path.

**P1-PILOT-R2B:** the P1-E2-S1 planning-column UPDATE grant (8 columns) and the `trips_update_org_operations` policy are revoked / dropped. `authenticated` now has **no** direct UPDATE on `trips` of any kind (SELECT unchanged); a Trip's own planning details are corrected only through `update_trip_details` below. In the same migration the unused descriptive-column UPDATE grant on `transportation_requests` (12 columns) and `transportation_requests_update_org_operations` were removed (SEC-HYGIENE-2) — every Request mutation is an RPC (log / accept / decline / cancel / link Passenger / create_trip).

### `update_trip_details(p_trip_id uuid, p_expected_updated_at timestamptz, p_scheduled_pickup_at timestamptz, p_appointment_at timestamptz, p_pickup_description text, p_pickup_facility_id uuid, p_destination_description text, p_destination_facility_id uuid, p_instructions text, p_assistance_notes text) returns trip_details_update_result`

P1-PILOT-R2B (PR-01). Organization Admin / Dispatcher of the Trip's organization (else ZW002, no oracle). Full replacement of the 8 owned fields; never touches passenger, request / recurring links, state, duration, wheelchair requirement, lifecycle timestamps or assignments.

- **Concurrency:** `p_expected_updated_at` must equal `trips.updated_at` (ZW003 otherwise — another edit, a driver lifecycle step or a duration / wheelchair change bumps it).
- **Validation (create_trip's rules, ZW006):** descriptions trimmed, required, ≤ 2000; optional text trimmed, blank → NULL; appointment ≥ pickup (when either timing field changes); facilities same organization + active when CHANGED (an unchanged, later-inactive facility is tolerated); a set pickup can not be cleared; a recurring occurrence keeps its arrangement-local service date.
- **Lifecycle matrix (ZW004):** `scheduled` all fields; `en_route_to_pickup` all fields but the pickup keeps its organization-local date; `arrived_at_pickup` appointment / destination / instructions / assistance; `passenger_onboard` + `en_route_to_destination` appointment / destination / instructions; `arrived_at_destination` and terminal states nothing.
- **Writes (effective change only):** the changed columns; one `trip_events` row `trip_details_updated` (metadata: changed field NAMES + trip_state, never values); one `audit_events` row `trip_details_updated` (before / after of the changed fields only + trip_state; Admin-readable). A no-op returns `changed=false` and writes nothing (no updated_at bump).

---

## Driver lifecycle transitions

Six narrow functions, one per legal edge (lifecycle-model.md §C). Each takes `(p_trip_id uuid, p_expected_current_state text)` — never a target-state parameter; the edge is fixed by which function is called. Driver-only: requires the caller to resolve (via `current_driver_id`) to a Driver row holding a **currently active** `trip_assignments` row on this specific Trip (stricter than `is_driver_assigned_to_trip`'s read-scope "ever assigned" check).

| Function | Legal from → to | Notes |
|---|---|---|
| `driver_start_to_pickup` | `scheduled` → `en_route_to_pickup` | |
| `driver_arrive_at_pickup` | `en_route_to_pickup` → `arrived_at_pickup` | |
| `driver_mark_passenger_onboard` | `arrived_at_pickup` → `passenger_onboard` | |
| `driver_start_to_destination` | `passenger_onboard` → `en_route_to_destination` | |
| `driver_arrive_at_destination` | `en_route_to_destination` → `arrived_at_destination` | |
| `driver_complete_trip` | `arrived_at_destination` → `completed` | Also closes the active `trip_assignments` row (`ended_at`, `end_reason='trip_completed'`) in the same transaction — a Driver is never left "actively assigned" to a completed Trip. Sets `trips.completed_at`. |

**Authorization chain:** `auth.uid()` not null → Trip exists (`ZW002` if not) → caller has *ever* had an assignment on this Trip (`is_driver_assigned_to_trip`, `ZW002` if not — mirrors their RLS read visibility) → Trip already at this function's target state? → return idempotent no-op → caller has a *currently active* assignment on this Trip (`ZW001` if not — they can see it, they just can't act on it, e.g. it was reassigned away or already completed) → Trip's actual state matches this function's required from-state, and matches `expected_current_state` if supplied (`ZW003` if not) → mutate.

**Writes:** `trips.state` (+ `completed_at` for the terminal one); one `trip_events` row (`event_type` = the target state name, or `trip_completed`). No `audit_events` row (ZD-087 — routine progress, not a responsibility/terminal-disposition change, except completion which *is* covered by the assignment-closure logic but still intentionally gets no separate AuditEvent — see ZD-087's rationale).

**Example:**
```
POST /rest/v1/rpc/driver_arrive_at_pickup
{ "p_trip_id": "...", "p_expected_current_state": "en_route_to_pickup" }
→ 200 { "trip_id": "...", "previous_state": "en_route_to_pickup", "current_state": "arrived_at_pickup", "changed": true }
```

---

## Operations lifecycle actions

Organization Admin / Dispatcher only (`has_org_role(organization_id, ['organization_admin','dispatcher'])`; failure of this check is uniformly `ZW002 not_found` — see [mutation-authorization.md](../security/mutation-authorization.md) for why).

### `cancel_trip(p_trip_id uuid, p_reason text)`

Legal from any non-terminal state → `cancelled`. `p_reason` required, 1–500 characters after trimming (`ZW006` if blank/oversized). Idempotent no-op if already `cancelled`. `ZW004` if the Trip already reached a *different* terminal state (`completed`/`no_show` cannot be cancelled). Closes any active `trip_assignments` row as part of the same transaction. Sets `trips.cancelled_at`, `trips.cancellation_reason`.

**Writes:** `trips.state`/`cancelled_at`/`cancellation_reason`; one `trip_events` row (`trip_cancelled`, `metadata.reason`); one `audit_events` row (`trip_cancelled`, `reason`, before/after state).

### `record_no_show(p_trip_id uuid, p_reason text)`

Legal only from `en_route_to_pickup` or `arrived_at_pickup` → `no_show` (lifecycle-model.md §J). `p_reason` required, same validation as `cancel_trip`. Idempotent no-op if already `no_show`. `ZW004` from any other state. Closes any active `trip_assignments` row. Sets `trips.no_show_at`. **`trips` has no `no_show_reason` column** — the reason lives in `trip_events.metadata` and `audit_events.reason` only; no schema field was added speculatively for this.

**Writes:** `trips.state`/`no_show_at`; one `trip_events` row (`no_show_recorded`, `metadata.reason`); one `audit_events` row (`no_show_recorded`, `reason`, before/after state).

### `record_trip_completion_by_operations(p_trip_id uuid, p_expected_current_state text, p_completed_at timestamptz, p_note text) returns trip_transition_result`

**P1-PILOT-R2C (PR-02).** The exceptional recovery when the Driver cannot complete a Trip in Nemryn after pickup (phone died, app unavailable) and Operations has confirmed completion by another channel. Not a generic state setter, never impersonates the Driver, never writes a Driver lifecycle event.

- **Authorization:** Organization Admin / Dispatcher of the Trip's organization; everyone else (the assigned Driver included, foreign tenant, inactive membership, suspended organization, Platform Admin without membership, nonexistent Trip) is the identical `ZW002`. No auth → `ZW001`.
- **Checks (row-locked):** `state = p_expected_current_state` (`ZW003`); state ∈ `passenger_onboard` / `en_route_to_destination` / `arrived_at_destination` (`ZW004` otherwise, terminal included — no idempotent no-op); an active assignment must exist (`ZW006` — an integrity problem, never reconstructed); `p_note` trimmed 10–500 characters (`ZW006`); `p_completed_at` required (never inferred), ≤ now + 5 minutes and ≥ the latest existing lifecycle event (`ZW006`).
- **Writes (one transaction):** `trips.state = 'completed'`, `completed_at = p_completed_at`; the active `trip_assignments` row `ended_at = now()`, `end_reason = 'trip_completed'` (closed, never deleted); ONE `trip_events` row `completion_recorded_by_operations` (actor = the operator, `occurred_at = now()`, `metadata = { previous_state, recorded_completed_at, note_present: true }` — never the note); ONE `audit_events` row `trip_completion_recorded_by_operations` (before `{state}`, after `{state, completed_at}`, `reason` = the note, Organization Admin readable only).
- **Never written:** `trip_completed`, or any skipped `en_route_to_destination` / `arrived_at_destination`. Proof of Service evaluates such a Trip with the recovery chain rule and always shows it as NEEDS_REVIEW (`COMPLETION_RECORDED_BY_OPERATIONS`).
- **Races:** the Driver completes first → this call is `ZW003` (old expected state) / `ZW004`. Operations completes first → the Driver's pending tap is rejected with `ZW001` (its active assignment was closed — the Driver path checks the active assignment before the state, exactly as after an Operations cancel); nothing is written twice.

---

## Assignment

Organization Admin / Dispatcher only. Both require the Trip to be in an assignment-eligible state: `scheduled`, `en_route_to_pickup`, or `arrived_at_pickup` (`ZW004` otherwise — ZD-088). Driver/vehicle must belong to the *same* `organization_id` and have `status='active'` (`ZW006` otherwise — this is an application-level check; the composite FK on `trip_assignments` is the schema-level backstop for the organization match, already covered by RLS tests W/X).

### `assign_trip(p_trip_id uuid, p_driver_id uuid, p_vehicle_id uuid default null)`

Requires **no existing active** `trip_assignments` row on the Trip.
- No existing row → validates driver/vehicle → creates the row.
- An existing row with the **same** driver+vehicle → idempotent no-op (`changed: false`), no write.
- An existing row with a **different** driver or vehicle → `ZW005 assignment_conflict` — use `reassign_trip` instead. `assign_trip` never silently overwrites.

**Writes (on real creation):** `trip_assignments` INSERT; one `trip_events` row (`driver_assigned`, `metadata.driver_id`/`vehicle_id`); one `audit_events` row (`driver_assigned`).

### `reassign_trip(p_trip_id uuid, p_driver_id uuid, p_vehicle_id uuid default null, p_reason text default null, p_expected_assignment_id uuid default null)`

Requires an **existing active** `trip_assignments` row (`ZW005` if none — use `assign_trip` instead). As of **P1-E3-S5B**, the check order is:
1. **`p_expected_assignment_id` must equal the active assignment's own `id`** (checked FIRST, under the same row lock) → `ZW005 assignment_conflict` on ANY mismatch — including a `null`/omitted value (no way to skip this by omitting the parameter), and including the case where the requested driver/vehicle happen to already equal the CURRENT assignment's own driver/vehicle. A stale expected assignment is always rejected; it is never silently treated as a no-op just because the request happens to coincide with reality.
2. Only once `p_expected_assignment_id` is confirmed current: requested driver+vehicle exactly match the (now-confirmed-current) active assignment → idempotent no-op (`changed: false`), no write.
3. Otherwise (a real change, with a confirmed-current expected id) → validates the new driver/vehicle → closes the old row (`ended_at`, `end_reason` = `p_reason` or `'reassigned'`) → inserts a new active row. Never edits `driver_id`/`vehicle_id` in place on the existing row (ZD-051 — reassignment is always close-and-insert).

`p_reason` is optional context, not a precondition — a reassignment with no reason given is legal (unlike `cancel_trip`/`record_no_show`, where a reason is required).

**`p_expected_assignment_id` (optimistic-concurrency precondition, P1-E3-S5A/ZD-145, ordering corrected P1-E3-S5B/ZD-146):** added after P1-E3-S5's own live-application testing showed a real, if transactionally-safe, gap: without it, a Dispatcher whose form was based on a since-superseded assignment could silently overwrite a different Dispatcher's newer decision. The caller (the Dispatch UI) always supplies the `trip_assignments.id` it loaded — never shown to the Dispatcher, purely a hidden precondition value.

P1-E3-S5A's original implementation checked the idempotent driver/vehicle match BEFORE `p_expected_assignment_id` — this let a stale expected id slip through as a silent success whenever the request happened to already match the CURRENT (not the caller's expected) assignment. P1-E3-S5B corrected the order: `p_expected_assignment_id` is now the FIRST thing checked once an active assignment is confirmed to exist, before anything else, including the idempotent-match check. **This means a genuine caller-side retry (e.g. a dropped HTTP response) that still carries the pre-call expected id will now also be rejected as `assignment_conflict`, even though it is the caller's own prior change** — a deliberate, explicit product decision (P1-E3-S5B): staleness is staleness, regardless of who caused the current state or why the caller's own expectation is out of date. This is intentionally narrower than the general `p_expected_current_state` retry-safety guarantee the `driver_*` transition RPCs provide (ZD-093, a different mechanism checking Trip *state*, not an assignment *id* — unaffected by this change). In practice the Dispatch UI always re-fetches a fresh expected id on every dialog open, so this narrower guarantee has little real-world cost for this specific application.

**Writes (on real reassignment):** `trip_assignments` UPDATE (close old) + INSERT (new); one `trip_events` row (`driver_reassigned`, `metadata` with previous and new driver/vehicle); one `audit_events` row (`driver_reassigned`, `reason`, before/after assignment).

### Direct table access is retired (ZD-092)

As of this phase, `authenticated` has **no** direct INSERT/UPDATE grant on `trip_assignments` at all — `assign_trip`/`reassign_trip` are the only mutation path. SELECT (both existing policies) is unchanged.

---

## Driver location (P1-E3-S7A)

### `driver_record_location(p_trip_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision default null) returns driver_location_result`

Driver-only. The sole controlled path to record a location update — no direct INSERT grant exists on `driver_location_updates` at all (matches `trip_events`' own zero-grant precedent). Authorization chain, mirroring `_driver_execute_trip_transition`'s established pattern:

1. `auth.uid()` non-null → else `ZW001`.
2. Trip exists → else `ZW002`.
3. `is_driver_assigned_to_trip()` (ever assigned, read-scope) → else `ZW002` (no existence oracle — foreign-org and nonexistent are indistinguishable).
4. `_lock_driver_active_assignment()` — a CURRENTLY active assignment for this Driver on this Trip → else `ZW001` (covers reassignment revocation — a former Driver's next call fails here, same-session).
5. `trips.state` is one of the 5 eligible tracking-window states (`en_route_to_pickup` through `arrived_at_destination`) → else `ZW004` (covers both pre-dispatch `scheduled` and every terminal state).
6. Coordinates valid (`latitude` [-90,90], `longitude` [-180,180], `accuracy_meters >= 0` if given) → else `ZW006`.

`recorded_at` is always the server's own `now()` — no client-supplied timestamp parameter exists. Every write also carries `assignment_id`, tying the row to the exact assignment in force at write time (never merely "this driver, this trip") — see [driver-location-architecture.md](../product/driver-location-architecture.md) for the full rationale, including why `current_driver_id()`'s own existing inactive-Membership/inactive-Driver correction (ZD-100) is inherited here with zero new code.

**Writes:** one `driver_location_updates` INSERT. No `trip_events`/`audit_events` row — a routine, high-frequency operational signal, not a lifecycle transition or an administrative action (distinct from every other mutation family in this document).

### Operations read path

Not an RPC — Operations reads `driver_location_updates` directly via a plain RLS SELECT policy (`driver_location_updates_select_org_operations`, `has_org_role(organization_id, ['organization_admin', 'dispatcher'])`), the same convention every other Operations-read table already uses. See [live-dispatch-location-data-map.md](../product/live-dispatch-location-data-map.md).

---

## Trip exceptions (P1-E3-S8)

Both functions returns `trip_exception_result` (shared, mirrors `driver_location_result`'s own precedent of one shape for a related pair).

### `report_trip_exception(p_trip_id uuid, p_exception_type text default null, p_description text default null)`

Callable by Organization Admin/Dispatcher (any Trip in their org) OR the Trip's own **currently**-assigned Driver. **As of P1-E3-S8A**, the Driver check is `_lock_driver_active_assignment` (the same WRITE-scope, active-assignment-only primitive `driver_record_location` uses) — tightened from the original `is_driver_assigned_to_trip` READ-scope "ever assigned" check, which would have let a reassigned-away or post-terminal Driver keep reporting. A Driver who is reassigned away, or whose Trip reaches a terminal state, is denied immediately in the same session — no separate terminal-state branch is needed, since every terminal transition (`driver_complete_trip`/`cancel_trip`/`record_no_show`) already closes the active assignment in the same transaction (see `mutation-authorization.md`'s own S8A section for the full reasoning, including why a separate check would either be dead code or an existence-oracle leak). Always forces `created_by = auth.uid()` and `status = 'open'`. `p_description`, if given, must be non-blank and ≤2000 chars (`ZW006` otherwise) — otherwise both parameters are genuinely optional, matching the column's own real nullability.

**Writes:** one `trip_exceptions` INSERT; one `trip_events` row (`exception_flagged`, `metadata.exception_id`). No `audit_events` row (does not materially change Trip responsibility or reach a terminal disposition — same test ZD-087 already established, matching `trip_notes`' identical precedent).

### `resolve_trip_exception(p_exception_id uuid, p_resolution_note text default null)`

Organization Admin/Dispatcher only — Driver never resolves (matches the schema's own original comment: "only Dispatcher/Organization Admin resolve — Driver never during MVP"). `ZW002` if the exception doesn't exist or the caller has no org role over it (no existence oracle). **Idempotent no-op** if already resolved: returns `changed: false` and the REAL, already-persisted resolution (whoever resolved it first) — a stale/duplicate resolve attempt's own `p_resolution_note` is never applied, deliberately different from `reassign_trip`'s fail-closed staleness contract (P1-E3-S5B) — see that function's own comment for the reasoning (two resolutions of the same exception never disagree about the operationally relevant fact, unlike a reassignment's driver/vehicle choice). Never deletes the row — full history preserved.

**Writes (on a real resolve only):** `trip_exceptions.status`/`resolved_by`/`resolved_at`/`resolution_note` UPDATE; one `trip_events` row (`exception_resolved`). No `audit_events` row (same reasoning as above). No write of any kind on the idempotent no-op path.

### Direct table access — retired (P1-E3-S8A)

`report_trip_exception`/`resolve_trip_exception` are now the ONLY way any normal actor writes `trip_exceptions`. The three pre-existing direct RLS INSERT/UPDATE policies (`trip_exceptions_insert_operations`, `trip_exceptions_insert_assigned_driver`, `trip_exceptions_update_operations`) are dropped, and `INSERT`/`UPDATE` are revoked from `authenticated` on the table entirely (`supabase/migrations/20260902160000_exception_mutation_boundary_hardening.sql`) — the same treatment `trips` (ZD-101) and `trip_assignments` (ZD-092) already received once their own controlled RPCs existed. DELETE was never granted to any client role. Proven directly, not merely argued: `supabase/tests/exception_mutation_boundary_tests.sql` covers direct INSERT/UPDATE/DELETE denial, forged `created_by`, forged pre-resolved `status`, reopening a resolved row, and historical-field rewriting, for both Operations and Driver actors, same-org and foreign-org. SELECT is completely unaffected — both read policies remain exactly as they were.

---

## Locking, atomicity, and concurrency

- **Lock order (ZD-086):** every function locks `trips` first, then the active `trip_assignments` row if relevant — never the reverse. This is what makes concurrent calls deadlock-free by construction.
- **Atomicity:** every function is a single PL/pgSQL function with no internal exception handler around its own writes — an error anywhere inside it (including one forced by an external trigger, as proven in `mutation_atomicity_tests.sql`) rolls back every write that function made, with nothing partial ever persisted.
- **Concurrency:** `mutation_concurrency_test.sh` proves (by wall-clock timing across two real OS processes, not by inspecting final state alone) that a second `assign_trip` call genuinely blocks on the first's row lock and, once unblocked, correctly detects the now-existing assignment rather than racing past it into a double-booking. The partial unique index `trip_assignments_one_active_per_trip` remains the schema-level backstop underneath this (already covered by RLS test Y).

## Testing

| Suite | Assertions | Covers |
|---|---|---|
| `supabase/tests/mutation_privilege_tests.sql` | 7 | Static ACL/ownership/search_path audit of all 13 new functions |
| `supabase/tests/mutation_lifecycle_tests.sql` | 23 | Full Driver progression walk, idempotency, stale-state, illegal jumps, terminal-reopening denial, cancel/no-show, not_found-vs-unauthorized |
| `supabase/tests/mutation_assignment_tests.sql` | 16 | assign_trip/reassign_trip positive+negative, eligible states, conflict boundary, driver/vehicle validation, anon denial, direct-table regression |
| `supabase/tests/mutation_authorization_tests.sql` | 4 | Platform Admin non-bypass, inactive membership, multi-org role scoping |
| `supabase/tests/mutation_atomicity_tests.sql` | 2 | Forced-failure rollback |
| `supabase/tests/mutation_idempotent_authorization_tests.sql` | 6 | Actor-verified idempotency edge cases (P1-E2-S2A) |
| `supabase/tests/create_trip_tests.sql` | 20 | Full role/membership matrix, cross-tenant Passenger/Facility/Request denial, Request lifecycle transition, initial-state impossibility, direct-INSERT regression |
| `supabase/tests/create_trip_privilege_tests.sql` | 5 | Static ACL/ownership/search_path audit; direct-INSERT-revoked; SELECT/UPDATE untouched |
| `supabase/tests/create_trip_atomicity_tests.sql` | 2 | Forced-failure rollback (Trip + TripEvent + AuditEvent + conditional Request update) |
| `supabase/tests/mutation_concurrency_test.sh` | 1 | Genuine two-process concurrency (timing-based proof) |
| `supabase/tests/driver_location_tests.sql` | 20 | `driver_record_location` full authorization chain (eligible write, wrong Driver, foreign-org, inactive Membership/Driver, reassignment revocation, terminal-state revocation, pre-dispatch `scheduled` denial, coordinate/accuracy validation, anon denial), movement (second update → new authoritative latest), Operations own-org/foreign-org SELECT, Driver zero-read confirmation |
| `supabase/tests/trip_exception_tests.sql` | 16 | `report_trip_exception`/`resolve_trip_exception`: Operations + Driver report, anon denial, foreign-org denial, never-assigned-Driver denial, invalid-input validation, inactive-Membership denial, Driver-cannot-resolve denial, real resolve, idempotent stale-resolution no-op (with resolution-note preservation proof), nonexistent-id denial, foreign-org resolve denial, forced-failure atomicity (trip_events trigger, proves the earlier trip_exceptions INSERT rolls back too) |
| `supabase/tests/exception_mutation_boundary_tests.sql` | 20 | P1-E3-S8A: direct INSERT/UPDATE/DELETE bypass denial (Operations + Driver + foreign-org), forged `created_by`, forged pre-resolved `status`, reopen-a-resolved-row denial (+ DB confirmation), historical-field-rewrite denial (+ DB confirmation), reassignment revocation (former Driver denied same-session, new Driver allowed), terminal revocation (via the real Driver lifecycle RPC walk, not a direct state edit), live role-revocation (dispatcher→driver mid-session resolve denial) |
| Real HTTP (`rpc_probe.js`/`create_trip_probe.js` pattern, see completion reports) | 18 | PostgREST/GoTrue cross-validation of one representative RPC per family, plus create_trip's full authorization matrix |

All run against `supabase db reset` fresh-seeded data; see each file's header for exact run instructions.


## Request decision RPCs (P1-OPS-R1)

All: Organization Admin / Dispatcher of an active organization (`has_org_role`); ZW001 unauthenticated, ZW002 Driver / inactive / suspended / foreign / Platform Admin without Membership / not found, ZW004 illegal transition, ZW006 invalid input. Request row locked `FOR UPDATE` before any state check; returns `request_transition_result` with `changed` (idempotent no-op when the target state already holds).

| RPC | Transition | Reason | Writes |
|---|---|---|---|
| `accept_transportation_request(org, request)` | `pending → accepted` | — | `request_accepted` RequestEvent + AuditEvent |
| `decline_transportation_request(org, request, reason_code, reason_note?)` | `pending → declined` | required: `outside_service_area`, `no_availability`, `unsupported_transportation_need`, `requested_time_unavailable`, `duplicate_request`, `other` (note required) | `request_declined` RequestEvent (`reason_code`, `reason_note`) + AuditEvent (code only) |
| `cancel_transportation_request(org, request, reason_code, reason_note?)` | `accepted → cancelled`, only while no Trip exists | required: `requester_cancelled`, `no_availability`, `unable_to_reach_requester`, `duplicate_request`, `other` (note required) | `request_cancelled` RequestEvent + AuditEvent (code only) |
| `link_request_passenger(org, request, passenger)` | none (state unchanged) | — | legal while `pending` or `accepted` and no Trip exists |

None of them creates a Passenger, Trip, or assignment, touches provenance (`intake_integration_id`, `source`, requester snapshot, acquisition), or sends an external notification.

**Release shape (P1-OPS-R1R):** shipped as EXPAND (`20260924090000_request_decision_workflow_expand`) → deploy app → CONTRACT (`20260924091000_request_decision_workflow_contract`). Between the two, the pre-R1 `decline_transportation_request(uuid, uuid, text)` / `cancel_transportation_request(uuid, uuid)` overloads and `create_trip`'s implicit pending → accepted still exist for the previously deployed app, and the new `decline_transportation_request(uuid, uuid, text, text)` has no default for `p_reason_note` (callers pass it; `''` = none). CONTRACT removes the bridge, makes `create_trip` accepted-only, adds `p_reason_note default null`, and requires a reason code on every new decline/cancel event. The privilege contract lists the legacy overloads as TRANSITIONAL; check 29 fails until CONTRACT is applied.

## Request → Recurring Care (P1-PILOT-R3, PR-04)

### `create_recurring_arrangement(..., p_requires_wheelchair_access boolean default null, p_request_id uuid default null)`

The existing Organization Admin / Dispatcher RPC gained ONE trailing optional argument (9 → 10 args; the 9-arg version was dropped, so exactly one overload exists and every existing named / positional caller still resolves). `p_request_id = NULL` is the unchanged behaviour.

- **With `p_request_id`:** the Request must be in the same (already authorized) organization, `state = 'accepted'`, with its linked Passenger equal to `p_passenger_id` (which must be active). Any failure is the identical `ZW006` (no existence oracle — a foreign Request reads exactly like a missing one). The Request is read `FOR SHARE` and never modified: its `state` stays `accepted`.
- **Writes:** `recurring_arrangements.request_id` (composite FK `(request_id, organization_id)` → `transportation_requests`, NO ACTION, **not unique** — one Request may produce several arrangements, e.g. a separate return schedule). The existing `recurring_arrangement_created` audit gains `after_data.request_id` only when supplied; no requester data.
- **Never:** set / change `request_id` after creation (edit / pause / resume / end / wheelchair setter update named columns only); copy it onto occurrence Trips (they keep `recurring_arrangement_id` only).
- **Fulfilment (application):** a Request is fulfilled by a non-cancelled Trip OR by ANY linked arrangement — active, paused or ended (owner decision D-R3-1). The Overview stranded count and `?state=accepted&needs=trip` use the same RLS-scoped PostgREST anti-join (`active_trips` + `linked_arrangements`).
- **After conversion (pre-release hardening):** `link_request_passenger` and `cancel_transportation_request` also return `ZW004` once ANY recurring arrangement (active, paused or ended) references the Request — the same code as their existing linked-Trip guard. Nothing cascades to the arrangement; the Request stays accepted.

## Nemryn Plus entitlement RPCs (NP-P1-S1)

Migration `20261013100000_plus_entitlement_foundation.sql`; table `organization_modules` (class A). None of these functions reads or writes `organizations.status` (beyond an existence check and row lock) or any Core table, and no Core function calls them.

### `plus_access_state(p_organization_id uuid) → plus_access_state_result (state, trial_ends_at)`
- **Who:** authenticated.
- **Returns:** the caller's effective Nemryn Plus state.
  - For an Organization Admin of that active organization (`has_org_role(org, ['organization_admin'])`): `write`, `read_only` or `locked`. `trial_ends_at` is set only while a trial runs (`write`).
  - For everyone else (Dispatcher, Driver, inactive member, suspended organization, foreign tenant, Platform Admin without membership): `none`. It never raises (no oracle).
- **Effective state rules:**

  | Stored entitlement | Effective state |
  |---|---|
  | running trial, or `active` without an end / before `access_ends_at` | `write` |
  | `disabled` + `no_access` | `locked` |
  | any other existing row (elapsed trial or period, `expired`, `cancelled`, `disabled` + `read_only`) | `read_only` |
  | no row | `none` |

### `platform_set_organization_module(p_organization_id, p_module, p_status, p_trial_days, p_access_ends_at, p_restriction, p_reason) → platform_organization_module_result`
- **Who:** Platform Admin only. Errors: ZW002 for anyone else, ZW001 without a uid.
- **Validation (ZW006):**
  - `p_module = 'plus'`; status in `trial | active | expired | cancelled | disabled`; reason 3–500 after trim.
  - `trial`: `p_trial_days` NULL means **14**, otherwise 7–30. No access end, no restriction.
  - `active`: optional future `p_access_ends_at`, no restriction.
  - `disabled`: `p_restriction` is `read_only` or `no_access`, no access end.
  - `expired` / `cancelled`: neither.
  - Non-trial statuses take no trial days.
- **Transitions (ZW004):**
  - A trial starts only if `trial_started_at` is NULL. One trial per organization: a running trial is never restarted and a consumed trial is never re-granted.
  - `expired` / `cancelled` / `disabled` are refused for an organization with no row.
- **Unknown organization:** ZW002.
- **Concurrency:** locks the organization row, then the module row.
- **Idempotency:** an identical non-trial request returns `changed = false` with no write and no audit.
- **Audit:** every real change writes one `audit_events` row: `entity_type = 'organization_module'`, `action = 'platform_plus_access_changed'`, before/after `{module, status, restriction, trial_ends_at, trial_extension_count, access_ends_at}`, the reason, and actor `auth.uid()`.
- **Result:** `(organization_id, module, status, restriction, trial_ends_at, trial_extension_count, access_ends_at, effective_state, changed)`.

### `platform_extend_plus_trial(p_organization_id, p_extra_days, p_reason) → platform_organization_module_result`
- **Who:** Platform Admin only.
- **Validation:** 1–30 days and a 3–500-char reason (ZW006).
- **Effect:** valid only while `status = 'trial'` and `trial_extension_count = 0` (else ZW004). Sets `trial_ends_at = greatest(trial_ends_at, now()) + days` and `trial_extension_count` to 1.
- **Concurrency and audit:** the same row locks and audit event as above.

### Versioned forms (NP-P1-S2-R1, used by the Platform Admin panel)
Migration `20261013140000_plus_entitlement_optimistic_concurrency.sql` adds overloads with a trailing `p_expected_updated_at timestamptz`:
- `platform_set_organization_module(... the 7 arguments above ..., p_expected_updated_at)`
- `platform_extend_plus_trial(p_organization_id, p_extra_days, p_reason, p_expected_updated_at)`

Each one locks the organization row and the module row, then compares the module row's `updated_at` with `p_expected_updated_at` **under those locks**. NULL means "no entitlement row expected". On any mismatch it raises **ZW003 `stale_state`** and writes nothing (no row change, no audit). Otherwise it calls the unchanged function above in the same transaction, so every rule, the idempotent no-op and the audit event are identical. Two Platform Admins who submit from the same rendered version serialize on the organization lock: exactly one change applies and the other gets ZW003 instead of silently overwriting it. The unversioned signatures remain for the previously deployed app (EXPAND). A later reviewed CONTRACT migration may drop them.

### `platform_get_organization_module(p_organization_id, p_module) → platform_organization_module_state`
- **Who:** Platform Admin only.
- **Returns:** `(organization_id, module, provisioned, status, restriction, trial_started_at, trial_ends_at, trial_extension_count, access_ends_at, effective_state, status_reason, updated_at)`. `provisioned = false` when there is no row.
- **Errors:** unknown module ZW006; unknown organization ZW002.

### Tests
- `supabase/tests/plus_entitlement_tests.sql` (rollback-only).
- `supabase/tests/plus_entitlement_concurrency_test.sh`.
- `supabase/tests/plus_entitlement_versioned_tests.sql` (rollback-only, NP-P1-S2-R1).
- `supabase/tests/plus_entitlement_versioned_concurrency_test.sh` (NP-P1-S2-R1).
- `supabase/tests/privilege_contract_tests.sql`.

## Nemryn Plus access helpers (NP-P1-S2)

Migration `20261013120000_plus_access_helpers.sql`: functions only, no table, policy or Core change. No Core function calls them. They are the building blocks for future `plus_*` tables and RPCs.

| Function | Who may call | Returns / effect |
|---|---|---|
| `plus_can_read(org)` | authenticated | `true` iff the caller is Organization Admin of that active organization (active membership) AND the effective Plus state is `write` or `read_only`. Otherwise `false` (locked, none, any other role, inactive member, suspended organization, foreign tenant, bare PlatformAdminGrant). Never raises |
| `plus_can_write(org)` | authenticated | The same caller rule AND an effective state of `write`. `read_only` never writes |
| `_require_plus_write(org)` | owner-only (no client EXECUTE) | ZW001 without a uid; **ZW002** when the caller cannot read (no oracle); **ZW001** when readable but not writable |
| `_require_plus_admin_write(org)` | owner-only | `_require_plus_write` AND Organization Admin. Identical in S2; diverges when S3 named-staff grants arrive |

Tests: `supabase/tests/plus_access_helpers_tests.sql` (rollback-only, 170 cases).

> **NP-P1-S3:** `plus_can_read` / `plus_can_write` are grant-aware (next section). `_require_plus_write` and `_require_plus_admin_write` keep their bodies, so a write-grant Dispatcher passes `_require_plus_write` but never `_require_plus_admin_write`.

## Nemryn Plus named-staff grants (NP-P1-S3)

Migrations:
- `20261013160000_memberships_id_organization_unique.sql`: an additive Core constraint, `memberships unique (id, organization_id)` (PD-20, owner-approved and recorded as ZD-209). Grants: ZD-210.
- `20261013160100_plus_member_grants.sql`.

**Table `membership_module_grants`** (class A: RLS on, no policy, no client privilege):
- `organization_id`, plus `membership_id` with a composite FK to `memberships (id, organization_id)`;
- `module = 'plus'`;
- `access` is `read` or `write`;
- `granted_by` / `granted_at`, and `revoked_by` / `revoked_at` (NULL while active);
- at most one active grant per membership (partial unique index);
- rows are history and are never deleted.

**Effective access** (`_plus_member_access`, internal; combined with `_plus_entitlement_state`):

| Caller | Entitlement `write` | `read_only` | `locked` / `none` |
|---|---|---|---|
| Organization Admin (active, active organization) | read + write | read (history) | none |
| Active Dispatcher with an active `write` grant | read + write | none | none |
| Active Dispatcher with an active `read` grant | read | none | none |
| Dispatcher without a grant, Driver, inactive member, suspended organization, foreign tenant, Platform Admin without membership | none | none | none |

A grant is never removed by a Core change. It is inert while the membership is inactive or not a Dispatcher, and it is effective again if the membership is reactivated as a Dispatcher. An Admin can revoke it at any time.

`plus_access_state(org)` gains `access` (`none` | `read` | `write`):
- Admins: `state` unchanged (`write` / `read_only` / `locked` / `none`). `trial_ends_at` is returned to Admins only.
- Grant holders: `state = 'write'` with their grant's access, while the entitlement is `write`; `none` otherwise.

### `plus_list_member_access(p_organization_id)`
- **Who:** an Organization Admin while Plus is `write` or `read_only`. Errors: ZW002 otherwise; ZW001 without a uid.
- **Returns:** staff memberships (`organization_admin` and `dispatcher`; never drivers) with:
  - `membership_id`, `display_name`, `email`, Core `role` and `status`, `is_self`;
  - the active grant's `access`, `grant_id` and `granted_at` (NULL when there is none).

### `plus_grant_member_access(p_organization_id, p_membership_id, p_access, p_expected_grant_id) → plus_member_access_result`
- **Who:** an Organization Admin, with entitlement `write`, checked through `_require_plus_admin_write`:
  - ZW001 when read-only;
  - ZW002 for everyone else.
  - The check is repeated after taking `_lock_org_admins(org)`, the same lock as `change_membership_role` and `set_membership_status`.
- **Target:** the membership must belong to `p_organization_id` (ZW002 otherwise: forged, foreign or unknown). It must be an **active `dispatcher`** (ZW006 otherwise: admin, driver or inactive). `p_access` must be `read` or `write` (ZW006).
- **Idempotency:** if the same access is already active, the call returns `changed = false` with no write and no audit.
- **Concurrency:** `p_expected_grant_id` must equal the active grant's id (NULL means none), otherwise ZW003.
- **Effect:** a change revokes the active row (`revoked_at`, `revoked_by`) and inserts a new one.
- **Audit:** `plus_member_access_granted`, entity `membership_module_grant` with the new grant id. `before` holds the previous access and grant, or NULL; `after` holds `{module, membership_id, access, grant_id, email}`.

### `plus_revoke_member_access(p_organization_id, p_membership_id, p_expected_grant_id) → plus_member_access_result`
- **Who:** an Organization Admin while Plus is `write` or `read_only`, so stale grants can be cleaned up after Plus ends. Errors: ZW002 in `locked` / `none` and for everyone else. Uses the same lock and re-check.
- **Target:** any membership of the organization, including inactive or re-roled members (ZW002 otherwise).
- **Idempotency:** with no active grant, the call returns `changed = false`.
- **Concurrency:** `p_expected_grant_id` must equal the active grant (ZW003 otherwise).
- **Effect:** stamps `revoked_at` / `revoked_by`; the row is kept.
- **Audit:** `plus_member_access_revoked`.

Result type `plus_member_access_result`: `(membership_id, access, grant_id, changed)`. `access` and `grant_id` describe the active grant after the call.

Tests:
- `supabase/tests/plus_member_grants_tests.sql` (rollback-only);
- `supabase/tests/plus_member_grants_concurrency_test.sh`.

## Nemryn Plus Contacts + activity timeline (NP-P1-S4)

Migration `20261014100000_plus_contacts_activities.sql` creates two tenant tables. Both have RLS on, authenticated `SELECT` through the policy `plus_can_read(organization_id)`, and **no** insert, update or delete privilege for any client role. Writes go only through the RPCs below, which call `_require_plus_write` first:
- ZW002 when the caller cannot read Plus;
- ZW001 when they can read but not write (read grant, or `read_only` Plus).

**`plus_contacts`** has exactly the domain-model §6 columns:
- `display_name` 1–200, trimmed;
- `phone` ≤ 40: digits, spaces, `+ ( ) . -`, an optional `x123` / `ext 123` extension, and 7–20 digits in total;
- `email` ≤ 254, stored trimmed and lower-cased;
- `contact_kind`: individual, family_caregiver, facility_staff, referral_source or other;
- `job_title` ≤ 120;
- `preferred_channel`: phone, email or none;
- `do_not_contact`, a stored preference that future outreach must respect;
- `owner_user_id`;
- `status`: active, archived or redacted. `redacted` is reserved for PD-11, and no function sets it;
- `created_by`, `created_at`, `updated_at`. `updated_at` is the version token.

A contact needs a phone or an email unless redacted. There is no `account_id` (P3-S1), and no passenger, date-of-birth, address, health or insurance field.

**`plus_activities`** is append-only:
- `contact_id` is the composite FK to `plus_contacts`, and the only subject in S4. `plus_activities_subject_check` is `num_nonnulls(contact_id) = 1`, replaced additively by P2-S1, P2-S3 and P3-S1.
- `activity_type` (`plus_activities_activity_type_check`) is note, call_logged, email_logged, meeting_logged, owner_changed or record_archived.
- `body` is 1–2000 characters, required for note and the `*_logged` types.
- `from_stage` / `to_stage` are allowed only on `stage_changed`, which S4 does not permit.
- `actor_user_id`, `occurred_at`, and `recorded_at`, which is when the row was written. An interaction may be logged after it happened.
- There is no metadata JSON, and no function updates or deletes a row.

| RPC | Access | Contract |
|---|---|---|
| `plus_list_contacts(org, search, kind, status, limit, offset)` | Plus read | One page (1–100, default 25). `status`: active (default), archived or all. Search covers name, email and phone digits; LIKE wildcards are literal. `total_count` is the filtered total. The owner appears by name only |
| `plus_get_contact(org, contact_id)` | Plus read | One contact, including `owner_membership_id` (an opaque handle), `owner_can_write` and `updated_at`. **ZW002 for a foreign or unknown id**, the same answer as no access |
| `plus_list_contact_activities(org, contact_id, limit, offset)` | Plus read | The timeline, newest first, with the actor's name |
| `plus_find_contact_matches(org, name, phone, email, exclude_id)` | Plus read | Up to 5 possible duplicates in that organization, matching on the same email, the same phone digits (≥ 7) or the same name (case-insensitive). `match_on` lists what matched. Never merges |
| `plus_list_contact_owner_options(org)` | Plus write | Eligible owners: active Admins, and Dispatchers with an active **write** grant. Returns membership handles and names only |
| `plus_create_contact(org, …, owner_membership_id, confirm_possible_duplicate)` | Plus write | Trims and normalizes. Invalid input gives ZW006. The owner must be an eligible writer (ZW006). If possible duplicates exist and the call is not confirmed, **nothing is written**: `changed=false`, `possible_duplicates=n`. Audit: `plus_contact_created`, which copies no values |
| `plus_update_contact(org, contact_id, expected_updated_at, …)` | Plus write | Locks the row and compares the version (ZW003). Archived gives ZW004; identical values give `changed=false`. A **new** owner must be eligible; an unchanged owner who has since lost access is kept. An owner change writes an `owner_changed` activity. Audit: `plus_contact_updated`, recording the **names** of the changed fields only |
| `plus_archive_contact(org, contact_id, expected_updated_at, reason)` | Plus write | ZW003 when stale; `changed=false` when already archived. The row and its timeline are kept. Writes a `record_archived` activity (the reason ≤ 500 becomes its body) and audit `plus_contact_archived` |
| `plus_log_contact_activity(org, contact_id, type, body, occurred_at)` | Plus write | Accepts note, call_logged, email_logged and meeting_logged only (ZW006 otherwise). `occurred_at` NULL means now; it may not be in the future (> 5 minutes) or more than 366 days back. An archived contact gives ZW004. The same entry by the same person within 30 s is a no-op. The call locks the contact `FOR NO KEY UPDATE`, which serializes concurrent logs and waits for an in-flight archive or edit. **Logging records what staff did: Nemryn sends, calls and schedules nothing** |

Internal (no client EXECUTE): `_plus_user_can_write(org, user)`, `_plus_contact_matches`, `_plus_staff_name`, `_plus_resolve_owner`.

Tests:
- `supabase/tests/plus_contacts_activities_tests.sql` (rollback-only);
- `supabase/tests/plus_contacts_concurrency_test.sh`.

## Nemryn Plus private-pay opportunities + pipeline (NP-P2-S1)

Migration `20261014120000_plus_private_pay_opportunities.sql`.

**`plus_opportunities`** follows the domain-model §8 columns. Like contacts it is class B: authenticated `SELECT` through `plus_can_read(organization_id)`, with no client insert, update or delete.
- `channel`: `plus_opportunities_channel_check` allows `private_pay` only (P3-S1 widens it). A trigger keeps the channel immutable.
- `primary_contact_id` is a required composite FK to `plus_contacts` (`plus_opportunities_private_pay_contact_check`).
- `stage`: new_inquiry, contacted, qualified, quote_sent, quote_accepted, converted, lost.
- Closed sets for `inquiry_type`, `service_type` (Core's set), `source` and `payment_reported_status` (staff-reported only, PD-09).
- `lost_reason` uses the owner-approved canonical closed set (NP-P2-S1-R1A): no_response, price, chose_competitor, outside_service_area, service_not_offered, no_availability, not_a_fit, duplicate, other. `lost_note` ≤ 500 is required for `other`.
- `closed_at` is set exactly when the stage is lost or converted, and `converted_at` exactly when converted.
- There is no `account_id`, `referral_account_id` or `inquiry_id` yet.

**`plus_activities`** gains `opportunity_id`, a composite FK.
- `plus_activities_subject_check` becomes `num_nonnulls(contact_id, opportunity_id) >= 1`.
- `stage_changed` joins the type CHECK, and `plus_activities_stage_subject_check` requires an opportunity for it.
- Opportunity history rows (stage and owner changes) carry `opportunity_id` only, so S4 contact timelines are unchanged.
- ZD-211 is unchanged: staff-access changes stay in `audit_events`.

**Stage rules:**
- Open stages can move to any other open stage, so forward skips and backward moves are both allowed.
- `lost` is reached only through `plus_mark_opportunity_lost`, which requires a reason.
- A lost opportunity is reopened only through `plus_reopen_opportunity`, with a reason (3–500) and an open target stage.
- **`converted` is unreachable in P2-S1.** It is reserved for the P2-S4 Core conversion.
- `quote_sent` and `quote_accepted` are stages **reported by staff**. No quote document exists before P2-S5.

| RPC | Access | Contract |
|---|---|---|
| `plus_list_opportunities(org, search, view, stage, source, owner_membership_id, contact_id, limit, offset)` | Plus read | `view`: open (default), lost, converted or all. Search covers the title and the contact name. A foreign owner handle matches nothing. Returns the contact's name, status and do-not-contact flag. 1–200 rows, most recently updated first |
| `plus_get_opportunity(org, id)` | Plus read | **ZW002 for a foreign or unknown id**. Returns `owner_membership_id` (a handle) and `updated_at` (the version token) |
| `plus_list_opportunity_activities(org, id, limit, offset)` | Plus read | Stage and owner history with from/to stage |
| `plus_create_opportunity(org, contact_id, title, inquiry_type, service_type, source, source_detail, campaign_code, estimated_value_cents, owner_membership_id)` | Plus write | Creates in `new_inquiry`. The contact must be an **active** contact of the organization (archived gives ZW006; foreign or unknown gives ZW002), locked `FOR NO KEY UPDATE`. The campaign code is lower-cased. Values are validated (ZW006), and the owner must be an eligible writer. The same opportunity by the same person within 30 s is a no-op. Audit: `plus_opportunity_created` |
| `plus_update_opportunity(org, id, expected_updated_at, contact_id, …, payment_reported_status, owner_membership_id)` | Plus write | **Open only** (ZW004 otherwise). Row lock and version check (ZW003). A new contact must be active. *(NP-P2-S3-R2: the contact cannot change while Requests are linked; ZW004 `linked_requests`.)* An owner change writes an `owner_changed` activity on the opportunity. Audit: `plus_opportunity_updated`, recording field **names** only |
| `plus_change_opportunity_stage(org, id, expected_updated_at, to_stage, note)` | Plus write | Open stages only (lost or converted gives ZW006). Already in that stage gives `changed=false`. From lost or converted gives ZW004; stale gives ZW003. Writes one `stage_changed` row |
| `plus_mark_opportunity_lost(org, id, expected_updated_at, reason, note)` | Plus write | Reason from the closed set (`other` needs a note). Already lost gives `changed=false`; converted gives ZW004; stale gives ZW003. Sets `closed_at` |
| `plus_reopen_opportunity(org, id, expected_updated_at, to_stage, reason)` | Plus write | Lost only (ZW004 otherwise). A reason is required. Stale gives ZW003, so a duplicate reopen is never applied twice. Clears the lost fields and `closed_at` |

Internal (no client EXECUTE): `_plus_require_active_contact(org, contact)` and `_plus_opportunity_channel_immutable()` (a trigger function).

Tests:
- `supabase/tests/plus_opportunities_tests.sql` (rollback-only);
- `supabase/tests/plus_opportunities_concurrency_test.sh`.

Nothing in P2-S1 creates or changes a Core Request, Passenger, Trip or Recurring Care arrangement.

## Nemryn Plus tasks, Growth Agent and Dashboard (NP-P2-S2)

Migrations `20261015100000_plus_tasks.sql`, `20261015110000_plus_growth_agent.sql` and `20261015120000_plus_growth_dashboard.sql` (local only).

**`plus_tasks`** follows domain model §9. It is class B: authenticated `SELECT` through `plus_can_read`, with no client write.
- It has exactly one subject (`plus_tasks_subject_check`), a contact or an opportunity, through composite FKs. There is no account or request subject.
- `due_at` is stored in UTC. The app converts workspace-local input, and a date without a time means 23:59 workspace time.
- Tasks write **no** `plus_activities` rows.

| RPC | Access | Contract |
|---|---|---|
| `plus_list_tasks(org, view, search, assignee_membership_id, contact_id, opportunity_id, limit, offset)` | Plus read | `view`: open, mine, overdue (`due_at < now()`), today (now to the end of the workspace day), upcoming, no_date, done, cancelled, history; anything else gives ZW006. A contact filter includes that contact's opportunity tasks. Returns `is_overdue`, `is_due_today`, an assignee handle and name, subject names, and `updated_at` (the version token), plus `total_count`. 1–200 rows |
| `plus_get_task(org, id)` | Plus read | ZW002 for a foreign or unknown id |
| `plus_create_task(org, title, due_at, assignee_membership_id, contact_id, opportunity_id)` | Plus write | Exactly one subject; an archived contact or a closed opportunity gives ZW006, and a foreign or unknown one gives ZW002. The subject is locked `FOR NO KEY UPDATE`. The title is 1–200 characters, trimmed. The assignee must be an eligible Plus writer now (ZW006). The same task by the same person within 30 s is a no-op. Audit: `plus_task_created` |
| `plus_update_task(org, id, expected_updated_at, title, due_at, assignee_membership_id)` | Plus write | **Open only** (ZW004). A stale token gives ZW003. Identical values give `changed=false`. An unchanged assignee is kept even if that person lost access; a new assignee must be eligible. Audit: `plus_task_updated`, recording field names only |
| `plus_reassign_task(org, id, expected_updated_at, assignee_membership_id)` | Plus write | Open only; the assignee must be eligible; the same assignee gives `changed=false` |
| `plus_complete_task(org, id, expected_updated_at)` | Plus write | Sets `done`, `completed_at` and `completed_by`. Already done gives `changed=false`; cancelled gives ZW004; stale gives ZW003. Audit: `plus_task_completed` |
| `plus_cancel_task(org, id, expected_updated_at)` | Plus write | Kept as history. Already cancelled gives `changed=false`; done gives ZW004. Audit: `plus_task_cancelled` |

All write RPCs return `plus_task_write_result(task_id, status, updated_at, changed)`.

**Growth Agent.** This is staff-supervised; see product spec §7.6 and domain model §9a.

| RPC | Access | Contract |
|---|---|---|
| `plus_run_growth_agent_review(org)` | Plus write | Runs one deterministic review under a per-organization advisory lock. It inserts a `pending` recommendation for each new situation and supersedes pending ones whose situation changed. Unchanged situations are never repeated. It creates **no** task, activity, stage change or Core row. Returns `plus_agent_review_result(created, superseded, unchanged)`. Audit: `plus_agent_review_run`, with counts only |
| `plus_list_agent_recommendations(org, view, limit, offset)` | Plus read | `view`: pending, reviewed or all. Returns the opportunity, stage, contact name, the contact's **preferences only** (do-not-contact, preferred channel, has phone, has email), the last activity type and time, who generated it, and who reviewed it and when |
| `plus_approve_agent_recommendation(org, id, expected_updated_at, task_title, due_at, assignee_membership_id)` | Plus write | Takes a row lock. Already approved gives `already_approved` with the same task. Superseded gives a `superseded` no-op. Dismissed or not relevant gives ZW004; stale gives ZW003. It then locks the opportunity and its contact (`FOR NO KEY UPDATE`, opportunity first, the order every other writer uses; NP-P2-S2-R1) and **revalidates** the situation, so a task, stage change or activity committed concurrently is always seen: if the situation changed, the recommendation is superseded and no task is created. Otherwise it creates one open task on the opportunity and records the reviewer and time. Returns `plus_agent_review_outcome(recommendation_id, outcome, task_id, changed)`. Audit: `plus_agent_recommendation_approved` |
| `plus_dismiss_agent_recommendation(org, id, expected_updated_at, outcome)` | Plus write | `outcome` is `dismissed` or `not_relevant`; anything else gives ZW006. Repeating the same outcome gives `changed=false`; a different outcome after review gives ZW004 |

**Dashboard reads** (Plus read, own organization only):
- `plus_growth_dashboard(org)` returns one row: active opportunities, counts per open stage, active contacts, open, overdue, due-today and caller-owned tasks, pending recommendations, and attention opportunities.
- `plus_list_attention_opportunities(org, limit 1–50)` returns the agent detection, longest-waiting first.
- `plus_list_recent_activities(org, limit 1–50)` returns type, subject, actor and time, with **no note bodies**.

Internal (no client EXECUTE): `_plus_org_day_bounds`, `_plus_require_task_subject`, `_plus_insert_task`, `_plus_agent_threshold`, `_plus_agent_candidates`, `_plus_agent_review`.

Tests (rollback-only SQL):
- `supabase/tests/plus_tasks_tests.sql`, `supabase/tests/plus_tasks_concurrency_test.sh`;
- `supabase/tests/plus_growth_agent_tests.sql`, `supabase/tests/plus_growth_agent_concurrency_test.sh`.

Nothing in P2-S2 sends a message, places a call, changes an opportunity stage, or creates or changes a Core Request, Passenger, Trip or Recurring Care arrangement.

## Nemryn Plus request attribution (NP-P2-S3)

Migration `20261015130000_plus_request_attributions.sql` (local only). This is Growth's first link to Core transportation requests. **Plus references Core Requests; it never creates, changes, accepts, declines, cancels or locks them.**

**`plus_request_attributions`** follows domain model §10. It is class B: authenticated `SELECT` through RLS `plus_can_read(organization_id) AND has_org_role(organization_id, [organization_admin, dispatcher])`, with no client write.
- `request_id` is the PRIMARY KEY, so a Request is attributed at most once.
- Dimensions are `contact_id` and `opportunity_id` (at least one), each a composite FK.
- `link_method`: P2-S3 writes `linked_existing_request` only (the conversion values are reserved for P2-S4).
- `updated_at` is the version token.

**`plus_activities`** gains `request_id` (composite FK) and the types `request_linked` and `attribution_changed`. A correction's body is its reason.

Every RPC below requires the Core request-read role in addition to the Plus check, and returns ZW002 without it.

| RPC | Access | Contract |
|---|---|---|
| `plus_link_request(org, request_id, contact_id, opportunity_id)` | Plus write + Core read | Links an **existing** Request of the organization, in any state; the Request is read, never changed or locked. Rules: <br>• An opportunity fixes the contact to its primary contact; a different contact gives ZW006. <br>• A chosen contact must be active (ZW006); no dimension gives ZW006. <br>• An unknown or foreign Request, contact or opportunity gives ZW002. <br>• The same link again gives `changed=false`; a Request already attributed differently gives **ZW004** (use the correction). <br>Writes one `request_linked` activity and audit `plus_request_linked` (ids only). Returns `plus_request_attribution_result(request_id, contact_id, opportunity_id, updated_at, changed)` |
| `plus_update_request_attribution(org, request_id, expected_updated_at, contact_id, opportunity_id, reason)` | Plus write + Core read | Reason 3–500 (ZW006). Row lock, then the version check (ZW003). An unattributed, unknown or foreign Request gives ZW002. Same consistency rules, except an unchanged archived contact may stay. Identical dimensions give `changed=false` and no history. Never deletes the row, and never changes `link_method`, `linked_by` or `linked_at`. Writes `attribution_changed` on the new subjects and on any subject the Request moved away from, plus audit `plus_request_attribution_changed` (old and new ids) |
| `plus_get_request_attribution(org, request_id)` | Plus read + Core read | Contact (name, status), opportunity (title, stage), link method, who linked it and when, and the version. Zero rows when unattributed; ZW002 for an unknown or foreign Request |
| `plus_list_request_attributions(org, contact_id, opportunity_id, limit, offset)` | Plus read + Core read | Exactly one subject (ZW006 otherwise); a foreign subject gives ZW002. Returns ids and link facts, newest first, 1–100 |
| `plus_get_request_summaries(org, request_ids[])` | Plus read + Core read | 1–200 ids. **Attributed** Requests only; others are omitted. Returns state, source, service type, created and preferred date, passenger linked (yes/no), the latest decline/cancel reason **code**, trip counts (total / completed / cancelled-or-no-show), first completion, and recurring arrangement count + latest status. Never returns phone, email, addresses, notes or passenger fields |

**Contact consistency (owner-approved option B, NP-P2-S3-R2).**
- The same migration replaces the P2-S1 `plus_update_opportunity` forward-only, with an identical signature, grants, `SECURITY DEFINER` and `search_path`.
- The one added rule: changing `p_contact_id` on an opportunity that has linked Requests raises **ZW004 with message `linked_requests`**, and nothing is written.
  - The check runs after the row lock and the version check, so a stale call still returns ZW003, and a closed opportunity still returns ZW004 `illegal_transition`.
  - All other fields remain editable.
  - The app shows: "This opportunity has linked transportation requests. Correct those request links before changing its contact."
- To change the contact, staff first correct each linked Request with `plus_update_request_attribution` (with a reason), then change the contact, then re-link if needed.
- Nothing is re-pointed automatically. Bulk reassignment would be a separate reviewed design.

Internal (no client EXECUTE): `_plus_require_core_request_read`, `_plus_resolve_attribution`.

Tests:
- `supabase/tests/plus_request_attributions_tests.sql` (rollback-only);
- `supabase/tests/plus_request_attributions_concurrency_test.sh`.

Nothing in P2-S3 creates or changes a Core Request, request event, acquisition snapshot, Passenger, Trip or Recurring Care arrangement, and no opportunity stage changes.

## Nemryn Plus conversion & rebooking (NP-P2-S4)

Migration `20261015140000_plus_conversion_rebooking.sql` (local only; RPCs, a type, constraints and a guard trigger; **no new table**). Both RPCs create **one pending Core Request** through `log_transportation_request`, called as the signed-in staff member, so Core's own `has_org_role` check, validation, `pending` state and `request_logged` event apply. `passenger_id` is always NULL. Everything happens in **one transaction**: a later failure also rolls back the Core Request.

| RPC | Access | Contract |
|---|---|---|
| `plus_convert_opportunity_to_request(org, opportunity_id, expected_updated_at, idempotency_key, requester_relationship, pickup_description, destination_description, return_trip_needed, preferred_date, preferred_time, assistance_notes, additional_notes)` | Plus write + Core request role | Converts an **open** private-pay opportunity. <br>• Requester name, phone and email come from its **active** primary contact (no phone gives ZW006 `contact_phone_required`; archived gives ZW006 `contact_not_active`). <br>• The Core source is mapped from the opportunity: phone, email and facility unchanged; website and web_inquiry become web; everything else becomes other. <br>• Writes a `converted_from_opportunity` attribution with the key, sets the opportunity `converted` (`converted_at`, `closed_at`), writes `request_linked` and `stage_changed`, and audits `plus_opportunity_converted` (ids only). <br>• Refusals: ZW002 unknown / foreign; ZW003 stale; ZW004 `already_converted`, `illegal_transition` (lost) or `linked_request_exists` (a P2-S3 link exists); ZW006 invalid key, a key of another operation, or invalid Core fields. <br>Returns `plus_booking_request_result(request_id, contact_id, opportunity_id, request_state, changed)` |
| `plus_create_rebooking_request(org, contact_id, idempotency_key, requester_relationship, pickup_description, destination_description, return_trip_needed, source, preferred_date, preferred_time, assistance_notes, additional_notes)` | Plus write + Core request role | One new pending Request for an **active** contact, with the staff-chosen Core source. Writes a `rebooking` attribution (contact only) with the key, `request_linked`, and audit `plus_contact_rebooked` (ids only). No opportunity is created or changed, and nothing is copied from earlier Requests |

**Idempotency:**
- The key is 8–200 characters of `[A-Za-z0-9._:-]` and is serialized per (organization, key) with a transaction advisory lock.
- The same key for the same operation returns the **original** Request with `changed=false` and writes nothing.
- A key used for a different opportunity or contact gives ZW006, and never returns that Request.
- Authority is re-checked on every call, including replays. A key is never proof of authority.

**Lock order:** advisory(org, key) → opportunity `FOR UPDATE` → contact `FOR SHARE` → Core insert → Plus writes.

**Database-enforced rules:**
- `plus_request_attributions_method_shape_check`.
- `plus_request_attributions_one_conversion_idx`: one conversion per opportunity.
- `plus_opportunities_conversion_guard`: a deferred constraint trigger; `converted` only with its conversion attribution.
- `plus_update_request_attribution` replaced forward-only: a conversion link is immutable (ZW004 `conversion_link_immutable`), and a rebooking link never gains an opportunity (ZW006).

Internal (no client EXECUTE): `_plus_opportunity_conversion_guard`, `_plus_core_request_source`, `_plus_require_idempotency_key`.

Tests:
- `supabase/tests/plus_conversion_rebooking_tests.sql` (rollback-only);
- `supabase/tests/plus_conversion_rebooking_concurrency_test.sh` (ten races).

No Trip, Passenger, passenger link, assignment, recurring arrangement, payment or outbound message is ever created.


## Core staff Request service type (NC-REQUEST-SERVICE-TYPE-S1)

Migration `20261017100000_core_staff_request_service_type.sql`. No table, column or CHECK changes.

### `log_transportation_request(..., p_service_type text default null) → request_creation_result`

The same function, with one trailing optional parameter. It is replaced by DROP + CREATE: one function, no overload. The first 14 parameters, the authorization (Organization Admin / Dispatcher, otherwise ZW002), the validation, the pending-only INSERT and the `request_logged` event (`{source}` only) are unchanged.

- Omitted, NULL, empty or whitespace-only `p_service_type` means not specified (NULL is stored).
- Otherwise the value must be EXACTLY one of the nine canonical identifiers (`medical_appointment`, `dialysis`, `rehabilitation`, `hospital_discharge`, `recurring_care`, `senior_medical`, `wheelchair_transportation`, `other`, `airport_transportation`). It is never trimmed, case-folded or mapped from a label. Anything else raises ZW006 and writes nothing.
- The organization's configured Services do **not** restrict staff-recorded Requests (owner decision OD-S1 = A). The Log Request form lists them.
- Existing 14-argument callers keep working unchanged: the deployed app's named calls, and the positional calls inside `plus_convert_opportunity_to_request` / `plus_create_rebooking_request`, which keep storing NULL until the Plus follow-up.
- Nothing else is created: no Trip, Passenger, recurring arrangement or notification. `recurring_care` is a label only.

### `get_organization_service_offerings(p_organization_id) → text[]`

The enabled canonical service identifiers (an empty array means never configured). Owner-approved with S1: an active **Organization Admin or Dispatcher** of the organization may read them, so the staff form can list them. It is read-only; `set_organization_service_offerings` stays Organization Admin only.

Tests: `supabase/tests/core_staff_request_service_type_tests.sql` (rollback-only); `team_services_operations_tests.sql` SVC-7.
