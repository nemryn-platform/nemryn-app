# Nemryn — Brand Implementation Boundaries

**Phase:** NEMRYN G1-A (revised in G1-B)
**Status:** Specification + read-only inventory. **No code was changed to produce this document.**
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** all prior files in this folder.
**Superseded for the inventory:** the §7 appendix here is the G1-A *preview*. The **complete line-level rebrand inventory is [`15-rebrand-inventory.md`](./15-rebrand-inventory.md)** (G1-B). §6 open questions are largely resolved — see [`11-brand-lock-v1.md`](./11-brand-lock-v1.md).

---

## 1. Purpose

This file governs the *eventual* rebrand of the running application from Zenward
to Nemryn. It exists now so that when the rebrand is authorized, it is executed
deliberately — not as a reckless find-and-replace.

**G1-A changes nothing.** Everything below is a rule for a future phase plus an
inventory of what that future phase will touch.

## 2. Hard rules for the future rebrand

### 2.1 Do NOT globally find-and-replace `Zenward` → `Nemryn`

Occurrences of "Zenward" in this codebase fall into **three** categories, and a
blind replace corrupts two of them:

| Category | Meaning | Rebrand action |
|---|---|---|
| **Platform identity** | "Zenward" used to mean the software/product/platform | → becomes **Nemryn** (deliberately, per surface) |
| **Tenant identity** | "Zenward Mobility" used to mean the NEMT operator | → **stays Zenward Mobility** (it's a customer now) |
| **Historical / internal** | code comments, decision-register entries, report filenames, phase docs referencing past work | → **left as written** (they are an accurate record of what was true then) |

Every occurrence must be classified before it is touched. The appendix (§7) is
the starting inventory.

### 2.2 Do NOT alter tenant identity

Zenward Mobility's name, its logo asset, its tagline ("Care that gets you
there."), and its operator-facing presentation are **tenant data / tenant
assets**. The rebrand does not remove or replace them — it *reclassifies* them
from "the app's brand" to "one operator's identity within the app."

### 2.3 Do NOT modify the tenancy schema for cosmetic naming

The `organizations` table is the tenant root. It has `id`, `name`, `status`,
timestamps — no brand coupling. Nothing about the rebrand requires a column,
table, enum, or constraint change. Do not rename `organizations`,
`memberships`, or any domain table "to sound like Nemryn."

### 2.4 Do NOT modify RLS for branding

Row-level security policies, `SECURITY DEFINER` functions, and the RLS helper
functions are security infrastructure. Branding has zero legitimate reason to
touch them. Any rebrand PR that modifies a `supabase/migrations/*` RLS file or a
policy is wrong and must be rejected.

### 2.5 Do NOT rename database objects to reflect the brand

Tables, columns, functions, types, policies, indexes, migrations — all keep their
names. The database is not a brand surface. Renaming objects risks breaking RLS,
generated types (`src/lib/supabase/database.types.ts`), and every query, for
zero user-visible benefit.

### 2.6 Do NOT move `app.zenwardmobility.com` until the migration phase

Domain, DNS, and the hosted Supabase Auth URL configuration stay exactly as they
are until a dedicated, separately-authorized auth/domain migration phase. The
production app keeps serving from `app.zenwardmobility.com` through the entire
visual rebrand. `app.nemryn.com` is the *last* step, not an early one.

### 2.7 Do NOT modify hosted Supabase configuration for branding

No `supabase config push`. No Dashboard changes for brand reasons. The only
Supabase Auth change on the roadmap is part of the auth/domain migration phase,
authorized on its own.

### 2.8 Do NOT introduce Nemryn UI into production during G1

G1 is brand *architecture*. No Nemryn colors, wordmark, fonts, or copy reach the
production application in any G1 sub-phase. The first Nemryn pixels in production
happen only when a later phase explicitly authorizes the shell migration.

### 2.9 Do NOT co-brand

No "Zenward Mobility, powered by Nemryn" lockups. No shared logo. The platform is
Nemryn; the operator is Zenward Mobility; they are shown in different places for
different reasons (see [`01-brand-architecture.md`](./01-brand-architecture.md)).

## 3. The future rebrand sequence (conceptual)

A deliberate order. Each step is its own authorized phase with its own report.
This is a map, not a schedule, and not authorization for any of it.

1. **Brand lock.** Human approval of: the Nemryn wordmark/logo, final palette
   values, final font decision, positioning statement, and the open questions in
   §6. Nothing visual proceeds until this is signed.
2. **Rebrand inventory (full).** Extend the §7 appendix into a complete,
   classified, line-level inventory of every touchpoint — platform vs tenant vs
   historical — with a decided action for each. Reviewed and frozen.
3. **Token migration.** Build the Nemryn token layer (colors → semantic roles,
   type roles, spacing/radius/shadow/motion) in `src/app/globals.css`'s `@theme`
   block and `src/design/*`, *alongside* the existing tokens if feasible, with a
   documented old→new map. No component consumes the new tokens yet. Font
   dependency swapped here (`next/font`). Validate contrast/AA.
4. **Application shell.** Rebrand the frame only: global nav, headers, auth
   screens, system chrome, metadata/titles, favicon, manifest, `<title>`,
   email templates. The operator context (workspace name) rendering is added
   here. Operational screen *interiors* untouched.
5. **Module-by-module visual migration.** One operational area at a time
   (Operations Brief, Requests, Trips, Dispatch, Passengers, Facilities, Drivers,
   Vehicles, Settings, driver surface), each migrated to Nemryn tokens and
   vocabulary, each QA'd, each shippable independently.
6. **QA.** Full visual + functional regression: every surface, light + inverse,
   every role, responsive breakpoints, screenshot diffs, accessibility audit,
   the existing SQL/RLS suites re-run unchanged (they should be — no DB change).
7. **Auth / domain migration.** Separately authorized. New domain
   (`app.nemryn.com`), Supabase Auth URL configuration, redirect/site-URL updates,
   email template `{{ .SiteURL }}` follows, old domain redirects. Backward-compat
   window. Its own runbook.
8. **`app.nemryn.com` live.** Zenward Mobility becomes a tenant *inside* Nemryn at
   the new domain. `app.zenwardmobility.com` redirects for a defined period, then
   retires.

Rule: **the app is always shippable between steps.** No step leaves production
half-branded.

## 4. What is safe to do now (G1, without touching production)

- Write and refine these brand documents.
- Design the Nemryn wordmark, palette, and screens in design tools / an isolated
  design artifact — nothing wired into this repo.
- Build the Nemryn marketing site in its own repo (per
  [`08-marketing-vs-application.md`](./08-marketing-vs-application.md) §6) — it
  has no dependency on this application.
- Produce the full rebrand inventory (step 2) as a document.

## 5. What is never acceptable, even in a later phase

- A branding change that also changes behavior, data, security, or tenancy.
- A rebrand PR mixed with feature work.
- Renaming a database object.
- Touching RLS.
- Moving the domain outside the dedicated migration phase.
- Removing Zenward Mobility's identity rather than reclassifying it.
- Shipping a partially-branded production state as "we'll finish it next sprint."

## 6. Open questions — status after G1-B

Most G1-A open questions are now **RESOLVED**. Full lock statement:
[`11-brand-lock-v1.md`](./11-brand-lock-v1.md).

| # | Question | G1-B status |
|---|---|---|
| 1 | Nemryn wordmark & logo | **Still open** — do not exist. Design brief written ([`14-identity-design-brief.md`](./14-identity-design-brief.md)); actual design is G1-C. |
| 2 | Palette values & contrast-validated token set | **RESOLVED** — primitives locked; derived tokens + contrast in [`12-design-token-specification.md`](./12-design-token-specification.md). |
| 3 | Font decision | **RESOLVED** — Geist Sans + Geist Mono locked ([`06`](./06-typography-system.md), [`13-typography-specification.md`](./13-typography-specification.md)). |
| 4 | Operator-specific login entry | **RESOLVED** — one Nemryn sign-in; no operator-branded login URLs in v1 ([`01`](./01-brand-architecture.md) §4). |
| 5 | Operator logo in v1? | **RESOLVED** — operator display *name* yes; operator *logo in-app* deferred past v1 ([`01`](./01-brand-architecture.md) §4). |
| 6 | Attribution on operator documents | **RESOLVED** — operator-branded; **no "Powered by / Generated by Nemryn" required** in v1 ([`01`](./01-brand-architecture.md) §4). |
| 7 | Zenward Mobility logo mark | **RESOLVED** — tenant asset; Zenward Mobility keeps it; Nemryn does not redesign it ([`01`](./01-brand-architecture.md) §3A). |
| 8 | "workspace" vs "organization" | **RESOLVED** — customer-facing UI: workspace; technical/admin/data: organization; DB not renamed ([`01`](./01-brand-architecture.md) §4, [`07`](./07-product-language.md) §5). |
| 9 | Product-language names | **RESOLVED** — Requests/Request Hub, Capacity (+ "dead time" metric), standing order, Recurring **Service** Assurance, the 3-concept Assurance family, Vehicles, Operations Brief, Tomorrow Readiness (= next calendar day), round-trip model — all locked in [`07`](./07-product-language.md) §5. |
| 10 | Global metadata description | **RESOLVED (direction)** — title root **Nemryn**; platform description **"Operating infrastructure for medical transportation."**; authenticated title pattern `[Surface] — [Workspace] | Nemryn`. Not implemented. See [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §Metadata. |
| 11 | Round-trip modeling | **RESOLVED (product-language direction)** — request → outbound trip + return trip; subject to data-model validation before implementation ([`07`](./07-product-language.md) §3). |

### Still genuinely open after G1-B

- **The Nemryn wordmark and symbol** (design work — G1-C, per
  [`14-identity-design-brief.md`](./14-identity-design-brief.md)).
- **Commercial packaging** — whether/how any capability is plan-gated. Explicitly
  undecided; maturity disclosure must not be built as a plan gate
  ([`09`](./09-operator-maturity-principles.md) §1, §5).
- **Domain registrar/ownership status for `nemryn.com`** — requires separate
  human verification ([`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §Domain).
- **Settings IA** — the platform-account-vs-workspace-settings split.
- Whether **Facility coordination** / **Proof of Service** / **Exception
  Recovery** get their own top-level nav (design questions).
- Final **Trips icon** confirmation (component visual review, not G1-B).
- Whether operator **logo** support arrives in a later defined version.

---

## 7. APPENDIX — Existing brand touchpoint inventory (read-only preview)

**Method:** static inspection of the working tree on 2026-09-07. No files
changed. This is a **preview**, not the full rebrand inventory (step 2 above).
Line numbers are indicative and will drift.

**Classification key:** `P` = platform identity (→ Nemryn eventually) ·
`T` = tenant identity (→ stays Zenward Mobility) · `H` = historical/internal
(→ leave as-is) · `?` = ambiguous, needs a decision at inventory time.

### 7.1 Global metadata / browser / manifest

| Location | Content | Class | Rebrand note |
|---|---|---|---|
| `src/app/layout.tsx:18` | `title: "Zenward Mobility"` (global `<title>`) | ? | The browser tab of the *platform* app → likely "Nemryn"; but a tenant-aware title ("Zenward Mobility — Nemryn") is a §6 Q. |
| `src/app/layout.tsx` `metadata.description` | `"Non-emergency medical transportation."` | ? | That's the operator's business, not the platform's. Nemryn's description is different. §6 Q10. |
| `src/app/*/page.tsx` (8 files) | `metadata.title: "... — Zenward Mobility"` — sign-in, sign-up, join, auth-code-error, access-unavailable, complete-signup/form, select-organization | P (mostly) | These are platform auth/system screens → "— Nemryn". |
| `src/app/favicon.ico` (25.9 KB) | current favicon (presumably Zenward mark) | P | Replace with Nemryn favicon in shell step. |
| PWA manifest / `apple-icon` / `opengraph-image` / `robots` / `sitemap` | **none present** | — | None exist yet; when added they are Nemryn (platform) assets. |
| `package.json:2` | `"name": "zenward-mobility"` | H/? | Package name; cosmetic; low priority; changing it touches nothing user-facing. |
| `README.md` | "# Zenward Mobility / Non-emergency medical transportation. Care that gets you there." | ? | Repo readme; update when the repo's identity officially shifts. |

### 7.2 Logo asset

| Location | Content | Class | Rebrand note |
|---|---|---|---|
| `public/images/zenward-mobility-logo.png` | "the approved Zenward Mobility logo (Z/route/pin-heart mark + wordmark)" per code comments | **T** | This is the **operator's** logo. It is not replaced by a Nemryn logo — it becomes a tenant asset. Platform surfaces that currently render it need a Nemryn wordmark instead (new asset). |
| Rendered in: `src/app/sign-in/page.tsx:52`, `sign-up/page.tsx:28`, `join/[token]/page.tsx:31`, `auth/auth-code-error/page.tsx:23`, `onboarding/layout.tsx:25`, `components/operations/OperationsSidebar.tsx:100` | operator logo shown on platform surfaces | ? | **Key ambiguity.** Auth screens, onboarding, and the operations sidebar are *platform* frame → should show the Nemryn wordmark. But onboarding and the sidebar are used *by an operator inside their workspace* → operator context may also belong there. §6 Q4/Q5. |

### 7.3 Design tokens / visual system

| Location | Content | Class | Rebrand note |
|---|---|---|---|
| `src/app/globals.css` | `@theme` block — 5 brand colors (`--color-brand-care-navy #123447`, `--color-brand-route-teal #21a89a`, `--color-brand-interactive-teal #178577`, `--color-brand-calm-mist #ddf4f0`, `--color-brand-arrival-gold #f4b860`), neutral scale, 4 semantic families, spacing/radius/shadow/motion | P | The **entire visual identity**. Replaced by the Nemryn token set in the token-migration step. Note: token *names* (`brand-care-navy`, etc.) are Zenward-flavored and are consumed in ~63 component class usages — the migration needs an old→new name map, not just value swaps. |
| `src/app/globals.css:4` | comment `"Zenward design tokens."` + reference to `/docs/design/design-tokens.md` | H/P | Comment + the referenced doc. |
| `src/design/typography.ts` | typography token map; comments naming Manrope (display) + Inter (body); marketing-vs-operational split | P | Nemryn direction is single-family Geist. Rework in token step. |
| `src/design/icons.ts` | Phosphor icon map for nav; a `Path`-for-`Route` substitution already "flagged for design review" | P | Icon family direction (Phosphor) may carry over; resolve the flagged item. |
| `src/app/layout.tsx:2-16` | `next/font/google` loading Manrope + Inter → `--font-manrope`, `--font-inter` | P | Font dependency swap happens in token step, not before. |
| **Hard-coded hex colors in components** | **none found** (outside `globals.css` and `database.types.ts`) | — | Good: the token discipline is clean. One exception: `src/app/globals.css` has a literal `rgb(15 23 42 / 0.45)` dialog-backdrop and `rgb(...)` shadow values — token-layer only, fine. |

### 7.4 Copy strings — platform identity (`P`)

| Location | String | Rebrand note |
|---|---|---|
| `src/app/sign-in/page.tsx:63` | "Sign in to continue to Zenward." | → "Sign in to continue to Nemryn." |
| `src/app/sign-in/page.tsx:80` | "New to Zenward?" | → Nemryn |
| `src/app/sign-up/page.tsx:39` | "Set up Zenward for your transportation business." | → "Set up Nemryn for your transportation business." |
| `src/app/select-organization/page.tsx:49` | "Your account has access to more than one Zenward organization." | → "…more than one workspace." (also a vocabulary decision — §6 Q8) |
| `src/lib/auth/errors.ts:29` | `NO_ACTIVE_MEMBERSHIP: "Your account does not currently have access to a Zenward organization."` | → Nemryn / "workspace" |
| `src/components/operations/OperationsShell.tsx:30` | `title="Zenward Operations"` (the below-md guard state) | → "Nemryn Operations" or just "Operations" |
| `src/components/driver/DriverLayoutClient.tsx:19` | `return "Zenward Driver";` (fallback header title) | ? — the driver works *for an operator*. Could be "Driver" (plain) or operator-contextual. Not "Nemryn Driver" — a driver has no relationship with the platform brand. §6 Q. |
| `src/app/foundation/page.tsx:87` | breadcrumb `{ label: "Zenward", href: "/" }` | Internal QA page; low priority; → Nemryn or drop. |

### 7.5 Copy strings — tenant identity (`T`) — **stay Zenward Mobility**

| Location | String | Note |
|---|---|---|
| `src/components/public/PublicHeader.tsx:26` | "Zenward Mobility" (wordmark link) | These `src/components/public/*` files are already slated to **move to the marketing repo** (`docs/product/public-marketing-separation.md`). In the Nemryn world the *Nemryn* marketing site is separate again; a *Zenward Mobility* public site, if it exists, is the operator's, not the platform's. |
| `src/components/public/PublicFooter.tsx:25,52` | "Zenward Mobility" + "Care that gets you there." + "© {year} Zenward Mobility" | Tenant tagline + copyright. Stays with Zenward Mobility. |
| `src/app/onboarding/basics/page.tsx:29` | "…Zenward's own initial launch territory is Georgia." | Operator-specific fact (Georgia launch). This is really about the *operator*, not the platform — reword to be operator-neutral or tenant-scoped. `?` |
| `src/app/onboarding/driver/page.tsx:23` | "…Zenward supports that." (owner-operator copy) | `?` — "Nemryn supports that" (platform capability) is probably right here. |
| `src/app/join/[token]/page.tsx:84,115` | "invited to drive for {organizationName}" / "start receiving trips as {invitedDisplayName}" | Already correct — uses the **operator's real name** dynamically, no hard-coded brand. Model for how other surfaces should show tenant context. |

### 7.6 Copy strings — historical / internal (`H`) — **leave as written**

| Location | Content |
|---|---|
| `src/app/page.tsx:6-8` | comment referencing "the Zenward-Web repository (ZD-079)" and repo history |
| `src/app/auth/confirm/route.ts:53` | comment "(app.zenwardmobility.com), so this only ever mattered locally" — accurate today |
| `src/app/sign-in/page.tsx:45-46` | comment "the approved Zenward Mobility logo… reused from Zenward-Web's own asset" |
| `src/components/operations/OperationsSidebar.tsx:68-70` | comment about the "legacy plain-text 'Zenward'/'Z' treatment this sidebar previously" |
| `src/app/operations/facilities/page.tsx:11` | comment "…their tenant only, never the Zenward organization itself" |
| `src/components/operations/trip-detail/TripNotesPanel.tsx:32` | comment "…a Zenward staff account, never a requester" — reads as platform-staff; reword to "operator staff" when touched |
| `docs/**` (product, design, deployment, security, reports) | Hundreds of "Zenward" references across canonical docs. **Out of scope for the app rebrand.** These are the platform-identity doc corpus and a decision-register record. A doc rebrand is its own consideration, separate from the application, and much of it (reports, decision-register history) should never change. |

### 7.7 Email / notifications

| Location | Content | Class | Rebrand note |
|---|---|---|---|
| `supabase/templates/confirmation.html:3` | "Follow this link to confirm your Zenward Mobility account:" | P | The confirmation email is a *platform* auth email → "your Nemryn account". Changed in the shell/auth step, and the hosted Dashboard "Confirm signup" template must be updated to match at that time (not now). |
| `supabase/config.toml:269` | `subject = "Confirm your Zenward account"` (local dev email subject) | P | → "Confirm your Nemryn account" in the token/shell step. Local-only value; hosted subject is set in the Dashboard. |
| Passenger / facility / driver notification emails | **none built yet** | — | When built: passenger/facility comms go out as the **operator** (T); driver comms are operator-context on a Nemryn frame; account/security emails are Nemryn (P). See [`01`](./01-brand-architecture.md) §3. |

### 7.8 Reports / generated documents

| Location | Content | Class | Rebrand note |
|---|---|---|---|
| `src/app/operations/reports/page.tsx`, `.../billing/page.tsx` | structural stubs only — "built in a later phase" | — | No PDF/proof-of-service/invoice generation exists. When built, operator-produced documents are **tenant-branded** (T primary), with at most a small Nemryn attribution (§6 Q6). |

### 7.9 Database / schema / tenancy — **no brand coupling found (good)**

| Object | Note |
|---|---|
| `public.organizations` (`id, name, status, created_at, updated_at`) | Tenant root. `name` is free text set per operator. No "zenward" literal anywhere in schema. |
| `memberships`, `drivers`, `vehicles`, `passengers`, `facilities`, `trips`, `transportation_requests`, `trip_assignments`, `audit_events`, `driver_invites`, RLS policies, `SECURITY DEFINER` functions | Zero brand references. Nothing here changes for the rebrand. |
| `src/lib/supabase/database.types.ts` | generated; contains no brand strings (only `__InternalSupabase` type-plumbing matches on "Internal"). Regenerated from schema; not hand-edited for branding. |
| `.env.example` / `.env.local` | var names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` — no brand coupling. `NEXT_PUBLIC_APP_URL` value points at the Zenward domain but that's the domain-migration phase, not branding. |

### 7.10 Summary counts

- Source files containing a "Zenward" string (`src/`, `public/`, `supabase/`):
  **~24 files**, **~43 match lines** in `src/`+`public/` plus 2 in `supabase/`.
- Of those lines: roughly **12–15 platform-identity copy/metadata**,
  **~8 tenant-identity**, **~10 historical comments**, **~8 metadata titles**,
  plus **1 logo asset** referenced from **6 places**, and **1 token file** whose
  names propagate to **~63 component usages**.
- Hard-coded brand colors in components: **0**.
- Schema / RLS / tenancy brand coupling: **0**.
- `docs/**` "Zenward" references: **extensive** — explicitly out of scope for the
  application rebrand.

**Takeaway for step 2 (full inventory):** the application rebrand is
**tractable and low-risk** — it is concentrated in a token file, a logo asset,
~30 copy/metadata strings, and email templates. The real work is *classification*
(platform vs tenant vs historical), the *token name map*, and the *shell/auth/
domain* sequencing — not volume.
