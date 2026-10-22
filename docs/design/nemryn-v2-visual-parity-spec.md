# Nemryn v2 — Visual Parity Specification (Concept B)

> **Status: PROPOSAL.** It depends on [Brand Lock v2 (PROPOSAL)](./nemryn-brand-lock-v2-PROPOSAL.md) being
> approved. Brand Lock v1 is active. The approved logo stays unchanged throughout.

- **Compared:**
  - the approved Concept B (`docs/design/concept-b/nemryn-approved-concept-b.png` + prototype CSS);
  - current production (main `202c215`, verified 2026-10-21: `docs/reports/NP-UI-P2-production-closeout.txt`);
  - the isolated P2 captures (`docs/design/concept-b/reviews/p2/after/`).
- **Date:** 2026-10-21.

## 1. Gap analysis — what prevents Nemryn from matching Concept B

| # | Area | Concept B | Current production (v1) | Gap |
|---|---|---|---|---|
| G1 | Shell colour | Deep slate gradient `#112834→#173C46` | Deep Graphite `#171A1D`, flat | hue + gradient |
| G2 | Active nav | Gradient `#2F5262→#284353`, 3px teal `#44C9AA` marker, white 650 | Steel wash `rgba(111,135,152,.2)`, 2px steel marker `#A8BCC8` | colour + weight |
| G3 | Primary action | Teal `#006E69` (gradient), 42px, radius 9, hover lift | Graphite `#171A1D`, 40px, radius 8 | colour + size |
| G4 | Canvas | Cool off-white `#F3F8FA` | Mineral White `#F7F7F4` (warm) | temperature |
| G5 | Headings | Serif display h1 ~39px, section titles 29px, card h3 22px | Geist 24 / 18 / 15 | family + scale |
| G6 | Cards | Radius 12–14, soft tinted gradients (mint / sand), coloured borders, deeper soft shadows | Radius 8, white, neutral border, `shadow-sm` | radius + tint + depth |
| G7 | Icon tiles | 42–45px **circular**, semantic tints | 36–40px rounded squares, status `*-bg` washes | shape + size |
| G8 | Setup card | Tinted hero gradient, 31px serif title, 43px circular step marks with check badges, segmented teal progress | White card, 15px title, chip steps with small badges, green segments | composition + scale |
| G9 | Brief metrics | 4 tiles: circular icon, bold label + muted detail, chevron, min-height 77 | 4 StatTiles: square icon, 24px number over label | layout (CB is label-led; Nemryn is number-led) |
| G10 | Panels | Two-column "Get started" (mint) + "Requests awaiting review" (sand) with large count and full-width teal CTA | Same content as neutral raised cards; outline actions | tint + CTA treatment |
| G11 | Header | 56px utilities only (search / help / bell / avatar); the title lives in the page | 56px context line (workspace / section › area) + utilities | v1 keeps the context line (D-4) |
| G12 | Pills / badges | 10px, soft pastel | 12px StatusBadge with dot | size / tone |
| G13 | Growth / Settings / Auth | (CB covers Overview only; same language implied) | P1b primitives, not P2-refined; Growth list filters are bespoke; Settings hub layout | not yet aligned |
| G14 | Mobile (<740) | Drawer navigation | The approved 390 notice | out of scope (v1 D5) |

**Not gaps, deliberately excluded:** the Concept B mockup logo, the operator logo, the landscape artwork, the tagline
"A stronger community through better rides.", the greeting, fictional figures ("3 requests", "4 of 6"), "Service day
— Operations active" (no data source), and the vehicle / map-pin icons.

## 2. Target spec per surface (v2)

The values are those of the v2 proposal, §1–§5.

### 2.1 Shell (V2-1)
- **Sidebar:** `shell.gradient`; width stays 256 / 64 rail.
- **Nav items:** 39px min-height, radius 9, 13px, labels `#D3E1E7`, the active gradient + 3px `#44C9AA` marker.
- **Section labels:** `#9FB7C2`, sentence case.
- **Workspace card:** `rgba(255,255,255,.06)` fill, radius 9; an inverse-logo-free building tile.
- **Logo:** the approved inverse logo / symbol, unchanged.
- **Focus:** `#7FB8FF` on the shell.
- **Header:** white, a `line` bottom border, controls 40px; the context line is kept or removed per D-4.

### 2.2 Operations Overview (V2-1)
- **h1 "Today's Operations":** display serif `clamp(28px,3vw,39px)`; the date at 16px `text.muted`.
- **Actions:** outline Export Day Sheet (42px) and teal New Trip (42px).
- **Setup card:** the hero gradient, 31px serif title, a 235px progress block, 6 × 43px circular step marks.
  Completion is the real checklist only.
