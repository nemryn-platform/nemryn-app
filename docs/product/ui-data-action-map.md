# Zenward Platform — UI Data & Action Map

**Work item:** P1-E3-S0 — Stitch UI Ingestion & Implementation Mapping, amended by P1-E3-S0A — Controlled Internal Trip Creation Boundary (Create Trip / GAP-1 / GAP-2 resolved, marked inline below)
**Status:** Planning/documentation only. No application code, migration, or reference image was modified in P1-E3-S0; P1-E3-S0A added real migrations/RPCs to close GAP-1/GAP-2 specifically (see docs/reports/P1-E3-S0A-controlled-trip-creation-report.txt) — this document's other content is unaffected.
**Last updated:** 2026-08-31

Maps every visible field and actionable control in [docs/design/stitch/references/](../design/stitch/) to the real Zenward domain model and secure API surface ([mutation-api.md](../data/mutation-api.md), [read-api.md](../data/read-api.md)). Where the Stitch reference implies something the backend cannot or should not expose as-is, that is recorded here and in [ui-backend-gap-register.md](./ui-backend-gap-register.md) — never silently resolved by widening a projection or the reference itself.

**Reading the tables:** ROLE is who can legitimately see/do this per the existing authorization model. AUTHORIZED? / IMPLEMENTABLE NOW? are independent questions — a field can be authorized in principle but not yet exposed by any read model, or exposed but not yet displayed anywhere.

---

## 1. Lifecycle-state mapping

Every "state"-looking word in the Stitch references, resolved against the canonical Trip lifecycle (lifecycle-model.md §C) — 9 states: `scheduled`, `en_route_to_pickup`, `arrived_at_pickup`, `passenger_onboard`, `en_route_to_destination`, `arrived_at_destination`, `completed`, `cancelled`, `no_show`.

