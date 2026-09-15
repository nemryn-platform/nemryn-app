# Nemryn — Brand Lock v1

**Phase:** NEMRYN G1-B — Brand Lock + Design Token Specification
**Status:** **AUTHORITATIVE.** This is the human-approved Nemryn Brand Lock v1. Where any other document in `docs/brand/nemryn/` disagrees with this file, **this file wins**.
**Date locked:** 2026-09-07
**Still documentation only.** Nothing here has been applied to the running application. No code, `globals.css`, Tailwind config, font import, asset, auth, Supabase, RLS, schema, migration, or domain was changed to produce it.

---

## How to read this document

Every statement is tagged:

- **LOCKED** — human-approved; do not change without a new explicit decision. If a
  genuine *technical* contradiction is found during implementation, document it
  (do not silently revise).
- **DERIVED** — a direct, mechanical consequence of a LOCKED decision plus
  analysis (e.g. an accessibility-corrected color value). Change only if the
  LOCKED input changes or the analysis is shown wrong.
- **STILL OPEN** — not yet decided; needs a future human decision or a later
  phase.

---

## 1. Brand — LOCKED

- **Name:** **Nemryn** — initial capital, lowercase remainder. Never `NEMRYN` or
  `nemryn` in running text. Name of the **software company and the platform** —
  never a transportation operator, fleet, service, or trip.
- **No tagline is locked.** The core position may serve as a wordmark tagline
  candidate; that is a G1-C decision.

## 2. Category — LOCKED

**Software infrastructure for non-emergency medical transportation (NEMT)
businesses.** Operating infrastructure an NEMT operator runs their business on.
Not a booking site, brokerage, dispatch call center, GPS product, generic
logistics/field-service suite, EHR, or claims system.

## 3. Core position — LOCKED

> **Operating infrastructure for medical transportation.**

Nemryn enables an NEMT operator to answer, at any moment, for their whole
operation:

1. What is happening?
2. What is next?
3. Who is responsible?
4. What requires attention?

Not to be replaced with generic SaaS positioning. Full hierarchy in
[`02-positioning.md`](./02-positioning.md).

## 4. Platform vs tenant architecture — LOCKED

Two identities, always kept separate:

- **PLATFORM IDENTITY — Nemryn.** Owns the product name/wordmark/palette/type/
  iconography/voice, the marketing website, the authentication surface, the
  application shell, and operator-neutral system/security messaging about the
  platform account.
