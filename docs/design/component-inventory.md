# Zenward Platform — Component Inventory

**Work item:** P1-E3-S0 — Stitch UI Ingestion & Implementation Mapping, amended by P1-E3-S2 — Driver Application Shell & Driver Today, P1-E3-S3 — Driver Trips & Active Trip Experience, P1-E3-S4 — Operations Application Shell & Today's Operations, P1-E3-S5 — Dispatch Board, and P1-E3-S6 — Operations Trip Detail (components below actually built/refined)
**Status:** P1-E3-S0 itself was planning/documentation only. P1-E3-S2 implemented Driver Today and the shared Driver shell; P1-E3-S3 implemented Driver Trips, Trip Detail/Active Trip, and Driver History; P1-E3-S4 implemented the real Today's Operations screen and refined the Operations shell; P1-E3-S5 implemented the real Dispatch Board; P1-E3-S6 implemented the real Operations Trip Detail screen — see "Driver components — P1-E3-S2", "Driver components — P1-E3-S3", "Operations components — P1-E3-S4", "Dispatch components — P1-E3-S5", and "Trip Detail components — P1-E3-S6" below.
**Last updated:** 2026-10-20 (NP-UI-P1a section added)

Reconciles the Stitch references (docs/design/stitch/references/) against the component library that **already exists** in `src/components/` (built during P0-E2-S3/S3A) rather than proposing an inventory from scratch. Confirmed by direct inspection: the existing `TRIP_STATUS_MAP`/`DRIVER_STATUS_MAP` in `TripStatus.tsx`/`DriverStatus.tsx` already anticipate the exact labels seen in these references (`Requested`, `Pending Confirmation`, `Needs Assignment`, `Available`, `On Trip`, `Break`, `Unavailable`) — the primitive layer is well-aligned; this phase's job is identifying the screen/feature-level composition still needed on top of it.

## Existing primitives (confirmed present, not modified)

| Component | Purpose | Screens using it (per this reference batch) |
|---|---|---|
| `OperationsShell`, `OperationsSidebar`, `AppHeader` | Operations desktop chrome | All 4 Operations screens (01, 02, 03, 05) |
| `PageHeader` | Title + description (+ breadcrumb slot) | 02, 05 (breadcrumb variant) |
| `Breadcrumb` | Trail navigation | 02, 05 |
| `Panel` | Standard bordered content grouping | All Operations screens |
| `SummaryStrip` | Metric row (label/value/tone) | 01, 03 |
| `StatusBadge` (+ `TripStatus`, `DriverStatus` label maps) | Semantic status pill | All screens with any status label |
| `DataTable` | Column-defined tabular list | 01 (Needs Attention, Upcoming Trips) |
| `DefinitionList` | Label/value grid | 02 (info strip, Passenger & Trip Information) |
| `AttentionState` | Warning/critical callout | 01 (Needs Attention header), 03, 05 (Needs Attention rail) |
| `EmptyState` | No-data placeholder | 02 (Trip Exceptions "No open exceptions") |
| `Avatar` | User/driver photo | All screens (header avatar), 03 (driver capacity cards) |
| `Button`, `IconButton`, `LinkButton` | Actions | Throughout |
| `Input`, `SearchInput`, `Select`, `Textarea` | Form fields | 05 |
| `DriverTripCard`, `DriverTripRow` | Compact/featured trip card | 06, 07 |
| `DriverPrimaryAction` | Full-width dominant CTA | 04 |
| `DriverRoute` | Two-point pickup→destination indicator | 04, 06, 07 |
| `DriverInstruction` | Inline advisory note | 04, 06 ("Call passenger on arrival") |

## New components needed (Stitch-driven, not yet built)

