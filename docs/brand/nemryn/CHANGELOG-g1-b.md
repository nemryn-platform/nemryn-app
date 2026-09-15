# Nemryn Brand Docs — G1-B Change Log

**Phase:** NEMRYN G1-B — Brand Lock + Design Token Specification
**Date:** 2026-09-07
**Scope:** Documentation only. No application code, `globals.css`, Tailwind config,
font import, asset, auth, Supabase, RLS, schema, or domain was changed.

This log records every human-approved G1-B decision and where it was incorporated.
Decision numbers match the G1-B brief's "HUMAN-APPROVED BRAND DECISIONS" list.

---

## New documents created in G1-B

| File | Purpose |
|---|---|
| [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) | Authoritative human-approved Brand Lock v1. LOCKED / DERIVED / STILL OPEN. |
| [`12-design-token-specification.md`](./12-design-token-specification.md) | Implementation-grade conceptual token system + WCAG contrast validation (Step 4) + old→new token map (Step 8). |
| [`13-typography-specification.md`](./13-typography-specification.md) | Finalized Geist type scale for marketing + application. |
| [`14-identity-design-brief.md`](./14-identity-design-brief.md) | The brief G1-C uses to design the Nemryn wordmark + symbol. |
| [`15-rebrand-inventory.md`](./15-rebrand-inventory.md) | Complete line-level touchpoint inventory with classification + future action + migration phase + risk. |
| `CHANGELOG-g1-b.md` | This file. |

## Documents modified in G1-B

