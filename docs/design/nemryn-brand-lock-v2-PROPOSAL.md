# Nemryn — Brand Lock v2 (PROPOSAL)

> **Status: SUPERSEDED (2026-10-21) by the approved, active [`16-brand-lock-v2.md`](../brand/nemryn/16-brand-lock-v2.md).** Kept as the
> decision record of the proposal; do not implement from this file.
>
> Original status: PROPOSAL — NOT AUTHORIZED FOR IMPLEMENTATION.
> [Brand Lock v1](../brand/nemryn/11-brand-lock-v1.md) remains the active, authoritative brand until the owner
> explicitly approves this document. Nothing here has been applied to the product.
>
> **The approved Nemryn logo is unchanged in every option.** That means `public/brand/*` (the inverse logo,
> inverse symbol, primary logo, favicon and app icon) is used exactly as-is: no recolouring, no redraw, no Concept
> B mockup "N".

- **Source:** the approved Concept B reference: `docs/design/concept-b/nemryn-approved-concept-b.png`, the
  prototype `nemryn-operations-overview.html` (exact CSS values below) and `nemryn-design.md`.
- **Date:** 2026-10-21.

## 0. What changes from v1, in one line

v1 is graphite / neutral with Geist only. v2 proposes:
- a deep slate shell with a teal action / accent colour;
- a cool off-white canvas;
- richer (tinted, raised, softly rounded) cards;
- a display-serif heading tier.

The logo, the semantic status meanings, functionality and architecture all stay.

Every v2 value below is either:
- **CB**: taken verbatim from the Concept B prototype; or
- **CB-adj**: the nearest Concept B hue adjusted to pass WCAG 2.2 AA (contrast measured; the ratios are listed).

## 1. Colour tokens (proposed)

| v2 token | Value | Source | Use | Contrast (measured) |
|---|---|---|---|---|
| `shell.background` | `#112632` | CB `--shell` | sidebar ground | white text 15.59:1 |
| `shell.gradient` | `linear-gradient(155deg,#112834,#132936 65%,#173c46)` | CB `.sidebar` | sidebar surface (optional; solid `#112632` fallback) | — |
| `shell.text.primary` | `#FFFFFF` | CB | active item, workspace name | 15.59:1 |
| `shell.text.secondary` | `#D3E1E7` | CB `.nav-link` | nav labels | 11.65:1 |
| `shell.text.muted` | `#9FB7C2` | CB-adj | section labels, roles | 7.44:1 |
| `shell.item.active.background` | `linear-gradient(90deg,#2F5262,#284353)` | CB `.nav-link.active` | active nav item | white 9.83:1 |
| `shell.item.active.marker` | `#44C9AA` | CB (inset 3px) | active marker bar | 7.56:1 on shell |
| `shell.item.hover` | `rgba(255,255,255,0.06)` | v1 (unchanged) | hover | — |
| `shell.focus` | `#7FB8FF` | CB-adj (new) | focus ring on the shell | 7.57:1 |
| `canvas` | `#F3F8FA` | CB `--bg` | main page background | — |
| `surface` | `#FFFFFF` | CB | cards, tables, inputs | — |
| `ink` (`text.primary`) | `#152C3B` | CB `--ink` | body / headings | 13.48:1 on canvas, 14.43:1 on white |
| `text.secondary` | `#3D5566` | CB-adj | descriptions | 7.29:1 on canvas |
| `text.muted` | `#5B6E7E` | **CB-adj** (CB `#66798A` = 4.20:1 on canvas, FAILS) | captions, metadata | 4.93:1 canvas, 5.28:1 white, 4.65:1 pill |
| `line` | `#DAE5E9` | CB `--line` | dividers, card borders (decorative) | non-text, decorative |
| `control.border` | `#738A97` | **CB-adj** (CB `#B8CBD4` = 1.68:1, FAILS 1.4.11) | input / select / outline-button borders | 3.61:1 white, 3.38:1 canvas |
| `action.primary` | `#006E69` | CB `--teal` | primary buttons (solid) | white text 6.11:1 |
| `action.primary.gradient` | `linear-gradient(120deg,#006D67,#005052)` | CB `.btn-primary` | primary buttons (optional) | white ≥6.1:1 |
| `action.primary.hover` | `#00605C` | **CB-adj** (CB `#0B877E` with white = 4.39:1, FAILS) | hover / pressed | white 7.43:1 |
| `text.link` / accent text | `#006E69` | CB | links, active text, selected states | 6.11:1 white, 5.71:1 canvas |
| `accent.soft` (mint) | `#E6F6F2` | CB `--mint` | positive / teal tinted panels, icon tiles | ink 13+:1 |
| `accent.sand` | `#FCF5EB` | CB `--sand` | attention-section surface (Requests panel) | `#946021` text 4.91:1 |
| `focus.ring` | `#006E69` (2px, offset 2px) | CB-adj | focus on light surfaces | 6.11:1 |

