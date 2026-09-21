# Zenward Platform — Driver Invite & Linkage Model

**Work item:** P1-E3-S9 — Operator Signup & Business Setup, §10 (closes GAP-15); confirmation-boundary continuation added by P1-E4-S0A1 — Cloud Signup Continuation Fix, §7; the actual SSR confirmation callback added by P1-E4-S0A2 — Auth Confirmation Callback Fix, §5; the initial **driver invitation email** added by G0-R3 — Driver Invitation Email Delivery, §1C. A per-tenant sender-domain architecture was explored and rolled back — see §1D and `docs/reports/p0-s2a-wl-rollback-platform-sender.txt`.
**Status:** Implemented — `driver_invites` table, `create_driver_invite`/`revoke_driver_invite`/`get_driver_invite_preview`/`redeem_driver_invite`, `/join/[token]`, `/complete-signup` (§1A), `/auth/confirm` (§1B), and (§1C/§1D) the server-side driver invitation email + resend, sent from Nemryn's standard platform sender with dynamic tenant content. Local dev proves the full chain end to end; production email delivery is BLOCKED pending a Resend API key (see `docs/deployment/driver-invite-email-production-checklist.md` and `docs/deployment/environment-variable-inventory.md`).
**Last updated:** 2026-09-14

**The highest-risk part of this phase**, per the work item's own framing. Closes `docs/product/ui-backend-gap-register.md` GAP-15: "Driver is not AuthUser/Membership, and no safe, coherent contract exists yet for inviting a new authenticated user, creating their Membership, AND linking a `drivers` row together."

## 1. Design: a token-gated invite record, never admin-created credentials

The organization admin **never** creates the invitee's account or handles their password. Instead:

