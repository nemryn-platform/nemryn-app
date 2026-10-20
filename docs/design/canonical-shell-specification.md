# Nemryn — Canonical Application Shell Specification

**Phase:** NP-UI-P1b (canonical visual system and application shell)
**Built against:** Brand Lock v1 (`docs/brand/nemryn/11-brand-lock-v1.md`) and the approved Concept B visual direction
(`docs/design/concept-b/`). Brand Lock wins every conflict; see the reconciliation in §8.
**Status:** implemented on branch `np-ui-p1b-canonical-shell`. **Owner-approved 2026-10-20**, including the final
polish:
- raised Overview cards (`shadow-sm`);
- the `type.app.metricValue` 24px role;
- 8px controls and cards;
- the workspace / account footer;
- the tablet rail;
- the 390px notice kept for now.

Screenshots: `docs/design/concept-b/reviews/p1b/`.

## 1. Structure

```
┌──────────── sidebar ────────────┬──────────────── content column ─────────────────┐
│ Nemryn inverse logo (symbol in  │ AppHeader — slim context bar, 56px, no heading  │
│ the rail)                       │  Workspace / Section › Area   [bell][help][acct]│
│ [collapse toggle] (lg+ only)    ├─────────────────────────────────────────────────┤
│ nav "Primary"                   │ <main>                                          │
│  Today · Planning · Records ·   │   PageHeader — the page's ONE <h1>, description,│
│  Growth (gated) · Administration│   page actions (secondary … primary last)       │
│ workspace row (+ Switch)        │   page content                                  │
│ user row                        │                                                 │
└─────────────────────────────────┴─────────────────────────────────────────────────┘
```

Files:
- `src/components/operations/OperationsShell.tsx` (frame, the narrow-screen notice);
- `OperationsSidebar.tsx`, `GrowthNavGroup.tsx` and `nav-styles.ts`;
- `AppHeader.tsx`;
- `OperationsLayoutClient.tsx` (the header context);
- `OperationsPageHeaders.tsx` (the Overview, Dispatch, Trip Detail and Request Detail page headers, rendered by those pages);
- `src/lib/operations/nav-core.ts` (the navigation model, unit-tested).

## 2. Sidebar

| Section | Items → route (unchanged destinations) | Visibility |
|---|---|---|
| Today | Operations Brief → `/operations` · Requests → `/operations/requests` · Trips → `/operations/trips` · Dispatch → `/operations/dispatch` · Tomorrow Readiness → `/operations/tomorrow` | everyone with Operations access |
| Planning | Standing Orders → `/operations/recurring-care` | everyone |
| Records | Passengers · Facilities · Drivers · Vehicles → `/operations/fleet` | everyone |
| Growth | Dashboard · Pipeline · Contacts · Estimates & Quotes · Tasks (existing `GrowthNavGroup`) | only when the server resolved Nemryn Plus entry (`canOpenGrowth`) |
| Administration | Drive → `/driver` · Settings → `/operations/settings` | Drive: a linked driver profile; Settings: Organization Admin. The section is omitted when empty. |

Visibility rules:
- Billing and Reports stay unlinked; their routes are placeholders.
- Proof of Service is reached through the Operations Brief. The Growth Agent is reached through the Growth Dashboard.
- Visibility is a navigation convenience only. Every route and every mutation re-checks access on the server.

Section structure:
- Each section is a `<ul>` named by its label (`aria-labelledby`).
- Labels use sentence case, never ALL CAPS (typography spec §2.7).
- In the rail, labels are visually hidden but still announced, and a hairline separates the groups.

Active item:
- `aria-current="page"`.
- The `chrome.item.active.background` steel wash plus a 2px `chrome.item.active.marker` bar on the left.
- A filled icon.
- Never green or teal.
- The Operations Brief item matches `/operations` exactly; every other item matches its own sub-tree.

Widths:
- **Desktop (≥1024):** 256px expanded. A manual collapse to the 64px rail is stored in `localStorage` (`nemryn.sidebar.collapsed`) as a UI preference only, not in the database.
- **Tablet (768–1023):** always the 64px rail. There is no toggle.
- **Below 768:** no sidebar. The existing Operations notice is shown (§6).

Rail labels:
- Every item keeps an `aria-label`; the accessible name never depends on a tooltip.
- On hover and on keyboard focus, a fixed-position label appears beside the rail. It is `aria-hidden`, because it repeats the name.
- Escape, scroll, resize, blur and pointer-down hide it.
- The Growth rail button keeps its existing flyout. The rail label is hidden while the flyout has focus.

Brand assets:
- Expanded: `/brand/nemryn-logo-inverse.svg`.
- Rail: `/brand/nemryn-symbol-inverse.svg`.
- Both are the approved masters, unmodified and unstretched. No tenant logo appears in the shell.

Footer:
- The workspace row shows the workspace name and the word "Workspace".
- When the person really holds more than one workspace, it adds a **Switch workspace** link to `/select-organization?switch=1`, the same destination as the account menu.
- The user row shows the avatar, name and role.

## 3. Header and the title system

AppHeader is a slim context bar:
- 56px tall, with **no heading element**.
- On the left, a context line: `Workspace / Section › Area` (from `operationsContext`). The section part is hidden below `sm`.
- On the right, the global utilities. Notifications are Admin only; Help is role-filtered; the account menu follows. Every control is 40px.

