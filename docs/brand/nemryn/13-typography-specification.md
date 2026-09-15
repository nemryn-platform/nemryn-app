# Nemryn — Typography Specification

**Phase:** NEMRYN G1-B
**Status:** Finalized scale. **No CSS. No `next/font` change. No `src/design/typography.ts` change. No dependency change.** Values become real only in the token-migration phase.
**Date:** 2026-09-07
**Depends on:** [`06-typography-system.md`](./06-typography-system.md) (roles), [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §10 (font LOCKED), [`04-visual-direction.md`](./04-visual-direction.md)

---

## 1. Fonts (LOCKED)

| Token | Family | Stack (direction) | Weights loaded |
|---|---|---|---|
| `font.sans` | **Geist Sans** | `"Geist Sans", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif` | 400, 500, 600 (add 700 only if a marketing display weight genuinely needs it) |
| `font.mono` | **Geist Mono** | `"Geist Mono", "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace` | 400, 500 |

- **Geist Sans** is the typeface for the product **and** marketing.
- **Geist Mono** is used **selectively** (§6). It is not a body or UI face. The
  product must not read as a developer tool.
- `Inter` is the metric-adjacent fallback (already loaded in the app today), so
  the swap has minimal layout shift. IBM Plex Mono / JetBrains Mono are the mono
  fallbacks.
- Loading (migration-phase detail, not now): self-hosted or `next/font` with
  `display: swap` and a size-adjusted fallback so there is no CLS and no
  invisible-text flash.
- All sizes below are in **rem** (root = 16px) so the reader's browser/OS
  font-size preference scales the whole system. px equivalents are shown for
  reference only.

---

## 2. Principles that shape the scale

1. **Avoid oversized application headings.** The operations UI is a workspace,
   not a landing page. The largest routine app text (`type.app.pageTitle`) is
   `1.5rem` / 24px — not 32–40px.
2. **The marketing display scale must not leak into the application.**
   `type.marketing.display` (and the whole marketing scale above `heading`) is
   **forbidden** in `/operations`, `/driver`, and auth screens.
3. **Hierarchy from size + weight, not color.** Emphasis is `500`/`600`, never a
   color, rarely italic.
4. **Tight, consistent line-heights.** Operational density needs it; prose stays
   comfortable.
5. **Tabular figures for all operational numbers** (`font-variant-numeric:
   tabular-nums`) so columns align and live-updating digits don't jump.
6. **Bounded measure.** Prose blocks cap at ~68–75 characters.
7. **Sentence case everywhere** (wordmark + `NEMT` excepted). No ALL CAPS, no
   Title Case headings.

---

## 3. Marketing scale

Used only on the Nemryn marketing website. Generous, editorial.

| Token | Size (rem / px) | Line height | Weight | Tracking | Max measure | Use | Do NOT use for |
|---|---|---|---|---|---|---|---|
| `type.marketing.display` | 3.0 / 48 (→ 3.5 / 56 at ≥lg) | 1.05 | 600 | -0.02em | ~18 words | The single hero headline of a page. One per page. | Anything in the application. Section headings. Decorative large text. |
| `type.marketing.heading` | 2.0 / 32 | 1.15 | 600 | -0.01em | ~40 chars | Major section headings on a marketing page. | Application. Repeated as a stylistic device. |
| `type.marketing.subheading` | 1.25 / 20 | 1.3 | 500 | 0 | ~50 chars | Sub-headings within a section; the line under a hero headline. | Body copy. |
| `type.marketing.body` | 1.125 / 18 | 1.6 | 400 | 0 | ~70 chars | Marketing prose. Slightly larger than app body for reading comfort. | Dense UI. Tables. |
| `type.marketing.small` | 0.9375 / 15 | 1.5 | 400 | 0 | ~75 chars | Captions, footnotes, disclosure text, footer. | Primary reading content. |

Marketing weight range: 400–600. A `700` is permitted only on `display` if the
final wordmark/type pairing needs it — decide in G1-C.

---

## 4. Application scale

Used in `/operations`, `/driver`, auth, onboarding, settings. Compressed,
functional, dense-but-legible.

| Token | Size (rem / px) | Line height | Weight | Tracking | Max measure | Use | Do NOT use for |
|---|---|---|---|---|---|---|---|
| `type.app.pageTitle` | 1.5 / 24 | 1.25 | 600 | -0.01em | — | The one title of a screen (e.g. "Operations Brief", "Trip 4471"). One per view. | A second heading on the same screen. Marketing. Decoration. |
| `type.app.sectionHeading` | 1.125 / 18 | 1.33 | 600 | 0 | — | Major divisions within a screen (a panel group, "Today", "Tomorrow"). | Card titles (use subheading). Every list group. |
| `type.app.subheading` | 0.9375 / 15 | 1.4 | 600 | 0 | — | Card titles, grouping labels within a section, the label on a readiness block. | Body text. |
| `type.app.body` | 0.875 / 14 | 1.5 | 400 | 0 | ~68 chars | Default reading text in the app. Trip details, descriptions, notes. | Table cells at high density (use `bodySmall`/`data`). |
| `type.app.bodySmall` | 0.8125 / 13 | 1.45 | 400 | 0 | ~70 chars | Secondary/dense body — supporting detail in a panel, secondary line in a list row. | Primary content a user must read carefully at length. |
| `type.app.label` | 0.8125 / 13 | 1.3 | 500 | 0 | — | Form field labels, table column headers, chip text, the key in a key/value pair. Sentence case. | Values. Buttons (use `button`). |
| `type.app.caption` | 0.75 / 12 | 1.4 | 400 | 0 | ~75 chars | Timestamps, metadata, helper text under a field, "last updated" lines. Muted color (`text.subtle`). | Anything a user needs to act on. Error messages (use `bodySmall` + `status.critical.foreground`). |
| `type.app.button` | 0.8125 / 13 | 1 | 500 | 0 | — | Button and interactive-control labels. Sentence case. Never ALL CAPS. | Non-interactive text. |
| `type.app.data` | 0.8125 / 13 | 1.4 | 400 (500 for emphasis) | 0 | — | Numbers and identifiers in tables and readouts. `font-variant-numeric: tabular-nums`. May render in `font.mono` where column alignment or digit ambiguity matters (see §6). | Prose. Headings. |
| `type.app.numeric` | 1.75 / 28 | 1.1 | 600 | -0.01em | — | The single headline number of a view ("14 trips today" on the Operations Brief). `tabular-nums`. **Rare.** | Stat-card walls (banned — [`04`](./04-visual-direction.md) §12). More than one per view. Any number that isn't the view's headline. |

Application weight range: **400–600**. `700` is not used in the application.

### Relationship to the current app

The app's `src/design/typography.ts` already encodes this shape
(`pageTitleMarketing` vs `pageTitleOperational`, a fixed class per role). Nemryn
keeps the pattern. The main **changes**:

- family: Manrope/Inter → Geist Sans (single family);
- `type.app.pageTitle` drops from the app's current `text-3xl` (30px) to
  **24px** — deliberately smaller (principle §2.1);
- `display` is marketing-only and explicitly forbidden in the app;
- `data`/`numeric` get explicit `tabular-nums` and an optional mono rendering.

---

## 5. Line-length and layout rules

- Prose (`marketing.body`, `app.body`): hard cap the measure with `max-width`
  (~`34rem` marketing, ~`30rem` app) — never let a paragraph run the full width
  of a wide panel.
- Table cells, form fields, and data readouts have no measure cap — they follow
  the column.
- Never letter-space body text. Negative tracking only on `pageTitle`,
  `marketing.display`, `marketing.heading`, `app.numeric`.
- Headings are not centered in the application. Marketing may center a hero.
- No text is set in pure `#000` or on pure `#FFF` outside a content surface — see
  the color tokens ([`12`](./12-design-token-specification.md) §2.2).

---

## 6. Geist Mono — exact scope (LOCKED direction)

Use `font.mono` **only** where monospacing measurably helps operational scanning:

| Use | Token | Why mono |
|---|---|---|
| Trip / request identifiers (`Trip 4471`, `Request 8820`) | `type.app.data` in `font.mono` | Fixed-width digits scan as a column; distinguishes an ID from prose. |
| Precise times in dense tabular contexts (a dispatch grid, a manifest) | `type.app.data` in `font.mono` | `09:15` / `14:05` align; the colon sits consistently. |
| Technical/system values — an API key prefix in settings, a config value, a diagnostic code | `type.app.data` / `type.app.caption` in `font.mono` | Unambiguous characters (`0`/`O`, `1`/`l`). |
| Numeric columns in a data table where values must align on the decimal | `type.app.data` in `font.mono` (or `font.sans` with `tabular-nums` if the sans column already aligns) | Alignment. |

Do **NOT** use `font.mono` for:

- body copy, labels, headings, buttons, navigation;
- times shown conversationally in prose ("pickup at 9:15");
- the `numeric` headline on the Operations Brief (`font.sans` + `tabular-nums`);
- "to look technical". Nemryn is infrastructure-grade, not a terminal.

If in doubt, use `font.sans` with `tabular-nums`. Mono is the exception, not a
second body face.

---

## 7. Accessibility

- Smallest text is `type.app.caption` at 12px / 0.75rem; at its muted color
  (`text.subtle` `#646A70`) it is **4.5:1+ on `surface.app`** ([`12`](./12-design-token-specification.md) §10.2). It must not drop below 12px or onto the Soft Stone surface at that color.
- Everything scales with root font size (rem). Support **200% zoom** with no
  horizontal scroll on content (the app's responsive rules already push this).
- Nothing conveys meaning by weight or family alone — pair with text/labels.
- `prefers-reduced-motion` doesn't affect type; text must not animate in anyway
  ([`04`](./04-visual-direction.md) §18).
- Respect `prefers-contrast: more` at migration time by allowing `text.secondary`
  / `text.subtle` to step up to `text.primary` — note for the token phase, not a
  G1-B deliverable.

---

## 8. Still open

- The exact `type.app.numeric` **usage threshold** ("when is a number the
  headline") — needs real Operations Brief / dispatch screens.
- Whether a marketing `700` weight is loaded (depends on the G1-C wordmark/type
  pairing).
- Optical-size / variable-font axis usage if Geist's variable build is adopted
  (migration-phase optimization).
- Final confirmation that Geist Mono's metrics pair acceptably with Geist Sans at
  `type.app.data` size in a real dispatch grid (component review).