Status colours keep the v1 MEANINGS. Hues shift toward Concept B where noted; each is AA-checked:

| Status | Foreground | Background | Contrast |
|---|---|---|---|
| positive / ready | `#1F7A4D` | `#E6F6F2` | 4.77:1 |
| attention | `#7F5F24` (icon / text) | `#FFF0DF` | 5.27:1 (CB `#A16C2A` = 4.0:1, FAILS → adjusted) |
| information | `#2A66AD` | `#E7F0FF` | 5.08:1 |
| critical | `#A33B33` | `#FDECEB` | 5.69:1 |
| neutral pill | `#5B6E7E` | `#EDF1F4` | 4.65:1 (CB `#617584` = 4.22:1, FAILS → adjusted) |

**v1 rule that v2 changes:** "Primary CTA = Deep Graphite / Ink" becomes "Primary CTA = Teal `#006E69`".

**v1 rules v2 keeps:**
- signal colours are never decorative;
- status is never colour-only;
- Signal Green is never the CTA. Teal is a brand accent, distinct from the status green.

## 2. Typography

| Tier | v1 (active) | v2 proposal | Source |
|---|---|---|---|
| Display: page h1, setup title, section titles, card h3 | Geist Sans 600, 24 / 18 / 15 px | **Display serif**, h1 `clamp(28px,3vw,39px)` / lh 1.1 / tracking −1.15px; section titles 29px / −0.55px; setup title 31px; card h3 22px | CB `.head h1`, `.section-title`, `.setup h2`, `.panel h3` |
| UI / body | Geist Sans 400–600 | **Geist Sans unchanged** (body 14, labels 13, captions 12) | v1 |
| Data / IDs | Geist Mono, selective | unchanged | v1 |
| Buttons | 13px / 500 | 13px / **650** (600 in Geist) | CB `.btn` |

Display-serif options. **This needs an owner decision (D-1):**
- **A (recommended):** a self-hosted, OFL-licensed display serif, for example Source Serif 4 or Newsreader,
  loaded through `next/font/local`. It's a new font asset, so it needs approval; it's used for the display tier only.
- **B:** a system serif stack, `Georgia, "Times New Roman", serif` (exactly what Concept B uses). No new asset, but
  rendering is inconsistent on Android / Linux.
- **C:** no serif. Keep Geist and get the hierarchy from size / weight only. This is the furthest from Concept B.

Application rule kept from v1: the display tier never goes below 22px or into tables / forms / controls; body text
stays sans.

## 3. Shape, depth and spacing