| File | What changed |
|---|---|
| [`00-brand-foundation.md`](./00-brand-foundation.md) | Design principle 5 corrected ("one product, everyone gets all of it" → "one coherent product architecture, progressive disclosure"); engine table concepts updated (Recurring **Service** Assurance, Capacity); header points to `11`. |
| [`01-brand-architecture.md`](./01-brand-architecture.md) | Added §3A **resolved surface identity matrix** (Step 9); §4 open questions **answered** (login, operator branding, attribution, logo asset, terminology); documented where the Zenward Mobility logo remains legitimate; header locked. |
| [`02-positioning.md`](./02-positioning.md) | "recurring care" → "recurring service" in the preferred-register list; header note. Content otherwise current. |
| [`03-verbal-identity.md`](./03-verbal-identity.md) | Header note only — content current. |
| [`04-visual-direction.md`](./04-visual-direction.md) | Header note — wordmark/symbol direction now carried by `14`, token values by `12`. Content current. |
| [`05-semantic-color-system.md`](./05-semantic-color-system.md) | §2 replaced with **Brand Palette Primitives v1 (LOCKED)** + locked color meanings + the "primitives are not raw-use permission" constraint; §8 rewritten as the G1-B outcome pointing to `12`. |
| [`06-typography-system.md`](./06-typography-system.md) | §1 **font LOCKED: Geist Sans + Geist Mono**, with the "no developer-tool aesthetic" constraint and a documented fallback path; §6 rewritten; points to `13`. |
| [`07-product-language.md`](./07-product-language.md) | All flagged terms **locked** (Step 10): Requests/Request Hub, Capacity + "dead time" metric, standing order, **Recurring Service Assurance** (renamed from "Recurring Care Assurance"), the 3-concept **Assurance family** (§4.1 new), Vehicles (not Fleet), Operations Brief, **Tomorrow Readiness = next calendar day**, **round-trip = outbound + return** linked to one request. §5 converted from "flagged for review" to "LOCKED in G1-B". |
| [`09-operator-maturity-principles.md`](./09-operator-maturity-principles.md) | §1 **corrected** to "one coherent product architecture with progressive disclosure"; commercial packaging explicitly undecided and separated from UX disclosure; §5 updated. |
| [`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md) | §6 open questions table updated to **RESOLVED / still-open** status; header points to `15` as the authoritative inventory. §7 appendix retained as the G1-A preview. |

---

## Decision-by-decision incorporation

| # | Human-approved decision | Where incorporated |
|---|---|---|
| 1 | **Core position** — "Operating infrastructure for medical transportation."; the four operator questions | Already in `00` §3, `02` §2; restated as LOCKED in `11` §Core Position. Unchanged. |
| 2 | **Identity direction** — custom wordmark + compact independent symbol; symbol concepts (coordination, structure, continuity, connection, control, movement-through-a-system, operational certainty); symbol forbidden motifs; not an obvious monogram; produce a design brief, not the logo | `11` §Identity Direction; full brief in `14`. |
| 3 | **Visual character** — predominantly neutral; character from typography/alignment/spacing/borders/hierarchy/density/restraint, not decorative color; "operational instrument, not marketing SaaS dashboard" | `11` §Visual Character; consistent with `04` (unchanged). |
| 4 | **Palette primitives** — lock the 9 hex values as Brand Palette Primitives v1; they are primitives, not raw-use permission; derive semantic accessibility variants | `05` §2 (rewritten, LOCKED); `12` §2 (primitives) + §4 (derived + contrast); `11` §Palette. |
| 5 | **Color meaning** — Signal Green / Attention Amber / Critical Red / Steel Blue meanings; signal colors are never the marketing palette; Signal Green never the default CTA; primary CTA = Deep Graphite/Ink | `05` §2 "Color meanings (LOCKED)" + §6; `12` §3 `action.primary.*` and §4 `status.*`; `11` §Color Meaning. |
| 6 | **Typography LOCKED** — Geist Sans + Geist Mono; mono selectively; no developer-tool aesthetic; don't load the font yet | `06` §1 (LOCKED); `13` (full scale); `11` §Typography. |
| 7 | **Login architecture** — one Nemryn sign-in; 1 workspace → enter, N → selector; no operator-branded login URLs; no `app.nemryn.com/zenward` default | `01` §3A + §4.1; `11` §Surface Identity; `15` (auth touchpoints). |
| 8 | **Operator branding v1** — operator display name yes; custom operator logos in-app deferred; Zenward Mobility keeps its logo; Nemryn does not redesign it | `01` §3A ("where the Zenward Mobility logo remains legitimate") + §4.2; `11` §Operator Branding. |
| 9 | **Generated documents** — operator-branded; no "Powered by / Generated by Nemryn" required in v1; internal metadata attribution ok | `01` §3A + §4.3; `11` §Generated Documents; `15` (reports/billing stubs row). |
| 10 | **Workspace language** — customer-facing UI: "workspace"; technical/admin/data: "organization"; don't rename the DB concept | `01` §4.5; `07` §5 + §7; `11` §Terminology. |
| 11 | **Platform surface identity** — sign in / sign up / auth error / account-security = Nemryn only; driver invite = Nemryn + explicit tenant context ("You're joining {Organization Name}"); onboarding = Nemryn frame + workspace context once known; ops shell = Nemryn mark + workspace name; no operator logo customization v1 | `01` §3A (full matrix); `11` §Surface Identity; `15` (per-file actions). |
| 12 | **Metadata** — title root "Nemryn"; platform description "Operating infrastructure for medical transportation."; authenticated title pattern `[Surface] — [Workspace] | Nemryn`; auth/neutral `Sign in | Nemryn`; don't implement yet | `11` §Metadata; `15` §Global metadata rows (future values, phase: shell migration). |
| 13 | **Request language** — nav label "Requests"; concept "Request Hub" for marketing/docs/feature/release; prefer "Requests" in daily nav; don't rename code | `07` §2.1, §4 (Request Hub), §5; `11` §Terminology. |
| 14 | **Capacity language** — surface/module "Capacity"; "dead time" is a metric inside it; forbidden: "Dead Time Intelligence", "Capacity Intelligence", "AI Capacity", "Smart Capacity"; keep "dead time" in vocabulary | `07` §3 (dead time), §4 (Capacity), §5; `11` §Terminology. |
| 15 | **Recurring transportation** — object = "standing order"; rename "Recurring Care Assurance" → **"Recurring Service Assurance"** ("care" = unnecessary clinical positioning); the conceptual split; update specs; don't rename code/schema | `07` §3 (standing order), §4 (Recurring Service Assurance), §5; `00` engine table; `09`; `11` §Terminology. |
| 16 | **Assurance family** — retain "Assurance" for exactly Trip / Recurring Service / Revenue Assurance; scopes stay separate (stated); not a generic suffix | `07` §4.1 (new); `11` §Terminology. |
| 17 | **Vehicles** — nav/module label "Vehicles"; "Fleet" is prose only | `07` §3 (vehicle), §5, §7; `11` §Terminology. |
| 18 | **Operations Brief** — conceptual replacement for "Overview"; eventual operational front door; answers the four questions; don't implement the rename yet | `07` §4 (Operations Brief), §5; `00` (unchanged concept); `11` §Terminology; `15` (Overview→Operations Brief row, phase: shell/module migration). |
| 19 | **Round-trip model** — a request can produce more than one trip; round trip = outbound + return linked to one request/obligation; don't change the data model; product-language direction subject to later validation | `07` §3 (trip, request), §5; `11` §Terminology; flagged for data-model validation. |
| 20 | **Tomorrow Readiness** — "tomorrow" = next **calendar** day; always show the date when ambiguity matters; "no trips tomorrow" is useful info; do not reinterpret as "next service day" | `07` §4 (Tomorrow Readiness), §5; `11` §Terminology. |
| 21 | **Trips icon** — keep restrained Path-style; no car/ambulance/road-sign/map-pin as default; final confirmation in component visual review | `07` §5; `04` §11 (unchanged); `11` §Iconography; `15` (`src/design/icons.ts` row). |
| 22 | **Historical documentation** — never bulk-rebrand the docs corpus; classify LIVING PLATFORM SPEC / TENANT-SPECIFIC / HISTORICAL RECORD; historical records (completion reports, decision history, audits, deployment records) stay accurate and are not rewritten | `11` §Documentation Classification; `15` §Documentation corpus section; `10` §5 (unchanged rule). |
| 23 | **Operator maturity** — correct "one product, everyone gets all of it" → "one coherent product architecture with progressive disclosure"; commercial packaging undecided; don't encode maturity as pricing; UX adapts to operational maturity independently of packaging | `09` §1 (rewritten), §5; `00` design principle 5; `11` §Maturity. |

---

## What G1-B explicitly did NOT do

- No application component change. No `src/app/globals.css` change. No Tailwind
  config change. No `next/font` / font-import change. No asset replaced. No Nemryn
  pixel in the application.
- No authentication, Supabase, RLS, schema, migration, or domain change.
- No code or database identifier renamed.
- No git staging, commit, push, or PR.
- The Nemryn wordmark/symbol was **not** designed — only briefed (`14`).
- Domain ownership was **not** verified or asserted (`11` §Domain).
