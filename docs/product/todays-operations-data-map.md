# Today's Operations — Data Map

**Work item:** P1-E3-S4 — Operations Application Shell & Today's Operations
**Reference:** [docs/design/stitch/references/01-todays-operations.png](../design/stitch/references/01-todays-operations.png) — canonical visual specification, not loose inspiration.
**Status:** Implemented — `src/app/operations/page.tsx`, `src/lib/operations/todays-operations.ts`, `src/lib/operations/presentation.ts`, `src/lib/operations/day-bounds.ts`.

Every value on the screen traces to a real column/RLS-scoped query. Nothing on this page is sample/mock text — see the field-by-field breakdown below, and the omissions section for what the reference shows that this phase deliberately does not build.

## Query architecture

Three real, org-scoped, explicit-column queries (`getTodaysOperations()`), not one speculative aggregate RPC (GAP-8, ui-backend-gap-register.md, explicitly recommends against building one until real usage shows a need):

1. **Today's trips** — `trips` filtered by `scheduled_pickup_at` within the organization's own local "today" (`organizationDayBoundsUtc()`, `src/lib/operations/day-bounds.ts` — the same `Intl`-offset technique as `operationalDateKey`/P1-E3-S2C, extended to a `[start, end)` UTC range for a real `gte`/`lt` filter instead of a single-instant comparison). Embeds `passengers(display_name)` and `trip_assignments(ended_at, drivers(display_name), vehicles(label))` via the confirmed composite-FK relationships. Feeds Needs Attention, Upcoming Trips, and the Completed-Today subset.
2. **Active trips** — `trips` filtered by `state in (5 non-terminal states)`, **deliberately NOT bounded to today's window**: an in-progress Trip is happening right now by construction; bounding it to "scheduled for today" would incorrectly hide a running-late Trip whose `scheduled_pickup_at` technically fell on the prior org-local day. Feeds the Active Trips panel and the "active" summary metric.
3. **Today's activity** — `trip_events` filtered by `occurred_at` within the same org-local day bounds, embedding `trips(passengers(display_name))`, ordered `occurred_at desc`, limited to 20. Feeds the Activity Log.

