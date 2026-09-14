# Zenward Platform — Password Recovery Model

**Work item:** P0-S2B — Forgot Password / Password Recovery
**Status:** Implemented and live-validated against the local Supabase stack. Not deployed — human review and explicit deployment authorization come after `docs/reports/p0-s2b-password-recovery.txt`.
**Last updated:** 2026-09-14

## 1. User flow

```
Sign In
   ↓ "Forgot password?"
/forgot-password — enter email
   ↓ (always the same outward response)
"If an account exists for that email, we've sent password reset instructions."
   ↓ (real account only) recovery email delivered
Open secure recovery link
   ↓
/auth/confirm?token_hash=...&type=recovery  (server-side token exchange)
   ↓ (success)
/auth/reset-password — new password + confirm
   ↓ (success)
"Your password has been updated." → Continue → / (still signed in)
```

A person who is not a real account holder sees the identical first two
steps and then nothing further — no email arrives, and the application
gives no signal either way.

## 2. Supabase recovery architecture

This flow uses Supabase Auth's own supported password-recovery
mechanism throughout — no custom password-reset token is generated,
stored, or validated by this application anywhere:

1. **Request** (`src/app/forgot-password/actions.ts`) —
   `supabase.auth.resetPasswordForEmail(email, { redirectTo })`, called
   with the publishable-key client (`src/lib/supabase/server.ts` — the
   SAME client every other auth action in this codebase uses; no
   service-role key, no admin API).
2. **Delivery** — Supabase Auth emails a link containing a
   `token_hash` for `type=recovery`, built from the custom
   `[auth.email.template.recovery]` template
   (`supabase/templates/recovery.html`) — see §3.
3. **Exchange** (`src/app/auth/confirm/route.ts`) — the SAME Route
   Handler that already handles signup confirmation (`type=signup`)
   now also handles `type=recovery`: `supabase.auth.verifyOtp({ type:
   "recovery", token_hash })`, server-side, which establishes a real
   session by writing the session cookie directly. This is Supabase's
   own supported OTP-verification mechanism, not a custom exchange.
4. **Update** (`src/app/auth/reset-password/actions.ts`) —
   `supabase.auth.updateUser({ password })`, using that same
   session — Supabase's own supported password-change mechanism,
   scoped entirely to the caller's own current session.

No table in this application's schema stores a recovery token, a
password hash, or any recovery-request state. `supabase/migrations/`
and RLS are entirely unchanged by this feature.

## 3. Why a custom email template, and why `{{ .RedirectTo }}`

Supabase's DEFAULT "Reset Password" template links via
`{{ .ConfirmationURL }}`, which points at Supabase's own hosted
`/auth/v1/verify` endpoint. That endpoint redirects the browser with
the new session encoded as a URL **fragment**
(`#access_token=...`) — never sent to any server, so a Server
Component can never read it. This is the exact same problem
`/auth/confirm` was already built to solve for signup confirmation
(P1-E4-S0A2) — this phase reuses that solved problem rather than
inventing a second mechanism: `supabase/templates/recovery.html` links
directly to `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`,
server-readable query parameters, no Supabase-hosted redirect
involved.

**One deliberate difference from the confirmation template:**
`recovery.html` uses `{{ .RedirectTo }}` as the link's origin, not
`{{ .SiteURL }}` (which `confirmation.html` uses). `{{ .RedirectTo }}`
resolves to whatever `redirectTo` value the calling code actually
passed to `resetPasswordForEmail()` — and
`src/app/forgot-password/actions.ts` passes
`` `${origin}/auth/confirm` ``, where `origin` comes from
`getAppOrigin()` (`src/lib/app-url.ts`, the exact origin-resolution
infrastructure P0-S2A built for the driver-invitation email link — reused
here unmodified, not duplicated). This means the recovery link's origin
is controlled entirely by THIS APPLICATION's own `NEXT_PUBLIC_APP_URL`,
not by Supabase's separately-configured "Site URL" dashboard setting —
see §7 for why that matters for the coming domain migration.

