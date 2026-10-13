# Zenward Platform — UI/Backend Gap Register

**Work item:** P1-E3-S0 — Stitch UI Ingestion & Implementation Mapping, amended by P1-E3-S0A — Controlled Internal Trip Creation Boundary (GAP-1 and GAP-2 resolved), P1-E3-S8B1 (GAP-12 through GAP-15 found), P1-E3-S9 (GAP-12 through GAP-15 resolved, GAP-16 found)
**Status:** GAP-1/GAP-2/GAP-12/GAP-13/GAP-14/GAP-15 all resolved with real migrations, RPCs, and tests — see the respective phase reports. GAP-9 (Export Day Sheet) resolved in P1-PILOT-UX1 (ZD-205), application-only. GAP-16 is a deliberate, documented deferral.
**Last updated:** 2026-09-03

Every UI requirement from the 7 Stitch references that the current backend does not support, classified `BLOCKS P1-E3-S1` / `BLOCKS SPECIFIC SCREEN` / `DEFERRED` / `OPTIONAL`. Only gaps actually found by the reference analysis in [ui-data-action-map.md](./ui-data-action-map.md) are listed — nothing speculative.

---

## BLOCKS SPECIFIC SCREEN

### GAP-1 — Controlled internal Trip creation — **RESOLVED (P1-E3-S0A)**

- **Screen:** Internal New Trip (05)
- **Finding:** `trips` INSERT is granted to `authenticated` **without column restriction** (`grant select, insert, update on public.trips to authenticated;`, `supabase/migrations/20260830131700_rls_policies.sql`), gated only by `trips_insert_org_operations` (an org-role check). Unlike UPDATE — which was later revoked and re-granted only for specific planning columns — INSERT was never narrowed. A client-side direct INSERT could set `state` to any value at creation (bypassing the entire lifecycle model this project has otherwise carefully enforced), or set terminal timestamps at creation time.
- **Severity:** High — this is a real, currently-exploitable gap in the existing schema, not merely a missing feature. It predates this phase (created in P1-E2-S1) but was not caught by any prior audit because no prior phase built a Trip-creation UI to exercise it.
- **Resolution:** `create_trip` (SECURITY DEFINER RPC, `supabase/migrations/20260831120000_controlled_trip_creation.sql`) is now the sole creation path — `state` is not a parameter at all (structurally impossible to override, not merely rejected at runtime), hard-coded `'scheduled'`. The raw `trips` INSERT grant to `authenticated` is revoked (`20260831120100_retire_direct_trip_insert.sql`, ZD-101), mirroring ZD-092's treatment of `trip_assignments`. Verified: 27 SQL assertions + a forced-failure atomicity test + 6 real-HTTP checks, zero failures, full prior regression (204 total SQL assertions) remains green. See docs/reports/P1-E3-S0A-controlled-trip-creation-report.txt.
- **Blocks:** Nothing, as of P1-E3-S0A — `/operations/trips/new` can now be safely implemented once P1-E3-S1's auth plumbing exists. **Built: P1-E3-S7** — see docs/reports/P1-E3-S7-completion-report.txt.

### GAP-2 — Request-to-Trip conversion / acceptance — **RESOLVED (P1-E3-S0A)**

