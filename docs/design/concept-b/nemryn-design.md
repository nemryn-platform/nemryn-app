# Nemryn UI Design System — Concept B (Refined)

**Version:** 1.0, approved visual direction for Operations Overview  
**Source:** User-approved refined Concept B mockup, October 18, 2026  
**Scope:** UI/UX presentation and interactions. **Not** a production implementation authorization.

## Canonical visual direction

- Rich, premium, calm enterprise transportation operations UI; refined rather than decorative.
- Preserve **the actual approved Nemryn brand logo and assets** in the product. The prototype uses a **missing-asset-safe slot** `./assets/nemryn-logo-approved.svg`; until the canonical SVG is supplied, it shows a neutral text-only fallback with an explicit warning, **not a redesigned mark**. Do **not** redraw the brand mark from the mockup.
- Dark slate/teal navigation; off-white cool canvas; restrained teal CTA and active indicators; mint and warm sand used sparingly as semantic section accents.
- Serif-style display headings appear in the visual mockup. This is a **proposed UI heading treatment**, not a branding change; verify against existing approved Nemryn typography before implementation.
- The landscape motif in the approved mockup is decorative onboarding artwork. It should not displace real data, become mandatory across pages, or be mistaken for a required external asset.

## Proposed design tokens (review against existing tokens before replacing)

| Token | Value | Intended use |
|---|---|---|
| `--shell` | `#112632` | Sidebar base |
| `--shell2` | `#193744` | Sidebar depth |
| `--ink` | `#152C3B` | Primary text |
| `--muted` | `#66798A` | Supporting copy |
| `--teal` | `#006E69` | Primary actions |
| `--teal2` | `#0B877E` | Interactive accents |
| `--line` | `#DAE5E9` | Borders/dividers |
| `--bg` | `#F3F8FA` | Main canvas |
| `--mint` | `#E6F6F2` | Success/soft highlight |
| `--sand` | `#FCF5EB` | Attention section surface |

These are mockup-level proposals, not a unilateral replacement of approved product design tokens. Contrast and brand QA are required.

## Shell

- Desktop sidebar: approx. `245px` in prototype. Sections: Overview, Requests, Trips, Dispatch, Tomorrow, Recurring Care, Passengers, Facilities, Drivers, Fleet, Growth nested navigation, Drive, Settings.
- Keep the user/workspace footer and existing role-based visibility. Group Growth without changing routes or eligibility.
- Active row: filled, slightly lighter slate with slim teal left indicator. No double stroke.
- Desktop canvas: generous but controlled spacing; narrower on tablet/mobile. At <=740px use a drawer sidebar.
- Header: contextual greeting as optional presentation, page title, date, primary `New Trip`, secondary `Export Day Sheet`, utilities only where features truly exist.
- Do not invent an account-wide search or live operational service-state indicator merely because it appears in a mockup.

## Operations Overview — page hierarchy

1. Title: `Today’s Operations`, contextual date, live existing page actions.
2. `Finish setting up`: collapsible onboarding progress; show exact completion count derived from the actual checklist; completed steps must reflect real persisted state.
3. `Operations Brief`: compact tiles for supported operational facts, not ornamental counters.
4. `Get started`: existing onboarding actions and settings routes.
5. `Requests awaiting review`: incoming review count, oldest request date, accepted-but-unarranged status, existing review action.

**Critical screenshot reconciliation:** the supplied live screenshot reported **Business profile, First vehicle, Driver setup and First passenger completed**; **First facility and First trip incomplete**. The generated mockup visually switched facility/passenger completion. Production must preserve the **real computed state**, not the generated image. Similarly the prototype's number labels are illustrative snapshots only, never hard-coded production data.

## Components

- Cards: white or softly tinted elevated surfaces, 1px subtle borders, ~12–14px radius, light low-contrast shadows, 18–24px padding.
- Primary buttons: high-contrast deep teal filled, `40–44px` tall. Secondary buttons: bordered white. Both require focus, hover, disabled, loading and error states.
- Status chips: distinguish meaning using text, icon and color; don't use color alone.
- Status tiles: compact, with actual labels and grounded values; clickable only if an existing destination exists.
- Data rows: clear icon, text hierarchy and predictable affordance. Keep semantics readable at 200% zoom.
- Desktop: two-column lower panels and four quick summary tiles when space permits. Tablet: two quick tiles and stacked content panels. Mobile: 2 quick tiles and stacked panels, with a drawer navigation.
- Empty/loading/error/permission-denied states must be designed before production integration. No sample records or fake counts in the live product.

