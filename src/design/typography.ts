/**
 * Typography tokens (N0-M2-A1A — Nemryn brand foundation; Brand Lock v2 adds the `display*` roles at the end).
 * See docs/brand/nemryn/13-typography-specification.md for the full,
 * LOCKED scale this file implements.
 *
 * Every entry is a fixed Tailwind class string covering family, size,
 * line height, and weight together — pages/components consume these
 * instead of improvising font sizes or families. Key NAMES are
 * deliberately unchanged from the pre-Nemryn version (every existing
 * consumer references these same names) — only the underlying classes
 * moved to the Geist-based Nemryn scale. Two real changes, both LOCKED,
 * not incidental: (1) family — Manrope/Inter → Geist Sans, a single
 * family for the whole app, no separate "display" face; every former
 * `font-display` role now resolves to `font-sans`. (2) several
 * application sizes shrink (the spec's own explicit principle:
 * "avoid oversized application headings" — this is a workspace, not a
 * landing page) — `pageTitleOperational` 30px→24px, `sectionHeading`
 * 24px→18px, `subsectionHeading` 18px→15px, `body` 16px→14px,
 * `bodySmall`/`label`/`tableHeader` →13px, `button` 14px→13px. This is
 * an intentional density increase, not a mistake — validate against
 * real screens (see docs/reports/n0-m2-a1a-brand-foundation-tokens-
 * typography.txt §11/§12), don't "fix" it back to the old sizes.
 */
export const typography = {
  /** Geist Sans. Marketing hero headlines only — forbidden in /operations, /driver, and auth screens (type.marketing.display). */
  display: "font-sans text-5xl font-semibold leading-[56px] tracking-tight",
  /** Geist Sans. Public website page titles (type.marketing.heading). */
  pageTitleMarketing: "font-sans text-[2rem] font-semibold leading-[1.15] tracking-[-0.01em]",
  /** Geist Sans. The one title of an app screen — one per view (type.app.pageTitle). Deliberately smaller than marketing headings. */
  pageTitleOperational: "font-sans text-2xl font-semibold leading-[1.25] tracking-[-0.01em]",
  /** Geist Sans. Major divisions within a screen (type.app.sectionHeading). */
  sectionHeading: "font-sans text-lg font-semibold leading-[1.33]",
  /** Geist Sans. Card titles, grouping labels (type.app.subheading). */
  subsectionHeading: "font-sans text-[0.9375rem] font-semibold leading-[1.4]",
  /** Geist Sans. Default reading text in the app (type.app.body). */
  body: "font-sans text-sm font-normal leading-[1.5]",
  /** Geist Sans. Secondary/dense body copy (type.app.bodySmall). */
  bodySmall: "font-sans text-[0.8125rem] font-normal leading-[1.45]",
  /** Geist Sans. Form labels, table column headers, chip text (type.app.label). */
  label: "font-sans text-[0.8125rem] font-medium leading-[1.3]",
  /** Geist Sans. Timestamps, captions, muted metadata (type.app.caption). */
  metadata: "font-sans text-xs font-normal leading-[1.4]",
  /** Geist Sans. Button and interactive-control labels — sentence case, never ALL CAPS (type.app.button). Brand Lock v2 §2: 13px / 600 (Concept B .btn 650). */
  button: "font-sans text-[0.8125rem] font-semibold leading-none",
  /** Geist Sans. Table header cells — same role as `label` (type.app.label). */
  tableHeader: "font-sans text-[0.8125rem] font-medium leading-[1.3]",
  /** Geist Sans. Table body cells — same size/weight as `bodySmall` for row-text; a numeric-column cell should additionally add `tabular-nums` at the call site (type.app.data direction). */
  tableCell: "font-sans text-[0.8125rem] font-normal leading-[1.45]",
  /** Geist Sans. NP-UI-P1b: the value of a compact fact (StatTile, a Brief block's count) — the page-title size, tabular, so a row of facts aligns. Deliberately below `numericDisplay`, which stays reserved for a view's single headline number. */
  metricValue: "font-sans text-2xl font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums",
  /** Geist Sans. The single headline number of a view — rare, at most one per screen. `tabular-nums` included (type.app.numeric). */
  numericDisplay: "font-sans text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums",
  /**
   * Brand Lock v2 display tier (D-1, 16-brand-lock-v2.md §2) — Newsreader, the ONLY roles that use it. Never in
   * tables, forms, navigation, buttons, badges or operational values; never below 22px. Sizes from Concept B; weight
   * 700 matches Concept B's bold Georgia heads in a browser comparison (600 read visibly lighter).
   */
  /** The one page title (h1) of an Operations screen — Concept B `.head h1` clamp(28px, 3vw, 39px). */
  displayPage: "font-display text-[clamp(1.75rem,3vw,2.4375rem)] font-bold leading-[1.1] tracking-[-0.025em]",
  /** A major section title on a dashboard page (e.g. "Operations Brief") — Concept B `.section-title` 29px. */
  displaySection: "font-display text-[1.8125rem] font-bold leading-[1.15] tracking-[-0.02em]",
  /** The setup hero heading — Concept B `.setup h2` 31px. */
  displaySetup: "font-display text-[1.9375rem] font-bold leading-[1.12] tracking-[-0.02em]",
  /** Overview panel titles — Concept B `.panel h3` 22px (the smallest display size allowed). */
  displayCard: "font-display text-[1.375rem] font-bold leading-[1.2] tracking-[-0.015em]",
} as const;

export type TypographyToken = keyof typeof typography;
