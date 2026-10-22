# Nemryn — Brand Lock v2

**Status:** **APPROVED — ACTIVE — V2.** Approved by the owner on 2026-10-21 (decisions D-1 to D-17, with the
recommendations recorded in `docs/reports/NP-UI-V2-design-decision-review.txt`).

**Precedence:**
- This file is the authoritative Nemryn brand lock.
- Where any document in `docs/brand/nemryn/` or `docs/design/` disagrees with it, this file wins.

**Supersedes:**
- [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) for palette, display typography, shape and depth. v1 is kept unedited
  as history.
- Every v1 rule not changed here still applies:
  - name;
  - category;
  - positioning;
  - platform vs tenant;
  - verbal identity;
  - terminology (§15 of v1);
  - status meanings;
  - the marketing / application boundary.

**Basis:**
- `docs/design/nemryn-brand-lock-v2-PROPOSAL.md` (the proposal, now superseded by this file);
- the approved Concept B reference: `docs/design/concept-b/nemryn-approved-concept-b.png`,
  `nemryn-operations-overview.html`, `nemryn-design.md`.

**First implementation:** NP-UI-V2-1 (`docs/reports/NP-UI-V2-1-implementation.txt`).

Tags:
- **LOCKED:** approved; change only by a new explicit owner decision.
- **DERIVED:** a mechanical consequence of a LOCKED decision, such as an AA-corrected value.

---

## 0. The logo: LOCKED, unchanged

The approved Nemryn assets in `public/brand/*` are used exactly as they are:
- the primary and inverse logo;
- the primary and inverse symbol;
- the wordmarks;
- the favicon and app icon.

Rules:
- No redraw, recolour, re-proportion or derivative mark.
- No use of the Concept B mockup "N".
- No operator logos.
- Every V2 release verifies the SHA-256 of `public/brand/*` against the recorded baseline.

## 1. Colour (LOCKED: D-2; values DERIVED where marked CB-adj)

Token names in `src/app/globals.css` are unchanged; only the values move.

| Role (token) | Value | Note |
|---|---|---|
| Shell ground (`chrome-background`) | `#112632` | solid fallback |
| Shell gradient (`bg-chrome-gradient`) | `linear-gradient(155deg,#112834,#132936 65%,#173C46)` | sidebar surface |
| Shell text: primary / secondary / muted | `#FFFFFF` / `#D3E1E7` / `#9FB7C2` | muted is CB-adj, 7.44:1 |
| Active nav (`bg-chrome-active`) | `linear-gradient(90deg,#2F5262,#284353)` | solid fallback `#2F5262`, white 8.39:1 |
| Active marker | `#44C9AA`, 3px inset | 4.07:1 on the active item; a brand accent, not "ready" |
| Shell focus (`chrome-focus`) | `#7FB8FF` | 7.57:1 on the shell, 4.07:1 on the active item |
| Canvas (`surface-app`) | `#F3F8FA` | plus a faint decorative glow (`bg-canvas-glow`) |
| Surface (`surface-elevated`) | `#FFFFFF` | — |
| Ink (`text-primary`) | `#152C3B` | 13.48:1 on canvas |
| Secondary text | `#3D5566` | 7.29:1 on canvas |
| Muted text | `#5B6E7E` | CB-adj (CB `#66798A` = 4.20:1, fails); 4.93:1 on canvas |
| Decorative line (`border-subtle`) | `#DAE5E9` | non-interactive dividers / card borders only |
| Control border (`border-strong`) | `#738A97` | CB-adj (CB `#B8CBD4` = 1.68:1, fails 1.4.11); 3.61:1 on white |
| Primary action | `#006E69` plus gradient `linear-gradient(120deg,#006D67,#005052)` | white 6.11:1 or more |
| Primary hover | `#00605C` (solid) | CB-adj (CB `#0B877E` = 4.39:1, fails); 7.43:1 |
| Link / accent text, focus ring on light surfaces | `#006E69` | 6.11:1 on white, 5.71:1 on canvas |
| Mint (`accent-soft`) / mint icon circle | `#E6F6F2` / `#DFF6F0` | get started / positive |
| Sand (`accent-sand`) | `#FCF5EB` | work awaiting review |
| Large teal figures (`accent-strong`) | `#005D58` | 7.76:1 |

