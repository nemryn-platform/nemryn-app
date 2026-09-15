# Nemryn — Product Language

**Phase:** NEMRYN G1-A (terminology LOCKED in G1-B — Brand Lock)
**Status:** Controlled vocabulary. As of G1-B the term decisions in §5 are **locked** (see [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §Terminology and [`CHANGELOG-g1-b.md`](./CHANGELOG-g1-b.md)). **This still does not authorize renaming anything in the codebase — code and schema identifiers are untouched.**
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** [`00-brand-foundation.md`](./00-brand-foundation.md), [`03-verbal-identity.md`](./03-verbal-identity.md)

---

## 1. How to use this file

- This is the single source of truth for what Nemryn's product terms **mean** and
  how they are **written**.
- If a term is used in a screen, a doc, or marketing, it must match this file.
- "Capitalization" column: **Title-case proper noun** = it's the name of a
  specific Nemryn surface/concept ("the Operations Brief"). **lowercase common
  noun** = it's an ordinary operational object ("a trip," "a request").
- "Requires future naming review" is flagged per term and collected in §5.
- The existing application already uses many of the lowercase common nouns
  (trips, requests, drivers, vehicles, passengers, facilities, dispatch). Those
  are correct and stay. The Title-case concept names are mostly **not yet built**.

## 2. Two tiers of vocabulary

| Tier | What it is | Examples |
|---|---|---|
| **Operational objects** (lowercase) | The nouns of the domain. Stable, ordinary, already in the product. | request, trip, assignment, driver, vehicle, passenger, facility, exception, standing order, proof of service, manifest |
| **Nemryn concepts** (Title Case) | Named product surfaces or organizing ideas Nemryn introduces. Some are screens, some are lenses over the data. | Operations Brief, Request Hub, Trip Readiness, Trip Assurance, Tomorrow Readiness, Exception Recovery, Recurring Service Assurance, Proof of Service, Revenue Assurance, Capacity |

### 2.1 Navigation label vs product concept

Two of these have a **plain navigation label** (what a working operator sees in
daily nav) that differs from the **product concept name** (used in marketing,
docs, feature explanation, release notes):

| Product concept | Daily navigation label |
|---|---|
| Request Hub | **Requests** |
| Recurring Service Assurance | (surfaces as **standing orders** work; the assurance framing is a concept, not a nav item in v1) |

Where a concept and a nav label both exist, the nav label is the shorter, plainer
one. Never put "Hub", "Assurance", "Intelligence", or a marketing concept name in
the primary daily navigation.

## 3. Operational objects (the domain nouns)

### trip

- **Meaning:** one instance of moving one passenger from an origin to a
  destination on a date/time, with everything that instance needs (passenger,
  pickup, drop-off, mobility requirements, authorization, assigned driver and
  vehicle). The **primary business object** in Nemryn.
- **Is NOT:** a form submission; a request (a request may *become* one or more
  trips); a route; a driver's whole day (that's a set of trips); a ride in the
  consumer sense.
- **Appears in:** everywhere — Operations Brief, Trips list, Dispatch, Trip
  Readiness, Proof of Service, Revenue Assurance, driver surface.
- **Round trip (LOCKED as product-language direction, G1-B):** a round trip is
  represented conceptually as **two linked trips — an outbound trip and a return
  trip** — both linked to the same request / transportation obligation. Each trip
  has its own readiness, driver/vehicle assignment, pickup/drop-off, and proof of
  service; the request is what holds them together. This is *product-language
  direction only* and is **subject to data-model validation before any
  implementation** — the current schema is not changed in G1-B, and whether the
  data model already supports this cleanly is a question for the implementation
  phase.
- **Capitalization:** lowercase "trip." Identifier form: `Trip 4471` (capital T,
  no `#`).

### request

- **Meaning:** an inbound ask for transportation, before it is a committed trip.
  Comes from a facility, a passenger, a caregiver, or a standing order
  generating one. Carries intent (who, roughly when, to/from where, why) but not
  yet a full trip's worth of confirmed detail.
- **Is NOT:** a trip; a booking (avoid "booking" entirely — see §6); a lead.
- **Appears in:** the **Requests** surface (concept name: **Request Hub**),
  Operations Brief (as "new requests"), intake screens.
