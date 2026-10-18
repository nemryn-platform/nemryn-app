# Nemryn Plus — Product Specification (PROPOSED)

**Work item:** NP-P0-A02, refined in NP-P0-A02R · **Status:** PROPOSED — for owner review; nothing is implemented · **Date:** 2026-10-13
**Read with:** [plus-domain-model.md](./plus-domain-model.md) · [../security/plus-access-model.md](../security/plus-access-model.md) · [plus-decisions-proposed.md](./plus-decisions-proposed.md) · [NP-P1-S1-entitlement-implementation-brief.md](./NP-P1-S1-entitlement-implementation-brief.md)
**Evidence base:** `docs/reports/NP-P0-A01-nemryn-plus-architecture-audit.txt` and source at `83506b0`.

---

## 1. What Plus is (and is not)

**Nemryn Plus** is a premium module for NEMT operators that helps them win and keep customers through two equally important channels:

- **Facility / B2B:** hospitals, dialysis centers, rehab centers, SNFs and nursing homes, and their discharge planners and care coordinators.
- **Private-pay / B2C:** seniors, family caregivers, wheelchair and ambulatory riders, hospital discharges, and recurring private-pay riders.

Plus manages inquiries, follow-ups, quotes, conversion into bookings, and the customer relationship. **Confirmed transportation is always handled by Nemryn Core** (Request Hub → Trips → Dispatch → Driver → Proof of Service).

**Plus is not:**
- a generic CRM builder (no custom objects, custom pipelines, workflow builder or website builder);
- a lead-generation service;
- a second booking system;
- a marketing-automation platform in the beta;
- dependent on Vleeds;
- the marketplace.

**Honesty rule for sales and in-product copy:** Plus helps an operator *organize and convert* demand. It does not by itself *generate* demand. No copy may promise more customers, rides or revenue from subscribing.

## 2. Product principles

1. **One booking door.** Plus can create only a `pending` Request. Core decides everything after that (PD-01).
2. **Facts from Core, intent in Plus.** After conversion, Plus *shows* Core outcomes; it never stores a copy that can drift (PD-05).
3. **Minimum necessary.** No medical or assistance detail in Plus (access model §5).
4. **NEMT vocabulary.** Service types, decline reasons and facility kinds come from Core's closed sets.
5. **Progressive and calm.** Plus follows Core's "no dead controls" and "no fabricated activity" rules (scope register ZS-038/039; UX1 "no dead controls" rule).

---

## 3. Users and access (summary)

| User | Access |
|---|---|
| Organization Admin of an entitled organization | Full Plus while the effective entitlement is `write`; read + export while `read_only`; nothing (with a "restricted" notice) while `locked` |
| Dispatcher with a named **Plus grant** (from P1-S3) | Plus read or read/write as granted, while the entitlement is `write`. Can convert opportunities, because they hold the Core role |
| Dispatcher without a grant | None. Dispatchers never get Plus automatically |
| Growth-only member (PD-18, owner decision, before commercial beta) | Plus as granted; **no** Core operational access; cannot create Core Requests |
| Driver | None |
| Platform Admin | Manages the entitlement; sees no tenant CRM content |

A salesperson is **never** made an Organization Admin just to reach the CRM. Full detail: [plus-access-model.md](../security/plus-access-model.md) §2–3.

---

## 4. Private-pay acquisition

### 4.1 Inquiry stage

| Inquiry | How it enters Nemryn | Creates a Core Request? |
|---|---|---|
| Phone call ("how much to dialysis?", "do you do wheelchairs?") | Staff create **Contact + private-pay Opportunity** (`inquiry_type`, `source = phone`) | **No** |
| Email inquiry | Same, `source = email` | No |
| **Website question that is not a booking** (price, availability, wheelchair service) | **Plus inquiry form** (P2-S7, §4.2) → **Inquiries to review** → staff convert to Contact + Opportunity, or dismiss | **No** |
| Website **booking** form (existing Core hosted / embed / developer API) | Unchanged: lands in the Request Hub as `pending` with its acquisition snapshot. A Plus user uses **Track in Plus** on the Request | Yes (by Core, as today) |
| Referral (discharge planner, physician office, family) | Opportunity with `source = referral` and `source_detail`. From P3, also `referral_account_id` | No (until conversion) |
| Advertising / landing page | Links to either form carry UTM parameters, which both capture. Phone leads: staff choose `source = advertising` and an optional `campaign_code` | Depends on the form |

**Why the Core form is not extended (unchanged study result, PD-12):**
- `submit_public_form_request` always creates a `transportation_requests` row through `_create_public_request` (`20260921140000_website_request_form_publication.sql:152, 787`; `20260921150000_website_connection_lifecycle.sql:593`).
- Its required fields describe a booking.
- Extending it would either push non-bookings into the Request Hub or change the most hardened path in Core.
- The non-booking inquiry is therefore a **separate Plus capability**.

### 4.2 Plus inquiry form (P2-S7 — part of the private-pay MVP)

**Purpose:** let a family member or rider ask a question online without making a booking.