| Component | Purpose | Screens | Responsive behavior | Design-system dependencies |
|---|---|---|---|---|
| `MetricCard` (vs. `SummaryStrip` item) | 01's summary items are closer to a horizontal stat row than discrete cards — **confirm which pattern before building**; `SummaryStrip` may already suffice. Flagged for design review, not a confirmed new component. | 01, 03 | — | Existing `SummaryStrip` may cover this — verify before adding |
| `TripListTable` (a `DataTable` composition, not a new primitive) | Named column configuration for the two distinct table shapes on 01 (Needs Attention vs. Upcoming Trips have different columns) | 01 | Desktop only | `DataTable` |
| ~~`DispatchAssignmentGrid`~~ | **Built P1-E3-S5** as `AssignmentGrid` — see "Dispatch components" below | 03 | Desktop/tablet only — no mobile equivalent is implied or required | Built without a new generic primitive; composes `Panel`/`EmptyState` |
| ~~`DispatchQueueCard`~~ | **Built P1-E3-S5** inline within `NeedsAssignmentQueue` (no separate card component — one usage, not worth abstracting yet) | 03 | Desktop | Composes `Panel`, `TripStatus`, `Button` |
| ~~`DriverCapacityCard`~~ | **Built P1-E3-S5** inline within `DriverCapacityPanel` | 03 | Desktop | Composes `Avatar`, `StatusBadge` (not `DriverStatus` — see Dispatch components note on why) |
| ~~`TripRouteTimeline`~~ | **Built P1-E3-S6** as `TripRoutePanel` | 02 (Operations variant, richer than `DriverRoute`) | Desktop | Built without a new generic primitive — composes `Panel`; dot-line-dot metaphor matches `DriverRoute`'s own established pattern |
| ~~`TripCurrentStatusCard`~~ | **Built P1-E3-S6** as `CurrentStatusPanel` | 02 | Desktop | Composes `Panel`, `DefinitionList`, `LinkButton` (the assignment-management entry point, work item §18) |
| ~~`TripNoteList`~~ | **Built P1-E3-S6** as `TripNotesPanel` + `AddNoteDialog` | 02 | Desktop (Driver's note surface is simpler — see `DriverInstruction`, already covers the read-only display case) | Write action ("Add Note") is a direct-table INSERT as anticipated, via a real Server Action — no RPC |
| ~~`ExceptionBadge`~~ / exception panel | **Built P1-E3-S6** as `TripExceptionsPanel` | 02, 04 | Both | `EmptyState` covers the empty case; the populated-list case shows real `trip_exceptions` rows. "Report Issue" rendered disabled — deferred (ZD-151) |
| `RequestSourceSelector` | Segmented radio-card group (Passenger/Family-Caregiver/Healthcare Facility/Other) | 05 | Desktop | New — no existing radio-card component |
| `PassengerPicker` | Search/typeahead + selected-passenger chip + "Add New Passenger" | 05 | Desktop | Composes `SearchInput` |
| `ChangeNoticeBadge` | "Pickup updated from X" advisory | 06, 07 | Mobile | New, small — **blocked on the underlying change-tracking gap** (see gap register); component shape can be designed, but has no real data source yet |
| Org switcher (minimal, unstyled) | Multi-org context resolution | Not in any reference | Both | Deferred per route-map §Multi-org UX — build only the minimal functional version when actually needed, not a designed component now |

## Driver components — P1-E3-S2

Reused/refined the existing Driver primitives rather than rebuilding them (work item §7) — only `DriverNextTripCard` is genuinely new:

| Component | Status | Change |
|---|---|---|
| `DriverShell` | Refined (P1-E3-S2, further refined P1-E3-S2B) | Inner column capped at `max-w-md`, centered — keeps the Driver surface compact at tablet/desktop widths (ZD-115). `max-w-md` computed to 16px, not 448px, until P1-E3-S2B fixed a project-wide Tailwind theme-token collision (ZD-117); P1-E3-S2B also added a `sm:` border matching the design system's established panel convention (ZD-118). Real screenshots: `docs/design/qa/driver-today/`. |
| `DriverHeader` | Refined | Added an optional `driverName` identity subtitle (real data, replaces any notion of a fabricated "On Shift" status) and top safe-area-inset padding |
| `DriverLayoutClient` | Refined | Passes `driverName` through; adds a leading avatar (swapped for the existing back-button on a trip-detail route) and a trailing sign-out affordance reusing the existing `signOutAction` |
| `DriverBottomNavigation` | Refined | Added bottom safe-area-inset padding |
| `DriverRoute` | Refined | Added an optional `appointmentLabel` suffix on the Destination line |
| `DriverTripCard` | Refined | Denser row treatment matching the Stitch reference (time+name on one line, single arrow-joined route line, optional appointment caption); prop shape kept stable — the existing `/foundation` showcase call site is unaffected |
| `DriverNextTripCard` | **New** | The featured "Next Trip" card — composes `DriverRoute` + a `LinkButton` "View Trip" CTA. Deliberately carries no Navigate/Call Passenger actions (ZD-114) |
| `DriverTripRow`, `DriverInstruction`, `DriverPrimaryAction` | Unchanged | Not used by Driver Today this phase — `DriverInstruction`'s "Call passenger on arrival" pattern and `DriverPrimaryAction`'s single-CTA rule remain available for the Active Trip screen |

Full field-level rationale: [driver-today-data-map.md](../product/driver-today-data-map.md).

## Driver components — P1-E3-S3

| Component | Status | Change |
|---|---|---|
| `DriverNextTripCard`, `DriverTripCard` | Reused unchanged | Same components Driver Today already built, now also driving the featured/compact rows on Driver Trips — no Trips-specific fork was created |
| `DriverActiveTripLegs` | **New** | The two-leg pickup/drop-off block for Active Trip — extends the existing dot-line-dot metaphor (`DriverRoute`) into a richer, per-leg display with contextual Navigate/Call Passenger actions attached to whichever leg is currently live (`currentLeg()`) |
| `DriverLifecycleAction` | **New** | The one primary progression button — a real `<form>` + Server Action (`useActionState`), matching `SignInForm`'s established pattern. Disables immediately on submit, never optimistically advances state, refreshes authoritative data on both success and error |
| `DriverInstruction` | Reused unchanged | Now actually used — renders each `driver_notes` entry on Active Trip, exactly the pattern this component was originally built for in P1-E3-S2 but had no call site yet |
| `DefinitionList` | Reused unchanged | The Passenger Requirements card (Assistance/Instructions) |

Full field-level rationale: [driver-trips-data-map.md](../product/driver-trips-data-map.md), [driver-active-trip-data-map.md](../product/driver-active-trip-data-map.md).

## Operations components — P1-E3-S4

| Component | Status | Change |
|---|---|---|
| `AppHeader` | Refined | Added optional `title`/`description` (a screen's own persistent-chrome title/date, matching the reference's composition — the title lives in the sticky header, not the scrollable `PageHeader` below it) and `avatarName` (real resolved identity), alongside the existing `contextLabel` fallback used by every not-yet-built Operations route. Added a "?" Help icon next to the existing bell — bare icon, no fabricated data, same convention as the bell itself. |
| `OperationsLayoutClient` | Refined | Builds the Overview route's richer header (title/date/search/Export/New-Trip cluster) itself, from data it already has (`organization.organizationTimezone`) plus static content — no new cross-tree state channel introduced merely for one route (see decision-register.md ZD-129). Now resolves a real `user_profiles.display_name` (via the new `getDisplayName()`) instead of passing the raw session email through as a "name". |
| `SummaryStrip` | Refined | Added an optional `inline` layout (single flowing row, dot + bold value + label, matching the reference's compact metric strip) and a per-item `dot` flag — additive, the original stacked value-over-label layout (`src/app/foundation`'s showcase usage, SummaryStrip's only other call site) is unchanged. |
| `todays-operations` query/presentation modules (`src/lib/operations/`) | **New** | `day-bounds.ts` (org-local "today" as a UTC range — the range-query counterpart to `trip-presentation.ts`'s single-instant timezone helpers), `presentation.ts` (Operations-specific status-label/event-label derivations — a distinct module from the Driver one; an Operations Trip can be genuinely unassigned, which a Driver never sees), `todays-operations.ts` (the three real queries, see [todays-operations-data-map.md](../product/todays-operations-data-map.md)). |
| `src/lib/auth/profile.ts` (`getDisplayName`) | **New** | Real `user_profiles.display_name` resolution with an email fallback — used by Operations this phase; available to any future surface needing the same real-identity lookup. |
| `TripStatus`, `DataTable`, `Panel`, `SectionHeader`, `EmptyState`, `StatusBadge` | Reused unchanged | Every label `operationsTripStatusLabel`/the literal `"Needs Assignment"` produces was already anticipated by `TRIP_STATUS_MAP` before this phase's code was written (confirmed at the top of this document) — no new status-badge component needed. |

Full field-level rationale: [todays-operations-data-map.md](../product/todays-operations-data-map.md).

## Dispatch components — P1-E3-S5

| Component | Status | Change |
|---|---|---|
| `Dialog` (`src/components/ui/Dialog.tsx`) | **New shared primitive** | The first Dialog/Modal in the design system — built on the native `<dialog>` element (`showModal()`, native focus trap, ESC via the `close` event) rather than a new UI library (work item §53). Backdrop dimming is one explicit `dialog::backdrop` rule in `globals.css` (native backdrops are transparent by default). Reusable by any future modal need, not Dispatch-specific. |
| `NeedsAssignmentQueue` | **New** | The left-column card queue — real Needs-Assignment Trips only (no Running Late/Pending Confirmation, matching Today's Operations' ZD-130 precedent). Composes `Panel`/`TripStatus`/`Button`, not a new card primitive (single usage). |
| `AssignmentGrid` | **New** | The center "Today's Assignments" time-axis grid — one row per active Driver, Trip blocks positioned by real `scheduled_pickup_at` via `src/lib/operations/dispatch-grid.ts`'s pure positioning math. Click a block to open the reassignment dialog — no drag-and-drop (ZD-138). |
| `DriverCapacityPanel` | **New** | The right-column rail — real `On Trip` badge only (`StatusBadge`, not the existing `DriverStatus` component: `DriverStatus`'s own `DRIVER_STATUS_MAP` still encodes the full illustrative Available/On Trip/Break/Unavailable set from the original Stitch-ingestion mockup pass, which this phase deliberately does NOT build against real data — reusing it here would risk a future edit to that map silently reintroducing a fabricated status through this screen). |
| `AssignmentDialog` | **New** | The one Assign/Reassign form, built on `Dialog` — real `<form>` + Server Action (`useActionState`), mirrors `DriverLifecycleAction`'s established pattern exactly. Mounted only while active (keyed by trip id + mode) so its action state is always fresh. |
| `DispatchBoardClient` | **New** | Client orchestrator — holds only which dialog is open; every other value is server-fetched (work item §40, no `useEffect` fetch-after-mount). |
| `TripStatus`, `Panel`, `EmptyState`, `Avatar`, `Select`, `Textarea`, `Button` | Reused unchanged | No new status-badge or form-field primitive was needed — every label `operationsTripStatusLabel` produces was already anticipated by `TRIP_STATUS_MAP` before this phase. |

Full field-level rationale: [dispatch-board-data-map.md](../product/dispatch-board-data-map.md).

## Trip Detail components — P1-E3-S6

| Component | Status | Change |
|---|---|---|
| `TripRoutePanel` | **New** | Dot-line-dot metaphor (matches `DriverRoute`), richer per-stop detail: time badge, the Trip's own address snapshot, optional Facility annotation, and `trip.instructions` as an inline callout under Pickup. |
| `PassengerInfoPanel` | **New** | Real fields only — Passenger name/phone, Requester (when linked), Assistance Requirements (Trip-level snapshot only, ZD-149). Trip Type/Reference/Companion all omitted (ZD-148, fabricated concepts). |
| `TripInfoStrip` | **New** | The 5-column at-a-glance strip — a bespoke layout, not built on `DefinitionList` (which only supports 1/2 columns) for a genuinely one-off use. |
| `CurrentStatusPanel` | **New** | Right-rail status summary + the assignment-management entry point (a generic link to `/operations/dispatch`, labeled "Assign Driver"/"Manage Assignment" — work item §18, no second assignment mutation implementation). |
| `TripExceptionsPanel` | **New** | Real open `trip_exceptions` rows; "Report Issue" rendered disabled (ZD-151, mirrors the Driver-side ZD-125 deferral). |
| `TripNotesPanel` + `AddNoteDialog` | **New** | Real `trip_notes` display (both visibilities) + a real, working "Add Note" — a direct RLS-protected INSERT via a Server Action, not an RPC. Author identity deliberately not resolved (matches Today's Operations' Activity Log precedent). |
| `CancelTripDialog`, `NoShowDialog` | **New** | Built on the shared `Dialog` primitive (P1-E3-S5), mirroring `AssignmentDialog`'s established Server-Action pattern exactly — real `cancel_trip`/`record_no_show` RPCs, explicit reason required, deliberate confirm click. |
| `TripDetailActionBar` | **New** | Client orchestrator for which dialog is open + the action button cluster — direct labeled buttons instead of a "More" overflow menu (ZD-147, no dropdown-menu primitive exists yet). |
| `TripStatus`, `Panel`, `DefinitionList`, `EmptyState`, `StatusBadge`, `Dialog`, `Select`, `Textarea`, `Button` | Reused unchanged | No new status-badge, form-field, or dialog primitive was needed. |

Full field-level rationale: [operations-trip-detail-data-map.md](../product/operations-trip-detail-data-map.md).

## New Trip components — P1-E3-S7

| Component | Status | Change |
|---|---|---|
| `FormSection` | **New** | The card-panel + icon + bold-title header pattern the reference establishes for "Request Source"/"Passenger", extended here to the Schedule/Pickup/Destination/Instructions & Assistance sections the reference's own composition doesn't show (see the data map). |
| `NewTripForm` | **New** | The one controlled client orchestrator — real `<form>` + Server Action (`useActionState`), holds Facility-select-populates-address and Request-Import cross-field state, plus the double-submit guard (create_trip is non-idempotent, ZD-102). |
| `AddPassengerDialog` | **New** | Built on the shared `Dialog` primitive, mirrors `AddNoteDialog`'s real-RLS-INSERT pattern exactly — never `router.refresh()`s (would risk clearing an in-progress form); hands the created Passenger back to the parent form directly. |
| `AttentionState` (`src/components/ui/AttentionState.tsx`) | **Extended** | Added an `info` level (calm, non-alarming — for "you'll assign a driver after creating this trip") using the existing `--color-info-*` tokens, already defined in `globals.css` for `StatusBadge`'s `informational` category but unused by `AttentionState` until now. `warning`/`critical` unchanged. |
| `Select` (`src/components/ui/Select.tsx`) | **Fixed (real bug)** | Found via this phase's own real browser testing: `Select` unconditionally set `defaultValue` whenever a `placeholder` was given, even when the caller also passed a controlled `value` — React's "must be either controlled or uncontrolled" warning, the first genuinely NEW usage pattern (a controlled `Select` with a placeholder) to exercise this latent defect. Fixed to only set `defaultValue` when the caller hasn't passed `value` — benefits any future controlled-`Select`-with-placeholder usage. |
| `Dialog`, `Select`, `Input`, `Textarea`, `Button`, `LinkButton`, `Panel` | Reused unchanged | No new form-field primitive was needed beyond the `Select` fix above. |

Full field-level rationale: [new-trip-data-map.md](../product/new-trip-data-map.md).

## Driver location + live Dispatch components — P1-E3-S7A

| Component | Status | Change |
|---|---|---|
| `DriverLocationTracker` | **New** | Isolated geolocation side effects (permission state, `watchPosition` lifecycle, 20s submission throttle, cleanup, status display) — kept out of the Active Trip page component itself (work item §46). Found and fixed a real bug during this phase's own testing: an initial version treated every `watchPosition` error (including ordinary transient `POSITION_UNAVAILABLE`/`TIMEOUT` blips) as fatal and silently killed tracking for the rest of the Trip after the first one — corrected to only stop on `PERMISSION_DENIED`. |
| `DispatchLiveRefresh` | **New** | Realtime was evaluated and deliberately deferred this phase (could not be proven tenant-safe with real adversarial tests in the time available — "security beats animation"). Renders nothing; triggers `router.refresh()` every 20s, reusing the Dispatch Board's own already-proven re-fetch mechanism rather than a new data path. |
| `AssignmentGrid` | **Extended** | Each driver row now shows a real freshness indicator + external map link (`MapPin` icon, compact "Just now"/"N min ago"/"Stale" text, full wording in the `title` tooltip) for whichever of that Driver's Trips is currently in the tracking window — assignment-scoped (work item §51), never a stale former Driver's last-known position. |
| `AttentionState` `info` level | Reused (extended in P1-E3-S7) | No further change this phase. |

Full field-level rationale: [driver-location-architecture.md](../product/driver-location-architecture.md), [live-dispatch-location-data-map.md](../product/live-dispatch-location-data-map.md).

## Trip Assurance & operational exceptions components — P1-E3-S8

| Component | Status | Change |
|---|---|---|
| `Dialog` | **New (design-system primitive)** | The project's first modal — built on the native `<dialog>` element (`showModal()`), not a new UI library, per work item §53's caution against introducing a heavyweight dependency for one modal. Real focus trap and top-layer stacking come from the platform, not custom JS; ESC/backdrop-click both close via the native `close`/`cancel` events, keeping React state and DOM state from drifting apart. |
| `ReportIssueDialog` | **New** | Issue Type (Select, 7-value restrained list) + Description (Textarea, required). Replaces the previously honestly-disabled "Report Issue" button on Trip Detail (deferred since P1-E3-S6). |
| `ResolveExceptionDialog` | **New** | Optional resolution-note Textarea. Replaces the previously honestly-disabled "Resolve" affordance. |
| `TripExceptionsPanel` | **Extended → `"use client"`** | Was a static, always-empty-looking panel; now shows real open exceptions with a working per-row "Resolve" action and a working "Report Issue" action, and a calm, explicit empty state ("No open exceptions") when none exist — no redesign of the surrounding Trip Detail screen. |
| Today's Operations "Needs Attention" table | **Rewritten** | Was narrow (unassigned-only). Now a real attention queue: one row per Trip needing attention, its single deterministically-prioritized primary reason (Open issue / Needs assignment / Location needs update / Location unavailable) as a `StatusBadge`, and a real destination action (Assign → Dispatch for `NEEDS_ASSIGNMENT`, Open Trip → Trip Detail otherwise) — never a generic "Review" link. |
| `AssignmentGrid` | **Extended again** | A small warning-tone dot marker (non-color-only — also carries an aria-label suffix, "— has an open issue") now appears on a Trip block with an open exception, alongside the existing freshness indicator from P1-E3-S7A. |
| `StatusBadge` | Reused, no code change | Every active assurance condition maps to the same existing amber "warning" tone (`assuranceStatusCategory()`) — no new visual tier added, per the calm/clinical mandate (ZD-174). |

Full field-level rationale: [trip-assurance-model.md](../product/trip-assurance-model.md), [trip-assurance-data-map.md](../product/trip-assurance-data-map.md).

## UI/UX design convergence components — P1-E3-S8B

Full audit and before/after evidence: [ui-convergence-audit.md](./ui-convergence-audit.md). Canonical pattern reference: [zenward-ui-system.md](./zenward-ui-system.md).

| Component | Status | Change |
|---|---|---|
| `OperationsSidebar` | **Rewritten (visual only)** | Converges to the canonical Stitch references' dark Care Navy treatment (every prior phase left it light — an accepted-but-unconverged deviation this phase's own mandate exists to close). New `--color-navy-*` token set added to `globals.css`, reserved for this component alone. Logo asset unchanged; wrapped in a plain white badge chip since the PNG itself has an opaque white background baked in (no alpha channel, confirmed by direct inspection) — the artwork is never recolored. |
| `Combobox` | **New (design-system primitive)** | A real, accessible search-select — WAI-ARIA "combobox with list autocomplete" pattern, replacing the temporary native `<select>` P1-E3-S7 used for New Trip's Passenger field (work item §20/§21, the single most consequential remaining item this audit identified). Keyboard Up/Down/Home/End/Enter/Escape, `aria-activedescendant`-tracked highlighting (DOM focus stays on the input), a real empty state, search matches name or phone. Represents only the "searching" state — callers render their own selected-item treatment. |
| `NewTripForm` | **Extended** | Passenger field now uses `Combobox`; on selection renders a reference-matching selected-passenger card (Avatar initials + name + phone + a Remove `IconButton`) via a hidden form field, not a visible `<select>`. |
| `AssignmentGrid` | **Extended again** | `ROW_LABEL_WIDTH_PX` widened 140→168px (real driver names + vehicle + freshness link were truncating); every truncatable label in this component and `DriverCapacityPanel` now carries a real `title` fallback. Trip-block width deliberately left unchanged — widening it would misrepresent elapsed Trip duration more than the existing fixed-width approximation already does (a documented tradeoff, `dispatch-grid.ts`). |
| Dispatch summary strip | **Extended** | A 4th, conditional (only shown when >0) "need attention" metric, reusing the exception data `getDispatchBoardData` already fetches for the per-block marker — no new query. |
| Driver Trips date grouping | **Bug fix** | A real bug found during reference comparison: the featured (first-scheduled) trip was pulled out of the day-grouping loop entirely, producing a SECOND, duplicate "Today" header whenever another trip shared its date. Fixed to group every scheduled trip (including the featured one) by calendar day first, then render the featured card inside its own group's single shared header. |
| `DriverReportIssueButton` / `DriverReportIssueDialog` | **New** | Driver-facing "Report Issue" (work item §37) — the reference shows a clear, natural affordance here, and the backend (post-P1-E3-S8A hardening: current-assignment-only, non-terminal-only) now safely supports exactly this scope. Same `report_trip_exception` RPC and the same restrained 7-value issue-type list as the Operations dialog (now shared from `trip-exception-errors.ts` rather than duplicated a third time). No Driver resolve path, no broad exception read — write-only, matching the work item's explicit condition. |

Full field-level rationale and the complete FIXED/JUSTIFIED/DEFERRED disposition of every finding: [ui-convergence-audit.md](./ui-convergence-audit.md).

## Operations surface completion & navigation closure — P1-E3-S8B1

Full rationale: [operations-surface-map.md](../product/operations-surface-map.md), [operations-navigation-truthfulness-audit.md](../product/operations-navigation-truthfulness-audit.md).

| Component | Status | Change |
|---|---|---|
| `/operations/trips` | **Rewritten** | Was a "Structural placeholder." Now the canonical Trip inventory — `getTripsList()` (new query module: server-side search/date/assignment filters, bounded pagination), `DataTable`, a filter `<form method="get">` (plain HTTP, no client JS needed). |
| `/operations/passengers` | **Rewritten** | Was a placeholder. Now a real Passenger directory — `getPassengersList()` (new), plus `AddPassengerButton` (new thin client wrapper reusing the EXISTING `AddPassengerDialog`/`addPassengerAction` from New Trip, not a second implementation). |
| `/operations/facilities` | **Rewritten** | Was a placeholder. Now a real, read-only Facility directory — `getFacilitiesList()` (new). |
| `/operations/drivers` | **Rewritten** | Was a placeholder. Now a real, read-only Driver directory — `getDriversList()` (new) — a real current-trip fact, never a fabricated "Available" status (GAP-6, still open). |
| `/operations/fleet` | **Rewritten** | Was a placeholder. Now a real, read-only Fleet directory — `getVehiclesList()` (new). |
| `OperationsSidebar` | **Extended again** | `NAV_ITEMS` reduced from 9 to 7 (Billing/Reports removed — real routes remain on disk, unlinked); the broken `/operations/settings` link (a genuine 404, no route file exists) removed from the bottom rail entirely. |
| `AccountMenu` | **New** | Replaces the previously non-interactive top-right `<Avatar>`. A real WAI-ARIA menu-button pattern (keyboard open/close, `Escape`, click-outside, `aria-haspopup`/`aria-expanded`/`role="menu"`/`role="menuitem"`) showing the real organization name, real role, a conditional **Switch Organization** (only when `getActiveMemberships()` genuinely returns >1), and **Sign Out** — reusing the pre-existing, already-correct `signOutAction` (previously wired into the Driver header only). |
| `AppHeader` | **Extended** | Swapped the bare `<Avatar>` for `<AccountMenu>`; gained `organizationName`/`roleLabel`/`hasMultipleOrganizations` props threaded from `OperationsLayoutClient` → the Server Component `layout.tsx` (a real `getActiveMemberships()` call, not assumed). |

## UI foundations & accessibility — NP-UI-P1a (2026-10-20)

Canonical foundations ahead of the Concept B visual overhaul. No visual redesign; local primitives only (no component
library). Report: `docs/reports/NP-UI-P1a-foundations-implementation.txt`. Browser suite: `tests/e2e/ui-foundations/p1a.e2e.mjs`.

| Component / file | Status | What it provides |
|---|---|---|
| `--color-text-muted` (globals.css) | Refined | `text.subtle` #646a70 → #5f656b (U1, WCAG 1.4.3): ≥ 4.84:1 on every surface it is used on. Primitive palette unchanged. |
| `Dialog` | Refined | Focus returns to the invoking control on every close path (Escape, Cancel, Close X, backdrop, unmount after success) — U2, WCAG 2.4.3. New optional `returnFocusRef` for triggers that disappear after the action. Native `<dialog>` kept. |
| `DataTable` | Refined | Interactive rows expose a real control instead of a focusable `<tr>`: `navigableRows` (the row's own `a[data-row-link]` is the tab stop; a row click follows it) and `onRowClick` (primary cell becomes a `<button>`, optional `rowActionLabel`). Destinations unchanged. |
| `Skeleton`, `SkeletonText`, `SkeletonTable`, `PageSkeleton` | New | Loading placeholders; `PageSkeleton` announces "Loading…" once (role=status); no animation under reduced motion. |
| `PublicStateFrame`, `ShellStatePanel` (`RouteState.tsx`) | New | Branded not-found / error presentation (canonical `nemryn-logo-primary.svg`; in-shell variant). Never shows internal error text — only the opaque digest. |
| `Checkbox`, `RadioGroup` (list / card), `Switch` | New | Native inputs / `role=switch`; label, description, error wiring. Not yet adopted by existing forms (later phases). |
| `Tabs`, `SegmentedControl` | New | WAI-ARIA tabs (roving tab stop, arrows / Home / End, disabled skipped) and a radio-semantics segmented control. URL filters should stay links. |
| `Menu`, `Popover` | New | Menu button pattern (arrows, typeahead, Escape returns focus, outside click closes) and a non-modal disclosure popover. The existing header menus are not migrated yet. |
| `Tooltip` | New | Hover + focus, Escape, aria-describedby; supplementary text only. |
| `Pagination` | New | URL-driven `<nav aria-label="Pagination">` with aria-current; not yet adopted by list pages. |
| `src/lib/ui/ui-core.ts` | New | Pure keyboard-index / pagination / typeahead helpers (unit-tested). |
| `PrimitivesShowcase` (on `/foundation`) | New | Internal QA harness section + Dialog focus test bench (fictional content). |
| Route states | New | `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `operations/{loading,error,not-found}.tsx`, `operations/[...missing]` (in-shell 404), `driver/{loading,error}.tsx`. |

## Explicitly not building generically

Per work item §35's own caution: no generic "Card" or "ListItem" abstraction is proposed merely for reuse. `DispatchQueueCard`, `DriverCapacityCard`, `TripRouteTimeline`, etc. are each named for what they specifically show, following the existing codebase's own pattern (`DriverTripCard`, not a generic `Card`).