- **One request → one or more trips (LOCKED, G1-B):** a single request can
  produce more than one executable trip — a round trip (outbound + return), or a
  standing order's recurring occurrences. "Request" always means the ask;
  "trip(s)" always means what gets executed.
- **Capitalization:** lowercase "request." Nav label **Requests**; concept name
  **Request Hub** (marketing / docs / feature explanation / release notes only).
  Identifier form: `Request 8820`.

### assignment

- **Meaning:** the linking of a driver (and vehicle) to a trip. An assignment can
  be proposed, confirmed, or changed.
- **Is NOT:** the trip itself; a schedule; dispatch (dispatch is the activity;
  assignment is the result).
- **Appears in:** Dispatch, Trip Readiness, driver surface ("Trip added").
- **Ambiguity:** "assigned" vs "confirmed" — an assigned driver has not
  necessarily acknowledged. Nemryn distinguishes: **assigned** (Nemryn linked
  them) vs **confirmed** (the driver accepted / it's locked). Both states matter
  for readiness.
- **Capitalization:** lowercase.

### dispatch

- **Meaning:** the activity of assigning, sequencing, and adjusting drivers and
  vehicles against the day's trips; also the name of the screen where that
  happens.
- **Is NOT:** a call center; a person's job title alone (a "dispatcher" is a
  role); routing/optimization (Nemryn does not claim route optimization as a
  feature in G1 positioning).
- **Appears in:** Dispatch screen, navigation.
- **Capitalization:** lowercase "dispatch" as activity; "Dispatch" acceptable as
  the screen/nav label.

### driver

- **Meaning:** a person who operates a vehicle to complete trips for an operator.
  In Nemryn's data model a driver is linked to an operator (organization) and may
  or may not be a full platform user with a login. (The current app already
  models this: `drivers` rows, plus a Membership when they have an account.)
- **Is NOT:** necessarily a Nemryn account holder; a contractor-vs-employee
  distinction (Nemryn is neutral on employment type).
- **Appears in:** Drivers list, Dispatch, assignments, driver surface, driver
  invites.
- **Capitalization:** lowercase "driver." "Driver" acceptable as a nav/section
  label and when it's clearly the role name.

### vehicle

- **Meaning:** a physical asset used to perform trips, with attributes that
  affect readiness (capacity, wheelchair accessibility, stretcher capability,
  registration/inspection status).
- **Is NOT:** "car" / "van"; a GPS unit.
- **Appears in:** the **Vehicles** list, Dispatch, Trip Readiness.
- **"Fleet" (LOCKED, G1-B):** "fleet" may be used in **prose** to mean the
  operator's whole collection of vehicles ("a growing fleet"). It is **not** the
  module/nav label. The navigation/module label is **Vehicles**.
- **Capitalization:** lowercase "vehicle." Nav/module label: **Vehicles**.

### passenger

- **Meaning:** the person being transported. Has a mobility profile, a home
  address, often a facility relationship and an authorization/payer.
- **Is NOT:** "patient" (Nemryn is not clinical — see §6); "customer" (the
  operator's customer is often the facility or payer); "rider" (consumer term);
  "client."
- **Appears in:** Passengers list, trip detail, requests, driver surface (name +
  pickup only — minimized).
- **Ambiguity:** the person who *requests* transportation isn't always the
  passenger (a caregiver, a facility scheduler). Nemryn: "requester" for whoever
  submits, "passenger" for who travels.
- **Capitalization:** lowercase.

### facility

- **Meaning:** a healthcare site that is an origin/destination and often the
  source of requests and standing orders (dialysis center, hospital, clinic,
  SNF, adult day care).
- **Is NOT:** the operator; a payer; a passenger's home (that's an address, not a
  facility).
- **Appears in:** Facilities list, requests, trip origins/destinations, facility
  coordination.
- **Capitalization:** lowercase.

### exception

- **Meaning:** a deviation from the plan that threatens or has broken service — a
  no-show driver, a passenger not at pickup, a vehicle breakdown, a trip running
  so late it fails its purpose.
- **Is NOT:** a warning (a warning is "attention required, still time"); an error
  (software fault); a cancellation (a decided non-event).
- **Appears in:** Operations Brief (as "needs attention"), Exception Recovery,
  Trip Assurance.
