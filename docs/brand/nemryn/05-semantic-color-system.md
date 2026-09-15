# Nemryn — Semantic Color System

**Phase:** NEMRYN G1-A (palette LOCKED, tokens DERIVED in G1-B)
**Status:** Semantic *roles* and principles. As of G1-B: the **palette primitives are locked** (§2) and the **derived, accessibility-validated token values live in [`12-design-token-specification.md`](./12-design-token-specification.md)**. Still no CSS, no Tailwind change, no `globals.css` change.
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** [`04-visual-direction.md`](./04-visual-direction.md) · **Resolved by:** [`12-design-token-specification.md`](./12-design-token-specification.md), [`11-brand-lock-v1.md`](./11-brand-lock-v1.md)

---

## 1. Principle

Nemryn's interface is **mostly not colored.** Color is a signal. Every use of a
non-neutral color must map to a defined meaning. A screen where color is
decoration has broken the system.

There are two color families:

1. **Neutrals** — the entire structural surface: backgrounds, surfaces, text,
   borders, the primary button. This is 95%+ of any screen.
2. **Semantics** — four operational status meanings, plus a small set of
   functional accents. Used sparingly, always with a text label, never alone.

## 2. Brand Palette Primitives v1 (LOCKED — G1-B)

These nine values are **locked** as Brand Palette Primitives v1.

| Name | Hex | Family | Role as a primitive |
|---|---|---|---|
| Deep Graphite | `#171A1D` | Neutral (darkest) | Inverse surface ground; primary-action background; strongest text on light |
| Ink | `#23282D` | Neutral (dark) | Primary text on light; secondary inverse surface |
| Mineral White | `#F7F7F4` | Neutral (lightest) | App background in light context |
| Soft Stone | `#E8E9E6` | Neutral (light) | Secondary surface / subtle fills |
| Muted Slate | `#697179` | Neutral (mid) | Secondary/subtle text on light; icon default |
| Signal Green | `#4FA57A` | Semantic — status | ready / confirmed / complete / healthy |
| Attention Amber | `#D79B45` | Semantic — status | needs attention / potential problem / readiness concern |
| Critical Red | `#C95C55` | Semantic — status | critical exception / failed condition / significant operational problem |
| Steel Blue | `#6F8798` | Semantic — status | information / selection / focus / neutral active state / in-progress-without-a-problem |

**Critical constraint (LOCKED):** these are *primitive* colors. They are **not**
permission to use each raw value directly for text, borders, fills, or controls.
Accessibility validation (G1-B) confirms that **none of the four status hues meets
4.5:1 as small text on Mineral White** (Signal Green 2.80, Attention Amber 2.26,
Critical Red 3.80, Steel Blue 3.50). Semantic, accessibility-validated **derived
variants** — darker foregrounds for text on light, lighter variants for text on
dark, subtle washes for fills — are defined in
[`12-design-token-specification.md`](./12-design-token-specification.md) §4. The
primitives are preserved; the derived values are what components consume.

Character: the four status hues are deliberately **desaturated and close in
value** — an operational instrument panel, not traffic lights. Keep that when
deriving.

### Color meanings (LOCKED — G1-B)

| Primitive | Means | Never means |
|---|---|---|
| Signal Green | ready, confirmed, complete, healthy | "primary button", "brand accent", decoration |
| Attention Amber | needs attention, potential problem, readiness concern | "warning as decoration", a category color |
| Critical Red | critical exception, failed condition, significant operational problem | routine account/security notices, "delete button" by default |
| Steel Blue | information, selection, focus, neutral active state, in-progress without a problem | a general marketing accent used for its own sake |

Signal colors are **never** the general marketing palette. **Signal Green is never
the default CTA.** The primary CTA / primary application action uses a **Deep
Graphite / Ink high-contrast treatment** (see §6 and
[`12`](./12-design-token-specification.md) §3 `action.primary.*`).

## 3. Semantic roles

Role names below are conceptual. Exact token naming (dot notation vs kebab,
`-strong` vs `-emphasis`, etc.) is a G1-B decision. Each role needs, at minimum,
a **foreground** (text/icon) value and, where it fills an area, a **background**
and a **border** value tuned for contrast.

### Surfaces