Panel surfaces:
- **Mint:** gradient `linear-gradient(140deg,#F2FFFD,#F8FCFC 75%)`, border `#C1E0DF`.
- **Sand:** gradient `linear-gradient(130deg,#FFF9F2,#FFFDFB 80%)`, border `#F2D9B6`.
- **Setup hero:** gradient `linear-gradient(110deg,#EDFDFD,#FFF 55%,#E8F5F6)`, border `#CBE2E7`.

Status pairs: the meanings are unchanged from v1; the hues move toward Concept B and are AA-checked.

| Status | Text | Background | Ratio | Strong (icons, dots) |
|---|---|---|---|---|
| Positive / ready | `#1F7A4D` | `#E6F6F2` | 4.77:1 | `#07886C` |
| Attention | `#7F5F24` | `#FFF0DF` | 5.27:1 | `#B8741F` |
| Information | `#2A66AD` | `#E7F0FF` | 5.08:1 | `#3078D7` |
| Critical | `#A33B33` | `#FDECEB` | 5.69:1 | `#C9564D` |
| Neutral | `#5B6E7E` | `#EDF1F4` | 4.65:1 | — |

Rules:
- **Primary CTA:**
  - LOCKED: teal `#006E69`; replaces v1's Deep Graphite.
  - Teal is the brand accent and is never the positive status green.
  - Status is never colour-only.
- **Tints carry meaning, not decoration:**
  - mint = guidance / positive; sand = awaiting review; neutral otherwise.
  - The icon and text always state the meaning.
  - Print views stay neutral.
- **Gradients:**
  - only through the named utilities above;
  - no raw hex in pages or components.

## 2. Typography (LOCKED: D-1)

| Tier | Face | Size | Use |
|---|---|---|---|
| `displayPage` | Newsreader 700 | `clamp(28px,3vw,39px)`, lh 1.1, −0.025em | the one h1 of an Operations screen (`PageHeader`) |
| `displaySection` | Newsreader 700 | 29px | major dashboard section titles (Operations Brief) |
| `displaySetup` | Newsreader 700 | 31px | the setup hero heading |
| `displayCard` | Newsreader 700 | 22px | Overview panel titles |
| UI / body | Geist Sans | unchanged (14 / 13 / 12) | everything else |
| Buttons | Geist Sans | 13px / **600** | all buttons |
| Data | Geist Mono | unchanged | identifiers, where used |

Newsreader:
- **Source:** self-hosted from `src/app/fonts/newsreader/`. The upstream variable file is byte-identical; provenance is
  in its README.