**Prerequisites** (all must exist first):
- contacts and opportunities (P1-S4, P2-S1);
- named-staff access (P1-S3);
- the consent ledger (P2-S6).

**Gate:** real submissions are accepted **only** after PD-10 (HIPAA/BAA) and PD-11 (retention) close. Before then it runs on synthetic tenants only.

| Aspect | Specification |
|---|---|
| Surfaces | Hosted page `/inquiry/<publicKey>` and embed `/embed/inquiry/<publicKey>`, styled like the Core request form (same design system, organization name shown, "Powered by Nemryn" as on the Core form) |
| Publication | Settings → Nemryn Plus → **Inquiry form** (Organization Admin): headline, short intro, which offered service types to list, Publish / Disable, copy link / embed code. Publishing requires the effective state `write` |
| Fields | Name; phone and/or email; "I am asking for" (myself / a family member / someone I care for / as facility staff / other); question type (price / availability / is this service offered / interested in booking / other); service type (the organization's offered list); optional ZIP code; timeframe (as soon as possible / this week / this month / later / not sure); question (≤ 500, "Please don't include medical details") |
| Consent | Required: "You may contact me about this inquiry by phone or email." Optional, unticked: "Send me news and offers from <organization>." Both are versioned |
| After submit | "Thanks — <organization> will get back to you." No booking promise, no reference number |
| Staff side | Pipeline → Private-pay → **Inquiries to review**: list with Convert (creates or links a Contact, and creates an Opportunity with `source = web_inquiry`) or Dismiss (reason: spam / duplicate / not relevant / other). Growth Overview shows the count of new inquiries |
| Never | Auto-creates a Contact, Opportunity, Core Request, Passenger or Trip; asks for addresses, dates of birth, diagnoses or insurance |
| Security | Separate submission boundary, own rate-limit ledger, tenant from the published key only, honeypot + fill time, uniform responses ([access model §6b](../security/plus-access-model.md)) |
| When it stops | Unpublished, organization suspended, or Plus not in `write` (elapsed trial, expired, cancelled, any disable) → the page shows the neutral "This form isn't available" |

### 4.3 Pipeline

Stored stages: **New inquiry → Contacted → Qualified → Quote sent → Quote accepted → Converted**, plus **Lost** (reason required).

After conversion the card shows the **derived Core outcome**:

| Shown | Meaning (from Core) |
|---|---|
| Booking pending | the Request awaits the dispatcher's Accept / Decline |
| Booked | the Request is accepted (or has a linked Trip or arrangement) |
| Served | at least one linked Trip is completed |
| Declined by operator | Core declined it; the Core reason is shown |
| Cancelled | Core cancelled it; the Core reason is shown |

Rules:
- Skipping forward is allowed.
- Reopening a Converted or Lost opportunity requires a reason.
- A Core decline does not auto-mark the opportunity Lost.
- Sending a quote record (§4.5) moves the stage to Quote sent automatically.
- The private-pay and facility pipelines are separate: one table, separate channels and stage sets, shown as separate tabs.

**Opportunity vs repeat bookings:**
- The opportunity is the effort to win the first booking.
- Later bookings are **rebookings** on the Contact.
- Standing schedules use **Core Recurring Care**. Plus has no recurrence engine.

### 4.4 Conversion: Contact → Opportunity → Request → Passenger → Trip

1. **Contact → Opportunity:** created in Plus, or by converting a web inquiry.
2. **Opportunity → Request:** **Convert to booking request**.
   - Available to Admins and to Dispatchers with a Plus write grant. A growth-only member sees "Send to Operations" instead: a task assigned to an Admin or Dispatcher. A growth member never creates Core work.
   - The form collects Core's operational minimum. Requester details are copied from the Contact.
   - Result: one `pending` Request in the Request Hub. It is replay-safe.
3. **Request → Passenger:** Core only (`link_request_passenger`). Plus never guesses a Passenger.
4. **Request → Trip:** Core only.

> **NP-P2-S4 implementation notes (local):**
> - **Opportunity → "Create transportation request"** is shown to writers (Admins and write-grant Dispatchers, both holding the Core request role) on an **open** opportunity whose contact is active and which has **no Request linked yet**.
>   - Flow: a two-step form (details, then review, then confirm).
>   - Requester name, phone and email are copied from the contact; a phone is required by Core. Who is requesting, pickup, destination, preferred date/time, return trip, assistance and notes are staff input, stored **only in Core**.
>   - The Core source is mapped from the opportunity's source.
>   - The result is **one pending Request** created by Core's `log_transportation_request` as the staff member. The opportunity becomes **Converted**, and the confirmation reads "Transportation request created. Awaiting Operations review." with a link to the Request.
> - **Contact → "Create another transportation request" (rebooking)** creates one new pending Request for the contact. Staff choose the source. No opportunity is created or changed, and nothing is copied from earlier Requests.
> - **Replay-safe:** one key per opened form. A double click or a retry after a timeout returns the same Request, never a second one.
> - **Never:** no Passenger link, Trip, recurring arrangement, payment or confirmation is created. Operations decides from there.
> - An opportunity already linked (P2-S3) to an existing Request is **not** converted again. Staff are pointed to that Request.
> - Quotes are **not** required for conversion: quote-based eligibility is not approved.
> - **Do-not-contact reminder (OD-6, NP-P2-S4-R3):** when the contact's stored `do_not_contact` preference is set, both forms show "This person asked not to be contacted" with "Create this request only if they asked for this ride…". It is a reminder only: the Request is not blocked, nothing is sent, and the preference is never inferred from activity. Per-channel consent remains P2-S6.
> - **Service type (OD-2 -> NP-P2-S4.1-S2):** conversion passes the opportunity's own service to the Core Request (NULL stays NULL; never inferred or overridden in the dialog, where Review shows it read-only). Rebooking offers an optional **"Service requested"**, defaulting to "Not specified", with Core's nine services filtered by the organization's configured Services (all nine when none are configured; only "Not specified" plus a short note if they can't be loaded). The database accepts any canonical service from authorized staff (OD-S1 = A). Plus opportunities still offer eight services; airport is deferred (OD-S4).

