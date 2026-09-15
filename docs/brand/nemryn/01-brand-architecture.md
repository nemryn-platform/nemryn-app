# Nemryn — Brand Architecture

**Phase:** NEMRYN G1-A (architecture LOCKED in G1-B — Brand Lock)
**Status:** As of G1-B the platform/tenant architecture and the surface identity matrix (§3A) are **locked** — see [`11-brand-lock-v1.md`](./11-brand-lock-v1.md). Still specification only; nothing applied to the application.
**Last updated:** 2026-09-07 (G1-B revision)
**Depends on:** [`00-brand-foundation.md`](./00-brand-foundation.md)

---

## 1. The two identities

There are exactly two kinds of brand identity in this system. Keep them separate
at all times.

### PLATFORM IDENTITY — Nemryn

The software company and the product. Owns:

- the product's name, wordmark, palette, typography, iconography, voice;
- the marketing website;
- the authentication surface (sign in / sign up / confirmation / recovery);
- the application shell (the frame around every operational screen — global nav,
  headers, system messages, settings chrome);
- system-generated, operator-neutral communication (e.g. "your Nemryn account",
  security notifications about the account itself).

### TENANT IDENTITY — the operator (e.g. Zenward Mobility)

An NEMT business that uses Nemryn to run its operation. Owns:

- its own legal/trade name, and (where the product later supports it) its own
  logo and display name shown inside its workspace and on documents it produces;
- the content of its operational data — trips, requests, passengers, drivers,
  facilities;
