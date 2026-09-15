# Nemryn — Identity Design Brief

**Phase:** NEMRYN G1-B (brief for use in **G1-C**)
**Status:** Brief only. **No logo, wordmark, or symbol is designed in G1-B.** This document is the input to the G1-C identity exploration.
**Date:** 2026-09-07
**Depends on:** [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §7, [`00-brand-foundation.md`](./00-brand-foundation.md), [`04-visual-direction.md`](./04-visual-direction.md), [`05-semantic-color-system.md`](./05-semantic-color-system.md), [`13-typography-specification.md`](./13-typography-specification.md)

---

## 1. What Nemryn means as a brand

Nemryn is **operating infrastructure for medical transportation** — the system an
NEMT operator runs their whole business on. It exists so an operator can always
answer: *what is happening, what is next, who is responsible, what requires
attention.*

Nemryn is calm, precise, structured, premium, operational, and
infrastructure-grade. It lowers the operator's stress. It is the quiet, dependable
layer underneath a high-stakes operation — the kind of system you stop noticing
because it simply works.

Nemryn is **not** the transportation operator. Operators (like Zenward Mobility,
the first tenant) keep their own identities; Nemryn is the platform they run on.

The identity has to carry all of that at a favicon's size and on a marketing
hero, in one colour, in both light and dark, for years.

## 2. What the mark needs to communicate

In priority order:

1. **Operational certainty** — this system is dependable; it holds.
2. **Structure** — things have a place; the mark is composed, not gestural.
3. **Coordination / connection** — separate elements working as one; relationships
   held together.
4. **Continuity / movement through a system** — flow, sequence, things progressing
   from one state to the next (a trip's life; a request becoming service).
5. **Control** — a firm hand on a complex operation, without heaviness.

It must communicate these through **geometry and relationship**, not through
representation. No pictogram of a thing.

## 3. What it must never resemble (forbidden motifs — LOCKED)

The symbol **must not** use or evoke:

- medical cross · heart · heartbeat / pulse line · ambulance · any vehicle ·
  wheelchair · stretcher
- map pin · GPS marker · location dot · an obvious road / route line / winding
  path · a steering wheel · a compass
- spark / star / sparkle "AI" motif · brain · neural net · circuit board · nodes-
  and-edges "network" cliché used as decoration
- generic gradient orb / sphere · glowing "energy" forms
- a generic "N inside a rounded square" app-icon cliché
- a generic tech hexagon · generic isometric shapes · a cube
- crypto / web3 geometric-token aesthetic
- consumer-mobility app iconography (the round pickup-dot, the paper-plane)
- hospital / clinical-software visual language

If an exploration drifts toward any of these, discard it.

## 4. Wordmark characteristics

- **Custom** wordmark (drawn or meaningfully customised), not Geist Sans set
  as-is — though it should sit comfortably **beside** Geist Sans and Geist Mono
  ([`13`](./13-typography-specification.md)).
- Lowercase or sentence-case treatment (`Nemryn` / `nemryn`) — not all-caps as
  the primary lockup. All-caps may be a secondary/utility lockup if the system
  needs it.
- Character: even colour, controlled contrast, slightly technical but not
  mechanical; confident spacing; nothing decorative on the letterforms
  (no ligature flourish, no cut corner "for interest").
- The `y` and the `m`/`n` rhythm are the identity's fingerprint — resolve them
  deliberately.
- Must read cleanly at **16px height** in a nav bar and hold up at billboard
  scale.
- One primary weight. A single alternate weight only if a real lockup needs it.

## 5. Symbol characteristics

- A **compact, independent** mark that works with **no wordmark present**.
- Built from **geometric relationships** — alignment, repetition, offset,
  interval, containment, connection. Think "a diagram reduced to its essence,"
  not "an icon of something."
- May contain a subtle geometric relationship that **incidentally** reads as the
  structure of an **N** (a diagonal, two verticals, a connecting stroke) — but an
  **obvious monogram is explicitly not the goal**. If a viewer's first read is
  "that's an N," it's too literal.
- Single-weight or a disciplined two-weight construction. No more.
- Positive/negative space should both be intentional — the counters carry meaning.
- Works as a solid shape **and** as an outline/stroke version.
- Optically centred; sits on a consistent baseline with the wordmark.
- Roughly square or a contained vertical — not a wide horizontal lockup (that's
  what the wordmark is for).

## 6. Small-size requirements

- Legible and recognisable at **16×16px** (favicon, compact nav) with no visual
  noise — no thin strokes that vanish, no detail that fills in.
- A distinct silhouette at **16px** — identifiable from shape alone, greyscale.
- Test at 16, 20, 24, 32px on both light and dark before anything larger is
  judged "working".
- Provide a **simplified small-size variant** if the full symbol loses integrity
  below ~20px (common and acceptable — plan for it).

## 7. Monochrome requirements

- The primary construction is **single-colour**. It must work in:
  - `#171A1D` (Deep Graphite) on light,
  - `#F7F7F4` (Mineral White) on Deep Graphite,
  - pure black on white and pure white on black (print, stamps, embroidery,
    favicon fallback),
  - a knockout (transparent) form.
- **No gradient is part of the identity.** No colour is required to "get" the
  mark. Colour, if any, is a single flat brand ink — decided in G1-C, drawn from
  or harmonised with the neutral primitives, **never** one of the four status
  hues (Signal Green / Attention Amber / Critical Red / Steel Blue are semantic
  and off-limits as brand colour — [`05`](./05-semantic-color-system.md) §6,
  [`11`](./11-brand-lock-v1.md) §9).

## 8. Light / inverse requirements

- Designed **light-first** (Deep Graphite mark on Mineral White), then verified as
  a consistent role-swap on the inverse chrome (Mineral White mark on Deep
  Graphite) — not a separately drawn dark version.
- No halo, glow, outline-on-dark, or drop shadow to make it "pop" on dark. If it
  needs an effect to work on dark, the shape is wrong.
- Contrast of the mark against its ground follows the same ≥3:1 non-text
  guidance as the rest of the system.

## 9. Favicon requirements

- The **symbol only** (never the wordmark) at 16 / 32 / 48px, plus a maskable
  512px for PWA.
- Solid, high-contrast, no fine detail, no text.
- One colour on a solid or transparent ground. A rounded-square container is
  acceptable **only** if platform-mandated (iOS/Android maskable) — it is not part
  of the brand mark itself.
- Must be distinguishable in a crowded browser-tab strip at a glance.

## 10. App-shell requirements

- Lives on `surface.inverse` (Deep Graphite chrome — [`12`](./12-design-token-specification.md) §2.7).
- Typically the **symbol + wordmark** lockup, small, top-left of the frame, with
  the **current workspace name** shown nearby as context ([`11`](./11-brand-lock-v1.md) §12)
  — the mark and the workspace name must be visually distinct (the mark is
  Nemryn; the workspace name is the operator).
- Must not compete with operational content — it is quiet chrome, not a banner.
- A **symbol-only** collapsed state for a narrow/collapsed nav.
- No animation on load. A hover/focus state is a subtle opacity or underline
  shift at most.

## 11. Marketing requirements

- Full **symbol + wordmark** lockup as the primary; wordmark-only and symbol-only
  as secondaries.
- Works on Mineral White, on Deep Graphite, and over a restrained photographic or
  diagrammatic background (with a clear-space rule, not a plate/box).
- Scales to hero size without revealing construction seams or looking thin.
- Clear-space and minimum-size rules defined as part of the G1-C deliverable.
- No lockup with a tagline is required in v1; if one is made, the core position
  ("Operating infrastructure for medical transportation.") is the only candidate
  line.

## 12. Forbidden motifs (consolidated — see also §3)

Representation of: medicine, healthcare, vehicles, mobility aids, roads,
navigation, location, AI, networks-as-decoration, crypto, consumer apps, hospital
software. Gradients, glows, orbs, sparkles, hexagons, cubes, isometric shapes,
"N-in-a-square". Any letterform flourish. Any effect needed to make the mark
work.

## 13. Competitive-independence rule (LOCKED)

The Nemryn identity is **derived from Nemryn's own principles**, not from any NEMT
software competitor. Do **not** reference, adapt, or "improve on" the logo,
wordmark, symbol, colour, or identity system of `hibambi.com` or any peer NEMT
product. If a competitor's mark seems obviously right for the category, that is a
reason to go somewhere else. When in doubt, do not look at them.

## 14. How the identity should feel — and not feel

| Should feel | Must not feel |
|---|---|
| precise | friendly-healthcare |
| structural | automotive |
| quiet | futuristic |
| recognisable | AI |
| confident | crypto |
| considered, premium | consumer mobility |
| infrastructure-grade | hospital software |
| — | decorative, trendy, or "designed to impress" |

## 15. G1-C deliverables (what this brief should produce)

1. 3–5 distinct symbol directions explored, each shown at 16px greyscale first.
2. A resolved symbol (+ small-size variant if needed).
3. A custom wordmark.
4. The primary lockup + wordmark-only + symbol-only.
5. Light and inverse versions (role-swap, verified).
6. Favicon set (16/32/48 + 512 maskable).
7. App-shell lockup (full + collapsed) on Deep Graphite chrome, with a workspace-
   name-context example.
8. Clear-space, minimum-size, and misuse rules.
9. The single flat brand-ink decision (if any colour beyond the neutrals is used)
   — validated against §7 and the color system.
10. A one-page rationale tying the final mark back to §2 (what it communicates).

**Not** in G1-C: applying any of it to the application. That is the shell-
migration phase, separately authorized.