### 4.5 Quotes and payments (staged — PD-08 revised)

| Stage | When | What |
|---|---|---|
| **Q1 — Staff estimates & quotes** | P2-S5 (private-pay MVP) | Structured record per opportunity: estimate (non-binding) or quote (valid until a date). Lines are entered by staff: base fare, miles + mileage charge, wheelchair, additional assistance, waiting, return leg / round trip, other (labelled), discount. The total is computed by the server. Draft → Sent → Accepted / Declined / Expired; a revision supersedes. Printable view for staff to read or share. **Labelled "Estimate" or "Quote", never "Invoice" or "Payment".** Acceptance changes only the opportunity stage |
| **Q2 — Rule-based pricing** | After the pricing design is approved (PD-08) | Core-owned `organization_pricing_rules` (versioned) + a calculation that prefills Q1 lines. Staff may override, and overrides are recorded. Core owns the rules because dispatch, billing and any future marketplace need the same prices |
| **Q3 — Online payment** | Separate decision (PD-09) | Hosted payment-provider flow; separate ledger; not a billing system |

**Payment status** remains a separate, staff-reported field (None / Deposit reported / Paid reported / Refund reported). It is never revenue or settlement evidence and is never derived from a quote. No invoicing or billing is added in Plus.

### 4.6 Retention

- **Contact history:** every attributed Request with its derived outcome, plus linked Recurring Care status.
- **Rebook:** from a Contact, the same conversion form without an opportunity (`link_method = rebooking`).
- **Convert to recurring:** a link to the accepted Request in Core's Request Hub, where "Set up Recurring Care" already exists (R3).
- **Follow-up tasks:** e.g. "Call after first ride", "Check in before discharge date". Due and overdue lists come in the beta; email reminders arrive in NP-P4.
- **Signals (read-time):**
  - "No booking in N days" for contacts with past served Requests.
  - "Recurring arrangement ended" (from Core arrangement status).

---

## 5. Facility CRM

| Concept | Spec |
|---|---|
| **Account** | A commercial organization (hospital, dialysis center, rehab center, SNF, nursing home, assisted living, physician practice). It is **not** a Core facility (PD-07) |
| **Linked locations** | An account links to Core facility rows (pickup/destination places). Each location belongs to at most one account. The Account page lists them read-only, with links to Operations → Facilities |
| **Contacts / decision-makers** | Contacts with `account_id`, a job title and a role note (e.g. "Discharge planner", "Director of nursing"). A facility opportunity **may** name one primary decision-maker, who must be a contact of the same account. Other stakeholders are the account's contacts |
| **Relationship owner** | `owner_user_id` on the account and the opportunity |
| **Sales stages** | Identified → Contacted → Discovery → Proposal → Negotiation → **Won** / **Lost** |
| **Relationship status** | Prospect / Active / Inactive (independent of stage) |
| **Contract status** | None / Negotiating / Contracted / Expired / Terminated + start/end dates. No document storage in beta |
| **Follow-ups** | Tasks on the account, contact or opportunity |
| **Communication history** | Logged calls, emails, meetings and notes (activities timeline) |
| **Referral attribution** | Requests linked with `referral_account_id` (via Track in Plus or at conversion) |
| **Onboarding** | When an account becomes Contracted, a suggested task set: confirm locations are linked, confirm the coordinator contacts, share the request link / phone line, schedule a 30-day review. These are created as ordinary tasks, not a workflow engine |
| **Volume reporting** | (a) **Referred volume:** attributed Requests → accepted / declined / served counts. (b) **Location volume:** completed Trips with pickup or destination at a linked location. Reported side by side, **never summed**. Revenue is unavailable until pricing exists |

**Rule:** a facility opportunity's outcome is a **commercial** decision. One served, declined or no-show Trip never wins or loses a facility deal.

---

## 6. Acquisition & marketing support

