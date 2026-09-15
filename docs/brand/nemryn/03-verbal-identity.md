# Nemryn — Verbal Identity

**Phase:** NEMRYN G1-A
**Status:** Specification. Example strings are illustrative, not approved product copy.
**Last updated:** 2026-09-07 (unchanged in G1-B — content remains current; terminology now locked in [`07-product-language.md`](./07-product-language.md) and [`11-brand-lock-v1.md`](./11-brand-lock-v1.md))
**Depends on:** [`00-brand-foundation.md`](./00-brand-foundation.md), [`02-positioning.md`](./02-positioning.md)

---

## 1. How Nemryn speaks

**Calm, certain, clear, brief, operational, professional, non-dramatic.**

Nemryn's job in every sentence is to reduce the reader's uncertainty and effort.
It states what is true and, where relevant, what to do about it. It does not
perform, reassure excessively, apologize excessively, or fill space.

### The register, by contrast

| Nemryn is NOT | Nemryn IS |
|---|---|
| a consumer transportation app ("Your ride is on the way! 🚗") | an operations system ("Driver assigned. Vehicle confirmed. Pickup 9:15.") |
| hospital / clinical software ("Patient transport encounter documentation") | plain operational English ("Trip record") |
| AI-SaaS marketing ("Nemryn intelligently optimizes your fleet") | capability stated flatly ("Nemryn shows unused vehicle time by day") |
| a nervous assistant ("Oops! Something went wrong, sorry about that!") | a colleague reporting a fact ("Couldn't save. The trip was changed by someone else — reload to see the current version.") |
| a cheerleader ("Great job! You're crushing it today! 🎉") | a status ("All 14 trips completed. 2 need proof of service.") |

## 2. Tone rules

1. **Lead with the fact.** State the situation before the instruction. "Two trips
   tomorrow have no driver assigned. Assign or they won't run."
2. **Short sentences. Few words.** If a sentence can lose a word without losing
   meaning, lose it.
3. **Second person, active voice.** "You haven't confirmed the vehicle." Not "The
   vehicle has not yet been confirmed by the user."
4. **Name the owner and the object.** "Dispatch hasn't confirmed the wheelchair
   van for Trip 4471." Not "There's an issue with a trip."
5. **No exclamation marks.** Ever, in the application. Marketing may use at most
   one, rarely, and never for urgency.
6. **No emoji in the application.** Marketing may use none-to-minimal, never as
   status.
7. **Numbers as numerals.** "3 trips," not "three trips." Times exact: "9:15 AM,"
   not "around 9."
8. **Don't dramatize stakes; don't hide them.** "This passenger has dialysis at
   11:00. The trip is not ready." — plain, not frightening.
9. **Apologize once, briefly, only when Nemryn is at fault.** A user error is not
   an occasion for Nemryn to apologize.
10. **No filler adjectives.** Cut "simply," "just," "easily," "quickly,"
    "powerful," "robust," "comprehensive."
11. **Consistent product terms.** Use the controlled vocabulary in
    [`07-product-language.md`](./07-product-language.md) exactly. A "Request" is
    never sometimes a "booking."
12. **Sentence case everywhere.** Buttons, headings, labels. Not Title Case, not
    ALL CAPS. (Wordmark and defined acronyms like NEMT excepted.)

## 3. Worked examples by context

These show the register. They are **not** finalized strings and must be reviewed
in context when real screens exist.

### Homepage (marketing — Nemryn identity)

- **Hero headline:** "Operating infrastructure for medical transportation."
- **Subhead:** "Nemryn is the system NEMT operators use to see the state of their
  service, decide what's next, and prove what happened — from one vehicle to a
  fleet."
