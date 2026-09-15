# Nemryn — Marketing vs Application Separation

**Phase:** NEMRYN G1-A
**Status:** Specification only.
**Last updated:** 2026-09-07 (unchanged in G1-B — content remains current; terminology now locked in [`07-product-language.md`](./07-product-language.md) and [`11-brand-lock-v1.md`](./11-brand-lock-v1.md))
**Depends on:** [`01-brand-architecture.md`](./01-brand-architecture.md), [`03-verbal-identity.md`](./03-verbal-identity.md), [`04-visual-direction.md`](./04-visual-direction.md)

---

## 1. The rule

Nemryn has two kinds of surface and they never blend:

| | **Marketing** | **Application** |
|---|---|---|
| Audience | prospective operators evaluating Nemryn | operators (and their drivers) running their business on Nemryn, every day |
| Job | explain what Nemryn is, build trust, start a conversation | do the operational work with the least friction |
| Identity | Nemryn (platform) | Nemryn frame + operator context (see [`01`](./01-brand-architecture.md)) |
| Data shown | illustrative, sample-shaped, never a real tenant's | the operator's real operational data |
| Tone | explanatory, calm, confident (still no hype — see [`02`](./02-positioning.md)) | terse, factual, operational (see [`03`](./03-verbal-identity.md)) |
| Density | generous, editorial | comfortable-dense |
| Persuasion patterns | permitted, restrained (one clear call to action per view) | **forbidden** |
| Motion | one restrained reveal pattern, subtle | feedback only |
| Deployment | separate concern from the app (the current Zenward marketing site is already a separate repo — see `docs/product/public-marketing-separation.md`) | this repository |

**The marketing site may show parts of the product. It must never become a fake
operations dashboard. The application must never carry promotional website
language into daily operational screens.**

## 2. Marketing surfaces

Structure (indicative — not a locked sitemap; the Nemryn marketing site does not
exist yet):

| Surface | Should accomplish | Must not |
|---|---|---|
| **Homepage** | State the category ("operating infrastructure for medical transportation"), the one-sentence explanation, the maturity range, and 3–5 concrete capability claims tied to real operational outcomes. One primary action. | Be a feature dump. Use hype words. Show a fake live dashboard. Auto-play video. Use vehicle/medical stock. |
| **Product** | Explain how Nemryn works — the trip lifecycle, readiness-first, ownership, proof. Use honest product screenshots and simple lifecycle diagrams. | Reproduce the whole app in the browser. Overstate what's built. Imitate a competitor's product page. |
| **Solutions** | Speak to specific operational situations (growing from owner-operator; standing-order-heavy dialysis work; multi-facility contracts). Concrete, not personae theater. | Invent customer personas with stock headshots. Promise integrations that don't exist. |
| **Operators** | The operator-focused pitch ([`02`](./02-positioning.md) §6): fits the operation you have, grows with the one you're building. Address the "I don't need an enterprise dispatch system" objection directly. | Imply small operators get a cut-down product. Use pricing/plan language (not decided). |
| **Security** | Plainly state the platform's security posture — tenant isolation, access control, data handling, auth. Factual, verifiable, no theater. | Use fear-based copy. Claim certifications not held. Expose implementation detail that aids an attacker. |
| **Company** | Who Nemryn is, why it exists, how to contact. Brief. | Founder mythology. "We're on a mission to revolutionize…" |

Marketing may also have: legal/privacy pages, a docs/help area, a changelog, a
careers page. None is a G1 deliverable.

### Showing the product on marketing — the honesty rules

1. **Real UI or clearly-marked mockups.** A screenshot is of the actual product
   or a labelled concept — never a Photoshopped "aspirational" dashboard passed
   off as real.