| Role | Meaning | Direction |
|---|---|---|
| `surface.primary` | Where content and data sit — panels, tables, forms, cards | Near-white in light (`#FFFFFF` or a hair off it); a step above the app background |
| `surface.secondary` | Recessed areas, subtle grouping fills, table zebra if used | Soft Stone range |
| `surface.app` (background) | The page ground | Mineral White in light |
| `surface.inverse` | Primary nav frame; deliberate high-contrast headers/command bars | Deep Graphite / Ink |

### Text

| Role | Meaning | Direction |
|---|---|---|
| `text.primary` | Default reading text, headings | Ink on light; Mineral White on inverse |
| `text.secondary` | Supporting text, metadata, captions | Muted Slate on light; a light slate on inverse |
| `text.disabled` | Genuinely inactive text only | Lightest slate that still meets 3:1 where it must remain perceivable |
| `text.inverse` | Text placed on a Deep Graphite fill (e.g. primary button label) | Mineral White |
| `text.link` | Interactive text | A restrained accent — likely a slightly deepened Steel Blue or Ink underline; **not** Signal Green |

### Borders

| Role | Meaning | Direction |
|---|---|---|
| `border.default` | Hairline separation — the workhorse | A low-contrast stone/slate; visible, not heavy |
| `border.strong` | Meaningful boundary — editable region edge, selected row, focused container | One clear step darker than default |
| `border.focus` | Keyboard focus ring | A single consistent, clearly visible color across the whole product (the app currently uses its interactive teal — Nemryn should pick one deliberate focus color, likely Steel Blue or Ink, and use it everywhere) |

### Status (the four operational meanings)

Each status role provides: a **solid** color (dot, chip fill, bar), a **subtle**
background (for a row highlight or a soft banner), a **border**, and a **text**
color for text-on-subtle.

| Role | Operational meaning | When to use | Base hue |
|---|---|---|---|
| `status.ready` | ready · confirmed · complete · healthy · on time | A trip that is fully ready to run; a completed & proven trip; a standing order in good standing; a green-across-the-board day | Signal Green |
| `status.attention` | attention required · potential issue · readiness concern · approaching a deadline | A trip that isn't ready yet and needs action before it becomes a failure; an expiring authorization; an unconfirmed vehicle; capacity getting tight | Attention Amber |
| `status.critical` | critical exception · failed condition · significant operational problem · service failure | An active exception (no-show driver, passenger not found, trip missed); a trip that will not run; a failed proof-of-service; data that blocks billing | Critical Red |
| `status.information` | informational · neutral operational state · in progress, nothing wrong · system note | A trip currently in service (en route) with no problem; a neutral status; an FYI; "assigned, awaiting confirmation" before it's a concern | Steel Blue |

### Functional accents (non-status)

| Role | Meaning | Direction |
|---|---|---|
| `accent.interactive` | The single interactive/brand accent for links, selected states, focus if chosen | ONE color, chosen deliberately. Candidates: Steel Blue (calm, neutral, on-brand) or Ink (maximally restrained). **Not** Signal Green. Not a new hue. |
| `accent.selection` | Selected row / active nav item background on inverse or light | A low-opacity wash of `accent.interactive` |

## 4. Mapping operational concepts → status roles

A reference so product teams don't re-litigate this per screen.

| Concept | Role | Notes |
|---|---|---|
| Trip: ready | `status.ready` | All readiness checks pass |
| Trip: not ready (has time) | `status.attention` | List the failing checks |
| Trip: not ready (imminent) | `status.critical` | It will fail without action now |
| Trip: in service / en route | `status.information` | Normal progress, not a status to worry about |
| Trip: completed, proof recorded | `status.ready` | |
| Trip: completed, proof missing | `status.attention` | Blocks Revenue Assurance |
| Trip: cancelled | neutral (text.secondary) | Not a status color — it's a resolved non-event |
| Trip: missed / failed | `status.critical` | |
| Exception: open | `status.critical` | |
| Exception: recovered | `status.ready` (transient) then neutral | Show the recovery briefly, then it's just history |
| Standing order: active | `status.ready` or neutral | Neutral unless something needs attention |
| Standing order: ending soon | `status.attention` | |
| Standing order: lapsed | `status.critical` | Future trips silently won't exist |
| Authorization: valid | neutral / `status.ready` | |
| Authorization: expiring before trip | `status.attention` | |
| Authorization: expired / missing | `status.critical` | |
| Capacity: healthy | neutral | Don't paint "fine" green everywhere |
| Capacity: tight | `status.attention` | |
| Capacity: over-committed | `status.critical` | |
| Dead time / underutilization | `status.information` or neutral | It's information, not an alarm |
| Driver: confirmed for trip | `status.ready` | |
| Driver: assigned, unconfirmed | `status.information` → `status.attention` as pickup nears | |
| Driver: unavailable / no-show | `status.critical` | |