Every page has **exactly one `<h1>`**, rendered by `PageHeader` inside `<main>`:
- Every page renders its own PageHeader. The shell and layout render no h1, so an in-shell error boundary that replaces a failing page never leaves two h1s.
- The four routes that used to take their title from the layout render a shared header from `components/operations/OperationsPageHeaders.tsx`, in every branch, with the same h1 text and the same actions:

| Route | h1 | Actions |
|---|---|---|
| `/operations` | Today's Operations (+ the org-local date) | Export Day Sheet (today) · **New Trip** |
| `/operations/dispatch` | Dispatch (+ the date, or "Tomorrow") | Export Day Sheet (the selected day) · **New Trip** |
| `/operations/trips/[id]` | Trip Detail (compact; the passenger name stays the h2) | the page's own action bar |
| `/operations/requests/[id]` | Request Detail (compact; "Request" stays the h2) | the page's own action bar |

Action order: secondary first, the one primary action last (rightmost). The existing `data-testid` hooks are unchanged; `export-day-sheet-button` is one of them.

## 4. Page canvas

- Page gutter: 16px at tablet, 24px at `lg`, and 32px at `xl`.
- The PageHeader sits 24px above the content.
- Sections are spaced 24px apart.
- Pages have no maximum width yet; wide grids such as Dispatch scroll inside their own container.

## 5. Shared visual foundations (P1b)

See `component-inventory.md`, section "NP-UI-P1b". In summary:
- Radius scale 4 / 8 / 12.
- `PageHeader` (one h1, compact size, wrapping actions).
- `Panel` padding variants plus `PanelHeader` (the card anatomy).
- `SectionHeader` levels and sizes.
- `StatTile` / `StatTileGroup`.
- `FilterBar` (layout only).
- `Dialog placement="side"` / `SidePanel`.
- A compact `EmptyState`.
- `IconButton` sizes plus a `chrome` variant.
- A single radius for all Button sizes.
- A quiet hover on form fields.

## 6. Responsive rules

| Width | Shell |
|---|---|
| ≥1440 | 256px sidebar (or the 64px rail if collapsed); 32px gutter |
| 1024–1439 | 256px sidebar (collapsible); 24px gutter |
| 768–1023 | 64px rail with focus and hover labels; 16px gutter |
| <768 (e.g. 390) | the existing Operations notice ("designed for tablet and desktop use") as the single main landmark. **A mobile Operations layout is not implemented** (roadmap D5). |

Additional rules:
- No page-level horizontal overflow is allowed at 768 or wider.
- Print views (`/day-sheet`, `/quote-print/[id]`) stay outside the shell.

## 7. Accessibility acceptance

- One `<main>`.
- Exactly one visible `<h1>` per page, and none in the header.
- Heading levels never skip.
- Nav sections are named lists.
- Visible focus everywhere.
- U1 and U2 (P1a) are preserved.
- axe: 0 serious or critical violations on the swept routes at 1440, 1024 and 768.

## 8. Brand reconciliation (Concept B → Brand Lock v1)

| Concept B element | Decision in P1b | Why |
|---|---|---|
| Richer hierarchy, section composition, card anatomy, denser Brief, refined sidebar, structured header, action prominence | **Adopted** | Concept B is authoritative for these. |
| Mockup "N" logo, operator logo in the workspace row | **Not copied.** The approved inverse logo / symbol and a neutral building glyph are used. | Locked assets (Brand Lock §7, §13). |
| Teal primary / teal active indicator | **Not copied.** Graphite / Ink primary; steel active wash + marker. | Brand Lock §9; token spec §2.7. |
| Serif display headings | **Not copied.** Geist Sans at the app scale (24 / 18 / 15). | Brand Lock §10; typography spec §2. |
| Slate / teal / mint / sand palette | **Not copied.** The existing semantic tokens only; tints come from the status `*-bg` tokens, used only for their meaning. | Brand Lock §8–9. |
| Landscape artwork, "A stronger community through better rides." | **Not copied.** | Brand Lock §17 (marketing / application boundary); no approved tagline. |
| Fictional statistics, "Service day — Operations active" tile | **Not copied.** The tiles show the page's own real counts; there is no live service-state indicator. | No supporting data; Concept B's own design notes. |
| Greeting ("Good morning, …") | **Not copied.** | The calm, restrained voice (Brand Lock §5); optional in Concept B. |
| Vehicle / map-pin icons for Trips / Dispatch | **Not copied.** Path (Trips) and NavigationArrow (Dispatch) are kept. | Brand Lock §11. |
| 12–14px card radius | **Not adopted.** Cards and panels use 8px; 12px is reserved for modals / feature cards. | Token spec §5 (D7). |
| Uppercase eyebrow ("GET STARTED WITH NEMRYN") | **Sentence case** ("Workspace setup"). | Typography spec §2.7. |
| Nav labels "Overview", "Tomorrow", "Recurring Care", "Fleet" | **Brand Lock §15 terms:** Operations Brief, Tomorrow Readiness, Standing Orders, Vehicles. Copy only; routes and code identifiers are unchanged. | Brand Lock §15. |
| Onboarding completion shown in the mockup | **Real checklist state only** (count, segments and per-step state). | Concept B's own data-accuracy gate. |