Every query is explicitly filtered by `organization_id` in addition to relying on RLS (`trips_select_org_operations`, `trip_assignments_select_org_operations`, `trip_events_select_org_operations`, `drivers_select_org_operations`, `vehicles_select_org_operations`, `passengers_select_org_operations`) — the same defense-in-depth convention `getActiveMemberships()` already established (never relying on RLS alone to narrow a query it's easy to write explicitly).

## Field-by-field

| Screen element | Source | Notes |
|---|---|---|
| "24 trips today" | `todayTrips.length` (query 1) | **P1-E3-S8C1:** counts EVERY trip scheduled today regardless of state — completed, cancelled, and no-show trips are all included. This is a deliberately different scope than Dispatch's own "open trips today" (`dispatch-board-data-map.md`), which excludes terminal-state trips — the two screens use different labels for exactly this reason, not by oversight. |
| "6 active" | `activeTrips.length` (query 2) | Not bounded to today — see above. |
| "3 need attention" | `needsAssignmentTrips.length` — subset of query 1 where `state='scheduled'` and no active assignment | |
| "3 completed" | `completedTodayTrips.length` — subset of query 1 where `state='completed'` | A documented simplification (work item's own plan): not a separate `completed_at`-scoped query. |
| Needs Attention rows | `needsAssignmentTrips` | TIME/PASSENGER/ROUTE (`pickup → destination`, free-text snapshot fields)/ISSUE (`Needs Assignment`, `TripStatus`)/ACTION (`Assign` → `/operations/dispatch`, generic — see Omissions). |
| Upcoming Trips rows | `todayTrips`, ordered by `scheduled_pickup_at` | TIME/PASSENGER/PICKUP/DESTINATION/DRIVER (`––` if unassigned)/VEHICLE (`––` if unassigned)/STATUS (`operationsTripStatusLabel`). |
| Active Trips rows | `activeTrips` | Passenger name, driver + vehicle subtitle, bare state label (`En Route`/`Arrived`/`Passenger Onboard`) — lifecycle-model.md §C's own sanctioned presentation simplification. |
| Activity Log rows | `activityLog` | Humanized `event_type` (`operationsEventLabel`, the trip_events CHECK constraint's full allow-listed vocabulary) + the trip's passenger name + `occurred_at` time. |
| "Today's Operations" / date | `AppHeader` `title`/`description`, computed client-side in `OperationsLayoutClient` from `organization.organizationTimezone` | Persistent-chrome title per the reference's own composition (title lives in the sticky header, not the scrollable PageHeader) — see decision-register.md ZD-129. |
| Sidebar/header identity (avatar, name) | `user_profiles.display_name`, live-resolved (`src/lib/auth/profile.ts`), falling back to email | **P1-E3-S8C1 update:** the QA fixture organizations (Org A/B, etc.) still have no `user_profiles` rows and genuinely exercise the fallback — that path remains real and tested. Harmony Medical Transport's own Operations-facing staff (`owner@`/`dispatch@harmonytransport.test`) now have real `user_profiles.display_name` rows (`supabase/seed.sql`) — the earlier state (a live buyer-facing email address rendered in the sidebar's name slot) was the actual root cause of the account-menu truncation the S8C commercial audit flagged; the sidebar/account-menu layout was also hardened independently (`OperationsSidebar.tsx`, `AccountMenu.tsx`) so any future long identity value still degrades gracefully rather than clipping badly. |

## Deliberately omitted this phase

- **Driver Availability panel** — entirely omitted (GAP-6, ui-backend-gap-register.md). Only "On Trip" is derivable from `trip_assignments`; the panel's whole value depends on the missing Available/Break/Unavailable taxonomy, which has no schema representation and remains its own deferred future work item.
- **Running Late / Pending Confirmation** — Needs Attention shows Needs-Assignment rows only. Neither of the other two reference statuses has a defined product rule (no threshold for "late", no domain concept for "Pending Confirmation" at all) — see ui-backend-gap-register.md "PRODUCT DECISIONS REQUIRED". Inventing either would be fabricated data, not a backend gap being worked around.
- **Assign is a generic link, not inline mutation** — `Assign` routes to `/operations/dispatch` (no deep-link parameter, since the Dispatch Board doesn't exist yet). `assign_trip`/`reassign_trip` are explicitly NOT wired into this screen per the work item, even though the backend already supports them.
- **Export Day Sheet** — ~~rendered `disabled` (GAP-9 — no backend export capability exists in any phase to date).~~ **Updated P1-PILOT-UX1 (ZD-205):** implemented. The header's Export Day Sheet menu exports today's Day Sheet as a printable view (`/day-sheet?day=today`) or a CSV (`/day-sheet/csv?day=today`), built from the same Dispatch working set for the organization-local day. GAP-9 is resolved.
- **Search** — ~~rendered as a real, disabled `<input>` (no wiring this phase — explicitly not part of this phase's mandate; disabled rather than a silently-inert control that looks live).~~ **Updated P1-PILOT-UX1 (ZD-205):** omitted from the header until search has real behavior. No disabled placeholder remains.
- **"Filter" control on Upcoming Trips** — omitted entirely rather than rendered as a non-functional affordance.
- **Activity Log actor identity** — shows the affected Trip's passenger, not the human actor (dispatcher/driver) who performed the action. `user_profiles` has zero seed data and no auto-provisioning trigger; resolving an actor's display name reliably would need a second, currently-unjustified cross-table lookup for informational value only. The reference's richer "Marcus Hall marked En Route / James Carter • Toyota Sienna 4" composition is a deliberate, documented simplification here.
- **No Realtime, no polling, no fake "LIVE" indicator** — this is a server-rendered snapshot, refreshed on navigation, exactly as scoped.

## Seed fixtures added this phase

`supabase/seed.sql` gained a second Org A vehicle (`Fictional Van A2`) and four new Org A trips anchored to the same org-local "today" concept the P1-E3-S2 Driver Today fixtures established, deliberately covering all four screen groupings with real, non-fabricated data: a Needs-Assignment trip (no assignment row), an Active trip (`en_route_to_pickup`, live assignment), a Completed-today trip (`completed`, ended assignment, `end_reason='trip_completed'` — mirrors exactly what `driver_complete_trip` itself produces), and a second Upcoming/assigned trip later in the day. A matching set of `trip_events` rows (real allow-listed `event_type` values, spread through the org-local morning) gives the Activity Log genuine chronological content.

**Related documents:** [component-inventory.md](../design/component-inventory.md) · [ui-backend-gap-register.md](./ui-backend-gap-register.md) · [decision-register.md](./decision-register.md) · [operational-timezone.md](./operational-timezone.md)