| Need | What Plus does (software that *manages* leads) | What Plus does **not** do in beta |
|---|---|---|
| Search-engine landing pages | The operator's page links to the Core booking form (for bookings) and/or the **Plus inquiry form** (for questions). Both capture UTM, landing path and referrer host; Plus shows them on the opportunity | Build, host or optimize landing pages; buy ads |
| Existing operator websites | The existing hosted/embed/developer intake (Core Settings → Website Requests) | Website builder |
| Referral links | A referral is recorded as `source = referral` + referring account. Optional later: a per-account tagged booking link (`?utm_source=referral&utm_campaign=<account-code>`) using the existing UTM capture, with no new intake path | Referral rewards (the loyalty program is excluded, ZS-036) |
| Campaign attribution | `campaign_code` on opportunities; UTM on web Requests | Ad-platform conversion uploads, pixels (PD-15) |
| Phone inquiries | Fast "New inquiry" capture from the Pipeline | Call tracking, telephony, recording |
| Facility prospecting | Accounts, contacts, stages, tasks, logged visits | Purchased prospect lists, automated outreach |
| Follow-up reminders | Due/overdue task lists (beta); email reminders (NP-P4) | SMS reminders (NP-P4+, gated) |
| Private-pay repeat bookings | Contact history + Rebook | Automated win-back campaigns |
| Conversion analytics | Inquiry → converted → booked → served counts by source, campaign and referral account; lost reasons; Core decline reasons | Predictive analytics (ZS-037 excluded) |

Later candidates (each needs its own decision): consented email follow-up sequences, SMS, call tracking/telephony, ads integrations, marketplace acquisition. The Plus inquiry form moved into the private-pay MVP (P2-S7).

---

## 7. User experience specification

Design system, shell and brand are unchanged. The pages reuse existing primitives (`PageHeader`, `DataTable`, `Panel`, `StatusBadge`, `EmptyState`, `Dialog`, `Combobox`, `SummaryStrip`, `AttentionState`) and follow the "no dead controls" rule.

### 7.1 Navigation

- The sidebar is the existing component. It gains a labelled **Growth** group **below the Operations items and above Settings**, visible only when `plus_access_state ≠ 'none'`:
  - **Growth Overview** `/operations/growth`
  - **Pipeline** `/operations/growth/pipeline`
  - **Accounts** `/operations/growth/accounts`
  - **Contacts** `/operations/growth/contacts`
  - **Tasks** `/operations/growth/tasks`
- Route mount: PD-04. Icons come from `navIcons` (`src/design/icons.ts`), with new keys added there and not imported ad hoc.
- **Implemented in NP-P2-S2 (local; registered in NP-P2-S1-R1A).** Growth is a collapsible, accessible group inside the existing sidebar (`src/components/operations/GrowthNavGroup.tsx`, rules in `src/lib/plus/growth-nav-core.ts`):
  - Child items, indented: **Dashboard** (`/operations/growth`, the Growth Overview), **Pipeline**, **Contacts**, **Tasks**. Accounts joins in P3.
  - The **Growth label** is a link to the Dashboard and also expands the group. The **chevron** is a separate button (`aria-expanded`, `aria-controls`) that only expands or collapses the children and never navigates.
  - The group expands automatically on any Growth route, including browser back and forward. Exactly one child carries `aria-current="page"`; the Growth Agent page highlights Dashboard.
  - Icon-only rail (tablet width or a collapsed sidebar): the Growth icon is a disclosure button that opens a small flyout with the same links. Enter or Space opens it and focuses the first link; Escape closes it and returns focus; Tab-out or an outside click also closes it. It is never hover-only.
  - Order: the Operations items (unchanged), then the Growth group, then Drive, then Settings.
  - No additional sidebar or app shell is introduced. Shell, sidebar style, typography and logo are unchanged.
  - The group renders only when the server authorized Growth for this person (entitlement plus named-staff grant). Every Growth route and RPC re-checks access.
  - Core navigation and permissions are unchanged.
- Operations → Facilities stays the list of **locations**. Growth → Accounts is the list of **businesses**. Each links to the other, so there are no duplicate records.

### 7.2 Access behaviour

| State | Behaviour |
|---|---|
| Core-only org | No Growth group. `/operations/growth/*` redirects to `/operations`. A short, static "Nemryn Plus" card in Settings (Admin) explains the module (no fake data) |
| Trial (default 14 days) | Full access; a notice "Plus trial · N days left" on Growth pages (Admin) |
| Read-only (elapsed trial, expired, cancelled, disabled + read-only) | The Growth group is visible to the **Org Admin only**. Every page shows a non-dismissable notice ("Nemryn Plus is not active. Your records are kept and can be viewed and exported."). Create/edit controls are **absent**, not merely disabled. Export is available. The inquiry form shows "not available" publicly. Grant holders: no Growth group |
| Locked (security disable) | No Growth group for anyone; `/operations/growth/*` redirects; Settings → Nemryn Plus (Admin) says "Nemryn Plus access is restricted. Contact Nemryn." Records are kept |
| Dispatcher with a Plus grant | Growth group visible while the entitlement is `write`. Read grants show no create/edit controls. Admin-only Plus settings are hidden |
| Dispatcher without a grant / Driver | No Growth group; direct URLs redirect (Dispatcher → `/operations`, Driver → `/driver`) |
| Growth-only member (PD-18) | Sidebar shows only the Growth group; any other `/operations/*` URL redirects to `/operations/growth` |
| Suspended organization | As today: no workspace access |

