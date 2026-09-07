# Zenward Mobility — Decision Register

**Work item:** P0-E1-S1 — Georgia Launch Decision Brief
**Status:** Draft, pending product review
**Last updated:** 2026-08-29

Allowed statuses: `CONFIRMED` · `PROVISIONAL` · `UNKNOWN` · `REJECTED` · `SUPERSEDED`

Where no rationale has been established yet, the Reason field states: *"Reason pending product validation."* No decision here should be treated as authorization to implement functionality — see [scope-register.md](./scope-register.md) for what is buildable.

---

### ZD-001 — Brand identity

- **Date:** 2026-08-29
- **Category:** Brand
- **Decision:** Product brand is "Zenward Mobility."
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, all customer-facing surfaces
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** Rebrand or trademark conflict discovered

### ZD-002 — Tagline

- **Date:** 2026-08-29
- **Category:** Brand
- **Decision:** Tagline is "Care that gets you there."
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, marketing materials
- **Dependencies:** ZD-001
- **Owner:** Product
- **Review Trigger:** Brand messaging review

### ZD-003 — Product category descriptor

- **Date:** 2026-08-29
- **Category:** Positioning
- **Decision:** Zenward is positioned as Non-Emergency Medical Transportation (NEMT).
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, licensing/compliance scope, driver ops
- **Dependencies:** ZD-008
- **Owner:** Product
- **Review Trigger:** Expansion into adjacent transport categories

### ZD-004 — Launch market

- **Date:** 2026-08-29
- **Category:** Market
- **Decision:** Initial launch market is Georgia, USA.
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Legal/licensing, service area, Operations Console
- **Dependencies:** ZD-016 (exact territory still unknown)
- **Owner:** Product
- **Review Trigger:** Multi-state expansion planning

### ZD-005 — Internal product thesis

- **Date:** 2026-08-29
- **Category:** Strategy
- **Decision:** "Zenward is building the operating system for dependable non-emergency medical transportation."
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** All — governs architecture ambition level
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** Strategic pivot

### ZD-006 — Customer proposition

- **Date:** 2026-08-29
- **Category:** Positioning
- **Decision:** "Book, coordinate, and track medical transportation with less uncertainty."
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Booking/Facility Experience
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** Messaging review

### ZD-007 — Primary operational domain entity

- **Date:** 2026-08-29
- **Category:** Architecture
- **Decision:** "Trip" is the primary business entity; Zenward is not modeled as a booking-form product.
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** All four product surfaces; core data model
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** Data model design work (not yet authorized)

### ZD-008 — Emergency transportation excluded from category

- **Date:** 2026-08-29
- **Category:** Scope
- **Decision:** Emergency medical transportation is explicitly outside the intended product category.
- **Status:** CONFIRMED
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Positioning, licensing, driver scope
- **Dependencies:** ZD-003
- **Owner:** Product
- **Review Trigger:** None anticipated

### ZD-009 — Initial customer groups

- **Date:** 2026-08-29
- **Category:** Market
- **Decision:** Initial customer groups may include healthcare facilities, private-pay customers, patients, and caregivers/families.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Booking/Facility Experience
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** Go-to-market plan finalization

### ZD-010 — Initial booking modes

- **Date:** 2026-08-29
- **Category:** Product
- **Decision:** Initial booking may support operator-assisted booking and digital transportation requests.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Operations Console, Booking/Facility Experience
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** MVP scope finalization

### ZD-011 — Initial driver product platform

- **Date:** 2026-08-29
- **Category:** Product
- **Decision:** Initial driver experience direction is mobile-first web/PWA (not native).
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Driver Experience
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** Driver UX research; native app cost-benefit review

### ZD-012 — Initial operations product platform

- **Date:** 2026-08-29
- **Category:** Product
- **Decision:** Initial operations product direction is a desktop-first Operations/Dispatch Console.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Operations / Dispatch Console
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** Dispatcher workflow research

### ZD-013 — Facility self-service booking and visibility

- **Date:** 2026-08-29
- **Category:** Product
- **Decision:** Healthcare facilities may eventually receive self-service booking and trip visibility.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Booking/Facility Experience
- **Dependencies:** ZD-009
- **Owner:** Product
- **Review Trigger:** Facility portal scope decision (explicitly not MVP by default — see scope register)

### ZD-014 — Compatibility with future Medicaid/broker integration

- **Date:** 2026-08-29
- **Category:** Architecture
- **Decision:** Architecture should avoid foreclosing future Medicaid or transportation-broker integrations, but these are not MVP dependencies.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Billing, Trip/Booking data model
- **Dependencies:** ZD-021, ZD-022, ZD-023
- **Owner:** Engineering
- **Review Trigger:** Payer strategy decision

### ZD-015 — Driver trip status progression

- **Date:** 2026-08-29
- **Category:** Product
- **Decision:** Provisional trip progression: Assigned → En Route → Arrived → Passenger Onboard → Drop-off → Completed.
- **Status:** PROVISIONAL
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Driver Experience, Operations Console, Trip domain model
- **Dependencies:** ZD-007
- **Owner:** Product
- **Review Trigger:** Driver workflow validation; must not be finalized without further review

### ZD-016 — Exact Georgia launch territory

- **Date:** 2026-08-29
- **Category:** Market
- **Decision:** Not yet determined — counties/cities served and service radius are unresolved.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Operations Console, licensing
- **Dependencies:** ZD-004
- **Owner:** Product
- **Review Trigger:** Launch territory decision by leadership

### ZD-017 — Operating hours and after-hours policy

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Operations Console, Public Website
- **Dependencies:** None
- **Owner:** Product / Operations
- **Review Trigger:** Operations policy definition

### ZD-018 — Fleet and vehicle model

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Fleet ownership model, vehicle types, ambulatory capability, wheelchair capability, and wheelchair vehicle specifications are not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Vehicle records, Driver Experience, Operations Console
- **Dependencies:** None
- **Owner:** Operations
- **Review Trigger:** Fleet strategy decision

### ZD-019 — Driver employment model

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Driver employment vs. contractor model not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Driver records, Driver Experience, legal/compliance
- **Dependencies:** ZD-025, ZD-026
- **Owner:** Operations / Legal
- **Review Trigger:** Labor model decision

### ZD-020 — Trip policy rules

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Minimum booking lead time, same-day booking rules, wait-time rules, cancellation rules, no-show rules, return-trip rules, and companion/caregiver rules are not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Trip domain model, Public Website, Booking/Facility Experience, Operations Console
- **Dependencies:** ZD-007
- **Owner:** Product / Operations
- **Review Trigger:** Operations policy definition

### ZD-021 — Pricing model

- **Date:** 2026-08-29
- **Category:** Commercial
- **Decision:** Pricing, mileage pricing, wait-time charges, facility contract pricing, and private-pay payment method are not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Billing records, Booking/Facility Experience
- **Dependencies:** None
- **Owner:** Product / Finance
- **Review Trigger:** Pricing strategy decision

### ZD-022 — Medicaid participation

- **Date:** 2026-08-29
- **Category:** Commercial / Compliance
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Billing, legal/compliance
- **Dependencies:** ZD-014
- **Owner:** Product / Legal
- **Review Trigger:** Payer strategy decision

### ZD-023 — Broker participation

- **Date:** 2026-08-29
- **Category:** Commercial
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Trip intake, Billing
- **Dependencies:** ZD-014
- **Owner:** Product
- **Review Trigger:** Payer strategy decision

### ZD-024 — Billing workflow

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Billing records, Operations Console
- **Dependencies:** ZD-021, ZD-022, ZD-023
- **Owner:** Product / Finance
- **Review Trigger:** Billing model design

### ZD-025 — Legal operating entity and insurance structure

- **Date:** 2026-08-29
- **Category:** Legal / Compliance
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Company formation, licensing, driver contracts
- **Dependencies:** None
- **Owner:** Legal
- **Review Trigger:** Entity formation decision

### ZD-026 — Licensing requirements

- **Date:** 2026-08-29
- **Category:** Legal / Compliance
- **Decision:** Georgia NEMT licensing requirements not yet documented.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Legal/compliance, launch readiness
- **Dependencies:** ZD-004, ZD-025
- **Owner:** Legal
- **Review Trigger:** Licensing research completion

### ZD-027 — Public contact information and domain

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Public contact information, production domain, and dispatch phone number not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Operations Console
- **Dependencies:** None
- **Owner:** Product / Operations
- **Review Trigger:** Launch readiness planning

### ZD-028 — Customer support model

- **Date:** 2026-08-29
- **Category:** Operations
- **Decision:** Not yet determined.
- **Status:** UNKNOWN
- **Reason:** Reason pending product validation.
- **Affected Product Areas:** Public Website, Operations Console
- **Dependencies:** None
- **Owner:** Operations
- **Review Trigger:** Support model decision

### ZD-029 — Route Teal brand anchor retained

- **Date:** 2026-08-29
- **Category:** Brand / Visual System
- **Decision:** The official Zenward brand teal remains `#21A89A` (`brand.route-teal`). It is retained for larger graphical treatments, selected indicators, decorative brand treatments, and any context where WCAG contrast is independently satisfied. It is not silently replaced elsewhere in the design system.
- **Status:** CONFIRMED
- **Reason:** Design review (P0-E2-S1 gate) confirmed the original brand anchor stays as-is; only its use in text-bearing/interactive contexts is constrained (see ZD-030).
- **Affected Product Areas:** Visual system, brand surfaces, marketing/illustrative UI
- **Dependencies:** ZD-030
- **Owner:** Design
- **Review Trigger:** Any proposal to change the brand teal hex itself

### ZD-030 — Interactive Teal approved

- **Date:** 2026-08-29
- **Category:** Brand / Visual System
- **Decision:** The accessibility-derived teal `#178577` (`interactive.teal`) is approved for use wherever stronger contrast is required, including buttons, links, interactive text, controls, and selected application states.
- **Status:** CONFIRMED
- **Reason:** `brand.route-teal` (`#21A89A`) measures 2.94:1 against white and fails WCAG AA as text/button-label color; `interactive.teal` measures 4.51:1 and passes. Design review approved formalizing the distinction rather than compromising either accessibility or the brand anchor.
- **Affected Product Areas:** Buttons, links, form controls, selected-state indicators across all four product surfaces
- **Dependencies:** ZD-029
- **Owner:** Design
- **Review Trigger:** Any change to either teal value, or a request to unify them into one token

### ZD-031 — Icon library direction

- **Date:** 2026-08-29
- **Category:** Visual System
- **Decision:** Phosphor Icons is the approved icon direction, primarily Regular and Medium weights. One coherent icon family; icons support comprehension rather than decoration; no default colored-circle icon treatment; no decorative icons beside every heading; no duotone styling throughout operational UI; icons are not used where clear text communicates better; sizing and visual weight stay consistent.
- **Status:** CONFIRMED
- **Reason:** Design review (P0-E2-S1 gate) approved this direction. The package has not been installed — this is a direction decision, not an implementation action.
- **Affected Product Areas:** All four product surfaces, wherever icons are eventually used
- **Dependencies:** None
- **Owner:** Design
- **Review Trigger:** Icon package installation (implementation phase)

### ZD-033 — Photography sourcing deferred

- **Date:** 2026-08-29
- **Category:** Brand / Visual System
- **Decision:** Photography sourcing remains unresolved. Photographic art direction will be established during the canonical public-site reference design, not during visual-system documentation. General requirements stand: realistic, dignified, human, healthcare-appropriate, transportation-relevant, no fabricated operational claims.
- **Status:** UNKNOWN
- **Reason:** Design review (P0-E2-S1 gate) explicitly deferred this rather than leaving it ambiguous.
- **Affected Product Areas:** Public Website
- **Dependencies:** None
- **Owner:** Design
- **Review Trigger:** Canonical public-site reference design work

### ZD-034 — Implementation stack