- communication that goes out **as the operator** — to that operator's
  passengers, drivers, and partner facilities (e.g. "Your ride with Zenward
  Mobility is confirmed").

Zenward Mobility is **the first tenant**. It is a real NEMT operator today and
becomes Nemryn's first customer. Its brand does not disappear; it moves from
"the whole app" to "one organization inside the app."

## 2. The relationship, stated plainly

```
Nemryn  (platform / software company)
│
├── Tenant: Zenward Mobility        — first customer; NEMT operator in Georgia
├── Tenant: Future Operator A       — independent NEMT business, separate data, separate identity
├── Tenant: Future Operator B       — independent NEMT business, separate data, separate identity
└── Tenant: ...
```

- Tenants are **peers**. Zenward Mobility has no special status in the product
  beyond being onboarded first. It is not a co-brand, not a parent, not a
  sub-brand of Nemryn.
- Tenants are **isolated**. One tenant never sees another's data, identity, or
  existence. (This is already true in the codebase's tenancy/RLS model and is
  **not** changed by branding work — see [`10-brand-implementation-boundaries.md`](./10-brand-implementation-boundaries.md).)
- "Future Operator A / B" are **illustrative placeholders**, not planned
  accounts. Do not build anything named for them.

## 3. Which identity appears where

> **G1-B note.** This §3 table is the original G1-A conceptual pass. The
> **authoritative, resolved matrix is §3A below** (locked in G1-B). Where they
> differ, §3A wins.

This table is the authority for "whose name/logo/voice belongs on this surface."
"Does not exist yet" means the surface is not built — the row states the intended
rule for when it is, and nothing should be implemented from it now.

| Surface | Primary identity | Tenant identity present? | Notes |
|---|---|---|---|
| **Nemryn marketing website** | Nemryn | No | Pure platform. May *show* the product; never shows real tenant data. May name Zenward Mobility only as a named customer/case study, with permission, clearly labelled as a customer. Does not exist yet. |
| **Nemryn login / sign-up / email confirmation / password recovery** | Nemryn | No | This is account access to the *platform*. A user signs into Nemryn, then resolves into one or more operator workspaces. The auth screens carry Nemryn identity, not any operator's. Resolved in §3A / §4: one Nemryn sign-in, no operator-branded login in v1. |
| **Application shell** (global nav, top bar, system chrome, settings frame) | Nemryn | Secondary, contextual | The frame is Nemryn. The current workspace's operator name is shown as *context* (e.g. in the org switcher and workspace header), not as the brand of the frame. |
| **Organization / workspace selector** | Nemryn (the chrome) | Yes (as list content) | Lists the operator workspaces the signed-in user can enter, each by its own operator name. The selector itself is Nemryn UI. |
| **Inside an operational screen** (Operations Brief, Requests, Trips, Dispatch, etc.) | Neither, mostly | Operator context in the header only | Daily operational screens are a workspace. They should read as "this operator's operation," with Nemryn present only as restrained product chrome. No Nemryn marketing, no Nemryn logo watermark. |
| **Tenant settings** | Nemryn (the settings framework) | Yes (the operator configures its own identity here) | Where an operator sets its display name, and later its logo, service-area defaults, communication templates, etc. Does not exist yet in its branded form. |
| **Customer-generated reports / documents** (proof of service, trip manifests, invoices, exports) | **Operator** | Yes — primary | A document an operator produces for a facility, a payer, or its own records represents *the operator*, not Nemryn. Operator name/logo is primary. A small, tasteful "Made with Nemryn" / "Generated by Nemryn" mark is acceptable but must never dominate. Does not exist yet — reports and billing are stubs. |
| **Passenger-facing communications** (trip confirmations, reminders, "your driver is on the way") | **Operator** | Yes — primary | The passenger has a relationship with their transportation provider, not with Nemryn. These messages go out as the operator. Nemryn is invisible or a tiny footer attribution at most. Does not exist yet. |
| **Driver-facing communications & the driver surface** | Operator (identity) on a Nemryn (frame) | Yes | A driver works for an operator. The driver app frame is Nemryn product UI; the identity the driver sees ("you're driving for Zenward Mobility") is the operator's. Resolved in §3A: the current "Zenward Driver" fallback becomes operator-contextual or plain "Driver"; see [`15-rebrand-inventory.md`](./15-rebrand-inventory.md). |
| **Operator-specific internal communication** (operator's own staff messaging, internal notes) | Operator context, Nemryn frame | Yes | Internal to one operator; no cross-tenant or platform branding concern beyond the standard shell. |
| **System / security messaging about the platform account** (e.g. "a new device signed in to your Nemryn account", billing for the Nemryn subscription) | Nemryn | No | This concerns the platform relationship, not any operator's operation. |
| **System / security messaging about operational data** (e.g. an audit note, an access-denied state) | Nemryn chrome, operator context | Yes | The message is product UI; the data it concerns belongs to an operator. |

## 3A. Surface identity matrix — RESOLVED (LOCKED, G1-B)

The authoritative resolution. "Does not exist yet" still means the surface is
unbuilt; the rule applies when it is built. Nothing here is implemented in G1-B.

| Surface | Identity shown | Detail |
|---|---|---|
| **Marketing website** | **Nemryn** | Pure platform. May *show* the product with sample data; never real tenant data. Zenward Mobility may appear only as a named, permissioned customer reference. |
| **Sign in** | **Nemryn only** | One Nemryn sign-in. No operator-branded login, no `app.nemryn.com/<operator>` entry in v1. |
| **Sign up** | **Nemryn only** | Platform account creation. |
| **Auth confirmation / verification / error** | **Nemryn only** | e.g. `/auth/confirm`, `/auth/auth-code-error`, "link expired". |
| **Password / account recovery** | **Nemryn only** | (Recovery is not built in this phase; the rule stands for when it is.) |
| **Workspace selector** | **Nemryn frame + workspace names** | The chrome is Nemryn; the list shows each workspace by its operator name. Shown when the signed-in user has more than one active workspace. One active workspace → enter it directly. |
| **Driver invite** (`/join/[token]`) | **Nemryn frame + explicit tenant context** | Restrained wording that names the organization the invitee is joining — e.g. "You're joining {Organization Name}" / "You've been invited to drive for {Organization Name}". The frame/chrome is Nemryn; the operator is named as context. |
| **Onboarding** | **Nemryn frame; workspace context once known** | Nemryn frame throughout. The organization/workspace name appears once it exists/is known (it already does — `onboarding/layout.tsx` shows `organization.organizationName`). |
| **Operations application shell** | **Nemryn platform mark + current workspace name** | The global frame carries the Nemryn wordmark/mark; the current workspace (operator) name is shown as context (the app already renders `organizationName` in `AppHeader`). **No operator logo customization in v1.** |
| **Inside operational screens** | Neither, mostly — operator context in the header | Reads as the operator's workspace; Nemryn only as restrained chrome. No Nemryn marketing, no Nemryn logo watermark. |
| **Tenant/workspace settings** | Nemryn framework; operator configures its own **display name** | Operator sets its display name (supported v1). Operator **logo upload is deferred** past v1. |
| **Driver surface** (`/driver`) | Nemryn product frame + operator context | A driver works *for an operator*. Frame is Nemryn UI; identity the driver sees is the operator's. The current hard-coded "Zenward Driver" fallback becomes operator-contextual or plain "Driver" — never "Nemryn Driver". |
| **Passenger-facing operator communication** | **Operator** (primary) | The passenger's relationship is with their transportation provider. Goes out as the operator. No "Powered by / Generated by Nemryn" required in v1. Does not exist yet. |
| **Facility-facing operator communication** | **Operator** (primary) | Same as passenger-facing. Does not exist yet. |
| **Operator-generated operational documents** (proof of service, manifests, invoices, exports) | **Operator** (primary) | Represent the operator. No mandatory "Powered by Nemryn" / "Generated by Nemryn" in v1. Nemryn attribution may appear internally in metadata or an administrative surface where useful, but must not compete with the operator's outward identity. Does not exist yet (reports/billing are stubs). |
| **Platform security / account email** (new-device sign-in, password changed, platform billing) | **Nemryn only** | Concerns the platform relationship, not any operator's operation. |
| **System messages about operational data** (audit note, access-denied) | Nemryn chrome, operator context | Product UI; the data belongs to an operator. |

### Where the Zenward Mobility logo remains legitimate after the rebrand

`public/images/zenward-mobility-logo.png` is a **tenant asset**. After the
rebrand it is legitimate **only as Zenward Mobility's own operator identity**,
and only in places where a tenant's identity legitimately appears:

- Zenward Mobility's own outward operator communications (passenger-, facility-,
  driver-facing) and operator-generated documents — **if/when** operator logos
  are supported there (deferred past v1; operator *name* is used in the interim).
- Anywhere Zenward Mobility, as a customer, presents itself — its own marketing,
  its own materials (outside this repo).

It is **not** legitimate as:

- any platform surface (sign in / sign up / auth / marketing / app shell /
  onboarding chrome / workspace selector) — those carry the **Nemryn** mark;
- a default shown to *other* future tenants;
- an in-app operator-logo feature in v1 (that feature is deferred).

Nemryn does **not** redesign the Zenward Mobility logo. Zenward Mobility retains
its existing mark as the first tenant's identity.

## 4. Architecture decisions — RESOLVED (LOCKED, G1-B)

The G1-A open questions are answered. See [`11-brand-lock-v1.md`](./11-brand-lock-v1.md)
for the full lock statement.

1. **Login entry — LOCKED:** one Nemryn sign-in. After authentication: one active
   workspace → enter it; multiple → workspace selector. A "remembered workspace"
   convenience may be considered later. **No operator-branded login URLs in v1.
   `app.nemryn.com/<operator>` is not the architecture.**
2. **Operator branding in v1 — LOCKED:** operator **display name** is supported as
   workspace context. Custom operator **logos inside the application are
   deferred**. Zenward Mobility retains its existing logo as the first tenant's
   identity; Nemryn does not redesign it.
3. **Attribution on operator documents — LOCKED:** passenger-, facility-, and
   operator-generated operational documents are **primarily branded by the
   operator**. **No "Powered by Nemryn" / "Generated by Nemryn" is required** on
   those in v1. Nemryn attribution may exist internally in metadata or
   administrative surfaces where useful, never competing with the operator's
   outward identity.
4. **Zenward Mobility logo asset — LOCKED:** it is a tenant asset; Zenward
   Mobility keeps its current mark; Nemryn does not redesign it. See §3A above
   for where it remains legitimate.
5. **Container terminology — LOCKED:** customer-facing UI says **workspace**;
   technical / admin / data-architecture context says **organization**. The
   underlying database concept (`organizations`) is **not renamed**. A user signs
   into a **Nemryn account**.

### Still open (architecture)

- Whether/when a "remembered workspace" or last-used-workspace shortcut is added
  (post-v1 convenience; not blocking).
- The exact division of "platform account settings" vs "workspace settings" in
  the settings information architecture (a design question for the settings
  build).
- Whether operator logo support is added in a later, defined version (v2+), and
  what surfaces it would reach.

## 5. What G1-B does NOT decide

- No visual design of any surface above (that is G1-C onward).
- No routing, subdomain, or auth-flow implementation.
- No change to the `organizations` table, tenancy model, or RLS. The data-level
  meaning of "tenant" already exists and is correct; branding rides on top of it.
- Nothing about pricing, plans, or contracts.
- Domain ownership — see [`11-brand-lock-v1.md`](./11-brand-lock-v1.md) §Domain
  (registrar status requires separate human verification).