### 7.3 Pages

Every list page has these shared states:
- **Loading:** skeleton rows, the existing table pattern.
- **Error:** fail-visible `AttentionState` with retry, preserving filters (the Request Hub pattern, `p1-e1-s2d-r1/r2`).
- **Empty:** an explanation plus one primary action.

| Page | Purpose | Main actions | Filters / views | Statuses shown | Empty state |
|---|---|---|---|---|---|
| **Growth Overview** | What needs attention today and how conversion is going | New inquiry; review web inquiries; open overdue tasks | Period (30/90 days), channel | Counts: **new web inquiries**, open opportunities by stage, tasks due/overdue, quotes sent/accepted, conversions, booked, served; lost reasons; top sources | "No growth activity yet. Record your first inquiry or link a website request." |
| **Pipeline** | Work opportunities by stage | New inquiry (private-pay); New facility opportunity (P3); move stage; mark lost; convert to booking request; open | **Channel tabs: Private-pay / Facility** (one page, no duplicate nav). The Private-pay tab has an **Inquiries to review** view (web inquiries: Convert / Dismiss). Filters: owner, source, stage, open/closed; board or list toggle | Stored stage; derived Core outcome after conversion; inquiry status | Per channel, e.g. "No private-pay inquiries yet." / "No web inquiries waiting." |
| **Opportunity detail** (`/pipeline/[id]`) | One sales effort | Edit, stage change, convert (or "Send to Operations" for growth members), link existing Request, **create / revise / mark sent / record response on an estimate or quote**, add task, log call/email/note, mark lost, reopen | — | Stage, outcome, linked Requests (minimum summary), quotes (status, total, valid until), attribution (incl. the web inquiry snapshot), reported payment status (labelled "reported") | n/a |
| **Accounts** | Facility businesses | New account; link locations; add contact; new opportunity | Relationship status, contract status, kind, owner | Relationship + contract badges; referred and location volume (separate columns) | "Add the hospitals, dialysis centers and facilities you work with or want to work with." |
| **Account detail** | One business relationship | Edit, link/unlink locations, contacts, opportunities, tasks, timeline | — | Contract dates; volume panels (a)/(b) | n/a |
| **Contacts** | People | New contact; open; rebook | Kind, account, owner, do-not-contact, archived | Do-not-contact badge, last booking date | "No contacts yet." |
| **Contact detail** | One person's relationship | Edit, rebook, add task, log, archive, **record consent (P2-S6)** | — | Booking history with derived outcomes; linked Recurring Care status; current consent per channel/purpose | n/a |
| **Tasks** | Follow-ups | New task; complete; reassign (later); open subject | Due: overdue / today / upcoming / no date; status; subject type | Open / Done / Cancelled | "No follow-ups. Add a task from any contact, account or opportunity." |

> **NP-P2-S2 implementation notes (local):**
> - **Dashboard** (`/operations/growth`) is the first, honest version of Growth Overview. It has six sections:
>   - **(A) summary:** active opportunities, new inquiries, contacts, open tasks, overdue tasks. Each tile links to its filtered view.
>   - **(B) private-pay stage overview:** the five open stages, linked to the Pipeline list.
>   - **(C) needs attention:** overdue and due-today tasks, plus the Growth Agent's deterministic list of opportunities that may need follow-up.
>   - **(D) recent activity:** type, subject and actor only; no note bodies.
>   - **(E) quick actions:** write controls for writers only.
>   - **(F) Growth Agent preview.**
>
>   Every figure comes from one server aggregate, `plus_growth_dashboard`. Empty organizations show zeros and plain empty states. **No** conversion, booking, revenue, quote outcome or period filter is shown yet; those arrive with P2-S3/S4/S5/S8.
> - **Tasks** (`/operations/growth/tasks`):
>   - views: All open, My tasks, Overdue, Due today, Upcoming, No due date, Completed & cancelled;
>   - search and an assignee filter; every row links to its subject;
>   - contextual creation and lists on Contact and Opportunity detail.
>
>   "Today" and display use the **workspace timezone**, and storage is UTC; a date without a time means 23:59 workspace time.
>   Definitions, used identically by the Tasks views, the Dashboard counts and the database:
>   - **Overdue:** open, and the due instant is before now.
>   - **Due today:** open, and due from now until the end of today in the workspace timezone. A task due earlier today is overdue, not due today.
>   - **Upcoming:** open, and due after today.
>   - **No due date:** open, with no due date. Tasks are internal work: they are never written to the activity timeline (no duplicate history) and never presented as a customer communication. Reassignment is included: "Assign to me" and the Edit dialog.

### 7.4 Request Hub touchpoints (Core pages, minimal additions)

- **Request detail:** a small **Growth** panel, shown only to users with Plus access, next to the existing `RequestAcquisitionPanel`.
  - Unattributed: **Track in Plus**.
  - Attributed: the linked contact, opportunity and referring account.
  - Hidden entirely for everyone else.
- No change to the Request Hub queue, its decisions or its permissions.