- **"Operations Brief":** a 29px serif section title, then the 4 metric tiles (CB anatomy, real facts only).
- **Panels:**
  - two columns at ≥1100;
  - Get started = mint panel;
  - Requests awaiting review = sand panel: a large real count, fact rows, and a full-width teal CTA "Review
    requests";
  - Needs Attention / Active Now / Next Departures = mint / neutral panels with 45px circular icons and 22px serif
    h3.

### 2.3 Core pages (V2-2)
Requests, Trips, New Trip, Trip / Request detail, Dispatch, Tomorrow Readiness, Standing Orders, Passengers,
Facilities, Drivers, Vehicles, Proof of Service:
- the serif h1;
- teal primary;
- the canvas `#F3F8FA`;
- FilterBar / tables on white, radius 12, `shadow.card`;
- ViewSwitch active = white + teal 2px underline or a teal text (D-5);
- the detail panels as v2 panels (radius 14, neutral variant);
- Dispatch queue cards radius 12, the grid panel radius 14;
- StatusBadge in the v2 pill tones.

### 2.4 Growth, Quotes, Settings, Auth (V2-3)
- Growth Dashboard / Pipeline / Contacts / Tasks: the same page anatomy, ViewSwitch + FilterBar adoption (as P2 did
  for Core).
- Quotes: visual only. The ZD-224 / 226 / 227 wording, banner and notice parity, and the print page all unchanged.
- Settings: a sub-navigation frame (the v1 roadmap D8, if approved).
- Auth: the canvas, the serif h1, a teal primary, and the approved primary logo.

## 3. Shared components to update (single source; no per-page overrides)

| Layer | Component(s) |
|---|---|
| Tokens | `src/app/globals.css` `@theme`: all §1 colours, radii, shadows. The token NAMES stay (`action-primary-*`, `chrome-*`, `surface-*`, `text-*`), so consumers move automatically. |
| Typography | `src/design/typography.ts`: a new `display*` roles for the h1 / section / card-title tiers, plus the font loading (D-1) in `src/app/layout.tsx` |
| Primitives | `Button` / `LinkButton` / `IconButton` (42px, radius 9, hover lift), `Panel` + `PanelHeader` (radius 14, tone gradients, circular 45px icon), `StatTile` (CB anatomy, D-6), `PageHeader` (display h1), `SectionHeader` (`size="section"` → 29px serif), `StatusBadge` (pill tones), `ViewSwitch`, `FilterBar`, `DataTable`, `Input` / `Select` / `Textarea` (`control.border`, teal focus), `Dialog` (radius 14), `EmptyState` |
| Shell | `OperationsSidebar`, `GrowthNavGroup`, `nav-styles.ts`, `AppHeader`, `AccountMenu` |
| Overview | `OnboardingChecklistBanner` (hero), `OperationsBrief` (CompactBlock → tinted panels; Requests CTA), `src/app/operations/page.tsx` |
| Auth | `src/components/auth/*`, `RouteState` |

## 4. Visual acceptance criteria (browser-screenshot based)

Evidence for every V2 step:
- real browser captures of the isolated app (fictional seed + the fixed fixtures of
  `scratchpad … qa2/capture.mjs`, to be promoted into `tests/e2e/qa2/visual-capture.mjs`);
- at 1440 / 1024 / 768;
- before and after with identical names;
- plus a contact sheet against `nemryn-approved-concept-b.png`.

Acceptance:
1. **Token parity:** computed styles equal the v2 values. A QA check reads `getComputedStyle` for the sidebar
   background, active item, primary button (bg / height / radius), canvas, h1 family / size, card radius / shadow,
   and the icon-tile shape.
2. **Composition parity:** Overview at 1440 contains, in order: the serif h1 + date + actions → the setup hero (only
   while incomplete) → the "Operations Brief" serif title → 4 tiles → the two-column panel grid (≥1100). Verified by
   DOM order and bounding boxes, not by eye.
3. **Overlay review:** a side-by-side contact sheet with the Concept B PNG for the Overview at 1440. The owner marks
   each G1–G12 row in §1 as matched / intentionally different. A visual diff score is informative only (data
   differs).
4. **No regressions:** QA2 strict, P1a, P1b, quotes strict and the SQL suites stay green. Assertions that encode v1
   visual values are updated in the same PR, with the decision reference; behavioural assertions are untouched.
5. **Accessibility:** axe 0 serious / critical on the 29-route sweep, including the Dispatch empty-grid case (F-1
   fixed first). All text pairs meet AA as tabulated in the proposal; focus is visible on the shell and the canvas;
   reduced motion disables the hover lift.
6. **Integrity:** no fictional values; the approved logo files are byte-identical (SHA-256 check of `public/brand/*`);
   there are no landscape artwork / tagline / greeting unless approved.
7. **Responsive:** no page overflow at 1440 / 1024 / 768; the CB tile / panel breakpoints honoured; the 390 notice is
   unchanged.
