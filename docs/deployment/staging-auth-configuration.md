# Zenward Platform — Staging Auth Configuration

**Work item:** P1-E4-S0A2 — Auth Confirmation Callback Fix, §6 (supersedes P1-E4-S0A1 §8)
**Status:** The staging URL is confirmed reachable end to end at a real custom domain. A real confirmation email is now being delivered (the earlier rate limit resolved). This phase's own required action — see §Required Confirm Signup email template — is the ONE remaining Dashboard change needed for confirmation links to actually establish a session.
**Last updated:** 2026-09-03

## Confirmed staging URL

**`https://app.zenwardmobility.com`** — a real custom domain now attached to the Vercel staging project, confirmed directly via `curl`: `/sign-in` returns HTTP 200 with the real page (`<title>Sign in — Zenward Mobility</title>`), server header confirms Vercel/Next.js. This supersedes the earlier `https://zenward-app-staging.vercel.app` (itself a replacement for an abandoned, permanently-`NOT_FOUND` earlier project — see `docs/reports/P1-E4-S0-cloud-staging-foundation-report.txt` §10/§25) — `zenward-app-staging.vercel.app` most likely remains reachable as the underlying Vercel project's own default domain, but **`app.zenwardmobility.com` is now the one to configure Supabase Auth against and the one to use for all further staging work.**

## What the application code actually does (verified, not assumed)

Confirmed by direct code search (`grep -rn "emailRedirectTo\|redirectTo\|resetPasswordForEmail\|inviteUserByEmail" src/`):

- `supabase.auth.signUp({ email, password })` is called with **no `emailRedirectTo` option**, in both `/sign-up` and `/join/[token]` (driver-invite redemption signup). This means any confirmation email Supabase sends is built entirely from the Supabase project's own **Site URL** setting — there is no code-level override to configure.
- ~~No password-recovery flow exists in the application yet — `resetPasswordForEmail` is never called anywhere in `src/`.~~ **Superseded by P0-S2B — Forgot Password / Password Recovery.** `resetPasswordForEmail()` is now called from `src/app/forgot-password/actions.ts`, with an explicit `redirectTo` built from this app's own trusted origin (`src/lib/app-url.ts`, the same P0-S2A infrastructure the driver-invitation email already uses) — see §Required Reset Password email template below and `docs/product/password-recovery-model.md` for the full architecture.
- **No Supabase-native invite email is used for Driver invites.** S9's own design (`docs/product/driver-invite-linkage-model.md`, ZD-196) deliberately never calls `inviteUserByEmail` or any other Supabase Admin-API email path — the organization admin shares the `/join/[token]` link directly. Driver invites therefore have **no dependency on Supabase's email configuration at all.**

## Required Supabase Dashboard settings (staging project: "ZenwardApp Staging", ref `wyocbivzgrbekuyqdfts`)

Authentication → URL Configuration:

| Setting | Required value |
|---|---|
| **Site URL** | `https://app.zenwardmobility.com` — this is what every auth email's link is built from, since the app never overrides it per-call. |
| **Redirect URLs** (allow-list) | `https://app.zenwardmobility.com`, `https://app.zenwardmobility.com/**` (wildcard, so `/join/[token]` and any future callback path are covered), plus `http://localhost:3000` and `http://127.0.0.1:3000` (kept for local development — work item's own explicit instruction: "Retain localhost development support"). |

**Not independently re-confirmed this phase** whether these exact values are LIVE on the Supabase Dashboard for the staging project (ref `wyocbivzgrbekuyqdfts`) — this document specifies what they must be; applying/confirming them via the Dashboard itself requires access this environment does not have (see the phase report's own blockers section). See §Email confirmation reality below for what WAS directly tested against this project.

**Applied via the Supabase Dashboard directly** (Authentication → URL Configuration), never via `supabase config push` — that command pushes the ENTIRE local `supabase/config.toml`, including settings (SMS providers, storage, edge-function config, local Docker ports) that were never reviewed for staging-safety and have no business being pushed to a hosted project at all. A two-field Dashboard edit is the correct, minimum-blast-radius mechanism for this specific change (ZD-198).

## Required Confirm Signup email template (P1-E4-S0A2 — the actual root cause)

**Why the confirmation link doesn't establish a session today:** Supabase's DEFAULT "Confirm signup" template links via `{{ .ConfirmationURL }}`, which points at Supabase's own hosted `https://<project>.supabase.co/auth/v1/verify?token=...&type=signup&redirect_to=<Site URL>`. That endpoint verifies the token, then redirects the browser to Site URL with the new session encoded as a URL **fragment** (`#access_token=...&refresh_token=...`) — confirmed directly, by following this exact link with `curl` and reading its `Location` header. A fragment is **never sent to any server** (browsers don't transmit it in the request) — only client-side JavaScript can read `window.location.hash`. A plain Server Component landing page (this app's root `/`, or anywhere else) can never see it, so no session is ever established server-side — the person lands back on an unauthenticated `/`, and (before this phase) that read as "click didn't work."

**The fix — apply this exact template in the Supabase Dashboard (Authentication → Email Templates → Confirm signup, staging project ref `wyocbivzgrbekuyqdfts`):**

Subject: `Confirm your Nemryn account`

```html
<h2>Confirm your account</h2>
<p>Follow this link to confirm your Nemryn account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a></p>
```

**P0-S2B-C1 platform-identity correction:** the subject and body above
originally read "Confirm your Zenward account" / "…confirm your Zenward
Mobility account" (P1-E4-S0A2's own original wording). Corrected to
"Nemryn" per the commercial rule established in P0-S2B-C1: Nemryn owns
platform authentication; an organization such as Zenward Mobility is a
tenant INSIDE Nemryn, and a Supabase Auth email is account-level
communication about the person's NEMRYN account — it must never speak
with an organization's own identity. The link/token structure
(`{{ .SiteURL }}`, `{{ .TokenHash }}`, `type=signup`) is byte-for-byte
unchanged — only the two visible copy strings above changed. See
`docs/reports/p0-s2b-c1-auth-email-identity-alignment.txt`.

This links directly to `/auth/confirm` (`src/app/auth/confirm/route.ts`, new this phase) with `token_hash`/`type` as ordinary, server-readable query parameters — no Supabase-hosted redirect involved at all. That Route Handler calls `supabase.auth.verifyOtp({ type, token_hash })` on the SERVER Supabase client, which writes the real session cookie directly, then redirects to `/complete-signup`. `type=signup` matches Supabase's own official Next.js SSR guide's example for this exact template (`{{ .TokenHash }}` is only populated for this specific field name); do not substitute a different `type` value without checking Supabase's own current docs for the template being edited.

**Not independently applied this phase** — same access limitation as the URL Configuration fields above (no Supabase Dashboard credential in this environment). Local dev's own equivalent (`supabase/config.toml`'s new `[auth.email.template.confirmation]` section, pointing at `supabase/templates/confirmation.html` — the identical template text) WAS applied and is what this phase's own local proof (§ the phase report) actually exercised end to end with a real Mailpit-delivered email.

**RedirectTo / environment flexibility (work item §6's own note):** deliberately NOT added to the template above. `/auth/confirm` itself takes no `next`/`redirect_to` parameter and always redirects to the fixed `/complete-signup` destination on success — there is no caller-suppliable redirect target anywhere in this flow, so there is no allowlist needed. If a genuine multi-environment need ever arises (the same Supabase project serving both a preview and a stable staging URL, say), add an explicit, allowlisted `next` parameter to `/auth/confirm` at that point — not before it's actually needed.

## Required Reset Password email template (P0-S2B)

The password-recovery flow reuses the exact same `/auth/confirm` Route
Handler as signup confirmation (§Required Confirm Signup email template
above), with `type=recovery` instead of `type=signup`. The same root
cause applies: Supabase's DEFAULT "Reset Password" template links via
`{{ .ConfirmationURL }}`, whose fragment-based session delivery a Server
Component can never read.

**The fix — apply this exact template in the Supabase Dashboard
(Authentication → Email Templates → Reset Password, staging project ref
`wyocbivzgrbekuyqdfts`):**

Subject: `Reset your Nemryn password`

```html
<h2>Reset your password</h2>
<p>Follow this link to reset your Nemryn password:</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a></p>
<p>If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
```

**P0-S2B-C1 platform-identity correction:** the subject and body above
originally read "Reset your Zenward password" / "…reset your Zenward
Mobility password" (P0-S2B's own original wording). Corrected to
"Nemryn" for the exact same reason as the Confirm Signup template
above — see that section's own note. The link/token structure
(`{{ .RedirectTo }}`, `{{ .TokenHash }}`, `type=recovery`) is
byte-for-byte unchanged — only the two visible copy strings above
changed. See
`docs/reports/p0-s2b-c1-auth-email-identity-alignment.txt`.

**Deliberately uses `{{ .RedirectTo }}`, not `{{ .SiteURL }}`** — unlike
the signup-confirmation template above. `resetPasswordForEmail()` is
called with an explicit `redirectTo: \`${origin}/auth/confirm\`` option
(`src/app/forgot-password/actions.ts`), where `origin` comes from this
app's own `getAppOrigin()` (`src/lib/app-url.ts`, reusing the exact
P0-S2A infrastructure built for the driver-invitation email link) —
NOT from Supabase's separately-configured Site URL setting. This is
what lets the recovery link automatically track `NEXT_PUBLIC_APP_URL`
(today `https://app.zenwardmobility.com`, later `https://app.nemryn.com`
— see `docs/product/password-recovery-model.md` §Domain migration
impact) with **no further Dashboard/template edit required** at
migration time — a deliberate improvement over the confirmation
template's `{{ .SiteURL }}` binding, not applied retroactively to that
template in this phase (out of this phase's scope; §Domain Migration
Readiness in the P0-S2B report notes it as a candidate follow-up).

For `{{ .RedirectTo }}` to actually resolve to the value the app passed
(rather than being silently stripped), the passed origin's URL must
match, or be covered by, this Supabase project's own **Redirect URLs**
allow-list (§Required Supabase Dashboard settings above already lists
`https://app.zenwardmobility.com/**`, which covers `/auth/confirm`).

**Not independently applied this phase** — same Dashboard-access
limitation noted throughout this document. Local dev's own equivalent
(`supabase/config.toml`'s `[auth.email.template.recovery]` section,
pointing at `supabase/templates/recovery.html` — the identical template
text) WAS applied and exercised end to end against the local stack —
see `docs/reports/p0-s2b-password-recovery.txt` §16.

## Email confirmation reality on staging

Local dev has `enable_confirmations = false` (`supabase/config.toml`) — no verification gate. The staging Supabase project (ref `wyocbivzgrbekuyqdfts`) has confirmations **ON**. P1-E4-S0A1 directly confirmed the project's built-in email sender was rate-limited (`over_email_send_rate_limit`) at that time; per this phase's own work item, **a real confirmation email is now being delivered successfully** — the rate-limit window has evidently passed (this specific claim was not independently re-verified this phase via a fresh raw API call, since doing so would consume more of that same limited quota for no additional information; the work item's own problem statement — a real email arrived, but clicking it failed to establish a session — is itself consistent with delivery now working).

- **What was actually broken, given delivery works:** the DEFAULT template's link shape (§Required Confirm Signup email template above) — not sending, not the rate limit. This phase's fix requires the Dashboard template change above to take effect; without it, `/auth/confirm` is unreachable from a real confirmation email regardless of how reliably Supabase delivers it.
- **Recommended before high-volume staging use, and required before production:** still worth configuring a real SMTP provider (Supabase Dashboard → Authentication → Emails → SMTP Settings) — e.g. Postmark, Resend, SendGrid — so sending isn't limited to Supabase's own low-volume built-in sender. Not done this phase (no such provider account/credential was available) — unchanged from P1-E4-S0A1.

## What this phase did NOT do

- Did not call `supabase config push` against staging. That command pushes the ENTIRE local `supabase/config.toml` — including `site_url = "http://127.0.0.1:3000"` — which would have been actively wrong for a cloud deployment. Auth URL configuration for staging must be set directly in the Supabase Dashboard (or via a deliberately staging-specific config file/profile, not attempted this phase) — never via a blind `config push` of the local file.
- ~~Did not enable a password-recovery flow (doesn't exist in the app yet...)~~ **Superseded by P0-S2B** — the flow now exists in the application; what this document still has NOT done is apply the required Reset Password Dashboard template (§Required Reset Password email template above) to the staging/production Supabase project, for the same Dashboard-access-limitation reason the Confirm Signup template was never applied here either.
- Did not configure any Driver-invite-related Supabase email setting, since the feature has no dependency on one.
- Did not configure a custom SMTP provider for staging (see §Email confirmation reality — the rate-limit finding above is the direct consequence of not having one).
- Did not disable email confirmations on the staging project to work around the rate limit — the work item's own explicit, verbatim prohibition ("Do NOT disable email confirmation").