- **Primary action:** "See how it works" or "Talk to us" (not "Get started
  free," not "Book a demo now!!").
- **Section opener (readiness):** "Know a trip is ready before it's due —
  not after it's late."

### Empty states (application)

- Requests, none yet: "No open requests. New requests appear here as they come
  in."
- Trips today, none: "No trips scheduled today."
- Exceptions, none: "No exceptions. Everything on today's schedule is on track."
  *(This one may carry a single small positive signal — it's a genuine "good"
  operational state — but stays flat: no confetti, no "Nice work!")*
- Reports, not built: "Reporting isn't available yet." *(Do not pad with a
  roadmap promise.)*

### Error messages (application)

- Save conflict: "Couldn't save. This trip was changed since you opened it.
  Reload to see the current version, then reapply your change."
- Permission: "You don't have access to this. If that's wrong, ask an
  administrator in your organization."
- Network: "Can't reach Nemryn right now. Your last change wasn't saved. Retry
  when you're back online."
- Not found: "That trip doesn't exist, or it's not in this workspace."
- Validation: "Pickup time is required." *(Field-level, specific, no "Please.")*

### Warnings (application — "attention required," maps to Attention Amber)

- "Trip 4471 is tomorrow at 9:15 and has no driver assigned."
- "This standing order ends Friday. Renew it to keep next week's trips."
- "The vehicle on Trip 4468 isn't wheelchair-accessible. The passenger needs a
  ramp."

### Trip readiness (application)

- Ready: "Ready — driver confirmed, vehicle confirmed, authorization valid."
- Not ready (list the reasons): "Not ready: no driver assigned; authorization
  expires before the trip date."
- Becoming ready: "Waiting on driver confirmation. Everything else is set."

### Exceptions (application — maps to Critical Red when active)

- "Driver marked unavailable 40 minutes before pickup. Trip 4471 needs
  reassignment now. Owner: Dana."
- "Passenger not at pickup. Driver waited 10 minutes. Awaiting your decision:
  reattempt, reschedule, or cancel."
- Recovered: "Reassigned to Marcus. Pickup now 9:25 — 10 minutes late.
  Facility notified."

### Successful actions (application)

- "Trip assigned to Marcus."
- "Standing order renewed through March 31."
- "Proof of service recorded for 12 trips."
- *(No "Success!", no checkmark-plus-praise. The confirmation is the sentence.)*

### Driver communication (driver surface — operator identity, Nemryn frame)

- "You have 6 trips today. First pickup 8:00 AM — Alice R., 412 Oak St."
- "Trip added: 2:30 PM pickup, Lenox Dialysis to home."
- "Trip 4471 changed: pickup moved to 9:25 AM."
- "Report pickup when you arrive. Report drop-off when the passenger is inside."
- *(Direct, task-first. No "Hi driver!", no "Have a great shift!")*

### Operations Brief (application — the daily open)

- Heading: "Today — Tuesday, March 4"
- "14 trips. 12 ready. 2 need attention."
- "Next: 8:00 AM pickup — Alice R. (Marcus, Van 3)."
- "Tomorrow: 11 trips. 3 not yet ready."
- *(Reads like a shift handoff, not a dashboard headline.)*

### Security / account messaging (Nemryn identity)

- New sign-in: "A new device signed in to your Nemryn account from Atlanta, GA at
  6:02 AM. If this wasn't you, change your password and contact your
  administrator."
- Password changed: "Your Nemryn password was changed. If you didn't do this,
  contact your administrator now."
- Session expired: "You've been signed out. Sign in again to continue."
- *(Factual, actionable, no alarm styling in the words themselves — Critical Red
  is for operational exceptions, not routine account notices; see
  [`05-semantic-color-system.md`](./05-semantic-color-system.md).)*

## 4. Punctuation, formatting, mechanics

- **Numerals** for all quantities and counts.
- **Times:** `9:15 AM` (space, uppercase AM/PM). 12-hour by default; 24-hour only
  if an operator configures it later.
- **Dates in UI:** `Tuesday, March 4` or `Mar 4` compact. Never `03/04` alone
  (ambiguous).
- **Ranges:** en dash, no spaces — `9:15–9:45 AM`.
- **Trip / request identifiers:** `Trip 4471`, capital T, no `#`.
- **Money:** `$42.50`, cents shown, `$0.00` not `Free` in operational contexts.
- **Percentages:** `92%` no space.
- **Lists of reasons:** semicolons within a sentence, or a real bulleted list —
  be consistent per surface.
- **No Oxford-comma dogma**, but be consistent within a document/screen.
- **"NEMT"** on first mention in marketing may expand to "non-emergency medical
  transportation"; thereafter `NEMT`.

## 5. Naming the product and the company

- The company and the product are both **Nemryn**. Don't write "Nemryn, Inc." in
  UI. Legal entity name is a legal question, not a brand one.
- A user has a **Nemryn account**.
- A user works in a **workspace** (the container for one operator's operation).
  The underlying data entity is an **organization** (see
  [`07-product-language.md`](./07-product-language.md)). Prefer "workspace" in
  conversational UI, "organization" in settings/admin/technical contexts —
  pending the naming decision flagged in [`01-brand-architecture.md`](./01-brand-architecture.md) §4.

## 6. What good looks like — a self-check

Before shipping a string, ask:

1. Does it state the fact before the instruction?
2. Can I cut a word?
3. Is every product term the controlled one?
4. Would an operator at 6 a.m. understand it in one read?
5. Is it free of exclamation marks, emoji, and filler adjectives?
6. Does it name the object and (if relevant) the owner?
7. Is it in sentence case?

If any answer is no, revise.
