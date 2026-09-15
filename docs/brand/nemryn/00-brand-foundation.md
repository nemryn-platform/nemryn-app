# Nemryn — Brand Foundation

**Phase:** NEMRYN G1-A — Brand Foundation Architecture (revised in G1-B — Brand Lock)
**Status:** Specification only. Nothing in this document has been applied to the running application.
**Last updated:** 2026-09-07 (G1-B revision)
**Read this first.** Every other file in `docs/brand/nemryn/` assumes the definitions here.
**Authoritative on locked decisions:** [`11-brand-lock-v1.md`](./11-brand-lock-v1.md). Where this file and `11` disagree, `11` wins. G1-B changes are logged in [`CHANGELOG-g1-b.md`](./CHANGELOG-g1-b.md).

---

## 0. Purpose of this document

This defines what Nemryn is with enough precision that a designer, developer, or
copywriter joining later can produce correct work without a verbal briefing. If a
decision is not written here or in a sibling file, it has not been made — record
it, do not assume it.

This document does **not** authorize any change to the existing Zenward-branded
application. See [`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md).

---

## 1. Brand name

**Nemryn.**

- Written as `Nemryn` — initial capital, lowercase remainder. Never `NEMRYN` in
  running text (all-caps is acceptable only in a wordmark lockup if the visual
  system later calls for it — not decided in G1-A). Never `nemryn` in running text.
- No tagline is locked in G1-A. Candidate descriptors live in
  [`02-positioning.md`](./02-positioning.md); none is approved.
- Nemryn is the name of the **software company and the platform**. It is not the
  name of any transportation operator, fleet, service, or trip.

## 2. Category

**Software infrastructure for non-emergency medical transportation (NEMT) businesses.**

Nemryn is operating infrastructure — the system an NEMT operator runs their
business on. It is not:

- a booking website or a consumer ride app,
- a brokerage or a clearinghouse,
- a dispatching call center,
- a fleet-tracking GPS product,
- a generic logistics or field-service suite adapted to healthcare,
- an EHR, a billing clearinghouse, or a Medicaid claims system.

It may *interoperate* with several of those over time. It is not any of them.

## 3. Core position

**Operating infrastructure for medical transportation.**

Nemryn exists so that an NEMT operator can answer four questions at any moment,
for their whole operation, without assembling the answer by hand from
spreadsheets, phone calls, and memory:

1. **What is happening?** — the current state of today's service.
2. **What is next?** — what is coming and whether it is ready.
3. **Who is responsible?** — the named owner of every trip, exception, and follow-up.
4. **What requires attention?** — the small set of things that will go wrong if
   no one acts, surfaced before they fail rather than after.

Everything Nemryn builds should make one of those four answers faster, more
certain, or harder to get wrong.

## 4. Customer

**The NEMT operator** — the business that owns vehicles, employs or contracts
drivers, and is paid to move patients to and from care.

- Ranges from a single owner-operator with one vehicle to a fleet of hundreds.
- The buyer and the daily user are often the same person at the small end (the
  owner dispatches, sometimes drives). At the large end they diverge into
  owner / operations manager / dispatcher / driver / billing.
- Nemryn is bought by the operator, for the operator's own staff. It is **not**
  sold to health plans, brokers, or facilities as the primary customer — though
  facility coordination is a product concern (see §6, engine 1).

Secondary participants whose experience Nemryn shapes but who are **not the
customer**: drivers (they use a focused driver surface), facility schedulers
(they may receive or send trip information), passengers (they may receive
service communications). None of these is the buyer and none defines the roadmap.

## 5. Problem

An NEMT operation runs on time-critical, medically-consequential trips, but the
operator's tooling is typically:

- **Fragmented** — requests arrive by phone, fax, portal, and text; the schedule
  lives in one place, driver assignments in another, proof of completion in a
  third, billing in a fourth.
- **Reactive** — problems (a no-show driver, an unconfirmed wheelchair van, a
  standing order that lapsed) are discovered when they fail, not before.
- **Unaccountable** — when something goes wrong it is hard to say who owned it,
  what was promised, and what actually happened.
- **Non-scaling** — the operation runs on one person's head. Growth means either
  that person works more hours or the operation gets less reliable.

The cost of these gaps is not abstract: missed trips are missed dialysis,
chemotherapy, and discharges; unprovable trips are unpaid trips; a reputation for
unreliability loses facility contracts.

## 6. Product thesis

**An NEMT operation should run on a system that continuously tells the operator
the true state of their service and the next thing that needs a decision — and
that records what was promised and what happened, well enough to prove it and
get paid for it.**

Nemryn is that system. It treats the **trip** as the primary business object (not
a form submission), tracks each trip through its full operational life
(requested → scheduled → assigned → ready → in service → completed → proven →
billed), and organizes the operator's attention around **readiness** and
**exceptions** rather than around a raw calendar.

The product should feel dependable before it feels advanced. An operator's first
reaction should be "I can finally see everything," not "look at all these
features."

## 7. The five product engines

Long-term, Nemryn's capabilities organize into five engines. These are a
**planning and architecture frame**, not a navigation structure and not a
release plan. Order does not imply priority.

| # | Engine | What it governs | Representative concepts (see [`07-product-language.md`](./07-product-language.md)) |
|---|--------|-----------------|------------------------------------------------------------------------------------|
| 1 | **Demand** | How work enters the operation and how it is shaped before it becomes a committed trip. | Requests / Request Hub, facility coordination, Recurring Service Assurance (intake side) |
| 2 | **Execution** | Turning committed trips into completed service on the day. | Operations Brief, Trip Readiness, Tomorrow Readiness, dispatch and assignment |
| 3 | **Assurance** | Keeping service reliable when reality diverges from plan, and proving what happened. | Trip Assurance, Exception Recovery, Proof of Service |
| 4 | **Revenue** | Converting completed, proven service into paid revenue. | Revenue Assurance, billing readiness, claim/invoice support |
| 5 | **Growth** | Using the operation's own data to run it better and win more work. | Capacity (utilization and dead-time analysis), facility relationship health, operator-maturity progression |

No engine is a product surface on its own. A single screen (e.g. the Operations
Brief) can serve more than one engine.

## 8. Core differentiators

What makes Nemryn distinct from an operator's current tooling and from generic
NEMT software:

1. **Readiness-first, not calendar-first.** The primary view is not "here is your
   day as a grid." It is "here is what is ready, what is not, and what is at
   risk." The calendar is available; it is not the organizing principle.
2. **Every trip and exception has a named owner.** Accountability is a first-class
   field, not a convention. "Who is responsible?" always has an answer.
3. **Proof is part of the trip, not a separate afterthought.** Completion capture
   is designed so that a completed trip is, by default, a provable and billable
   trip.
4. **It scales down honestly.** A one-vehicle operator gets a real, useful
   product — not a locked-down demo of an enterprise dispatch system. Complexity
   is disclosed as the operation grows (see [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md)).
5. **Operational design language, not SaaS-dashboard language.** Screens derive
   from real operational tasks. Nemryn does not look like a generic analytics
   dashboard, and it does not imitate competitors (see the Competitor Rule in
   [`04-visual-direction.md`](./04-visual-direction.md)).

## 9. Brand personality

Nemryn is:

- **Calm** — it lowers the operator's stress level; it never manufactures urgency
  for engagement.
- **Precise** — exact language, exact numbers, exact ownership. No vague status.
- **Structured** — information has a place and a hierarchy; the product is legible
  under pressure.
- **Premium** — considered, restrained, well-built. Premium through quality and
  clarity, not through decoration.
- **Operational** — it speaks the operator's language (trips, requests, readiness,
  exceptions), not a software vendor's language.
- **Infrastructure-grade** — dependable, quiet, always-on. The kind of system you
  stop noticing because it simply works.

Nemryn is **not**: playful, clever, chatty, hype-driven, reassuring-in-a-
patronizing-way, or impressed with its own technology.

### Voice in one line

> Nemryn tells you what is true and what to do about it, in as few words as
> possible, without drama.

Full treatment: [`03-verbal-identity.md`](./03-verbal-identity.md).

## 10. Design principles

1. **Legibility under pressure.** The person reading a Nemryn screen may be on the
   phone, mid-crisis, at 6 a.m. Every screen must be scannable in seconds and
   unambiguous.
2. **Status is earned, not decorative.** Green, amber, red, and steel blue carry
   defined operational meaning. They are never used because they look good. See
   [`05-semantic-color-system.md`](./05-semantic-color-system.md).
3. **Density with air.** Operators need a lot of information per screen. Nemryn
   achieves density through typographic hierarchy and alignment, not through
   cramming — and protects whitespace deliberately.
4. **Show the mechanism.** When Nemryn asserts a state ("not ready"), the reason
   is one interaction away. No black-box status.
5. **One coherent product architecture, progressive disclosure.** Every operator
   works in the same shell with the same concepts and vocabulary. What changes
   with operational maturity is how much is surfaced by default and how much
   structure the UI imposes — the *architecture* is one thing, disclosed
   progressively. (This is a G1-B correction of the looser G1-A phrasing "one
   product, everyone gets all of it"; commercial packaging is undecided and is
   not implied here — see [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md).)
6. **Structure over illustration.** Nemryn communicates with layout, type, and
   data. Imagery is rare, functional, and never a generic vehicle/medical stock
   cliché.
7. **The application is a workspace, not a website.** No marketing language,
   persuasion patterns, or promotional layout inside daily operational screens.
   See [`08-marketing-vs-application.md`](./08-marketing-vs-application.md).

## 11. Things Nemryn explicitly refuses to become

- **A generic AI-SaaS product.** No "AI-powered" positioning, no chat-first
  interface as the primary interaction model, no glassmorphism / neon / gradient-
  blob aesthetic, no manufactured "magic."
- **A competitor clone.** Nemryn does not reproduce the layout, navigation,
  terminology, dashboard composition, illustration style, feature naming, or copy
  of hibambi.com or any other NEMT software product.
- **A consumer transportation app.** Nemryn is not Uber/Lyft for patients. It does
  not adopt rider-app patterns, tone, or gamification.
- **Hospital / clinical software.** Nemryn is not an EHR and does not adopt the
  visual language, jargon, or workflow assumptions of clinical systems.
- **A dashboard with no opinion.** Nemryn does not present a wall of charts and
  leave interpretation to the user. It surfaces the decision that needs making.
- **A booking form with a back office bolted on.** The trip is the core object;
  intake is one phase of its life, not the whole product.
- **A miniature enterprise dispatch system forced on small operators.** See
  [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md).
- **Zenward Mobility.** Nemryn is not a transportation operator and carries none
  of Zenward Mobility's identity, palette, typography, logo, imagery, or tone.
  Zenward Mobility is a customer. See [`01-brand-architecture.md`](./01-brand-architecture.md).

---

## Related files

- [`01-brand-architecture.md`](./01-brand-architecture.md) — platform identity vs tenant identity
- [`02-positioning.md`](./02-positioning.md) — positioning hierarchy and approved/unapproved copy
- [`03-verbal-identity.md`](./03-verbal-identity.md) — voice, tone, worked examples
- [`04-visual-direction.md`](./04-visual-direction.md) — visual principles, anti-patterns, competitor rule
- [`05-semantic-color-system.md`](./05-semantic-color-system.md) — palette → semantic roles
- [`06-typography-system.md`](./06-typography-system.md) — type roles
- [`07-product-language.md`](./07-product-language.md) — controlled vocabulary
- [`08-marketing-vs-application.md`](./08-marketing-vs-application.md) — surface separation
- [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md) — progressive complexity
- [`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md) — rebrand rules + current touchpoint inventory
