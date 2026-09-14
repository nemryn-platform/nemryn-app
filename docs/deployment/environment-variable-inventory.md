# Zenward Platform — Environment Variable Inventory

**Work item:** P1-E4-S0 — Cloud Staging Foundation & S9 Validation, §3 (re-confirmed unchanged by P1-E4-S0A; **extended by G0-R3 — Driver Invitation Email Delivery**)
**Status:** Audited directly against the current application code (`grep -rn "process\.env\."` across `src/`, plus every `.env*` file and `supabase/config.toml`) — nothing here is assumed from older docs. **G0-R3 update:** the driver invitation email introduced the first genuinely server-only environment variables (`RESEND_API_KEY`, `EMAIL_FROM`) and made `NEXT_PUBLIC_APP_URL` a real dependency for the first time.
**Last updated:** 2026-09-08

## The complete set

The current application reads **5** environment variables plus Next.js's own built-in `NODE_ENV` — confirmed by direct code search, not inferred from `.env.example`.

| Variable | Classification | Read by | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **BROWSER SAFE** | `src/lib/supabase/env.ts` → browser client, server client, proxy.ts | The Supabase project's API endpoint. Safe for the browser bundle — it names a location, not a credential. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **BROWSER SAFE** | Same 3 call sites | The Supabase **publishable** (anon) key — deliberately the ONLY Supabase key this application ever uses, anywhere, browser or server (`docs/security/application-auth-boundary.md`). It grants no privilege by itself; every access decision is enforced by RLS/RPC authorization against the caller's real session. **Never the service-role/secret key** — that key does not appear anywhere in this codebase, `.env.example`, or any doc, and must never be added to a `NEXT_PUBLIC_*` variable if a future phase ever needs it for a genuinely trusted server-only path. |
| `NEXT_PUBLIC_APP_URL` | **BROWSER SAFE** (now used — G0-R3) | `src/lib/app-url.ts` (`getAppOrigin`) → `createDriverInviteAction` / `resendDriverInviteAction` build the `/join/<token>` link inside the driver invitation email. Falls back to the request's forwarded host if unset. | The application's own canonical absolute origin, for absolute links that leave the app (currently: the driver invitation email). Was reserved for exactly this; as of G0-R3 it is a real functional dependency for correct invite links (a wrong value produces an unreachable link). Still browser-safe — it names a location, not a credential. |
| `RESEND_API_KEY` | **SERVER ONLY — SECRET** | `src/lib/email/send.ts` only (module is `import "server-only"`; the variable name is deliberately NOT `NEXT_PUBLIC_`) | The Resend (https://resend.com) API key for sending the driver invitation email. **Never exposed to the browser, never logged, never written to a doc/report.** Absent in local dev → the email is logged to the server console instead of sent. Absent in production → invites are created but the operator is honestly told the email was not sent. |
| `EMAIL_FROM` | **SERVER ONLY** (not a secret, but server-scoped) | `src/lib/email/send.ts` only | The `From:` address on transactional email — **Nemryn's own standard platform sender**, used for every organization (e.g. `"Nemryn <notifications@nemryn.com>"`). There is no per-tenant sender domain; the organization's real name still appears dynamically in the email subject/body, only the technical sender is fixed. Must be an address on a domain verified in the Resend account. Defaults to a neutral placeholder if unset — never a tenant-shaped default. |
| `NODE_ENV` | **SERVER ONLY** (Next.js built-in, never user-set) | `src/app/select-organization/actions.ts` (`secure` cookie flag); `src/lib/email/send.ts` (dev console transport only when no `RESEND_API_KEY`) | Automatically `"production"` on every Vercel deployment, `"development"` locally. |

**That is the entire inventory.** No other `process.env.*` reference exists anywhere in `src/` (confirmed by direct grep after G0-R3, not sampled).

## What does NOT exist in this codebase (confirmed, not assumed)

- **No service-role / secret Supabase key** is read, stored, or referenced anywhere in application code, `.env.example`, or any committed doc.
- **No `NEXT_PUBLIC_*` variable carries anything privileged.** All three public variables are safe by their own design (publishable key + two location strings), not merely "safe because nobody looks."
- **`RESEND_API_KEY` is the first true secret this application reads.** It is confined to one `server-only` module (`src/lib/email/send.ts`), never bundled for the browser, never logged, never placed in a doc/report. It is the model for how any future server-only credential must be handled — a non-`NEXT_PUBLIC_` name, a `server-only` module, a discriminated result instead of a thrown provider error.
- **No hardcoded `localhost`/`127.0.0.1` string** exists anywhere in `src/` (see `docs/deployment/staging-architecture.md` §Localhost Assumption Audit for the full search).

## Per-environment values required

| Variable | LOCAL (this repo's own dev) | STAGING (Vercel Preview/Production env, ZenwardApp Staging Supabase) | FUTURE PRODUCTION |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54331` (local Supabase CLI stack) | `https://wyocbivzgrbekuyqdfts.supabase.co` (the linked "ZenwardApp Staging" project's own API URL) | A DIFFERENT, dedicated production Supabase project's URL — **never the staging project's URL.** Not created this phase (work item §15's explicit prohibition). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The local stack's own anon key (in `.env.local`, gitignored) | The staging project's own publishable key, set as a Vercel Environment Variable (Project Settings → Environment Variables) — **never committed to git, never placed in a doc or report** | A different production project's own publishable key |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://app.zenwardmobility.com` — the deployment's own reachable origin (invite links are built from this) | `https://app.zenwardmobility.com` (or the production domain in effect) |
| `RESEND_API_KEY` | *(leave blank — dev logs the email to the console)* | A Resend API key (`re_…`), set only as a Vercel Environment Variable — never committed | A Resend API key for the production Resend account |
| `EMAIL_FROM` | *(leave blank — a placeholder is used)* | `"Nemryn <notifications@nemryn.com>"` (or equivalent) on a Resend-verified domain | Same — Nemryn's own domain, not a tenant's |

## Where each environment's values actually live

- **LOCAL**: `.env.local` (gitignored via `.gitignore`'s `.env*` pattern — confirmed present and correctly matching before this phase touched anything).
- **STAGING**: Vercel Project Settings → Environment Variables, scoped to the Preview/Staging environment specifically — **not committed to the repository, not written into any doc in this phase.** See `docs/deployment/staging-runbook.md` for the exact steps to set these (values are entered directly in the Vercel dashboard by whoever has access — this document names WHAT to set, never the actual secret value).
- **FUTURE PRODUCTION**: Not created this phase. When it is, it must use its own, separate Vercel environment-variable scope (Vercel supports distinct values per environment for the exact same variable name) — never reusing the staging project's values.

## Secrets audit (work item §3's own explicit requirement)

Confirmed clean before this report was written:
- `git log -p -- '*.env*'` / `git status` — `.env.local` has never been tracked, is not tracked now.
- No secret VALUE (of any kind — Supabase keys, database passwords, Vercel tokens) appears anywhere in this document, any other doc, any report, or any source file in this repository. Every value in this inventory is described by name and classification only.
- The Supabase **publishable** key is the one credential that legitimately does appear in `.env.local` (local only, gitignored) and would appear in Vercel's own environment-variable UI for staging — this is by design (docs/security/application-auth-boundary.md), since it is not a secret in the traditional sense (RLS is the actual authorization boundary), but it is still never hand-copied into a markdown doc or a `.txt` report by this project's own convention.