- **Date:** 2026-08-30
- **Category:** Engineering / Architecture
- **Decision:** The UI foundation is implemented in Next.js (App Router) with TypeScript, as a single application using route groups per surface (public site, `/ops`, `/driver`), styled with Tailwind CSS v4 using CSS-first (`@theme`) tokens rather than a JS config file or CSS Modules.
- **Status:** CONFIRMED
- **Reason:** No stack had been chosen previously — this was the first work item to write code. Next.js covers all three surfaces from one codebase (SSR for the public site's SEO needs, client-heavy rendering for console/driver) with the least setup overhead; confirmed directly with the user before scaffolding began rather than assumed.
- **Affected Product Areas:** All implementation work going forward
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A surface needing an independent deploy pipeline (would motivate splitting into a monorepo)

### ZD-035 — Trips nav icon substitution

- **Date:** 2026-08-30
- **Category:** Visual System / Implementation
- **Decision:** The Trips sidebar item uses the Phosphor `Path` icon rather than `Route`.
- **Status:** CONFIRMED (implementation detail; flagged for design review)
- **Reason:** The approved reference mapping specified `Route`, but the installed Phosphor Icons package (`@phosphor-icons/react`) has no icon by that name. `Path` was chosen as the closest official equivalent, per the instruction to substitute the nearest Phosphor icon when a named one doesn't exist.
- **Affected Product Areas:** Operations Console sidebar
- **Dependencies:** ZD-031
- **Owner:** Design
- **Review Trigger:** Design review of the icon mapping; revisit if a future Phosphor release adds a literal `Route` icon

### ZD-036 — Operations route namespace and component naming

- **Date:** 2026-08-30
- **Category:** Engineering / Architecture
- **Decision:** The operations surface's canonical route prefix is `/operations` (renamed from the temporary `/ops`, with no alias kept). The corresponding shell components were renamed to match the surface-prefixed pattern already used elsewhere: `AppShell` → `OperationsShell`, `Sidebar` → `OperationsSidebar`. `AppHeader` was kept unchanged. A `(public)` route group with a shared `PublicLayout` was added so `/`, `/request-transportation`, and `/healthcare-providers` share one header/footer instance instead of each page wrapping itself.
- **Status:** CONFIRMED
- **Reason:** `/ops` was a placeholder chosen during initial scaffolding, before the canonical route prefix had been confirmed; `/operations` is the intended long-term name, so it was corrected now rather than carried forward and renamed later once more routes/links depend on it.
- **Affected Product Areas:** Operations Console (all routes), Public Website
- **Dependencies:** ZD-034
- **Owner:** Engineering
- **Review Trigger:** None anticipated — this is the canonical namespace going forward

### ZD-037 — Operations narrow-width guard

- **Date:** 2026-08-30
- **Category:** Product / Engineering
- **Decision:** Below the operations console's supported width (below the `md` / 768px breakpoint), `OperationsShell` renders an intentional guard state ("Zenward Operations — This workspace is designed for tablet and desktop use.") instead of silently hiding the sidebar and leaving an unusable content pane. No mobile dispatcher interface, hamburger drawer, or second navigation system was built.
- **Status:** CONFIRMED
- **Reason:** The prior foundation pass hid the sidebar below `md` via CSS but left the header/content area rendering regardless, which is a broken, not merely unsupported, experience at phone widths. A guard state was the minimal correct fix without expanding scope into mobile ops UI, which remains out of scope.
- **Affected Product Areas:** Operations Console
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future decision to support phone-width dispatch use

### ZD-038 — RLS-first, deny-by-default tenant isolation

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Tenant isolation is enforced at the database layer via PostgreSQL/Supabase Row Level Security, never only in UI, route guards, or client-side checks. Every tenant-owned and system-owned table has RLS enabled in the same migration that creates it, starting from deny-by-default (zero policies = zero access).
- **Status:** CONFIRMED
- **Reason:** The system must remain secure even when the UI is bypassed (direct API calls, forged payloads, guessed UUIDs) — the only sound way to guarantee that is enforcement at the data layer itself.
- **Affected Product Areas:** All future schema, all future APIs
- **Dependencies:** None
- **Owner:** Engineering / Security
- **Review Trigger:** Any future migration touching a tenant-owned table (mandatory RLS review, see ZD-042)

### ZD-039 — Organization / Membership as the tenancy root

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** "Organization" is the canonical term for the tenant root (not "Workspace"). Tenant access is derived from a Membership table (user × organization × role × status), never from a single `users.organization_id` column, since a user may belong to more than one organization.
- **Status:** CONFIRMED
- **Reason:** A single organization_id on the user table cannot express multi-organization membership and would need to be redesigned the moment it's needed; the membership pattern costs nothing now and avoids that rework.
- **Affected Product Areas:** All tenant-owned schema, auth/session logic
- **Dependencies:** ZD-038
- **Owner:** Engineering
- **Review Trigger:** None anticipated — foundational naming/pattern

### ZD-040 — Direct organization_id on every tenant-owned table

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Every tenant-owned table (including Trip's child records — TripAssignment, TripEvent, TripNote, TripException) carries a direct `organization_id` column, denormalized where necessary, rather than relying on multi-hop joins (e.g., event → trip → assignment → driver → membership → organization) to reach the tenant key.
- **Status:** CONFIRMED
- **Reason:** Fragile join chains make RLS policies slow, hard to reason about, and easy to get subtly wrong; a direct column keeps every policy a single-hop check.
- **Affected Product Areas:** Trip, TripAssignment, TripEvent, TripNote, TripException, and all other tenant-owned tables
- **Dependencies:** ZD-038, ZD-039
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-041 — Composite foreign keys for tenant consistency

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Cross-tenant-relevant relationships (assignment→driver/vehicle/trip, trip→facility/passenger, event/note/exception→trip) will be enforced with composite foreign keys anchored on a unique `(id, organization_id)` per parent table, so a cross-tenant mismatch (e.g., a Trip in Org A referencing a Driver in Org B) is a schema-level impossibility, not something RLS alone is trusted to catch.
- **Status:** CONFIRMED (as the future implementation strategy — not yet built)
- **Reason:** Relational constraints reinforce RLS and catch mistakes RLS bugs or bypasses would otherwise let through; composite FKs are the simplest mechanism that achieves this without validation triggers.
- **Affected Product Areas:** Every tenant-owned child table's schema design
- **Dependencies:** ZD-040
- **Owner:** Engineering
- **Review Trigger:** Schema design (P1-E1-S2)

### ZD-042 — RLS and table creation happen together; isolation testing is a phase gate

- **Date:** 2026-08-30
- **Category:** Process / Security
- **Decision:** No table is created without its RLS policies in the same implementation stage — tables are never "secured later." No data-layer phase is considered complete until the cross-tenant adversarial test matrix (domain-model.md §O) passes.
- **Status:** CONFIRMED
- **Reason:** A tenant-owned table with no policies yet is a live data leak the moment it goes live, even briefly; making the test matrix a phase gate is the only way to guarantee this is actually verified, not assumed.
- **Affected Product Areas:** All future schema/data-layer work
- **Dependencies:** ZD-038
- **Owner:** Engineering / Security
- **Review Trigger:** Every future data-layer phase

### ZD-043 — Service-role credential boundary

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** The Supabase service-role credential exists only in trusted server-side code (route handlers, server actions, server components) — never in browser code, client bundles, the driver PWA, localStorage, frontend-readable cookies, or public (`NEXT_PUBLIC_`) environment variables.
- **Status:** CONFIRMED
- **Reason:** The service-role key bypasses RLS entirely; any client-side exposure defeats every other tenancy guarantee in this document at once.
- **Affected Product Areas:** All backend/API implementation
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Any code review touching Supabase client initialization

### ZD-044 — Public intake boundary for TransportationRequest

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Unauthenticated transportation-request submission is handled through a trusted server-side path (route handler / server action / controlled RPC) that validates input and assigns `organization_id` itself. No anonymous SELECT, UPDATE, or DELETE policy is ever created for TransportationRequest, and the client never supplies a trusted `organization_id` for the insert.
- **Status:** CONFIRMED
- **Reason:** An anon-insert RLS policy is the easy, wrong way to support public intake; it's a short step from an anon-insert policy to an accidental anon-select policy, and either allows enumeration/scraping of passenger-adjacent data.
- **Affected Product Areas:** Public request intake, TransportationRequest
- **Dependencies:** ZD-038, ZD-043
- **Owner:** Engineering / Security
- **Review Trigger:** Public intake implementation (P1 API design)

### ZD-045 — Trip domain separations: Request, Assignment, Event, Exception

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Four separations are confirmed as the canonical domain model: (1) TransportationRequest is a distinct entity from Trip, related 1:N, not consumed by Trip creation; (2) TripAssignment is a separate, append-only entity from Trip, not plain `driver_id`/`vehicle_id` columns; (3) TripEvent is separate from Trip's `current_state` field — Trip carries current state directly, TripEvent retains history; (4) TripException is separate from Trip status — exceptions coexist with, rather than replace, a normal trip state.
- **Status:** CONFIRMED
- **Reason:** Each separation was evaluated against a concrete requirement this domain must support (multiple trips per request, reassignment history, current-state performance, exceptions coexisting with normal status) and each requirement is real, not speculative.
- **Affected Product Areas:** Trip, TransportationRequest, TripAssignment, TripEvent, TripException schema design
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** Schema design (P1-E1-S2)

### ZD-046 — Driver/Passenger separated from auth identity

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Driver is an operational resource with an optional, nullable link to an auth user (`user_id`, `ON DELETE SET NULL`) — never merged with the auth identity. Passenger has no auth link at all in the current model; no passenger self-service login is assumed.
- **Status:** CONFIRMED
- **Reason:** Driver records and their assignment/trip history must remain valid even if login access is revoked or the linked auth account is deleted; Passenger accounts aren't part of any confirmed product scope.
- **Affected Product Areas:** Driver, Passenger schema design; driver auth flow
- **Dependencies:** ZD-039
- **Owner:** Engineering
- **Review Trigger:** Any future decision to add passenger self-service accounts (would need its own RLS review)

### ZD-047 — Location strategy: immutable snapshot, no generic Location table

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Trip stores its own pickup/destination as plain, immutable fields captured at creation/scheduling time, plus optional soft (nullable, `ON DELETE SET NULL`) references to Facility for reporting linkage only. No generic reusable `Location` entity is introduced at MVP.
- **Status:** CONFIRMED
- **Reason:** Historical trips must not silently change if a Passenger's or Facility's address is edited later; a snapshot-on-Trip model guarantees this without the over-normalization risk a generic Location table would introduce this early.
- **Affected Product Areas:** Trip schema design
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future need for structured, queryable location data beyond what a text snapshot provides

### ZD-048 — TripNote visibility: two fixed classes

- **Date:** 2026-08-30
- **Category:** Product / Security
- **Decision:** TripNote supports exactly two visibility classes at MVP: `operations_only` (Organization Admin, Dispatcher, approved Operations Staff role if retained — never Driver, Passenger, requester, or unauthenticated users) and `driver_visible` (the same operations roles, plus the Driver legitimately assigned to that trip). Only authorized operations roles may create or change a note's visibility classification. No additional classes (`patient_visible`, `requester_visible`, `facility_visible`, `private_driver`, etc.) are added at MVP. Public transportation-request notes remain intake data on TransportationRequest, not TripNote.
- **Status:** CONFIRMED
- **Reason:** Resolves the blocking open question from P1-E1-S1 (Q1) that prevented finalizing TripNote's RLS policy shape; two classes cover the concrete operational need (internal coordination vs. driver instruction) without inventing unused taxonomy.
- **Affected Product Areas:** TripNote schema design and RLS
- **Dependencies:** ZD-045
- **Owner:** Product / Security
- **Review Trigger:** A concrete product need for a third visibility class (e.g., facility-visible) once facility portal access is designed

### ZD-049 — Platform Admin as a system-owned grant, not a Membership role

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Platform Admin is represented by a new system-owned entity, PlatformAdminGrant, keyed to the authenticated user and entirely independent of Organization Membership. `Membership.role = platform_admin` is explicitly rejected as the model. The grant is managed only through a trusted, privileged path — never writable by Organization Admins, never a self-service profile field. A future `is_platform_admin()` helper, if built, follows the same SECURITY DEFINER rules as any other helper (ZD-041's sibling pattern); the database grant remains canonical even if a cached/JWT claim is considered later.
- **Status:** CONFIRMED
- **Reason:** Resolves the blocking open question from P1-E1-S1 (Q5). Organization Membership is inherently organization-scoped; platform-wide privilege is deliberately not, so conflating the two into one role system would make Membership's own RLS harder to reason about and create a privilege-escalation path through org-admin-manageable data.
- **Affected Product Areas:** New PlatformAdminGrant entity; any future cross-organization read/support path
- **Dependencies:** ZD-039
- **Owner:** Security
- **Review Trigger:** Schema design (P1-E1-S2) — the grant's exact storage shape

### ZD-050 — Public request tenant resolution: server-determined, single operator at MVP

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** For the MVP single-operator launch, a public TransportationRequest's `organization_id` is resolved entirely server-side by the trusted intake path to the one configured Zenward operating organization. A client-supplied `organization_id` is never trusted, whether or not one happens to be present in the request payload. Future multi-organization intake would need server-controlled service-area/operating-rule routing — not designed now.
- **Status:** CONFIRMED
- **Reason:** Removes any ambiguity in the P1-E1-S1 public-intake boundary about where tenant ownership comes from; makes explicit that this remains true even as the product scales beyond one operating organization.
- **Affected Product Areas:** Public intake implementation (P1 API design)
- **Dependencies:** ZD-044
- **Owner:** Security
- **Review Trigger:** Multi-organization expansion (service-area routing design)

### ZD-051 — TripAssignment is the sole assignment source of truth (supersedes prior denormalization recommendation)

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Trip does **not** carry denormalized `current_driver_id`/`current_vehicle_id` fields. TripAssignment alone is the source of truth for current assignment; the active assignment for a trip is the row with `ended_at IS NULL`. At schema-design time, evaluate a PostgreSQL partial unique index (or equivalent) enforcing one active assignment per trip.
- **Status:** CONFIRMED — **supersedes** the P1-E1-S1 domain-model.md §G recommendation to denormalize current-assignment fields onto Trip
- **Reason:** One unambiguous source of truth removes a Trip/TripAssignment synchronization risk, simplifies audit history, and avoids duplicated privileged references; MVP-scale query performance is expected to be sufficient with proper indexing. A future, *proven* performance need would be a separate, deliberate decision, not a default.
- **Affected Product Areas:** Trip, TripAssignment schema design
- **Dependencies:** ZD-045
- **Owner:** Engineering
- **Review Trigger:** A measured performance problem with the non-denormalized query pattern at real scale

### ZD-052 — Driver assignment access, restated precisely

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** A Driver may eventually read their own active/relevant TripAssignment, the Trip necessary to perform it, permitted passenger/trip details required for transportation, and `driver_visible` TripNotes. A Driver must not: browse all assignments in the organization, read another driver's assignment by default, self-reassign or change `driver_id`, change `vehicle_id` (unless a separately approved future vehicle-acknowledgement workflow allows it), mutate `organization_id`, access `operations_only` notes, or access another organization's data in any form.
- **Status:** CONFIRMED
- **Reason:** Restates the P1-E1-S1 §17 driver-assignment principle precisely enough to design RLS policies directly from it, removing any ambiguity about edge cases (vehicle changes, note visibility) that the original pass left implicit.
- **Affected Product Areas:** TripAssignment, TripNote RLS design
- **Dependencies:** ZD-041, ZD-048
- **Owner:** Security
- **Review Trigger:** Schema design (P1-E1-S2)

---

**Open / undecided (domain-model.md §Q) — none of these are confirmed decisions. TripNote visibility (ZD-048), Platform Admin representation (ZD-049), and Dispatcher vs. Operations Staff (now ZD-072) are resolved and removed from this list:**

- **Public facility/service-area directory for intake** — UNKNOWN, additionally gated on ZD-016 (launch territory still unknown).
- **Requester as a persistent entity** (vs. per-request snapshot) — UNKNOWN; deferred, not blocking current schema design.
- **Facility self-service portal shape** — UNKNOWN; already POST-MVP per the scope register.

### ZD-053 — Five separate lifecycle concepts; no unified status field

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Zenward has five distinct lifecycle concepts — TransportationRequest, Trip, TripAssignment, TripException, and TripEvent (the last being history, not a stateful lifecycle) — and a status on one entity is never used to represent another's lifecycle. UI labels are analyzed individually rather than mechanically converted into stored states.
- **Status:** CONFIRMED
- **Reason:** Conflating these (e.g., letting assignment presence live on Trip, or letting a delay condition become a Trip state) was identified as the single most likely path to an unmaintainable, ambiguous state machine.
- **Affected Product Areas:** All lifecycle/state schema design
- **Dependencies:** ZD-045
- **Owner:** Product / Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-054 — TransportationRequest lifecycle: pending / accepted / declined / cancelled

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** TransportationRequest has exactly four states. `pending → accepted` is system-driven, triggered atomically by the creation of the first Trip against the request — never a separate manual action. Child Trip outcomes (cancellation, completion) never write back onto Request.state.
- **Status:** CONFIRMED
- **Reason:** Smallest state model that captures every real behavioral distinction the product needs (submitted-vs-reviewed carries no distinct behavior, so was collapsed into `pending`).
- **Affected Product Areas:** TransportationRequest schema design
- **Dependencies:** ZD-045
- **Owner:** Product
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-055 — Trip lifecycle: 9 canonical states, En Route/Arrived disambiguated

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** Trip.state is one of exactly 9 values: `scheduled`, `en_route_to_pickup`, `arrived_at_pickup`, `passenger_onboard`, `en_route_to_destination`, `arrived_at_destination`, `completed`, `cancelled`, `no_show`. The backend never stores a bare `en_route` or `arrived` value — always the pickup-leg or destination-leg variant. `completed` is reachable only from `arrived_at_destination`.
- **Status:** CONFIRMED
- **Reason:** Resolves the ambiguity flagged in the work item directly; keeping `passenger_onboard` distinct from `en_route_to_destination` captures a real NEMT-specific loading-time gap, not an arbitrary split.
- **Affected Product Areas:** Trip schema design, driver execution UI
- **Dependencies:** ZD-045
- **Owner:** Product / Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-056 — No Draft Trip state at MVP

- **Date:** 2026-08-30
- **Category:** Product
- **Decision:** Trip is created directly into `scheduled` once minimum required data is valid. No `draft` state is introduced.
- **Status:** CONFIRMED
- **Reason:** No approved draft-trip workflow exists; an unassigned `scheduled` Trip already represents "not yet fully arranged" without a separate concept.
- **Affected Product Areas:** Trip creation flow
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A future, explicitly approved multi-step/draft trip-creation workflow

### ZD-057 — Assignment presence stays fully derived, never stored on Trip

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** "Needs Assignment" and "Assigned" remain UI-only presentations derived from TripAssignment's existence, never a field on Trip.
- **Status:** CONFIRMED
- **Reason:** Direct continuation of ZD-051 (TripAssignment as sole source of truth) — storing a redundant status on Trip would reintroduce the exact synchronization risk that decision eliminated.
- **Affected Product Areas:** Trip, TripAssignment schema design
- **Dependencies:** ZD-051
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-058 — TripAssignment lifecycle stays timestamp-based; no enum added

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** No additional lifecycle enum is added to TripAssignment. Creation, ending, and reassignment remain fully expressed through `assigned_at`/`ended_at`/`end_reason` and row insertion.
- **Status:** CONFIRMED
- **Reason:** Timestamps and row history already express every state transition TripAssignment needs; an enum would duplicate what the timestamps already say.
- **Affected Product Areas:** TripAssignment schema design
- **Dependencies:** ZD-051
- **Owner:** Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-059 — Driver execution actions and their event/state mapping

- **Date:** 2026-08-30
- **Category:** Product
- **Decision:** Six driver actions are state-changing (each maps 1:1 to a Trip transition and a TripEvent): Start Trip, Arrived at Pickup, Passenger Onboard, Depart to Destination, Arrived at Destination, Complete Trip. "Call Passenger" is a utility action that does not change Trip.state but does generate an informational TripEvent (audit value for no-show/contact-attempt history). "View Trip" and "Navigate" generate no event. "Flag Exception" creates a TripException, not a Trip state change.
- **Status:** CONFIRMED
- **Reason:** Distinguishes state-changing actions (which need the full controlled-transition boundary) from utility actions (which don't), directly informing which future endpoints need the heaviest verification.
- **Affected Product Areas:** Driver execution flow, TripEvent taxonomy
- **Dependencies:** ZD-055
- **Owner:** Product / Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-060 — Controlled transition boundary as the mandatory mutation pattern

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** No future client (driver or operations) is ever granted generic `UPDATE trips SET state = <value>` capability. Every lifecycle mutation passes through a controlled boundary verifying auth user → membership → linked Driver (where applicable) → active TripAssignment → organization consistency → current Trip state → transition legality, before writing state + TripEvent + AuditEvent atomically.
- **Status:** CONFIRMED
- **Reason:** Direct continuation of the RLS-first, deny-by-default principle (ZD-038) applied specifically to lifecycle mutations, which are more complex than simple CRUD and need transition-specific validation RLS alone can't fully express.
- **Affected Product Areas:** All future lifecycle-mutation APIs/RPCs
- **Dependencies:** ZD-038
- **Owner:** Engineering / Security
- **Review Trigger:** API/RPC design (P1-E2)

### ZD-061 — Atomic state + event + audit writes

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Every state-changing mutation writes Trip.state, its TripEvent, and any required AuditEvent in a single database transaction. The system must never be observable with one written and not the others.
- **Status:** CONFIRMED
- **Reason:** A Trip state change without a corresponding event (or vice versa) would break the auditability the whole event/audit model exists for.
- **Affected Product Areas:** All future lifecycle-mutation implementation
- **Dependencies:** ZD-060
- **Owner:** Engineering
- **Review Trigger:** RPC/transaction implementation (P1-E2)

### ZD-062 — Concurrency strategy: expected-state validation + row locking, no idempotency keys at MVP

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Concurrency is handled via expected-current-state validation plus row-level locking within the transition transaction, a future partial unique index enforcing one active TripAssignment per trip, and treating a repeated identical transition (retry) as an idempotent no-op success. Client-supplied idempotency keys and `updated_at`/version optimistic-concurrency columns are explicitly not adopted at MVP.
- **Status:** CONFIRMED
- **Reason:** Covers the realistic race conditions (simultaneous cancel/arrival, simultaneous reassignment, driver retry on poor connectivity) without the added protocol complexity of idempotency keys or version columns, which would be redundant given row locking.
- **Affected Product Areas:** All future lifecycle-mutation implementation
- **Dependencies:** ZD-051, ZD-060
- **Owner:** Engineering
- **Review Trigger:** A demonstrated real-world case the simpler approach doesn't cover

### ZD-063 — TripEvent categories; TripAssignment vs. TripEvent relationship

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** TripEvent entries fall into four categories — state-transition, assignment, informational, system — illustrative, not a finalized enum. TripAssignment remains the canonical, queryable source of truth for current/historical assignment; TripEvent additionally carries human-readable assignment-change entries so the timeline reads naturally without a separate query.
- **Status:** CONFIRMED
- **Reason:** Keeps TripAssignment's RLS-critical role (domain-model.md §17) separate from TripEvent's narrative role, while still giving dispatchers a single readable timeline.
- **Affected Product Areas:** TripEvent schema design
- **Dependencies:** ZD-051
- **Owner:** Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-064 — TripException lifecycle: open/resolved only; driver create-only

- **Date:** 2026-08-30
- **Category:** Product / Security
- **Decision:** TripException has exactly two states, `open` and `resolved` — no separate `dismissed` state. Driver may create an exception only on their own actively-assigned trip; only Dispatcher/Organization Admin may resolve one. An open exception does not automatically block Trip transitions at MVP.
- **Status:** CONFIRMED
- **Reason:** A third state would track a distinction the resolution note already carries; the create/resolve split matches the same driver-narrow-write pattern already established for TripNote.
- **Affected Product Areas:** TripException schema design
- **Dependencies:** ZD-045
- **Owner:** Product / Security
- **Review Trigger:** A specific, approved need for exception types to hard-block transitions

### ZD-065 — Running Late is a derived condition, never a Trip state

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** "Running Late" is computed from scheduled time vs. current time and is never stored as a Trip field or Trip state. A delay significant enough to need tracking or action is recorded as a TripException, not a Trip.state change.
- **Status:** CONFIRMED
- **Reason:** A stored "late" field would immediately go stale; a Trip.state value would conflict with the trip's genuine operational state (e.g., simultaneously `en_route_to_pickup` and "late"), which the work item explicitly identified as the failure mode to avoid.
- **Affected Product Areas:** Trip presentation layer, TripException
- **Dependencies:** ZD-055, ZD-064
- **Owner:** Product
- **Review Trigger:** None anticipated

### ZD-066 — No-show is a distinct Trip terminal state, separate from the related exception

- **Date:** 2026-08-30
- **Category:** Product
- **Decision:** `no_show` is a Trip terminal state, reachable only from `en_route_to_pickup` or `arrived_at_pickup`, and always a deliberate human decision — never automatic or time-triggered. `passenger_unavailable` (a TripException) may precede it as an in-progress attention flag but does not automatically become a no-show.
- **Status:** CONFIRMED
- **Reason:** NEMT operations need an unambiguous, queryable no-show outcome distinct from a routine cancellation; automatic time-based triggering isn't possible yet since wait-time policy (ZD-020) remains unresolved, so the decision is deliberately kept human-driven.
- **Affected Product Areas:** Trip schema design, driver/dispatcher execution UI
- **Dependencies:** ZD-055
- **Owner:** Product
- **Review Trigger:** Resolution of ZD-020 (wait-time rules), which may enable a future assisted/automatic no-show suggestion — not automatic execution

### ZD-067 — Cancellation model

- **Date:** 2026-08-30
- **Category:** Product / Security
- **Decision:** Only Dispatcher/Organization Admin execute a `→ cancelled` transition (from any non-terminal state); a driver may request one via a TripException but never executes it; a public requester's request goes through operations, not a direct mutation. The active TripAssignment is closed (never deleted); a reason is mandatory; `cancelled` is terminal with no normal-actor reopening.
- **Status:** CONFIRMED
- **Reason:** Matches the established driver-narrow-write pattern and keeps cancellation fully auditable with a mandatory reason, consistent with the no-silent-history-rewrite principle.
- **Affected Product Areas:** Trip, TripAssignment schema design
- **Dependencies:** ZD-055, ZD-058
- **Owner:** Product / Security
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-068 — Write-once terminal timestamps may be denormalized on Trip

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Fields like `completed_at` (and analogously `cancelled_at`) may exist directly on Trip despite ZD-051's rejection of denormalizing *current* assignment fields. These are distinguished as write-once historical facts, never subsequently changed, unlike a "current driver" pointer, which represents a changing relationship that can drift out of sync with its source of truth.
- **Status:** CONFIRMED
- **Reason:** Clarifies that ZD-051 is about avoiding duplicated *mutable* state, not about avoiding all denormalization — a distinction worth making explicit so schema design doesn't over-apply ZD-051 to unrelated cases.
- **Affected Product Areas:** Trip schema design
- **Dependencies:** ZD-051
- **Owner:** Engineering
- **Review Trigger:** Schema design (P1-E1-S3)

### ZD-069 — Return transportation as a second Trip row; optional `leg` label

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** Return transportation is a second, ordinary Trip row sharing `request_id` with the outbound Trip — no new relational entity. A not-yet-arranged return is the absence of a second Trip row, not a state on anything. A lightweight optional `leg` label (`outbound`/`return`/`unspecified`) on Trip is recommended for display grouping.
- **Status:** CONFIRMED for the core model (second Trip row, shared request_id, independent timing); the `leg` field itself is **PROVISIONAL**, pending confirmation it's wanted
- **Reason:** Confirms and extends the P1-E1-S1 1:N Request→Trip cardinality decision (ZD-045) directly to the outbound/return case, which was its original motivating example.
- **Affected Product Areas:** Trip schema design
- **Dependencies:** ZD-045
- **Owner:** Product
- **Review Trigger:** Schema design (P1-E1-S3) — confirm the `leg` field before or during

### ZD-070 — Driver availability confirmed out of Trip-lifecycle scope

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** Driver operational availability (`Available`/`On Trip`/`Break`/`Unavailable`) is confirmed as a separate concept from Trip lifecycle, not designed in this phase, and never derived from or stored as a Trip field.
- **Status:** CONFIRMED (as a scope boundary — the availability system itself remains undesigned)
- **Reason:** Not required for the clarity of the five lifecycle concepts this phase defines; designing it now would be speculative without an approved driver-scheduling workflow.
- **Affected Product Areas:** Future driver availability/shift design
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A future work item scoped specifically to driver availability/scheduling

### ZD-071 — Public request-state wording must never imply Trip/Assignment facts

- **Date:** 2026-08-30
- **Category:** Product / Security
- **Decision:** Public-facing copy for TransportationRequest states must never imply driver assignment, vehicle confirmation, or a locked pickup time — those are Trip/TripAssignment facts, which the public surface has no read access to. "Ride Confirmed" is never permitted copy driven by Request state alone.
- **Status:** CONFIRMED as a principle; exact copy for each state is **deferred** (content decision, not architecture)
- **Reason:** Directly follows from Public having zero read access to Trip/TripAssignment (domain-model.md §M) — any UI implying otherwise would be describing data the requester was never actually shown.
- **Affected Product Areas:** Public website request-status messaging
- **Dependencies:** ZD-054
- **Owner:** Product
- **Review Trigger:** Public request-status UI design

---

**Open / undecided from P1-E1-S2 (lifecycle-model.md, Open product questions) — none of these are confirmed decisions, and none block the Lifecycle Security Gate:**

- **Driver acknowledgement of assignment** — recommended useful-but-deferred (not required MVP behavior); needs explicit product confirmation before schema design treats it as present or absent.
- **Driver assignment-decline capability** — not designed; UNKNOWN whether it exists at all.
- **`leg` field adoption** (ZD-069) — PROVISIONAL, needs confirmation.
- **Exact public-facing Request-state copy** (ZD-071) — deferred content decision.
- **Exact cancellation-reason taxonomy** — free text assumed sufficient at MVP; confirm.

### ZD-072 — Operations Staff removed; Dispatcher is the one canonical operations role

- **Date:** 2026-08-30
- **Category:** Product / Architecture
- **Decision:** `operations_staff` is not introduced as a Membership role. `dispatcher` is the sole canonical operations-tier role. This resolves the item deferred from P1-E1-S1A/S2.
- **Status:** CONFIRMED
- **Reason:** Every permission evaluated for "Dispatcher" and "Operations Staff" across P1-E1-S1 and P1-E1-S2 was identical; no genuine permission difference was ever identified, only a title difference in prior UI copy. Per the explicit instruction to collapse identical-permission roles, a second role was not preserved by default.
- **Affected Product Areas:** Membership role enum, all operations-facing permissions
- **Dependencies:** ZD-039
- **Owner:** Product / Security
- **Review Trigger:** A concretely identified, approved permission difference between operations staff tiers

### ZD-073 — MVP organization role set finalized

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Membership.role is exactly one of `{organization_admin, dispatcher, driver}`. No other value is valid, including anything resembling platform admin (which is never expressed via Membership at all — see ZD-049).
- **Status:** CONFIRMED
- **Reason:** Smallest role set that covers every distinct permission tier identified across the domain, lifecycle, and authorization passes; avoids speculative role proliferation.
- **Affected Product Areas:** Membership schema design
- **Dependencies:** ZD-039, ZD-072
- **Owner:** Product / Security
- **Review Trigger:** Schema design (P1-E2)

### ZD-074 — Platform Admin direct read is scoped to four tables

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** Platform Admin receives standing, RLS-level, cross-organization SELECT only on Organization, PlatformAdminGrant, Membership, and AuditEvent. All other tenant-operational tables (Passenger, Trip, TripAssignment, TripEvent, TripNote, TripException, TransportationRequest, Driver, Vehicle, Facility) require a specific, controlled, audited support action if cross-organization access is ever genuinely needed — never a blanket SELECT policy.
- **Status:** CONFIRMED
- **Reason:** Directly implements the instruction not to assume platform admins need unrestricted browser-level SELECT on every tenant table; the four granted tables are genuinely platform-level or low-sensitivity/high-support-value, while operational and passenger data stay behind an audited, deliberate path even for platform admins.
- **Affected Product Areas:** RLS policy design for all 15 entities
- **Dependencies:** ZD-049
- **Owner:** Security
- **Review Trigger:** RLS policy design (P1-E2); any future concrete need for cross-org operational-data support access, which should be designed as its own audited action, not a policy widening

### ZD-075 — Least-privilege split between Organization Admin and Dispatcher

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** Driver profile management (create/deactivate) and Vehicle administration (create/update) belong to Organization Admin, not Dispatcher. Dispatcher gets read-only access to Driver and Vehicle records for assignment purposes.
- **Status:** CONFIRMED
- **Reason:** Both have access-management or fleet-liability implications beyond routine day-to-day dispatch; keeping them with Organization Admin is a deliberate least-privilege choice, not an oversight.
- **Affected Product Areas:** Driver, Vehicle RLS design
- **Dependencies:** ZD-073
- **Owner:** Security
- **Review Trigger:** RLS policy design (P1-E2)

### ZD-076 — Named transition actions replace a generic transition action

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** There is no generic `transition_trip_state` action. Each driver-initiated Trip transition is its own named action (`start_trip_to_pickup`, `mark_arrived_at_pickup`, `mark_passenger_onboard`, `start_trip_to_destination`, `mark_arrived_at_destination`, `complete_trip`).
- **Status:** CONFIRMED
- **Reason:** Matches the "small, single-purpose" policy-shape principle directly — one action name standing for six different real operations would be exactly the ambiguity this whole model set out to avoid.
- **Affected Product Areas:** Driver execution API/RPC design
- **Dependencies:** ZD-055, ZD-060
- **Owner:** Engineering
- **Review Trigger:** API/RPC design (P1-E2)

### ZD-077 — Membership status stays binary (active/inactive); no cached authorization claims

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** Membership.status is exactly `active` or `inactive` — no `invited`/`pending`/`suspended` domain states. RLS authorization checks query live Membership state on every request; no custom JWT claim is trusted as authoritative for the active/inactive gate.
- **Status:** CONFIRMED
- **Reason:** An invitation-not-yet-accepted nuance is better captured by a nullable timestamp than a new state; a cached claim would reintroduce exactly the "session still valid after revocation" risk the whole membership-lifecycle rule exists to prevent.
- **Affected Product Areas:** Membership schema design, RLS helper design
- **Dependencies:** ZD-039
- **Owner:** Security
- **Review Trigger:** Schema design (P1-E2)

### ZD-078 — Hard delete philosophy: presumptively denied for historically significant entities

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** No ordinary hard DELETE, for any role, on Trip, TripAssignment, TripEvent, TripNote, TripException, AuditEvent, TransportationRequest, Driver (with any assignment history), or Passenger (with any trip history). Narrow exceptions (a Vehicle/Facility/Membership row with provably zero historical references) remain Organization Admin/Platform Admin actions, not routine capabilities.
- **Status:** CONFIRMED (as philosophy — no archive-field mechanism is introduced yet)
- **Reason:** Consistent with the append-only/no-silent-history-rewrite principle already established for TripEvent and AuditEvent, extended to every entity with plausible historical significance.
- **Affected Product Areas:** All entity schema design
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Schema design (P1-E2)

---

**Open / undecided from P1-E1-S3 (authorization-model.md, Open questions) — none of these are confirmed decisions, and none block the Authorization Security Gate:**

- **Exact Passenger field-level visibility for Driver** — which specific columns, vs. the full record Organization Admin/Dispatcher see. Schema-design-time question.
- **Driver acknowledgement/decline capability** — carried over from lifecycle-model.md, still unresolved.
- **Narrow hard-delete edge cases for Vehicle/Facility** — minor implementation convenience, not a security requirement either way.
- **Future JWT claim caching for performance** — if ever introduced, must be paired with the live-check discipline in ZD-077; not needed at MVP.

**Addendum to ZD-015 (2026-08-30, lifecycle model):** ZD-015's provisional trip-status list is now superseded for backend purposes by the canonical Trip state model in ZD-055/lifecycle-model.md §C. The visual system's status *presentation* categories (StatusBadge, TripStatus) remain valid at the UI layer — the label→category mapping in `src/components/ui/TripStatus.tsx` should be revisited against the confirmed canonical states during schema design, but no UI code is changed in this phase.

**Addendum to ZD-015 (2026-08-29, design gate):** Design review reaffirmed that the trip status list stays PROVISIONAL. The visual system may define status *presentation* categories, but the actual Zenward trip state machine is established during transportation workflow/domain modelling — the provisional list must not be converted into application logic before that.

### ZD-079 — Public marketing site becomes a separate repository

- **Date:** 2026-08-30
- **Category:** Architecture / Deployment
- **Decision:** The public Zenward marketing/acquisition website will become a separate Next.js project in its own independently deployable repository. This repository (`ZenWard`) remains the product application, ultimately containing only `/operations/...`, `/driver/...`, and minimal application-level routes (e.g. authentication, once designed) — no marketing pages. The standalone marketing repository (not yet created) will own `/`, `/request-transportation`, `/healthcare-providers`, `/services`, `/about`, `/contact`, and required legal pages. `PublicHeader`/`PublicFooter` and other marketing-specific components belong to that repository, not this one.
- **Status:** CONFIRMED (the separation itself). Execution is explicitly **not** performed yet — see public-marketing-separation.md for what moves, what's shared, and what's cleaned up once the standalone repository exists.
- **Reason:** The marketing site needs to launch and evolve independently of the operational platform's development pace; separation also reduces the public-facing surface's proximity to operational systems and gives each surface its own deployment lifecycle.
- **Affected Product Areas:** `src/app/(public)/`, `src/components/public/`, deployment/DNS strategy, README structure
- **Dependencies:** None
- **Owner:** Engineering / Product
- **Review Trigger:** Creation of the standalone marketing repository — at which point the cleanup list in public-marketing-separation.md §4 executes

**Open / undecided from this decision (public-marketing-separation.md §6) — non-blocking for recording the decision itself, but must resolve before executing the cleanup:**

- What `/` serves in the product app once marketing moves out.
- Domain/subdomain strategy for the two deployments (compounds ZD-027, production domain still UNKNOWN).
- Whether design tokens eventually warrant a shared, versioned package instead of two manually-synced `globals.css` copies.

### ZD-080 — Driver has no generic Passenger table SELECT; passenger data is minimum-necessary and assignment-scoped

- **Date:** 2026-08-30
- **Category:** Security
- **Decision:** The Driver role does not receive generic direct SELECT access to the canonical Passenger table, under any RLS policy shape — not even one scoped to "the passenger on my assigned trip." Driver-required passenger information (potentially: display name, phone number where operationally required, pickup/destination information, permitted assistance requirements, companion information, driver-visible instructions) is delivered only through a controlled, assignment-scoped read model — a narrowly defined security-invoker view, a carefully scoped RPC, or a trusted server query returning explicit fields — chosen at schema/API design time, not decided here. No universal Passenger read helper is created. The authorization chain remains: auth user → active Membership → linked Driver → active/relevant TripAssignment → same Organization → permitted Trip → minimum-necessary driver data projection. Direct knowledge of a `passenger_id` or `trip_id` grants no access on its own.
- **Status:** CONFIRMED
- **Reason:** Row Level Security controls which rows a query can see, but does not by itself guarantee minimum-necessary *column* exposure — a row-scoped Driver SELECT policy on Passenger would still return every column in that row. Removing table-level SELECT entirely, in favor of an explicit field-projecting mechanism, removes that failure mode by construction rather than relying on a second, easy-to-forget column-privilege layer.
- **Affected Product Areas:** Passenger, Trip, TripAssignment RLS/API design
- **Dependencies:** ZD-041, ZD-060 (amends the Driver-Passenger access description in authorization-model.md §M/§I, which had described a row-scoped table SELECT)
- **Owner:** Security
- **Review Trigger:** Schema/API design (P1-E2) — choice of view vs. RPC vs. trusted-query mechanism, and the exact minimum-necessary field list

### ZD-081 — CHECK constraints, not native ENUM types, for canonical states

- **Date:** 2026-08-30
- **Category:** Architecture
- **Decision:** Every canonical state/role/visibility column (`memberships.role`/`status`, `transportation_requests.state`, `trips.state`, `trip_notes.visibility`, `trip_exceptions.status`) is implemented as `text` + a `CHECK` constraint, not a native PostgreSQL `ENUM` type.
- **Status:** CONFIRMED
- **Reason:** Adding a new allowed value to a CHECK constraint is a plain, transaction-safe migration; altering a native ENUM has real migration friction (values can't be added and used in the same transaction in the way DDL elsewhere in a migration can). Several of these lists are documented as likely to evolve (e.g., trip exception taxonomy), so migration maintainability was prioritized without sacrificing "no unconstrained free text for canonical states."
- **Affected Product Areas:** All canonical-state columns across the schema
- **Dependencies:** ZD-053 through ZD-055 (lifecycle states), ZD-048 (note visibility), ZD-064 (exception states)
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-082 — Composite foreign keys implemented via UNIQUE(id, organization_id)

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** ZD-041's composite-FK strategy is now implemented exactly as specified: every tenant-owned parent table (`drivers`, `passengers`, `facilities`, `vehicles`, `transportation_requests`, `trips`) carries `UNIQUE (id, organization_id)`, and every cross-entity child reference (trip→passenger/request/facility, trip_assignment→trip/driver/vehicle, trip_events/trip_notes/trip_exceptions→trip) is a composite FK against that pair — never a plain single-column FK for these relationships.
- **Status:** CONFIRMED — implemented and verified (adversarial tests V/W/X and the full constraint-test suite, all passing)
- **Reason:** Makes a cross-tenant relationship a schema-level impossibility rather than something RLS alone is trusted to prevent, exactly as ZD-041 anticipated.
- **Affected Product Areas:** All tenant-owned table relationships
- **Dependencies:** ZD-041
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-083 — Column-level GRANT/REVOKE for field-level mutation enforcement

- **Date:** 2026-08-30
- **Category:** Architecture / Security
- **Decision:** Where authorization-model.md §K distinguishes field groups with different owners (planning vs. lifecycle vs. tenant vs. reference fields), this is enforced at the Postgres column-privilege level (`REVOKE UPDATE ... ; GRANT UPDATE (col1, col2, ...) ...`), not by policy logic alone. Applied to `trips`, `trip_assignments`, `memberships`, and `organizations`. On `trips` specifically, this phase is deliberately more conservative than the approved model strictly requires: `state` and all terminal timestamp/reason fields are not grantable to any authenticated role at all yet, since the controlled transition RPC that would need them is explicitly out of scope for this phase (ZD-060/ZD-061 not yet built).
- **Status:** CONFIRMED
- **Reason:** RLS controls row visibility, not column exposure — column-level privilege is the correct, native Postgres mechanism for the field-level distinctions authorization-model.md §K already called for, and closes the gap without waiting for RPCs that don't exist yet.
- **Affected Product Areas:** `trips`, `trip_assignments`, `memberships`, `organizations` RLS design
- **Dependencies:** ZD-060, ZD-061
- **Owner:** Security
- **Review Trigger:** Lifecycle-transition RPC design (a later phase) — at that point, `trips.state`/terminal fields may become reachable only through that RPC's SECURITY DEFINER context, still never through a direct client GRANT

### ZD-084 — Future SECURITY DEFINER/RPC function privilege convention (mandatory migration rule, not ALTER DEFAULT PRIVILEGES)

- **Date:** 2026-08-31
- **Category:** Security / Process
- **Decision:** Every future migration that creates a `SECURITY DEFINER` function, or any function intended to be Supabase-RPC-callable, must explicitly `REVOKE EXECUTE ... FROM PUBLIC` and then `GRANT EXECUTE ... TO <only the roles that genuinely need it>` in the **same migration** that creates the function. `ALTER DEFAULT PRIVILEGES` is deliberately **not** used to pre-harden this project-wide, because that command is scoped to a specific creator role, and the local migration-runner role (`postgres`, in this Docker-based local setup) cannot be safely assumed identical to whatever role runs migrations in a future hosted/deployed environment — applying a role-specific default-privilege rule against the wrong role would silently protect nothing.
- **Status:** CONFIRMED
- **Reason:** Discovered via direct audit (P1-E2-S1A) that two trigger-support functions from the very first migration had never had PostgreSQL's default PUBLIC EXECUTE grant revoked — not exploitable in practice (both are `RETURNS trigger` functions, callable neither directly nor via PostgREST's RPC schema cache), but a real minimum-privilege gap all the same, and exactly the kind of gap a per-migration convention prevents at the source rather than requiring a later corrective audit to catch.
- **Affected Product Areas:** All future SECURITY DEFINER/RPC function migrations
- **Dependencies:** ZD-038 (RLS-first), the SECURITY DEFINER rules already established in authorization-model.md §T
- **Owner:** Security
- **Review Trigger:** Every future migration adding a SECURITY DEFINER or RPC-reachable function — reviewed against this convention before merge

### ZD-085 — Controlled-mutation error contract: six custom SQLSTATEs, code-based branching only

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** Every controlled-mutation RPC (P1-E2-S2) rejects with one of exactly six custom SQLSTATEs — `ZW001 unauthorized`, `ZW002 not_found`, `ZW003 stale_state`, `ZW004 illegal_transition`, `ZW005 assignment_conflict`, `ZW006 invalid_input` — via `RAISE EXCEPTION ... USING ERRCODE = 'ZW0xx'`, with a short, stable, tenant-data-free message token (never a sentence, never row contents). Callers (application code and tests alike) must branch on PostgREST's `code` field in the JSON error body, never on message text.
- **Status:** CONFIRMED — implemented and verified (125 SQL assertions plus 12 real-HTTP cross-validation checks, all passing; HTTP-12 specifically confirms PostgREST surfaces the custom code in the response body)
- **Reason:** A stable, small, documented error vocabulary lets every caller (future UI, tests, other services) distinguish failure modes reliably without parsing human-readable text, which is exactly the kind of brittleness that breaks silently when a message is later reworded for clarity.
- **Affected Product Areas:** All P1-E2-S2 mutation RPCs; docs/data/mutation-api.md
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Any future mutation RPC family — must reuse this same six-code vocabulary rather than inventing new codes ad hoc

### ZD-086 — Fixed row-locking order: Trip, then active TripAssignment

- **Date:** 2026-08-31
- **Category:** Architecture
- **Decision:** Every controlled-mutation RPC that touches both tables locks `trips` first (`SELECT ... FOR UPDATE`) and the active `trip_assignments` row (if any) second, in that fixed order, with no exception. A pure idempotent-no-op read path may skip the second lock entirely (nothing to protect), but never acquires it out of order.
- **Status:** CONFIRMED — implemented and verified (mutation_atomicity_tests.sql forced-failure test; mutation_concurrency_test.sh genuine two-process concurrency test, both passing)
- **Reason:** Uniform lock ordering across every mutation path is what makes concurrent calls deadlock-free by construction rather than "usually fine" — two transactions each following the same fixed order can never form a lock cycle.
- **Affected Product Areas:** All P1-E2-S2 mutation RPCs
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Any future mutation RPC touching more than one of these tables — must follow this same order, extended consistently if a third table is added to a lock chain

### ZD-087 — Event/Audit matrix: Driver progression is TripEvent-only, assignment/cancellation/no-show/completion get both

- **Date:** 2026-08-31
- **Category:** Product / Security
- **Decision:** The 5 non-terminal Driver progression transitions write a TripEvent only. Assignment, reassignment, cancellation, no-show, and Trip completion (the one Driver action that reaches a terminal state) write both a TripEvent and an AuditEvent. Exactly one of each per successful call — closing an assignment as a side effect (on reassignment/cancellation/no-show/completion) is folded into that one event/audit row, never logged as a separate event.
- **Status:** CONFIRMED
- **Reason:** lifecycle-model.md/authorization-model.md never fully enumerated this split; the work item's own guidance (AuditEvent "strongly considered mandatory" for actions that materially change responsibility or reach a terminal disposition, TripEvent sufficient for routine progress) is adopted directly and recorded here as the definitive rule, rather than left to be reinvented per-function.
- **Affected Product Areas:** trip_events, audit_events, all P1-E2-S2 mutation RPCs
- **Dependencies:** None
- **Owner:** Product / Security
- **Review Trigger:** Any future mutation RPC family — apply this same "does it change responsibility or reach a terminal state" test to decide TripEvent-only vs. both

### ZD-088 — Assignment-eligible Trip states: scheduled, en_route_to_pickup, arrived_at_pickup

- **Date:** 2026-08-31
- **Category:** Product
- **Decision:** `assign_trip` and `reassign_trip` are legal only while a Trip is in `scheduled`, `en_route_to_pickup`, or `arrived_at_pickup`. Once a Trip reaches `passenger_onboard` or later, ordinary (re)assignment is no longer permitted through these RPCs.
- **Status:** CONFIRMED — recorded fresh; neither lifecycle-model.md nor authorization-model.md specified a restricted eligible-state list for (re)assignment before this phase (checked directly against both documents; no existing rule was found to follow or contradict)
- **Reason:** Reassigning a driver mid-transport (after the passenger is already onboard) is an operationally unusual, high-risk action that the MVP does not need to support through the ordinary controlled path; a conservative allow-list is safer than an unconstrained one and is trivially loosened later if a real dispatch workflow needs it.
- **Affected Product Areas:** assign_trip, reassign_trip
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A real dispatcher workflow that needs mid-transport reassignment — would require a deliberate, separately-reviewed extension, not a silent widening

### ZD-089 — RPC architecture: one narrow function per Driver action, sharing one unexposed internal executor

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** The 6 Driver lifecycle transitions are each their own named, narrow SECURITY DEFINER function (`driver_start_to_pickup`, etc.) accepting only `p_trip_id` and `p_expected_current_state` — never a target-state parameter. All 6 delegate to one shared internal SECURITY DEFINER function (`_driver_execute_trip_transition`) that does accept a from/to state pair, but that internal function is never granted EXECUTE to any client role (`authenticated`, `anon`, or `PUBLIC`) — it is reachable only from within the 6 wrappers' own already-elevated execution context. The single canonical Trip transition matrix lives in one place (`_is_valid_trip_transition`), also never exposed directly.
- **Status:** CONFIRMED — implemented and verified (mutation_privilege_tests.sql "internal-helpers-not-exposed" check; security_definer_exposure-style ACL inspection showing the 3 internal helpers carry only the owner's implicit privilege)
- **Reason:** A single generic "transition trip to state X" RPC would let any caller who could reach it choose an arbitrary target state, defeating the entire per-action authorization design; splitting into narrow named functions while still sharing one implementation avoids both that risk and inconsistent duplicated logic across 6 near-identical function bodies.
- **Affected Product Areas:** All 6 driver_* RPCs, _driver_execute_trip_transition, _is_valid_trip_transition
- **Dependencies:** ZD-084 (privilege convention)
- **Owner:** Security
- **Review Trigger:** Any future action family with more than one legal edge — apply this same "narrow public wrapper, shared unexposed internal executor" pattern rather than one parameterized public function

### ZD-090 — Idempotency semantics: target-state-already-holds is always a safe no-op

- **Date:** 2026-08-31
- **Category:** Architecture
- **Decision:** For every lifecycle mutation RPC, if the Trip is already at the function's own target/terminal state, the call returns success with `changed=false` and performs no write — regardless of what `expected_current_state` (Driver functions) or prior call history the caller supplied. This check is evaluated before any active-assignment requirement, since a terminal transition itself is what closes the active assignment (ZD-087), so a driver retrying their own just-succeeded call must not be rejected merely because their assignment is now closed as a normal consequence. Any state that is neither the function's required from-state nor its target state is rejected as `ZW003 stale_state`, independent of whether `expected_current_state` was supplied.
- **Status:** CONFIRMED — implemented and verified (mutation_lifecycle_tests.sql L7/L16, and the L8 case that specifically distinguishes "retry of one's own successful action" from "terminal reopening via an unrelated action")
- **Reason:** A caller retrying an already-successful request (network timeout, double-tap, at-least-once delivery) must get a safe, informative success back — bouncing them into an authorization error because a natural side effect (assignment closure) already happened would be actively misleading.
- **Affected Product Areas:** All P1-E2-S2 lifecycle mutation RPCs
- **Dependencies:** ZD-087
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-091 — Cancellation and no-show are Organization Admin / Dispatcher actions only, never Driver-initiated

- **Date:** 2026-08-31
- **Category:** Product / Security
- **Decision:** `cancel_trip` and `record_no_show` both require `has_org_role(organization_id, [organization_admin, dispatcher])`; no Driver-facing function exists for either action, even for a Driver's own actively-assigned Trip.
- **Status:** CONFIRMED
- **Reason:** Cancellation and no-show are dispositive, often billing/reporting-relevant administrative decisions with follow-on consequences (rescheduling, family notification, no-show tracking) that authorization-model.md already scopes to operations roles; the work item reaffirms this is not one of the 6 actions a Driver may perform directly, and a Driver observing a genuine no-show or needing a cancellation reports it through operations rather than executing it unilaterally.
- **Affected Product Areas:** cancel_trip, record_no_show, authorization-model.md action matrix
- **Dependencies:** authorization-model.md §N (actor transition permissions)
- **Owner:** Product
- **Review Trigger:** A future Driver-facing "report a problem" workflow — would raise a TripException or a flagged note, not call these RPCs directly, unless explicitly re-decided

### ZD-092 — trip_assignments direct table write retired in favor of assign_trip/reassign_trip

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** The direct INSERT/UPDATE grant and the two RLS policies (`trip_assignments_insert_org_operations`, `trip_assignments_update_org_operations`) that P1-E2-S1 gave Organization Admin/Dispatcher on `trip_assignments` — necessary then because no controlled assignment mechanism existed — are revoked and dropped outright in P1-E2-S2, now that `assign_trip`/`reassign_trip` exist. No role retains any direct write path to this table; SELECT and its two policies are unchanged.
- **Status:** CONFIRMED — implemented and verified (mutation_privilege_tests.sql "trip-assignments-direct-write-revoked"/"superseded-policies-dropped"; mutation_assignment_tests.sql C16)
- **Reason:** Per ZD-084's spirit and the work item's explicit direction, once a controlled RPC exists for a mutation, the raw table-level path that predated it should be retired rather than left as a silent bypass around the RPC's auth chain, idempotency handling, locking, and event/audit logging.
- **Affected Product Areas:** trip_assignments RLS/grants
- **Dependencies:** ZD-084, ZD-089
- **Owner:** Security
- **Review Trigger:** Any future table that gains its own controlled-mutation RPC — apply the same retirement of the direct-write path that predated it

### ZD-093 — Idempotent no-op for Driver transitions requires actor-verified proof, not merely ever-assigned (amends ZD-090)

- **Date:** 2026-08-31
- **Category:** Security
- **Decision:** Amends ZD-090. The Driver-transition idempotent no-op path (`_driver_execute_trip_transition`: "Trip already at target state") additionally requires trusted proof — a `trip_events` row for this Trip with `event_type` = this function's own target event and `actor_user_id = auth.uid()` — that the calling Driver is the one who actually performed that exact transition, not merely that they hold (or ever held) *some* relationship to the Trip. `is_driver_assigned_to_trip` (ever-assigned) remains the correct gate for whether the caller may be considered at all, but it was never sufficient on its own to justify a no-op *success*, since two different Drivers can each satisfy it on the same Trip (one historical, one current). No caller-supplied actor id is introduced anywhere — the check is against the same trusted, append-only `trip_events.actor_user_id` column every mutation function already writes, resolved the same way `auth.uid()` is resolved everywhere else in this codebase.
- **Status:** CONFIRMED — implemented and verified (P1-E2-S2A audit: `mutation_idempotent_authorization_tests.sql` A-F, all passing, including 3 real-HTTP cross-validation checks; the pre-fix gap was additionally reproduced empirically under a temporary, non-persistent copy of the old logic before being fixed, not merely reasoned about)
- **Reason:** Found via targeted audit (P1-E2-S2A) that the original ZD-090 wording ("the Trip is already at the target state" as the sole idempotency test) let a formerly-assigned Driver who never performed a given transition receive a false success merely because a *different* Driver had already performed it after a reassignment — idempotency correctly means "the same authorized operation may safely be retried by the actor who performed it", not "anyone with any historical relationship to the resource receives success once the desired state exists for any reason." Confined to the Driver-transition family: ops actions (`cancel_trip`/`record_no_show`/`assign_trip`/`reassign_trip`) authorize by live-checked, org-scoped role rather than trip-instance-specific actor identity, so no analogous gap exists there — any currently-authorized Organization Admin/Dispatcher legitimately may re-assert an already-true org-level fact, unlike a Driver's inherently personal "this is MY assignment" authorization.
- **Affected Product Areas:** `_driver_execute_trip_transition` (and therefore all 6 `driver_*` RPCs)
- **Dependencies:** ZD-090 (amended, not superseded — the target-state-already-holds precedence over the active-assignment check is unchanged; only the no-op's own eligibility test is tightened)
- **Owner:** Security
- **Review Trigger:** Any future actor-scoped (not role-scoped) mutation RPC with idempotent-retry semantics — apply this same "verify the retry via trusted history, never via mere historical relationship" pattern

### ZD-094 — Driver read API architecture: narrow SECURITY DEFINER projections, explicit composite types, no wildcard serialization

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** The Driver read boundary (P1-E2-S3) is implemented as 4 narrow, purpose-specific `SECURITY DEFINER` functions (`driver_get_profile`, `driver_list_active_trips`, `driver_get_trip_detail`, `driver_list_trip_history`), each `STABLE` (read-only, verified to never mutate `trips`/`trip_assignments`/`trip_events`/`audit_events`), each returning an explicit composite type (`driver_profile_result`, `driver_active_trip_summary`, `driver_trip_detail_result`, `driver_trip_history_entry`) rather than any canonical table rowtype. No function anywhere in this layer uses `passenger.*`, `to_jsonb(passenger)`, `row_to_json(passenger)`, or any other whole-row serialization — every returned field is named explicitly, including inside the `driver_notes` jsonb array (`jsonb_build_object('id', ..., 'body', ..., 'created_at', ...)`, never a serialized `trip_notes` row).
- **Status:** CONFIRMED — implemented and verified (`driver_read_privilege_tests.sql`; `driver_read_minimization_tests.sql`'s exact-column-set assertions against `pg_attribute`, which prove this structurally, not merely by inspection; real HTTP cross-validation confirming the PostgREST JSON shape matches exactly)
- **Reason:** RLS controls rows, not columns (work item §4) — a Driver-facing policy on `passengers` or a widened `trips` policy would still return every column on that row, including any added later. An explicit composite type makes the projection itself the security boundary: a future column added to `trips`/`passengers`/`vehicles`/`trip_notes` cannot appear in a Driver-facing response without a human deliberately editing the type definition.
- **Affected Product Areas:** All 4 Driver read RPCs and their return types
- **Dependencies:** ZD-085 (reuses the same 6-code error contract), ZD-089 (same narrow-function-per-purpose pattern as the mutation RPCs)
- **Owner:** Security
- **Review Trigger:** Any future Driver-facing (or other role-facing) read capability — apply this same pattern rather than a row-scoped table policy or a whole-row-serializing function

### ZD-095 — Trip detail requires a CURRENTLY active assignment; uniform not_found convention for all read denials

- **Date:** 2026-08-31
- **Category:** Security
- **Decision:** `driver_get_trip_detail` requires the caller to hold a currently active (`ended_at IS NULL`) `trip_assignments` row on the specific Trip — a historical assignment alone is never sufficient, and reassignment revokes detailed access on the caller's very next call (live-checked, no JWT refresh needed). Every denial reason for the 4 read RPCs — nonexistent Trip, foreign-org, never-assigned, formerly-assigned-but-reassigned-away, inactive Membership, inactive Driver, zero-membership user, Platform Admin without Driver context — is uniformly `ZW002 not_found`. Unlike the mutation layer (ZD-085's `not_found` vs `unauthorized` distinction, which exists because a Driver retained *read* visibility into a Trip they'd been reassigned away from, via the now-retired `trips_select_assigned_driver`), no such carve-out applies here: since direct base-table Trip access is retired for Driver entirely (ZD-096), a formerly-assigned Driver has zero remaining legitimate visibility into the Trip through any path, so there is no "they can see it, they just can't act on it" case to distinguish — `unauthorized` (ZW001) is simply never reachable from these 4 functions.
- **Status:** CONFIRMED — implemented and verified (`driver_read_authorization_tests.sql` DETAIL-1 through DETAIL-11, MULTIORG-1/2; real HTTP READ-5/5B for reassignment revocation)
- **Reason:** Matches the work item's explicit requirement (§15/§30) that reassignment revoke detailed access immediately, and keeps the read boundary simpler and more conservative than the write boundary's necessarily more nuanced convention, since no legitimate reason exists for a Driver to retain any visibility into a Trip they no longer hold.
- **Affected Product Areas:** `driver_get_trip_detail` (and, by the same reasoning, `driver_list_active_trips`/`driver_list_trip_history`, which are inherently scoped by their own WHERE clauses rather than needing a separate denial-reason distinction)
- **Dependencies:** ZD-085, ZD-096
- **Owner:** Security
- **Review Trigger:** None anticipated

### ZD-096 — Driver base-table SELECT retirement: 6 policies retired, trip_exceptions deliberately retained

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** Following the full Driver read-surface audit (docs/security/driver-data-minimization.md), 6 Driver-scoped base-table SELECT policies are retired as superseded by the new read API: `drivers_select_own` (→ `driver_get_profile`), `trips_select_assigned_driver` (→ `driver_list_active_trips`/`driver_get_trip_detail`/`driver_list_trip_history`), `trip_assignments_select_own_driver` (→ the same three), `vehicles_select_assigned_driver` (→ vehicle summary embedded in the read API), `trip_notes_select_assigned_driver_visible` (→ `driver_notes` embedded in `driver_get_trip_detail`), and `trip_events_select_assigned_driver` (retired per work item §24 with no replacement — no TripEvent timeline is exposed to Driver in this phase at all). `trip_exceptions_select_assigned_driver` is deliberately **NOT** retired: no replacement projection is built this phase (work item §26 explicitly defers building one), so retiring it would remove existing, already narrowly-scoped (ever-assigned-Driver-only) functionality with no successor and no independently-identified over-exposure beyond that existing scoping. Organization Admin/Dispatcher SELECT access on every affected table is completely untouched.
- **Status:** CONFIRMED — implemented and verified (`driver_read_privilege_tests.sql` "retired-policies-gone"/"trip-exceptions-deliberately-retained"/"ops-access-untouched"; `rls_adversarial_tests.sql` tests F/I updated to the new contract per work item §58, with the old/new contract documented inline in that file rather than silently changed)
- **Reason:** `trips_select_assigned_driver` in particular exposed every column on any Trip a Driver ever held an assignment on, indefinitely, including fields with no Driver-facing need (`request_id`, `cancellation_reason`, etc.) — a textbook case of the exact column-minimization risk RLS alone cannot prevent (work item §4/§5, "do not assume Passenger is the only table with column-minimization risk"). `trip_events_select_assigned_driver` separately exposed `actor_user_id` (identifying which other person performed historical actions) indefinitely, matching the work item's explicit "no internal actor/event metadata without a concrete need" (§24).
- **Affected Product Areas:** `drivers`, `trips`, `trip_assignments`, `vehicles`, `trip_notes`, `trip_events` RLS policy inventory
- **Dependencies:** ZD-080 (the same data-minimization principle extended beyond Passenger), ZD-094
- **Owner:** Security
- **Review Trigger:** A future Driver-facing TripException status view — would need its own explicit review of whether `trip_exceptions_select_assigned_driver` should then also be retired in favor of a purpose-built projection, consistent with the pattern established here

### ZD-097 — Passenger minimum-necessary allowlist for the Driver read API

- **Date:** 2026-08-31
- **Category:** Security / Product
- **Decision:** The Driver read API returns exactly two `passengers` fields, ever: `display_name` (active list and detail) and `phone` (detail only, never list or history). Every other `passengers` column (`id`, `organization_id`, `assistance_notes`, `status`, `created_at`, `updated_at`) is never returned. Assistance/instruction information shown to a Driver comes from `trips.assistance_notes`/`trips.instructions` — the existing immutable per-Trip operational snapshot (schema.md) — never from `passengers.assistance_notes`, to avoid two divergent sources of the same kind of fact for the same Trip.
- **Status:** CONFIRMED — implemented and verified (`driver_read_minimization_tests.sql` MIN-KEYS-DETAIL, PHONE-1 through PHONE-4, BASE-TABLE-REGRESSION-1/2)
- **Reason:** Direct base-table Passenger SELECT remains permanently off the table for Driver (ZD-080, untouched by this phase) — this allowlist is the entirety of what a Driver ever receives about a Passenger, reviewed field-by-field rather than assumed.
- **Affected Product Areas:** `driver_active_trip_summary`, `driver_trip_detail_result`
- **Dependencies:** ZD-080
- **Owner:** Product / Security
- **Review Trigger:** Any proposed new Passenger field — must be independently reviewed against this allowlist before being added to any Driver-facing response, never assumed included

### ZD-098 — Driver-visible TripNote embedding: explicit fields only, author metadata never exposed

- **Date:** 2026-08-31
- **Category:** Security
- **Decision:** `driver_get_trip_detail` embeds only `visibility='driver_visible'` `trip_notes` rows, as a `jsonb` array of explicitly-constructed `{id, body, created_at}` objects. `author_user_id`, `visibility`, `organization_id`, and `trip_id` are never included in the note objects (the last two are redundant with the surrounding response; the first two are unnecessary operational/administrative metadata for a Driver). `operations_only` notes are never returned under any condition.
- **Status:** CONFIRMED — implemented and verified (`driver_read_minimization_tests.sql` NOTE-VISIBILITY-1/2)
- **Reason:** Matches the same data-minimization principle applied everywhere else in this phase — the existing `trip_notes_select_assigned_driver_visible` policy (retired, ZD-096) was already correctly row-scoped but still exposed the full row including `author_user_id`, which the embedded projection now excludes by construction.
- **Affected Product Areas:** `driver_get_trip_detail`, `driver_trip_detail_result.driver_notes`
- **Dependencies:** ZD-048 (TripNote visibility), ZD-096
- **Owner:** Security
- **Review Trigger:** None anticipated

### ZD-099 — History redaction model and query bound

- **Date:** 2026-08-31
- **Category:** Security / Product
- **Decision:** `driver_list_trip_history` returns only: `trip_id`, `scheduled_pickup_at`, `assignment_started_at`, `assignment_ended_at`, `end_reason`, and `trip_outcome` (populated only when the Trip reached a terminal state — `completed`/`cancelled`/`no_show` — by the time of the query; `null` otherwise). No passenger identity, phone, notes, pickup/destination text, or requester data ever appears in history — materially more restricted than `driver_trip_detail_result`. The query range defaults to the trailing 90 days and is hard-capped at 180 days per call (`ZW006` if exceeded or inverted); this bound is an explicit query-cost/privacy safeguard, not a business data-retention policy, and does not itself delete or expire any underlying `trip_assignments`/`trips` data.
- **Status:** CONFIRMED — implemented and verified (`driver_read_history_tests.sql` HISTORY-1 through HISTORY-7)
- **Reason:** A past assignment is fundamentally lower-need than an active one (work item §28) — indefinitely retaining a Driver's access to a Passenger's phone number or driver-visible note text after the assignment has ended has no operational justification. `trip_outcome` being `null` for a non-terminal Trip specifically prevents a past assignment from revealing what a *different*, later Driver has done on the same Trip since — a privacy property beyond what the work item explicitly required, adopted because it followed directly from the same "when uncertain, exclude" principle applied throughout this phase.
- **Affected Product Areas:** `driver_list_trip_history`, `driver_trip_history_entry`
- **Dependencies:** None
- **Owner:** Product / Security
- **Review Trigger:** If a genuine product need for a longer history window emerges — revisit the 180-day cap explicitly rather than silently widening it

### ZD-100 — current_driver_id() corrected to require an active Membership, not just an active Driver row (fixes a pre-existing P1-E2-S1 gap)

- **Date:** 2026-08-31
- **Category:** Security
- **Decision:** `current_driver_id()` (defined in the historical, already-committed `20260830131600_rls_helper_functions.sql`; corrected via the new append-only `20260831110300_current_driver_id_membership_check.sql`, never by editing the historical file) now additionally requires an active `memberships` row with `role='driver'` for the same `(user, organization)` pair, not merely `drivers.status='active'`. Signature and return type are unchanged, so every caller — RLS policies, the P1-E2-S2 mutation RPCs' authorization chain, and this phase's read RPCs — is corrected automatically.
- **Status:** CONFIRMED — implemented and verified (`driver_read_authorization_tests.sql` DETAIL-6, the specific test that discovered this gap; full regression re-run across all 13 SQL suites plus the concurrency test after the fix, zero regressions)
- **Reason:** Before this fix, a Driver whose Membership was revoked (`status='inactive'`) but whose `drivers` row remained `status='active'` kept full authority through `current_driver_id()` and everything built on it — a real, previously-undetected violation of the repeatedly-stated principle that an inactive Membership must remove authority immediately and live, on every call (ZD-077), which `is_org_member`/`has_org_role` already correctly implemented but `current_driver_id` did not. Discovered by a new P1-E2-S3 read-authorization test, but the gap itself predates this phase and affected the mutation layer equally — fixed here rather than merely noted, consistent with the project's established practice of fixing a discovered gap rather than deferring it once found.
- **Affected Product Areas:** `current_driver_id`, and transitively every function that calls it: `is_driver_assigned_to_trip`, `_lock_driver_active_assignment`, all 6 `driver_*` mutation RPCs, all 4 Driver read RPCs, and the `trip_assignments_select_own_driver`/`vehicles_select_assigned_driver` RLS policies (both now retired, ZD-096, but were still live and affected at the time this gap existed)
- **Dependencies:** ZD-077
- **Owner:** Security
- **Review Trigger:** None anticipated — this is now the permanent, correct definition

### ZD-101 — Direct `trips` INSERT retired in favor of `create_trip`

- **Date:** 2026-08-31
- **Category:** Security / Architecture
- **Decision:** The `trips` INSERT grant to `authenticated` (unrestricted by column, unlike UPDATE) and its supporting policy `trips_insert_org_operations` — both present since P1-E2-S1's very first migration — are revoked/dropped outright. `create_trip()` (ZD-102) is now the sole path to create a Trip. SELECT and the existing narrowed UPDATE grant are completely unchanged.
- **Status:** CONFIRMED — implemented and verified (`create_trip_privilege_tests.sql` "direct-insert-revoked"/"select-and-update-untouched"/"superseded-policy-dropped"; `create_trip_tests.sql` "TEST DIRECT-INSERT"; real HTTP `create_trip_probe.js` CT-6)
- **Reason:** This grant was found, during P1-E3-S0's UI-mapping work (GAP-1), to be a genuine, currently-exploitable gap: unlike every other lifecycle-sensitive column (already locked down since P1-E2-S1/S2), a raw INSERT could set `trips.state` to any value at creation, bypassing the lifecycle model this project otherwise carefully protects. Exactly the same retirement pattern as ZD-092 (`trip_assignments`) and ZD-096 (6 Driver base-table SELECT policies) — once a controlled RPC exists for a mutation, the raw path that predated it is retired, not left as a silent bypass.
- **Affected Product Areas:** `trips` RLS/grants
- **Dependencies:** ZD-084, ZD-092, ZD-102
- **Owner:** Security
- **Review Trigger:** None anticipated

### ZD-102 — `create_trip` architecture: no caller-supplied state, separate from assignment, non-idempotent by design

- **Date:** 2026-08-31
- **Category:** Architecture / Security
- **Decision:** `create_trip` accepts no `state`/`initial_state` parameter at all — the initial value (`'scheduled'`) is a fixed literal inside the function body, not merely validated input, so a caller has no mechanism to request any other value regardless of what they send. `create_trip` never touches `trip_assignments` — Trip creation and assignment remain separate commands (`assign_trip` is still the only path to an active assignment), a deliberate command-boundary decision, not an oversight. `create_trip` is deliberately **non-idempotent**: no duplicate-submission heuristic is attempted (matching passenger/time/address is not reliable evidence of an accidental resubmit — two legitimate Trips can share all three), so the `created` field in its result is always `true`, and preventing accidental double-submission is left to application code (e.g. disabling the submit control while a request is in flight), not solved at the database layer in this phase. When `p_request_id` is supplied and the referenced request is `pending`, it is atomically transitioned to `accepted` in the same transaction as the Trip INSERT (the system-driven transition `transportation_requests`' own original comment anticipated but nothing implemented before this decision); an already-`accepted` request is left untouched, preserving 1:N Request→Trip.
- **Status:** CONFIRMED — implemented and verified (`create_trip_tests.sql`, 20 assertions covering the full role/membership/cross-tenant/state-impossibility/request-lifecycle matrix; `create_trip_atomicity_tests.sql`, forced-failure rollback of Trip+TripEvent+AuditEvent+conditional Request update; real HTTP `create_trip_probe.js`, 6/6)
- **Reason:** Matches this project's established RPC-architecture principles (ZD-089: narrow, intention-revealing functions; ZD-090: idempotency is deliberate and documented, never assumed) extended to the one operation — creation — that has no natural "current state" to check idempotency against, unlike every transition RPC. Structurally eliminating the state parameter (rather than merely rejecting an unexpected value) closes the exact class of gap GAP-1 identified, by construction rather than by convention.
- **Affected Product Areas:** `create_trip`, `trip_creation_result`
- **Dependencies:** ZD-085 (error contract, reused), ZD-089 (RPC architecture pattern), ZD-090 (idempotency-is-deliberate principle, applied here as "deliberately absent"), ZD-101
- **Owner:** Security
- **Review Trigger:** If application usage reveals accidental double-submission is a real, recurring problem — revisit whether a deliberate, durable idempotency key belongs in a future revision, rather than adding one reactively without review

### ZD-103 — SSR auth architecture: `@supabase/ssr`, two clients, server-first resolution

- **Date:** 2026-09-01
- **Category:** Architecture / Security
- **Decision:** The application uses `@supabase/ssr`'s current, supported cookie-based pattern — a browser client (`src/lib/supabase/client.ts`) and a server client (`src/lib/supabase/server.ts`), both publishable-key-only, plus a middleware session-refresh helper (`src/lib/supabase/middleware.ts`). Every protected route's authorization (user, Membership, organization context, role, Driver linkage) is resolved server-side, in a Server Component, before any client code renders — never a client-side redirect after a flash of protected content.
- **Status:** CONFIRMED — implemented and verified (41 real integration checks against the actual running app and local Supabase Auth; zero client-side route guards exist anywhere in `src/`)
- **Reason:** Matches the work item's explicit "no flash of unauthorized content" requirement, and reuses the exact SDK pattern Supabase currently recommends for Next.js App Router rather than the deprecated `auth-helpers` package or a hand-rolled session mechanism.
- **Affected Product Areas:** All of `src/lib/supabase/`, `src/lib/auth/`, `middleware.ts`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future Supabase SSR SDK major version — re-verify the cookie/session pattern still matches current guidance before upgrading

### ZD-104 — Organization context: cookie names a request, never authority; single-org auto-selects, multi-org requires explicit selection

- **Date:** 2026-09-01
- **Category:** Security / Product
- **Decision:** A `zw_org_context` cookie (httpOnly, `sameSite=lax`) holds which of the caller's own active Memberships to use when they have more than one. It is never trusted as authorization by itself — `resolveOrganizationContext()` re-validates it against a fresh `getActiveMemberships()` call on every request; a value matching none of the caller's own active Memberships is treated exactly like no cookie at all. A single active Membership auto-selects with no extra screen; multiple require `/select-organization`, a plain server-validated list (organization name + role only, no internal tenant metadata) — not a designed org-switcher component.
- **Status:** CONFIRMED — implemented and verified (`application-auth-test-matrix.md` MULTIORG-*/FOREIGNORG-* rows, including a forged-cookie test for both single- and multi-org users)
- **Reason:** Matches the work item's explicit instruction that "the caller choosing an organization UUID does not grant authority" and the smallest-safe-MVP recommendation already recorded in `application-route-map.md` "Multi-org UX" before this phase built it.
- **Affected Product Areas:** `src/lib/auth/organization.ts`, `/select-organization`
- **Dependencies:** ZD-103
- **Owner:** Security
- **Review Trigger:** A richer org-switcher UX (e.g. changing context without a full re-selection screen) — revisit the storage mechanism then if needed, not before

### ZD-105 — Route guards are UX-only; the database remains final authority

- **Date:** 2026-09-01
- **Category:** Architecture / Security
- **Decision:** `requireOperationsAccess()`/`requireDriverAccess()` are narrow, single-purpose functions that improve navigation (redirect a Driver to `/driver` instead of a confusing Operations denial, resolve `/` to the correct landing page) — they are explicitly not a reimplementation of RLS/RPC authorization, and no attempt was made to recreate every database policy in TypeScript. Every data read/write this application will ever perform remains independently enforced by the same database layer P1-E2-S1 through P1-E3-S0A built and exhaustively tested.
- **Status:** CONFIRMED
- **Reason:** Directly follows the work item's own explicit instruction (§30) and keeps a single source of truth for authorization — a bug in this application layer would be a UX defect (an unexpected redirect), never a security breach, because the database refuses an unauthorized caller regardless of what the application layer's own routing logic decided.
- **Affected Product Areas:** `src/lib/auth/authorization.ts`
- **Dependencies:** ZD-084, ZD-089 through ZD-102 (the entire database mutation/read-model architecture this layer sits in front of, none of it re-derived here)
- **Owner:** Security
- **Review Trigger:** None anticipated — this is the permanent intended relationship between the two layers

### ZD-106 — Live Membership/role/Driver-linkage resolution, no caching, at the application layer

- **Date:** 2026-09-01
- **Category:** Security
- **Decision:** `getActiveMemberships()` and the Driver-linkage check (`driver_get_profile` RPC call inside `requireDriverAccess()`) both re-query the database on every protected request. Nothing is cached in a session claim, a cookie, or module-level state. A Membership status/role change takes effect on the very next request using the same session — no sign-out/sign-in cycle required.
- **Status:** CONFIRMED — implemented and verified (the mandatory same-session revocation matrix, `application-auth-test-matrix.md`, all 10 steps across 3 scenarios passing)
- **Reason:** Extends ZD-077's live-check principle (established at the database/RLS layer in P1-E2-S1) to the application layer that now actually calls it — a cached role in this layer would silently reintroduce exactly the stale-authorization risk ZD-077 exists to prevent, one layer up from where it was originally solved.
- **Affected Product Areas:** `src/lib/auth/membership.ts`, `src/lib/auth/authorization.ts`
- **Dependencies:** ZD-077
- **Owner:** Security
- **Review Trigger:** None anticipated

### ZD-107 — Platform Admin routing posture: no tenant-Operations bypass

- **Date:** 2026-09-01
- **Category:** Security
- **Decision:** `PlatformAdminGrant` is never consulted by any route guard in this layer. A user holding only a Platform Admin grant (zero Memberships) is routed to `/access-unavailable`, identical to any other zero-Membership user.
- **Status:** CONFIRMED — implemented and verified (`application-auth-test-matrix.md` PLATFORMADMIN-1)
- **Reason:** Directly extends the database layer's own established posture (ZD-049: Platform Admin authority is a separate, narrow, read-scoped mechanism, never Membership-equivalent; work item §80 in P1-E2-S2 explicitly forbade an `is_platform_admin() OR ...` bypass in mutation authorization) to the application routing layer — no new reasoning was needed, only consistent application of an already-settled decision.
- **Affected Product Areas:** `src/lib/auth/authorization.ts`
- **Dependencies:** ZD-049
- **Owner:** Security
- **Review Trigger:** A future Platform Admin console — would need its own explicit, separately-reviewed routing decision, never assumed from this one

### ZD-108 — Redirect safety: allowlist, not denylist

- **Date:** 2026-09-01
- **Category:** Security
- **Decision:** `isSafeRedirectPath()` accepts only a single-leading-slash path built from `[A-Za-z0-9\-_/]` plus a simple query segment — everything else is rejected, including values that don't resemble any known attack pattern. Every `next`/`returnTo` value in the application (the `/sign-in?next=` query parameter, `selectOrganizationAction`'s form field) is validated through this one function before ever reaching `redirect()`.
- **Status:** CONFIRMED — implemented and verified (`application-auth-test-matrix.md` "Redirect safety", including a real POST to the actual sign-in Server Action with `https://evil.example` as `next`)
- **Reason:** An allowlist rejects an entire class of open-redirect vectors by construction (protocol-relative URLs, any absolute scheme, backslash tricks) rather than requiring every future attack variant to be individually enumerated and added to a denylist.
- **Affected Product Areas:** `src/lib/auth/redirect.ts`
- **Dependencies:** None
- **Owner:** Security
- **Review Trigger:** A genuine future need for a redirect target outside this pattern (e.g. a query string with different characters) — extend the allowlist deliberately, never widen it reflexively to unblock a specific case

### ZD-109 — Driver-linkage-missing renders inline, never redirects (avoids a redirect loop)

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `requireDriverAccess()` returns a discriminated `{ status: "ok" | "link-missing" }` result rather than redirecting when a `driver` Membership has no resolvable linked `drivers` row. The `/driver` layout renders a safe, non-crashing "account not yet set up" state inline for the `link-missing` case, with a sign-out action, no internal ID exposed.
- **Status:** CONFIRMED — implemented and verified (`application-auth-test-matrix.md` DRIVERLINK-1; the dedicated `org-a-driver-nolink` seed fixture added this phase)
- **Reason:** Any redirect target for this case is either `/driver` itself (an infinite loop, since the guard would fail identically on the next request) or a route with no clear ownership of this specific, narrow situation. Rendering inline avoids the loop entirely rather than routing around it.
- **Affected Product Areas:** `src/lib/auth/authorization.ts`, `src/app/driver/layout.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-110 — `getActiveMemberships()` corrected to filter by user_id explicitly (fixes a real cross-membership-visibility bug found this phase)

- **Date:** 2026-09-01
- **Category:** Security
- **Decision:** `getActiveMemberships()` now filters `.eq("user_id", user.id)` explicitly, not merely `.eq("status", "active")`. `memberships` carries two applicable RLS policies for a caller who is an `organization_admin`: `memberships_select_self` (their own row) and `memberships_select_org_admin` (every row in an org they administer) — these OR together under RLS, they don't narrow each other. A query with no `user_id` filter therefore returned every active Membership in any organization the caller administers, not just their own, for an org_admin caller specifically.
- **Status:** CONFIRMED — implemented and verified (found by `ROLE-1` failing against real seeded data during this phase's own integration testing — an Org A admin with exactly one Membership was incorrectly resolved as a multi-org user and routed to `/select-organization`; fixed, then the full 41-check suite re-run from a clean `supabase db reset` with zero remaining failures)
- **Reason:** RLS correctly protected the *table* (no cross-tenant row was ever exposed to the wrong tenant) — this was an application-layer *query-intent* bug, not an RLS gap: the query asked a broader question ("what can I see in `memberships`") than the one its caller actually needed answered ("what are MY OWN organizations"), and RLS answered the question it was actually asked, correctly. Recorded because it is exactly the kind of subtle "RLS scopes rows, but a query must still express what it actually means" mistake work item §17's own caution was written to prevent, caught here by genuine integration testing against real data rather than assumed correct from a passing build.
- **Affected Product Areas:** `src/lib/auth/membership.ts`
- **Dependencies:** None
- **Owner:** Security
- **Review Trigger:** Any future query against a table with more than one applicable SELECT policy for the same role — explicitly verify which policy will actually apply for the caller in question, not just that RLS is enabled

### ZD-111 — `requireDriverAccess` returns the full `driver_get_profile` row, not just `driver_id`

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `DriverAccessResult`'s `"ok"` branch now carries `displayName`/`phone`/`driverStatus` alongside `driverId`, all read from the `driver_get_profile` call `requireDriverAccess` already makes to resolve linkage. The Driver chrome header (avatar initials, identity subtitle) consumes these directly rather than issuing a second RPC call for the same row.
- **Status:** CONFIRMED — implemented and verified (`docs/reports/P1-E3-S2-completion-report.txt`; real HTML content checks confirm the header renders the real `display_name`)
- **Reason:** Matches work item §30's "prefer server-side initial data loading" and avoids a redundant round-trip for data already in hand — the authorization *decision* itself (the chain in ZD-105) is completely unchanged, only the data already being fetched for that decision is now also exposed to callers.
- **Affected Product Areas:** `src/lib/auth/types.ts`, `src/lib/auth/authorization.ts`, `src/app/driver/layout.tsx`, `src/components/driver/DriverLayoutClient.tsx`
- **Dependencies:** ZD-105 (route guards are UX-only; unaffected)
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-112 — Driver-facing canonical-state labels centralized in one function

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `driverTripStateLabel()` (`src/lib/driver/trip-presentation.ts`) is the single place canonical Trip state maps to a Driver-facing presentation label (`scheduled`→"Assigned", `en_route_to_pickup`→"Heading to Pickup", etc., per lifecycle-model.md §17 and the confirmed "Assigned" mapping in ui-data-action-map.md §6). The existing `TripStatus`/`TRIP_STATUS_MAP` label→category system (StatusBadge) is extended, not duplicated, with the four new leg-disambiguated labels this introduces.
- **Status:** CONFIRMED — implemented and verified (real HTTP content check confirms "Assigned" renders for the seeded `scheduled` fixtures)
- **Reason:** Matches ZD-089's "one place to look" principle, already applied to the backend's own transition table, extended to this presentation-layer derivation so a later Driver screen (Active Trip, Trips) reuses the same function rather than re-deriving it independently and risking drift (work item §17/§42).
- **Affected Product Areas:** `src/lib/driver/trip-presentation.ts`, `src/components/ui/TripStatus.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future Driver screen needing a state label not yet in this map — extend the same function, never a second parallel mapping

### ZD-113 — "Completed Today" omitted from Driver Today, not built with a degraded field set

- **Date:** 2026-09-01
- **Category:** Product / Security
- **Decision:** Driver Today does not include a "Completed Today" section this phase. `driver_list_active_trips` structurally excludes completed trips (no active assignment remains); `driver_list_trip_history` is the only alternative and deliberately redacts passenger identity and pickup/destination text (ZD-099). Rather than showing a materially degraded version of the Stitch reference's completed row (time + "Completed" only, no passenger/route) or widening `driver_list_trip_history`'s existing redaction to force a match, the section is omitted outright, pending a deliberate future decision. See GAP-10.
- **Status:** CONFIRMED
- **Reason:** Work item §58 requires recording a backend gap and stopping that part rather than bypassing the boundary; widening an existing, deliberately-reasoned privacy redaction (ZD-099) to unblock one screen's visual completeness is exactly the kind of silent-widening this project's established practice avoids.
- **Affected Product Areas:** `src/app/driver/page.tsx`
- **Dependencies:** ZD-099
- **Owner:** Product / Security
- **Review Trigger:** A genuine product need for full-fidelity recently-completed trip display — design a dedicated, narrowly-scoped projection then, not by widening history's existing redaction

### ZD-114 — Navigate/Call Passenger and passenger-notes content deferred to the Active Trip screen, not duplicated on Driver Today

- **Date:** 2026-09-01
- **Category:** Architecture / Product
- **Decision:** The featured Next Trip card on Driver Today carries exactly one action — "View Trip" (navigation only) — and does not include Navigate/Call Passenger buttons or the "Call passenger on arrival" note shown in the Stitch reference. Those depend on `passenger_phone`/`driver_notes`/`assistance_notes`, fields only `driver_get_trip_detail` returns (not `driver_list_active_trips`, which Today uses). Fetching trip detail an extra time solely to populate one card was rejected in favor of the application-implementation-plan.md's own framing: Driver Today is an orientation screen whose actions "delegate to 04" (the Active Trip screen).
- **Status:** CONFIRMED
- **Reason:** Matches work item §24/§25's explicit instruction not to prematurely implement Active Trip content or wire extra data-fetching for actions that belong to a later, not-yet-built phase; keeps Today's data source to exactly one RPC call.
- **Affected Product Areas:** `src/components/driver/DriverNextTripCard.tsx`, `src/app/driver/page.tsx`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** When the Active Trip screen (P1-E3-S3, recommended next phase) is built — revisit whether Today should link more directly into its actions, not before

### ZD-115 — Driver shell capped at max-w-md and centered on wide viewports

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `DriverShell`'s inner column is constrained to `max-w-md` (448px) and horizontally centered against a neutral background, rather than stretching full-bleed at tablet/desktop widths. At the 390/430 primary target widths this has no visible effect (448px exceeds the viewport). At 768/1024 it keeps the Driver surface intentionally compact — never a second Operations-style desktop layout, and never an enforced hard block on wider access either.
- **Status:** CONFIRMED — implemented; verified via direct inspection of the rendered HTML's class list (`max-w-md` present) and CSS reasoning, since no browser screenshot tooling was available this phase (see completion report "Mobile visual QA")
- **Reason:** Work item §5 explicitly requires the Driver product to "remain intentionally compact" at tablet widths, not "morph into the Operations desktop UI" — an unconstrained single mobile column stretched across a 1024px viewport satisfies neither: it isn't the Operations layout, but it also isn't compact. A capped, centered column is the smallest change that satisfies the actual requirement.
- **Affected Product Areas:** `src/components/driver/DriverShell.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-116 — Driver Today time/date formatting uses runtime-local timezone, no invented conversion architecture

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `formatTripTime`/`formatLongDate`/`isSameLocalDay` (`src/lib/driver/trip-presentation.ts`) format and compare dates using the standard `Intl` API with no explicit `timeZone` parameter — i.e., whatever timezone the Node process itself runs in. No per-organization or per-request timezone field/conversion layer is introduced, since none exists anywhere in the schema or any prior phase's architecture.
- **Status:** CONFIRMED — documented simplification, not silently assumed correct
- **Reason:** Work item §19 explicitly forbids inventing timezone conversion architecture in this phase. This is the smallest-possible-scope choice that still produces human-readable output; a real production deployment where the server's timezone differs from Georgia's could group a near-midnight trip into the adjacent calendar day on Driver Today — a known, bounded, cosmetic limitation, not a security or data-integrity issue.
- **Affected Product Areas:** `src/lib/driver/trip-presentation.ts`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** A canonical product timezone model is defined — update this one file, not a scattered set of ad hoc date calculations

### ZD-117 — Custom spacing tokens renamed to a `zw-` namespace to permanently eliminate the Tailwind v4 `--spacing-*`/`--container-*` collision

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** Every custom spacing token in `src/app/globals.css`'s `@theme` block is renamed from `--spacing-{2xs,xs,sm,md,lg,xl,2xl,3xl,4xl}` to `--spacing-zw-{2xs,xs,sm,md,lg,xl,2xl,3xl,4xl}` — numeric values unchanged. Every real consumer (36 occurrences across 19 files — `gap-*`, `p-*`/`px-*`/`py-*`, `m-*`/`mb-*`, `gap-x-*`/`gap-y-*`) was mechanically updated to the `zw-` prefixed class (e.g. `gap-md` → `gap-zw-md`, `p-lg` → `p-zw-lg`). `max-w-*`/`min-w-*` and any other Tailwind utility that reads the `--spacing-*` namespace as a fallback now resolves exclusively against Tailwind's own built-in `--container-*`/numeric scale, with nothing in this project's theme able to shadow it — for these 9 keys specifically, or for any future key, since `zw-` is not a t-shirt-size word Tailwind will ever define.
- **Status:** CONFIRMED — implemented and verified. Compiled CSS inspected directly, post-fix: `.max-w-sm{max-width:var(--container-sm)}` (24rem), `.max-w-md{max-width:var(--container-md)}` (28rem), `.max-w-lg{max-width:var(--container-lg)}` (32rem), `.max-w-xl{max-width:var(--container-xl)}` (36rem) — all four are Tailwind v4's own documented default container values (`node_modules/tailwindcss/theme.css`), not hardcoded or guessed. Full details: `docs/reports/P1-E3-S2B-design-token-driver-visual-report.txt`.
- **Reason:** P1-E3-S2A found and locally worked around (`max-w-[24rem]` on the sign-in card) a case of this collision; P1-E3-S2B's own repository-wide audit found it was systemic — every one of the project's 9 spacing keys shares a name with a Tailwind container-scale key, silently breaking `max-w-sm`/`md`/`lg`/`xl` (confirmed broken; `xs`/`2xs`/`2xl`/`3xl`/`4xl` share the same root cause though were unused as `max-w-*` at audit time) everywhere in the app, including `/select-organization` (`max-w-md`, silently broken since P1-E3-S1) and `DriverShell` (`max-w-md`, silently broken since P1-E3-S2 — the "448px compact Driver canvas" documented in ZD-115 was, in practice, computing to 16px until this fix). A durable fix had to remove the possibility of collision by construction (distinct namespace) rather than patch each symptom with arbitrary values, per the explicit instruction driving this phase.
- **Affected Product Areas:** `src/app/globals.css`, and every component/page consuming the gap/padding/margin scale (see report §5 for the full 19-file list) or a named `max-w-*`/`min-w-*` utility.
- **Dependencies:** ZD-115 (DriverShell's `max-w-md`, now genuinely 448px rather than nominally so)
- **Owner:** Engineering / Design Systems
- **Review Trigger:** Any future custom `@theme` addition — before naming a new token, check it against Tailwind's reserved namespace vocabulary (`--container-*`, `--text-*`, `--font-*`, `--leading-*`, `--tracking-*`, `--radius-*`, `--shadow-*`, `--ease-*`, etc., in `node_modules/tailwindcss/theme.css`) rather than assuming a project-chosen name is automatically safe — this is exactly the mistake that produced ZD-117 itself.

### ZD-118 — DriverShell gains a border at `sm:` and up, matching the design system's established panel convention

- **Date:** 2026-09-01
- **Category:** Design
- **Decision:** `DriverShell`'s capped `max-w-md` column gains `sm:border sm:border-border-subtle` alongside its existing `sm:shadow-md`, visible only at `sm:` (640px) and wider — the 390/430 primary target widths are unchanged (full-bleed, no border). Real visual QA at 768/1024/1440 (docs/design/qa/driver-today/) showed the capped column read as intentional even before this change (centered, shadowed, on a neutral `surface-secondary` background) — this is a small, additive refinement, not a fix for something broken.
- **Status:** CONFIRMED — implemented and verified via real screenshots at all three wider widths.
- **Reason:** The design system's own documented convention (application-implementation-plan.md "Distinguishing visual characteristics": "Subtle borders over shadows — panels are distinguished by a light border and background contrast, not drop shadows") was already established for every other panel in the app (`Panel.tsx`) but DriverShell's wider-viewport treatment used only a shadow. Adding the border brings it in line with that existing, already-approved convention rather than introducing a new decorative technique — the shadow was kept, not replaced, matching how `Panel`'s own `elevated` prop layers a shadow on top of its default border rather than substituting one for the other.
- **Affected Product Areas:** `src/components/driver/DriverShell.tsx`
- **Dependencies:** ZD-115
- **Owner:** Design / Engineering
- **Review Trigger:** None anticipated

### ZD-119 — Organization operational timezone: IANA-only, NOT NULL, no product-wide default

- **Date:** 2026-09-01
- **Category:** Architecture / Data model
- **Decision:** `organizations.timezone` (`text`, `NOT NULL`) is added as the organization's own authority for interpreting any of its `timestamptz` columns as a local calendar day/clock time. It must be a genuine IANA zone identifier (`Area/Location`) or the literal `UTC` — never a fixed offset or abbreviation (`EST`, `GMT-5`) — enforced by a `CHECK` constraint (ZD-120), not merely a naming convention. No product-wide default timezone was hardcoded anywhere in the schema, migration, or application code — every organization states its own value explicitly (existing rows backfilled deliberately per-row at migration time, new rows required to supply one at INSERT since there is no column default).
- **Status:** CONFIRMED — implemented and verified (217/217 SQL assertions including 13 new timezone-specific ones, real DST/midnight-boundary/multi-org/server-independence application-layer tests). Full record: docs/reports/P1-E3-S2C-operational-timezone-report.txt.
- **Reason:** Driver Today (P1-E3-S2) originally computed "today"/displayed times using the Next.js server process's own timezone — correct only by coincidence when server and organization agree, and a genuine operational-correctness defect (not cosmetic) the moment they don't: a late-evening organization-local trip could be silently reclassified onto the wrong calendar day. The fix had to be an explicit, validated, organization-owned fact — never inferred from the server, the browser, or a hardcoded launch-market assumption, since the architecture must remain geography-neutral as Zenward expands beyond its first market.
- **Affected Product Areas:** `organizations` table, `src/lib/auth/types.ts`/`membership.ts` (`OrganizationContext.organizationTimezone`), `src/lib/driver/trip-presentation.ts`, `src/app/driver/page.tsx`, `supabase/seed.sql`.
- **Dependencies:** ZD-104 (org context resolution — extended, not replaced), ZD-116 (the original, now-superseded timezone simplification this decision corrects)
- **Owner:** Engineering / Product
- **Review Trigger:** When Operations screens (Today's Operations, Dispatch Board, Trip Detail, scheduling presentation) are built — they reuse this same `OrganizationContext.organizationTimezone` field, not a parallel mechanism (work item §15 of P1-E3-S2C).

### ZD-120 — IANA timezone validator: a STABLE SQL function over `pg_timezone_names`, granted to `authenticated` (not revoked from public as the established internal-helper pattern would otherwise suggest)

- **Date:** 2026-09-01
- **Category:** Architecture / Security
- **Decision:** `public.is_valid_iana_timezone(text)` accepts a value only if it is `UTC` or contains `/` **and** is present in `pg_timezone_names` (Postgres's own tzdata catalog) — the `/`-or-`UTC` rule specifically excludes `pg_timezone_names`' own legacy backward-compatibility entries (`EST`, `PST8PDT`, `Japan`, `GMT-0`, etc. — confirmed present in that catalog, and confirmed exactly the class this work item requires rejecting) that a bare catalog-membership check alone would not exclude. `STABLE`, not `IMMUTABLE` (it genuinely queries a system catalog) and **not** `SECURITY DEFINER` (it needs no elevated privilege — `pg_timezone_names` is already a public system view). `EXECUTE` is granted to `authenticated` — this deliberately departs from this project's established "revoke all internal helpers from public" pattern (e.g. `_is_valid_trip_transition`), because that pattern's safety depends on the helper being called only from within a `SECURITY DEFINER` wrapper (which runs as the function owner, unaffected by the caller's own grants); a `CHECK` constraint has no such wrapper — it evaluates under the privileges of whichever role is performing the `INSERT`/`UPDATE`, for **every** `CHECK` constraint on the row, regardless of which columns actually changed. Revoking `authenticated`'s `EXECUTE` was tried and directly, empirically confirmed to break an Organization Admin's ordinary `UPDATE organizations SET status = ...` (which never touches `timezone` at all) with `permission denied for function is_valid_iana_timezone` — not assumed, reproduced live before this grant was added.
- **Status:** CONFIRMED — implemented and verified (`organization_timezone_tests.sql` TZ-VALID-1/TZ-INVALID-1/TZ-CONSTRAINT-1..3/TZ-PRIVILEGE-1/2, plus a direct live reproduction of the break-then-fix).
- **Reason:** A narrow, maintainable, standards-based validation boundary was required (work item §6) without building a timezone-management feature. This is the correct, minimal mechanism — and the privilege nuance above is recorded explicitly so a future internal-helper function relying on the "just revoke from public" reflex doesn't silently reintroduce this exact class of bug the moment it's referenced from a `CHECK` constraint rather than a `SECURITY DEFINER` wrapper.
- **Affected Product Areas:** `public.is_valid_iana_timezone`, `organizations_timezone_valid_iana` (the `CHECK` constraint)
- **Dependencies:** ZD-119
- **Owner:** Security / Engineering
- **Review Trigger:** Any future `CHECK` constraint that calls a helper function — verify the calling role's own `EXECUTE` privilege explicitly, by live test, not by analogy to the `SECURITY DEFINER`-wrapped internal-helper pattern.

### ZD-121 — Seed fixture timezones: Org A and Org B deliberately differ, neither is a product-wide default

- **Date:** 2026-09-01
- **Category:** Product / Testing
- **Decision:** The two local seed organizations are assigned explicit, **different** timezones — Org A (`Fictional Org A`) = `America/New_York`, Org B (`Fictional Org B`) = `America/Chicago` — rather than both defaulting to the same value. Org A's value matches the Georgia-launch framing already established throughout this project's fixtures; Org B's is a deliberately distinct real US timezone chosen specifically so the existing `multi-org-user@example.test` fixture (Org A admin, Org B driver) exercises genuine multi-organization-timezone-context behavior without inventing new fixtures. Neither value is read anywhere in application/migration code as a default — the migration's own backfill (for hypothetically pre-existing rows) independently uses `America/New_York`, matching the actual current single-market reality, but that backfill path is a no-op on every fresh `db reset` (seed.sql's own explicit `INSERT ... timezone` values are what actually apply, and always will, until a real second market exists).
- **Status:** CONFIRMED — implemented and verified (`organization_timezone_tests.sql` TZ-SEED-1; real live query against `multi-org-user@example.test`'s own session confirming both distinct values resolve correctly per organization).
- **Reason:** Work item §5/§13 explicitly required assigning deliberate, appropriate fixture values (not a blanket default) and explicitly required real multi-org-timezone test coverage — differentiating the two existing seed organizations satisfies both without adding a third fixture organization or a third fixture user.
- **Affected Product Areas:** `supabase/seed.sql`
- **Dependencies:** ZD-119
- **Owner:** Engineering
- **Review Trigger:** None anticipated

### ZD-122 — Driver presentation helpers require an explicit timezone parameter; no fallback

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `formatTripTime`, `formatLongDate`, and `isSameOperationalDay` (renamed from `isSameLocalDay` — `src/lib/driver/trip-presentation.ts`) all take `timezone: string` as a **required**, non-optional parameter. There is no default value and no fallback to the runtime's own local timezone anywhere in this file. A future call site with no timezone available has a bug to fix at that call site, not a default to silently reach for here.
- **Status:** CONFIRMED — implemented; TypeScript's own required-parameter checking is the enforcement mechanism (verified: `tsc --noEmit` would reject any call site omitting the argument).
- **Reason:** Work item §10 of P1-E3-S2C explicitly forbids a silent server-local fallback for operational screens — the entire point of this phase was eliminating exactly that failure mode, so the fix had to make it a compile-time impossibility to reintroduce, not merely a documented convention.
- **Affected Product Areas:** `src/lib/driver/trip-presentation.ts`, `src/app/driver/page.tsx`
- **Dependencies:** ZD-119, supersedes the runtime-local-timezone approach from P1-E3-S2 (originally recorded at ZD-116)
- **Owner:** Engineering
- **Review Trigger:** None anticipated — any future Driver/Operations screen needing time formatting reuses these same functions, inheriting the same guarantee.

### ZD-123 — `create_trip`'s `timestamptz` scheduling parameters are already correct; the open question is a future UI's own responsibility, not an RPC change

- **Date:** 2026-09-01
- **Category:** Architecture (documentation-only decision — no code changed)
- **Decision:** `create_trip`'s `p_scheduled_pickup_at`/`p_appointment_at` parameters (docs/data/mutation-api.md) are `timestamptz` — an absolute, already-UTC-normalized instant — and remain unchanged in this phase. This is already correct at the database layer: a `timestamptz` parameter needs no timezone tag of its own once supplied. The genuinely open question is entirely a *future UI* concern: whichever Operations "New Trip" form is eventually built (P1-E3-S6, not yet built) must convert a locally-entered wall-clock time ("10:00 AM") into a correct UTC instant using the organization's own `timezone` (now available via `OrganizationContext.organizationTimezone`) before calling `create_trip` — no such conversion exists yet because no such form exists yet.
- **Status:** CONFIRMED — inspected, not modified, per explicit instruction (work item §16 of P1-E3-S2C: "Do not reinterpret input timestamps or redesign create_trip in this phase unless current API semantics genuinely require correction" — they don't).
- **Reason:** Recording this now, before the relevant UI is built, means the future form's own implementation phase starts from a documented, already-identified requirement rather than rediscovering the same timezone-conversion question P1-E3-S2C exists to answer.
- **Affected Product Areas:** None changed; `create_trip` (docs/data/mutation-api.md) is the forward reference point.
- **Dependencies:** ZD-119, ZD-102 (`create_trip`'s original architecture)
- **Owner:** Product / Engineering
- **Review Trigger:** When the Internal New Trip / scheduling-presentation UI is actually built — implement the local-to-UTC conversion there, using `organizationTimezone`, before any timestamp reaches `create_trip`.

### ZD-124 — Driver lifecycle completion redirects server-side, from within the Server Action, not client-side after the fact

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `progressTripAction` (`src/app/driver/trips/[tripId]/actions.ts`) calls `redirect("/driver")` directly, server-side, when the mutation just performed was `driver_complete_trip` — not a client-side `router.push()` triggered from a `useActionState` success effect.
- **Status:** CONFIRMED — implemented and verified via a real end-to-end lifecycle test (headless Chrome, real form submits, real Server Action, real RPCs).
- **Reason:** The client-side approach was built first and failed a real test, not a hypothetical one: Next.js automatically re-renders the current route's Server Component tree once any Server Action completes (to reflect its own `revalidatePath()` calls). Since `driver_complete_trip` closes the active assignment in the same transaction as completing the Trip, that automatic re-render re-fetches `driver_get_trip_detail` for a now-inaccessible Trip and renders "Trip unavailable" — which won the race against a client `useEffect`'s `router.push()` every time, in real testing. A server-side `redirect()` thrown from within the action itself pre-empts this entirely, rather than attempting to out-race Next.js's own automatic behavior client-side.
- **Affected Product Areas:** `src/app/driver/trips/[tripId]/actions.ts`, `src/components/driver/DriverLifecycleAction.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Any future Server Action whose success should navigate away from a route the action itself makes inaccessible — use the same server-side `redirect()` pattern, not a client effect.

### ZD-125 — "Report Issue"/"Trip Details" deliberately deferred from Active Trip, not built

- **Date:** 2026-09-01
- **Category:** Product / Scope
- **Decision:** The Active Trip screen implements exactly the lifecycle-progression path (route, passenger requirements, one primary action) and omits the reference's secondary "Report Issue"/"Trip Details" action row entirely this phase.
- **Status:** CONFIRMED
- **Reason:** `trip_exceptions_insert_assigned_driver` (the backend path "Report Issue" would use) genuinely exists and is ready — this is a scope decision, not a backend gap. Building it would introduce a new, separate write surface needing its own dedicated security/functional test coverage, disproportionate to this phase's primary mandate (work item §4: open Trips → find the assignment → progress the lifecycle → completion). "Trip Details"' own destination was flagged ambiguous (`stitch-reference-index.md`) with no clear target. Matches the explicit permission in work item §26: "Otherwise defer to a focused future phase."
- **Affected Product Areas:** `src/app/driver/trips/[tripId]/page.tsx`
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A future, dedicated Driver-issue-reporting phase — build it as its own reviewed surface, not retrofitted here.

### ZD-126 — Directions provider: a plain Google Maps web-search URL, no SDK

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `directionsUrl()` (`src/lib/driver/maps.ts`) builds `https://www.google.com/maps/search/?api=1&query=<address>` — no mapping SDK, no API key, no dependency. Sends only the address text already visible on screen (Trip's own pickup/destination snapshot) — never a Passenger name or phone.
- **Status:** CONFIRMED — implemented and verified (real screenshot QA shows the Navigate button; the URL construction is a pure, directly-testable function).
- **Reason:** Work item §14 explicitly prefers a safe external maps URL over an SDK and asks that an unresolved provider choice be recorded rather than block on it. Google Maps' public web endpoint works identically across iOS/Android/desktop with one URL shape (opens the native app via universal link on mobile, the web version on desktop) — the simplest option that needs no per-platform branching.
- **Affected Product Areas:** `src/lib/driver/maps.ts`, `src/components/driver/DriverActiveTripLegs.tsx`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** A genuine future need for a different provider (e.g. an organization-specific preference) — revisit deliberately then, not reflexively.

### ZD-127 — Call Passenger is scoped to the pickup leg only

- **Date:** 2026-09-01
- **Category:** Product
- **Decision:** The Call Passenger action (`tel:` link, using `driver_get_trip_detail.passenger_phone`) is shown only while the pickup leg is current (`scheduled`/`en_route_to_pickup`/`arrived_at_pickup`) — it disappears once `passenger_onboard` and beyond.
- **Status:** CONFIRMED — implemented and verified.
- **Reason:** The reference screenshot only shows this button during `en_route_to_pickup`, leaving the later-leg behavior undecided. Once the passenger is physically in the vehicle, calling them serves no operational purpose — a deliberate design decision extending the reference's own visible logic, not one dictated by it.
- **Affected Product Areas:** `src/components/driver/DriverActiveTripLegs.tsx`, `src/lib/driver/trip-presentation.ts` (`currentLeg()`)
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** None anticipated

### ZD-128 — Driver History: a minimal, functional screen built directly against the redacted history projection (partial resolution of GAP-3)

- **Date:** 2026-09-01
- **Category:** Product / Security
- **Decision:** `/driver/history` is implemented as a minimal, functional list (date, time, outcome/end-reason badge) built entirely around what `driver_list_trip_history` actually returns — no passenger name, no route, matching that RPC's deliberate redaction (ZD-099). No Stitch reference exists for this screen; none was fabricated. `driver_get_trip_detail` is never called for a historical Trip to "recover" the redacted fields — that RPC correctly denies access once an assignment has ended, and this screen does not attempt to work around that.
- **Status:** CONFIRMED — implemented; GAP-3 (ui-backend-gap-register.md) updated to reflect History now has a minimal built version — Driver Profile remains open (out of scope this phase, no route change made there).
- **Reason:** GAP-3's own recorded recommendation was "build minimal functional versions... when their implementation phase arrives" — this phase's explicit mandate ("6. trip history where supported") is that arrival, for History specifically. Security minimization outranks screenshot fidelity (work item §9's own explicit instruction) — the row design followed the RPC's real field set, not an imagined richer one.
- **Affected Product Areas:** `src/app/driver/history/page.tsx`
- **Dependencies:** ZD-099
- **Owner:** Product / Security
- **Review Trigger:** A genuine future Stitch reference for this screen, or a deliberately-reviewed decision to widen the history projection — neither assumed here.

### ZD-129 — Real `user_profiles.display_name` identity resolution, replacing the raw session email

- **Date:** 2026-09-01
- **Category:** Product / Security
- **Decision:** `OperationsLayoutClient` now receives a `dispatcherDisplayName` resolved server-side by a new `getDisplayName()` helper (`src/lib/auth/profile.ts` — `user_profiles.display_name`, RLS: `user_profiles_select_own`), falling back to the session email only when no profile row exists. It no longer receives, or passes through, the raw `user.email` as a "name".
- **Status:** CONFIRMED — implemented; the fallback path is genuinely exercised (no seed data populates `user_profiles.display_name` for any fixture user, and no auto-provisioning trigger exists — confirmed by inspecting `supabase/seed.sql` and every migration).
- **Reason:** The pre-P1-E3-S4 `OperationsLayoutClient` passed `user.email` straight into the sidebar's `dispatcherName` slot — a real, if minor, identity-leak-as-name gap noticed while building this phase's header/avatar work, not something the work item asked for by name. Fixing it where it lives (the shared layout) rather than only in the new header avoids the same raw-email leak resurfacing the moment a future screen also wants to show the current user's name.
- **Affected Product Areas:** `src/lib/auth/profile.ts`, `src/app/operations/layout.tsx`, `src/components/operations/OperationsLayoutClient.tsx`, `src/components/operations/AppHeader.tsx`
- **Dependencies:** None
- **Owner:** Engineering / Security
- **Review Trigger:** A future profile self-service or auto-provisioning flow that actually populates `user_profiles.display_name` — no code change needed here when that lands, the resolution already prefers it.

### ZD-130 — Needs Attention narrowed to Needs-Assignment only; Driver Availability panel omitted entirely

- **Date:** 2026-09-01
- **Category:** Product / Scope
- **Decision:** Today's Operations' Needs Attention panel shows Needs-Assignment rows only (never "Running Late"/"Pending Confirmation"). The reference's "Driver Availability" panel is not built at all — not degraded to a partial "On Trip"-only version.
- **Status:** CONFIRMED — implemented and verified (functional matrix test A8, docs/design/qa/todays-operations/ screenshots).
- **Reason:** Both are pre-existing, already-recorded gaps (ui-backend-gap-register.md "PRODUCT DECISIONS REQUIRED" for Running Late/Pending Confirmation; GAP-6 for Driver Availability) — this phase's job was applying those established deferrals to a real screen, not re-litigating them. Inventing a Running Late threshold or a Pending Confirmation concept to fill out the reference would be fabricated business logic, not a legitimate content simplification. A partial Driver Availability panel showing only "On Trip" was considered and rejected as added visual clutter with no information Today's Operations' own summary strip doesn't already report.
- **Affected Product Areas:** `src/app/operations/page.tsx`, `src/lib/operations/todays-operations.ts`
- **Dependencies:** ui-backend-gap-register.md GAP-6, "PRODUCT DECISIONS REQUIRED" table
- **Owner:** Product
- **Review Trigger:** A future, deliberately-reviewed product decision defining a Running Late threshold, a Pending Confirmation concept, or a Driver Availability schema — none assumed here.

### ZD-131 — Active Trips query is deliberately NOT bounded to "today"

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** The Active Trips panel (and the "active" summary count) query every Trip in one of the 5 non-terminal in-progress states, organization-scoped, with no `scheduled_pickup_at` day-window filter — unlike the Needs Attention/Upcoming Trips/Completed-Today panels, which are all bounded to the organization's local "today".
- **Status:** CONFIRMED — implemented (`getTodaysOperations()`, query 2).
- **Reason:** An in-progress Trip is happening right now by construction — bounding it to "scheduled for today" would incorrectly hide a running-late Trip whose `scheduled_pickup_at` technically fell on the prior org-local day, the exact opposite of what an operations dispatcher needs to see. The panel's own transience (a Trip cannot realistically stay "active" for days) makes the unbounded query safe in practice.
- **Affected Product Areas:** `src/lib/operations/todays-operations.ts`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated — revisit only if a future Trip type is intentionally long-running (e.g. a multi-day trip concept), which does not exist today.

### ZD-132 — `AppHeader`'s richer per-route content is owned by `OperationsLayoutClient`, not a new cross-tree state channel

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `AppHeader` gained optional `title`/`description`/`avatarName` props. The Overview route's specific header content (title, org-local date, search/Export/New-Trip cluster) is composed directly inside `OperationsLayoutClient` (keyed off `pathname`), which already has everything that content needs (`organization.organizationTimezone` plus static content) — not pushed up from the page itself via a new React Context/portal.
- **Status:** CONFIRMED — implemented and verified (functional matrix + visual QA).
- **Reason:** The reference's title/date/actions genuinely live in the persistent chrome header, not the scrollable `PageHeader` below it — a real composition constraint, not a stylistic choice. A page-to-layout state channel was considered (a page calling something like `useSetAppHeader()`) but rejected as unnecessary complexity: every action in this specific header is static or disabled this phase (Search/Export are inert, New Trip is a plain link), so nothing here actually needs page-supplied data. A future route whose header DOES need page-driven content (e.g. a live-computed count) is the real trigger to revisit this.
- **Affected Product Areas:** `src/components/operations/AppHeader.tsx`, `src/components/operations/OperationsLayoutClient.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future Operations route whose persistent header needs content only the page component itself computes.

### ZD-133 — `SummaryStrip` gains an additive `inline`/`dot` layout; original stacked layout unchanged

- **Date:** 2026-09-01
- **Category:** Architecture / Design System
- **Decision:** `SummaryStrip` (`src/components/ui/SummaryStrip.tsx`) gained an optional `inline` prop (single flowing row, matching the reference's compact metric strip) and a per-item `dot` flag — the original stacked value-over-label layout remains the default and is unchanged.
- **Status:** CONFIRMED — implemented; the one pre-existing call site (`src/app/foundation`'s showcase, `SummaryStrip`'s only other usage in the codebase) was confirmed unaffected (no `inline`/`dot` passed, renders identically).
- **Reason:** component-inventory.md had explicitly flagged this exact question before this phase ("`SummaryStrip` may already suffice... confirm which pattern before building"). Since the component had genuinely zero other real call sites at the time of this change, extending it safely was possible without any risk to a screen this project hasn't built yet; a future screen needing the stacked variant still gets it by default.
- **Affected Product Areas:** `src/components/ui/SummaryStrip.tsx`, `src/app/operations/page.tsx`
- **Dependencies:** None
- **Owner:** Engineering / Design
- **Review Trigger:** A second real (non-showcase) stacked-layout consumer appearing — confirms the default should stay stacked; if none ever appears, a future cleanup could reconsider which layout is the default.

### ZD-134 — Search input, Export Day Sheet, and the Upcoming Trips "Filter" control: disabled vs. omitted, not faked

- **Date:** 2026-09-01
- **Category:** Product
- **Decision:** Search and Export Day Sheet are rendered as real, visible, `disabled` controls (with a `title` explaining why). The reference's "Filter" control on Upcoming Trips is omitted from the DOM entirely, not rendered as a disabled affordance.
- **Status:** CONFIRMED — implemented.
- **Reason:** Search/Export are prominent, expected controls whose ABSENCE would itself look like a bug on a screen this visually complete — rendering them disabled communicates "not yet wired" honestly without silently promising a working feature (GAP-9 already established this exact treatment for Export). Filter is a smaller, secondary affordance without an established `ui-backend-gap-register.md` entry of its own; omitting it entirely avoids inventing a placeholder for a control with no defined behavior even once "wired", which disabling would have implied existed.
- **Affected Product Areas:** `src/components/operations/OperationsLayoutClient.tsx`, `src/app/operations/page.tsx`
- **Dependencies:** ui-backend-gap-register.md GAP-9
- **Owner:** Product
- **Review Trigger:** A dedicated future search/filter/export work item — none of the three should be retrofitted into a data-focused phase again.

### ZD-135 — `SearchInput`'s `className` prop only reaches its inner `<input>`, not its wrapper — found and fixed during 768px visual QA

- **Date:** 2026-09-01
- **Category:** Bug fix
- **Decision:** The header's search control is now wrapped in its own `<div className="hidden lg:block">` around a plain `<SearchInput className="w-64" .../>`, instead of passing `hidden w-64 lg:block` directly as `SearchInput`'s own `className`.
- **Status:** CONFIRMED — found by real 768px-width headless-Chrome screenshot QA (not a hypothetical review), fixed, and re-verified by re-capturing the same screenshot.
- **Reason:** `SearchInput` forwards its `className` prop only to the inner `<input>` element (`src/components/ui/SearchInput.tsx`), not to the component's own outer wrapping `<div>` (which also renders the magnifying-glass icon via a sibling absolutely-positioned element). Passing `hidden lg:block` as `className` therefore hid only the `<input>` — the wrapper (and its icon) kept rendering at its normal flex-item size below the `lg` breakpoint, producing a tiny floating icon-shaped box with no input next to it. This is exactly the kind of defect the work item's mandatory real-screenshot visual QA (not component/class inspection alone) exists to catch — it would not have been visible from reading the JSX.
- **Affected Product Areas:** `src/components/operations/OperationsLayoutClient.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Any future caller conditionally hiding a `SearchInput` (or any other component whose `className` prop is documented/observed to reach only an inner element, not its wrapper) — wrap it, don't rely on the prop reaching the outermost box.

### ZD-136 — Grid blocks are fixed-width, positioned only by start time — no fabricated duration

- **Date:** 2026-09-01
- **Category:** Architecture / Data integrity
- **Decision:** Every Trip block in the "Today's Assignments" time-axis grid (`src/lib/operations/dispatch-grid.ts`, `AssignmentGrid`) renders at the same fixed pixel width, positioned only by its real `scheduled_pickup_at` — never stretched proportional to a duration.
- **Status:** CONFIRMED — implemented and visually verified (docs/design/qa/dispatch-board/).
- **Reason:** `trips` has no duration or expected-dropoff field — confirmed directly against `database.types.ts` (`scheduled_pickup_at`/`appointment_at` only). The reference's own blocks have visible width suggesting duration, but inventing one would be fabricated data on a screen this project has otherwise been careful never to do that on. A fixed-width, start-time-anchored block is an honest simplification of the visual, not a structural deviation (layout/column-structure/hierarchy are all preserved).
- **Affected Product Areas:** `src/lib/operations/dispatch-grid.ts`, `src/components/operations/dispatch/AssignmentGrid.tsx`
- **Dependencies:** None
- **Owner:** Engineering / Product
- **Review Trigger:** A future schema addition of a real Trip duration/expected-dropoff field — revisit proportional block sizing then, not before.

### ZD-137 — Grid time window is a fixed 6 AM–8 PM org-local span, not dynamically computed

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** The grid always shows 6:00 AM–8:00 PM (org-local), regardless of what today's actual Trip times are — never a per-day dynamically-sized window.
- **Status:** CONFIRMED — implemented.
- **Reason:** A fixed window is simple, deterministic, and trivially testable (`gridHourLabels()`/`gridBlockLeftPx()` are pure functions with no dependency on the day's actual data); a dynamically-sized window would need arbitrary padding/clamping rules invented from nothing, for a real usability benefit that hasn't been asked for. The reference's own header shows a fixed-looking "08:00 AM - 03:00 PM" label, consistent with a bounded, not computed, window being an acceptable pattern here.
- **Affected Product Areas:** `src/lib/operations/dispatch-grid.ts`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** Real usage showing trips regularly falling outside 6 AM–8 PM (clamped to the nearest edge today, not lost) — widen the constants then.

### ZD-138 — No drag-and-drop; a deliberate click → dialog → confirm flow instead

- **Date:** 2026-09-01
- **Category:** Product / Accessibility
- **Decision:** Assignment and reassignment are both driven by clicking a card/block to open `AssignmentDialog`, choosing a Driver (and optionally a Vehicle) from real `<select>` options, and clicking an explicit, clearly-labeled submit button. No drag-and-drop was built.
- **Status:** CONFIRMED — implemented and verified (real E2E application tests, `docs/reports/P1-E3-S5-completion-report.txt`).
- **Reason:** The reference's spatial grid visually suggests drag-and-drop, but no interaction contract confirms it (stitch-reference-index.md: "implied, not confirmed"), and the work item's own default is to prefer a deliberate flow over reflexively building drag-and-drop. Drag-and-drop would add real accessibility complexity (keyboard operability, screen-reader announcement of a spatial drop target), mutation ambiguity (what exactly does dropping a block onto a different driver's row at a different time mean — reassign only, or also reschedule?), and accidental-assignment risk on touch/tablet — none of which a click-then-confirm flow has.
- **Affected Product Areas:** `src/components/operations/dispatch/AssignmentGrid.tsx`, `src/components/operations/dispatch/NeedsAssignmentQueue.tsx`, `src/components/operations/dispatch/AssignmentDialog.tsx`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** A future, deliberately-scoped drag-and-drop work item with its own accessibility design — not assumed or half-built here.

### ZD-139 — The Dialog primitive is built on the native `<dialog>` element, not a new UI library

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `src/components/ui/Dialog.tsx` — the design system's first Dialog/Modal — wraps the native `<dialog>` element (`showModal()`/`close()`, the native `close` event, native focus trapping) rather than a third-party modal library.
- **Status:** CONFIRMED — implemented; keyboard/focus behavior verified (see completion report Accessibility section).
- **Reason:** Work item §53 explicitly asks not to introduce a heavyweight UI library solely for one modal, and no Dialog/Modal primitive existed before this phase to reuse. `<dialog>` gives real focus trapping, ESC handling, and top-layer stacking for free in every supported browser, at the cost of one explicit `dialog::backdrop` CSS rule (native backdrops are transparent by default) — the smallest correct implementation, not a compromise.
- **Affected Product Areas:** `src/components/ui/Dialog.tsx`, `src/app/globals.css`, `src/components/operations/dispatch/AssignmentDialog.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** A future need this primitive doesn't cover (e.g. a non-modal popover, a multi-step wizard) — extend or add alongside it, not necessarily replace it.

### ZD-140 — Driver Capacity shows real "On Trip" only; `StatusBadge` directly, not the existing `DriverStatus` component

- **Date:** 2026-09-01
- **Category:** Product / Data integrity
- **Decision:** `DriverCapacityPanel` renders `<StatusBadge label="On Trip" category="active">` directly, computed from a real active-state assignment — never the existing `DriverStatus` component (`src/components/ui/DriverStatus.tsx`), and never a status badge at all when a Driver has nothing in progress right now.
- **Status:** CONFIRMED — implemented and verified (functional matrix explicitly asserts AVAILABLE/CONFLICT/BREAK never appear).
- **Reason:** `DriverStatus`'s own `DRIVER_STATUS_MAP` still encodes the full illustrative Available/On Trip/Break/Unavailable set from the original P1-E3-S0 Stitch-ingestion mockup pass — a real component, but built against sample labels, not live data. Reusing it here would risk a future unrelated edit to that map (e.g. a color/wording tweak) silently reintroducing a fabricated status onto a real screen through a component neither this phase's code nor its author would think to re-check. GAP-6 (Driver Availability has no schema representation) applies here exactly as it did on Today's Operations (ZD-130).
- **Affected Product Areas:** `src/components/operations/dispatch/DriverCapacityPanel.tsx`
- **Dependencies:** GAP-6 (ui-backend-gap-register.md)
- **Owner:** Product / Engineering
- **Review Trigger:** A real Driver Availability schema landing — `DriverCapacityPanel` gets its own deliberate update then, not a reflexive switch back to `DriverStatus`.

### ZD-141 — Dispatch's Trip query IS bounded to today's window, unlike Today's Operations' unbounded Active Trips list

- **Date:** 2026-09-01
- **Category:** Architecture
- **Decision:** `getDispatchBoardData()` filters every Trip by today's `scheduled_pickup_at` window, including in-progress ones — a deliberate difference from Today's Operations' Active Trips panel (ZD-131), which is explicitly NOT bounded to today.
- **Status:** CONFIRMED — implemented.
- **Reason:** The center grid is inherently a TODAY time axis — an in-progress Trip whose `scheduled_pickup_at` fell outside today's window has no meaningful horizontal position on it, unlike a flat list (Today's Operations' Active Trips), which has no such spatial constraint. This is a genuine architectural difference between a list and a time-grid, not an inconsistency between the two screens' otherwise-identical day-bounds helper (`organizationDayBoundsUtc`, reused unchanged from `src/lib/operations/day-bounds.ts`).
- **Affected Product Areas:** `src/lib/operations/dispatch-board.ts`
- **Dependencies:** ZD-131
- **Owner:** Engineering
- **Review Trigger:** None anticipated.

### ZD-142 — Stale reassignment's real "last-write-wins" behavior is documented, not routed around — **SUPERSEDED by ZD-145 (P1-E3-S5A)**

- **Date:** 2026-09-01
- **Category:** Product / Security
- **Decision:** `reassign_trip` has no "expected current driver" precondition (confirmed by reading its actual SQL) — a dispatcher's reassignment succeeds against whatever assignment is currently active, even if their own UI was stale when they chose a replacement driver. This phase does not add a client-side or RPC-level check to force a rejection in this case.
- **Status:** **SUPERSEDED — 2026-09-01, same day, by ZD-145.** P1-E3-S5's own real, live-application concurrency testing (which THIS decision was written to document honestly) was the direct evidence that motivated hardening `reassign_trip` in the very next phase, P1-E3-S5A. "Transactionally safe" (still true) was correctly distinguished from "operationally desirable" (found NOT to be) — the work item that opened P1-E3-S5A said so explicitly. This decision's own text remains below, UNCHANGED, as an honest record of what was true and why it was accepted at the time — not rewritten to look as though the gap was anticipated. **As of P1-E3-S5A, a stale reassignment is DENIED, not accepted as "last write wins" — see ZD-145.**
- **Reason (as originally recorded — no longer the current behavior):** This is the RPC's real, intentional contract (`docs/security/mutation-authorization.md`: ops actions authorize by live-checked org-level role, not personal/instance-specific state — any currently-authorized Dispatcher may legitimately act on a Trip's current state regardless of who acted on it last). It is also provably safe: exactly one active assignment always exists (the atomic close-then-insert, backed by the row lock and the partial unique index), so a "stale" reassignment cannot corrupt data — it just means the latest human decision is what takes effect, which is correct behavior for a live operational tool, not a bug to paper over with an invented precondition the RPC's own author didn't build.
- **Affected Product Areas:** `src/app/operations/dispatch/actions.ts`, `src/components/operations/dispatch/AssignmentDialog.tsx`
- **Dependencies:** None
- **Owner:** Product / Security
- **Review Trigger:** (Original, now moot) A genuine future product requirement for reassignment to be conditioned on an expected prior driver — resolved by ZD-145, the very next phase.

### ZD-143 — 3-column layout activates at `xl` (1280px), not ~1024px — revised after real visual QA

- **Date:** 2026-09-01
- **Category:** Architecture / Visual fidelity
- **Decision:** The Dispatch Board's 3-column grid (`grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_280px]`) activates at Tailwind's `xl` breakpoint (1280px), stacking to a single column below it. `application-route-map.md`'s original pre-implementation note framed ~1024px as "the intended minimum Operations width" for this screen.
- **Status:** CONFIRMED — implemented; verified via real screenshots at all 5 required widths (docs/design/qa/dispatch-board/).
- **Reason:** That note was a planning-stage estimate, made before any real layout existed to measure. Building the actual grid and capturing real 1024px/1280px screenshots showed three genuinely useful columns do not fit in 1024px of width even with narrow (280px) side rails — the center grid would be reduced to showing well under an hour of the day. A single-column stack (queue, then a horizontally-scrollable grid, then capacity rail — all full-width) reads cleanly and loses no information (the grid already requires horizontal scroll to see the full day even at 1440/1600) at 1024/768, while 1280 and above get the full 3-column reference composition. This is an informed revision based on the finished implementation, not a shortcut.
- **Affected Product Areas:** `src/components/operations/dispatch/DispatchBoardClient.tsx`, `docs/product/application-route-map.md` (its ~1024px note is now superseded by this entry for this specific screen)
- **Dependencies:** None
- **Owner:** Engineering / Design
- **Review Trigger:** A future redesign of the grid's own column widths that changes how much fits at 1024 — re-measure before changing the breakpoint again.

### ZD-144 — Day navigator and "Dispatch Settings" are real, visible, disabled controls — not omitted, not faked

- **Date:** 2026-09-01
- **Category:** Product
- **Decision:** The header's ‹ Today › day navigator and "Dispatch Settings" button are both rendered, real, and `disabled`, each with a `title` explaining why — extending the same treatment ZD-134 established for Today's Operations' Search/Export Day Sheet.
- **Status:** CONFIRMED — implemented.
- **Reason:** Both are prominent, expected controls in the reference whose total absence would itself look like a bug on an otherwise-complete header. The board only ever queries the organization's own "today" (no other-day query was built this phase), and "Dispatch Settings" has no defined behavior anywhere in this project — disabling, rather than hiding or faking function, communicates "not yet wired" honestly.
- **Affected Product Areas:** `src/components/operations/OperationsLayoutClient.tsx`
- **Dependencies:** ZD-134
- **Owner:** Product
- **Review Trigger:** A dedicated future multi-day Dispatch view, or a defined "Dispatch Settings" feature — neither designed here.

### ZD-145 — `reassign_trip` gains an explicit `p_expected_assignment_id` optimistic-concurrency precondition — supersedes ZD-142 — **AMENDED by ZD-146 (P1-E3-S5B, same day)**

- **Date:** 2026-09-01
- **Category:** Architecture / Security / Product
- **Decision:** `reassign_trip`'s signature gains a 5th parameter, `p_expected_assignment_id uuid default null` (appended, matching the work item's own preferred shape). For a REAL (non-idempotent) reassignment, the RPC verifies — under the same row lock already held for every other check — that this value equals the currently-active assignment's own `id`; a mismatch (including a `null`/omitted value) fails closed with the existing `ZW005 assignment_conflict` category, never a new error code. The Dispatch UI's `AssignmentDialog` always supplies the real active assignment id it loaded, as a hidden form field never shown to the Dispatcher.
- **Status:** CONFIRMED, ordering AMENDED same day by ZD-146 — implemented (`supabase/migrations/20260901120000_reassignment_concurrency_hardening.sql`, edited in place by P1-E3-S5B, never having been deployed) and verified end-to-end through the real running application: a genuine two-independent-session stale-reassignment attempt is DENIED (previously succeeded — see ZD-142, which this entry supersedes). **The bullet below on check ordering, as originally written, has been struck through and corrected — it described the P1-E3-S5A-only behavior, which P1-E3-S5B (same day) found to be itself contradictory to the product's own stale-precondition rule; see ZD-146 for why and what changed.**
- **Reason:** P1-E3-S5's own real concurrency testing found a transactionally-safe but operationally undesirable gap (ZD-142): nothing tied a reassignment to the SPECIFIC assignment a Dispatcher actually reviewed, so a stale decision could silently overwrite a different Dispatcher's newer one. The fix follows the exact same "expected current state" optimistic-concurrency pattern already established for the six `driver_*` lifecycle-transition RPCs (`p_expected_current_state`, P1-E3-S3) — extending a proven, already-idiomatic pattern in this codebase to `reassign_trip`, rather than inventing a new mechanism.
  - ~~**The idempotent-match check still runs FIRST, before the id check, and succeeds regardless of it.**~~ **CORRECTED by ZD-146: the id check now runs FIRST, before the idempotent-match check — the reverse of what this bullet originally said.** The original reasoning (preserving a dropped-response retry's safety) was real, but produced a bug: it meant a stale expected id could be silently accepted as `changed:false` whenever the request happened to already match the CURRENT (not the caller's expected) assignment — exactly the "stale expected assignment treated as an idempotent success" outcome this whole decision exists to prevent. See ZD-146.
  - **The old 4-argument function was explicitly dropped, not left alongside the new one.** `CREATE OR REPLACE FUNCTION` cannot safely add a parameter without a default ahead of already-defaulted ones in a single step here, and leaving the old signature independently callable would have been exactly the "second competing reassignment RPC" the originating work item explicitly said to avoid. (Unaffected by ZD-146 — still true.)
  - Every existing SQL test file that called `reassign_trip` for a real (non-idempotent) reassignment was updated to fetch and pass the correct `p_expected_assignment_id` — not to route around the new check, but because those tests' own intent (a real, successful reassignment) genuinely requires it now. (The specific test named here, `mutation_assignment_tests.sql` C12, was itself testing the now-corrected behavior and was rewritten by ZD-146 into the required 4-case matrix — see below.)
- **Affected Product Areas:** `supabase/migrations/20260901120000_reassignment_concurrency_hardening.sql`, `src/app/operations/dispatch/actions.ts`, `src/components/operations/dispatch/AssignmentDialog.tsx`, `src/lib/operations/dispatch-board.ts` (new `activeAssignmentId` field), `docs/data/mutation-api.md`, six `supabase/tests/*.sql` files
- **Dependencies:** ZD-142 (superseded), ZD-093 (a different, unaffected retry-safety mechanism — see ZD-146), ZD-051 (append-only reassignment), the P1-E3-S3 `p_expected_current_state` pattern (precedent followed)
- **Owner:** Engineering / Security / Product
- **Review Trigger:** Superseded by ZD-146's own review trigger, below.

### ZD-146 — `reassign_trip`'s stale-precondition check is moved BEFORE the idempotent driver/vehicle match — closes the gap ZD-145 itself left open

- **Date:** 2026-09-01
- **Category:** Architecture / Security / Product
- **Decision:** Within `reassign_trip`, once an active assignment is confirmed to exist, `p_expected_assignment_id` is now verified against it FIRST — before the idempotent driver/vehicle match is evaluated at all, reversing P1-E3-S5A's original order. A stale expected id is now `ZW005 assignment_conflict` unconditionally, even when the requested driver/vehicle happen to already equal the CURRENT (not the caller's expected) assignment. Only once the expected id is confirmed current does the RPC check whether the requested driver+vehicle already match it (idempotent no-op) or require a real change.
- **Status:** CONFIRMED — implemented (edited the existing, never-deployed P1-E3-S5A migration file in place, rather than layering a second migration on top of same-day, uncommitted churn — see "migration approach" below) and verified end-to-end: a new required SQL test (CASE D, `mutation_assignment_tests.sql` C12c) and a real two-independent-session application test both confirm a stale expected id is rejected even when the requested driver exactly matches the driver another Dispatcher already, independently, set. Full detail: `docs/reports/P1-E3-S5B-strict-stale-precondition-report.txt`.
- **Reason:** ZD-145's original ordering (idempotent match checked first) meant: active assignment changes X → Y; a Dispatcher's stale form still expects X; if the Dispatcher's own requested driver/vehicle happen to equal Y's, the RPC returned `changed:false` — a silent success — without ever checking that the caller's own expectation (X) was stale. This directly contradicts the explicit product rule this hardening exists to enforce: **a stale expected assignment must never be treated as an idempotent success**, regardless of what the request happens to ask for. The fix is a pure reordering — no new parameter, no new error category, no change to what conditions constitute idempotency once the expected id is confirmed current.
  - **This narrows, not just fixes, the retry-safety guarantee ZD-145 described.** A genuine retry of a Dispatcher's own already-applied change (e.g. a dropped HTTP response) carries the PRE-call expected id, which — after that same call's own success — is by definition no longer the active assignment's id. Under the corrected ordering, that retry is now also `assignment_conflict`, not a safe no-op. This is accepted deliberately, not overlooked: the explicit rule is "a stale expected assignment must NOT be treated as an idempotent success," full stop, with no carve-out for "stale because of the caller's own prior action" versus "stale because of someone else's." `ZD-093`'s own retry-safety guarantee is untouched — it concerns a genuinely different mechanism (`p_expected_current_state`, checked against Trip *state* on the six `driver_*` transition RPCs), not this assignment-*id* precondition, and no code implementing ZD-093 was changed.
  - **Migration approach:** the P1-E3-S5A migration (`20260901120000_reassignment_concurrency_hardening.sql`) was edited in place — not superseded by a new migration file — because it has never been deployed or committed; it is same-session, same-day, uncommitted churn from the immediately preceding phase, not "historical" migration history in the sense this project otherwise never edits. A fresh `supabase db reset` produces the corrected function directly; there is no intermediate "wrong then right" state in the migration history at all, which a second on-top migration would have introduced for no benefit.
  - **Test matrix:** `mutation_assignment_tests.sql`'s C11/C12 pair was expanded into the full required 4-case matrix (CASE A valid real reassignment, CASE B valid idempotent retry, CASE C stale different target, CASE D stale same target — the previously-missing guarantee) against one Trip's continuing assignment timeline, reusing only the two real Org A driver fixtures (no new driver fixture needed, unlike the P1-E3-S5A report's temporary test-only 3rd driver).
- **Affected Product Areas:** `supabase/migrations/20260901120000_reassignment_concurrency_hardening.sql`, `docs/data/mutation-api.md`, `docs/product/dispatch-board-data-map.md`, `supabase/tests/mutation_assignment_tests.sql`
- **Dependencies:** ZD-145 (amends), ZD-093 (explicitly distinguished, not modified), ZD-051, ZD-142 (superseded, unaffected by this further amendment)
- **Owner:** Engineering / Security / Product
- **Review Trigger:** A genuine future product requirement to restore leniency for a caller's own dropped-response retry specifically (as distinct from a different Dispatcher's newer decision) would need its own new, explicitly-scoped mechanism (e.g. an idempotency key distinct from the assignment id) — not assumed or designed here.

### ZD-147 — Trip Detail's "Edit Trip / More / Contact Driver" cluster becomes direct, individually-labeled buttons

- **Date:** 2026-09-01
- **Category:** Architecture / Accessibility
- **Decision:** The reference's "More" overflow button (presumably hiding Cancel and other actions) is replaced with direct, always-visible buttons: "Edit Trip" (disabled), "Record No-Show" (when eligible), "Cancel Trip" (when eligible), "Contact Driver" (when a driver is assigned).
- **Status:** CONFIRMED — implemented (`TripDetailActionBar`).
- **Reason:** No dropdown-menu primitive exists in the design system yet, and building one for a 2-3-item destructive-action menu is disproportionate scope for this phase. Direct, labeled buttons are arguably MORE discoverable and accessible than a destructive action (Cancel) hidden behind an unlabeled "More" affordance — composition/hierarchy (a small secondary-action cluster beside the page title) is preserved; only the exact interaction shape differs.
- **Affected Product Areas:** `src/components/operations/trip-detail/TripDetailActionBar.tsx`
- **Dependencies:** None
- **Owner:** Design / Engineering
- **Review Trigger:** A future need for a genuine overflow menu elsewhere in Operations — build one shared primitive then, not a one-off here.

### ZD-148 — No fabricated Trip reference code; the Passenger's real name identifies the Trip everywhere

- **Date:** 2026-09-01
- **Category:** Product
- **Decision:** The reference's "ZW-240829-018"/"FAC-23981" reference codes are never fabricated. The breadcrumb ("Trips › {passenger name}") and page title use the Trip's real Passenger name instead; no raw UUID is shown as a substitute.
- **Status:** CONFIRMED — implemented.
- **Reason:** ui-backend-gap-register.md already recorded this exact gap ("Human-readable Trip/Request reference codes... No such field exists; needs a decision on format and generation") as a still-open product decision, not something to invent per-screen. A raw UUID was considered and rejected — work item §45 explicitly asks for "no genuine operational need" before showing one, and none was identified (Passenger name + scheduled time is sufficient for a human to identify which Trip is open).
- **Affected Product Areas:** `src/app/operations/trips/[tripId]/page.tsx`
- **Dependencies:** ui-backend-gap-register.md's existing "Human-readable Trip/Request reference codes" entry
- **Owner:** Product
- **Review Trigger:** The referenced gap-register decision being resolved — this screen's breadcrumb/title get the real code then, not before.

### ZD-149 — Assistance Requirements shows the Trip's own execution snapshot only, never the Passenger profile's field

- **Date:** 2026-09-01
- **Category:** Data integrity
- **Decision:** `PassengerInfoPanel`'s "Assistance Requirements" field reads exclusively from `trips.assistance_notes` — never falls back to, blends with, or is supplemented by `passengers.assistance_notes` (a separate, independently-editable column).
- **Status:** CONFIRMED — implemented.
- **Reason:** domain-model.md §J's own hybrid snapshot strategy treats Trip-level fields as immutable execution-time copies, distinct from the live Passenger profile they were copied from at creation time. The two can genuinely diverge (a Passenger's profile note might be updated after this specific Trip was created). Silently blending both under one label would risk showing information from two different points in time as if it were one fact, which is worse than the honest "None recorded" this Trip's own snapshot shows when it's null.
- **Affected Product Areas:** `src/lib/operations/trip-detail.ts`, `src/components/operations/trip-detail/PassengerInfoPanel.tsx`
- **Dependencies:** domain-model.md §J
- **Owner:** Product / Engineering
- **Review Trigger:** A genuine product decision to surface BOTH values distinctly (e.g. "Trip note" vs. "Profile note") — not designed or assumed here.

### ZD-150 — No dedicated Activity Timeline panel; the reference's own actual composition doesn't show one

- **Date:** 2026-09-01
- **Category:** Visual fidelity
- **Decision:** `trip_events` is queried and used only to compute "Last Update" in the Current Status panel — no separate Activity Timeline/history list section was built.
- **Status:** CONFIRMED — implemented.
- **Reason:** The canonical reference screenshot (02-trip-detail.png) does not show a distinct timeline panel in its own real composition (Trip Route, Passenger & Trip Information, Current Status, Trip Exceptions, Trip Notes — that's the whole page). The originating work item's own §44 explicitly instructs "the screenshot is authoritative for layout" over its own conceptual composition list, which only offered a timeline as one of several possibilities ("may include"), never a requirement. Building one anyway would have been an unrequested composition change, not a data-driven necessity.
- **Affected Product Areas:** `src/lib/operations/trip-detail.ts`, `src/app/operations/trips/[tripId]/page.tsx`
- **Dependencies:** None
- **Owner:** Design / Product
- **Review Trigger:** A future, deliberately-reviewed Stitch reference (or product decision) that actually shows a timeline section for this screen.

### ZD-151 — Add Note is implemented (direct RLS-protected INSERT); Report Issue and Resolve Exception are deferred

- **Date:** 2026-09-01
- **Category:** Product / Security
- **Decision:** "+ Add Note" is a real, working feature — a direct `trip_notes` INSERT (not an RPC), gated by the existing `trip_notes_insert_operations` RLS policy, confirmed safe by reading the actual policy before building against it. "Report Issue" (create a new `trip_exceptions` row) and resolving an existing open exception are both rendered as real, visible, disabled affordances — not built this phase.
- **Status:** CONFIRMED — implemented and verified (Add Note real end-to-end; Report Issue/Resolve deliberately inert).
- **Reason:** Add Note meets BOTH conditions work item §33 requires: the RLS policy genuinely and safely permits it (`has_org_role` check only, no additional narrowing needed), and the reference clearly shows "+ Add Note" as a primary supported action. Report Issue/Resolve Exception meet neither bar as cleanly this phase — building a full exception-reporting AND resolution workflow is a new write surface disproportionate to this phase's primary mandate (Trip data display + cancel/no-show), mirroring the identical reasoning already established for the Driver-side "Report Issue" deferral (ZD-125, P1-E3-S3).
- **Affected Product Areas:** `src/app/operations/trips/[tripId]/actions.ts` (`addNoteAction`), `src/components/operations/trip-detail/AddNoteDialog.tsx`, `TripNotesPanel.tsx`, `TripExceptionsPanel.tsx`
- **Dependencies:** ZD-125 (identical precedent)
- **Owner:** Product / Security
- **Review Trigger:** A future, dedicated exception-management work item — covering both creation and resolution together, with its own test coverage, not retrofitted here.

### ZD-152 — Facility annotation includes city/state to avoid a visually-redundant duplicate

- **Date:** 2026-09-01
- **Category:** Visual fidelity
- **Decision:** When a Trip has a linked pickup/destination Facility, the annotation shown is `"{name} · {city}, {state}"`, not the bare Facility name alone.
- **Status:** CONFIRMED — implemented, found during this phase's own real screenshot review.
- **Reason:** This project's seed fixtures' `destination_description` free-text snapshot often already equals the linked Facility's own name verbatim (e.g. both are literally "Fictional Clinic A") — a bare name-only annotation rendered directly underneath looked like an unintentional duplicate in a real captured screenshot. Adding city/state makes the annotation genuinely informative regardless of whether the snapshot text happens to match the Facility name, without altering what the snapshot address itself shows (still the Trip's own immutable text, work item §15).
- **Affected Product Areas:** `src/lib/operations/trip-detail.ts` (`formatFacility`), `src/components/operations/trip-detail/TripRoutePanel.tsx`
- **Dependencies:** None
- **Owner:** Design / Engineering
- **Review Trigger:** None anticipated.

### ZD-153 — New Trip's missing sections extend the reference's own established card-panel visual language

- **Date:** 2026-09-02
- **Category:** Visual fidelity
- **Decision:** The Schedule/Pickup/Destination/Instructions & Assistance sections — not shown in the canonical reference's own actual composition (stitch-reference-index.md's own note on 05-internal-new-trip.png) but required by `create_trip`'s real contract (`p_pickup_description`/`p_destination_description` NOT NULL) — reuse the exact card-panel + icon + bold-title header pattern the reference DOES show for "Request Source"/"Passenger", via a new shared `FormSection` component, rather than inventing a second, divergent section style.
- **Status:** CONFIRMED — implemented and verified via direct screenshot comparison.
- **Reason:** Preserves composition/hierarchy/spacing/typography consistency (work item §3's explicit requirement) even where content had to be authored without a visual reference — the alternative (a differently-styled ad hoc section) would have been a real, avoidable visual regression relative to the one part of the screen the reference DOES specify.
- **Affected Product Areas:** `src/components/operations/new-trip/FormSection.tsx`, `NewTripForm.tsx`
- **Dependencies:** None
- **Owner:** Design / Engineering
- **Review Trigger:** A future, more complete Stitch reference for this screen that shows these sections explicitly.

### ZD-154 — "Import request details" uses only real `TransportationRequest` fields, never the mockup's inline requester-editor

- **Date:** 2026-09-02
- **Category:** Product / Data integrity
- **Decision:** The Request selector links to an EXISTING same-org `pending`/`accepted` `transportation_requests` row only (`p_request_id`). "Import request details" copies that row's own real fields (`pickup_description`, `destination_description`, `preferred_date`/`preferred_time`, `assistance_notes`, and `passenger_id` when it matches an active Passenger option) into the form. The mockup's own editable Requester Name/Organization/Phone/Email fields and its fabricated "Ref: ZR-240829-104" reference code are NOT built — `create_trip` has no parameter for any of them, and building an inline "create a new inbound Request" flow would be a second, materially larger feature outside this phase's actual mutation contract.
- **Status:** CONFIRMED — implemented and verified end-to-end (real Request selected → Import → real fields copied → Trip created with `request_id` set → Request atomically transitions `pending` → `accepted`).
- **Reason:** Matches work item §13/§14/§15 exactly: reflect `create_trip`'s real Request behavior accurately, never force every Trip through a Request, never expose confusing/fabricated fields the backend doesn't actually support.
- **Affected Product Areas:** `src/lib/operations/new-trip.ts`, `new-trip-options.ts`, `src/components/operations/new-trip/NewTripForm.tsx`
- **Dependencies:** ZD-045 (Request/Trip separation), P1-E3-S0A's `create_trip` architecture
- **Owner:** Product / Engineering
- **Review Trigger:** A future decision to build a real, safe inbound-Request-creation path (distinct from public intake, ZD-044/ZD-050) — at which point this decision should be revisited, not silently expanded around.

### ZD-155 — Facility selection auto-fills the address snapshot; both values are stored together, neither silently discarded

- **Date:** 2026-09-02
- **Category:** Product / Data integrity
- **Decision:** Selecting a Pickup/Destination Facility overwrites that side's address `<textarea>` with the Facility's own canonical address, formatted and fully editable afterward. Both the Facility id and the (possibly-edited) address text are submitted to `create_trip` together — the RPC's own validation (tenant/active-status check on the id; non-blank/length check on the text) remains sole authority, and neither value is ever silently dropped in favor of the other.
- **Status:** CONFIRMED — implemented and verified (edited-after-autofill snapshot persists exactly as edited; Facility link persists alongside it).
- **Reason:** Matches work item §18/§20 exactly — a Trip may legitimately need an address note beyond a Facility's bare canonical address ("use the side door"), and the execution snapshot must remain the Trip's own text, never silently replaced by a live Facility read.
- **Affected Product Areas:** `src/lib/operations/new-trip-options.ts` (`formatFacilityAddress`), `NewTripForm.tsx`
- **Dependencies:** ZD-051-adjacent snapshot-vs-live-reference reasoning (Trip Detail's own Facility-annotation precedent, ZD-152)
- **Owner:** Engineering
- **Review Trigger:** None anticipated.

### ZD-156 — Add New Passenger is implemented (direct RLS-protected INSERT), matching the Add Note/ZD-151 precedent

- **Date:** 2026-09-02
- **Category:** Product / Security
- **Decision:** "Add New Passenger" is a real, working feature — a direct `passengers` INSERT (`display_name`, `phone`), gated by the existing `passengers_insert_org_operations` RLS policy. The newly-created Passenger is handed directly back to the New Trip form (never a page refresh) and appended to its in-memory option list, so an already-in-progress form is never at risk of losing other typed fields.
- **Status:** CONFIRMED — implemented and verified (created Passenger persists correctly, org-scoped; unrelated already-typed fields survive the dialog).
- **Reason:** ui-data-action-map.md had already independently concluded "direct table access is adequate here — Passenger has no lifecycle machine to protect, unlike Trip." Matches work item §11's own allowance ("you MAY implement it... if it does not materially expand this phase") — one table, two columns, the exact affordance the reference itself shows.
- **Affected Product Areas:** `src/app/operations/trips/new/actions.ts` (`addPassengerAction`), `src/components/operations/new-trip/AddPassengerDialog.tsx`
- **Dependencies:** ZD-151 (identical direct-INSERT precedent for Add Note)
- **Owner:** Product / Security
- **Review Trigger:** None anticipated.

### ZD-157 — Organization-local date/time → UTC conversion: one explicit server-side boundary, DST-aware, no manual arithmetic

- **Date:** 2026-09-02
- **Category:** Correctness / Timezone
- **Decision:** `organizationLocalToUtc()` (`src/lib/operations/local-time.ts`) is the sole conversion boundary between a Dispatcher's organization-local `date`+`time` form input and the `timestamptz` values `create_trip` requires — run once, server-side, in `createTripAction`, using the organization's own resolved timezone (never the client's, never the server runtime's). It resolves both DST edge cases explicitly: a nonexistent local time (spring-forward gap) and an ambiguous local time (fall-back repeated hour) are both rejected with an honest, specific error before `create_trip` is ever called — never silently resolved to a guessed instant.
- **Status:** CONFIRMED — implemented and verified: ordinary EST/EDT dates, a midnight crossing, both DST edge cases, and a second organization timezone (America/Chicago) all verified through the real UI against the real stored `timestamptz`.
- **Reason:** Matches work item §21/§22/§23 exactly. The two-offset-probe technique (reading the zone's standard and daylight offsets from fixed Jan 1/Jul 1 reference instants, never a hardcoded offset or transition date) correctly handles any US IANA zone without manual DST arithmetic; it does not attempt to handle a zone with more than 2 offset changes within a year, which no organization in this product's current or near-term scope uses (documented limitation, not silently overclaimed).
- **Affected Product Areas:** `src/lib/operations/local-time.ts`, `src/app/operations/trips/new/actions.ts`
- **Dependencies:** ZD-119 (organization timezone), P1-E3-S2C's `organizationDayBoundsUtc` (the reverse-direction precedent this reuses the same offset-resolution technique from)
- **Owner:** Engineering
- **Review Trigger:** A future organization outside the current Georgia-launch scope whose IANA zone has more than 2 offset changes within a year.

### ZD-158 — `create_trip`'s non-idempotency is guarded client-side, not solved at the database layer

- **Date:** 2026-09-02
- **Category:** Correctness / Data integrity
- **Decision:** Double-submit prevention for New Trip is two client-side layers: `disabled={pending}` on the submit button (the established pattern every other mutation dialog in this app already uses), plus a synchronous `useRef` guard on the form's own `onSubmit` handler that closes the narrow race where a very fast repeated click could fire a second submission before React commits the disabled state. No new database-layer idempotency mechanism was added to `create_trip` itself.
- **Status:** CONFIRMED — verified via a real 5-rapid-synchronous-click reproduction: exactly one `createTripAction` invocation reached the server, exactly one Trip row was created.
- **Reason:** Matches ZD-102's own explicit review trigger ("if application usage reveals accidental double-submission is a real, recurring problem — revisit whether a deliberate, durable idempotency key belongs in a future revision") — this phase's own testing found the client-side guard sufficient; no evidence yet that a database-layer key is needed.
- **Affected Product Areas:** `src/components/operations/new-trip/NewTripForm.tsx`
- **Dependencies:** ZD-102 (create_trip's original non-idempotency decision, unmodified)
- **Owner:** Engineering
- **Review Trigger:** Real-world evidence of accidental double-submission getting past the client-side guard (e.g. a network retry after an ambiguous timeout) — ZD-102's own trigger, unchanged.

### ZD-159 — No pre-creation "Needs Attention" advisory; a calm info note replaces it

- **Date:** 2026-09-02
- **Category:** Visual fidelity / Product
- **Decision:** The reference's right-rail "Needs Attention — Driver not assigned" advisory (an alarm-styled warning box, anticipating a state the Trip will be in immediately AFTER creation) is not built as shown. Replaced with a calm, non-alarming info note ("Assign a driver after creating this trip") using a new `AttentionState` `info` level.
- **Status:** CONFIRMED — implemented and verified.
- **Reason:** A warning about a Trip's unassigned state doesn't make sense before the Trip exists — nothing is actually wrong yet. An honest, forward-looking note sets the same expectation (assignment is a separate, later step, work item §33) without a false alarm.
- **Affected Product Areas:** `src/components/ui/AttentionState.tsx` (new `info` level, using existing unused `--color-info-*` tokens), `src/components/operations/new-trip/NewTripForm.tsx`
- **Dependencies:** None
- **Owner:** Design / Product
- **Review Trigger:** None anticipated.

### ZD-160 — SQL baseline "33" was a P1-E3-S4 reporting error, not a real assertion removal

- **Date:** 2026-09-02
- **Category:** Process / Documentation integrity
- **Decision:** `rls_adversarial_tests.sql` has always contained exactly 32 distinct test scenarios (unchanged since P1-E2-S3, confirmed via `git show` against every historical commit that touched it) — the "33 assertions" figure reported by P1-E3-S4 through P1-E3-S6 was a manual miscount (most plausibly, the file's own trailing summary `NOTICE` line was counted alongside the 32 real per-test result lines), mechanically copied forward, unverified, for 4 consecutive phases. P1-E3-S2's own report, and every P1-E2 report, independently and correctly said 32/32 the whole time.
- **Status:** CONFIRMED — deterministically re-verified via a fresh `supabase db reset` + raw-output grep count, not inferred from terminal formatting.
- **Reason:** Matches P1-E3-S7B's own explicit mandate — determine the discrepancy precisely rather than assume it's harmless, and do not repeat the copy-forward-without-re-verification mistake going forward.
- **Affected Product Areas:** Documentation only — `docs/reports/P1-E3-S7B-sql-baseline-audit-report.txt`, this register. No SQL, RLS, or application code was touched.
- **Dependencies:** None
- **Owner:** Engineering / QA process
- **Review Trigger:** Every future SQL-baseline report should re-tally from a fresh raw-output grep, never copy a prior phase's own reported table forward unverified.

### ZD-161 — Driver location: one append-only history table, no separate "latest" projection

- **Date:** 2026-09-02
- **Category:** Architecture / Data integrity
- **Decision:** `driver_location_updates` is the sole table — an append-oriented history, no separate "current location" row per Driver/Trip. "Latest location" is always derived (`ORDER BY recorded_at DESC` per Trip, backed by an index), never stored redundantly.
- **Status:** CONFIRMED — implemented and verified (movement test: a second update becomes the new authoritative latest via a derived query, no second write path involved).
- **Reason:** Directly extends ZD-051's own established reasoning (TripAssignment is the sole assignment source of truth — no redundant "current" pointer that can drift out of sync) to this new domain. A denormalized "latest" table would need lockstep maintenance on every insert, reintroducing exactly the synchronization risk ZD-051 rejected.
- **Affected Product Areas:** `supabase/migrations/20260902140000_driver_location_tracking.sql`, `src/lib/operations/live-location.ts`
- **Dependencies:** ZD-051
- **Owner:** Engineering
- **Review Trigger:** None anticipated — a future performance need (very high write volume) could revisit this, but no such need exists at this product's scale.

### ZD-162 — Location write path: a controlled RPC, reusing the existing active-assignment helper verbatim

- **Date:** 2026-09-02
- **Category:** Security
- **Decision:** `driver_record_location` (SECURITY DEFINER RPC) is the sole write path — no direct INSERT grant on `driver_location_updates` to `authenticated` at all. Reuses `_lock_driver_active_assignment()` (built in P1-E2-S2, whose own original comment anticipated exactly this future requirement) rather than re-deriving an equivalent RLS `WITH CHECK` condition.
- **Status:** CONFIRMED — implemented and verified (21 SQL assertions covering the full authorization chain, all PASS).
- **Reason:** The write's real authorization condition (currently-ACTIVE assignment, not merely "ever assigned"; Trip lifecycle-state eligibility) is exactly the kind of multi-condition, easy-to-drift check this project's own established convention already routes through an RPC — matches every other Driver mutation, and a candidate RLS-only alternative was explicitly evaluated and rejected as harder to prove correct at a glance (work item §12).
- **Affected Product Areas:** `supabase/migrations/20260902140000_driver_location_tracking.sql`
- **Dependencies:** P1-E2-S2's `_lock_driver_active_assignment`/`_driver_execute_trip_transition` architecture
- **Owner:** Security / Engineering
- **Review Trigger:** None anticipated.

### ZD-163 — Server-authoritative `recorded_at`; no client-supplied timestamp parameter at all

- **Date:** 2026-09-02
- **Category:** Security / Correctness
- **Decision:** `driver_record_location` has no `p_recorded_at` parameter — `recorded_at` is always the server's own `now()` at insert time.
- **Status:** CONFIRMED — implemented.
- **Reason:** Goes beyond "validate it's not absurdly future-dated" (work item §13's own baseline ask) — eliminates an entire class of clock-skew/spoofing concern outright. The gap between the browser's own `GeolocationPosition.timestamp` and server receipt is immaterial at this product's freshness-threshold granularity (tens of seconds to minutes).
- **Affected Product Areas:** `supabase/migrations/20260902140000_driver_location_tracking.sql`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated.

### ZD-164 — Eligible tracking window includes both "arrived" states

- **Date:** 2026-09-02
- **Category:** Product
- **Decision:** Location tracking remains eligible through `arrived_at_pickup` and `arrived_at_destination`, not only the 3 "en route"/"onboard" states.
- **Status:** CONFIRMED — implemented and verified (TEST LOC-A used `en_route_to_pickup`; the full 5-state set is hardcoded server-side and documented).
- **Reason:** The Driver is still actively engaged in trip execution while arrived (waiting/loading at pickup, or at the destination before hand-off) — Dispatch benefits from confirming the Driver is genuinely there. Work item §5 explicitly asked this to be evaluated, not assumed.
- **Affected Product Areas:** `supabase/migrations/20260902140000_driver_location_tracking.sql`, `src/lib/driver/trip-presentation.ts` (`ELIGIBLE_LOCATION_TRACKING_STATES`)
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** None anticipated.

### ZD-165 — Realtime deferred; restrained 20s polling used instead

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** Supabase Realtime (`postgres_changes`) is NOT used for live Dispatch updates this phase. `DispatchLiveRefresh` triggers `router.refresh()` every 20 seconds instead — the Dispatch Board's own already-proven, already-RLS-scoped server re-fetch mechanism, not a new data path.
- **Status:** CONFIRMED — implemented. Renders no visible "LIVE" badge (work item §29) — freshness is shown per-row from real timestamps only.
- **Reason:** Work item §30-§32 explicitly permits deferring Realtime if it cannot be proven tenant-safe with real adversarial tests within the phase's own time constraints — "Security beats animation." This local Supabase CLI version's `postgres_changes` RLS-interaction behavior was not independently adversarially re-proven this phase (the work item's own explicit warning: ordinary `SELECT` being RLS-safe does not automatically imply Realtime is).
- **Affected Product Areas:** `src/components/operations/dispatch/DispatchLiveRefresh.tsx`
- **Dependencies:** None
- **Owner:** Security / Engineering
- **Review Trigger:** A future phase with time budgeted specifically to adversarially test this local Supabase version's Realtime RLS behavior — at which point Realtime may be reconsidered, not enabled reactively without that proof.

### ZD-166 — Map provider: a plain external OpenStreetMap link, no SDK, no API key

- **Date:** 2026-09-02
- **Category:** Architecture / Privacy
- **Decision:** `externalMapUrl()` links to `openstreetmap.org` with the coordinate pre-centered. No Leaflet/Mapbox/Google Maps SDK, no API key, no billing account, no third-party embed.
- **Status:** CONFIRMED — implemented.
- **Reason:** The explicitly-sanctioned MVP fallback (work item §25: "If no map provider is already configured, acceptable first delivery is: live coordinate-derived Driver location status + external map link"). No map provider was previously configured in this project. An embedded Leaflet+OpenStreetMap map remains a clearly-flagged future enhancement, deliberately not built this phase given the volume of other mandatory work already required.
- **Affected Product Areas:** `src/lib/operations/live-location-shared.ts`, `src/components/operations/dispatch/AssignmentGrid.tsx`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** A future phase explicitly scoped to build an embedded map.

### ZD-167 — Driver has zero read access to `driver_location_updates`, including their own location

- **Date:** 2026-09-02
- **Category:** Security / Data minimization
- **Decision:** No Driver SELECT policy exists on `driver_location_updates` at all — not even scoped to a Driver's own posted rows.
- **Status:** CONFIRMED — verified live (TEST LOC-Q): a Driver's query succeeds but returns zero rows via RLS, matching the exact established `passengers`/ZD-080 shape.
- **Reason:** Work item §42 is explicit: "Driver does not need the other Drivers' locations. Do not grant it" — extended here to "does not need to read this table at all," since the Driver-side tracker UI reflects local `watchPosition` state only and has no genuine product need to read back a stored value.
- **Affected Product Areas:** `supabase/migrations/20260902140000_driver_location_tracking.sql`
- **Dependencies:** ZD-080 (identical precedent/shape)
- **Owner:** Security
- **Review Trigger:** A future genuine product need for a Driver to see their own location history (none identified currently).

### ZD-168 — Transient geolocation errors must not be treated as fatal (real bug found and fixed)

- **Date:** 2026-09-02
- **Category:** Correctness (real bug)
- **Decision:** `DriverLocationTracker`'s `watchPosition` error handler only clears the watch (stops tracking entirely) for `PERMISSION_DENIED`. `POSITION_UNAVAILABLE`/`TIMEOUT` are treated as transient — the watch keeps running, and the status only degrades to "unavailable" if no position has ever successfully arrived yet (an already-"sharing" tracker stays showing "sharing" through a momentary blip).
- **Status:** CONFIRMED — a real bug, found via this phase's own real browser testing (a CDP geolocation-override change fires a benign, empty-message transient error alongside the new position event; the original implementation's blanket `clearWatch()` on any error silently killed tracking for the rest of the Trip after the very first such blip, which would also happen with genuine real-world GPS signal loss — a tunnel, dense buildings, a cold start). Fixed and re-verified (the movement test now passes cleanly).
- **Reason:** A real GPS can transiently lose signal without the underlying watch itself failing — treating every error as fatal would make tracking permanently stop after the first ordinary hiccup on a real device, silently defeating the feature's own purpose.
- **Affected Product Areas:** `src/components/driver/DriverLocationTracker.tsx`
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated — this is the correct, standard handling for the W3C Geolocation API's own error model.

### ZD-169 — Trip Assurance is a derived read-time layer, never a `trips.state` value

- **Date:** 2026-09-02
- **Category:** Architecture / Product
- **Decision:** Trip Assurance conditions (`ON_TRACK`, `NEEDS_ASSIGNMENT`, `LOCATION_STALE`, `LOCATION_UNAVAILABLE`, `OPEN_EXCEPTION`, `TERMINAL`) are computed at read time by one pure function, `evaluateTripAssurance(facts, now)` in `src/lib/operations/trip-assurance.ts`, from existing persisted facts (Trip state, active assignment, latest assignment-scoped location, open-exception count). None of these values are ever written to `trips.state` or any other column — no schema change was needed or made for the vocabulary itself.
- **Status:** CONFIRMED — implemented.
- **Reason:** Work item §4-§6 explicitly forbids inventing new lifecycle states for assurance/attention purposes (naming the exact rejected values: `at_risk`/`running_late`/`needs_attention`/`on_track`/`awaiting_confirmation`) — assurance is a lens over real operational facts, not a new fact. A derived function keeps the model trivially re-evaluable (no migration to add/rename a condition) and impossible to let drift out of sync with the underlying rows it explains.
- **Affected Product Areas:** `src/lib/operations/trip-assurance.ts`, `src/lib/operations/todays-operations.ts`
- **Dependencies:** ZD-161 (append-only location history, no denormalized pointer — the same "derive, don't duplicate" reasoning)
- **Owner:** Product / Engineering
- **Review Trigger:** A future phase requiring assurance state to be queried at the database layer (e.g. for a scheduled digest) — at which point a read-only SQL view mirroring this same derivation, not a new persisted column, is the first option to evaluate.

### ZD-170 — A small, deterministically-prioritized assurance vocabulary; no numeric score

- **Date:** 2026-09-02
- **Category:** Product / UX
- **Decision:** Exactly six assurance codes exist, evaluated in one fixed priority order per Trip — `TERMINAL` → `OPEN_EXCEPTION` → `NEEDS_ASSIGNMENT` → `LOCATION_UNAVAILABLE`/`LOCATION_STALE` → `ON_TRACK` — implemented as a real ranked `if` chain in `evaluateTripAssurance`, not database row order or array insertion order. No numeric score (e.g. "Trip Assurance Score 84/100") exists anywhere in the model.
- **Status:** CONFIRMED — implemented and verified (SCENARIO3 of `test-assurance-dynamics.mjs`: a Trip with both an open exception and a stale location deterministically shows only "Open issue," never both, and the location condition surfaces only after the exception is resolved).
- **Reason:** Work item §9-§11 explicitly requires deterministic priority ("decide based on product meaning, do not randomly select the first database row") and explicitly forbids opaque scoring ("no opaque score... Do NOT invent: Trip Assurance Score 84/100 or Reliability 92% without validated methodology"). An open, actionable exception is judged the most operationally urgent fact about a Trip; a Trip already in a terminal state is excluded from attention entirely regardless of any other condition.
- **Affected Product Areas:** `src/lib/operations/trip-assurance.ts` (`PRIORITY_RANK` in `todays-operations.ts` mirrors the same order for queue sorting)
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A future phase with a validated, business-approved scoring methodology — not before.

### ZD-171 — No frontend clock-based lateness this phase

- **Date:** 2026-09-02
- **Category:** Product
- **Decision:** No lateness/ETA condition was implemented. The assurance vocabulary has no `running_late`/`at_risk` code, and no comparison against `scheduled_pickup_at` drives any condition.
- **Status:** CONFIRMED — implemented (by omission).
- **Reason:** Work item §7-§8 is explicit: lateness requires a formally-approved, business-defined threshold rule first ("avoid frontend clock-based lateness entirely unless formally approved"), and no such rule was established this phase. Inventing an arbitrary threshold (e.g. "15 minutes past scheduled pickup") would be exactly the kind of unvalidated, invented business rule the work item warns against.
- **Affected Product Areas:** `src/lib/operations/trip-assurance.ts` (absence)
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A future phase where Product formally defines a lateness rule with real operational input (e.g. from pilot-operator feedback).

### ZD-172 — Exception create/resolve unified behind two controlled RPCs, replacing direct-write reliance without revoking the underlying policies — SUPERSEDED by ZD-177

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** `report_trip_exception`/`resolve_trip_exception` (both `SECURITY DEFINER`) are the only paths the application now writes through. The pre-existing direct RLS INSERT/UPDATE policies on `trip_exceptions` were inspected, found not narrow enough for safe direct reuse by Operations (see `mutation-authorization.md`), and ~~deliberately left in place rather than revoked, since correctly narrowing them would require rebuilding the same column-restriction logic the RPCs already provide~~ **SUPERSEDED same-day by ZD-177 (P1-E3-S8A): leaving them in place was itself the gap — "the application doesn't call it" is not a security boundary. The policies were retired the same day this was written.**
- **Status:** CONFIRMED — implemented, 16/16 new SQL assertions PASS (`trip_exception_tests.sql`), including a dedicated atomicity proof (EXC-M/EXC-M-DB) and cross-org denial (EXC-L).
- **Reason:** Matches this project's own established "prefer the path that is easiest to prove safe" convention (first stated in P1-E3-S7A), applied here to a case where the alternative would have split one logical action (report/resolve) across two different enforcement mechanisms for two different actor populations.
- **Affected Product Areas:** `supabase/migrations/20260902150000_trip_exception_mutations.sql`, `src/app/operations/trips/[tripId]/actions.ts`
- **Dependencies:** None
- **Owner:** Security / Engineering
- **Review Trigger:** ~~A future phase revisiting the `trip_exceptions` RLS surface directly (e.g. to actually narrow or revoke the now-superseded direct policies).~~ **Resolved by ZD-177, same day.**

### ZD-173 — Idempotent no-op resolve is a deliberate, documented exception to the fail-closed staleness precedent

- **Date:** 2026-09-02
- **Category:** Architecture
- **Decision:** `resolve_trip_exception` returns the real, already-persisted resolution unchanged (`changed=false`) when called against an already-resolved exception, rather than raising a conflict error.
- **Status:** CONFIRMED — implemented and tested (SCENARIO3 of `test-assurance-dynamics.mjs` exercises a real resolve through the UI; the SQL suite's own EXC-series covers the no-op path directly at the RPC layer).
- **Reason:** This is intentionally different from `reassign_trip`'s fail-closed staleness contract (P1-E3-S5B) — there, a stale caller could silently clobber a different newer decision (a different Driver/Vehicle). Here, two resolutions of the same exception can never disagree about the operationally relevant fact ("is this handled?"), so discarding the second (redundant) caller's own resolution note is more useful than raising a conflict a Dispatcher would have no meaningful way to act on.
- **Affected Product Areas:** `supabase/migrations/20260902150000_trip_exception_mutations.sql`
- **Dependencies:** ZD-093 (the general "idempotency is actor-scoped, not relationship-scoped" precedent this decision narrows for one specific action)
- **Owner:** Engineering
- **Review Trigger:** None anticipated.

### ZD-174 — Uniform warning tone for every active assurance condition; never escalating to a "critical"/red treatment

- **Date:** 2026-09-02
- **Category:** Design
- **Decision:** `assuranceStatusCategory()` maps every non-terminal, non-on-track condition (`OPEN_EXCEPTION`, `NEEDS_ASSIGNMENT`, `LOCATION_STALE`, `LOCATION_UNAVAILABLE`) to the same single "warning" visual category — the existing amber `StatusBadge` tone already used elsewhere in the product, not a new red/critical tier.
- **Status:** CONFIRMED — implemented, visually confirmed via `docs/design/qa/trip-assurance/todays-operations/` screenshots at 5 widths (768-1600px) showing all four active condition types rendered with the identical uniform amber tone.
- **Reason:** Work item §63-§66 explicitly rejects a "risk dashboard"/"alarm system"/"AI monitoring center" aesthetic ("do not turn every issue bright red... typography/iconography/copy over color alone"). An open exception and a stale location are both real operational facts a Dispatcher should notice, but neither is dramatized above the other by color; natural-language copy ("Open issue," "Location needs update") and deterministic ordering, not color intensity, carry the actual urgency signal.
- **Affected Product Areas:** `src/lib/operations/presentation.ts`, `src/app/operations/page.tsx`
- **Dependencies:** None
- **Owner:** Design
- **Review Trigger:** A future phase with a validated business need to visually distinguish condition severity beyond ordering.

### ZD-175 — Dispatch gains a small, restrained open-exception marker only; no redesign

- **Date:** 2026-09-02
- **Category:** Design
- **Decision:** The Dispatch Board's assignment grid gains one small warning-tone dot marker (`absolute -right-1 -top-1 size-2.5 rounded-full`) on a Trip block when `hasOpenException` is true, plus an aria-label suffix ("— has an open issue"). No other Dispatch layout change was made for Trip Assurance.
- **Status:** CONFIRMED — implemented, visually confirmed at 1440x900 and 1280x800 (`docs/design/qa/trip-assurance/dispatch/`), and confirmed present via a real `aria-label` DOM check (not color-only).
- **Reason:** Work item §67 requires Dispatch integration "only where materially useful, with restraint (small marker/indicator, not clutter)." A Dispatcher scanning the board benefits from knowing a Trip has an open issue without a redesign of a screen this phase did not otherwise need to touch.
- **Affected Product Areas:** `src/lib/operations/dispatch-board.ts`, `src/components/operations/dispatch/AssignmentGrid.tsx`
- **Dependencies:** None
- **Owner:** Design / Engineering
- **Review Trigger:** None anticipated.

### ZD-176 — Realtime remains deferred for Trip Assurance; the same restrained-polling fallback is reused, not re-litigated

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** No new Realtime subscription was added for Trip Assurance or the Today's Operations attention queue. Today's Operations is a standard server-rendered page (no client polling loop was added to it this phase); Dispatch continues to use the existing `DispatchLiveRefresh` 20-second `router.refresh()` polling from P1-E3-S7A (ZD-165), now also carrying the open-exception marker on each refresh.
- **Status:** CONFIRMED — no new code; a deliberate non-change.
- **Reason:** Work item §75 explicitly reiterates ZD-165's reasoning for this phase: Realtime remains deferred "unless a compelling, safely-tested reason exists" — none was established this phase, and no new adversarial Realtime testing was performed. "Security beats animation" applies identically here.
- **Affected Product Areas:** None (no new component)
- **Dependencies:** ZD-165 (identical reasoning, restated for this phase's own scope rather than silently assumed to carry forward)
- **Owner:** Security / Engineering
- **Review Trigger:** Same as ZD-165 — a future phase specifically budgeted to adversarially prove Realtime's RLS-safety.

### ZD-177 — Direct `trip_exceptions` INSERT/UPDATE retired; RPCs are the sole write path (supersedes ZD-172)

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** The three direct RLS policies `trip_exceptions_insert_operations`, `trip_exceptions_insert_assigned_driver`, `trip_exceptions_update_operations` are dropped, and `INSERT`/`UPDATE` are revoked from `authenticated` on `trip_exceptions` entirely. `report_trip_exception`/`resolve_trip_exception` are now structurally the only way any normal actor writes this table — not merely the application's own preferred convention.
- **Status:** CONFIRMED — implemented, proven directly by a dedicated bypass test suite (`exception_mutation_boundary_tests.sql`, 20/20 new assertions PASS): direct INSERT/UPDATE/DELETE all denied for both Operations and Driver actors, same-org and foreign-org; forged `created_by`; forged pre-resolved `status`; reopening a resolved row; rewriting historical fields (`description`/`exception_type`/`created_by`) — all denied, each with an independent DB-state confirmation that the original data was genuinely untouched. DELETE was verified to have never been granted to any client role by any migration.
- **Reason:** ZD-172 (same day, earlier in this phase sequence) reasoned that leaving the direct policies in place was acceptable because "no exploit was found in production use, only a theoretical gap identified by inspection." On reflection this was the wrong bar: a legitimately authenticated Operations user could still bypass both RPCs via a raw PostgREST/Supabase-client write, and "the UI doesn't call it" is not a database-enforced security boundary. This decision closes that gap the same way ZD-092 (`trip_assignments`) and ZD-101 (`trips`) closed the identical class of gap once their own controlled RPCs existed — drop the superseded policy, revoke the underlying grant, don't rely on RLS alone when the privilege itself can be removed more cleanly.
- **Affected Product Areas:** `supabase/migrations/20260902160000_exception_mutation_boundary_hardening.sql`
- **Dependencies:** Supersedes ZD-172's "left in place" reasoning; same pattern as ZD-092, ZD-101
- **Owner:** Security
- **Review Trigger:** None anticipated — this closes the gap ZD-172 itself flagged as open.

### ZD-178 — Driver exception-reporting tightened from "ever assigned" to "currently assigned"; no separate terminal check added

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** `report_trip_exception`'s Driver authorization check changed from `is_driver_assigned_to_trip` (READ-scope, "ever had an assignment — active or historical") to `_lock_driver_active_assignment` (WRITE-scope, "currently has an active, non-ended assignment") — the identical primitive `driver_record_location` already uses (P1-E3-S7A). No separate, explicit "Trip is not terminal" branch was added, even though the work item requested one as a distinct requirement: every path that brings a Trip to a terminal state (`driver_complete_trip`, `cancel_trip`, `record_no_show`) already closes that Trip's active `trip_assignments` row in the same transaction as the state change (verified directly by reading all three functions' own bodies before deciding this), so requiring a currently-active assignment is already structurally sufficient to exclude every terminal Trip for Driver reporting.
- **Status:** CONFIRMED — implemented and proven: `DRV-2` (reassignment revocation, same session, no re-login), `DRV-5-TERMINAL` (a Trip walked to a REAL `completed` state via the actual Driver lifecycle RPCs, not a direct state edit, then the same Driver's next report attempt denied) both PASS. A live application-level version of the same reassignment scenario (real Dispatch UI reassignment, then a denied/allowed `report_trip_exception` call at the real authenticated RPC boundary) also PASS (`test-s8a-regression.mjs`, S8A-E2E series).
- **Reason:** A second, separate terminal-state check was considered and explicitly rejected, not merely omitted: placed AFTER the assignment check, it would be unreachable dead code (no terminal Trip can have an active assignment, by the invariant just verified); placed BEFORE it, it would leak a foreign-org Trip's terminal/non-terminal status to a caller who has proven no relationship to it yet — reintroducing exactly the existence-oracle leak this project's own `ZW002`-everywhere convention exists to prevent. The black-box behavior the work item actually requires (allowed while non-terminal and currently assigned; denied once terminal or reassigned) is fully satisfied by the assignment check alone.
- **Affected Product Areas:** `supabase/migrations/20260902160000_exception_mutation_boundary_hardening.sql`
- **Dependencies:** ZD-162 (the original `_lock_driver_active_assignment` decision, P1-E3-S7A) — reused verbatim, not reimplemented
- **Owner:** Security
- **Review Trigger:** A future phase that decouples "Trip terminal" from "assignment closed" (none currently planned — every terminal-reaching RPC closes the assignment by design, and changing that would itself be a significant, separately-reviewed lifecycle-model change).

### ZD-179 — Operations sidebar converges to dark Care Navy, per the canonical Stitch references

- **Date:** 2026-09-02
- **Category:** Design
- **Decision:** `OperationsSidebar` moves from the light (`bg-surface-elevated`) treatment every prior phase used to the dark Care Navy background the canonical references (01, 02, 03, 05) all consistently show. A new, dedicated `--color-navy-*` token set (surface, muted text, border, hover/active backgrounds, active text) is added to `globals.css`, reserved for this one component.
- **Status:** CONFIRMED — implemented, screenshot-confirmed across all 4 Operations screens at the reference-matched viewport, contrast spot-checked live (real distinct background/text colors resolved, no invisible-text regression).
- **Reason:** The single largest, most visible systemic deviation this phase's own audit found — every prior phase explicitly accepted it as temporary while backend functionality was the priority (P1-E3-S8B's own stated premise: "that tolerance ENDS in P1-E3-S8B"). Fixed at the shared-component level, not patched per-page, per the phase's own explicit instruction (§12).
- **Affected Product Areas:** `src/components/operations/OperationsSidebar.tsx`, `src/app/globals.css`
- **Dependencies:** None
- **Owner:** Design
- **Review Trigger:** None anticipated — this is now the canonical treatment.

### ZD-180 — Logo-on-dark rendered via a plain white badge chip, never a redesigned asset

- **Date:** 2026-09-02
- **Category:** Design
- **Decision:** `zenward-mobility-logo.png`, confirmed by direct pixel inspection to be a flat 8-bit RGB PNG with no alpha channel (an opaque white background baked into the file), is wrapped in a small plain white rounded badge (`bg-white`, padded, rounded) inside the now-dark sidebar header, rather than placed directly on navy (which rendered as a jarring white rectangle) or redesigned/recolored.
- **Status:** CONFIRMED — implemented, visually confirmed clean.
- **Reason:** The approved brand rules explicitly forbid redesigning the logo or creating an alternate version (work item §3). A plain badge chip is a standard, non-decorative, widely-used pattern for reconciling a light-background asset with a dark shell — it does not touch the artwork's own pixels, and is not a gradient/glassmorphism/novelty device the same rules also forbid.
- **Affected Product Areas:** `src/components/operations/OperationsSidebar.tsx`
- **Dependencies:** ZD-179 (the dark-sidebar decision that exposed this)
- **Owner:** Design
- **Review Trigger:** If a transparent-background version of the approved logo is ever produced, revisit whether the badge chip is still needed.

### ZD-181 — A real accessible `Combobox` primitive replaces the temporary native Passenger `<select>`

- **Date:** 2026-09-02
- **Category:** Design / Accessibility
- **Decision:** `src/components/ui/Combobox.tsx` — a WAI-ARIA "combobox with list autocomplete, manual selection" implementation (full keyboard support, `aria-activedescendant`-tracked highlighting with DOM focus never leaving the input, a real empty state, search matching name or phone) — replaces New Trip's native `<select>` for Passenger selection, explicitly flagged as temporary since P1-E3-S7 and explicitly named by this phase's own work item (§20/§21) as the item most likely to warrant a real build.
- **Status:** CONFIRMED — implemented, 5/5 keyboard/ARIA assertions PASS, 3/3 end-to-end trip-creation assertions PASS (real DB row, real combobox-selected passenger, real typed addresses), 4/4 additional accessibility spot-checks PASS.
- **Reason:** The reference's own richer search/select composition (search input → filtered results → a distinct selected-item card with an avatar, identity, and a clear remove control) materially exceeds what a native `<select>` can express, and Passenger is exactly the kind of larger, genuinely-searchable option set the work item itself distinguishes from "a simple short select" that should NOT be replaced merely for novelty (§20's own caution, respected — Vehicle/Facility short selects were deliberately left as plain `Select`).
- **Affected Product Areas:** `src/components/ui/Combobox.tsx` (new), `src/components/operations/new-trip/NewTripForm.tsx`
- **Dependencies:** None
- **Owner:** Design / Engineering
- **Review Trigger:** A future screen with a similarly large/searchable option set (evaluate case-by-case, per §20 — never applied reflexively).

### ZD-182 — Driver-facing "Report Issue" built, since the reference shows it and the hardened backend now safely supports exactly that scope

- **Date:** 2026-09-02
- **Category:** Product / Security
- **Decision:** `DriverReportIssueButton`/`DriverReportIssueDialog` added to Driver Active Trip, calling the same `report_trip_exception` RPC through the same Server Action authorization layering as every other Driver mutation. GAP-7's report-side is now closed; the exception-status LIST/read side remains explicitly open.
- **Status:** CONFIRMED — implemented, verified end-to-end (button renders, dialog submits, a real `trip_exceptions` row is created with the correct actor).
- **Reason:** Work item §37 set an explicit, conditional bar for building this: the reference must show a clear, natural affordance (it does — Reference 04's own secondary button row) AND the backend must already safely support exactly that scope. Both were true only as of THIS phase, because P1-E3-S8A (immediately prior) tightened Driver exception-reporting from "ever assigned" to "currently assigned" — building this before that hardening would have let a reassigned-away or post-terminal Driver keep reporting, which is exactly the gap S8A closed. No new authorization logic was added for this feature; it inherits S8A's contract entirely.
- **Affected Product Areas:** `src/components/driver/DriverReportIssueButton.tsx`, `src/components/driver/DriverReportIssueDialog.tsx`, `src/app/driver/trips/[tripId]/actions.ts`, `src/lib/operations/trip-exception-errors.ts` (the 7-value issue-type list moved here so both the Operations and Driver dialogs share one source, not two independently-maintained copies)
- **Dependencies:** ZD-178 (the S8A authorization tightening this feature relies on entirely)
- **Owner:** Product / Security
- **Review Trigger:** None anticipated.

### ZD-183 — Embedded Leaflet map deferred again; the external-link MVP is retained

- **Date:** 2026-09-02
- **Category:** Architecture / Scope discipline
- **Decision:** Dispatch's live-location display remains the external OpenStreetMap link established in P1-E3-S7A (ZD-166) — an embedded, read-only Leaflet+OpenStreetMap view (explicitly permitted by this phase's own work item §29, under conditions this project could in fact meet: no paid API key, no new tracking capability, real coordinates only, no fabricated marker/ETA/geofence) was evaluated and NOT built this phase.
- **Status:** CONFIRMED — a deliberate, documented non-change, not an oversight.
- **Reason:** Building a genuine embedded map (tile-provider wiring, marker rendering, a real bundle-size/performance measurement per work item §52) is a meaningfully-sized addition on top of an already-large, 7-screen convergence pass. The blocker is scope/effort discipline, not the dependency or privacy profile (both were confirmed acceptable) — the phase's own explicit non-goal ("not a feature-expansion phase") and its own instruction not to let a single item "materially expand scope" were both judged to apply here.
- **Affected Product Areas:** None (no code change)
- **Dependencies:** ZD-166 (unchanged, reaffirmed)
- **Owner:** Design / Engineering
- **Review Trigger:** A future phase explicitly scoped and budgeted to build the embedded map as its own deliverable, with a real performance measurement — not folded incidentally into an unrelated phase again.

### ZD-184 — Driver header stays page-title-first; not reverted to a brand-name-first pattern to chase literal reference parity

- **Date:** 2026-09-02
- **Category:** Design
- **Decision:** Driver Today/Trips/Active Trip headers continue showing the page title ("Today"/"Trips"/"Trip") + Driver name, rather than the reference's own "Zenward Mobility" brand-name-first + shift-status header. This was reconsidered (not merely left unexamined) this phase and explicitly kept as-is.
- **Status:** CONFIRMED — a deliberate non-change.
- **Reason:** Two considerations outweighed literal reference-matching here: (1) the page-title-first pattern is already consistent across all 3 Driver screens, an internally-coherent, pre-existing choice — changing only Active Trip's header to match the reference would have introduced a NEW cross-screen inconsistency, which work item §55's own second-pass mandate explicitly weighs against single-screen literal fidelity; (2) the reference's "On Shift" status has no backing schema concept (same Driver-availability gap as GAP-6) and would need to be omitted regardless, undercutting most of the value of matching that header composition in the first place.
- **Affected Product Areas:** None (no code change)
- **Dependencies:** None
- **Owner:** Design
- **Review Trigger:** A future phase that also builds a real Driver shift-status concept, at which point this header composition is worth revisiting as a package with that feature, not in isolation.

### ZD-185 — Five Operations master-data surfaces built as real screens, not left as placeholders

- **Date:** 2026-09-02
- **Category:** Product / Security
- **Decision:** `/operations/trips`, `/operations/passengers`, `/operations/facilities`, `/operations/drivers`, `/operations/fleet` all replace the "Structural placeholder" `OperationsRouteStub` they previously rendered with real, org-scoped, RLS-backed screens. Each one's create/edit scope was decided only AFTER inspecting the actual RLS policies and column grants for that table (not assumed): Trips (full CRUD already existed via New Trip/Trip Detail, this phase adds the missing LIST); Passengers (list + Add, reusing the existing safe `passengers` INSERT path); Facilities/Drivers/Fleet (read-only lists — see ZD-186 for why).
- **Status:** CONFIRMED — implemented, 58/58 real application-level assertions PASS across 4 test suites (navigation truthfulness, tenant isolation, role/Membership denial, sign-out security, functional E2E).
- **Reason:** A manual product walkthrough found 5 of 7 sidebar-linked screens were still convincing-looking dead ends — unacceptable for any commercial evaluation, let alone the demo-readiness phase this directly precedes. Building real screens (not merely hiding the broken links) was the only option that actually closes the gap, since Passengers/Facilities/Drivers/Vehicles are canonical operating entities Trips/Dispatch/Assignments already depend on — an Operations user genuinely needs to see them.
- **Affected Product Areas:** `src/app/operations/{trips,passengers,facilities,drivers,fleet}/page.tsx`, `src/lib/operations/{trips,passengers,facilities,drivers,vehicles}-list.ts`
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** None anticipated for the read surfaces; GAP-12/13/14/15 track the deferred mutation capabilities' own future review.

### ZD-186 — Facilities/Drivers/Fleet stay read-only this phase; Driver onboarding explicitly NOT casually built

- **Date:** 2026-09-02
- **Category:** Security / Architecture
- **Decision:** Facilities and Fleet ship as read-only lists this phase, even though their underlying RLS (`facilities_insert_org_operations`/`_update_org_operations`, `vehicles_insert_org_admin`/`_update_org_admin`) is already safe and would support a create/edit flow with no new migration. Drivers is read-only for a DIFFERENT, stronger reason: no safe contract exists yet for inviting a new authenticated user + creating their Membership + linking a `drivers` row together — building any part of that casually risks fabricating a fake invite flow or creating orphaned auth users with no way to sign in.
- **Status:** CONFIRMED — implemented (by omission for Facilities/Fleet; by explicit refusal for Drivers).
- **Reason:** Work item §17/§19/§21's own explicit instruction: "do NOT broaden RLS merely for CRUD convenience," and for Drivers specifically, "Do not casually implement 'Add Driver' unless the product has a safe, coherent Driver + Membership + user-invite contract... Record Driver onboarding as S9 work." Facilities/Fleet's own deferral is pure scope discipline (already-safe RLS, just not enough phase budget to also build the forms) — Drivers' deferral is a real, structural gap (GAP-15) that needs its own dedicated, security-reviewed design, not a rushed form.
- **Affected Product Areas:** `src/lib/operations/{facilities,drivers,vehicles}-list.ts`
- **Dependencies:** None
- **Owner:** Security / Product
- **Review Trigger:** GAP-15 (Driver onboarding) is real, expected P1-E3-S9 work — not merely a "someday" item.

### ZD-187 — A real, accessible account menu with working Sign Out, reusing an already-correct but unwired action

- **Date:** 2026-09-02
- **Category:** Security / Accessibility
- **Decision:** The top-right Operations avatar becomes a real `AccountMenu` (WAI-ARIA menu-button pattern: keyboard open, `Escape`, click-outside, `aria-haspopup`/`aria-expanded`/`role="menu"`) showing the real organization name, real role, a conditional Switch Organization link, and Sign Out. Sign Out calls the PRE-EXISTING `signOutAction` (`src/lib/auth/sign-out-action.ts`) — real `supabase.auth.signOut()`, the `zw_org_context` cookie cleared, redirect to `/sign-in` — unchanged, not reimplemented; it was already correct and already used by the Driver header, simply never wired into Operations.
- **Status:** CONFIRMED — implemented and verified with a real, live sign-out security test (4/4 PASS): pre-sign-out access works, Sign Out redirects to `/sign-in`, the SAME session's next `/operations` request is denied, and browser back-navigation does not restore a functional authenticated view.
- **Reason:** Zero visible way to sign out of Operations is a genuine trust/security-hygiene problem for any commercial evaluation, not merely a UX gap — a shared or public machine had no in-app way to end an Operations session. Discovering the fix required no new mutation logic (the action already existed, correctly) reinforced that this was a pure navigation-wiring gap, not a missing capability.
- **Affected Product Areas:** `src/components/operations/AccountMenu.tsx` (new), `src/components/operations/AppHeader.tsx`, `src/components/operations/OperationsLayoutClient.tsx`, `src/app/operations/layout.tsx`
- **Dependencies:** None
- **Owner:** Security
- **Review Trigger:** None anticipated.

### ZD-188 — Billing/Reports/Settings removed from visible navigation; routes kept unlinked, not deleted or faked

- **Date:** 2026-09-02
- **Category:** Product / Design
- **Decision:** `OperationsSidebar`'s `NAV_ITEMS` drops Billing and Reports (both real Next.js route files, both real `OperationsRouteStub` placeholders — kept on disk, reachable by direct URL only, linked from nowhere in the app). The bottom-rail Settings link (pointing at `/operations/settings`, which has no route file at all — a genuine 404) is removed entirely, not redirected or stubbed.
- **Status:** CONFIRMED — implemented, verified live (0 sidebar items beyond the real 7; zero `a[href="/operations/settings"]` anywhere in the DOM).
- **Reason:** Work item §26/§31/§32's own explicit instructions: hide, don't fake, and don't delete the underlying files "unless there is a compelling code-cleanup reason" (none exists — they remain useful scaffolding for whenever each is actually built). Building an empty Settings page merely to avoid a 404 was explicitly rejected — an empty page is its own kind of dishonest surface, not meaningfully better than a 404 a normal user would never reach anyway once the link is gone.
- **Affected Product Areas:** `src/components/operations/OperationsSidebar.tsx`
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** Restore Billing/Reports navigation once either has a real screen; build `/operations/settings` before ever linking to it again.

### ZD-189 — Commercial demo data seeded through the same `supabase/seed.sql` path as every other fixture, no special demo mode

- **Date:** 2026-09-02
- **Category:** Architecture / Sales Enablement
- **Decision:** "Harmony Medical Transport" (the commercial demo organization) is a plain, additive block appended to the existing `supabase/seed.sql`, created via the exact same `auth.users`/`organizations`/`memberships`/`trips`/etc. rows every other fixture organization uses, reachable through the exact same application code, RLS policies, and RPCs. No `demo=true` flag, feature branch, or parallel data path exists or was considered.
- **Status:** CONFIRMED — implemented, verified live across 3 consecutive `supabase db reset` cycles (25/25 real end-to-end checks each run — assign, driver lifecycle, location sharing, issue report/resolve, completion — all real database mutations through the production code path).
- **Reason:** Work item's own explicit instruction. A special demo mode would risk two products silently diverging (the one shown to buyers vs. the one actually shipped) and would undermine every "this is real, not staged" claim in `zenward-demo-script.md`/`sales-claims-boundary.md` — the honesty of the demo depends entirely on it running through the same code as production use.
- **Affected Product Areas:** `supabase/seed.sql` only — no application code touched this phase.
- **Dependencies:** None
- **Owner:** Product / Engineering
- **Review Trigger:** Any future work that adds a genuinely separate demo/sandbox environment should revisit this decision explicitly rather than let one grow silently.

### ZD-190 — Buyer-facing demo data deliberately does NOT use the `Fictional:`/`Fictional X` QA-fixture naming convention

- **Date:** 2026-09-02
- **Category:** Sales Enablement / Data Design
- **Decision:** Every other fixture organization in `supabase/seed.sql` (Org A, Org B, etc.) uses an explicit `Fictional:`/`Fictional Passenger A1`-style prefix so engineering test output is unambiguously test data. Harmony Medical Transport's passengers, drivers, facilities, and vehicles use plausible, professional-sounding names instead (e.g. "Dorothy Simmons," "Cascade Dialysis Center") — documented explicitly in the seed file's own comment block, not merely an unstated inconsistency.
- **Status:** CONFIRMED — implemented, verified live: no QA-style name appeared on any Harmony-signed-in screen across the full verification pass (`docs/commercial/commercial-demo-readiness-audit.md`).
- **Reason:** A buyer evaluating Zenward needs to see "realistic in appearance, fictional in substance" — a QA-prefixed name in front of a prospective operator would read as unfinished or careless, undermining the exact trust the demo exists to build. This is a deliberate, reviewed departure from the codebase's own established fixture convention, not an oversight — the two conventions serve genuinely different audiences (engineers verifying test isolation vs. a buyer evaluating a product).
- **Affected Product Areas:** `supabase/seed.sql` only.
- **Dependencies:** None
- **Owner:** Product / Sales
- **Review Trigger:** None anticipated — revisit only if a future phase needs the demo org's own data to double as engineering test fixtures (not recommended; keep the two concerns separate).

### ZD-191 — Dispatch's own trip count relabeled "open trips today"; Today's Operations keeps "trips today" — no query logic changed

- **Date:** 2026-09-03
- **Category:** Product / UX
- **Decision:** Today's Operations and Dispatch each show a real, already-correct-for-their-own-purpose trip count that happened to share the identical label "trips today" despite measuring different scopes (Today's Operations: every trip scheduled today, any state; Dispatch: only trips still in a non-terminal state — i.e., still actionable). Dispatch's label changes to **"open trips today"**; Today's Operations' label is unchanged. The underlying queries (`dispatch-board.ts`, `todays-operations.ts`) are byte-for-byte unchanged — this is a labeling fix only, not a scope change.
- **Status:** CONFIRMED — implemented, verified live (`docs/commercial/commercial-demo-readiness-audit.md` finding #2, now RESOLVED).
- **Reason:** A commercial-trust audit (P1-E3-S8C) flagged that a buyer glancing between the two screens could reasonably wonder why "trips today" showed two different numbers. Forcing the counts to match would have been dishonest (the two scopes are genuinely, correctly different); instead the fix makes the existing, already-correct scope self-evident from the label alone, so no salesperson explanation is ever required.
- **Affected Product Areas:** `src/app/operations/dispatch/page.tsx` (label only), `src/lib/operations/dispatch-board.ts` / `todays-operations.ts` (documentation comments only, no logic change).
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** If a future phase adds a third "trips today"-shaped count anywhere else in the product, define its own distinct label up front rather than reusing either existing one.

### ZD-192 — Commercial demo geography made entirely fictional; a real display name resolves the account-menu identity slot for Harmony staff

- **Date:** 2026-09-03
- **Category:** Sales Enablement / Data Design / Security
- **Decision:** Two related P1-E3-S8C1 fixes: (1) every Harmony Medical Transport facility/pickup/destination address now uses an entirely fictional, internally consistent 4-town geography (Ashcombe / Fernvale / Millbrook / Eastfield, GA) rather than the original phase's real Atlanta-area street names — facility/passenger/business NAMES were already fictional (ZD-190); only the addresses themselves needed correcting. (2) Harmony's own Operations-facing staff (`owner@`/`dispatch@harmonytransport.test`) now have real `user_profiles.display_name` rows ("Renata Castillo," "Sam Delgado") — the prior absence of a display name meant `getDisplayName()`'s documented email fallback rendered a full email address in the sidebar's identity slot, which was the actual root cause of the account-menu truncation a commercial audit flagged (not a CSS bug alone). The sidebar/account-menu layout was also hardened independently (`min-w-0`/`truncate`/`title`) so any future long identity value still degrades gracefully.
- **Status:** CONFIRMED — implemented, verified live across a fresh `supabase db reset` (12/6/3/3/3/1/2 fixture counts unchanged) and a full crawl of every buyer-facing screen (42/43 automated checks PASS, the one "failure" a false-positive regex match on a phone number containing "404"). See `docs/reports/P1-E3-S8C1-commercial-trust-closure-report.txt`.
- **Reason:** A real-world street/facility association in fictional demo data, and a buyer-facing screen showing a staff member's raw email instead of a name, are both commercial-trust problems even though neither was a security defect — the QA fixture orgs (Org A/B) are unaffected and intentionally keep exercising the real email-fallback path, since that remains correct, tested behavior for accounts that genuinely have no profile name.
- **Affected Product Areas:** `supabase/seed.sql` (facility/trip/request addresses, driver-location coordinates, new `user_profiles` rows), `src/components/operations/OperationsSidebar.tsx`, `src/components/operations/AccountMenu.tsx`.
- **Dependencies:** None
- **Owner:** Product / Sales / Security
- **Review Trigger:** None anticipated for the geography; the layout hardening should be revisited only if a future design system change removes `min-w-0`/`truncate` support from the underlying primitives.

### ZD-193 — Self-service organization creation via one atomic SECURITY DEFINER RPC, not a raw INSERT grant

- **Date:** 2026-09-03
- **Category:** Architecture / Security
- **Decision:** `organizations` and `memberships` still have NO raw INSERT grant to `authenticated` — organization creation was never opened up as a direct client capability, even though self-service signup is now a genuine, explicitly-authorized new feature (P1-E3-S9). `signup_create_organization` is the sole controlled path: one SECURITY DEFINER function that atomically creates a UserProfile, a new Organization, and the caller's own hard-coded `organization_admin` Membership in a single transaction — mirroring `create_trip`'s own established pattern exactly (state/role is a Postgres literal in the function body, never a parameter).
- **Status:** CONFIRMED — implemented, verified via 6 dedicated SQL tests (SIGNUP-1 through SIGNUP-6) plus a full live browser signup.
- **Reason:** `organizations.sql`'s original comment framed creation as "a platform-level action, not a normal-user capability" (P1-E1). This phase deliberately, explicitly extends WHO may trigger that platform-level action (any authenticated user, not just a service role) — but the MECHANISM stays exactly consistent with the original framing: still no raw grant, still a narrow, controlled, audited path, just one now reachable by ordinary users for a legitimate new purpose. Work item §2's "failed signup does not leave a broken partial state" is satisfied structurally: the one implicit transaction rolls back atomically, and the one piece that can't roll back (the auth user itself, created by a prior, separate `signUp()` call) simply lands in the already-safe, already-tested "authenticated, zero Membership" state if nothing further happens.
- **Affected Product Areas:** `supabase/migrations/20260903100000_organization_signup.sql`, `src/app/sign-up/`.
- **Dependencies:** None
- **Owner:** Security / Engineering
- **Review Trigger:** None anticipated.

### ZD-194 — `current_driver_id()` relaxed from `role='driver'` to `status='active'` (any role) — Owner-Operator Mode vs. ZD-100

- **Date:** 2026-09-03
- **Category:** Security
- **Decision:** `current_driver_id()` — the function every Driver-scoped RLS policy and RPC ultimately calls — previously required the caller's Membership to have `role = 'driver'` specifically (P1-E2-S3, ZD-100's own fix for a real vulnerability: an inactive Membership retaining Driver access through a stale `drivers.status='active'` row). This phase relaxes that to simply requiring an ACTIVE Membership of ANY role, found necessary via direct live testing while building Owner-Operator Mode (an organization_admin who self-links a Driver row keeps `role='organization_admin'`, by design — so the old check could never pass for them, making the feature structurally impossible).
- **Status:** CONFIRMED — implemented (`20260903100700_current_driver_id_owner_operator_mode.sql`), verified: ZD-100's own original property (inactive Membership → zero Driver access, ANY role) re-confirmed via a fresh test (OWNERDRIVER-5) in addition to the pre-existing `driver_read_authorization_tests.sql` DETAIL-6/DETAIL-7, both still passing unchanged.
- **Reason:** The real security property ZD-100 protected was never "is this specifically a Driver-role Membership" — it was "does an INACTIVE Membership retain access through a stale Driver row." That property is fully preserved by the relaxed check (still requires `m.status = 'active'`); only the now-too-narrow additional role restriction was dropped, and only because this phase introduces a real, reviewed, self-only new case (Owner-Operator Mode) that legitimately needs it.
- **Affected Product Areas:** `public.current_driver_id(uuid)` — and therefore, transitively, every Driver-scoped RLS policy and RPC (no other code changes needed, matching the original ZD-100 migration's own "every caller is corrected automatically" note).
- **Dependencies:** Enables ZD-196 (Owner-Operator Mode) and the `/driver/*` route-guard relaxation.
- **Owner:** Security
- **Review Trigger:** Any future change to Membership's role model should re-verify this function's own comment and test coverage remain accurate.

### ZD-195 — Retired the broad, unconditional `drivers.user_id` client UPDATE grant

- **Date:** 2026-09-03
- **Category:** Security
- **Decision:** `drivers.user_id` — the column that determines which auth account a Driver row is linked to — is no longer in the client-reachable UPDATE column grant. Before this phase, `drivers_update_org_admin`'s column grant included `user_id` with no constraint on what value it could be set to: an organization_admin could set any Driver row's `user_id` to ANY `auth.users.id`, including a completely unrelated person's account, silently granting them Driver access without consent. Never exercised by any shipped feature (Driver onboarding was GAP-15, unbuilt until this phase), but genuinely live-exploitable via a direct REST/RPC call.
- **Status:** CONFIRMED — implemented (`20260903100300_retire_direct_driver_user_id_update.sql`), verified: `information_schema.column_privileges` directly inspected before and after; the full SQL regression suite re-confirmed 309/309 unaffected.
- **Reason:** `link_self_as_driver` and `redeem_driver_invite` (both SECURITY DEFINER, both structurally self-only — see ZD-196) are now the sole paths that ever set this column, and both are incapable of targeting anyone other than `auth.uid()` itself. This mirrors the exact "retire the broad direct grant, add a controlled narrow path" precedent GAP-1/ZD-101 already established for `trips` INSERT.
- **Affected Product Areas:** `public.drivers` table grants.
- **Dependencies:** None
- **Owner:** Security
- **Review Trigger:** None anticipated.

### ZD-196 — Driver invite is a token-gated record, never admin-created credentials

- **Date:** 2026-09-03
- **Category:** Security / Architecture
- **Decision:** Closing GAP-15 (Driver Onboarding), the organization admin never creates the invited driver's account or handles their password. `create_driver_invite` creates only a `driver_invites` row (email, display name, a random token). The invitee signs up themselves through ordinary Supabase Auth with the matching email, then calls `redeem_driver_invite(token)` — which takes NO `organization_id` parameter at all (resolved entirely from the invite row) — to atomically get a `driver` Membership and a linked Driver row.
- **Status:** CONFIRMED — implemented, verified via 9 dedicated SQL tests (INVITE-1 through INVITE-6, REDEEM-1 through REDEEM-5) plus a genuine two-process concurrency test plus a full live browser redemption flow (sign up with the invited email → land on `/driver` → real Membership + Driver rows confirmed in the database).
- **Reason:** Work item §10's own explicit requirements — "no orphan Driver/Auth records on partial failure," "invite cannot create foreign-org membership," "no broad direct INSERT/UPDATE grants" — are all satisfied structurally by this design, not merely by careful error handling: the auth user's creation is entirely outside this feature's own transaction (Supabase Auth's own already-atomic `signUp()`), and cross-org redemption isn't merely denied, it's not expressible as an input (no org_id parameter exists to supply).
- **Affected Product Areas:** `driver_invites` (new table), `create_driver_invite`/`revoke_driver_invite`/`get_driver_invite_preview`/`redeem_driver_invite`, `src/app/join/[token]/`.
- **Dependencies:** ZD-195 (the narrowed `drivers.user_id` grant this design relies on).
- **Owner:** Security / Product
- **Review Trigger:** If a real outbound-email capability is ever added, revisit whether the invite link should also be emailed automatically rather than shared manually by the admin (deliberately out of scope this phase — no email delivery is configured in this environment at all).

### ZD-197 — `business_stage`-driven navigation personalization deliberately deferred (GAP-16)

- **Date:** 2026-09-03
- **Category:** Product / UX
- **Decision:** Work item §12's "progressive complexity" framing suggested a business-stage-aware navigation reorder (STARTING operators seeing "My Trips/Drive" emphasized over "Dispatch/Fleet"). This phase built only the one genuinely-derived, safe piece — the conditional "Drive" sidebar item, gated on a real linked Driver row, never on `business_stage` itself — and deliberately did NOT build a `business_stage`-keyed reordering or hiding of the existing 7-item Operations nav.
- **Status:** CONFIRMED — deliberate deferral, recorded as GAP-16, not a silently-dropped requirement.
- **Reason:** The exact target nav composition per business stage was not specified precisely enough to build safely without real risk of regressing the already-tested navigation for every other operator size, within this phase's time budget. A real derived signal (a linked Driver row) was judged safer and more honest than a self-reported, easily-stale `business_stage` value driving what controls someone can even see.
- **Affected Product Areas:** None (no code change).
- **Dependencies:** None
- **Owner:** Product
- **Review Trigger:** A dedicated future work item, with exact target nav compositions specified up front.

### ZD-198 — Staging Supabase Auth URLs configured via the Dashboard, never via a blind `supabase config push`

- **Date:** 2026-09-03
- **Category:** Architecture / Security
- **Decision:** `supabase config push` (which pushes the ENTIRE local `supabase/config.toml` — including `site_url = "http://127.0.0.1:3000"` — to a linked remote project) is deliberately never run against the staging project. Auth URL Configuration (Site URL, Redirect URLs) for staging is set directly in the Supabase Dashboard instead, documented precisely in `docs/deployment/staging-auth-configuration.md` rather than automated.
- **Status:** CONFIRMED — decision made; the actual dashboard values were NOT applied this phase (the confirmed, stable staging URL was not available — see the phase's own report, §Blockers).
- **Reason:** Local dev's own `config.toml` is correctly tuned for `127.0.0.1` — blindly pushing it to a cloud project would silently break every auth email's link (they all resolve from Site URL when the app itself, verified directly, never passes an explicit `emailRedirectTo`). A staging-specific configuration path (a distinct profile/file, or dashboard-direct entry) is required; dashboard-direct was chosen as the simplest, lowest-risk option for a single environment.
- **Affected Product Areas:** None (no application code) — Supabase project configuration only.
- **Dependencies:** Blocked on confirming the stable staging URL (see report).
- **Owner:** Engineering / DevOps
- **Review Trigger:** If a genuine multi-environment `supabase config push` workflow is ever needed (e.g., a real production Supabase project later), design a proper per-environment config file/profile mechanism rather than continuing to configure staging by hand indefinitely.

### ZD-199 — Vercel's "Production" environment label does not imply a real customer-facing release

- **Date:** 2026-09-03
- **Category:** Architecture / Deployment
- **Decision:** The already-connected Vercel project (`zenwardmobility/ZenwardApp`) auto-deploys every push to `main`, and Vercel's own dashboard labels every such deployment "Production" — this phase does NOT treat that label as meaning a real, customer-facing release, and does not change any behavior based on it. The actual facts that matter — no custom domain attached (`app.zenwardmobility.com` does not resolve), Deployment Protection (Vercel SSO) restricting access — are what this phase relies on to treat the existing setup as safely staging-equivalent, not the Vercel-internal branch-environment label.
- **Status:** CONFIRMED — documented in `docs/deployment/staging-architecture.md` §2. No domain configuration, no public-access change, no Production Supabase project was created or connected (work item §15).
- **Reason:** Avoids two failure modes: (a) mistakenly treating "Production"-labeled as requiring production-grade caution that would have blocked this entire phase unnecessarily, and (b) mistakenly treating it as truly public/production-ready and skipping the real safety checks (domain, protection, data) that actually matter. Both were checked directly, not assumed either way.
- **Affected Product Areas:** None (infrastructure/process only).
- **Dependencies:** None
- **Owner:** Engineering / DevOps
- **Review Trigger:** Before any future phase attaches a real custom domain or disables Deployment Protection permanently — at that point, "Production" starts meaning what it says, and this decision should be explicitly revisited.

### ZD-200 — Signup continuation lives in a Route Handler, not a Server Component page

- **Date:** 2026-09-03
- **Category:** Architecture
- **Decision:** `/complete-signup` (P1-E4-S0A1 §5) — the authoritative continuation point for a zero-Membership authenticated visitor — is a Next.js Route Handler (`route.ts`), not a Server Component page. An earlier version of this fix put the identical routing/completion logic in a `page.tsx` and found, via live local testing (a real Mailpit-delivered confirmation email, a real link click, then sign-in), that a Server Component's own `redirect()` — issued from a chained client-router navigation, after an internal `await` for the mutating RPC — was silently not followed by the browser: the Organization/Membership were correctly created every time (confirmed directly against the database), but the on-screen URL never advanced past `/complete-signup` until a hard reload of that same URL redirected onward correctly.
- **Status:** CONFIRMED — implemented (`src/app/complete-signup/route.ts` + `src/app/complete-signup/form/page.tsx`), verified via 9 clean local browser runs (including two full real-email-confirmation-to-Operations/`/driver` proofs) after the fix, each showing the correct destination reached without a stuck intermediate state.
- **Reason:** A Route Handler always returns a real HTTP redirect response with a `Location` header — the well-trodden path Next.js's client-side navigation is built to follow — instead of an RSC-payload-embedded soft redirect nested inside an already-redirect-triggered render. This is a genuine, reproducible Next.js App Router behavior (observed on 16.3.3), not a one-off flake — worth remembering for any FUTURE multi-hop "mutate then redirect, reached via a redirect chain" flow in this codebase: prefer a Route Handler.
- **Affected Product Areas:** `/complete-signup` only, this phase. Documented here as a durable pattern for future similar flows.
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** If a future Next.js upgrade changes this behavior, this decision (and its underlying assumption) should be re-verified rather than assumed to still hold.

### ZD-201 — Signup-completion destination is decided from observable organization state, not from "did this request create it"

- **Date:** 2026-09-03
- **Category:** Architecture / Correctness
- **Decision:** `/complete-signup`'s "already a Member" branch does not simply route every existing member to Operations/Driver. For an `organization_admin` whose organization's own `business_stage` is still `null` (never touched onboarding), it routes to `/onboarding` even though THIS particular request did not create the Membership itself.
- **Status:** CONFIRMED — implemented, directly motivated by a genuinely observed local race: Next.js's dev-mode client navigation fired two concurrent GET requests to `/complete-signup` for one sign-in; the first created the Organization and correctly resolved to redirect to `/onboarding`, but the second (racing shortly after, seeing the now-already-created Membership) would have redirected to `/operations` instead had the destination logic only asked "did I just create this." Fixed by checking the organization's own `business_stage` instead. Re-verified: the same race, reproduced again after the fix, correctly lands on `/onboarding` from either request.
- **Reason:** `complete_pending_signup()`'s own idempotency guarantee (advisory lock + Membership-existence check) correctly guarantees the Organization/Membership/UserProfile are created EXACTLY ONCE regardless of how many concurrent requests occur — but "exactly once" is a property of the DATA, not of which HTTP request happens to observe that fact first. Routing decisions built on "this specific request's own return value" are not safe under concurrency; routing decisions built on durable, queryable state are.
- **Affected Product Areas:** `src/app/complete-signup/route.ts`.
- **Dependencies:** ZD-200.
- **Owner:** Engineering
- **Review Trigger:** None anticipated — this is a general pattern worth keeping in mind for any future "first-time-only" UX decision reached via a potentially-racing entry point.

### ZD-202 — Email confirmation uses a dedicated SSR callback (`/auth/confirm`), not Supabase's own hosted redirect

- **Date:** 2026-09-03
- **Category:** Architecture / Security
- **Decision:** The Confirm Signup email template links directly to this application's own `/auth/confirm?token_hash={{ .TokenHash }}&type=signup` (a Route Handler that calls `verifyOtp()` server-side) rather than Supabase's default `{{ .ConfirmationURL }}`, which redirects through Supabase's own hosted `/auth/v1/verify` endpoint.
- **Status:** CONFIRMED — implemented (`src/app/auth/confirm/route.ts`, `src/app/auth/auth-code-error/page.tsx`), verified live and locally with a real Mailpit-delivered email for both operator signup and Driver-invite signup — session established directly, no manual sign-in, exactly-once Organization/Membership/UserProfile in every run, a repeated click of the same link fails safely (Supabase's OTP tokens are single-use).
- **Reason:** Directly root-caused, not assumed: Supabase's hosted `/auth/v1/verify` redirect encodes the new session as a URL fragment (`#access_token=...`), which is never sent to any server and is only readable by client-side JavaScript — this application has none that reads it, so no session was ever established via that path, regardless of how correctly Site URL/Redirect URLs were configured. The canonical Supabase Next.js SSR pattern (`token_hash`/`type` as plain query parameters, verified server-side) is the documented fix for exactly this class of app.
- **Affected Product Areas:** `/sign-up`, `/join/[token]` (both share the same "Confirm signup" email category), the Supabase Dashboard's own email template configuration for the staging/production project.
- **Dependencies:** ZD-200/ZD-201 (`/complete-signup`, which this callback hands off to on success).
- **Owner:** Engineering / Security
- **Review Trigger:** If Supabase ever changes its own hosted verify-endpoint behavior to support a session-establishing redirect natively, revisit whether the dedicated callback is still needed.

### ZD-203 — Local Supabase `site_url` set to `localhost`, not `127.0.0.1`

- **Date:** 2026-09-03
- **Category:** Local Development Environment
- **Decision:** `supabase/config.toml`'s `site_url` changed from `http://127.0.0.1:3000` to `http://localhost:3000` (with `127.0.0.1` variants kept in `additional_redirect_urls` for flexibility).
- **Status:** CONFIRMED — implemented, verified: the confirmation-link E2E proof only succeeded once this change was made.
- **Reason:** A genuine Next.js dev-server (Turbopack) behavior, found while debugging why `/auth/confirm` established a session but the browser never appeared authenticated afterward: an incoming request's own `request.url`/`nextUrl.origin` was silently normalized to `"localhost"` regardless of whether the literal request used `127.0.0.1` or `localhost` as the host. A redirect built from that value therefore targeted a different host than the one the session cookie had just been written for, and the browser correctly refused to forward it. Matching `site_url` to what the dev server actually canonicalizes to (already `.env.local`'s own `NEXT_PUBLIC_APP_URL` value) fixes this at the root, rather than working around it per-route. Confirmed as a local-only artifact — the real deployed app has exactly one canonical host at all times, so this cannot occur in staging/production.
- **Affected Product Areas:** Local development environment only — no application code, no staging/production configuration.
- **Dependencies:** None
- **Owner:** Engineering
- **Review Trigger:** None anticipated.

No decisions have been REJECTED as of this update. ZD-142 has been SUPERSEDED by ZD-145. ZD-145 has been AMENDED by ZD-146 (same day) — its one incorrect bullet is struck through and corrected in place, per explicit instruction not to preserve contradictory documentation; the rest of ZD-145 (the decision to add the parameter at all) remains valid and unedited. ZD-172 has been SUPERSEDED by ZD-177 (same day) — its "leave the direct policies in place" reasoning is struck through and corrected in place.

**Related documents:** [product-definition.md](./product-definition.md) · [scope-register.md](./scope-register.md) · [domain-model.md](./domain-model.md) · [lifecycle-model.md](./lifecycle-model.md) · [authorization-model.md](./authorization-model.md) · [public-marketing-separation.md](./public-marketing-separation.md) · [schema.md](../data/schema.md) · [rls-model.md](../security/rls-model.md) · [mutation-api.md](../data/mutation-api.md) · [mutation-authorization.md](../security/mutation-authorization.md) · [read-api.md](../data/read-api.md) · [driver-data-minimization.md](../security/driver-data-minimization.md)