## 5. Accessibility

- **Contrast:** all text meets **WCAG 2.1 AA** — 4.5:1 for normal text, 3:1 for
  large text (≥24px or ≥19px bold) and for meaningful non-text UI (icons that
  carry meaning, input borders, focus rings, status dots against their
  background). Aim for AAA (7:1) on primary body text where the palette allows.
- **Never color alone.** Every status is icon-or-shape **plus** text **plus**
  color. A colorblind user, a monochrome print, and a screen reader must all get
  the status.
- **The four status hues must be distinguishable** for the common color-vision
  deficiencies. Amber vs green and red vs amber are the risky pairs — validate,
  and lean on shape/label to disambiguate. Do not rely on green-vs-red.
- **Focus is always visible** — one consistent ring, never removed without an
  equal replacement (the app already enforces this).
- **Status backgrounds** (subtle washes) must keep their text at AA against the
  wash, not just against white.
- **Dark/inverse context:** status hues need their own tuned values on Deep
  Graphite — a hue that passes on white often fails on graphite. Define both.
- Do not encode information in hue *saturation* differences (users won't perceive
  "slightly more urgent amber").

## 6. When colors MUST NOT be used

- **Signal Green as a call-to-action / primary button color.** It is attractive
  and that is exactly the trap. Green means *ready / healthy / done*. A primary
  action button is neutral high-contrast (Deep Graphite / Ink). If "Assign
  driver" is green, then green no longer means "ready" — it means "button," and
  the status system is dead. (Explicit rule from the phase brief.)
- **Status colors as decoration, theming, or brand accent.** No green section
  headers, no amber dividers, no red "hero" panels, no blue card backgrounds
  "for visual interest."
- **Critical Red for routine account/security notices.** "Your password was
  changed" is `status.information`. Red is for operational failure. Overusing red
  trains operators to ignore it.
- **More than ~2 status colors visible in one compact area** without it being a
  genuine mixed-status list. If a summary strip is half amber and half red, the
  design is shouting.
- **Amber and green on the same element** to mean "partly ready." Show a
  checklist instead.
- **Semantic colors on the marketing site as a palette.** Marketing uses the
  neutrals and, at most, the one interactive accent. It is not a place to show
  off the status hues as brand colors.
- **A new hue outside the nine.** No "Nemryn purple," no gradient blends, no
  tint that isn't a derived step of a defined color.
- **Colored text for emphasis** in body copy. Emphasis is weight, not color.

## 7. Distribution target (rough)

On a typical operational screen with everything going well:

- ~90% neutral (surfaces, borders, text)
- ~5–8% the one interactive accent (links, selected nav, focus)
- ~2–5% status color, and mostly `status.ready`/neutral dots

If a "healthy day" screen is visibly colorful, the system is being misused.

## 8. G1-B outcome

Delivered in [`12-design-token-specification.md`](./12-design-token-specification.md):

- resolved hex values for every role, light and inverse, foreground / background /
  border as applicable;
- documented WCAG contrast ratios for every derived value (§4 there, plus the
  primitive-vs-background matrix);
- derived tint/shade steps for the status washes;
- naming convention: dot-notation conceptual roles in this doc set, mapping to a
  future `--color-<role-path>` kebab convention in the Tailwind v4 `@theme` block
  (unchanged mechanism, new names);
- a purpose-based old-Zenward-token → new-Nemryn-role migration map
  (appendix in [`12`](./12-design-token-specification.md), and the full touchpoint
  plan in [`15-rebrand-inventory.md`](./15-rebrand-inventory.md)).
