# Nemryn — Visual Direction

**Phase:** NEMRYN G1-A
**Status:** Specification only. No production CSS. No Tailwind config change. No component change.
**Last updated:** 2026-09-07 (G1-B: wordmark/symbol direction now carried by [`14-identity-design-brief.md`](./14-identity-design-brief.md); token values by [`12-design-token-specification.md`](./12-design-token-specification.md))
**Depends on:** [`00-brand-foundation.md`](./00-brand-foundation.md), [`05-semantic-color-system.md`](./05-semantic-color-system.md), [`06-typography-system.md`](./06-typography-system.md)

---

## 1. The feeling, in one paragraph

Nemryn should feel like a well-run control room: calm, precise, structured,
premium, operational, infrastructure-grade, and highly readable. A screen should
communicate through hierarchy, alignment, and restraint — not through color,
decoration, or motion. The reader should trust it immediately and never feel
sold to.

## 2. Competitor rule (binding)

Do **not** visually imitate `hibambi.com` or any other NEMT software product. Do
not reproduce a competitor's:

page layouts · navigation structure · terminology · dashboard composition ·
illustration style · iconography motifs · feature naming · copywriting patterns ·
color usage · marketing section order.

If a competitor does something and it seems obviously right, derive Nemryn's
version from Nemryn's own principles (readiness-first, ownership, proof, maturity
range) rather than from their execution. When in doubt, do not look at them.

## 3. Anti-patterns (do not do)

- generic AI-SaaS aesthetic (purple gradients, "sparkle" accents, chat bubble
  as hero)
- glassmorphism / frosted translucency
- neon or high-saturation accent colors
- large gradient blobs, mesh gradients, aurora backgrounds
- futuristic glowing UI, glows, halos, "energy" effects
- generic vehicle hero imagery; ambulances; dashboards-of-a-van
- medical clichés: red cross, caduceus, stethoscope, pill, heartbeat line as decor
- stock doctor / smiling-patient / handshake photography
- generic 3D-rendered AI icons or isometric illustration sets
- over-rounded cards (large border-radius, pill-shaped everything)
- decorative drop shadows, layered "floating" cards, heavy elevation
- marketing adjectives rendered as UI ("Powerful", "Smart", "Effortless" labels)
- animated number counters, confetti, celebratory microinteractions
- dark-mode-as-a-personality (a dark theme may exist; it is not the brand's
  "look")

## 4. Surface hierarchy

Three surface levels, no more. (The existing app already works this way — Nemryn
keeps the discipline, restyled.)

| Level | Role | Character |
|---|---|---|
| **App background** | The ground everything sits on | The quietest surface. Slightly off-white in light contexts; deep graphite in inverse contexts. Never pure white, never pure black. |
| **Primary surface** | Where content and data live — panels, table containers, forms | One clear step up from the background. Defined by a hairline border first, a very subtle shade difference second. |
| **Inverse surface** | Reserved: primary navigation, and deliberately high-contrast operational headers | Deep graphite / ink. Carries its own small on-dark text and border set. Never used as a reading surface for body content. |

Rules:

- A surface is distinguished by **border before fill, fill before shadow**.
- Do not nest more than two surface levels in a reading area. If you're drawing a
  card inside a card inside a panel, the hierarchy is wrong.
- The inverse surface is a **structural** choice (it says "this is the frame" or
  "this is a command bar"), not a decorative one.

## 5. Spacing philosophy

- **A base rhythm, applied consistently.** The existing app uses a 4px base with
  named steps (2xs–4xl). Nemryn keeps a small, named, consistent scale — the
  exact values are a design-token decision, not a G1-A decision.
- **Density is a feature.** Operators need many rows and fields visible. Nemryn
  runs tighter than a typical marketing SaaS app — but every dense region is
  bounded by generous outer padding so the screen breathes at its edges.
- **Whitespace is load-bearing.** Grouping is communicated by space, not by
  boxes and dividers. Prefer removing a border and adding space.