## 4. Redirect / origin handling

`getAppOrigin()` resolution order (unchanged from P0-S2A, reused as-is):

1. `NEXT_PUBLIC_APP_URL`, normalized and validated through
   `resolveConfiguredOrigin` (rejects a missing scheme, a non-http(s)
   scheme, a value with a stray path/query, blank/malformed input).
2. The incoming request's forwarded host, as a fallback.
3. Throws if neither yields a usable origin, or if the resolved origin
   is a loopback address in production — refusing to email a broken or
   unreachable link rather than silently sending one.

`forgotPasswordAction` wraps this in a `try/catch`; any thrown error
(a genuine misconfiguration) is mapped to the same generic
`FORGOT_PASSWORD_FAILED` message — never a raw error, and never a
message that differs based on whether the submitted email corresponds
to a real account (see §5).

No `localhost` value is ever hard-coded. No Vercel preview URL
(`*.vercel.app`) is ever used, since the ONLY source of the origin is
`NEXT_PUBLIC_APP_URL` (or, as a fallback, whatever host the request
itself actually arrived on — which in every real deployment is the
one canonical domain, never a preview host).

## 5. Email-enumeration protection

**The governing rule:** the outward response to a forgot-password
submission must be identical whether or not an account exists for the
submitted email.

This is enforced at two levels:

- **Supabase's own provider behavior.** `resetPasswordForEmail()`
  returns success (no `error`) for a syntactically valid but
  non-existent email — this is Supabase Auth's own documented,
  intentional behavior, not an assumption made by this application.
- **This application's own action.** `forgotPasswordAction` performs
  exactly one pre-check — `isPlausibleEmail()`
  (`src/lib/auth/recovery-core.ts`), a pure SHAPE check (has an `@`, a
  domain, no whitespace) that rejects input that could not possibly be
  ANY account's address — and then returns one of exactly two outward
  states: `"sent"` (the neutral message, for every syntactically valid
  email regardless of whether Supabase found a matching account) or
  `"error"` (a generic failure message, reserved for a GENUINE
  provider/config problem — rate limiting, a thrown
  `getAppOrigin()` misconfiguration, a network fault — none of which
  correlate with whether the specific submitted email is registered,
  so distinguishing that case does not reopen the enumeration
  question).

The client (`src/components/auth/ForgotPasswordForm.tsx`) replaces the
entire form with the same static confirmation message on `"sent"` —
there is no code path, timing difference, or response shape that
differs based on account existence.

## 6. Recovery-session behavior

**The problem this section solves:** this codebase's `/auth/confirm`
pattern exchanges the Supabase token SERVER-SIDE (a Route Handler
calling `verifyOtp()`), which is what lets a plain Server Component
establish a session at all. But it also means the browser never runs
Supabase's client-side `onAuthStateChange` listener for this exchange,
so the `PASSWORD_RECOVERY` event Supabase would normally fire — the
standard, official way to know "this session exists because of a
recovery link" — is never observed here.

**The solution:** a short-lived, non-credential marker cookie
(`zw-recovery-pending`, `src/lib/auth/recovery.ts`), set by
`/auth/confirm` at the exact moment it verifies a `type=recovery`
token, alongside the real Supabase session cookie. It carries no user
id, token, or secret — just presence. `/auth/reset-password` (the
page) renders the password-change form ONLY when BOTH are true:

- a real Supabase session exists (`getUser()`), AND
- this marker cookie is present.

Requiring both, not either alone, is deliberate:

- A session alone could belong to someone already signed in for an
  unrelated reason — this page must not become an undocumented
  "change my password while logged in" feature (out of this phase's
  scope; not requested).
- The marker cookie alone grants nothing — it is not a credential, and
  without a real session, `updateUser()` has nothing to act on.

**How each unsafe case is handled** (§10 of the work item, verified
live — see the completion report §16):