- **TENANT IDENTITY — the operator** (e.g. Zenward Mobility). Owns its own
  legal/trade name, its logo (used as *its* identity, not the app's), the content
  of its operational data, and communication that goes out *as the operator* to
  its passengers, drivers, and partner facilities.

**Zenward Mobility is the first tenant** — a real NEMT operator that becomes
Nemryn's first customer. Its brand is reclassified, not removed: it moves from
"the whole app" to "one organization inside Nemryn." Tenants are **peers**
(no co-brand, no parent/sub-brand) and **isolated** (already true in the
codebase's tenancy/RLS model; branding does not touch it).

Full per-surface matrix: [`01-brand-architecture.md`](./01-brand-architecture.md)
§3A (also §Surface Identity below).

## 5. Brand personality — LOCKED

Calm · precise · structured · premium · operational · infrastructure-grade ·
highly readable. Not playful, clever, chatty, hype-driven, patronizing, or
impressed with its own technology.

**Voice in one line:** *Nemryn tells you what is true and what to do about it, in
as few words as possible, without drama.* Full treatment:
[`03-verbal-identity.md`](./03-verbal-identity.md).

## 6. Visual character — LOCKED

Nemryn is **predominantly neutral**. Primary character comes from **typography,
alignment, spacing, borders, information hierarchy, density, and restraint** —
**not** from decorative color. The interface should feel closer to a carefully
designed **operational instrument** than a marketing SaaS dashboard. Full
principles: [`04-visual-direction.md`](./04-visual-direction.md).

## 7. Identity direction — LOCKED (design is G1-C)

The Nemryn identity will consist of:

- **A. A custom Nemryn wordmark.**
- **B. A compact, independent symbol** for favicon, app icon, compact navigation,
  and small identity moments.

**The symbol should express:** coordination, structure, continuity, connection,
control, movement through a system, operational certainty.

**The symbol must NOT use:** medical cross · heart · heartbeat · ambulance ·
vehicle · wheelchair · map pin · obvious road · GPS marker · spark/star AI
motif · brain/circuit AI motif · generic gradient orb · generic "N inside a
rounded square" · generic tech hexagon.

Subtle geometric relationships that *incidentally* evoke the structure of an N
are acceptable; an **obvious monogram is not the goal**.

The final logo is **not** created in G1-B. The design brief for G1-C is
[`14-identity-design-brief.md`](./14-identity-design-brief.md).

## 8. Palette primitives — LOCKED (as "Brand Palette Primitives v1")

| Name | Hex |
|---|---|
| Deep Graphite | `#171A1D` |
| Ink | `#23282D` |
| Mineral White | `#F7F7F4` |
| Soft Stone | `#E8E9E6` |
| Muted Slate | `#697179` |
| Signal Green | `#4FA57A` |
| Attention Amber | `#D79B45` |
| Critical Red | `#C95C55` |
| Steel Blue | `#6F8798` |

**LOCKED constraint:** these are *primitive* colors. They are **not** permission
to use each raw value directly for text, borders, fills, or controls. WCAG
validation (G1-B) confirms none of the four status hues meets 4.5:1 as small text
on Mineral White. The **DERIVED**, accessibility-validated semantic values are in
[`12-design-token-specification.md`](./12-design-token-specification.md) §4. The
primitives are preserved; components consume the derived tokens.

## 9. Color meaning — LOCKED

| Primitive | Means |
|---|---|
| **Signal Green** | ready · confirmed · complete · healthy |
| **Attention Amber** | needs attention · potential problem · readiness concern |
| **Critical Red** | critical exception · failed condition · significant operational problem |
| **Steel Blue** | information · selection · focus · neutral active state · in-progress without a problem |

- Signal colors are **never** the general marketing palette.
- **Signal Green is never the default CTA.**
- **Primary CTA / primary application action = Deep Graphite / Ink
  high-contrast treatment** (`action.primary.*` in
  [`12`](./12-design-token-specification.md) §3).
- Status is never communicated by color alone — always label and/or icon/shape
  **plus** color.

## 10. Typography — LOCKED

**Geist Sans + Geist Mono.**

- **Geist Sans** — the single typeface for the product *and* marketing surfaces.
- **Geist Mono** — used **selectively**: identifiers, precise operational times
  where useful, technical codes, compact tabular/operational data where mono
  genuinely improves scanning. Not a general body/UI face. **The product must not
  acquire a developer-tool aesthetic.**
- **Do not modify dependencies or load the font in G1-B.**

Finalized scale: [`13-typography-specification.md`](./13-typography-specification.md).
If Geist proves technically impractical at implementation time, document it;
nearest fallback is Inter (sans) + IBM Plex Mono / JetBrains Mono (mono).

## 11. Iconography — LOCKED (direction)

- One icon family, restrained weight, consistent size (Phosphor at Regular/Medium
  is a reasonable direction to carry; confirm in component review).
- Icons support labels; they rarely replace them.
- Status is never icon-alone.
- **Trips icon:** keep the current restrained **Path**-style direction. Do **not**
  introduce a car / ambulance / road-sign / map-pin as the default Trips icon.
  Final icon confirmation belongs to the component visual review.

## 12. Surface identity rules — LOCKED

| Surface | Identity |
|---|---|
| Marketing website | **Nemryn** |
| Sign in / Sign up | **Nemryn only** |
| Auth confirmation / verification / error | **Nemryn only** |
| Platform account & security messaging/email | **Nemryn only** |
| Workspace selector | **Nemryn frame + workspace (operator) names** |
| Driver invite (`/join/[token]`) | **Nemryn frame + explicit tenant context** — restrained wording naming the organization: "You're joining {Organization Name}" or equivalent |
| Onboarding | **Nemryn frame; workspace/organization context appears once known** |
| Operations application shell | **Nemryn platform mark + current workspace name** (no operator logo customization in v1) |
| Inside operational screens | Neither, mostly — operator context in the header only; Nemryn as restrained chrome |
| Driver surface | Nemryn product frame + operator context; never "Nemryn Driver" |
| Passenger-facing operator communication | **Operator** (primary) |
| Facility-facing operator communication | **Operator** (primary) |
| Operator-generated operational documents | **Operator** (primary) |

**One Nemryn sign-in.** After authentication: one active workspace → enter it;
multiple → workspace selector; a remembered-workspace convenience may be
considered later. **No operator-branded login URLs in v1;
`app.nemryn.com/<operator>` is not the architecture.**

## 13. Operator branding rules — LOCKED

- **v1:** operator **display name** is supported as workspace context.
- Custom operator **logos inside the application are deferred** past v1.
- **Zenward Mobility retains its existing logo** as the first tenant's identity.
  **Nemryn does not redesign the Zenward Mobility logo.**
- Where the Zenward Mobility logo remains legitimate after rebrand: only as
  Zenward Mobility's own operator identity in operator-owned communications and
  materials — never on a platform surface, never as a default for other tenants,
  never as an in-app operator-logo feature in v1. Detail:
  [`01-brand-architecture.md`](./01-brand-architecture.md) §3A.

## 14. Generated documents — LOCKED

Passenger-facing, facility-facing, and operator-generated operational documents
are **primarily branded by the operator**. **No "Powered by Nemryn" / "Generated
by Nemryn" is required** on those documents in v1. Nemryn attribution may exist
internally in metadata or administrative surfaces where useful, but must not
compete with the operator's outward identity. (No such documents are built yet —
reports and billing are stubs.)

## 15. Terminology decisions — LOCKED

Governs **UI copy, marketing, and documentation only. Code and schema identifiers
are NOT renamed in G1-B.** Full detail: [`07-product-language.md`](./07-product-language.md) §5.

| Concept | Decision |
|---|---|
| Inbound demand | Nav label **Requests**; product concept **Request Hub** (marketing/docs/feature/release only). |
| Utilization surface | **Capacity**. **"dead time"** is a metric *inside* Capacity and stays in the vocabulary. Forbidden: "Dead Time Intelligence", "Capacity Intelligence", "AI Capacity", "Smart Capacity". |
| Recurring transportation object | **standing order** — "a recurring transportation arrangement that generates individual trips". |
| Recurring transportation capability | **Recurring Service Assurance** (renamed from "Recurring Care Assurance" — "care" removed to avoid clinical positioning). Determines whether recurring transportation obligations remain operationally sound across future occurrences. |
| Assurance family | Exactly three: **Trip Assurance** (is a specific active/upcoming trip progressing as expected?), **Recurring Service Assurance** (are recurring obligations structurally ready across future occurrences?), **Revenue Assurance** (did completed service produce the evidence/information required to progress toward payment?). Scopes stay separate. "Assurance" is not a generic suffix. |
| Vehicles surface | Nav/module label **Vehicles**. "Fleet" is prose-only for "the operator's whole collection of vehicles". |
| Application front door | **Operations Brief** — the conceptual replacement for the current "Overview" surface; answers the four operator questions. Rename **not implemented** in G1-B. |
| Next-day readiness | **Tomorrow Readiness**. "Tomorrow" = the **next calendar day** — never "next service day". Always show the actual date when ambiguity matters. "No trips scheduled tomorrow" is shown as useful operational information. |
| Round trip | A transportation **request** can result in more than one executable **trip**. A round trip = **outbound trip + return trip**, linked to the same request/obligation. **Product-language direction only — subject to data-model validation before implementation.** |
| Container terms | Customer-facing UI: **workspace**. Technical / admin / data architecture: **organization**. The database concept (`organizations`) is **not** renamed. A user signs into a **Nemryn account**. |

## 16. Metadata — LOCKED (direction; not implemented)

The global platform metadata must eventually describe **Nemryn**, not the
tenant's NEMT business.

- **Title root:** `Nemryn`
- **Platform description:** `Operating infrastructure for medical transportation.`
- **Future authenticated screen title pattern:** `[Surface] — [Workspace] | Nemryn`
  (e.g. `Operations — Zenward Mobility | Nemryn`)
- **Auth / neutral surfaces:** `Sign in | Nemryn`

**Do not implement metadata changes in G1-B.** The current global description
`"Non-emergency medical transportation."` is the operator's business line, not the
platform's, and is replaced during the shell migration. Per-file plan:
[`15-rebrand-inventory.md`](./15-rebrand-inventory.md).

## 17. Marketing / application boundary — LOCKED

Two kinds of surface, never blended. Marketing explains Nemryn to prospective
operators; the application does operational work with the least friction.
Marketing may *show* the product (real UI or labelled mockups, sample-shaped
data, no interactive fake); it must never become a fake operations dashboard. The
application must never carry promotional website language into daily operational
screens. Full spec: [`08-marketing-vs-application.md`](./08-marketing-vs-application.md).

## 18. Maturity principle — LOCKED (corrected)

**"One coherent product architecture with progressive disclosure."** (Corrected
from the G1-A phrasing "one product, everyone gets all of it".)

- **LOCKED:** the product *architecture* — shell, concepts, vocabulary, trip
  lifecycle, readiness, ownership, exceptions, proof — is one thing for everyone;
  the UX adapts to operational maturity, driven by real operational signals, not
  a plan gate.
- **STILL OPEN:** commercial packaging. Nemryn does not promise every future
  commercial plan permanently contains every capability. Maturity disclosure must
  be designed so it works regardless of packaging and must not itself be built as
  a plan gate.

Full model: [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md).

## 19. Documentation classification — LOCKED

Never bulk-rebrand the docs corpus. Every existing document is one of:

- **LIVING PLATFORM SPEC** — describes how the platform currently works and is
  maintained going forward. May later move from Zenward naming to Nemryn *where
  appropriate*, deliberately, not by find-and-replace. (e.g. `docs/product/*`
  model docs, `docs/design/*`, `docs/security/*` living specs.)
- **TENANT-SPECIFIC** — describes Zenward Mobility as an operator (its market,
  its launch, its identity). Stays Zenward-scoped; may be re-homed as tenant
  documentation.
- **HISTORICAL RECORD** — completion reports, decision history / decision
  register entries, past audits, past deployment records (`docs/reports/*`, the
  G1-A brand report, prior N0/G0 reports, `decision-register.md` history). These
  **remain historically accurate and are not rewritten** because the platform is
  renamed. A note may be appended; the record is not altered.

Detail and per-area classification: [`15-rebrand-inventory.md`](./15-rebrand-inventory.md)
§Documentation corpus.

## 20. Domain — target architecture; ownership STILL OPEN

**Target architecture (LOCKED as intent):**

| Domain | Purpose |
|---|---|
| `www.nemryn.com` | Nemryn marketing website |
| `app.nemryn.com` | Nemryn application |

**DOMAIN OWNERSHIP / REGISTRAR STATUS: HUMAN VERIFICATION REQUIRED.**

- This document does **not** assert that Nemryn owns `nemryn.com` or any related
  domain. That must be verified separately by a human.
- **No DNS change.** **No environment-variable change.** **No Supabase URL
  configuration change.** The production application continues to serve from
  `app.zenwardmobility.com` through the entire visual rebrand.
- The domain/auth cutover is a **separate, separately-authorized migration
  phase** — the last step of the rebrand sequence
  ([`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md) §3).

## 21. Explicit non-decisions (STILL OPEN after G1-B)

1. **The Nemryn wordmark and symbol.** Briefed ([`14`](./14-identity-design-brief.md)),
   not designed. → G1-C.
2. **Commercial packaging / pricing / plan gating.** Undecided; must not be
   conflated with maturity disclosure.
3. **Domain ownership / registrar status for `nemryn.com`.** Requires human
   verification.
4. **Settings information architecture** — the platform-account-settings vs
   workspace-settings split.
5. **Whether operator logo support arrives in a later defined version** (v2+) and
   which surfaces it would reach.
6. **Whether Facility coordination / Proof of Service / Exception Recovery get
   their own top-level navigation** (design questions).
7. **Final Trips icon** (component visual review).
8. **Round-trip data-model validation** — the product-language direction is
   locked; the schema question is open until the implementation phase.
9. **Marketing sitemap** (indicative only in [`08`](./08-marketing-vs-application.md)).
10. **The `numericDisplay` typography threshold** — needs real screens.

## 22. Future implementation boundaries — LOCKED

Restated from [`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md);
these bind every future rebrand phase:

- **No** global find-and-replace `Zenward` → `Nemryn`. Classify every occurrence
  (platform / tenant / historical) first.
- **No** change to tenant identity beyond reclassification.
- **No** tenancy-schema change, **no** RLS change, **no** database-object rename
  for cosmetic branding.
- **No** domain move outside the dedicated migration phase.
- **No** `supabase config push`; **no** hosted Supabase change for branding.
- **No** Nemryn UI in production during G1.
- **No** rebrand PR mixed with feature work.
- **The app is always shippable between rebrand steps** — never a
  half-branded production state.

Rebrand sequence (conceptual): brand lock → full rebrand inventory → token
migration → application shell → module-by-module visual migration → QA →
auth/domain migration → `app.nemryn.com`.

---

## Sign-off

This is Brand Lock **v1**. A future decision that changes a LOCKED item produces
Brand Lock v2 (a new numbered section or a superseding document), never a silent
edit. Implementation phases cite the version they were built against.
