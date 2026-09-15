# Nemryn — Operator Maturity Principles

**Phase:** NEMRYN G1-A (revised in G1-B — Brand Lock)
**Status:** Specification — product/UX architecture. **Not pricing. Not plans. Not tiers.**
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** [`00-brand-foundation.md`](./00-brand-foundation.md), [`04-visual-direction.md`](./04-visual-direction.md)
**Locked by:** [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §Maturity.

---

## 1. The principle

**Nemryn is one coherent product architecture with progressive disclosure.**

Every operator works in the same shell, with the same concepts, the same
vocabulary, and the same underlying model of a trip's life. What changes as an
operation grows is *how much is surfaced by default* and *how much structure the
UI imposes* — the architecture is one thing, revealed progressively.

> **G1-B correction.** G1-A stated this as "Nemryn is one product; every operator
> gets the whole thing." That phrasing over-promised. It is corrected to "one
> coherent product architecture with progressive disclosure." The distinction
> matters:
> - **Locked:** the product *architecture* — shell, concepts, vocabulary, the
>   trip lifecycle, readiness, ownership, exceptions, proof — is one thing for
>   everyone. The UX adapts to operational maturity.
> - **Undecided and explicitly NOT implied here:** commercial packaging. Nemryn
>   does not promise that every future commercial plan permanently contains every
>   capability. Maturity-driven disclosure is a UX mechanism; it is independent
>   of, and must not be encoded as, pricing or plan gating.

A one-vehicle operator must not open Nemryn and face an enterprise dispatch
console. An established fleet must not be held back by a UI that assumes one
person does everything.

Maturity-driven disclosure is **driven by real operational signals** (how many
vehicles, drivers, trips/day, facilities, roles in use), never by a plan gate.
Whether some capabilities are *also* gated commercially in future is a separate,
undecided question and is not the subject of this document.

## 2. Non-negotiables at every maturity level

Regardless of size, every operator gets:

- the trip as a real object with a full lifecycle,
- Trip Readiness with reasons,
- a named owner on every trip and exception,
- exception visibility before failure where possible,
- completion capture that yields proof of service,
- their own isolated workspace and data (tenancy is not a maturity feature — it's
  always on).

And no operator is ever:

- forced to fill fields that don't apply to how they work,
- shown empty modules for capabilities they don't use, as if something is missing,
- required to create roles/teams/structure they don't have,
- given a worse product because they're small.

## 3. The four conceptual levels

These are **lenses for design decisions**, not account types. An operator moves
fluidly along this range; Nemryn should follow the signals, not ask them to
declare a level.

---

### Level 1 — Owner-operator (1–2 vehicles)

**Who:** one person (sometimes two). They take the calls, schedule the trips,
assign the driver (often themselves), drive, and do the billing. Standing orders
with a couple of dialysis patients are common. Everything is currently in their
head, a paper calendar, and text messages.

**Operational needs:**
- Not to miss a trip.
- To know what tomorrow looks like before tomorrow.
- To not lose money on trips they actually ran (proof + billing).
- To handle the occasional problem (they're double-booked, the van won't start)
  without a system.

**Immediately visible:**
- Today's trips as a simple ordered list, with readiness.
- The next pickup.
- Anything not ready for today or tomorrow.
- One-tap "add a trip / add a request."
- The current trip when they're driving (via the driver surface — the owner uses
  both surfaces; see `docs/product/owner-operator-mode.md`).

**Progressively disclosed (appears when a signal appears):**
- A real dispatch view — when there's more than one driver to coordinate.
- Facility coordination surfaces — when there's more than one or two facilities.
- Capacity/dead-time analysis — when there's enough volume for it to mean
  anything.
- Role/access management — when they add a second person who isn't a co-owner.

**Must NOT be forced on them:**
- A dispatch board designed for a dispatcher who isn't also the driver.
- Separate "operations manager" vs "dispatcher" vs "owner" role setup.
- Shift planning, driver rostering, multi-vehicle optimization.
- Required fields for payer/authorization structures they don't deal in.
- A KPI dashboard. They don't need metrics; they need to not miss the 11:00.
- Approval workflows, multi-step assignment confirmation, anything that assumes
  more than one pair of hands.

**Design implication:** Level 1 Nemryn looks almost like a very good shared
checklist + readiness watcher. The trip lifecycle machinery is all there
underneath; the surface is calm and short.

---

### Level 2 — Small growing operation (roughly 3–8 vehicles)

**Who:** the owner no longer drives every day. There's a dispatcher (maybe still
the owner, maybe a first hire), 3–8 vehicles, a handful of regular facilities,
a mix of standing orders and ad hoc requests. The operation is starting to
strain the "in someone's head" model — this is where operators either get a
system or plateau.

**Operational needs:**
- Coordinate several drivers against the day without a whiteboard.
- See readiness across all of tomorrow, not trip by trip.
- Make sure standing orders keep generating correct trips.
- Start seeing where the day is over- or under-committed.
- Hand the operation off between shifts / people cleanly.

**Immediately visible:**
- The Operations Brief with today + tomorrow readiness summaries.
- A dispatch view: drivers × trips for the day, unassigned trips obvious.
- Requests needing triage.
- Exceptions and readiness concerns as a short attention list.
- Recurring Service Assurance flags (an auth lapsing, a standing order ending).