> **NP-P2-S3 implementation notes (local):**
> - **Request detail → Growth panel** (`RequestGrowthPanel`) sits under the existing Acquisition section. It renders only when Growth admits the person (Plus entitlement plus Organization Admin or a Dispatcher's named grant). For everyone else it is absent: no placeholder, no disabled control, no Growth data.
>   - **Unlinked:** "Not linked to a Growth contact or opportunity", plus **Track in Plus** for writers. Writers search existing **active** contacts, then optionally pick one of that contact's private-pay opportunities. Nothing is created or merged from here.
>   - **Linked:** the contact and the opportunity (with its stage), linked to their Growth pages, and "Linked to an existing request by … , date". Writers get **Correct link**, which requires a reason.
>   - **Read-only:** read-grant staff and an Organization Admin in read-only Plus see the link with no controls.
>   - Request decisions (Accept / Decline / Cancel), passenger linking, trip and recurring-care creation, dispatch and the acquisition section are unchanged.
> - **Contact and Opportunity detail → Linked requests.** Each attributed Request shows its **real Core status**, derived live at read time (pending / accepted / declined / cancelled, trip counts, recurring care, decline or cancel reason *code*), with a link to Operations. There is no copied Core text and no requester contact details.
> - **Linking is not a conversion.** The opportunity stage never changes on link or correction. "Converted" stays reserved for the P2-S4 conversion workflow, and a linked Request is never labelled a sale.
> - Timelines show "Operations request linked" and "Request link corrected" (with the staff reason).

### 7.5 Exports

- **Organization Admin only**, in the `write` and `read_only` states (not `locked`): CSV export of contacts, accounts, opportunities, quotes, tasks, activities and inquiries.
- Plus columns only. It never includes Core request or trip text.
- It reuses the UX1 Day Sheet CSV writer, including its spreadsheet formula-injection neutralisation (`csvField` in `src/lib/operations/day-sheet-core.ts`, repaired in P1-PILOT-UX1-CLOSEOUT). Contact and inquiry text is public-origin input.
- It depends on the UX1 commit landing first.

### 7.6 Growth Agent — staff-supervised (direction; foundation in NP-P2-S2)

**Direction.** The Growth Agent is an assistant to staff, not an autonomous actor. It notices private-pay opportunities that may need follow-up, explains why in plain words, and proposes **one internal follow-up task**. A staff member approves, edits, dismisses or marks it not relevant. Staff decide.

**Foundation shipped in NP-P2-S2 (local; synthetic data only):**
- **Detection is deterministic and explainable.** It lives in the database (`_plus_agent_candidates`) and considers open private-pay opportunities of an active contact that have no open task on the opportunity or contact. There are three signals:
  - *New inquiry waiting:* still New inquiry, nothing recorded since creation, older than 2 days.
  - *No reply recorded after outreach:* the last recorded item is a logged call or email with nothing after it, older than 5 days. This is never described as the person ignoring anyone.
  - *No recent recorded activity:* nothing recorded for 10 days.
  These thresholds are **internal-test values**, shown to staff, and **not approved production policy**. Changing them is a reviewed migration. The illustrative Day 3/7/14 cadence is **not** adopted.
- **"Review opportunities"** is a staff-initiated action (`plus_run_growth_agent_review`). It creates recommendations only. An unchanged situation is never recommended twice, and a recommendation is withdrawn ("superseded") when its situation changes. The internal function is designed so a future, separately approved **scheduler** could call the same review. **No background job exists.**
- **Approval creates an internal task only.** The database revalidates the situation first: a stale recommendation is withdrawn and creates nothing. Approval is concurrency-safe and idempotent (one task per recommendation).
- **Drafts are draft-only.** An optional message draft comes from a fixed local template (`templateDraftProvider`, first name and workspace name only). It is editable on the page, labelled **"Draft — NOT SENT"**, never saved and never sent. No draft is offered when the contact is `do_not_contact`, has no preferred channel, or lacks the matching phone or email. Every draft carries a caveat that Nemryn holds **no consent record** (P2-S6 is not built), so no consent is claimed.
- **No external AI.** No contact record is sent to any model or provider. `GrowthAgentDraftProvider` is the seam a future, separately reviewed provider could implement.
- **Never** sends email or SMS, places calls, changes a stage, marks an opportunity lost, creates quotes, or writes any Core record. There is no Send control anywhere.

**Future consent-gated automation is a separate decision.** Automatic outreach (email, SMS or AI voice), scheduled reviews, and AI-generated drafts each require their own owner decision and security review. They also depend on the P2-S6 consent ledger, the NP-P4 sending gates, and the resolution of **PD-10** (HIPAA/BAA) and **PD-11** (retention). This milestone does **not** close PD-10 or PD-11 and does not authorize any of them.

---

## 8. Implementation roadmap (A02R — dependency-ordered)

Each slice ships independently: its own additive migration (if any), app change, privilege-contract update, tests and release report, using Core's convention (migration → app deploy → smoke). The table and column order follows [domain model §3](./plus-domain-model.md): **no slice references a table created by a later slice.**

**Universal acceptance for every slice:**
- T1–T9, T19 and T27 pass for the objects that slice adds ([access model §8](../security/plus-access-model.md));
- the existing Core suites and `npm test` pass unchanged;
- no Core function body, policy or public-intake object changes, except where a slice says so explicitly;
- synthetic data only until PD-10 and PD-11 close.

**Universal rollback:**
- Revert the app commit.
- Plus tables are inert without the app, and no Core FK points at them.
- Additive columns stay (they are nullable).
- Never delete Core Requests that Plus created; they are Core business records.

### Milestones

| Milestone | Contents | Meaning |
|---|---|---|
| **M1 Technical foundation** | P1-S1 … P1-S4 | Gate, helpers, named-staff grants and contacts work and are isolated |
| **M2 Private-pay MVP** | P2-S1 … P2-S8 | Usable private-pay CRM: inquiries (phone + web), pipeline, tasks, staff estimates, consent records, conversion to Core, overview/export |
| **M3 Facility CRM** | P3-S1 … P3-S4 | Accounts, decision-makers, facility pipeline, referral and location volume |
| **Commercial beta gate** | M2 + M3 + PD-10/PD-11 closed + a staff-access decision (P1-S3 is enough, or PD-18 shipped as P2-S9) + NP-P5 readiness items | Real operators, real data |

### NP-P1 — Foundation

| Slice | Purpose & deliverables | DB impact | Authorization | Key acceptance / tests | Depends on | Excluded |
|---|---|---|---|---|---|---|
| **P1-S1 Entitlement gate** | [Brief](./NP-P1-S1-entitlement-implementation-brief.md): `organization_modules` (incl. `restriction`), effective-state function, `plus_access_state`, platform grant/expire/disable RPCs (14-day default trial), `requirePlusAccess`, empty `/operations/growth`, Platform Admin panel | 1 table, 4 functions | Platform Admin writes; Admin-only reads of own state | E1–E18 in the brief; Core unaffected in every state | UX1 reconciled | CRM tables, nav, grants |
| **P1-S2 Helpers + nav + state frames** | `_plus_member_access` (Admin-only version), `plus_can_read/write`, `_require_plus_write`, `_require_plus_admin_write`; Growth sidebar group; read-only / locked / trial notices; Settings → Nemryn Plus card | functions | as access model §3.1 | T3–T7, T6a, T10, T11; nav visibility unit tests; Core-only orgs unchanged | P1-S1; UX1 committed (touches `OperationsLayoutClient`) | grants |
| **P1-S3 Named-staff Plus grants** *(moved from NP-P5)* | `membership_module_grants`; grant-aware helper versions; `requirePlusAccess` based on `requireOperationsAccess`; Settings → Nemryn Plus → **Team access** (Admin) | 1 table; additive `memberships unique (id, organization_id)` (**Core constraint, reviewed**); helpers replaced | Admin grants/revokes; Dispatcher holders only | T21, T22; a revoked or inactive member loses access at once; a Driver can never be granted | P1-S2 | growth-only role |
| **P1-S4 Contacts + activities** | `plus_contacts` (no `account_id`), `plus_activities` (contact subject); create/edit/archive/log RPCs; Contacts list + detail | 2 tables | Plus read/write | T1–T9, T12, T19, T20; duplicate warning without merge; no medical fields | P1-S3 | opportunities, accounts |

### NP-P2 — Private-pay MVP

| Slice | Purpose & deliverables | DB impact | Key acceptance / tests | Depends on | Regression risk | Excluded |
|---|---|---|---|---|---|---|
| **P2-S1 Opportunities + pipeline** | `plus_opportunities` (private-pay only), stage RPCs, Pipeline private-pay tab, Opportunity detail; `plus_activities.opportunity_id` | 1 table + 1 additive column, check replaced | Stage rules; lost reason; ZW003 on a stale token; facility channel refused (CHECK) | P1-S4 | none in Core | facility channel |
| **P2-S2 Tasks, Dashboard, nested nav, supervised Growth Agent** *(implemented locally — NP-P2-S2)* | `plus_tasks` (contact / opportunity), Tasks page, due/overdue; nested Growth navigation; Growth Dashboard (first Overview); `plus_agent_recommendations` + staff-run review / approve / dismiss; draft-only templates | 2 tables + read RPCs | Exactly one subject; assignee must have Plus write; approval creates a task only; stale recommendations revalidated; nothing sent | P2-S1 | sidebar (Core UI): Core nav E2E re-run | reminder emails, scheduler, any sending, external AI |
| **P2-S3 Request attribution** *(implemented locally — NP-P2-S3)* | `plus_request_attributions` (contact / opportunity), `plus_link_request`, `plus_update_request_attribution`, `plus_get_request_summaries`; Request-detail Growth panel; `plus_activities.request_id` | 1 table + 1 additive column | T12, T14, T15, T16; the panel is invisible without Plus | P2-S1 | Request detail page (Core UI): Dispatcher E2E | referral account |
| **P2-S4 Conversion + rebooking** *(implemented locally — NP-P2-S4)* | `plus_convert_opportunity_to_request`, `plus_create_rebooking_request` | RPCs only | T13, T17; one `pending` Request; Core request suites unchanged | P2-S3 | calls Core request creation | Trip creation (never) |
| **P2-S5 Staff estimates & quotes (Q1)** | `plus_quotes` (staff-entered lines, server-computed total, immutable when sent, supersede); Opportunity quotes panel; printable estimate | 1 table | T28; labels never say invoice/payment; stage auto → quote_sent | P2-S1 | — | pricing rules (Q2), payments (Q3), emailing quotes (P4) |
| **P2-S6 Consent ledger** *(moved from NP-P4)* | `plus_communication_consents`; record / revoke consent on Contact detail | 1 table | T20 (append-only); latest-row semantics; `do_not_contact` overrides | P1-S4 | — | any sending |
| **P2-S7 Plus inquiry form** *(moved from NP-P4)* | `plus_inquiry_forms`, `plus_inquiries`, `plus_inquiry_rate_limit_events`; `plus_opportunities.inquiry_id`; hosted + embed pages; submission route; service-role RPCs; Inquiries to review; Convert / Dismiss; Settings → Inquiry form | 3 tables + 1 additive column; reviewed edits to `src/proxy.ts` and `next.config.ts` | T23–T26; Core intake suites show no diff; publication + entitlement gating; consent captured | P2-S1, P2-S6 | shared proxy/header config (Core files): request-form-host and Core form E2E re-run | auto-creation of anything; Core form changes; email alerts (PD-16) |
| **P2-S8 Growth Overview + export** | Overview metrics (incl. new inquiries, quotes); Admin CSV export (formula-safe) | read RPCs | Counts reconcile; once per dimension; export refused for grant holders and in `locked` | P2-S1…S7; UX1 CSV writer committed | — | analytics beyond counts |
| **P2-S9 Growth-only members** *(only if PD-18 approved)* | `growth` in `memberships.role` and `staff_invites.role` CHECKs; invite UI option; path-aware Operations guard; Growth-only sidebar; "Send to Operations" | Core CHECK changes (EXPAND-style) | Full `has_org_role` caller audit; adversarial suites; a growth member gets ZW002 / 0 rows on every Core RPC and table; redirected away from every non-Growth route | P1-S3 | **Core authorization**, highest-risk Plus slice | Core powers for growth members |

### NP-P3 — Facility CRM

| Slice | Deliverables | DB impact | Key acceptance |
|---|---|---|---|
| **P3-S1 Accounts + additive links** | `plus_accounts`; Accounts pages; additive `account_id` on contacts / tasks / activities, `account_id` + `referral_account_id` on opportunities and `referral_account_id` on attributions; checks replaced (domain model §3.2); RPCs extended with trailing defaulted parameters | 1 table + 6 additive columns | Every existing row validates; old RPC call shapes still work; T27 |
| **P3-S2 Linked locations** | `plus_account_facilities` link/unlink; Account ↔ Facilities cross-links | 1 table | One location → at most one account |
| **P3-S3 Facility opportunities** | Facility channel enabled (CHECK widened in P3-S1); Pipeline facility tab; optional primary decision-maker from the same account; onboarding task set on Contracted | none | Facility opportunity requires an account; contact/account consistency (ZW006); no stage change from trips |
| **P3-S4 Referral & volume** | Referral account on Track in Plus / conversion; referred volume vs location volume panels | read RPCs | Never summed; counts reconcile |

Excluded: facility portal, contract documents.

### NP-P4 — Communications (sending)

- **Deliverables:** consent-gated one-to-one email from Plus (Resend platform sender), including emailing a quote; a scheduler decision and reminder emails for tasks; optional email alert for new web inquiries (PD-16; requires a Core `notification_events` event-type change); campaign/source reporting.
- **Gates:** PD-10. SMS additionally needs TCPA/10DLC and a provider.
- **Acceptance:** no send without consent; `do_not_contact` blocks; promotional content never includes trip data; every send logged.
- **Excluded:** bulk campaigns, SMS until gated, telephony, ads integrations.

### NP-P5 — Commercial beta readiness

- Retention signals.
- Plus onboarding checklist.
- Reliability and load tests on Plus queries.
- Subscription billing readiness: the provider webhook writes `organization_modules` via a service-role RPC, with operator billing kept separate from ride payments.
- **Q2 rule-based pricing** if PD-08 is approved.
- Beta with 1–3 operators after PD-10/PD-11.
- Excluded: Q3 payments unless separately approved; marketplace.

### NP-P6 — Marketplace readiness (subject to PD-13)

Public-provider data contract and booking-interface specification only. Excluded: consumer accounts, listings, search, matching, cross-provider booking, commissions, consumer apps.

## 9. Explicit exclusions (beta)

Generic CRM builder (custom objects, fields or pipelines), workflow automation builder, website or landing-page builder, ad buying and pixels, SMS and telephony, bulk email campaigns, online payments, invoicing, loyalty or referral rewards, predictive analytics, Plus-created Trips, automatic Passenger matching, facility portal, marketplace, any Vleeds dependency, any change to Core public-intake functions, automatic creation of contacts, opportunities or any Core record from web inquiries, and any billing or invoicing system.