- **Ambiguity:** the line between "warning/attention" and "exception/critical."
  Nemryn: an **exception** is active service jeopardy needing a decision now; a
  **readiness concern** is amber and pre-emptive. Keep them distinct.
- **Capitalization:** lowercase "exception."

### standing order

- **Meaning (LOCKED, G1-B):** a **recurring transportation arrangement that
  generates individual trips** on a schedule (e.g. dialysis Mon/Wed/Fri), tied to
  a passenger and usually a facility and an authorization. This is the industry
  operational term and is Nemryn's name for the object.
- **Is NOT:** a single recurring request; a subscription (billing term); a
  "template"; "recurring care" (dropped in G1-B — "care" imports unnecessary
  clinical positioning).
- **Appears in:** Recurring Service Assurance, the Requests surface,
  passenger/facility detail.
- **Naming (LOCKED, G1-B):** the object is a **standing order**. The Nemryn
  capability that watches over standing orders is **Recurring Service
  Assurance** (renamed from the G1-A "Recurring Care Assurance"). The conceptual
  split:
  - **standing order** = the operational recurring-transportation object.
  - **Recurring Service Assurance** = Nemryn's capability for determining whether
    recurring transportation obligations remain *operationally sound* across
    future occurrences.
- **Capitalization:** lowercase "standing order."

### proof of service

- **Meaning:** the record that a trip actually happened as promised — pickup and
  drop-off times/locations, who drove, passenger presence, any signature/
  attestation, notes. What lets the operator bill and answer a facility or payer.
- **Is NOT:** the trip record in general; an invoice; a GPS trace alone.
- **Appears in:** Proof of Service surface, trip detail, Revenue Assurance,
  operator-generated documents.
- **Capitalization:** lowercase "proof of service" as the concept/data; **Proof
  of Service** Title Case when referring to the named surface/feature.

### manifest

- **Meaning:** a driver's ordered list of trips for a shift/day; also an
  operator's list of trips for a facility or a date, as a document.