| Stitch label | Canonical mapping |
|---|---|
| "Scheduled" | `scheduled` |
| "En Route" | `en_route_to_pickup` (Overview/Dispatch/Trip Detail rows never distinguish en-route-to-pickup from en-route-to-destination visually — see §12 note below) |
| "Assigned" | **Not a Trip state** — a derived condition (§2) |
| "Requested" | Ambiguous — closest real mapping is `scheduled` with no active assignment yet, OR possibly reflects `transportation_requests.state='pending'` displayed inline in a Trip-shaped row before a Trip exists. Flagged as **PRODUCT DECISION REQUIRED** — see §12 (Today's Operations) below. |
| "Completed" | `completed` |
| "Passenger Onboard" (implied by the driver action set, not directly labeled in these references) | `passenger_onboard` |
| "Arrived" (driver active-trip CTA context) | `arrived_at_pickup` / `arrived_at_destination`, disambiguated by which leg the Trip is currently on |

No reference shows `cancelled` or `no_show` directly, though "Cancel" and no-show handling are implied by the Trip Detail "More" menu and the general Operations role (§30).

## 2. Derived-condition mapping

Per domain-model.md §5/lifecycle-model.md §E, "Needs Assignment", "Assigned", "Running Late", etc. are computed, never stored. Every one seen in the references:

| Stitch label | Formula | Status |
|---|---|---|
| **Needs Assignment** / **Unassigned** | `Trip.state = 'scheduled' AND no active TripAssignment` | **AVAILABLE NOW** — formula already documented (lifecycle-model.md §E), derivable from existing `trips`/`trip_assignments` Ops read access |
| **Assigned** | `Trip.state = 'scheduled' AND an active TripAssignment exists` | **AVAILABLE NOW** — same source |
| **Running Late** | Implied inputs: `scheduled_pickup_at`, current lifecycle state, `now()` — e.g. "still `scheduled`/`en_route_to_pickup` past `scheduled_pickup_at` by more than N minutes." **The threshold N is undefined anywhere in the product/security docs.** | **PRODUCT DECISION REQUIRED** (work item §19) — inputs exist, formula does not |
| **Pending Confirmation** | No canonical domain concept matches this at all — not a Trip state, not a TripAssignment fact, not a `transportation_requests.state` value (`pending`/`accepted`/`declined`/`cancelled`) | **BACKEND GAP / PRODUCT DECISION REQUIRED** — see gap register |
| **Potential timing conflict** (Dispatch Board) | Implied inputs: two Trips' `scheduled_pickup_at`/`appointment_at` windows for the same Driver, or a Driver's current Trip progress vs. their next assignment's start time. No formula documented. | **PRODUCT DECISION REQUIRED** |
| **CONFLICT** (Driver Capacity card) | Same underlying concept as "Potential timing conflict", different presentation | **PRODUCT DECISION REQUIRED** (same decision, not a separate one) |
| **Driver Availability** (Available / On Trip / Break / Unavailable) | `On Trip` is derivable (`current_driver_id` has an active `trip_assignments` row); `Available`/`Break`/`Unavailable` require a Driver-operational-availability concept that P1-E2-S3's own report explicitly deferred as a separate system, never faked from Trip state | **BACKEND GAP / DEFERRED** — see gap register |
| **Next Action** (Trip Detail "Arrive at pickup") | `_is_valid_trip_transition`'s legal-edge table, read forward from the Trip's current state, translated to a human label | **AVAILABLE NOW** — the transition table is already the single source of truth (ZD-089); needs only a display-label mapping, not new backend logic |
| **"Pickup updated from X"** (Driver Today/Trips change notice) | No field-level change-tracking exists for `trips.scheduled_pickup_at` (no before/after audit trail visible to Driver, and `trip_events`/`audit_events` are both unavailable to Driver by design — ZD-096) | **BACKEND GAP** — see gap register |

## 3. Field-to-data mapping

### Today's Operations (01)

| UI element | Domain entity | Source | Role | Authorized? | Implementable now? | Notes |
|---|---|---|---|---|---|---|
| Trip count metrics (24/6/3/3) | Trip (aggregate) | `trips` + `trip_assignments`, Ops RLS SELECT, client-aggregated | Admin/Dispatcher | Yes | Yes (derivable from the same query the tables below need) | A dedicated aggregate RPC would be an optimization, not a requirement — see gap register (non-blocking) |
| Needs Attention: Passenger/Route | Trip, Passenger | `trips.pickup_description`/`destination_description`, `passengers.display_name` | Admin/Dispatcher | Yes | Yes | Full Passenger row access, unlike Driver (ZD-097 is Driver-only) |
| Needs Attention: Issue (Needs Assignment/Running Late/Pending Confirmation) | derived | see §2 | Admin/Dispatcher | — | Mixed — see §2 | |
| Upcoming Trips: Time/Pickup/Destination | Trip | `trips.scheduled_pickup_at`, `pickup_description`, `destination_description` | Admin/Dispatcher | Yes | Yes | |
| Upcoming Trips: Driver/Vehicle | TripAssignment, Driver, Vehicle | active `trip_assignments` → `drivers.display_name`, `vehicles.label` | Admin/Dispatcher | Yes | Yes | |
| Upcoming Trips: Status | Trip + derived | `trips.state` + §2 derivations | Admin/Dispatcher | Yes | Mixed | |
| Driver Availability panel | see §2 | — | Admin/Dispatcher | — | **No** | BACKEND GAP / DEFERRED |
| Active Trips panel | TripAssignment, Trip, Driver, Vehicle | active `trip_assignments` join | Admin/Dispatcher | Yes | Yes | |
| Activity Log | TripEvent | `trip_events`, Ops RLS SELECT (`trip_events_select_org_operations`) | Admin/Dispatcher | Yes | Yes | Direct validation that TripEvent's design purpose is fulfilled by this exact UI concept |

### Trip Detail (02)

| UI element | Domain entity | Source | Role | Authorized? | Implementable now? | Notes |
|---|---|---|---|---|---|---|
| Passenger name, phone | Passenger | `passengers.display_name`, `.phone` | Admin/Dispatcher | Yes | Yes | Full Passenger row available to Ops (unlike Driver) |
| Pickup / Destination (address) | Trip | `trips.pickup_description` / `destination_description` | Admin/Dispatcher | Yes | Yes | Single free-text field each; Stitch's bold-name + address-lines presentation is a display-layer formatting choice, not evidence of separate structured fields — **PRODUCT DECISION** if structured name+address is actually wanted (non-blocking) |
| Scheduled pickup / Appointment time | Trip | `scheduled_pickup_at`, `appointment_at` | Admin/Dispatcher | Yes | Yes | |
| Driver / Vehicle | TripAssignment, Driver, Vehicle | active `trip_assignments` join | Admin/Dispatcher | Yes | Yes | |
| Trip Status / Current Status | Trip | `state` | Admin/Dispatcher | Yes | Yes | |
| Last Update | TripEvent | latest `trip_events.occurred_at` for this Trip | Admin/Dispatcher | Yes | Yes | |
| Next Action | derived | §2 | Admin/Dispatcher | — | Yes | |
| Trip Type ("One way") | TransportationRequest | `transportation_requests.return_trip_needed` (inverted), via `trips.request_id` | Admin/Dispatcher | Yes, if a request exists | **Conditional** | `request_id` is nullable — unavailable for manually-created Trips. See gap register |
| Requested By | TransportationRequest | `requester_name` (+ `requester_relationship`) | Admin/Dispatcher | Yes, if linked | Conditional | Same nullability caveat |
| Reference (e.g. "FAC-23981") | — | No corresponding field anywhere | Admin/Dispatcher | — | **No** | BACKEND GAP — see gap register |
| Trip ID ("ZW-240829-018") | — | No human-readable code field exists; `trips.id` is a UUID | Admin/Dispatcher | — | **No** | Same gap, generalized |
| Assistance Requirements | Trip | `trips.assistance_notes` | Admin/Dispatcher | Yes | Yes | |
| Companion | — | No field exists anywhere (`trips`, `passengers`, `transportation_requests`) | Admin/Dispatcher | — | **No** | BACKEND GAP |
| Trip Exceptions panel | TripException | `trip_exceptions`, Ops RLS SELECT | Admin/Dispatcher | Yes | Yes | |
| Trip Notes panel | TripNote | `trip_notes` (both visibility classes visible to Ops) | Admin/Dispatcher | Yes | Yes | |
| "Add Note" | TripNote | direct INSERT under `trip_notes_insert_operations` | Admin/Dispatcher | Yes | Yes | **Not** an RPC — see §5 |
| "Report Issue" | TripException | direct INSERT under `trip_exceptions_insert_operations` | Admin/Dispatcher | Yes | Yes | Not an RPC — see §5 |
| "Contact Driver" | Driver | `drivers.phone`, client-side `tel:` action | Admin/Dispatcher | Yes | Yes | No backend mutation at all |
| "Edit Trip" | Trip | direct UPDATE on the already-grantable planning columns (`scheduled_pickup_at`, `appointment_at`, `pickup_description`, `destination_description`, `assistance_notes`, `instructions`, `pickup_facility_id`, `destination_facility_id`) | Admin/Dispatcher | Yes | Yes | Column-level grant already exists from P1-E2-S1; not an RPC, not lifecycle-affecting |
| "More" menu | — | Unknown contents | Admin/Dispatcher | — | **Unresolved** | Ambiguous UI concept — flagged, not guessed |

### Dispatch Board (03)

| UI element | Domain entity | Source | Role | Authorized? | Implementable now? | Notes |
|---|---|---|---|---|---|---|
| Summary metrics | Trip/TripAssignment (aggregate) | same as Today's Operations | Admin/Dispatcher | Yes | Yes | |
| Needs Assignment queue | Trip, Passenger | `trips` + derived §2 | Admin/Dispatcher | Yes | Yes | |
| Assignment grid: trip blocks | Trip, TripAssignment | `trips.scheduled_pickup_at`/state, `trip_assignments` | Admin/Dispatcher | Yes | Yes | |
| Assignment grid: driver rows, vehicle | Driver, Vehicle | `drivers`, `vehicles` | Admin/Dispatcher | Yes | Yes | |
| "Potential timing conflict" | derived | §2 | Admin/Dispatcher | — | **No** | PRODUCT DECISION REQUIRED |
| Driver Capacity cards | Driver, TripAssignment, + availability | mixed — see §2 | Admin/Dispatcher | — | Partial | ON TRIP available now; AVAILABLE/BREAK deferred |
| "Assign" action | — | `assign_trip` RPC | Admin/Dispatcher | Yes | Yes | See §4 |
| "Dispatch Settings" | — | Unknown contents | Admin/Dispatcher | — | **Unresolved** | |

### Internal New Trip (05)

| UI element | Domain entity | Source | Role | Authorized? | Implementable now? | Notes |
|---|---|---|---|---|---|---|
| "Import request details" + Ref | TransportationRequest | direct RLS SELECT (`transportation_requests_select_org_operations`) | Admin/Dispatcher | Yes (read) | Yes (read only) | Reading a request to pre-fill is already possible; **creating the resulting Trip is the gap** — see §4/§13 and gap register |
| Requester type radio (Passenger/Family-Caregiver/Healthcare Facility/Other) | TransportationRequest | `requester_relationship` (`self`/`family`\|`caregiver`/`facility_coordinator`/`other`) | Admin/Dispatcher | Yes | Yes (as a request field) | Clean match once request-editing is in scope; not itself a Trip field |
| Requester name/organization/phone/email | TransportationRequest | `requester_name`, (org not a distinct column — see note), `requester_phone`, `requester_email` | Admin/Dispatcher | Yes | Yes | "Organization/Facility" has no dedicated column on `transportation_requests` — closest existing field is free-text `requester_name`/`additional_notes`, or the `facilities` table if a real Facility link is intended. **PRODUCT DECISION** (non-blocking) |
| Passenger search / Add New Passenger | Passenger | `passengers` RLS SELECT/INSERT (`passengers_select_org_operations`/`passengers_insert_org_operations`) | Admin/Dispatcher | Yes | Yes | Direct table access is adequate here — Passenger has no lifecycle machine to protect, unlike Trip |
| "Needs Attention: Driver not assigned" | derived | §2, anticipating post-creation state | Admin/Dispatcher | — | Yes (label only) | |
| "Create Trip" | Trip | `create_trip` RPC (**built in P1-E3-S0A**) | Admin/Dispatcher | Yes | Yes | GAP-1 resolved — see §13 and gap register |

### Driver Active Trip (04), Driver Today (06), Driver Trips (07)

See §6 (Driver read-model mapping) and §7 (Driver minimum-data conflicts) below — consolidated because all three screens draw from the same 2 read functions.

## 4. Action-to-RPC mapping

Every actionable control that mutates state, mapped to the actual function name (docs/data/mutation-api.md). "Direct table INSERT" rows are the two categories (`trip_notes`, `trip_exceptions`) that were deliberately never brought under the controlled-RPC umbrella and remain a sanctioned direct-write path under existing RLS — not an oversight, and not something to route through a new RPC.

| Screen | Action label | Actor | Expected current state | RPC / path | Success | Failure states | Authorized roles |
|---|---|---|---|---|---|---|---|
| Driver Active Trip | "I'VE ARRIVED" (pickup leg) | Driver | `en_route_to_pickup` | `driver_arrive_at_pickup` | `arrived_at_pickup` | ZW001/ZW002/ZW003 | Currently, actively assigned Driver only |
| (implied by full lifecycle, not all shown in one screenshot) | "I'm on my way" | Driver | `scheduled` | `driver_start_to_pickup` | `en_route_to_pickup` | ZW001/ZW002/ZW003 | Same |
| — | "Passenger onboard" | Driver | `arrived_at_pickup` | `driver_mark_passenger_onboard` | `passenger_onboard` | ZW001/ZW002/ZW003 | Same |
| — | "Start trip" / "I'm on my way" (destination leg) | Driver | `passenger_onboard` | `driver_start_to_destination` | `en_route_to_destination` | ZW001/ZW002/ZW003 | Same |
| — | "Arrived" (destination leg) | Driver | `en_route_to_destination` | `driver_arrive_at_destination` | `arrived_at_destination` | ZW001/ZW002/ZW003 | Same |
| — | "Complete trip" | Driver | `arrived_at_destination` | `driver_complete_trip` | `completed` | ZW001/ZW002/ZW003 | Same |
| Dispatch Board / Today's Operations | "Assign" | Admin/Dispatcher | no active assignment, eligible state | `assign_trip` | active assignment created | ZW002/ZW004/ZW005/ZW006 | organization_admin, dispatcher |
| (implied — reassignment isn't explicitly labeled in these references but is architecturally required for Dispatch Board drag/drop) | "Reassign" / drag-drop | Admin/Dispatcher | existing active assignment, eligible state | `reassign_trip` | new active assignment | ZW002/ZW004/ZW005/ZW006 | organization_admin, dispatcher |
| Trip Detail "More" (implied) | "Cancel" | Admin/Dispatcher | any non-terminal state | `cancel_trip` | `cancelled` | ZW002/ZW004/ZW006 | organization_admin, dispatcher |
| Trip Detail "More" (implied) | "No show" | Admin/Dispatcher | `en_route_to_pickup`/`arrived_at_pickup` | `record_no_show` | `no_show` | ZW002/ZW004/ZW006 | organization_admin, dispatcher |
| Trip Detail, Driver Active Trip | "Add Note" | Admin/Dispatcher/Driver | — | **Direct INSERT** into `trip_notes` (`trip_notes_insert_operations` / `trip_notes_insert_assigned_driver`) | new note row | RLS denial | Ops any role; Driver on own active Trip only |
| Trip Detail, Driver Active Trip | "Report Issue" | Admin/Dispatcher/Driver | — | **Direct INSERT** into `trip_exceptions` (`trip_exceptions_insert_operations` / `trip_exceptions_insert_assigned_driver`) | new exception row | RLS denial | Same |
| Internal New Trip | "Create Trip" | Admin/Dispatcher | — | `create_trip` (**built in P1-E3-S0A**) | new Trip, `state='scheduled'` | ZW002/ZW006 | organization_admin, dispatcher |
| Trip Detail | "Edit Trip" | Admin/Dispatcher | any state | Direct UPDATE on the already-grantable planning columns (no RPC) | updated Trip row | RLS/column-privilege denial | organization_admin, dispatcher |
| Trip Detail | "Contact Driver" | Admin/Dispatcher | — | No backend call — client-side `tel:` | — | — | organization_admin, dispatcher |
| Driver Active Trip | "Navigate" | Driver | — | No backend call — external maps deep link | — | — | Assigned Driver |
| Driver Active Trip, Today | "Call Passenger" | Driver | — | Uses `driver_get_trip_detail`'s already-returned `passenger_phone` — client-side `tel:`, no new call | — | — | Assigned Driver |

## 5. No-direct-table-mutation flags (work item §14)

Every place a naive implementation would be tempted to `UPDATE trips`, `INSERT/UPDATE trip_assignments`, or `INSERT audit_events` directly, and why it must not:

- **Any lifecycle-state change** (Driver action buttons, Trip Detail status, Dispatch Board assignment) — must go through the corresponding `driver_*`/`cancel_trip`/`record_no_show` RPC. `trips.state` has zero direct grant to `authenticated` (ZD-083/ZD-092) — a direct UPDATE attempt would fail at the privilege layer, which is the intended backstop, not merely a style preference.
- **"Assign"/"Reassign"/drag-drop on Dispatch Board** — must go through `assign_trip`/`reassign_trip`. `trip_assignments` INSERT/UPDATE has zero direct grant to `authenticated` (ZD-092).
- **"Create Trip"** — **resolved in P1-E3-S0A.** `trips` INSERT was directly grantable and column-unrestricted (a client could have set `state` to any value at creation, bypassing the entire lifecycle model) — this was the gap register's top blocking finding. `create_trip` (SECURITY DEFINER) is now the sole creation path, and the raw INSERT grant has been revoked entirely (ZD-101).
- **Any note/exception write appearing to imply an audit trail** — `audit_events` has zero INSERT grant to any human role in any phase; the UI must never attempt to write it directly, and none of the reviewed screens show a control that would tempt this specifically (Activity Log/TripEvent is read-only and separate from AuditEvent).

## 6. Driver read-model mapping

Every Driver-screen field mapped **only** to the 4 functions in docs/data/read-api.md — never to `passengers`/`trips`/`trip_notes`/`facilities`/`vehicles` directly (work item §15).

| Screen | Field | Source function | Field name | Notes |
|---|---|---|---|---|
| Driver Today | Shift status, avatar | Not from the read API — Driver's own `auth`/`user_profiles` session state | — | Out of scope for the 4 read RPCs; a separate, already-existing self-service concern |
| Driver Today | "N trips assigned" | `driver_list_active_trips` (client-side count) | count of rows | |
| Driver Today, Trips | Time, passenger, pickup/destination, status | `driver_list_active_trips` | `scheduled_pickup_at`, `passenger_display_name`, `pickup_description`, `destination_description`, `state` | |
| Driver Today, Trips | "Assigned" badge | derived from `state='scheduled'` (Driver only ever sees Trips they're actively assigned to, so the "unassigned" derivation doesn't apply here — every row IS assigned to them by construction) | — | |
| Driver Active Trip | Passenger name, phone | `driver_get_trip_detail` | `passenger_display_name`, `passenger_phone` | |
| Driver Active Trip | Pickup/drop-off address + time | `driver_get_trip_detail` | `pickup_description`, `destination_description`, `scheduled_pickup_at`, `appointment_at` | |
| Driver Active Trip | Assistance/Companion | `driver_get_trip_detail` | `assistance_notes` (Companion: **no field** — see §7) | |
| Driver Active Trip, Today | "Call passenger on arrival" note | `driver_get_trip_detail` | `driver_notes` (jsonb, driver_visible only) | |
| Driver Active Trip | Current status | `driver_get_trip_detail` | `state` | |
| Driver Trips | Date grouping (Today/Tomorrow) | client-side grouping of `driver_list_active_trips` by `scheduled_pickup_at` | — | |
| Driver Today, Trips | "History" tab | `driver_list_trip_history` | see §7 for what it can and cannot show | No reference image provided for the History screen itself — see gap register |
| Driver Profile tab | Driver's own name/phone/status/org | `driver_get_profile` | all fields | No reference image provided for the Profile screen itself |

## 7. Driver minimum-data conflicts (work item §16)

Fields the Stitch references show (or imply) that the current secure Driver projection does not, or cannot without a product decision, return:

| Field shown | Screen | Operational reason it may be needed | Current projection status | Privacy implication |
|---|---|---|---|---|
| Companion | Driver Active Trip | Driver may need to know a companion is riding along, for capacity/behavior planning | **Not returned — no schema field exists at all**, on either `trips` or `passengers` | N/A until the field exists — this is a schema gap, not a minimization decision |
| "Pickup updated from X" (change history) | Driver Today, Trips | Driver benefits from knowing a time changed, not just the new value | **Not returned** — no field-level change tracking exists; `trip_events`/`audit_events` (which could theoretically carry this) are both zero-exposure to Driver by design (ZD-096) | Widening either table's exposure to Driver would need its own explicit, separately-reviewed decision — not assumed here |
| TripEvent-style timeline (implied by "Trip Details" button on Driver Active Trip, unconfirmed) | Driver Active Trip | Driver may want to see their own action history for this Trip | **Not returned** — `driver_get_trip_detail` intentionally carries no TripEvent data (ZD-087/work item §24) | A future dedicated, narrowly-scoped timeline projection (own-actions-only) would need its own review, not a widened base grant |

**None of these are solved in this phase**, per explicit instruction. All three are recorded again in the gap register with severity/phase recommendations.

## 8. Operations data mapping (work item §17)

Operations (`organization_admin`/`dispatcher`) legitimately has broader tenant access than Driver — full `passengers`, `facilities`, `vehicles`, `drivers`, `trip_notes` (both visibility classes), `trip_exceptions`, `trip_events`, `transportation_requests` SELECT, all already RLS-scoped to the org. Every Operations field mapping above uses this existing access directly — no new read model is required for Operations in this phase (work item §66 default), with one caveat: **avoid overfetching**. Concretely:

- Today's Operations / Dispatch Board's "Upcoming Trips"/"Today's Assignments" tables should query Trips scoped to `scheduled_pickup_at` within the visible day (plus active-state trips regardless of date), not the entire `trips` table.
- The summary metric strip should reuse the same day-scoped query rather than issuing a separate full-table count.
- No aggregate/materialized Operations read RPC is required to implement any reviewed screen — a narrow, date-bounded query against existing RLS-protected tables is sufficient. A dedicated aggregate view remains a valid *future* optimization if query cost becomes a real concern at scale, not a blocking requirement now (see gap register, non-blocking).

## 9. TransportationRequest vs. Trip distinction (work item §28) and request-to-trip gap status (§29)

The domain model's separation is intact and must not be collapsed:

- **TransportationRequest**: inbound intent, states `pending → accepted | declined | cancelled`, snapshot requester fields, nullable `passenger_id`.
- **Trip**: the actual scheduled/executed movement, its own 9-state lifecycle, nullable `request_id` (1:N — a Request may produce zero, one, or multiple Trips, e.g. outbound + return; no 1:1 assumption exists in the schema, and none is introduced here).

Internal New Trip (05) visibly represents **both** paths in one screen: a manually-created Trip (no request) and a request-linked Trip ("Import request details"). This is architecturally correct and must be preserved — the screen is not evidence that Request and Trip should merge.

**Request-to-trip gap status: RESOLVED (P1-E3-S0A).** `create_trip` now handles both (a) creating a Trip from a Request, (**superseded by P1-OPS-R1 / ZD-204:** the Request must now be explicitly accepted first; `create_trip` no longer transitions it), and (b) creating a Trip manually with no Request, through a controlled, column-restricted path — the raw INSERT the original finding was concerned about is now revoked entirely. See gap register (GAP-1/GAP-2, both RESOLVED) and docs/data/mutation-api.md.