| Case | Result |
|---|---|
| Expired/invalid/already-used recovery link | `verifyOtp()` fails at `/auth/confirm` → redirected to `/auth/auth-code-error`. Never reaches the reset form. |
| Malformed `token_hash`/`type` | Same — `/auth/confirm` requires both params and a successful `verifyOtp()`. |
| Missing recovery session (direct navigation to `/auth/reset-password`) | The page's own `canReset` check is false (no marker cookie) → renders the restrained "This link has expired" state, not the form. |
| Session exists but no marker (an unrelated already-signed-in visitor) | Same restrained state — a session alone is not treated as authorization to show this form. |
| A raw POST to the Server Action bypassing the page | `resetPasswordAction` re-checks the SAME two conditions itself — defense in depth, never trusting that a request only arrives via the page that normally leads to it. |
| Re-opening the SAME (already-used) recovery link | Fails at `/auth/confirm` — Supabase's own recovery token is single-use at the provider level, independent of this application's cookie. Verified live: re-opening a just-used link lands on `/auth/auth-code-error`. |

**Structurally impossible, not just handled:** resetting ANOTHER
user's password. `updateUser()` always operates on the CALLER'S OWN
current session — there is no parameter, anywhere in this flow, that
names which account's password to change. This is enforced by
Supabase itself, not by application logic that could be gotten wrong.

**One inherent property, not introduced by this phase:** opening a
valid recovery link authenticates the browser as that user — the same
trust level Supabase applies to a password sign-in. Supabase's own
security model treats successful recovery-token verification as
equivalent proof of identity. This application does not attempt to
weaken or work around that; it is Supabase's own intentional design.

## 7. Error handling

Every failure state maps to a stable, generic, non-revealing message —
never a raw Supabase error, matching the existing `AUTH_ERROR`
discipline (`src/lib/auth/errors.ts`) used everywhere else in this
codebase's auth surface:

| Code | Shown when | Message |
|---|---|---|
| `FORGOT_PASSWORD_INVALID_EMAIL` | Submitted value fails the pure shape check | "Enter a valid email address." |
| `FORGOT_PASSWORD_FAILED` | A genuine provider/config error (never "no such account") | "We couldn't process that request. Please try again shortly." |
| `RESET_PASSWORD_WEAK` | New password shorter than 8 characters | "Please choose a password with at least 8 characters." |
| `RESET_PASSWORD_MISMATCH` | New password and confirmation don't match | "Those passwords don't match." |
| `RESET_PASSWORD_FAILED` | No valid recovery context, or Supabase's `updateUser()` itself failed | "We couldn't update your password. Please request a new reset link and try again." |

The minimum password length (8 characters) matches the existing
sign-up policy (`src/app/sign-up/actions.ts`) exactly — one consistent
password policy across every place this application sets a password,
defined once (`MIN_PASSWORD_LENGTH`,
`src/lib/auth/recovery-core.ts`) and reused by both the client form's
`minLength` attribute and the Server Action's own authoritative check.

## 8. Post-reset behavior — does the user stay signed in?

**Yes — the user remains signed in after a successful password
reset.** This is Supabase's own documented behavior for
`updateUser()` called on an active recovery session: the recovery
session simply becomes the user's normal session once the password
changes. This application does not sign the user out or force a fresh
sign-in afterward.