1. Organization Admin creates a `driver_invites` row (`create_driver_invite`) — a pending record naming an email, a display name, an optional phone, and a random (122-bit, UUID v4) token. No auth user, Membership, or Driver row exists yet.
2. The invitee visits `/join/[token]` — a public page that previews the invite (organization name, their own invited name, the invite's status) via `get_driver_invite_preview`, a narrow, anon-callable, token-gated RPC.
3. The invitee signs up **through ordinary Supabase Auth** (`supabase.auth.signUp()` — the identical path `/sign-up` uses), with the email locked to the invite's own email.
4. Immediately after signup succeeds (or on a later sign-in, if they already have an account), `redeem_driver_invite(token)` — SECURITY DEFINER, requiring a real authenticated session whose account email matches the invite — atomically creates their `driver` Membership (only if none already exists for them in that org) and links (or reuses) their Driver row, then marks the invite accepted.

## 1A. The confirmation-boundary continuation (P1-E4-S0A1)

**The same gap §4A of `docs/product/operator-onboarding-model.md` describes exists here too:** `joinSignUpAction`'s `token` parameter is only a local variable in that one Server Action invocation. If Supabase Auth requires email confirmation, `signUp()` returns no session, `redeem_driver_invite(token)` is never called, and the token is gone — the invitee would confirm, sign in, and reach `/access-unavailable` with their invite still sitting `pending`, never redeemed.

**Fix, mirroring the operator-signup continuation exactly:** `joinSignUpAction`'s `signUp()` call now also passes `options.data.pending_driver_invite_token = token`, persisted on the invitee's own `auth.users` row regardless of confirmation state. `/complete-signup` (the Route Handler described in operator-onboarding-model.md §4A) checks for this token **before** it ever looks at operator-signup metadata, and calls `redeem_driver_invite` with it:
- Success → `/driver`.
- Failure (revoked, stale, wrong-email, or any other denial `redeem_driver_invite` itself already enforces — §3 below, unchanged) → `/access-unavailable`. **Deliberately never** the operator organization-creation form (`/complete-signup/form`) — a Driver invitee whose invite failed must never be offered a path to create their own operator organization instead; that would silently paper over a real invite problem with an unrelated, unintended capability.

Since `redeem_driver_invite` was already idempotent for a repeat call by the same already-accepted person (§3 below), no additional idempotency guard was needed for this path — unlike the operator-signup continuation (`complete_pending_signup`), which needed a new advisory-lock guard because `signup_create_organization` is deliberately non-idempotent.

## 1B. The SSR confirmation callback (P1-E4-S0A2)

§1A's `pending_driver_invite_token` reaches `/complete-signup` the same way operator signup's `pending_full_name`/`pending_business_name` do — through a real session, which (per `docs/product/operator-onboarding-model.md` §4B) required a dedicated SSR endpoint, `/auth/confirm`, to actually establish. Before that endpoint existed, a Driver invitee's confirmation email link had exactly the same failure as an operator's: Supabase's default template redirects with the session in a URL fragment no server-side code can read, so nothing was ever established and the invitee landed unauthenticated. `joinSignUpAction`'s `signUp()` call needs no changes for this fix — the SAME "Confirm signup" email template (§ operator-onboarding-model.md §4B) is used for every email-confirmation signup regardless of which page initiated it, since Supabase categorizes them identically (`type=signup`).

Verified live and locally, with a real Mailpit-delivered email: Driver invite created as Org Admin → invitee signs up at `/join/[token]` → real confirmation email received, using the `/auth/confirm?token_hash=...&type=signup` link shape → link clicked in a fresh browser (no prior cookies) → lands directly on `/driver`, zero manual steps → `/operations` correctly denied. `drivers.display_name` (from the invite, admin-specified) and `user_profiles.display_name` (from the invitee's own entered name, via the §1A parity fix) both confirmed correct via direct database query.

## 1C. The initial driver invitation email (G0-R3)

Steps 1→2 of §1 assumed the invitee somehow *receives* the `/join/[token]` link.
Before G0-R3 nothing sent it: `create_driver_invite` created the row and returned
a token, `createDriverInviteAction` discarded the token and told the operator
"Invite sent" — but no email was ever dispatched and the link never left the
server. This is a **different email** from the Supabase account-confirmation email
in §1B: the invitation email is the *first* message ("your operator invited you,
here is the link"); the confirmation email comes *later*, from Supabase, once the
invitee signs up.

**What G0-R3 added (application code only — no schema, RLS, or migration change):**

- `src/lib/email/send.ts` — the single server-side transactional-email boundary.
  Production transport is **Resend** (plain HTTPS POST, no SDK); local dev with no
  key logs the rendered message to the server console. Returns a discriminated
  result (`sent` / `failed` / `not_configured`); never throws a provider error to
  the caller, never logs the API key or the invite token.
- `src/lib/email/driver-invite-email.ts` — the invitation content. Subject
  *"You're invited to drive for {Organization Name}"*; body identifies the
  **operator by its real, dynamic name** (never "Zenward" unless that is the
  organization, and never hard-coded); the "Accept invitation" button and a
  plain-text fallback link point at `/join/<token>`. No footer/attribution
  line, no marketing language, no "AI" language — see §1D for the sender.
- `src/lib/app-url.ts` — `buildDriverInviteUrl(token)` builds the absolute link
  from `NEXT_PUBLIC_APP_URL` (the established per-environment application URL —
  `docs/deployment/environment-variable-inventory.md`), falling back to the
  request's forwarded host. Only the 122-bit token goes in the URL — no
  `organization_id`, `driver_id`, or email.
- `createDriverInviteAction` now sends the email after the RPC succeeds and
  returns an explicit `delivery` state. The operator is told **"Invitation sent"**
  only when it genuinely was; on a delivery failure the valid invite is preserved
  and the dialog says the email could not be sent, pointing to the Pending Invites
  list to resend.
- `resendDriverInviteAction(inviteId)` — resend for a `pending` invite.
  Authorization is re-derived server-side (`requireOperationsAccess` +
  `organization_admin` check); the invite is read through the RLS-protected
  `driver_invites` SELECT policy and re-bound to the resolved organization context
  (a cross-tenant `inviteId` resolves to nothing); **the recipient cannot be
  changed** (it comes from the row); **no row is inserted or updated**, so no
  duplicate invite, Membership, or Driver can result. The token is never returned
  to the browser.

**Verified locally, end to end (dev console transport):** Org Admin invites →
exactly one `driver_invites` row → invitation email dispatched with the correct
organization name and `/join/<token>` link (token matches the DB row) → the
emailed link loads `/join/[token]` and identifies the correct organization →
invitee signs up → lands on `/driver` → exactly one `Membership(driver)` / Driver
/ UserProfile → invite `accepted`. Negatives: a Dispatcher sees no "Invite
Driver" button; an Org B admin never sees Org A's pending invite; a provider
failure (tested with an invalid Resend key) preserves the invite and reports the
failure honestly with no provider error or key leaked; re-inviting the same email
refreshes the single row rather than duplicating it; resend targets only the
original recipient. **Production delivery is BLOCKED** until `RESEND_API_KEY` +
`EMAIL_FROM` are configured — see §5 and the phase report.

## 1D. Sender identity — standard model (P0-S2A-WL-RB)

**STANDARD EMAIL MODEL: Nemryn platform sender + dynamic tenant content.**
Every organization's driver-invitation email is sent from the SAME,
single Nemryn address (`EMAIL_FROM`, production example
`"Nemryn <notifications@nemryn.com>"`) — there is no per-organization
sender lookup, no sender-domain table, and no per-tenant verification
state anywhere in the database. What stays dynamic per organization is
the CONTENT: the real organization name in the subject
("You're invited to drive for {Organization Name}") and body
("{Organization Name} has invited you to join their driver team."),
resolved fresh from `organizations.name` on every send — never
hard-coded, never cached. No attribution footer is added ("Sent by…",
"Powered by…") — the recipient already sees Nemryn as the sender in
their own inbox, and the organization's name already carries the
message.

**FUTURE: custom tenant sender domains are a deferred commercial
white-label capability**, not current functionality. An earlier local
iteration of this codebase built a complete per-tenant sender-identity
architecture — an `organization_email_senders` table, tenant-propose /
platform-verify RPCs, RLS, a resolver, 18 adversarial SQL tests, and
live-verified sender resolution across all verification states. It was
fully implemented and tested, then **rolled back** once the commercial
direction settled on a single standard sender for the product's current
stage. That work is preserved, unmodified, as a historical record in
`docs/reports/p0-s2a-wl-tenant-email-identity-foundation.txt`
(superseded — see the note at its top) and
`docs/reports/p0-s2a-wl-rollback-platform-sender.txt` (the rollback
itself). If/when tenant-owned sending domains become a real product
capability again, that prior design is the starting point, not a
from-scratch effort — but nothing in the currently-running code
references it, and no schema for it exists.

## 2. Why this design, specifically

- **"No orphan Driver/Auth records on partial failure"** is satisfied structurally, not by careful error handling: the auth user is created by Supabase Auth's own already-tested, atomic `signUp()` — entirely independent of `redeem_driver_invite`. If a person signs up but never redeems (closes the tab, whatever), they land in the exact same "authenticated, zero Membership" state the platform already handles safely (`/access-unavailable`) — a real, valid, harmless account, never a broken half-created row. `redeem_driver_invite` itself is one Postgres transaction — any failure inside it rolls back the Membership and Driver inserts together.
- **"Invite cannot create foreign-org membership"** is satisfied structurally too: `redeem_driver_invite` takes **no `organization_id` parameter at all**. The organization is always resolved from the invite row itself (locked `FOR UPDATE`), never from anything the caller supplies — cross-org redemption is not merely denied, it is not expressible as an input.
- **"Invited Driver receives Driver role only"**: `role` is hard-coded `'driver'` in the INSERT — never a parameter.
- **"Duplicate invite/link handled safely"**: `create_driver_invite` refreshes an existing PENDING invite for the same (org, email) rather than creating a second row (a partial unique index enforces this at the schema level too); `redeem_driver_invite` is idempotent for a repeat call by the same already-accepted person.
- **"Audit important actions"**: `driver_invite_created`, `driver_invite_revoked`, and `driver_invite_redeemed` are all real `audit_events` rows.

## 3. Authorization boundaries, verified live and via SQL

| Rule | Mechanism | Verified |
|---|---|---|
| Organization Admin only may create/revoke an invite | `has_org_role(org, ['organization_admin'])` inside both RPCs — a Dispatcher gets `ZW002`, same as create_driver_profile's own existing restriction | `operator_onboarding_tests.sql` INVITE-5 |
| Tenant-scoped | `has_org_role` re-validated against the CALLER's real org membership every call — a foreign org's admin cannot invite into this org | `operator_onboarding_tests.sql` INVITE-4 |
| Redemption requires the caller's own real account email to match | `select lower(email) from auth.users where id = auth.uid()`, compared to the invite's email — a mismatch is `ZW002`, same "no existence oracle" categorization as everywhere else in this codebase | `operator_onboarding_tests.sql` REDEEM-5 |
| A revoked invite cannot be redeemed, even by the correct email | `status <> 'pending'` check, `ZW003 stale_state` | `operator_onboarding_tests.sql` INVITE-6 |
| Revoked/inactive Membership loses access immediately | The general live-Membership-check discipline (ZD-077), unchanged by this feature; independently re-verified for a just-redeemed driver | `operator_onboarding_tests.sql` ROLE-REVOKE-1 |
| No broad direct INSERT/UPDATE grant | `driver_invites` has ZERO authenticated INSERT/UPDATE/DELETE grant — every mutation goes through the 4 SECURITY DEFINER functions above | Confirmed via `information_schema` inspection before shipping |
| Concurrent redemption of the SAME token is safe | The invite row is locked `FOR UPDATE` inside `redeem_driver_invite` | `driver_invite_concurrency_test.sh` — genuine two-process race, real multi-second lock contention observed, exactly one Driver row and one Membership row resulted regardless of which session's transaction actually completed first |

## 4. A real, related gap found and fixed while building this: `drivers.user_id`

Before this phase, `drivers.user_id` had a **broad, unconditional** client UPDATE grant (`grant update (display_name, phone, status, user_id) on drivers to authenticated`, gated only by `drivers_update_org_admin` — an org-role check with **no constraint on what value `user_id` was set to**). An organization_admin could set any Driver row's `user_id` to any `auth.users.id` they could guess or learn — including a completely unrelated person's account — silently granting that person Driver access without their knowledge or consent. Never exercised by any shipped feature before now, but genuinely live-exploitable via a direct REST/RPC call. Fixed (`20260903100300_retire_direct_driver_user_id_update.sql`): the column is no longer in the client UPDATE grant at all — `link_self_as_driver` and `redeem_driver_invite` (both SECURITY DEFINER, both structurally self-only) are now the sole paths that ever set it. See ZD-195.

## 5. What was deliberately NOT built

- ~~A driver-facing "resend invite email" — this phase doesn't send real email at all~~ **Superseded by §1C (G0-R3).** The initial invitation email is now sent server-side, with an Organization-Admin-only resend from the Pending Invites list. Still outstanding for a later phase: a **server-side resend cooldown / throttle** (the current resend has no rate limit beyond the client transiently disabling the button — an org admin could spam an address; the invite row itself is unaffected), and a bounded **audit event** for each resend. Both are small follow-ups, not blockers. Also still not built: a **custom SMTP transport** (Resend is the only production provider wired) and a **driver-facing invite-history view**.
  **P0-S2A review (2026-09-11):** re-confirmed the cooldown is deliberately deferred rather than improvised — a genuinely *safe* (persistent, correct across Vercel's multiple/serverless instances) throttle needs either a `driver_invites` timestamp column or an external store, and this phase's own instruction was explicitly not to add a migration for it. An in-memory, per-process cooldown was considered and rejected: it would give false confidence (each serverless invocation can land on a different instance) without providing a real guarantee. Same phase also reviewed and hardened `src/lib/app-url.ts`'s origin resolution (malformed-URL/loopback-in-production guards — see the phase report for the crash this uncovered and fixed) with focused unit tests (`src/lib/app-url-core.test.mjs`, `npm test`).
- Bulk/CSV invite import — one invite at a time, matching the work item's own scope.
- A driver-facing view of their OWN past invite history — not needed for the redemption flow itself.


## Addendum (P1-PILOT-S5A1R) — the INSERT side is closed too

The UPDATE-side retirement described above left the original broad client INSERT grant on `drivers` in place, so an Organization Admin could still create a Driver row carrying any `user_id` directly. `20260921100000_retire_direct_driver_insert.sql` revokes client INSERT entirely (no legitimate client INSERT exists) and drops the unreachable `drivers_insert_org_admin` policy. After it, `link_self_as_driver` and `redeem_driver_invite` are the only paths that create or link a Driver row.