- **Vertical rhythm is deliberate.** Consistent spacing between a label and its
  value, between rows, between sections — so the eye can predict where the next
  thing is.

## 6. Cards

- A "card" is a **container for one coherent object or one decision**, not a
  decorative rectangle.
- Cards are defined by a hairline border and, at most, one very subtle shadow
  level. No layered elevation, no hover-lift, no glow.
- Corner radius: small and consistent (the existing app uses 6–14px; Nemryn
  should sit at the restrained end — closer to 6–10px). No pill-shaped cards.
- If a screen is mostly a list of similar things, use a **table or a list with
  row separators**, not a grid of cards. Cards are for heterogeneous or
  decision-bearing content (an exception that needs a choice, a trip summary with
  actions).
- No empty decorative cards, no "stat card" walls (see §12).

## 7. Borders

- **The hairline border is Nemryn's primary structural tool.** One weight for
  normal separation, one slightly stronger weight for a meaningful boundary
  (e.g. the edge of an editable region, a selected row).
- Borders are neutral (from the stone/slate range), never colored — except a
  semantic status border, used sparingly and per [`05-semantic-color-system.md`](./05-semantic-color-system.md).
- Prefer a single border or a single divider over a full box. A table doesn't
  need vertical rules if columns are aligned and spaced.

## 8. Shadows

- **Two levels maximum**, both subtle: one for "slightly raised" (a menu, a
  popover), one for "modal / overlay."
- Content panels and cards on the page get **no shadow** or the lightest level
  only. The border does the work.
- No colored shadows, no long/soft "floating" shadows, no shadow on hover as the
  primary affordance.

## 9. Radius

- One small radius for most elements (inputs, buttons, cards, chips).
- `rounded-full` reserved for genuine pills: status chips, avatars, count badges.
- No large-radius "friendly" cards. Nemryn is precise, not soft.

## 10. Density

- **Comfortable-dense by default** on operational screens: enough padding to tap
  and read, tight enough to see the whole picture.
- A per-operator or per-view density toggle (comfortable / compact) is a
  reasonable future feature — not a G1 decision.
- The driver surface runs **less dense** and larger-touch — it's used one-handed,
  in a vehicle, in sunlight.

## 11. Icons

- One icon family, restrained weight, consistent size. (The app currently uses
  Phosphor at Regular/Medium — a reasonable direction to keep; confirm in the
  token phase.)
- Icons **support** labels; they rarely replace them. Navigation items have text.
- No decorative icons. No icon in a heading unless it carries meaning.
- Status is **not** communicated by icon alone (accessibility) — icon + text, or
  icon + text + color.
- No emoji as icons. No multi-color / 3D / illustrated icon sets.

## 12. Data presentation

- **The default representation of operational data is a well-set table or list**,
  not a chart and not a card grid.
- A number gets large type only when it is genuinely the headline of a view
  (e.g. "14 trips today" on the Operations Brief). Otherwise numbers sit in
  aligned columns at body or data size.
- **No "KPI card wall."** A row of six big-number cards with tiny labels is a
  dashboard cliché and is banned as a default. If a summary strip is needed, it
  is a single compact line of `label: value` pairs, not six elevated cards.
- Charts appear only where a trend or distribution is the actual question
  (capacity/dead-time over weeks, on-time rate over time). When they do:
  - follow the project's dataviz conventions,
  - one categorical color logic, semantic colors only where they carry status
    meaning,
  - no 3D, no gradients-as-fill, no chart-junk.
- **Right-align numbers**, left-align text, in tables. Use tabular figures (see
  [`06-typography-system.md`](./06-typography-system.md)).

## 13. Tables

- Hairline row separators or generous row spacing — not both, not heavy grid
  lines.
- Sticky header on scroll for long tables.
- Column headers in the `label` type role, sentence case.
- Primary identifier column first, status column where it can be scanned
  vertically (often last or second).
- Row-level actions revealed on row focus/hover **and** always available via a
  row menu (keyboard/touch).
