# Nemryn Plus — Proposed Decisions

**Work item:** NP-P0-A02 · **Date:** 2026-10-13
**Revised:** NP-P0-A02R (2026-10-13). PD-02, PD-03, PD-04, PD-08 and PD-12 were changed; PD-16 to PD-20 were added.
**Status of every entry:** PROPOSED unless marked OWNER-APPROVED or RECORDED. Recorded in [decision-register.md](./decision-register.md): PD-04 → ZD-206, PD-02 → ZD-207, PD-17 → ZD-208 (NP-P1-S1 / R2B). All others have no ZD number yet.
On approval, each accepted entry is copied into the register as the next ZD number, with `Status: CONFIRMED`.

Entries marked **OWNER-APPROVED DIRECTION** restate direction already given in the NP-P0-A02 brief. They still need formal recording.

---

### PD-01 — Plus is a module inside the existing platform; Core is the single booking door

- **Category:** Architecture
- **Decision:** Nemryn Plus lives in the existing repository, Supabase project, domain, authentication, design system and shell. Core stays the system of record for Requests, Passengers, Trips, Recurring Care and Proof of Service. Plus may create a Core Request **only** in `pending` state, through Core's own `log_transportation_request`, and never sets a Passenger, accepts a Request or creates a Trip. Core never reads or writes Plus tables.
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION)
- **Reason:** A01 found no source constraint requiring separation. A second booking path would duplicate the hardened request lifecycle (ZD-204).
- **Affected areas:** Request Hub, Plus conversion RPCs
- **Dependencies:** ZD-204
- **Review trigger:** Marketplace design (PD-13)

### PD-02 — Plus entitlement is separate from `organizations.status` *(revised A02R)*

- **Category:** Architecture / Commercial
- **Decision:** `organization_modules (organization_id, module='plus', status, restriction, trial_ends_at, access_ends_at)`, with statuses `trial | active | expired | cancelled | disabled`. The effective state is computed at read time:

  | Stored state | Effective state |
  |---|---|
  | `trial` (until `trial_ends_at`), `active` (until `access_ends_at`, if set) | `write` |
  | elapsed trial or period, `expired`, `cancelled`, `disabled` + `restriction = 'read_only'` | `read_only` (Organization Admin keeps history read + export; writes, automations and the public inquiry form stop) |
  | `disabled` + `restriction = 'no_access'` (security / abuse) | `locked` (no tenant read at all; data retained) |
  | no row | `none` |

  Only Platform Admin RPCs write it. No Core function references it, so **no Plus state can affect Core operations**.
- **Status:** **OWNER-APPROVED — RECORDED AS ZD-207** (NP-P1-S1-R2B, 2026-10-13). History: PROPOSED (owner-approved direction; A02R added `restriction` / `locked`).
- **Changed from A02:** A02 treated `disabled` as read-only only. A02R adds the stronger `no_access` restriction for security cases.
- **NP-P1-S1:** implemented as a working requirement (migration `20261013100000`), then formally approved by the owner (NP-P1-S1-R2B), including: Platform Admin controls Plus, the four effective states, no Plus change can suspend Core, and Organization Admins cannot grant or extend their own Plus.
- **Review trigger:** Billing provider integration (NP-P5)

### PD-03 — Plus access: Admin-only for technical testing, named-staff grants before beta *(revised A02R)*

- **Category:** Security / Product
- **Decision:**
  - **P1-S1/S2 (technical testing):** Organization Admin only.
  - **From P1-S3** (moved from NP-P5): explicit `membership_module_grants` (`read` / `write`) let an Admin give Plus to named Dispatchers without changing their role.
  - Grant holders lose access when the entitlement is not `write`. Historical export stays Admin-only.
  - Admin-only Plus settings (grants, inquiry-form publishing) require `organization_admin`.
  - **A salesperson is never made an Organization Admin to reach the CRM.**
  - A growth-only role is a separate decision (PD-18).
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION; A02R moves grants earlier)
- **Known limitation until PD-18:** a non-admin salesperson must be a Dispatcher with a grant, which is still an operational role.

### PD-04 — Mount the Growth surface at `/operations/growth`

- **Category:** Architecture / UX
- **Decision:** Growth pages live at `/operations/growth/*` with their own `layout.tsx` calling `requirePlusAccess`. The module boundary lives in code (`src/lib/plus/*`, `src/components/growth/*`, `plus_*` tables and RPCs).
- **Status:** **OWNER-APPROVED** (NP-P0-A02R brief: "Preserve `/operations/growth` route structure") — **recorded as ZD-206** (NP-P1-S1).
- **Reason:** single Operations layout, guard and pathname-driven shell (`src/app/operations/layout.tsx`; `src/components/operations/OperationsLayoutClient.tsx:13-28, 96-150`).
- **Follow-on constraint (A02R):** if PD-18 introduces growth-only members, the Operations layout guard must become path-aware (access model §2.3).