**Why:** forcing a sign-out would be unusual friction not required by
Supabase's own architecture, and would require this application to
invent its own "you must now re-authenticate" gate — a genuinely new
piece of behavior with its own edge cases, for no corresponding
security benefit (the person already just proved control of the
account's email, which is the same proof a sign-in provides).

**What the success screen does instead:** a static "Your password has
been updated. You're still signed in — continue to Zenward." message,
with one manual "Continue" link to `/` (which resolves the real
destination by role/org, the same as every other authenticated entry
point in this application) — no automatic redirect. This was a
deliberate choice per the work item's own "prefer predictable behavior
over clever automatic navigation" instruction.

**A note on the recovery marker cookie specifically:** it is
deliberately NOT cleared by the successful reset action itself (see
`src/app/auth/reset-password/actions.ts`'s own doc comment for the
full reasoning) — clearing it there was found, during live validation,
to interact badly with Next.js's automatic post-Server-Action route
refresh: the refresh re-evaluates the page's own gate condition, and
if the marker were cleared inside the same action, the refresh would
flip the page to its "expired" state and unmount the just-rendered
success message before it was ever seen. The cookie instead simply
expires on its own short, fixed 10-minute lifetime — this does not
reopen any real security gap, since the underlying Supabase recovery
TOKEN (not this cookie) is what is actually single-use, verified
separately.

## 9. Domain migration impact (`app.zenwardmobility.com` → `app.nemryn.com`)

This flow was built specifically so migrating `NEXT_PUBLIC_APP_URL`
requires **no code change** to the recovery flow itself — the origin
used for both request-time (`redirectTo`) and the emailed link is
resolved exclusively through `getAppOrigin()`. What DOES need to
change, all of it outside this application's own source code:

| Item | Where | Today | After migration |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Vercel Production environment variable | `https://app.zenwardmobility.com` | `https://app.nemryn.com` |
| Supabase Auth "Site URL" | Supabase Dashboard → Authentication → URL Configuration | `https://app.zenwardmobility.com` | `https://app.nemryn.com` — still used by `supabase/templates/confirmation.html`'s `{{ .SiteURL }}` (signup confirmation was NOT changed to `{{ .RedirectTo }}` this phase — out of scope; a candidate follow-up, noted in `docs/deployment/staging-auth-configuration.md`). |
| Supabase Auth "Redirect URLs" allow-list | Same Dashboard page | Must include `https://app.zenwardmobility.com/**` | Must ADD `https://app.nemryn.com/**` (both can coexist during a transition window) |
| Supabase "Reset Password" email template | Supabase Dashboard → Authentication → Email Templates | Links via `{{ .RedirectTo }}` (see §3) | **No template edit required** — automatically follows whatever `redirectTo` the app now passes, which itself follows the new `NEXT_PUBLIC_APP_URL` once redeployed |
| Supabase "Confirm signup" email template | Same Dashboard page | Links via `{{ .SiteURL }}` | Automatically follows Site URL once THAT is updated (no template edit needed either, but only because it depends on Site URL, unlike the recovery template) |
| Custom domain attachment | Vercel project settings | `app.zenwardmobility.com` attached | `app.nemryn.com` attached |
| DNS | External DNS provider | Records for `app.zenwardmobility.com` | New records for `app.nemryn.com` |

This table is this feature's own contribution to the broader N0-M1
domain-migration checklist — it is not a complete list of every
Supabase/Vercel setting the whole application depends on (see
`docs/deployment/environment-variable-inventory.md` and
`docs/deployment/staging-auth-configuration.md` for the rest). No
migration step listed here was performed by this phase — this is a
checklist for that later, separate, controlled phase.

## 10. What this phase deliberately did NOT build

- No custom password-reset token table, column, or RPC — Supabase's
  own recovery mechanism is the entire implementation (work item's own
  explicit instruction).
- No "change my password while already signed in" feature — the reset
  form is reachable only via a genuine recovery link (§6); a signed-in
  user wanting to change their password without forgetting it is a
  different, not-yet-built feature.
- No forced sign-out after a successful reset (§8).
- No rate-limiting beyond what Supabase Auth itself enforces
  (`auth.rate_limit.email_sent`, `auth.email.max_frequency` in
  `supabase/config.toml`) — no additional application-level throttle
  was added.
- No change to the "Confirm signup" template's `{{ .SiteURL }}`
  binding (left exactly as P1-E4-S0A2 built it) — noted as a candidate
  future improvement in §9, not performed here (out of this phase's
  scope).