- **Licence:** OFL 1.1.
- **Loading:** `next/font/local`, served from the build, with no runtime download.
- **Fallback:** Georgia (Concept B's reference face).

Never use the display face in:
- tables, forms or navigation;
- buttons or badges;
- operational values or identifiers;
- any size below 22px.

Clarification (V2-1 browser comparison):
- **Weight:** 700 matches Concept B's bold Georgia; 600 was visibly lighter.
- **Set width:** Newsreader is about 5% narrower than Georgia. This is accepted as the face's character.

## 3. Shape, depth, size (LOCKED: D-7)

**Radius:**

| Token | Value | Use |
|---|---|---|
| `rounded-xs` | 4 | focus ring, tiny chips |
| `rounded-sm` | 9 | buttons, inputs, nav items |
| `rounded-md` | 12 | cards, tiles, tables, menus |
| `rounded-lg` | 14 | major panels, dialogs, setup hero |
| pills | full | — |

**Shadow:**

| Token | Value |
|---|---|
| `shadow-sm` (card) | `0 1px 2px rgba(21,44,59,.04), 0 5px 15px rgba(34,83,100,.05)` |
| `shadow-panel` | `0 1px 2px rgba(21,44,59,.03), 0 8px 24px rgba(51,84,90,.05)` |
| `shadow-hero` | `0 11px 26px rgba(46,98,96,.10)` |
| `shadow-button-hover` | `0 6px 12px rgba(23,57,67,.08)` with translateY(−1px); enabled controls only, none under reduced motion |

**Sizes:**
- Standard button: 42px.
- Nav item: 39px.
- Icon circles: 42px (tiles), 45px (Overview panels), 43px (setup steps).

## 4. Compositions (LOCKED: D-3, D-4, D-5, D-6, D-8, D-9, D-15)

- **Shell:**
  - **Sidebar:**
    - 256px expanded, 64px rail (D-15; Concept B's 245px is not adopted);
    - the slate gradient;
    - grouped navigation;
    - the active gradient with the 3px teal marker;
    - the workspace card with a mint tile;
    - the person row.
  - **Header:**
    - white;
    - keeps the workspace / section context line (D-4);
    - real utilities only: no fake search, notification count or help.
- **Page header:**
  - the display h1 and the real date (16px muted);
  - secondary outline action, then the teal primary;
  - **no greeting** (D-3).
- **Setup hero (D-9):**
  - the hero gradient and a 31px display title;
  - teal segmented progress;
  - six 43px circular step marks, with a check badge when done and an empty badge when not;
  - a visible "Complete" / "Not complete" text under each step;
  - collapsible;
  - only while setup is incomplete;
  - the real checklist only;
  - **no landscape artwork, no tagline.**
- **Stat tiles (D-6, hybrid):**
  - 42px circle, white card, radius 12, min-height 77;
  - a number leads, followed by its label;
  - a text fact (such as the date) is a bold line;
  - a chevron only when there is a real destination.
  - A fresh workspace never shows a zero counter: "None waiting" or "Unavailable" instead.
- **Panels (D-8):**
  - radius 14;
  - 45px icon circle and a 22px display title;
  - mint for get started, sand for requests awaiting review, raised white for the rest.
  - Requests awaiting review:
    - a large real count;
    - fact rows;
    - a full-width teal "Review requests";
    - a right-aligned button when the panel spans a full row.
- **View switch (D-5):** the active segment is white, with teal text, a 2px teal underline and semibold weight.
- **Mobile below 740px (D-10):** the approved Operations notice stays; there is no drawer.

## 5. Responsive

| Width | Layout |
|---|---|
| ≥ 1100 | 4 tiles, 2-column panels, 6 setup steps in one row (container ≥ 64rem) |
| 740–1099 | 2 tiles, stacked panels, 3 setup steps per row |
| < 740 (Operations) | the approved notice |

## 6. Process (LOCKED: D-11, D-12, D-16, D-17)

- **D-11:** the Dispatch F-1 accessibility fix ships in V2-1.
- **D-12:**
  - only tests that assert superseded v1 values change: P1b B1, B2, S10b;
  - each one cites its decision;
  - behavioural, authorization, tenant and quote assertions never change.
- **D-16:**
  - four releases (V2-1 to V2-4);
  - each is one PR with an owner screenshot review;
  - each is followed by a read-only production check.
- **D-17:**
  - this numbered document is the active lock;
  - v1 is superseded, not edited.
- **D-13, D-14:** the Settings sub-navigation and the copy items are scheduled for V2-3.

## 7. Unchanged by v2

The following are outside this brand lock and do not change:
- functionality, routes and architecture;
- database contracts, RLS / RPC and authorization;
- tenant isolation;
- quotes and financial workflows, and print semantics;
- the QA regression coverage;
- the approved logo assets.