### PD-05 — One opportunity table with two channels and fixed stages

- **Category:** Product / Data
- **Decision:** `plus_opportunities.channel in ('private_pay','facility')`, with closed stage sets per channel and no configurable pipelines.
  - Private-pay stores stages up to `converted` / `lost`. After conversion, the displayed stage (Booking pending / Booked / Served / Declined / Cancelled) is **derived** from Core facts at read time.
  - A customer's later bookings are rebookings linked to the contact, not new opportunities.
- **Status:** PROPOSED
- **Reason:** Smallest model; no Core triggers; avoids a generic CRM builder.

### PD-06 — One attribution row per Request, with independent dimensions

- **Category:** Data
- **Decision:** Replace the audit's `plus_opportunity_requests` with `plus_request_attributions (request_id PRIMARY KEY, contact_id?, opportunity_id?, referral_account_id?)`.
  - A Request is attributed at most once.
  - Private-pay booking credit and facility-referral credit coexist on the same row.
  - Reports count a Request once per dimension and never sum across dimensions.
- **Status:** PROPOSED
- **Reason:** Resolves the conflict between preventing duplicate financial reporting and supporting both kinds of attribution (domain model §8.1).

### PD-07 — Facility commercial stages are independent of trip outcomes

- **Category:** Product
- **Decision:** A facility opportunity is won or lost only by staff decision. No Trip, Request decline or completion changes a facility stage. Account performance is reported separately as:
  - **(a)** referred volume (Requests with `referral_account_id`), and
  - **(b)** location volume (Trips whose pickup or destination facility is linked to the account).
  These two are never summed.
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION)

### PD-08 — Staged quotations; Core will own pricing rules *(revised A02R)*

- **Category:** Product / Data
- **Decision:**
  - **Q1 (P2-S5, private-pay MVP):** structured, staff-created estimates and quotes (`plus_quotes`: fixed line columns, server-computed total, immutable once sent, supersede on revision), labelled Estimate / Quote and never invoice or payment. Acceptance changes only the opportunity stage.
  - **Q2 (after pricing design approval):** Core-owned, versioned `organization_pricing_rules` prefill the Q1 lines; staff overrides are recorded.
  - **Q3:** online payment is a separate decision (PD-09).
  - **No billing system** is part of Plus.
- **Status:** PROPOSED — Q1 is ready to approve; Q2 **needs an owner pricing-scope decision**.
- **Changed from A02:** A02 deferred all quote storage until pricing rules existed. A02R ships staff quotes first.
- **Dependencies:** ZS-021 (billing workflow UNKNOWN) for Q2/Q3 only.

### PD-09 — Payment status in Plus is staff-reported only; online payments deferred

- **Category:** Commercial / Security
- **Decision:** `payment_reported_status` (`none|deposit_reported|paid_reported|refund_reported`) is labelled "reported by staff" everywhere and is never presented as settlement or used as revenue.
  - Online card payments wait for a hosted payment-provider design: no card data in Nemryn, PCI SAQ-A scope.
  - Ride payments and operator subscription billing stay on separate ledgers and separate provider accounts.
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION)

### PD-10 — HIPAA/BAA is a gate before real customer data

- **Category:** Compliance
- **Decision:** No production Plus entitlement for a real operator, and no real private-pay customer data in Plus, until HIPAA applicability is determined and the required BAAs (Supabase, Vercel, Resend, plus any later vendor) are confirmed. Synthetic data only before then. Nemryn makes no HIPAA compliance claim (`docs/commercial/sales-claims-boundary.md:11`).
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION) — **gate is OPEN**

### PD-11 — CRM personal-data retention and erasure policy

- **Category:** Compliance / Product
- **Decision needed:** how long archived contacts are kept, whether erasure requests are honoured by redaction (keeping attribution counts) or deletion, and what export format the read-only state provides.
- **Proposed default:** redaction RPC (name/phone/email → "Redacted contact"), keeping ids and links. CSV export for the Organization Admin.
- **A02R addition:** also decide the automatic purge period for `spam` / `dismissed` web inquiries (`plus_inquiries`), and for the Plus inquiry rate-limit ledger. Core's existing intake rate-limit ledger has no purge either (`20260919120000…:77-93`). P2-S7 accepts no real submissions until this is decided.
- **Status:** PROPOSED — **needs owner + counsel decision before NP-P2 production use**

### PD-12 — Core public intake stays unchanged; a separate Plus inquiry form ships in the private-pay MVP *(revised A02R)*