2. **Sample-shaped data.** Numbers and names are plausible and obviously
   illustrative (no real passenger names, no real operator's trip counts).
3. **No interactive fake.** The marketing site does not embed a clickable pretend
   operations console. If there's an interactive demo, it is explicitly a demo
   environment.
4. **Diagrams over screenshots where the point is a concept.** "How a request
   becomes a trip" is a diagram, not a screen grab.

## 3. Application surfaces

Structure (this largely exists today, Zenward-branded; names per
[`07-product-language.md`](./07-product-language.md), pending review):

| Surface | Should accomplish | Must not |
|---|---|---|
| **Operations Brief** (currently "Overview") | The daily read: today's trips, readiness, what needs attention, a look at tomorrow. Scannable in seconds. | Become a KPI-card wall. Carry any marketing copy. Celebrate. |
| **Requests / Request Hub** | Triage inbound demand into committed trips. | Feel like an email inbox or a CRM. |
| **Trips** | The full list/detail of trips with readiness and status. | Be a bare calendar with no readiness signal. |
| **Dispatch** | Assign and adjust drivers/vehicles against the day. | Claim route optimization. Be mobile (it's tablet/desktop by design). |
| **Passengers** | Manage passenger records and mobility profiles. | Use clinical framing. Over-expose passenger data to roles that don't need it. |
| **Facilities** | Manage facility records and coordination. | Present another tenant's facilities. |
| **Drivers** | Manage driver records, invites, availability. | Surveil drivers. Show driver "dead time" as a performance score. |
| **Vehicles / Fleet** | Manage vehicles and their readiness-relevant attributes. | — |
| **Settings** | Configure the workspace: the operator's own identity, roles/access, defaults, communication templates (later). | Mix platform-account settings and operator-workspace settings without a clear line. |
| **Driver surface** (`/driver`) | A focused, larger-touch, one-handed view: today's manifest, current trip, capture pickup/drop-off. | Be the operations console shrunk down. Show operational data the driver doesn't need. |

### Anti-promotion rules for the application

1. **No marketing copy in operational screens.** No "Nemryn helps you…", no
   value propositions, no "Upgrade to unlock." Empty states state a fact
   ([`03`](./03-verbal-identity.md) §3).
2. **No persuasion patterns.** No urgency banners, no "3 people are viewing," no
   nudge toast asking for a review, no confetti, no streaks.
3. **No cross-sell inside the workflow.** If Nemryn later has add-ons, they are
   discovered in Settings, not injected into Dispatch.
4. **The only "brand" moment is the frame.** Nemryn identity lives in the nav
   frame and the sign-in screen. Operational screens are the operator's
   workspace.
5. **System messages are operational, not promotional.** "Reporting isn't
   available yet." — not "Reporting is coming soon — stay tuned!"

## 4. What legitimately crosses the boundary

- **Shared visual tokens.** Both surfaces use the same color roles, type roles,
  spacing rhythm, and the one font family — so Nemryn feels like one thing. (The
  current Zenward setup already does this; the marketing repo keeps a synced copy
  of the token layer — see `docs/product/public-marketing-separation.md`.)
- **The wordmark and logo.** Identical on both.
- **Product terminology.** A "trip" is a "trip" in a marketing diagram and in the
  app. The controlled vocabulary ([`07`](./07-product-language.md)) governs both.
- **Screenshots** (marketing → showing the app) under the honesty rules in §2.
- **Links** — marketing "sign in" / "get started" routes to the application's
  auth. That's the one functional seam.

## 5. What must NOT cross

- Real tenant data → marketing. Never.
- Marketing layout, hero patterns, or persuasion components → application.
- Application chrome (operational nav, dispatch density) → marketing pages
  pretending to be the product.
- Marketing's looser motion/reveal patterns → application.
- Any implication on marketing that unbuilt capability is shipped.

## 6. Relationship to the existing separation work

`docs/product/public-marketing-separation.md` already establishes that the
**Zenward** public marketing site is a separate repository from this application.
That architectural decision carries straight over to Nemryn:

- The Nemryn marketing site is a separate deployable, not routes inside this app.
- The token layer (colors, type, spacing) is duplicated and kept in sync, not
  imported across a repo boundary.
- This application repository contains only the operational product (operations
  console + driver surface + auth + minimal app-level routes).

G1-A does not create the Nemryn marketing repo and does not move anything.
