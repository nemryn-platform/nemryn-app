# Nemryn — Design Token Specification

**Phase:** NEMRYN G1-B
**Status:** Implementation-grade **conceptual** token system. **No production CSS. No Tailwind config change. No `globals.css` change.** Hex values here are DERIVED from the LOCKED [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §8 primitives and WCAG-validated (§4, §6). They become real CSS custom properties only in the later token-migration phase.
**Date:** 2026-09-07
**Depends on:** [`05-semantic-color-system.md`](./05-semantic-color-system.md), [`04-visual-direction.md`](./04-visual-direction.md), [`11-brand-lock-v1.md`](./11-brand-lock-v1.md)

---

## 0. Conventions

- **Naming:** conceptual dot-notation (`surface.primary`, `status.ready.foreground`).
  In the eventual `@theme` block these map to kebab custom properties
  (`--color-surface-primary`, `--color-status-ready-foreground`) — the same Tailwind
  v4 mechanism the app uses today, with new names.
- **"light"** = the default context (Mineral White ground). **"inverse"** = the
  Deep Graphite chrome/dark context. Every color role that can appear in both
  contexts has a value for each.
- **Primitives** (`11` §8) are never consumed directly by components. Components
  consume the semantic roles below.
- **Contrast targets:** WCAG 2.1 AA — 4.5:1 body text, 3:1 large text (≥24px, or
  ≥18.66px bold) and meaningful non-text UI (input borders, focus rings, status
  graphics that carry meaning, the primary button against the page). Disabled
  text is exempt (WCAG 1.4.3 inactive-component exception) but is kept near 3:1
  anyway.
- All contrast ratios in this document were computed with the WCAG relative-
  luminance formula. The full check output is summarized in §4 and §6.

---

## 1. Primitives (LOCKED — reference only)

| Primitive | Hex |
|---|---|
| `primitive.graphite` | `#171A1D` |
| `primitive.ink` | `#23282D` |
| `primitive.mineralWhite` | `#F7F7F4` |
| `primitive.softStone` | `#E8E9E6` |
| `primitive.mutedSlate` | `#697179` |
| `primitive.signalGreen` | `#4FA57A` |
| `primitive.attentionAmber` | `#D79B45` |
| `primitive.criticalRed` | `#C95C55` |
| `primitive.steelBlue` | `#6F8798` |

Pure `#FFFFFF` is used as `surface.primary` in light (one hair above the Mineral
White ground); it is not a brand primitive, it is the content surface.

---

## 2. Color tokens

### 2.1 Surface

| Token | Light | Inverse | Purpose |
|---|---|---|---|
| `surface.app` | `#F7F7F4` | `#171A1D` | The page ground. The quietest surface. Never pure white / pure black. |
| `surface.primary` | `#FFFFFF` | `#1E2226` | Where content and data sit — panels, tables, forms, cards. One hair above the ground. |
| `surface.secondary` | `#E8E9E6` | `#23282D` | Recessed areas, subtle grouping fills, optional table zebra. |
| `surface.raised` | `#FFFFFF` | `#272C31` | Menus, popovers, dropdowns — same as primary but paired with `shadow.raised`; the shadow, not a fill change, signals "raised" in light. |
| `surface.inverse` | `#171A1D` | `#0F1214` | The frame: primary navigation, deliberately high-contrast operational headers/command bars. In light context this is the dark chrome; in inverse context it is one step deeper than the ground. **Never a reading surface for body content.** |

### 2.2 Text

| Token | Light | Inverse | Purpose | Contrast (worst case) |
|---|---|---|---|---|
| `text.primary` | `#171A1D` | `#F7F7F4` | Default reading text, headings. | 16.3:1 on `surface.app`; 15.4:1 on status washes — AAA |
| `text.secondary` | `#525A61` | `#AAB1B7` | Supporting text, secondary detail, metadata that must stay readable. | 6.5:1 on `surface.app`, 5.8:1 on `surface.secondary` — AA (AAA on white) |
| `text.subtle` | `#646A70` | `#8A9299` | Tertiary text: timestamps, captions, helper text, low-priority metadata. | 5.1:1 on `surface.app`; 4.5:1 on `surface.secondary` (borderline — prefer `text.secondary` for small text on `surface.secondary`) |
| `text.disabled` | `#8A9096` | `#5A6167` | Genuinely inactive text/controls only. | ~3.0:1 (WCAG-exempt; kept near 3:1) |
| `text.inverse` | `#F7F7F4` | `#F7F7F4` | Text on a dark fill — the primary-button label, text on `surface.inverse`. | 16.3:1 on `#171A1D` — AAA |
| `text.link` | `#37556B` | `#A8BCC8` | Interactive text. A deepened steel — **not** Signal Green, **not** a new hue. Always underlined or otherwise non-color-coded as well. | 7.9:1 on white, 7.3:1 on `surface.app` — AAA |

### 2.3 Border

| Token | Light | Inverse | Purpose | Contrast |
|---|---|---|---|---|
| `border.default` | `#DCDDD9` | `rgba(255,255,255,0.10)` | The hairline — the workhorse separator. Decorative separation; **exempt** from 3:1. | ~1.3:1 (intentional — a hairline, not a meaningful boundary) |
| `border.strong` | `#868B85` | `rgba(255,255,255,0.24)` | Meaningful boundary: input/control border, selected-row edge, focused container, the edge of an editable region. Meets **3:1** where it carries meaning. | 3.5:1 on white, 3.2:1 on `surface.app` (on `surface.secondary` it is ~2.9:1 — avoid strong borders on that surface, or darken locally) |
| `border.focus` | `#37556B` | `#A8BCC8` | The single keyboard-focus ring color, product-wide. Never removed without an equal replacement. | 7.9:1 / 7.3:1 (light); ≥7:1 (inverse) — well past 3:1 |

### 2.4 Action (controls)

**Primary action is a neutral, high-contrast graphite treatment — never Signal
Green** ([`11`](./11-brand-lock-v1.md) §9).

| Token | Value (light) | Value (inverse) | Notes |
|---|---|---|---|
| `action.primary.background` | `#171A1D` | `#F7F7F4` | Filled. In inverse context the primary button inverts to a light fill. |
| `action.primary.foreground` | `#F7F7F4` | `#171A1D` | 16.3:1 on its background — AAA. |
| `action.primary.hover` | `#23282D` | `#E8E9E6` | Background on hover/active. Foreground unchanged (13.9:1 — AA). |
| `action.primary.disabled.background` | `#DCDDD9` | `rgba(255,255,255,0.12)` | — |
| `action.primary.disabled.foreground` | `#8A9096` | `rgba(247,247,244,0.4)` | Exempt. |
| `action.secondary.background` | `transparent` | `transparent` | Outline / ghost button. |
| `action.secondary.foreground` | `#23282D` | `#F7F7F4` | 14.9:1 on white — AAA. |
| `action.secondary.border` | `#868B85` | `rgba(255,255,255,0.24)` | 3.2:1 — meets non-text 3:1. |
| `action.secondary.hover` | `#F1F1EE` | `rgba(255,255,255,0.06)` | Subtle background wash on hover. |
| `action.destructive.background` | `#A5352F` | `#E68F87` | Filled — **only for a genuinely destructive confirm** (permanent delete, cancel-all). Not the default style for any "delete" affordance; most destructive actions are `action.secondary` with `text.link` replaced by `status.critical.foreground` until the final confirm. |
| `action.destructive.foreground` | `#FFFFFF` | `#171A1D` | 6.7:1 on `#A5352F` — AA. |
| `action.destructive.hover` | `#8F2E29` | `#DB756C` | — |

There is **one primary action per view**. See [`04`](./04-visual-direction.md) §14.

### 2.5 Status

Each status has four sub-tokens. **Never rely on color alone** — every status is
`label` and/or `icon`/`shape` **plus** color ([`05`](./05-semantic-color-system.md) §5).

| Sub-token | Meaning |
|---|---|
| `.solid` | The dot, the left-edge bar, a small filled chip, the icon color when the icon is the status. Needs **3:1** against `surface.primary` / `surface.app`. |
| `.foreground` | Status text on a light surface (the wash or the page). Needs **4.5:1**. Darker than the primitive. |
| `.surface` | The subtle wash behind a status row / soft banner. Very light. `text.primary` and `.foreground` both stay AA on it. |
| `.onInverse` | The status color for text/graphics on `surface.inverse` (dark chrome, dark theme). Lighter than the primitive. |

| Status | `.solid` | `.foreground` (light) | `.surface` (light) | `.onInverse` | Primitive it derives from |
|---|---|---|---|---|---|
| `status.ready` | `#3C8A63` | `#22694A` | `#EAF3EE` | `#7FCFA6` | Signal Green `#4FA57A` |
| `status.attention` | `#B07A2B` | `#7A5312` | `#F9EFDF` | `#E8BE7C` | Attention Amber `#D79B45` |
| `status.critical` | `#C15048` | `#A5352F` | `#F8E9E7` | `#E68F87` | Critical Red `#C95C55` |
| `status.information` | `#5E7686` | `#37556B` | `#EBEFF2` | `#A8BCC8` | Steel Blue `#6F8798` |

Border for a status chip/banner: use `.solid` at the relevant weight, or a
`.solid`-derived hairline. Do not invent per-status border tokens.

> **Why the primitives are not used raw here:** Signal Green `#4FA57A` is 2.80:1
> on Mineral White (fails even 3:1 as a graphic), Attention Amber `#D79B45` is
> 2.26:1, Steel Blue is 3.50:1, Critical Red is 3.80:1. The `.solid` values above
> are darkened just enough to clear 3:1 as a meaningful graphic; the `.foreground`
> values are darkened further to clear 4.5:1 as text. The primitives remain the
> brand reference and the source of the hue.

### 2.6 Selection & focus

| Token | Light | Inverse | Purpose |
|---|---|---|---|
| `selection.background` | `#E7ECF0` | `rgba(111,135,152,0.22)` | Selected table row, active nav item, chosen option — a low-opacity wash of the steel accent. `text.primary` stays 14.7:1 on it. |
| `selection.border` | `#37556B` | `#A8BCC8` | The edge of a selected element where a wash isn't enough. Same as `border.focus`. |
| `focus.ring` | `#37556B` | `#A8BCC8` | Alias of `border.focus`. One ring, product-wide, 2px, 2px offset (matches the app's current focus treatment mechanic, new color). |
| `focus.ringWidth` | `2px` | `2px` | — |
| `focus.ringOffset` | `2px` | `2px` | — |

### 2.7 The inverse-chrome context set (workspace frame)

The application shell frame is `surface.inverse`. It carries the **Nemryn mark**
and the **current workspace name** ([`11`](./11-brand-lock-v1.md) §12). It needs
its own small text/border set (the app already has an equivalent "navy-surface"
set — this replaces it):

| Token | Value | Purpose | Contrast on `#171A1D` |
|---|---|---|---|
| `chrome.background` | `#171A1D` | The frame ground. | — |
| `chrome.text.primary` | `#F7F7F4` | Nav labels, the workspace name, the Nemryn wordmark in mono treatment. | 16.3:1 — AAA |
| `chrome.text.secondary` | `#AAB1B7` | Muted nav metadata, section labels. | 8.1:1 — AAA |
| `chrome.border` | `rgba(255,255,255,0.10)` | Dividers within the frame. | decorative, exempt |
| `chrome.item.hover` | `rgba(255,255,255,0.06)` | Nav item hover. | — |
| `chrome.item.active.background` | `rgba(111,135,152,0.20)` | Active nav item (steel wash, not green). | — |
| `chrome.item.active.text` | `#F7F7F4` | Active nav item label. | — |
| `chrome.item.active.marker` | `#A8BCC8` | The small active-indicator bar/dot (steel, informational — an active nav item is not a "ready" state). | ≥7:1 |

---

## 3. Typography tokens

Full scale (sizes, line-heights, weights, usage, where-not-to-use) is in
[`13-typography-specification.md`](./13-typography-specification.md). The token
*names* are:

| Token | Direction |
|---|---|
| `font.sans` | Geist Sans → (fallback stack: `"Geist Sans", "Inter", ui-sans-serif, system-ui, sans-serif`) |
| `font.mono` | Geist Mono → (fallback stack: `"Geist Mono", "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace`) |

Marketing roles: `type.marketing.display`, `type.marketing.heading`,
`type.marketing.body`, plus (from §13) `type.marketing.subheading`,
`type.marketing.small`.

Application roles: `type.app.pageTitle`, `type.app.sectionHeading`,
`type.app.subheading`, `type.app.body`, `type.app.bodySmall`, `type.app.label`,
`type.app.caption`, `type.app.button`, `type.app.data`, `type.app.numeric`.

Each is a fixed bundle of family + size + line-height + weight + tracking,
consumed as one token (the pattern `src/design/typography.ts` already uses).

---

## 4. Spacing tokens

A restrained scale. Base unit **4px**; rem-based so it respects the user's root
font size. Named — never bare numeric utilities in components (this also avoids
the Tailwind v4 `--spacing-*` / `--container-*` collision the app already
documents; keep a private prefix, e.g. `--spacing-nm-*`).

| Token | rem | px | Typical use |
|---|---|---|---|
| `space.0` | 0 | 0 | reset |
| `space.3xs` | 0.125 | 2 | hairline gaps, icon-to-text nudge |
| `space.2xs` | 0.25 | 4 | tight inline gaps, chip padding-y |
| `space.xs` | 0.5 | 8 | dense list row padding, label-to-field |
| `space.sm` | 0.75 | 12 | control padding, compact card padding |
| `space.md` | 1 | 16 | default block gap, card padding |
| `space.lg` | 1.5 | 24 | section gap, panel padding |
| `space.xl` | 2 | 32 | major section separation |
| `space.2xl` | 3 | 48 | page-level vertical rhythm (app) |
| `space.3xl` | 4 | 64 | marketing section padding (small) |
| `space.4xl` | 6 | 96 | marketing section padding (large) |

Nine steps for the application (`3xs`–`2xl`), plus `3xl`/`4xl` mainly for
marketing. Do not add half-steps; if a gap "needs" `18px`, the layout is wrong.
The app's current 4px base and named steps carry over conceptually; values are
close but re-anchored (no `80px` step; `96px` added for marketing).

---

## 5. Radius tokens

Restrained. Nemryn is precise, not soft.

| Token | px | Use |
|---|---|---|
| `radius.none` | 0 | tables edges, full-bleed elements, dividers |
| `radius.sm` | 4 | inputs, buttons, chips, small controls — the default |
| `radius.md` | 8 | cards, panels, popovers, dialogs |
| `radius.lg` | 12 | the largest allowed — a modal or a marketing feature card only |
| `radius.full` | 9999 | genuine pills only: status chips, avatars, count badges |

Three working values (`sm`/`md`/`lg`) + `none` + `full`. This is tighter than the
app's current `6/8/10/14`. No "friendly" large radii.

---

## 6. Shadow tokens

**At most two real elevations.** The border does the structural work; shadow only
marks genuinely floating layers.

| Token | Value (direction) | Use |
|---|---|---|
| `shadow.none` | none | content panels, cards on the page, table containers — **the default** |
| `shadow.raised` | `0 1px 2px rgba(23,26,29,0.06), 0 2px 6px rgba(23,26,29,0.10)` | menus, popovers, dropdowns, hover-cards — "slightly above the page" |
| `shadow.overlay` | `0 8px 24px rgba(23,26,29,0.16), 0 2px 8px rgba(23,26,29,0.10)` | dialogs, modals, sheets — "above everything" |

No colored shadows. No long/soft "floating" shadows. No shadow-on-hover as the
primary affordance. Shadow tint is graphite-based, matching the app's current
approach (re-anchored to the graphite primitive).

Overlay backdrop: `overlay.scrim` = `rgba(15,18,20,0.45)` (replaces the app's
current `rgb(15 23 42 / 0.45)` dialog backdrop).

---

## 7. Border (structural behavior)

- **Default separation is a single `border.default` hairline**, or whitespace —
  not both, not a full box.
- A **meaningful boundary** (input, selected row, editable-region edge, focused
  container) uses `border.strong` and meets 3:1.
- Borders are **neutral**. The only colored border is a **status** border, from
  `status.<x>.solid`, used sparingly.
- Standard border width: `1px`. A `2px` border is reserved for focus
  (`focus.ringWidth`) and the active/selected emphasis where 1px reads as weak.
- Tables: horizontal hairlines or generous row spacing — never heavy grid lines,
  never both. No vertical rules if columns are aligned.

---

## 8. Motion tokens

Motion is feedback, not personality ([`04`](./04-visual-direction.md) §18).

| Token | Value | Use |
|---|---|---|
| `motion.duration.instant` | `80ms` | micro-feedback (a toggle, a checkbox) |
| `motion.duration.fast` | `120ms` | most UI transitions — a menu open, a row highlight |
| `motion.duration.base` | `180ms` | a panel or drawer opening, a dialog |
| `motion.duration.slow` | `240ms` | the largest allowed — a full sheet transition |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | almost everything (matches the app's current `--ease-standard`) |
| `motion.easing.exit` | `cubic-bezier(0.4, 0, 1, 1)` | elements leaving |

No entrance animation on page load. No parallax. No spring/overshoot/bounce.
Everything must degrade to instant under `prefers-reduced-motion: reduce` (the
app already enforces this globally).

Live-updating operational data (dispatch, readiness) transitions **in place** at
`motion.duration.fast`, no flash of color unless the color change *is* the
information.

---

## 9. What this spec deliberately does NOT create

- No decorative token families: no gradient tokens, no glow/blur tokens, no
  "elevation 3/4/5", no accent-color ramp beyond the status derivations, no
  per-brand-color 50–900 scale.
- No `surface.brand` / `text.brand` colored-brand tokens — Nemryn's brand
  expression is neutral (§`11` §6). The only non-neutral roles are `status.*` and
  the single steel-derived `text.link` / `focus.ring` / `selection.*`.
- No z-index scale, no breakpoint tokens — those are layout concerns, resolved in
  component/layout work, not the brand token layer.
- No component-level tokens (`button.height`, `input.paddingX`) — those live with
  the components, composed from the primitives above.

---

## 10. Accessibility validation summary (Step 4)

Method: WCAG 2.1 relative-luminance contrast, computed for every derived value
against every surface it can appear on. Targets: 4.5:1 text, 3:1 large-text /
meaningful non-text, disabled exempt.

### 10.1 Primitives as text/graphics — the problem this spec solves

| Primitive | vs Mineral White | vs Soft Stone | vs Deep Graphite | Verdict as small text on light |
|---|---|---|---|---|
| Deep Graphite `#171A1D` | 16.28 | 14.33 | — | ✅ AAA |
| Ink `#23282D` | 13.85 | 12.19 | — | ✅ AAA |
| Muted Slate `#697179` | 4.62 | 4.06 | 3.53 | ⚠️ AA on Mineral White only; **fails on Soft Stone** |
| Signal Green `#4FA57A` | **2.80** | 2.46 | 5.82 | ❌ fails even 3:1 on light; OK on dark |
| Attention Amber `#D79B45` | **2.26** | 1.99 | 7.21 | ❌ fails even 3:1 on light; strong on dark |
| Critical Red `#C95C55` | **3.80** | 3.35 | 4.28 | ❌ fails 4.5:1 as text (passes 3:1 as a graphic) |
| Steel Blue `#6F8798` | **3.50** | 3.08 | 4.65 | ❌ fails 4.5:1 as text (passes 3:1 as a graphic) |

**Conclusion:** the phase brief's design concern is confirmed. None of the four
status hues is usable as small body text on Mineral White. Muted Slate is
marginal and must not be used for small text on the Soft Stone surface. Hence the
derived `.foreground` / `.solid` / `.onInverse` variants in §2.5 and the
`text.secondary` / `text.subtle` values in §2.2.

### 10.2 Derived values — verified (worst-case ratio shown)

| Token | Context | Ratio | Target | Result |
|---|---|---|---|---|
| `text.primary` `#171A1D` | on any light surface / wash | ≥14.8 | 4.5 | ✅ AAA |
| `text.secondary` `#525A61` | on `surface.secondary` `#E8E9E6` | 5.75 | 4.5 | ✅ AA |
| `text.subtle` `#646A70` | on `surface.app` `#F7F7F4` | 5.10 | 4.5 | ✅ AA |
| `text.subtle` `#646A70` | on `surface.secondary` `#E8E9E6` | 4.49 | 4.5 | ⚠️ borderline — spec rule: use `text.secondary` for small text on `surface.secondary` |
| `text.disabled` `#8A9096` | on `surface.app` | 3.01 | (exempt) | ✅ exempt, near 3:1 |
| `text.link` `#37556B` | on `surface.app` | 7.32 | 4.5 | ✅ AAA |
| `text.inverse` `#F7F7F4` | on `surface.inverse` `#171A1D` | 16.28 | 4.5 | ✅ AAA |
| `text.inverse` `#F7F7F4` | on `#23282D` | 13.85 | 4.5 | ✅ AAA |
| `border.strong` `#868B85` | on `#FFFFFF` / `#F7F7F4` | 3.47 / 3.24 | 3.0 | ✅ (avoid on `surface.secondary`: 2.85) |
| `border.focus` `#37556B` | on any light surface | ≥7.3 | 3.0 | ✅ |
| `action.primary` fg `#F7F7F4` on bg `#171A1D` | filled button | 16.28 | 4.5 | ✅ AAA |
| `action.primary` fg on hover bg `#23282D` | filled button hover | 13.85 | 4.5 | ✅ AAA |
| `action.primary.background` `#171A1D` vs `surface.app` | button visible on page | 16.28 | 3.0 | ✅ |
| `action.destructive` fg `#FFFFFF` on bg `#A5352F` | filled destructive | 6.67 | 4.5 | ✅ AA |
| `status.ready.foreground` `#22694A` | on white / `#F7F7F4` | 6.59 / 6.14 | 4.5 | ✅ AA |
| `status.attention.foreground` `#7A5312` | on white / `#F7F7F4` | 6.83 / 6.37 | 4.5 | ✅ AA |
| `status.critical.foreground` `#A5352F` | on white / `#F7F7F4` | 6.67 / 6.21 | 4.5 | ✅ AA |
| `status.information.foreground` `#37556B` | on white / `#F7F7F4` | 7.85 / 7.32 | 4.5 | ✅ AAA |
| `status.ready.solid` `#3C8A63` | vs white / `#F7F7F4` | 4.19 / 3.91 | 3.0 | ✅ meaningful graphic |
| `status.attention.solid` `#B07A2B` | vs white / `#F7F7F4` | 3.71 / 3.45 | 3.0 | ✅ |
| `status.critical.solid` `#C15048` | vs white / `#F7F7F4` | 4.66 / 4.34 | 3.0 | ✅ |
| `status.information.solid` `#5E7686` | vs white / `#F7F7F4` | 4.76 / 4.44 | 3.0 | ✅ |
| `status.<x>.foreground` on its own `.surface` wash | text on wash | 5.65–6.79 | 4.5 | ✅ AA |
| `text.primary` on any `status.<x>.surface` wash | text on wash | 14.8–15.4 | 4.5 | ✅ AAA |
| `status.ready.onInverse` `#7FCFA6` | on `#171A1D` | 9.47 | 4.5 | ✅ AAA |
| `status.attention.onInverse` `#E8BE7C` | on `#171A1D` | 10.06 | 4.5 | ✅ AAA |
| `status.critical.onInverse` `#E68F87` | on `#171A1D` | 7.19 | 4.5 | ✅ AAA |
| `status.information.onInverse` `#A8BCC8` | on `#171A1D` | 8.90 | 4.5 | ✅ AAA |
| `status.<x>.solid` | on `surface.inverse` `#171A1D` (dot on dark) | 3.67–4.71 | 3.0 | ✅ meaningful graphic (use `.onInverse` for status *text* on dark) |
| `selection.background` `#E7ECF0` | `text.primary` on it | 14.69 | 4.5 | ✅ AAA |
| `chrome.text.primary` `#F7F7F4` | on `chrome.background` `#171A1D` | 16.28 | 4.5 | ✅ AAA |
| `chrome.text.secondary` `#AAB1B7` | on `#171A1D` | 8.06 | 4.5 | ✅ AAA |

### 10.3 Colorblind / non-color rules (LOCKED)

- **Status is never color alone.** Every status instance combines a **label**
  and/or an **icon/shape** with color. A monochrome print, a screen reader, and
  deuteranopia/protanopia/tritanopia users all get the status.
- The four status hues, in their `.solid` form, differ in **lightness** as well
  as hue (green mid, amber mid-light, red mid, steel mid) — but lightness alone
  is not relied on; shape + label disambiguate.
- **Never green-vs-red as the only distinction.** `ready` vs `critical` must also
  differ by icon (e.g. check vs alert) and label.
- Focus is always a visible ring (`focus.ring`), never removed.
- Emphasis in body text is **weight**, never color.
- Do not encode meaning in saturation differences of one hue.

### 10.4 Dark / inverse context

Every role has an inverse value (§2). Status on dark uses `.onInverse` for text
(7–10:1) and `.solid` for dots/graphics (≥3.6:1). The inverse context is an
operational option (night dispatch, low-light rooms) and the substance of the
chrome — not the brand's "look" ([`04`](./04-visual-direction.md) §19).

### 10.5 Residual notes for the token-migration phase

1. `text.subtle` on `surface.secondary` is 4.49:1 — one hundredth under AA. The
   spec rule (use `text.secondary` there) resolves it; if a real design needs
   subtle text on that surface, darken `text.subtle` to `#5F656B` (5.0:1) and
   re-verify everything that consumes it.
2. `border.strong` on `surface.secondary` is 2.85:1. Avoid strong borders on the
   secondary surface, or introduce `border.strong.onSecondary` = `#7C817B`
   (3.1:1) at that time.
3. `status.attention.solid` on `surface.app` is 3.45:1 — passes, but it is the
   tightest status graphic. If amber dots are hard to see in real testing,
   darken to `#A06E26` (3.9:1).
4. All values assume sRGB. If the app adopts a wider gamut later, re-validate.

---

## APPENDIX A — Current Zenward token → future Nemryn role map (Step 8)

**Map by PURPOSE, not by color similarity.** This is a plan for the token-
migration phase; **nothing is renamed in G1-B**. "Manual review" = a component
using this token needs a human look because its intent is ambiguous or splits.

Current tokens are from `src/app/globals.css` `@theme`. Usage counts are from a
G1-B grep of `src/**/*.{ts,tsx}` (indicative; excludes `database.types.ts`).

### A.1 Brand-anchor colors

| Current token | Value | Uses | Purpose in the app today | Future Nemryn role | Notes |
|---|---|---|---|---|---|
| `--color-brand-care-navy` | `#123447` | 15 | Dark brand surface — Operations sidebar ground, some headings on light | `surface.inverse` / `chrome.background` (`#171A1D`) for the sidebar use; `text.primary` for the heading use | **Split — manual review.** Sidebar → chrome. Any `text-brand-care-navy` on a heading → `text.primary`. |
| `--color-brand-route-teal` | `#21a89a` | 1 | Decorative teal (near-unused) | *drop* | Not a Nemryn role. The single usage → review; likely `text.link` or a status, per intent. |
| `--color-brand-interactive-teal` | `#178577` | 46 | The interactive accent: links, focus rings, selected states, primary buttons, hover borders | **SPLIT — manual review, highest priority.** → `action.primary.*` (graphite) for buttons; `text.link` (`#37556B`) for links; `border.focus` / `focus.ring` for focus; `selection.*` for selected states; `border.strong` for hover-border. | **Do NOT map this to `status.ready`.** It is not "ready" — it was a brand accent doing several jobs. Each of the 46 call sites must be classified into the right action/link/focus/selection role. This is the single biggest manual-review item. |
| `--color-brand-calm-mist` | `#ddf4f0` | 9 | Pale teal wash — selected/hover backgrounds, soft panels | `selection.background` (`#E7ECF0`) for selection/hover; `surface.secondary` for soft panels | Manual review per usage (selection vs surface). |
| `--color-brand-arrival-gold` | `#f4b860` | 1 | Warm accent (near-unused; also the source of `warning-strong`) | `status.attention.solid` (`#B07A2B`) *only where it means attention*; otherwise drop | The `warning-strong` alias is the real carrier — see A.3. |

### A.2 Neutrals

| Current token | Value | Uses | Future Nemryn role |
|---|---|---|---|
| `--color-text-primary` | `#101f27` | 98 | `text.primary` (`#171A1D`) |
| `--color-text-secondary` | `#3e535c` | 80 | `text.secondary` (`#525A61`) |
| `--color-text-muted` | `#64777e` | 66 | `text.subtle` (`#646A70`) — **manual review** for any that are really `text.secondary` (readability-critical metadata) |
| `--color-text-disabled` | `#9aacb2` | 10 | `text.disabled` (`#8A9096`) |
| `--color-border-subtle` | `#d5dee1` | 42 | `border.default` (`#DCDDD9`) |
| `--color-border-strong` | `#7c8e93` | 17 | `border.strong` (`#868B85`) |
| `--color-surface-app` | `#f6f9fa` | 5 | `surface.app` (`#F7F7F4`) |
| `--color-surface-secondary` | `#eef3f4` | 14 | `surface.secondary` (`#E8E9E6`) |
| `--color-surface-elevated` | `#ffffff` | 37 | `surface.primary` (`#FFFFFF`) — **manual review**: any that are genuinely "raised" (menu/popover) → `surface.raised` + `shadow.raised` |
| `--color-surface-hover` | `#e7eef0` | 16 | `action.secondary.hover` / `selection.background` — **manual review** (hover vs selected) |

### A.3 Semantic families

The app already has `success` / `warning` / `critical` / `info` families with
`-text` / `-bg` / `-border` / `-strong` sub-tokens. These map cleanly by purpose
to the four Nemryn statuses — **but the meanings must be re-checked**, because the
app's usage predates the locked Nemryn meanings.

| Current family | Sub-token → Nemryn sub-token | Nemryn status |
|---|---|---|
| `success-*` | `-text`→`.foreground` `#22694A`, `-bg`→`.surface` `#EAF3EE`, `-border`→ from `.solid`, `-strong`→`.solid` `#3C8A63` | `status.ready` |
| `warning-*` | `-text`→`.foreground` `#7A5312`, `-bg`→`.surface` `#F9EFDF`, `-border`→ from `.solid`, `-strong`→`.solid` `#B07A2B` | `status.attention` |
| `critical-*` (44 uses — the most-used family) | `-text`→`.foreground` `#A5352F`, `-bg`→`.surface` `#F8E9E7`, `-border`→ from `.solid`, `-strong`→`.solid` `#C15048` | `status.critical` |
| `info-*` | `-text`→`.foreground` `#37556B`, `-bg`→`.surface` `#EBEFF2`, `-border`→ from `.solid`, `-strong`→`.solid` `#5E7686` | `status.information` |

**Manual review for the semantic families:**
- Any `critical-*` used for a *routine* notice (not an operational failure) →
  re-classify to `status.information` or a neutral treatment. Locked rule:
  Critical Red is not for routine account/security notices ([`05`](./05-semantic-color-system.md) §6).
- Any `success-*` used decoratively (a green header, a green divider) → drop the
  color; `status.ready` is not decoration.
- `StatusBadge.tsx`, `OnboardingChecklistBanner.tsx`, and the dispatch/trip
  panels are the concentration points — review these components as a set.

### A.4 On-navy chrome set

| Current token | Future Nemryn role |
|---|---|
| `--color-navy-surface` (= care-navy) | `chrome.background` (`#171A1D`) |
| `--color-navy-text-muted` `#9fb4bd` | `chrome.text.secondary` (`#AAB1B7`) |
| `--color-navy-border` `rgba(255,255,255,0.1)` | `chrome.border` (same value) |
| `--color-navy-hover-bg` `rgba(255,255,255,0.06)` | `chrome.item.hover` (same value) |
| `--color-navy-active-bg` `rgba(33,168,154,0.18)` (teal wash) | `chrome.item.active.background` `rgba(111,135,152,0.20)` — **steel, not teal** |
| `--color-navy-active-text` `#5fd6c4` (teal) | `chrome.item.active.text` `#F7F7F4` + `chrome.item.active.marker` `#A8BCC8` — **the active nav item is not a "ready" state; it's informational** |

### A.5 Non-color tokens

| Current | Future | Notes |
|---|---|---|
| `--font-display` (Manrope) | *removed* | Nemryn is single-family; no display face. Every `font-display` usage → `font.sans` with the appropriate `type.marketing.*` role. **Manual review** of `numericDisplay` / marketing hero usages. |
| `--font-sans` (Inter) | `font.sans` (Geist Sans) | Direct family swap; metric-matched fallback required. |
| `--spacing-zw-*` (2xs–4xl, 4px base) | `space.*` (`--spacing-nm-*`) | Values re-anchored: drop `zw-4xl` (80px); `space.2xl`=48, add `space.3xl`=64 / `space.4xl`=96 for marketing. Keep the private-prefix collision guard. |
| `--radius-xs/sm/md/lg` (`6/8/10/14`) | `radius.sm/md/lg` (`4/8/12`) | Tighter. `radius.xs`(6) → `radius.sm`(4); `radius.lg`(14) → `radius.lg`(12). Per-usage rounding review. |
| `--shadow-sm/md` | `shadow.raised` / `shadow.overlay` | Re-anchor tint to the graphite primitive; keep two levels; add `shadow.none` as the explicit default. |
| `--duration-fast/base/slow` (`120/200/280`) | `motion.duration.fast/base/slow` (`120/180/240`) | Slightly quicker; add `motion.duration.instant` (80). |
| `--ease-standard` | `motion.easing.standard` (same curve) | Unchanged; add `motion.easing.exit`. |
| dialog `::backdrop` `rgb(15 23 42 / 0.45)` | `overlay.scrim` `rgba(15,18,20,0.45)` | Graphite-tinted. |

### A.6 Components requiring component-level manual review (not just token swap)

From the G1-B grep, these consume brand/semantic tokens in ways where a
mechanical rename is unsafe:

- `src/components/ui/buttonStyles.ts` — primary/secondary/destructive variants;
  the interactive-teal → graphite primary is a **visual change**, review every
  variant.
- `src/components/ui/StatusBadge.tsx` — the status → color mapping must be
  re-pointed at the locked Nemryn meanings, and checked for color-alone reliance.
- `src/components/ui/DataTable.tsx`, `.../Combobox.tsx`, `.../Avatar.tsx`,
  `.../IconButton.tsx` — selection/hover/focus states currently on
  interactive-teal → split into `selection.*` / `action.*` / `focus.ring`.
- `src/components/operations/OperationsSidebar.tsx`, `.../AccountMenu.tsx`,
  `.../OnboardingChecklistBanner.tsx` — chrome set + the calm-mist / teal active
  states → chrome tokens (steel active, not teal).
- `src/components/operations/dispatch/AssignmentGrid.tsx`,
  `.../trip-detail/*Panel.tsx`, `.../new-trip/*` — heavy semantic-family use;
  review as the dispatch/trip cluster.
- `src/components/driver/*` (7 files) — the driver surface runs its own
  density/touch rules; review its status + accent usage against the driver
  context, not the operations context.
- `src/components/public/*` (Header, Footer, HeroContainer) — these move to the
  Nemryn *marketing* repo (or become Zenward Mobility tenant marketing); token
  parity there is a separate copy, per [`08`](./08-marketing-vs-application.md) §6.
- `src/app/foundation/page.tsx` — the internal token/QA showcase; update last, as
  a verification surface.