- **Category:** Product / Security
- **Decision:**
  - Non-booking web inquiries use a **separate Plus inquiry boundary** (P2-S7): its own publication, tables, rate-limit ledger, service-role RPCs, route handler and pages.
  - A submission lands only in `plus_inquiries` (a triage inbox). Staff convert it to a Contact + Opportunity, or dismiss it. **Nothing auto-creates a Contact, Opportunity, Core Request, Passenger or Trip.**
  - `_create_public_request`, `submit_public_form_request`, `submit_public_transportation_request`, the Core rate-limit function and table, and `src/lib/public-intake/*` are not modified.
  - The only shared files touched are `src/proxy.ts` and `next.config.ts`, for path and header rules, with review.
  - Real submissions are accepted only after PD-10 and PD-11 close.
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION)
- **Changed from A02:** the inquiry form moved from "later candidate / NP-P4" into NP-P2. Submissions go to an inbox rather than directly into contacts.

### PD-13 — Marketplace scope status

- **Category:** Scope
- **Decision needed:** the scope register lists ZS-035 "Provider marketplace" as **EXPLICITLY EXCLUDED**. The product direction names a future marketplace.
- **Proposal:** reclassify it to FUTURE with "architecture and public-provider data contract only (NP-P6); no marketplace build without a further explicit decision".
- **Status:** PROPOSED — **needs owner decision**

### PD-14 — Plus does not depend on Vleeds

- **Category:** Architecture
- **Decision:** No Plus feature requires Vleeds. Any later import of Vleeds leads goes through the same staff-reviewed contact/opportunity creation RPCs, as an optional integration.
- **Status:** PROPOSED (OWNER-APPROVED DIRECTION)

### PD-15 — No ad pixels or outbound conversion uploads in the beta

- **Category:** Privacy
- **Decision:** Attribution stays inbound (UTM / referrer host / landing path). There are no tracking scripts on authenticated, form or driver pages, and no outbound conversion APIs. Revisit only after PD-10, and with no health-adjacent fields (e.g. `service_type`).
- **Status:** PROPOSED

### PD-16 — Inquiry form bot protection and alerts

- **Category:** Security / Product
- **Decision needed:**
  - **(a)** Whether to add a challenge provider (e.g. Cloudflare Turnstile, a new vendor) on top of honeypot + fill time + rate limits for the Plus inquiry form.
  - **(b)** Whether new-inquiry staff email alerts are needed in the MVP. That requires adding an event type to Core `notification_events` (a Core CHECK change); otherwise the MVP shows an in-app count only.
- **Proposal:** v1 without a challenge provider (measure spam on synthetic and early tenants); alerts deferred to NP-P4.
- **Status:** PROPOSED — needs owner decision

### PD-17 — Trial duration

- **Category:** Commercial
- **Decision:** default trial **14 days** (platform constant). A Platform Admin may choose 7–30 days at grant time and extend a running trial up to 30 additional days, with a required reason and an audit event. At the end the state becomes `read_only` automatically (computed), never `locked`. Core is unaffected.
- **Status:** **OWNER-APPROVED — RECORDED AS ZD-208** (NP-P1-S1-R2B, 2026-10-13): 14-day default, 7–30 initial, one extension of up to 30 days, one trial per organization with no automatic regrant, and every meaningful change audited. History: PROPOSED — owner to confirm 14 / 7–30 / +30 (replaced the A02 90-day cap); **NP-P1-S1** implemented it as a working requirement and added the one-trial rule: `trial_started_at` is never cleared, so a running trial is never restarted and a consumed trial is never re-granted; a regrant needs a separately approved procedure.

### PD-18 — Growth-only staff members

- **Category:** Security / Core change
- **Decision needed:** whether to add a `growth` membership role (in the `memberships.role` and `staff_invites.role` CHECKs) for salespeople with **no** Core operational access.
- **If approved (P2-S9, before the commercial beta):**
  - a full `has_org_role` caller audit;
  - a path-aware Operations layout guard (a growth member may open only `/operations/growth/*` and their own access settings);
  - a Growth-only sidebar;
  - "Send to Operations" instead of conversion, because growth members cannot create Core Requests.
- **If not approved:** the commercial beta accepts that non-admin salespeople are Dispatchers with a Plus grant.
- **Status:** PROPOSED — needs owner decision; **Core authorization change**

### PD-19 — Consent ledger moves into the private-pay MVP

- **Category:** Privacy
- **Decision:** `plus_communication_consents` ships in P2-S6, before the web inquiry form that captures consent. Recording only; sending stays NP-P4. A follow-up consent never implies marketing consent.
- **Status:** PROPOSED

### PD-20 — Additive Core constraint for member grants

- **Category:** Data / Core change
- **Decision:** P1-S3 adds `unique (id, organization_id)` to Core `memberships`, so `membership_module_grants` can use the tenant-isolating composite FK convention. Verified in A02R: today only PK `id` and `unique (organization_id, user_id)` exist, and no table references `memberships`. The constraint cannot fail and changes no row, policy or function.
- **Status:** PROPOSED — needs reviewer acknowledgement as the one Core schema touch in NP-P1