- **Is NOT:** the schedule (the schedule is everyone's; a manifest is scoped);
  proof of service.
- **Appears in:** driver surface, operator documents, facility coordination.
- **Capitalization:** lowercase.

### capacity

- **Meaning:** how much service the operation can deliver in a period, given
  vehicles, drivers, and their availability — and how much of it is committed.
- **Is NOT:** "utilization" alone; a single number (it's vehicles × time ×
  suitability); dead time (dead time is the *inverse* — unused capacity).
- **Appears in:** the Capacity surface, Growth engine, Dispatch
  (as "the day is getting full").
- **Capitalization:** lowercase.

### dead time

- **Meaning:** paid or available vehicle/driver time that produced no service —
  gaps between trips, deadhead miles, a van sitting idle midday.
- **Is NOT:** break time / legally required rest; scheduled off-hours; "downtime"
  (which implies fault).
- **Appears in:** the Capacity surface.
- **Status (LOCKED, G1-B):** "dead time" **stays in the product vocabulary** as a
  specific operational metric that lives *inside* the Capacity surface. It is
  **not** a surface or module name. Frame it as an operational-efficiency lens on
  the *operation*, never a driver-performance metric.
- **Capitalization:** lowercase "dead time."

## 4. Nemryn concepts (named surfaces / lenses)

### Operations Brief

- **Meaning:** the operator's daily starting point — a concise read of today
  (trips, readiness, what needs attention) and a look at tomorrow. Reads like a
  shift handoff, not a dashboard.
- **Is NOT:** a full dispatch board (that's Dispatch); an analytics dashboard; a
  report; a feed of everything.
- **Appears in:** it's the default landing surface of the application for
  operations roles.
- **Status (LOCKED, G1-B):** **Operations Brief** is the conceptual replacement
  for the application's current **Overview** surface (`navIcons.overview`). It
  should eventually become the application's operational front door and is the
  screen that answers the four operator questions — what is happening / what is
  next / who is responsible / what requires attention. The rename is **not
  implemented in G1-B**; the code identifier `overview` is untouched.
- **"Brief" is always the noun.** Don't shorten to "the Brief" in UI (fine
  internally).
- **Capitalization:** **Operations Brief** (Title Case, proper noun).

### Request Hub

- **Meaning:** where all inbound requests land and are triaged into committed
  trips — across intake channels (facility portal, phone, standing orders).
- **Is NOT:** an inbox of messages; a CRM; the Trips list.
- **Appears in:** the Demand engine; the surface is reached via the **Requests**
  nav label.
- **Status (LOCKED, G1-B):**
  - **Navigation label:** **Requests** (always, in daily nav).
  - **Product concept name:** **Request Hub** — used in marketing, product
    documentation, feature explanation, and release communication. Not in daily
    navigation.
- **Capitalization:** **Request Hub** (concept, Title Case); **Requests** (nav
  label).

### Trip Readiness

- **Meaning:** the evaluation of whether a specific trip is ready to run — a
  checklist of concrete conditions (passenger confirmed, driver assigned &
  confirmed, vehicle suitable & available, authorization valid, pickup details
  complete). Produces a ready / not-ready state **with reasons**.
- **Is NOT:** a yes/no flag with no explanation; trip *status* (in service,
  completed); Trip Assurance (which is about the trip going wrong *after* it's
  ready).
- **Appears in:** trip detail, Operations Brief, Tomorrow Readiness, Dispatch.
- **Capitalization:** **Trip Readiness** as the concept; "ready" / "not ready" as
  the states (lowercase).

### Trip Assurance

- **Meaning:** actively watching trips that are underway or imminent and catching
  the ones that are slipping — running late, driver not moving, passenger not
  reachable — so the operator can intervene before it's a failed trip.
- **Is NOT:** Trip Readiness (pre-flight); Exception Recovery (which handles a
  trip that has *already* broken); a tracking map.
- **Appears in:** Operations Brief ("needs attention"), a live operational view;
  Assurance engine.
- **Scope (LOCKED, G1-B):** Trip Assurance answers exactly one question — *is a
  specific active or upcoming trip progressing as expected?* See §4.1 for the
  Assurance family and why the three scopes stay separate.
- **Capitalization:** **Trip Assurance**.

### Tomorrow Readiness

- **Meaning:** the same readiness evaluation as Trip Readiness, aggregated across
  *tomorrow's* trips, surfaced *today* while there's still time to fix gaps
  (assign the missing driver, confirm the van, renew the authorization).
- **Is NOT:** a forecast; capacity planning; a general "upcoming" list.
- **Appears in:** Operations Brief (the "tomorrow" section), an end-of-day check.
- **"Tomorrow" (LOCKED, G1-B):** "tomorrow" means the **next calendar day** — not
  "the next service day," not "the next day with trips." Do not silently
  reinterpret it.
  - Always show the **actual date** alongside the concept wherever ambiguity
    could matter ("Tomorrow — Wed, Mar 5").
  - **No trips scheduled tomorrow is useful operational information**, shown
    plainly ("No trips scheduled tomorrow"), not hidden and not skipped forward
    to the next day that has trips.
- **Capitalization:** **Tomorrow Readiness**.

### Exception Recovery

- **Meaning:** the workflow for handling an active exception — presenting the
  situation, the options (reassign, reschedule, reattempt, cancel, escalate), the
  owner, and recording the resolution and any notifications sent.
- **Is NOT:** Trip Assurance (detection); an incident report; a support ticket.
- **Appears in:** wherever an exception is opened; Assurance engine.
- **Capitalization:** **Exception Recovery**.

### Recurring Service Assurance

*(Renamed from "Recurring Care Assurance" in G1-B — "care" imported unnecessary
clinical positioning. Nemryn assures recurring **service**, not care.)*

- **Meaning:** determining whether an operator's recurring transportation
  obligations remain **operationally sound across future occurrences** — catching
  an authorization about to lapse, a schedule change, a standing order nearing
  its end date, a facility that changed a passenger's dialysis slot, a recurring
  slot with no vehicle that can serve it.
- **Is NOT:** creating standing orders (that's intake); billing recurring trips;
  a subscription manager; Trip Assurance (a single live trip); Trip Readiness (a
  single specific trip).
- **Appears in:** Demand + Assurance engines; Operations Brief when something
  needs renewal.
- **Scope (LOCKED, G1-B):** Recurring Service Assurance is about the
  *arrangement's* structural health across the future. Trip Readiness is about a
  *specific trip*. The arrangement problem should be caught first, upstream. See
  §4.1.
- **Capitalization:** **Recurring Service Assurance**.

### Proof of Service

- **Meaning (as a surface):** where completed trips are checked for a complete,
  billable proof-of-service record, and where missing pieces are chased.
- **Is NOT:** the act of the driver capturing pickup/drop-off (that's just part
  of running the trip); the invoice; Revenue Assurance (broader).
- **Appears in:** Assurance + Revenue engines.
- **Capitalization:** **Proof of Service** (surface); "proof of service"
  (the record/data).

### Revenue Assurance

- **Meaning:** determining whether **completed service produced the evidence and
  information required to progress toward payment** — completeness of billing
  data, correct payer/authorization, proof of service present, nothing falling
  through, claim/invoice readiness.
- **Is NOT:** accounting / a general ledger; pricing; collections; Proof of
  Service (its input).
- **Appears in:** Revenue engine; a dedicated surface; Operations Brief when
  revenue is at risk (completed trips with no proof).
- **Scope (LOCKED, G1-B):** Revenue Assurance answers exactly one question — *did
  completed service produce the evidence/information required to progress toward
  payment?* See §4.1.
- **Capitalization:** **Revenue Assurance**.

### Capacity

*(Renamed from the G1-A working title "Capacity / Dead Time intelligence" in
G1-B.)*

- **Meaning:** the surface/module for understanding how fully the operation's
  vehicles and drivers are used over time — where there's slack and where there's
  strain — to inform staffing, fleet, and which new work to take.
- **Is NOT:** real-time dispatch; route optimization; a scheduling autopilot;
  driver surveillance.
- **Appears in:** Growth engine; a reporting/analysis surface (later phase).
- **Naming (LOCKED, G1-B):** the surface/module is **Capacity**. **"dead time"**
  may exist as a specific metric *inside* Capacity. The surface must **never** be
  called "Dead Time Intelligence", "Capacity Intelligence", "AI Capacity", or
  "Smart Capacity". Describe it functionally ("unused vehicle time by day"), not
  as an "intelligence".
- **Capitalization:** **Capacity** (surface); "dead time", "capacity" (lowercase
  concepts/metrics).

### Facility coordination

- **Meaning:** the set of capabilities for working *with* facilities — receiving
  their requests and standing orders, sharing trip status and manifests, handling
  changes, and tracking the health of each facility relationship.
- **Is NOT:** a facility-facing product Nemryn sells to facilities (not decided);
  a messaging inbox; a contract manager.
- **Appears in:** Demand + Growth engines; Facilities detail.
- **Capitalization:** lowercase "facility coordination" (descriptive), unless it
  becomes a named surface — then **Facility Coordination**. Not decided.

## 4.1 The Assurance family (LOCKED, G1-B)

"Assurance" is retained deliberately for **exactly three** Nemryn concepts. It is
**not** a generic suffix — do not create "Driver Assurance", "Vehicle
Assurance", "Facility Assurance", etc. Each of the three answers one question,
and the scopes must not blur:

| Concept | The one question it answers | Time frame | Object |
|---|---|---|---|
| **Trip Assurance** | Is a specific active/upcoming trip progressing as expected? | now / imminent | one trip |
| **Recurring Service Assurance** | Are recurring transportation obligations structurally ready across future occurrences? | future, ongoing | a standing order / the set of them |
| **Revenue Assurance** | Did completed service produce the evidence/information required to progress toward payment? | after completion | a completed trip / the billable backlog |

Mnemonic: Trip Assurance watches the trip *happening*; Recurring Service
Assurance watches the arrangement *staying sound*; Revenue Assurance watches the
completed trip *becoming payable*. Trip Readiness (a separate concept, not an
"Assurance") is the pre-flight check on a single trip before it runs.

## 5. Terminology decisions — LOCKED in G1-B

The G1-A "flagged for review" list is resolved. These are now locked
product-language decisions. **Code and schema identifiers are NOT renamed** —
this governs UI copy, marketing, and documentation only.

| Item | G1-B decision |
|---|---|
| **Requests / Request Hub** | Nav label **Requests**. Concept name **Request Hub** (marketing / docs / feature explanation / release notes only; never in daily nav). |
| **Capacity / "dead time"** | Surface/module is **Capacity**. **"dead time"** stays in the vocabulary as a metric *inside* Capacity. Forbidden names: "Dead Time Intelligence", "Capacity Intelligence", "AI Capacity", "Smart Capacity". |
| **standing order / Recurring Service Assurance** | Object is **standing order** (industry term; "a recurring transportation arrangement that generates individual trips"). Nemryn capability is **Recurring Service Assurance** (renamed from "Recurring Care Assurance" — "care" removed to avoid clinical positioning). |
| **The Assurance family** | Exactly three: **Trip Assurance**, **Recurring Service Assurance**, **Revenue Assurance**. Scopes stay separate (§4.1). "Assurance" is not a generic suffix. |
| **Vehicles** | Nav/module label is **Vehicles**. "Fleet" is prose-only for "the operator's whole collection of vehicles". |
| **Operations Brief** | The conceptual replacement for the current **Overview** surface; eventual operational front door. Rename **not implemented** in G1-B. |
| **Tomorrow Readiness** | "Tomorrow" = **next calendar day**. Always show the date when ambiguity matters. "No trips tomorrow" is shown as useful information. Never reinterpreted as "next service day". |
| **round trip** | Product-language direction: a request can yield **more than one trip**; a round trip = **outbound trip + return trip**, both linked to the same request/obligation. Subject to data-model validation before implementation. |
| **workspace vs organization** | Customer-facing UI: **workspace**. Technical / admin / data architecture: **organization**. The database concept is **not** renamed. (See [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) and [`01-brand-architecture.md`](./01-brand-architecture.md).) |
| **"Trips" icon** | Keep the current restrained **Path**-style direction. Do not introduce a car / ambulance / road-sign / map-pin as the default Trips icon. Final icon confirmation belongs to the component visual review, not G1-B. |

### Still not decided (product-language)

- Whether **Facility coordination** becomes a named surface (**Facility
  Coordination**) or stays a descriptive capability phrase.
- Whether **Proof of Service** and **Exception Recovery** each get a dedicated
  top-level nav entry or live inside other surfaces (a design question).
- The exact wording of maturity-driven progression notices (see
  [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md)).

## 6. Words Nemryn does not use

| Avoid | Use instead | Why |
|---|---|---|
| booking, book a ride | request; schedule a trip | consumer/hospitality register |
| ride, rider | trip; passenger | consumer ride-app register |
| patient | passenger | Nemryn is operational, not clinical |
| client, customer (for the passenger) | passenger; (facility/payer where that's the customer) | ambiguous; the operator's customer is often the facility |
| ticket (for an exception) | exception | support-desk register |
| dashboard (as a product name) | Operations Brief; the specific surface name | banned as a naming crutch (see [`04`](./04-visual-direction.md)) |
| smart / intelligent / AI / optimize | describe what it does | see [`02`](./02-positioning.md) §9 |
| user (in customer-facing copy) | driver / dispatcher / administrator / you | name the role |
| trip request (as one compound word-thing) | request → trip | keep the two objects distinct |
| onboard (as a verb for passengers) | pick up | "onboarding" is fine for operators/drivers joining Nemryn |

## 7. Capitalization quick reference

- Proper-noun concepts (Title Case): **Operations Brief, Request Hub, Trip
  Readiness, Trip Assurance, Tomorrow Readiness, Exception Recovery, Recurring
  Service Assurance, Proof of Service, Revenue Assurance, Capacity**.
- Navigation labels (sentence-case-except-the-noun, i.e. normal capitalized nav
  items): **Requests, Trips, Dispatch, Passengers, Facilities, Drivers, Vehicles,
  Settings** — and eventually **Operations Brief** in place of **Overview**.
- Domain objects (lowercase in running text): **trip, request, assignment,
  driver, vehicle, passenger, facility, exception, standing order, proof of
  service, manifest, capacity, dead time**.
- Container terms: **workspace** (customer-facing UI), **organization**
  (technical/admin/data). The DB concept keeps its name.
- Identifiers: `Trip 4471`, `Request 8820` — capital, no `#`.
- The product/company: **Nemryn**.
- Roles: administrator, operations manager, dispatcher, driver — lowercase in
  running text; Title Case only as a formal role label in settings.
- Acronym: **NEMT** (expand once in marketing).
- "Fleet": prose only, never a nav/module label.
