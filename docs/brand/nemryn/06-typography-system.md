# Nemryn — Typography System

**Phase:** NEMRYN G1-A (font LOCKED, scale SPECIFIED in G1-B)
**Status:** As of G1-B: the font is **locked** (§1). The finalized scale (sizes, line heights, weights, usage) lives in [`13-typography-specification.md`](./13-typography-specification.md). Still no font-dependency change, no `next/font` change, no `typography.ts` change, no `globals.css` change.
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** [`04-visual-direction.md`](./04-visual-direction.md) · **Resolved by:** [`13-typography-specification.md`](./13-typography-specification.md)

---

## 1. Direction — LOCKED (G1-B)

**Font decision is locked: Geist Sans + Geist Mono.**

- **Geist Sans** — the single typeface for the entire product *and* marketing
  surfaces. One family; other cues (density, color, layout) distinguish the two
  surfaces.
- **Geist Mono** — used **selectively**, only where operational scanning genuinely
  benefits: identifiers (`Trip 4471`), precise operational times where useful,
  technical codes, and compact tabular/operational data where mono improves
  column alignment and digit legibility. **Not** a general body or UI face — the
  product must not acquire a developer-tool aesthetic.

Rationale:

- Nemryn is calm, precise, and infrastructure-grade. It does not need a display
  face for personality — the personality is in the restraint.
- A single family keeps marketing and application coherent.
- Geist is a modern, neutral, highly legible grotesque with a true monospace
  companion, and its metrics/tabular figures suit dense operational data.

This is a change from the current app (Manrope display + Inter body — a fine
system for Zenward Mobility). The switch to Geist happens only in the eventual
token/shell migration; **no dependency or font import is changed in G1-B**.

### If Geist becomes impractical at implementation time

This is locked, but if a genuine technical contradiction is found during the
migration (licensing, self-hosting, bundle size, metric fallback), document it
rather than silently swapping. The nearest acceptable fallback is **Inter**
(already loaded, neutral) with **IBM Plex Mono** or **JetBrains Mono** for the
mono role. Avoid Manrope (it's Zenward's) and geometric "friendly" faces.

## 2. Conceptual type roles

Nemryn defines roles by **purpose**, not size. Each role is a fixed combination
of family, size, line-height, weight, and letter-spacing — consumed as a token,
never improvised (the current app already works this way via `src/design/typography.ts`;
Nemryn keeps the pattern).

| Role | Purpose | Family | Weight | Character / direction |
|---|---|---|---|---|
| `display` | Marketing hero headline only | Geist Sans | Semibold–Bold | Large, tight tracking, tight leading. **Marketing surface only** — never appears in the application. |
| `pageTitle` | The title of a screen (app) or page (marketing) | Geist Sans | Semibold | One per view. Operational screens use a **restrained** size — this is a workspace, not a landing page. |
| `sectionHeading` | Major divisions within a screen | Geist Sans | Semibold | Clear step below pageTitle. |
| `subsectionHeading` | Grouping within a section; card titles | Geist Sans | Medium–Semibold | Small, quiet, structural. |
| `body` | Default reading text | Geist Sans | Regular | The baseline. Comfortable at operational density. |
| `bodySmall` | Secondary / dense body, supporting text | Geist Sans | Regular | For dense panels and secondary detail. |
| `label` | Form labels, field labels, table column headers, chip text | Geist Sans | Medium | Small, slightly tighter leading. Sentence case. |
| `caption` | Timestamps, metadata, helper text, footnotes | Geist Sans | Regular | Smallest text that still meets AA. Muted color (see [`05`](./05-semantic-color-system.md)). |
| `data` / `tabular` | Numbers and identifiers in tables and readouts | Geist Sans (tabular figures) or Geist Mono | Regular–Medium | **Tabular/monospaced figures required** so columns align and digits don't jump on live update. |
| `button` | Button and interactive control labels | Geist Sans | Medium–Semibold | Sentence case. Never all-caps. Consistent with `label` size or one step up. |
| `numericDisplay` | The single headline number of a view (e.g. "14 trips today") | Geist Sans | Semibold–Bold | Used **rarely** and only when a number is genuinely the headline. Not for stat-card walls (banned — see [`04`](./04-visual-direction.md) §12). Tabular figures. |

## 3. Marketing vs application typography

Same family, different behavior:

| | Marketing | Application |
|---|---|---|
| Scale | Larger, more contrast between roles; `display` in play | Compressed; `display` never used; `pageTitle` restrained |
| Line length | ~60–75 characters for prose | Whatever the data layout needs; prose kept ≤80ch |
| Leading | Slightly looser for reading comfort | Tighter for density |
| Weight range | Regular → Bold | Regular → Semibold (Bold reserved, rare) |
| Tracking | Tight on large headings | Near-normal everywhere; slight positive tracking only on small all-caps if ever used |

The current app already encodes this idea (`pageTitleMarketing` vs
`pageTitleOperational`). Nemryn keeps the concept.

## 4. Rules

1. **Sentence case everywhere.** Headings, buttons, labels, nav. No Title Case,
   no ALL CAPS (wordmark and defined acronyms like NEMT excepted).
2. **Weight and size carry hierarchy — not color.** Emphasis within body text is
   Medium weight, not a color and not italics (italics reserved for genuine
   citation/term-introduction, used rarely).
3. **One `pageTitle` per screen.** If you need two, the screen is two screens.
4. **Numbers in tables use tabular figures.** Non-negotiable for live-updating
   operational data.
5. **No letter-spacing on body text.** Track only large display headings
   (negative) — never positive-track running text for "style."
6. **Line length is bounded.** Prose blocks cap around 75–80 characters.
7. **Don't skip roles for effect.** `body` → `caption` is fine; `pageTitle` used
   as decoration on a small label is not.
8. **Respect the reader's settings.** Type scales with browser/OS font-size
   preferences; nothing is locked in px in a way that breaks zoom (the app should
   use rem-based sizing — confirm in token phase).
9. **Loading strategy:** self-hosted or `next/font` with `display: swap` and a
   correctly-metriced fallback so there is no layout shift and no invisible-text
   flash. (Implementation detail for the migration, not G1-A.)

## 5. Accessibility

- Minimum functional text size meets AA contrast at its intended color;
  `caption` at muted color must still pass 4.5:1.
- Nothing communicates meaning by typeface or weight alone where a non-sighted or
  low-vision user would miss it — pair with text.
- Support 200% zoom without horizontal scroll on content (the app's responsive
  rules already push this direction).
- `prefers-reduced-motion` does not affect type, but any text that animates in
  (it shouldn't, per [`04`](./04-visual-direction.md) §18) must respect it.

## 6. Status after G1-B

- **Decided:** font (Geist Sans + Geist Mono, §1); the conceptual roles (§2); the
  finalized scale — sizes, line-heights, weights, tracking, max line length,
  usage, and where-not-to-use — in [`13-typography-specification.md`](./13-typography-specification.md).
- **Still open:** the exact `numericDisplay` usage threshold ("when is a number
  the headline") needs real screens; whether `data` renders in tabular Geist Sans
  or Geist Mono is settled per-context in [`13`](./13-typography-specification.md)
  but may be revisited during component review.
- **Not touched:** dependencies, `next/font`, `src/design/typography.ts`,
  `globals.css`. The font swap is a migration-phase task.
