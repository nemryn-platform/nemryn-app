# Nemryn — Full Rebrand Inventory

**Phase:** NEMRYN G1-B
**Status:** **This is a PLAN.** No application file was edited to produce it. It is the authoritative, line-level extension of the G1-A preview ([`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md) §7).
**Date:** 2026-09-07
**Method:** static inspection of the working tree on 2026-09-07 (`grep -rn`, file reads). Line numbers are indicative and will drift; re-verify at migration time.

---

## Legend

**Classification**

| Code | Meaning |
|---|---|
| **PLATFORM** | The occurrence means Nemryn-the-platform / product. → becomes Nemryn. |
| **TENANT** | The occurrence means Zenward Mobility-the-operator. → stays Zenward Mobility (reclassified as tenant identity). |
| **HISTORICAL** | A record of what was true when written (code comments, reports, decision history). → left as-is. |
| **AMBIGUOUS** | Needs a human/component decision at migration time. |

**Future action**

| Code | Meaning |
|---|---|
| `REPLACE→NEMRYN` | Swap the literal for the Nemryn equivalent. |
| `KEEP→ZENWARD` | Leave it; it is legitimate tenant identity. |
| `MAKE-DYNAMIC` | Replace a hard-coded name with the resolved workspace/organization name (already the pattern in `join/[token]`). |
| `LEAVE-HISTORICAL` | Do not change. |
| `REVIEW@SHELL` | Decide during the application-shell migration. |
| `REVIEW@MODULE` | Decide during that module's visual migration. |
| `REVIEW@DOMAIN` | Decide during the auth/domain migration. |
| `REVIEW@DOCS` | Handle in the separate documentation pass (never bulk). |

**Migration phase** — from the rebrand sequence ([`11`](./11-brand-lock-v1.md) §22):
token-migration · shell-migration · module-migration · qa · domain-migration ·
docs-pass (separate) · n/a.

**Risk** — LOW (mechanical), MED (needs judgement / visual change / user-visible
copy), HIGH (touches behaviour, data, security, or a shared primitive).

---

## 1. Global metadata / browser / manifest

| # | File : line | Current value | Class | Future value / direction | Phase | Risk |
|---|---|---|---|---|---|---|
| 1 | `src/app/layout.tsx:18` | `metadata.title: "Zenward Mobility"` | PLATFORM | `title` root **`Nemryn`**; template `%s | Nemryn` | shell-migration | MED |
| 2 | `src/app/layout.tsx` (metadata.description) | `"Non-emergency medical transportation."` | AMBIGUOUS → PLATFORM | **`Operating infrastructure for medical transportation.`** (the *platform* description; the current line is the operator's business, not Nemryn's) | shell-migration | MED |
| 3 | `src/app/layout.tsx` (`<html lang>` / fonts) | Manrope + Inter via `next/font/google` | PLATFORM | Geist Sans + Geist Mono ([`13`](./13-typography-specification.md)) | token-migration | HIGH (font swap; layout-shift risk) |
| 4 | `src/app/sign-in/page.tsx:10` | `metadata.title: "Sign in — Zenward Mobility"` | PLATFORM | `"Sign in | Nemryn"` (neutral surface pattern, [`11`](./11-brand-lock-v1.md) §16) | shell-migration | LOW |
| 5 | `src/app/sign-up/page.tsx:9` | `"Sign up — Zenward Mobility"` | PLATFORM | `"Sign up | Nemryn"` | shell-migration | LOW |
| 6 | `src/app/auth/auth-code-error/page.tsx:6` | `"Link expired — Zenward Mobility"` | PLATFORM | `"Link expired | Nemryn"` | shell-migration | LOW |
| 7 | `src/app/access-unavailable/page.tsx:8` | `"Access unavailable — Zenward Mobility"` | PLATFORM | `"Access unavailable | Nemryn"` | shell-migration | LOW |
| 8 | `src/app/complete-signup/form/page.tsx:8` | `"Complete your account — Zenward Mobility"` | PLATFORM | `"Complete your account | Nemryn"` | shell-migration | LOW |
| 9 | `src/app/select-organization/page.tsx:9` | `"Select organization — Zenward Mobility"` | PLATFORM | `"Select workspace | Nemryn"` (also "organization"→"workspace" per [`11`](./11-brand-lock-v1.md) §15) | shell-migration | LOW |
| 10 | `src/app/join/[token]/page.tsx:10` | `"Join — Zenward Mobility"` | PLATFORM (+tenant context) | `"Join {Organization Name} | Nemryn"` — MAKE-DYNAMIC for the org name | shell-migration | MED |
| 11 | `src/app/favicon.ico` (25.9 KB) | current Zenward favicon | PLATFORM | Nemryn symbol favicon (16/32/48 + 512 maskable) from G1-C ([`14`](./14-identity-design-brief.md) §9) | shell-migration | MED |
| 12 | *(absent)* PWA manifest / `apple-icon` / `opengraph-image` / `robots` / `sitemap` | none exist | PLATFORM (when added) | Nemryn platform assets; authenticated title pattern `[Surface] — [Workspace] | Nemryn` for OG where relevant | shell-migration | LOW |
| 13 | `package.json:2` | `"name": "zenward-mobility"` | HISTORICAL / cosmetic | optionally `"nemryn"` — no user-facing effect; low priority | token-migration or later | LOW |
| 14 | `README.md:1-3` | `# Zenward Mobility` / "Non-emergency medical transportation. Care that gets you there." | AMBIGUOUS | Repo README → describe the **Nemryn platform**; "Care that gets you there." is Zenward Mobility's tagline (TENANT) and moves out | docs-pass | LOW |
| 15 | `next.config.ts` (comment only) | references a doc path; no brand string | HISTORICAL | LEAVE-HISTORICAL | n/a | LOW |

---

## 2. Logo asset

| # | File : line | Current | Class | Future action | Phase | Risk |
|---|---|---|---|---|---|---|
| 16 | `public/images/zenward-mobility-logo.png` | the approved Zenward Mobility logo (Z/route/pin-heart mark + wordmark) | **TENANT** | `KEEP→ZENWARD` as the *asset*, reclassified: it is Zenward Mobility's operator identity, **not** a platform asset. Nemryn does not redesign it ([`11`](./11-brand-lock-v1.md) §13). Remove it from platform surfaces (rows 17–22); it is only used again if/when operator logos are supported (deferred past v1). | shell-migration | MED |
| 17 | `src/app/sign-in/page.tsx:52` (+ comment 45–46) | `<Image src="/images/zenward-mobility-logo.png" alt="Zenward Mobility">` | PLATFORM surface | Replace with the **Nemryn** wordmark/lockup (G1-C). Comment 45–46 → LEAVE-HISTORICAL. | shell-migration | MED |
| 18 | `src/app/sign-up/page.tsx:28` | same image | PLATFORM surface | Nemryn wordmark | shell-migration | MED |
| 19 | `src/app/auth/auth-code-error/page.tsx:23` | same image | PLATFORM surface | Nemryn wordmark | shell-migration | MED |
| 20 | `src/app/join/[token]/page.tsx:31` | same image | PLATFORM surface + tenant context | Nemryn frame; **name the organization** in copy ("You're joining {Organization Name}"). Not an operator logo in v1. | shell-migration | MED |
| 21 | `src/app/onboarding/layout.tsx:25` | same image | PLATFORM surface + workspace context | Nemryn frame; show organization/workspace name once known (already shows `organization.organizationName` at line 32) | shell-migration | MED |
| 22 | `src/components/operations/OperationsSidebar.tsx:100` (+ comment 68–70) | same image, in the sidebar frame | PLATFORM surface | Nemryn platform mark + current workspace name ([`11`](./11-brand-lock-v1.md) §12). No operator logo customization in v1. Comment → LEAVE-HISTORICAL. | shell-migration | MED |

---

## 3. Design tokens / visual system

| # | File : line | Current | Class | Future action | Phase | Risk |
|---|---|---|---|---|---|---|
| 23 | `src/app/globals.css` `@theme` — 5 brand colors (`brand-care-navy #123447`, `brand-route-teal #21a89a`, `brand-interactive-teal #178577`, `brand-calm-mist #ddf4f0`, `brand-arrival-gold #f4b860`) | PLATFORM | Replace with the Nemryn token set ([`12`](./12-design-token-specification.md)). **Purpose-based** map, not colour-similarity (see [`12`](./12-design-token-specification.md) Appendix A). `brand-interactive-teal` (46 uses) **splits** into `action.primary.*` / `text.link` / `focus.ring` / `selection.*` / `border.strong` — per call site. | token-migration | HIGH (shared primitive; 46-site split; visual change) |
| 24 | `src/app/globals.css` `@theme` — neutrals (`text-*`, `border-*`, `surface-*`) | PLATFORM | 1:1 purpose map to Nemryn `text.*` / `border.*` / `surface.*` ([`12`](./12-design-token-specification.md) A.2). Re-anchored values. | token-migration | MED |
| 25 | `src/app/globals.css` `@theme` — semantic families `success/warning/critical/info-*` (`critical-*` = 44 uses) | PLATFORM | Map to `status.ready/attention/critical/information.*` ([`12`](./12-design-token-specification.md) A.3). **Re-check meanings** — any `critical-*` on a routine notice → `status.information`/neutral. | token-migration + module-migration | HIGH (meaning re-check; heavy use) |
| 26 | `src/app/globals.css` `@theme` — `navy-*` on-navy chrome set | PLATFORM | `chrome.*` tokens; **teal active states → steel** ([`12`](./12-design-token-specification.md) A.4) | token-migration | MED |
| 27 | `src/app/globals.css:4` comment "Zenward design tokens." + ref to `/docs/design/design-tokens.md` | HISTORICAL / PLATFORM | Update the comment to "Nemryn design tokens" at migration; the referenced doc is a LIVING PLATFORM SPEC → REVIEW@DOCS | token-migration / docs-pass | LOW |
| 28 | `src/app/globals.css` — `--font-display` (Manrope), `--font-sans` (Inter) | PLATFORM | `font.sans` = Geist Sans; **`--font-display` removed** (single family). Every `font-display` consumer → `font.sans` + a `type.marketing.*` role. | token-migration | HIGH |
| 29 | `src/app/globals.css` — `--spacing-zw-*` (2xs–4xl) | PLATFORM | `--spacing-nm-*` `space.*` ([`12`](./12-design-token-specification.md) §4); drop `zw-4xl` (80px), add 64/96 for marketing. Keep the private-prefix Tailwind-collision guard. | token-migration | MED |
| 30 | `src/app/globals.css` — `--radius-xs/sm/md/lg` (6/8/10/14) | PLATFORM | `radius.sm/md/lg` (4/8/12) — tighter ([`12`](./12-design-token-specification.md) §5); per-usage rounding review | token-migration | MED |
| 31 | `src/app/globals.css` — `--shadow-sm/md`, `--duration-*`, `--ease-standard`, `dialog::backdrop` | PLATFORM | `shadow.raised/overlay` + `shadow.none`; `motion.duration.*` (add `instant`); `motion.easing.standard/exit`; `overlay.scrim` ([`12`](./12-design-token-specification.md) §6, §8) | token-migration | LOW |
| 32 | `src/design/typography.ts` | PLATFORM | Rewrite roles per [`13`](./13-typography-specification.md); Geist; `type.app.pageTitle` shrinks (30→24px); `display` marketing-only; `data`/`numeric` get `tabular-nums` | token-migration | MED |
| 33 | `src/design/icons.ts` (Phosphor nav-icon map; `Path`-for-`Route` substitution comment) | PLATFORM | Keep Phosphor direction; **Trips icon stays Path-style** ([`11`](./11-brand-lock-v1.md) §11); confirm the full set in component review | module-migration | LOW |
| 34 | Hard-coded hex in components | **none found** (outside `globals.css` + `database.types.ts`) | — | nothing to do — token discipline is clean | n/a | LOW |
| 35 | ~38 component files consuming `brand-*` / semantic / `navy-*` tokens (see [`12`](./12-design-token-specification.md) A.6 for the review list) | PLATFORM | Component-level review, not a blind rename — `buttonStyles.ts`, `StatusBadge.tsx`, `DataTable.tsx`, `Combobox.tsx`, `OperationsSidebar.tsx`, `AccountMenu.tsx`, `OnboardingChecklistBanner.tsx`, dispatch/trip panels, all `driver/*`, `public/*` | module-migration | HIGH (per-component judgement) |

---

## 4. Copy strings — PLATFORM (→ Nemryn)

| # | File : line | Current string | Future value | Phase | Risk |
|---|---|---|---|---|---|
| 36 | `src/app/sign-in/page.tsx:63` | "Sign in to continue to Zenward." | "Sign in to continue to Nemryn." | shell-migration | LOW |
| 37 | `src/app/sign-in/page.tsx:80` | "New to Zenward?" | "New to Nemryn?" | shell-migration | LOW |
| 38 | `src/app/sign-up/page.tsx:39` | "Set up Zenward for your transportation business." | "Set up Nemryn for your transportation business." | shell-migration | LOW |
| 39 | `src/app/select-organization/page.tsx:49` | "Your account has access to more than one Zenward organization. Choose which one to continue with." | "Your account has access to more than one workspace. Choose which one to continue with." (Nemryn implicit; "organization"→"workspace") | shell-migration | LOW |
| 40 | `src/lib/auth/errors.ts:29` | `NO_ACTIVE_MEMBERSHIP: "Your account does not currently have access to a Zenward organization."` | "Your account does not currently have access to a workspace." | shell-migration | LOW |
| 41 | `src/components/operations/OperationsShell.tsx:30` | `title="Zenward Operations"` (below-`md` guard state) | "Operations" (or "Nemryn Operations" if a brand line is wanted on that guard screen — REVIEW@SHELL) | shell-migration | LOW |
| 42 | `src/app/foundation/page.tsx:87` | breadcrumb `{ label: "Zenward", href: "/" }` | "Nemryn" (or drop) — internal QA page, low priority | module-migration (last) | LOW |

---

## 5. Copy strings — DRIVER SURFACE (AMBIGUOUS — resolved: not "Nemryn Driver")

| # | File : line | Current | Class | Future direction | Phase | Risk |
|---|---|---|---|---|---|---|
| 43 | `src/components/driver/DriverLayoutClient.tsx:19` | `return "Zenward Driver";` (fallback header title when no route matches) | AMBIGUOUS → resolved | **Not "Nemryn Driver"** ([`11`](./11-brand-lock-v1.md) §12). Options: plain `"Driver"`, or operator-contextual `"{Organization Name} · Driver"` via MAKE-DYNAMIC. Decide at driver-surface module migration. | module-migration | MED |

---

## 6. Copy strings — TENANT (→ stays Zenward Mobility)

| # | File : line | Current | Class | Future action | Phase | Risk |
|---|---|---|---|---|---|---|
| 44 | `src/components/public/PublicHeader.tsx:26` | "Zenward Mobility" (wordmark link) | TENANT | `src/components/public/*` moves to the Nemryn *marketing* repo OR becomes Zenward Mobility tenant-marketing — either way, **not** in this application long-term ([`08`](./08-marketing-vs-application.md) §6). If it stays transitionally, KEEP→ZENWARD. | module-migration / separate repo | MED |
| 45 | `src/components/public/PublicFooter.tsx:25` | "Zenward Mobility" (subheading) | TENANT | as row 44 | module-migration | LOW |
| 46 | `src/components/public/PublicFooter.tsx:25` | "Care that gets you there." (tagline) | TENANT | Zenward Mobility's tagline — never Nemryn's. KEEP→ZENWARD (with the public components' move). | module-migration | LOW |
| 47 | `src/components/public/PublicFooter.tsx:52` | "© {year} Zenward Mobility" | TENANT | KEEP→ZENWARD | module-migration | LOW |
| 48 | `src/app/onboarding/basics/page.tsx:29` (comment) | "…since Zenward's own initial launch territory is Georgia. Service area…" | AMBIGUOUS | Reword operator-neutral ("the operator's launch territory") or tenant-scoped. It's really about the *operator*, not the platform. | module-migration | LOW |
| 49 | `src/app/onboarding/driver/page.tsx:23` | "Many small operators are the owner, dispatcher, and driver — Zenward supports that." | PLATFORM | "…— Nemryn supports that." (platform capability statement) | shell-migration | LOW |
| 50 | `src/app/join/[token]/page.tsx:84` | "You've been invited to drive for {organizationName} as {invitedDisplayName}." | TENANT (already dynamic) | **No change** — model example: the operator name is already resolved dynamically, not hard-coded. | n/a | LOW |
| 51 | `src/app/join/[token]/page.tsx:115` | "…start receiving trips as {invitedDisplayName}." | TENANT (already dynamic) | No change | n/a | LOW |

---

## 7. Copy / comments — HISTORICAL (→ leave as written)

| # | File : line | Content | Action |
|---|---|---|---|
| 52 | `src/app/page.tsx:6-8` | comment: "This repository is the Zenward… the separate Zenward-Web repository (ZD-079)…" | LEAVE-HISTORICAL |
| 53 | `src/app/auth/confirm/route.ts:53` | comment: "(app.zenwardmobility.com), so this only ever mattered locally…" | LEAVE-HISTORICAL until domain-migration, then update the comment to reflect the new canonical host |
| 54 | `src/app/sign-in/page.tsx:45-46` | comment: "the approved Zenward Mobility logo… reused from Zenward-Web's own asset…" | LEAVE-HISTORICAL |
| 55 | `src/components/operations/OperationsSidebar.tsx:68-70` | comment: "…legacy plain-text 'Zenward'/'Z' treatment this sidebar previously…" | LEAVE-HISTORICAL |
| 56 | `src/app/operations/facilities/page.tsx:11` | comment: "…their tenant only, never the Zenward organization itself." | Reword to "the operator's own organization" when the file is touched (MED value — it currently reads as platform-staff framing) — else LEAVE-HISTORICAL |
| 57 | `src/components/operations/trip-detail/TripNotesPanel.tsx:32` | comment: "…a Zenward staff account, never a requester)." | Reword "operator staff" when touched — else LEAVE-HISTORICAL |

---

## 8. Email / notifications

| # | File : line | Current | Class | Future value | Phase | Risk |
|---|---|---|---|---|---|---|
| 58 | `supabase/templates/confirmation.html:3` | "Follow this link to confirm your Zenward Mobility account:" | PLATFORM | "…confirm your **Nemryn** account:" | shell-migration (local template) + **domain-migration** (hosted Dashboard "Confirm signup" template must be updated in the same change — [`10`](./10-brand-implementation-boundaries.md) §3) | MED (must sync local + hosted; do NOT `config push`) |
| 59 | `supabase/config.toml:269` | `subject = "Confirm your Zenward account"` | PLATFORM | `"Confirm your Nemryn account"` (local dev only; hosted subject set in the Dashboard) | shell-migration | LOW |
| 60 | `supabase/config.toml:169` | comment mentioning `app.zenwardmobility.com` | HISTORICAL | LEAVE-HISTORICAL until domain-migration | domain-migration | LOW |
| 61 | *(absent)* passenger / facility / driver notification emails | not built | TENANT (passenger/facility), Nemryn-frame+operator-context (driver), Nemryn (account/security) | Build to the identity rules in [`01`](./01-brand-architecture.md) §3A | future feature | — |

---

## 9. Reports / generated documents

| # | Location | Current | Class | Future direction | Phase | Risk |
|---|---|---|---|---|---|---|
| 62 | `src/app/operations/reports/page.tsx`, `src/app/operations/billing/page.tsx` | structural stubs ("built in a later phase") | — | When built: operator-generated documents are **operator-branded**; **no "Powered by / Generated by Nemryn" required** in v1 ([`11`](./11-brand-lock-v1.md) §14). Internal metadata attribution only. | future feature | — |

---

## 10. Database / schema / tenancy — NO BRAND COUPLING (confirmed)

| # | Object | Finding | Action |
|---|---|---|---|
| 63 | `public.organizations` (`id, name, status, created_at, updated_at`) | tenant root; `name` is per-operator free text; **no "zenward" literal anywhere in schema** | **NONE.** Do not rename. `organization` is the technical term ([`11`](./11-brand-lock-v1.md) §15). |
| 64 | `memberships`, `drivers`, `vehicles`, `passengers`, `facilities`, `trips`, `transportation_requests`, `trip_assignments`, `audit_events`, `driver_invites`; all RLS policies; all `SECURITY DEFINER` functions; all migrations | **zero brand references** | **NONE.** No rename, no RLS change, no migration for branding. |
| 65 | `src/lib/supabase/database.types.ts` | generated; no brand strings (only `__InternalSupabase` type-plumbing) | regenerated from schema; never hand-edited for branding |
| 66 | `.env.example` / `.env.local` var names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`) | no brand coupling in names | `NEXT_PUBLIC_APP_URL` *value* points at the Zenward domain → **domain-migration only**, not branding. No env change in the visual rebrand. |

---

## 11. Documentation corpus (`docs/**`) — classification, NEVER bulk-rebrand

~106 files under `docs/` contain "Zenward" (24 in `docs/product/`, 39 in
`docs/reports/`, plus `docs/design/`, `docs/security/`, `docs/deployment/`,
`docs/commercial/`, `docs/data/`). **Do not find-and-replace.** Classify per
[`11`](./11-brand-lock-v1.md) §19:

| Area | Classification | Future action |
|---|---|---|
| `docs/reports/*` (39 files — completion reports, audits, deployment records, the N0/G0 series, the G1-A brand report) | **HISTORICAL RECORD** | `LEAVE-HISTORICAL`. Accurate as written. A short "superseded by / see also" note may be appended; the body is not rewritten. |
| `docs/product/decision-register.md` (15 "Zenward" hits — ZD-* history) | **HISTORICAL RECORD** | `LEAVE-HISTORICAL` for existing entries. New decisions (e.g. the Nemryn rebrand) get new ZD entries. |
| `docs/product/*` model/spec docs (domain-model, authorization-model, lifecycle-model, operator-onboarding-model, driver-invite-linkage-model, auth-session-routing, application-route-map, product-definition, scope-register, …) | **LIVING PLATFORM SPEC** | `REVIEW@DOCS`. May move from Zenward naming to Nemryn *where the text means the platform*, deliberately, doc-by-doc — as its own pass, not mixed with the code rebrand. Tenant-specific passages (e.g. Georgia launch, "Care that gets you there.") are re-scoped as tenant material. |
| `docs/design/*` (design-tokens.md, visual-system.md, zenward-ui-system.md, interface-principles.md, component-inventory.md, …) | **LIVING PLATFORM SPEC** | `REVIEW@DOCS` — supersede with / align to the Nemryn brand docs (`docs/brand/nemryn/*`). `zenward-ui-system.md` in particular is superseded by this folder. |
| `docs/security/*` | **LIVING PLATFORM SPEC** | `REVIEW@DOCS`. Security reasoning is platform-level; rename references to the platform where they mean the platform. No security *content* change. |
| `docs/deployment/*` (staging-runbook, staging-auth-configuration, …) | mixed **LIVING SPEC** + **HISTORICAL** | `REVIEW@DOMAIN` — much of this is domain/host-specific and is revised as part of the domain-migration runbook. |
| `docs/commercial/*` (11 files) | likely **TENANT-SPECIFIC** (Zenward Mobility's go-to-market) — verify | `REVIEW@DOCS` — probably re-homed as Zenward Mobility (tenant) material, not Nemryn platform docs. |
| `docs/product/public-marketing-separation.md` | **LIVING PLATFORM SPEC** | `REVIEW@DOCS` — its logic (separate marketing repo, synced tokens) carries straight to Nemryn ([`08`](./08-marketing-vs-application.md) §6). |
| `docs/brand/nemryn/*` (this folder) | **LIVING PLATFORM SPEC** (born Nemryn) | maintained going forward. |
| `README.md`, `CLAUDE.md` (if present) | **LIVING PLATFORM SPEC** | `REVIEW@DOCS`. |

The docs pass is a **separate, later, explicitly-scoped effort**. It is not part
of the application rebrand and is not on the critical path to `app.nemryn.com`.

---

## 12. Domain / infrastructure

| # | Item | Current | Future | Phase | Risk |
|---|---|---|---|---|---|
| 67 | Production domain | `app.zenwardmobility.com` | `app.nemryn.com` (marketing: `www.nemryn.com`) | **domain-migration only** (separately authorized, last step) | HIGH |
| 68 | Hosted Supabase Auth URL config (Site URL, Redirect URLs) | Zenward domain | Nemryn domain | domain-migration | HIGH |
| 69 | Hosted Supabase "Confirm signup" email template | links to `/auth/confirm` on the Zenward domain | Nemryn domain + "Nemryn account" wording (sync with row 58) | domain-migration | HIGH |
| 70 | `NEXT_PUBLIC_APP_URL` / deployment env | Zenward domain | Nemryn domain | domain-migration | HIGH |
| 71 | Vercel project name (`zenward-app-staging` per prior reports) | Zenward-named | cosmetic; rename if desired, no functional effect | domain-migration or later | LOW |
| 72 | DNS | Zenward | Nemryn + redirect from old domain for a defined window | domain-migration | HIGH |

**Domain ownership / registrar status for `nemryn.com`: HUMAN VERIFICATION
REQUIRED** ([`11`](./11-brand-lock-v1.md) §20). Nothing in G1 asserts Nemryn owns
the domain. No DNS / env / Supabase change in G1.

---

## 13. Summary counts

| Category | Count |
|---|---|
| Source files with a "Zenward" string (`src/` + `public/` + `supabase/`) | ~24 files, ~45 lines |
| — PLATFORM copy/metadata to become Nemryn | ~18 |
| — TENANT strings to keep as Zenward Mobility | ~8 |
| — HISTORICAL comments to leave | ~10 |
| Logo asset (tenant) | 1, referenced from 6 platform surfaces |
| Token file (`globals.css` `@theme`) | 1, consumed by ~38 component files; `brand-interactive-teal` alone = 46 usages needing a per-site split |
| Hard-coded brand hex in components | **0** |
| Schema / RLS / tenancy / migration brand coupling | **0** |
| `docs/**` files mentioning "Zenward" | ~106 — **out of scope for the app rebrand**; separate docs pass |
| Email templates (local + hosted) | 2 (must be synced; hosted via Dashboard, never `config push`) |
| Highest-risk items | token migration (`brand-interactive-teal` split, font swap, semantic-family meaning re-check) and domain-migration (auth/Supabase/DNS) |

**Overall:** the application rebrand is **concentrated and tractable** — one token
file, one logo asset, ~30 copy/metadata strings, two email templates. The genuine
work is (a) the purpose-based token split and per-component review, (b) the
platform-vs-tenant classification (done here), and (c) sequencing the shell → module
→ domain phases so production is never half-branded. **No database, RLS, tenancy,
or security change is involved anywhere in the visual rebrand.**