## Prototype interactions

The standalone HTML contains functioning presentational interactions: mobile navigation open/close, Growth group collapse, setup card collapse, accessible button focus styles, modal-like action information drawer, and Escape/backdrop close. Actions deliberately open a **prototype-only informational drawer**, rather than editing real production data or silently faking navigation.

During production integration, map each affordance to the **existing** route/action, preserving permissions, lifecycle state, error handling and tenant isolation. Any unsupported affordance must be removed or explicitly approved as a separate product feature.

## Build controls for Claude Code

1. Start with an inventory of existing shell components, CSS tokens, brand assets, breakpoints, routes, button handlers, setup status selectors, Requests source data and role/entitlement guards.
2. Provide a change map before implementation; no schema, migration, API-contract, tenant/RLS, entitlement, authentication or workflow changes.
3. Work against the approved visual reference `nemryn-approved-concept-b.png` plus this design file and the functional HTML reference. Avoid treating visual placeholder content as data requirements.
4. Implement shell and Overview presentation in controlled, reversible steps. Keep actual Nemryn icons and logo assets.
5. Validate real onboarding completion order and count. Preserve request review and trip creation actions. Check graceful 0-data, loading, error and unauthorized states.
6. Validate at desktop (~1440px), tablet (~900px), phone (~390px), keyboard-only and 200% zoom; check WCAG AA contrast.
7. Run relevant lint/typecheck/tests; inspect actual route behavior. Require explicit approval before merge/deploy.
8. Write a plain-text completion report at `docs/reports/nemryn-ui-operations-overview.txt`, including changed files, tests, screenshots, deviations and outstanding issues.

## Approval state

- **Approved:** refined Concept B as Operations Overview **visual direction**.
- **Not yet approved:** exact UI tokens as globally canonical, serif heading adoption globally, responsive behavior in production, further module redesign, production code changes.
- Design future Growth Dashboard, Pipeline and Settings pages as independent visual reviews using the same approved direction.


## Locked-logo protection — mandatory implementation gate

**Do not treat the mockup as a logo specification.** The mockup's stylized N, the prototype text fallback, and any decorative artwork are NOT authoritative brand sources.

1. Find the currently approved canonical Nemryn logo in the production repository and identify the original file path, dimensions, viewBox, color variants, and current rendered usages. Inspect the existing application code; do not guess filenames or regenerate vectors.
2. Compare the existing asset against known approved usage in the live product. If there are multiple candidates, inconsistent assets, or no clearly canonical asset, **STOP and request owner confirmation** before changing any branded header.
3. Reuse the existing canonical asset/component unchanged. No SVG path edits, tracing, recoloring, distorting, cropping, replacing the symbol with an N, or generating derivative brand marks. Preserve aspect ratio and minimum clear space.
4. Reference the approved asset from its actual repo path rather than assuming the prototype's placeholder path is deployed. The placeholder path `./assets/nemryn-logo-approved.svg` exists only as a wiring contract; the asset is deliberately **not included** in this package.
5. Inventory logo usages: main shell, collapsed sidebar, auth, marketing/landing, favicon, email, and other visible product surfaces. Do not change any unrelated logo surfaces under this UI phase.
6. Verify desktop/mobile brand rendering with screenshots before sign-off. Confirm no prototype fallback or broken image remains in production.
7. Existing server-side tenant isolation, roles, feature flags, RLS, route behavior, and database contracts are unchanged.

**Data accuracy gate:** The source screenshot shows 4 of 6 complete (Business profile, First vehicle, Driver setup, First passenger). The illustrated design mistakenly marks First facility complete rather than First passenger. Production must derive both chips and count from real application state; do not hardcode either version.

**Hard-stop conditions:** Cannot identify authoritative logo; implementing the layout requires API/schema changes; a navigation item lacks a real destination/permission; a status or metric cannot be supported from existing data. Escalate rather than invent a behavior.