**Progressively disclosed:**
- Multi-day / week planning views — when trip volume and advance-booking
  warrant it.
- Deeper capacity analysis and dead-time reporting.
- Facility relationship health (which facilities send the most, which have the
  most problems).
- More granular roles (a billing person who isn't a dispatcher).
- Proof-of-service chasing as its own surface (when volume makes trip-by-trip
  impractical).

**Must NOT be forced on them:**
- Enterprise concepts: zones, depots, contract SLAs, bid management.
- Heavy configuration before the product is useful.
- Analytics as the front door — the Brief is still the front door.
- Mandatory shift/roster management if they schedule informally.

**Design implication:** Dispatch becomes a real surface here. The Brief gets a
richer "tomorrow" section. Still one dispatcher's-eye view, not a command center.

---

### Level 3 — Established fleet (roughly 9–30 vehicles)

**Who:** distinct roles now — owner/GM, one or more dispatchers, a billing
function, many drivers. Multiple facility contracts, meaningful standing-order
volume, real money on the line for reliability and for billing completeness.
Reputation with facilities directly drives revenue.

**Operational needs:**
- Multiple people working the same operation without stepping on each other.
- Confidence that nothing is silently unready or unbilled across high volume.
- Manage facility relationships as accounts, not just as trip origins.
- Understand capacity to decide what new work to accept.
- Clear accountability when volume means no one can hold it all.

**Immediately visible:**
- The Brief, scaled: counts and attention lists that stay scannable at volume
  (grouping, not endless scroll).
- Dispatch with multiple dispatchers' work visible and de-conflicted.
- Revenue Assurance surface — unproven/unbilled completed trips as a managed
  queue.
- Facility coordination as a first-class area.
- Capacity view with real trend data.

**Progressively disclosed:**
- Cross-day and cross-week operational planning.
- Deeper analytics (on-time performance over time, by facility, by driver-cohort
  — never as individual driver surveillance).
- Configurable operational policies (how far ahead a trip must be ready,
  escalation rules).

**Must NOT be forced on them:**
- Multi-region / multi-entity structures unless they actually operate that way.
- Rigid workflow that assumes a bigger back office than they have.
- Being pushed into "enterprise" language and screens that add ceremony without
  adding control.

**Design implication:** Density and grouping matter most here. The product must
stay legible when there are 200 trips this week and four people touching them.
Ownership and de-confliction are the headline problems.

---

### Level 4 — Large operation (30+ vehicles, multi-site / multi-contract)

**Who:** an operations department. Multiple dispatchers per shift, dedicated
billing/revenue staff, possibly multiple yards or service regions, formal
facility/payer contracts with performance terms.

**Operational needs:**
- Run a high-volume operation with many hands and keep a single source of truth.
- Structural clarity: who owns which trips/regions/contracts right now.
- Assurance at scale — the operator cannot manually check readiness or proof;
  Nemryn has to.
- Operational analysis that informs staffing, fleet, and contract decisions.

**Immediately visible:**
- The Brief as a true operational summary with drill-down, not a list.
- Dispatch organized by whatever structure the operation actually uses (region,
  shift, contract) — configurable, not assumed.
- Assurance queues (Trip, Recurring Service, Revenue) as managed work.
- Capacity and performance analysis prominent.

**Progressively disclosed / configurable:**
- Regions/yards/teams, contract definitions, performance targets, escalation
  chains — all opt-in structure the operator turns on.
- API / data export / integration surfaces (later phase).

**Must NOT be forced on them:**
- A one-size structure. Level 4's defining need is that Nemryn bends to *their*
  operating structure.
- Losing the calm. Even at this scale the product stays quiet and legible — the
  control-room feeling, not an alarm wall.

**Design implication:** Configuration and structure become real. But the same
shell, the same Brief concept, the same vocabulary. Level 4 is the same product
architecture as Level 1 with more of it surfaced and more structure configured —
not a different application.

## 4. How progression works (mechanism, not menu)

- **Signals, not settings.** Nemryn infers level from real usage — vehicle count,
  active drivers, trips/day, distinct facilities, number of people with logins,
  roles actually in use. New surfaces appear when their signal crosses a
  threshold, with a quiet notice ("You've added a third driver — Dispatch is now
  available"), never a paywall.
- **Nothing disappears.** Once a surface is relevant it stays. Progression is
  one-directional in the UI even if the operation temporarily shrinks.
- **The operator can opt in early.** A small operator who wants the dispatch view
  can turn it on. The default is driven by signals; nothing in the *architecture*
  is withheld by maturity. (Whether a future commercial plan withholds a
  capability is a separate, undecided packaging question — see §1.)
- **The Brief is always the front door**, at every level. What changes is its
  depth.
- **Empty ≠ missing.** A surface the operator hasn't grown into isn't shown as a
  locked or empty module. It simply isn't in the way yet.

## 5. What is still not decided (after G1-B)

- The exact signal thresholds.
- Which specific surfaces unlock at which signal.
- The wording of progression notices.
- **Commercial packaging** — whether, and how, any capability is gated by a paid
  plan. G1-B confirms this is out of scope and explicitly NOT decided. Maturity
  disclosure must be designed so it works regardless of what packaging is chosen
  later; it must not itself be built as a plan gate.
- Anything about the driver surface's own progression (a driver's experience
  doesn't really have "maturity levels" — it's focused at every size).
