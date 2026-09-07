# Zenward Platform — Driver Invite & Linkage Model

**Work item:** P1-E3-S9 — Operator Signup & Business Setup, §10 (closes GAP-15); confirmation-boundary continuation added by P1-E4-S0A1 — Cloud Signup Continuation Fix, §7; the actual SSR confirmation callback added by P1-E4-S0A2 — Auth Confirmation Callback Fix, §5.
**Status:** Implemented — `driver_invites` table, `create_driver_invite`/`revoke_driver_invite`/`get_driver_invite_preview`/`redeem_driver_invite`, `/join/[token]`, `/complete-signup` (§1A), `/auth/confirm` (§1B) — a Driver invitee's confirmation email now lands them straight on `/driver`, no manual sign-in.
**Last updated:** 2026-09-03

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

- A driver-facing "resend invite email" — this phase doesn't send real email at all; the org admin shares the `/join/[token]` link directly (matches the local-dev environment's own reality — no outbound email delivery is configured — and the invite-preview page itself doesn't require email delivery to function).
- Bulk/CSV invite import — one invite at a time, matching the work item's own scope.
- A driver-facing view of their OWN past invite history — not needed for the redemption flow itself.