- Empty table: a single quiet sentence (see [`03-verbal-identity.md`](./03-verbal-identity.md)),
  not an illustration.

## 14. Forms

- One column. Labels above fields. No placeholder-as-label.
- Group related fields with **space and a small section label**, not a fieldset
  box.
- Required vs optional stated explicitly (mark optional, or mark required —
  consistently; the app currently marks neither uniformly — resolve in design).
- Inline validation on blur, plain-language messages, error text directly under
  the field.
- Primary action bottom-left or bottom-right consistently; destructive actions
  separated and never the default focus.
- Buttons: one primary per view. Primary is a **neutral, high-contrast** treatment
  (graphite/ink) — **not** Signal Green (see [`05-semantic-color-system.md`](./05-semantic-color-system.md) §7).

## 15. Navigation

- **Primary navigation is the app frame** — persistent, on the inverse surface,
  text labels with supporting icons.
- Flat where possible; at most one level of nesting revealed contextually.
- The current workspace (operator) is shown in the frame as **context** — a
  switcher, not a brand slot.
- No mega-menus, no marketing nav patterns inside the app.
- The marketing site has its own, separate nav (see [`08-marketing-vs-application.md`](./08-marketing-vs-application.md)).
- Breadcrumbs only where hierarchy is genuinely deep (a trip inside a day inside
  a view). Most screens don't need them.

## 16. Status visualization

The heart of Nemryn's visual language. Governed entirely by
[`05-semantic-color-system.md`](./05-semantic-color-system.md). Summary:

- Four operational status meanings: **ready** (Signal Green), **attention**
  (Attention Amber), **critical** (Critical Red), **information / neutral** (Steel
  Blue).
- Status is shown as a **chip or a dot + label**, never color alone, never an
  icon alone.
- A screen should have **little color**. When color appears, it means something.
  A screen full of green is as wrong as a screen full of red — it means the
  status system has become decoration.
- Readiness is often better shown as a **checklist of reasons** than as a single
  color — "show the mechanism" (design principle 4).

## 17. Imagery rules

- **Default to no imagery.** Nemryn communicates with type, layout, and data.
- Marketing may use: restrained product screenshots (real UI, real-shaped data,
  never fake dashboards — see [`08`](./08-marketing-vs-application.md)), simple
  functional diagrams (trip lifecycle, how requests flow), and — sparingly —
  documentary-style photography of real operational settings if it is honest and
  un-staged. Not stock.
- **Never:** vehicle hero shots, ambulances, medical symbols, doctor/patient
  stock, handshakes, "team collaborating around a laptop," 3D render
  illustrations, abstract tech backgrounds.
- Diagrams follow the project's diagramming conventions: show the real mechanism,
  legible in light and dark, no decoration.

## 18. Motion principles

- **Motion is feedback, not personality.** It confirms a change of state (a panel
  opened, a row moved, a save landed) and nothing else.
- Fast and quiet: roughly 120–200ms, standard easing. Nothing bounces,
  overshoots, or lingers.
- No entrance animations on page load. No parallax. No scroll-triggered reveals in
  the application. Marketing may use one restrained reveal pattern, subtly.
- Respect `prefers-reduced-motion` fully (the app already does).
- Live-updating data (dispatch, readiness) changes in place with a brief,
  non-flashing transition — never a jarring reflow, never a flash of color unless
  the color change *is* the information.

## 19. Light and dark

- Nemryn has a defined light context and a defined inverse/dark context. Design
  the light context first and completely; the inverse context is a consistent
  role-swap, not a separate design.
- Dark is not the brand's identity and not a marketing "look." It is an
  operational option (night dispatch, low-light control rooms) and the substance
  of the inverse surfaces.

## 20. What G1-A does not decide

- Exact spacing scale values, exact radii, exact border widths, exact shadow
  values, exact type scale.
- The Nemryn wordmark and any logo mark.
- Grid system / breakpoints for the marketing site.
- Any component's actual appearance.

Those belong to G1-B (token system) and later design work.