| Token | v1 | v2 proposal | Source |
|---|---|---|---|
| `radius.control` (buttons, inputs, nav items) | 8px | **9px** | CB `.btn`, `.nav-link` |
| `radius.card` | 8px | **12px** (stat tiles), **13–14px** (setup / panels) → proposed `12px` and `14px` | CB `.metric`, `.setup`, `.panel`, `--radius` |
| `radius.pill` | full | full | — |
| `shadow.card` | `shadow-sm` | `0 5px 15px rgba(34,83,100,0.04)` | CB `.metric` |
| `shadow.panel` | `shadow-sm` | `0 8px 24px rgba(51,84,90,0.04)` | CB `.panel` |
| `shadow.hero` (setup card only) | `shadow-sm` | `0 11px 26px rgba(46,98,96,0.10)` | CB `.setup` |
| `shadow.button.hover` | none | `0 6px 12px rgba(23,57,67,0.08)` + translateY(−1px) (disabled under reduced motion) | CB `.btn:hover` |
| Spacing scale | zw 2–80 | unchanged; card padding 16–18 (tiles 14 × 16, panels 18) | CB |
| Button height | 40 (md) | **42** min | CB `.btn` |
| Nav item height | 36 | **39** min | CB `.nav-link` |

## 4. Component compositions (Concept B anatomy)

- **Sidebar (245px in CB; keep the approved 256px):**
  - the gradient shell;
  - the approved inverse logo (unchanged);
  - section groups (v1 grouping kept);
  - the active item with the gradient and 3px teal marker;
  - the workspace card;
  - a person row at the bottom.
- **Page header:**
  - display-serif h1 with the date (16px, muted);
  - right-aligned actions: secondary outline 42px, primary teal 42px;
  - no greeting by default (v1 decision kept, D-3);
  - no search unless a real search exists.
- **Setup / onboarding card:**
  - a tinted gradient surface (`linear-gradient(110deg,#EDFDFD,#FFF 55%,#E8F5F6)`) with border `#CBE2E7`,
    radius 13–14, the hero shadow;
  - a 31px serif title;
  - a segmented progress bar (teal done / line pending);
  - 6 step chips, each a 43px circle mark (`#92D6C8` border, `#F4FFFD` fill) with a 16px green check badge when done;
  - collapsible;
  - **no landscape artwork, no tagline** (v1 §17 kept).
- **Stat tiles:**
  - a white card, radius 12, the card shadow, min-height 77;
  - a 42px **circular** icon tile with a semantic tint (mint / amber / info);
  - a bold label over a muted detail;
  - a chevron when it is a link.
- **Panels:**
  - radius 14, padding 18;
  - a tinted gradient by meaning: teal / mint `linear-gradient(140deg,#F2FFFD,#F8FCFC 75%)` with border `#C1E0DF`;
    attention / sand `linear-gradient(130deg,#FFF9F2,#FFFDFB 80%)` with border `#F2D9B6`;
  - a 45px circular icon;
  - a 22px serif h3.
- **Pills:** 10px text, radius full, neutral / green variants (AA-adjusted colours above).
- **Tables / forms:** white surfaces on the canvas; borders `control.border`; teal focus and selection.

## 5. Responsive (from Concept B, mapped to the existing breakpoints)

| Range | Layout |
|---|---|
| ≥ 1100 | 4 stat tiles; 2-column panels; 6 setup steps in one row |
| 740–1099 | 2 stat tiles; panels stacked; setup steps in 3 columns |
| < 740 | Concept B uses a drawer sidebar. **Not adopted in v2-1..4.** The approved 390 notice remains until a separately approved mobile Operations phase (v1 D5). |

The existing 256 / 64 sidebar and tablet rail stay.

## 6. Unchanged by v2 (hard boundaries)

- the logo assets;
- functionality, routes, architecture, database contracts;
- authorization and tenant isolation;
- quotes and financial workflows;
- QA regression coverage (QA2 / P1a / P1b / quotes must stay green; only the visual assertions that encode v1 values
  change, by decision);
- status meanings;
- accessibility (AA);
- the marketing / application boundary (no artwork / taglines / fictional figures in the app).

## 7. Approval

The owner approves or amends §1–§5. The decisions are listed in
`docs/reports/NP-UI-V2-design-decision-review.txt`. On approval, this becomes Brand Lock v2: a new numbered
document; v1 is superseded, not edited.