- **Screen:** Internal New Trip (05) — "Import request details"
- **Finding:** Reading a `transportation_requests` row to pre-fill a form is already possible (existing RLS SELECT). Nothing currently transitions a Request's `state` from `pending` to `accepted` when a Trip is created from it, despite the schema's own comment describing this as intended ("system-driven, triggered by first Trip creation"). No atomic create-Trip-and-accept-Request operation exists.
- **Severity:** Medium — depended on GAP-1.
- **Resolution:** Folded into `create_trip` exactly as recommended — an optional `p_request_id`, validated for tenant consistency and a usable state (`pending`/`accepted`; `declined`/`cancelled` rejected), atomically transitions a `pending` request to `accepted` in the same transaction as the Trip INSERT. Correctly preserves 1:N (an already-`accepted` request — e.g. producing a return-leg Trip — is left untouched, not treated as an error). A `decline_request`-style RPC for the request queue remains unbuilt — not evidenced by any reference in the P1-E3-S0 batch, so not proposed or built here.
- **Blocks:** Nothing, as of P1-E3-S0A. **Built: P1-E3-S7** — "Import request details" implemented using only real `transportation_requests` fields (never the fabricated Requester-editor fields the reference's own mockup shows for this — see new-trip-data-map.md §4/§7). A `decline_request`-style RPC remains unbuilt, unchanged.

### GAP-3 — Missing reference images: Driver History and Driver Profile screens — **History built (P1-E3-S3), Profile still open**

- **Screen:** Driver History, Driver Profile (both present in the bottom tab bar on every Driver reference, neither has its own screenshot)
- **Finding:** Both routes already exist and both have a ready backend source (`driver_list_trip_history`, `driver_get_profile`), but no visual reference was provided to design against.
- **Severity:** Low — backend-ready, visual-design gap only.
- **Resolution (History, P1-E3-S3):** Built as a minimal, functional screen directly against the existing design system, per this gap's own original recommendation — see ZD-128, docs/product/driver-active-trip-data-map.md. Rows show exactly what `driver_list_trip_history`'s deliberately-redacted contract returns (date/time/outcome), no passenger name or route.
- **Driver Profile: still open, unchanged.** Not addressed this phase — remains a stub.
- **Blocks:** Nothing — Driver Profile is simply not ready to build with full design fidelity yet.

### GAP-4 — Sign-in / auth screen

- **Screen:** No reference provided for any unauthenticated state
- **Finding:** No Stitch reference shows sign-in, sign-up, or password-reset.
- **Severity:** Low (design gap) but **functionally required** for P1-E3-S1 regardless.
- **Recommendation:** Build a minimal functional sign-in view directly against the existing design system for S1 — do not block the auth-plumbing work on a missing mockup.
- **Blocks:** Nothing structural; noted so it isn't forgotten.

---

## BLOCKS P1-E3-S1 (cross-cutting, not screen-specific)

### GAP-5 — No Supabase client/session wiring exists yet

- **Finding:** `grep -rl "supabase" src/` returns nothing. No browser client, no server client, no session retrieval, no role-guard middleware exists anywhere in the application code, despite `.env.local` already carrying the right variable names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`).
- **Severity:** Structural — this is exactly what P1-E3-S1 exists to build, not a surprise, but recorded here for completeness since it blocks every screen equally.
- **Recommendation:** See [application-implementation-plan.md](./application-implementation-plan.md).
- **Blocks:** Every screen, equally — this is the literal definition of P1-E3-S1's scope.

---

## DEFERRED (previously deferred, reconfirmed here — not newly discovered)

### GAP-6 — Driver Availability system

- **Screens:** Today's Operations (Driver Availability panel), Dispatch Board (Driver Capacity: Available/Break/Unavailable statuses)
- **Finding:** `On Trip` is derivable from an active `trip_assignments` row; `Available`/`Break`/`Unavailable` require a genuine driver-operational-availability concept that has no schema representation and was explicitly deferred as its own system in prior phases (P1-E2-S3's own report references this same deferral).
- **Severity:** Medium — visible on 2 of 7 screens, but not blocking (each screen degrades gracefully to showing only "On Trip" vs. an unlabeled/omitted status).
- **Recommendation:** A dedicated future work item (schema + RLS + read/mutation surface for Driver-set or dispatcher-set availability), scoped and reviewed on its own — not designed here.
- **Blocks:** Full fidelity of the Driver Availability/Capacity panels only; both screens remain otherwise implementable.
- **Resolution this phase (Today's Operations, P1-E3-S4):** Confirmed still open — the Driver Availability panel is omitted from Today's Operations entirely (not degraded to a partial "On Trip only" version), since Today's Operations' own summary strip already reports the "active" trip count elsewhere; a partial panel here would have added visual clutter without adding information not already shown. Dispatch Board (not built this phase) remains the screen where "On Trip only" degradation, per the original recommendation, is the more natural fit.
- **Resolution (Dispatch Board, P1-E3-S5):** Built exactly as the original recommendation anticipated — `DriverCapacityPanel` shows real Driver names and an "On Trip" badge only when a genuine active-state assignment exists right now; no badge at all otherwise. AVAILABLE/BREAK/CONFLICT pills and the "Potential timing conflict"/"BREAK UNTIL..." grid annotations from the reference are not built (ZD-140). Still fully open as its own future work item.
- **Reconfirmed still open (P1-E3-S7A):** Driver location tracking was built this phase, deliberately kept separate from this gap — a Driver having a fresh recorded location does NOT mean "Available" (work item §35 of P1-E3-S7A). `AssignmentGrid`'s new freshness indicator shows recency of a real Trip-execution location signal only, never an availability status; `DriverCapacityPanel` itself is unchanged.
- **Reconfirmed still open (P1-E3-S8B):** Re-inspected directly against the running application during the full design-convergence pass, not assumed still accurate from the P1-E3-S5/S7A notes above — Today's Operations still has no Driver Availability panel, `DriverCapacityPanel` still shows only "On Trip" or nothing. Work item §30 explicitly repeated the same prohibition this phase ("do not fabricate Driver availability... keep assigned/on-trip facts ≠ availability status"), confirming this remains a deliberate, not merely inherited, omission. See `docs/design/ui-convergence-audit.md` (Today's Operations finding #4, Dispatch Board finding #3) for the full re-verification.

### NAT-1 — Passenger selection: temporary native `<select>` — **RESOLVED (P1-E3-S8B)**

- **Screen:** Internal New Trip (Passenger field).
- **Finding (P1-E3-S7):** Reference 05 shows a richer search/typeahead selection experience (search input → filtered results → a distinct selected-passenger card with an avatar-initial circle, name, phone, and a clear remove control) than a plain native `<select>` can provide. Built as a native `<select>` in P1-E3-S7 as an explicit, temporary, documented simplification — never presented as final.
- **Resolution (P1-E3-S8B):** A real, accessible `Combobox` primitive (`src/components/ui/Combobox.tsx`) — WAI-ARIA "combobox with list autocomplete" pattern, full keyboard support, a real empty state — now backs this field, rendering the reference's own selected-passenger card composition (Avatar + name + phone + Remove) on selection. See `docs/design/ui-convergence-audit.md` (New Trip finding #3) and `docs/design/zenward-ui-system.md` §5 for the full rationale and reuse guidance.

### GAP-7 — TripException Driver-facing status view — **PARTIALLY RESOLVED (P1-E3-S8B): report UI now exists; list view still open**

- **Finding:** Reconfirms ZD-096's own deferral (P1-E2-S3) — the existing `trip_exceptions_select_assigned_driver` policy is retained but no projection surfaces it to Driver UI. No reference in this batch showed a Driver-facing exception LIST (only "Report Issue," a write action).
- **P1-E3-S8 update:** The Operations-facing side of this gap is now fully closed — "Report Issue" and "Resolve" are both real, working actions on Trip Detail, backed by `report_trip_exception`/`resolve_trip_exception` (superseding the old "backend-ready via direct INSERT" note; the write path is now the controlled RPC pair, not a raw INSERT — see `mutation-authorization.md`). The Driver-facing exception LIST itself remains unbuilt — a Driver can report an issue through `report_trip_exception` but still cannot see the status of an exception (their own or Operations-created) anywhere in the Driver UI. Not addressed this phase; work item explicitly scoped Trip Assurance to Operations surfaces only ("Driver should not see confusing internal Operations terms").
- **P1-E3-S8B update:** The Driver-facing REPORT half of this gap is now also closed — Reference 04 (Driver Active Trip) shows a clear "Report Issue" affordance, and P1-E3-S8A's own authorization hardening (current-assignment-only, non-terminal-only) made it safe to build without widening any privilege beyond what the work item explicitly allowed (§37: "current active assignment only, non-terminal only, same controlled RPC, no Driver resolve, no broad exception read" — all satisfied). `DriverReportIssueButton`/`DriverReportIssueDialog` added to Driver Active Trip, same `report_trip_exception` RPC and restrained 7-value issue-type list as the Operations dialog. The exception-status LIST/READ half remains open — still no Driver-facing surface shows a Trip's existing exception(s), by the same deliberate scoping this phase re-confirmed, not merely inherited unexamined.
- **Severity:** Low.
- **Blocks:** Nothing in this reference set.

### GAP-10 — Driver Today "Completed Today" section — not implementable at full Stitch fidelity *(found P1-E3-S2)*

- **Screen:** Driver Today (06)
- **Finding:** `driver_list_active_trips` excludes a completed trip entirely — its active assignment closes in the same transaction as `driver_complete_trip`, so a finished trip has no active assignment left to be listed under, by construction, not an oversight. `driver_list_trip_history` is the only RPC covering ended assignments, but ZD-099 deliberately redacts passenger identity and pickup/destination text from history (a past assignment is lower-need than an active one). No combination of the two approved RPCs can produce Stitch's "8:15 AM · Brenda Scott · Home → Northside Clinic · Completed" row.
- **Severity:** Low — cosmetic completeness of one section on one screen; no security or correctness issue, and the information is not lost (it remains visible, appropriately redacted, on the deferred History tab).
- **Recommendation:** Do not widen `driver_list_trip_history`'s existing redaction to work around this — that would undermine ZD-099's stated privacy rationale for a single section's visual completeness. If full fidelity is ever wanted, it needs its own deliberately-reviewed, narrowly-scoped "recently completed, minimally identifying" projection — a new decision, not assumed here.
- **Resolution this phase:** Omitted from Driver Today. Not implemented, not faked. See docs/product/driver-today-data-map.md "Omitted from this phase".
- **Blocks:** Full Stitch-reference parity on Driver Today only.

---

## OPTIONAL (would improve the product but nothing in this reference set requires it)

### GAP-8 — Operations Overview aggregate read RPC

- **Finding:** Summary metrics (24 trips today, 6 active, etc.) are derivable client-side from the same day-scoped `trips` query the tables below them already need — no new RPC is required to implement the screen (see ui-data-action-map.md §8).
- **Severity:** None currently — purely a future query-cost optimization if data volume grows.
- **Recommendation:** Do not build speculatively; revisit if real usage shows the client-side aggregation is a performance problem.
- **Resolution (Today's Operations, P1-E3-S4):** Confirmed as recommended — `getTodaysOperations()` (`src/lib/operations/todays-operations.ts`) derives every summary count server-side from the same three real queries the panels below already need. No aggregate RPC was built.

### GAP-9 — "Export Day Sheet" — **RESOLVED (P1-PILOT-UX1)**

- **Finding:** No backend export/report-generation capability exists in any phase to date.
- **Severity:** Low — a single button on one screen, not core trip-management functionality.
- **Recommendation:** Scope as its own small feature when prioritized; not designed here.
- **Resolution (Today's Operations, P1-E3-S4):** The button is rendered, real, and `disabled` — not hidden, not a fake working control. Still fully open as a future feature.
- **Resolution (P1-PILOT-UX1, ZD-205):** Implemented without a database change.
  - The header's Export Day Sheet menu (Overview = today; Dispatch = the selected Today / Tomorrow) opens a printable Day Sheet (`/day-sheet`, browser Print → Save as PDF) or downloads a CSV (`/day-sheet/csv`).
  - Both reuse the Dispatch loader (`getDispatchBoardData`) for the caller's current organization and organization-local day, with the caller's own RLS-bound session.
  - Access is limited to Organization Admin and Dispatcher (`requireOperationsAccess`).
  - Columns are minimized (no phones, emails, notes or ids), and CSV formula-injection is neutralized.
- **Blocks:** Nothing — closed.

### GAP-11 — No Trip duration / expected-dropoff field — found P1-E3-S5

- **Screen:** Dispatch Board (03) — "Today's Assignments" time-axis grid
- **Finding:** `trips` has only `scheduled_pickup_at`/`appointment_at` (both single instants) — no field represents how long a Trip is expected to take, or when it's expected to end. The reference's own grid renders each Trip block with a visible WIDTH suggesting a duration.
- **Severity:** Low — cosmetic precision of one visual element on one screen; no correctness or security issue, and nothing is hidden (every block still shows its real start time and status).
- **Recommendation:** Do not invent an estimated-duration heuristic (e.g. "assume 45 minutes") to fill this gap — that would be fabricated data presented as if real. If duration-proportional grid blocks are ever wanted, this needs its own deliberately-reviewed schema decision (a stored duration? computed from historical Trip data? facility-specific defaults?), not assumed here.
- **Resolution this phase:** `AssignmentGrid` renders every Trip block at the same fixed width, positioned only by its real start time (`src/lib/operations/dispatch-grid.ts`, ZD-136). Not implemented as duration-proportional, not faked.
- **Blocks:** Full Stitch-reference visual parity of the grid's block sizing only — the grid is otherwise fully functional.

### GAP-12 — Passenger Edit/Deactivate — found P1-E3-S8B1, **RESOLVED P1-E3-S9**

- **Screen:** Passengers
- **Finding:** `passengers_update_org_operations` (RLS) plus the narrowed `display_name, phone, assistance_notes, status` column grant already existed and were already safe (org+role-scoped, non-dangerous columns only) — inspected directly before deciding, not assumed. A future Edit/Deactivate flow needed no new RLS or migration, only a form and a Server Action.
- **Resolution (P1-E3-S9):** Built exactly as anticipated — click a row on the Passengers screen to open `EditPassengerDialog` → `updatePassengerAction`, a direct UPDATE against the already-safe column grant. Deactivate is the same form's Status field, not a separate destructive control — the row is never deleted. See `docs/product/onboarding-data-map.md`.
- **Blocks:** Nothing — closed.

### GAP-13 — Facility Create/Edit — found P1-E3-S8B1, **RESOLVED P1-E3-S9**

- **Screen:** Facilities
- **Finding:** `facilities_insert_org_operations`/`_update_org_operations` (RLS) already org+role-scoped and column-narrowed (`name, address_line1, address_line2, city, state, postal_code, status`). Read-only list built at P1-E3-S8B1; create/edit deliberately deferred then for scope discipline.
- **Resolution (P1-E3-S9):** `createFacilityAction`/`updateFacilityAction`, both direct RLS-protected mutations against the already-safe grant. "Add Facility" on the Facilities screen, and the SAME action reused (not duplicated) as the onboarding flow's own "First Facility" step. Facility remains a distinct entity from Organization throughout.
- **Blocks:** Nothing — closed. New Trip's Facility selector now shows any Facility an operator creates in-app.

### GAP-14 — Fleet (Vehicle) Create/Edit — found P1-E3-S8B1, **RESOLVED P1-E3-S9**

- **Screen:** Fleet
- **Finding:** `vehicles_insert_org_admin`/`_update_org_admin` (RLS) already Organization-Admin-scoped and column-narrowed (`label, status`). Read-only list built at P1-E3-S8B1; create/edit deliberately deferred then, same reasoning as GAP-13.
- **Resolution (P1-E3-S9):** `createVehicleAction`/`updateVehicleAction`, both direct RLS-protected mutations. "Add Vehicle" on the Fleet screen (click a row to edit), and the SAME action reused as the onboarding flow's own "First Vehicle" step. Only real schema fields (`label`, `status`) — no fabricated wheelchair/stretcher/ambulatory capability column, since the schema has none.
- **Blocks:** Nothing — closed.

### GAP-15 — Driver Onboarding (Driver + Membership + user invite) — found P1-E3-S8B1, **RESOLVED P1-E3-S9**

- **Screen:** Drivers
- **Finding:** Unlike GAP-12/13/14, this was NOT merely a deferred form — Driver is not AuthUser/Membership, and no safe, coherent contract existed for inviting a new authenticated user, creating their Membership, AND linking a `drivers` row together. Building any part of this casually (e.g. a bare `drivers` INSERT with no linked user) would have either fabricated a fake invite flow or risked creating orphaned auth users with no way to actually sign in.
- **Resolution (P1-E3-S9):** A token-gated invite record (`driver_invites`), never admin-created credentials — the org admin creates an invite, the invitee signs up themselves through ordinary Supabase Auth with the matching email, then redeems the invite (`redeem_driver_invite`) to atomically get a `driver` Membership + linked Driver row. Full design, authorization boundaries, and the real `drivers.user_id` grant-narrowing this work also required: `docs/product/driver-invite-linkage-model.md`. Verified via 9 dedicated SQL tests plus a genuine two-process concurrency test (`driver_invite_concurrency_test.sh`) plus a full live browser redemption flow.
- **Blocks:** Nothing — closed. Adding a new Driver to an organization is now a real, safe, self-service in-app path (`/operations/drivers` → Invite Driver).

### GAP-16 — `business_stage`-driven navigation personalization — found P1-E3-S9, deliberately deferred

- **Screen:** Operations sidebar (all screens)
- **Finding:** Work item §12 ("progressive complexity") suggested a STARTING (1–2 vehicle) operator's navigation could emphasize "My Trips/Passengers/Facilities/Drive" over "Dispatch/Drivers/Fleet/Operations." This phase built the one genuinely-derived, safe piece of that idea (the conditional "Drive" item, gated on a real linked Driver row — `docs/product/owner-operator-mode.md`), but deliberately did NOT build a `business_stage`-keyed reordering/hiding of the existing 7-item nav.
- **Severity:** Low — cosmetic/UX refinement, not a capability gap; every nav item already works identically for every business stage.
- **Reason for deferral:** The exact UX shape (which items move where, whether any are hidden vs. reordered, at what vehicle-count threshold) was not specified precisely enough to build safely without real risk of regressing the already-tested, already-working navigation for every OTHER operator size, within this phase's own time budget.
- **Recommendation:** A dedicated, narrowly-scoped future work item, with the exact target nav compositions for each business stage specified up front — not assumed or improvised here.
- **Blocks:** Nothing structural — the full, identical navigation already works for every operator regardless of size.

---

## PRODUCT DECISIONS REQUIRED (not backend gaps per se — need product input, not engineering, before either can be built)

These block full fidelity of specific UI concepts but are not "missing backend capability" in the RPC/schema sense — they need a defined business rule before any implementation, backend or frontend. **P1-E3-S6 (Operations Trip Detail) reconfirmed the Companion, reference-code, and Trip Type rows below as still open** — none was resolved or implemented, each was simply omitted from the real screen (ZD-148, ZD-149) rather than left unaddressed. **P1-E3-S7 (Internal New Trip) reconfirmed the same three rows, plus the "Organization/Facility" requester field row** — omitted from the real New Trip form for the identical reason (no schema field exists to receive it as a `create_trip` parameter; see new-trip-data-map.md §7).

| Concept | Screens | What's missing |
|---|---|---|
| **Running Late threshold** | 01, 03 | Inputs exist (`scheduled_pickup_at`, state, `now()`); the minutes-past-schedule threshold is undefined |
| **"Potential timing conflict" / CONFLICT** | 03 | No formula defined for what makes two assignments "conflicting" |
| **"Pending Confirmation"** | 01, 03 | No domain concept matches this at all — needs a product definition before it can even be assigned a data source |
| **"Pickup updated from X" change tracking** | 06, 07 | Needs a decision on whether/how field-level change history should be tracked and to whom it's visible, before any schema work |
| **Companion field** | 02, 04 | Needs a decision on whether this becomes a real schema field (and on which entity — Trip snapshot, matching `assistance_notes`'s pattern, is the natural fit) |
| **Human-readable Trip/Request reference codes** ("ZW-240829-018", "ZR-240829-104", "FAC-23981") | 02, 05 | No such field exists; needs a decision on format and generation (stored vs. computed) before implementation |
| **Trip Type / structured pickup-destination fields** | 02 | Whether `pickup_description`/`destination_description` remain single free-text fields (display-formatted) or become structured (name + address) is a product/schema decision, not just a display one |
| **"Organization/Facility" requester field** | 05 | No dedicated column exists on `transportation_requests` for this — decide whether it's free text (reuse `requester_name`/`additional_notes`) or a real `facilities` link |
| **Multi-org UX (org switcher)** | none directly, but implied by Membership architecture | See application-route-map.md — the smallest-safe approach (`/select-organization`) was already built in an earlier phase. **P1-E3-S8B1 update:** a multi-org user previously had no way BACK to `/select-organization` once inside Operations except typing the URL directly — the new `AccountMenu`'s conditional "Switch Organization" item (rendered only when `getActiveMemberships()` genuinely returns >1) closes that specific navigational gap. A richer IN-PLACE switcher (changing context without a full re-selection screen) remains the still-open, still-undecided future enhancement — not attempted here. |

None of these are proposed to be resolved in this phase, per explicit instruction (work item §50).
