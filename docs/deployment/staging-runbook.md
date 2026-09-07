# Zenward Platform — Staging Runbook

**Work item:** P1-E4-S0A2 — Auth Confirmation Callback Fix (supersedes P1-E4-S0A1's own working-URL section)
**Audience:** whoever next needs to deploy, reset, or re-verify staging.
**Last updated:** 2026-09-03

## Confirmation emails now require a Dashboard template change

Before this fix works on staging, the Supabase Dashboard's own "Confirm signup" email template (Authentication → Email Templates, project ref `wyocbivzgrbekuyqdfts`) must be updated to link to `/auth/confirm` directly — the default template's link shape cannot establish a session at all (a genuine root cause found this phase, not a hypothetical). See `docs/deployment/staging-auth-configuration.md` §Required Confirm Signup email template for the exact template text to paste in.

## Working staging URL

**`https://app.zenwardmobility.com`** — a real custom domain now attached to
the Vercel staging project, confirmed reachable (HTTP 200, real SSR HTML,
correct `<title>Sign in — Zenward Mobility</title>`). **Use this domain for
all staging work going forward.** Prior URLs, for history:
`https://zenward-app-staging.vercel.app` (the underlying Vercel project's own
default domain — created by the user to replace an earlier, permanently
`NOT_FOUND` project; see `docs/reports/P1-E4-S0-cloud-staging-foundation-report.txt`
§10/§25 and `docs/reports/P1-E4-S0A-cloud-staging-validation-closure-report.txt`
§4 for the full history) most likely still resolves as an alias, but is no
longer the primary URL — `app.zenwardmobility.com` is. The original
`zenward-app.vercel.app` URL is abandoned entirely — do not use it.

Note: the per-deployment hash URL for this project (e.g.
`https://zenward-app-staging-<hash>-zenwardmobility-9199.vercel.app`, as
recorded in the GitHub Deployments API) is still gated by Vercel Deployment
Protection (a 302 to `vercel.com/sso-api`) — only the custom domain
(`app.zenwardmobility.com`) and the project's own default `.vercel.app`
domain are openly reachable. Always use `app.zenwardmobility.com`, never the
per-deployment hash URL, for staging work.

## Prerequisites

- `supabase` CLI, logged in (`supabase login`) to an account with access to the `zenwardmobility` organization.
- This repository checked out, with `supabase/.temp/project-ref` present (already linked to `wyocbivzgrbekuyqdfts` — "ZenwardApp Staging"). If not linked: `supabase link --project-ref wyocbivzgrbekuyqdfts`.
- `gh` CLI, authenticated as a `zenwardmobility` collaborator, for inspecting Vercel deployment status via GitHub's own deployment records (Vercel's GitHub integration posts deployment status there).
- Access to the Vercel dashboard (zenwardmobility team) for anything this runbook can't do via CLI — environment variables, Deployment Protection, domains.

## Pushing schema changes to staging

**Migrations are authoritative — never hand-edit schema via the Supabase Dashboard's own table/SQL editor for staging.**

```bash
# From the repository root, after any new migration is added:
supabase db push --dry-run   # review the exact statements that would run
# ... review the output ...
supabase db push             # apply for real
```

`--dry-run` is read-only and safe to run at any time to check drift. The real `db push` applies pending migrations to the LIVE staging database — treat it with the same care as any other schema change to shared infrastructure, even though staging data is disposable.

**Never** run a destructive linked-reset command (there is no `supabase db reset --linked` equivalent that's safe to run casually — local `db reset` only ever touches the LOCAL Docker stack) against staging without first explicitly confirming with whoever owns the project that its current data is disposable. This phase never ran any destructive command against staging.

## Seeding staging

Staging may contain **synthetic/demo data only** — the same "Harmony Medical Transport" fixture the local dev environment already uses (`supabase/seed.sql`), never real passengers, PHI, or real operator data (work item §6).

`supabase db push` does **not** run `seed.sql` against a linked remote project (unlike local `db reset`, which always re-seeds). Seeding a cloud project is a deliberate, separate action — this phase did not seed staging with fresh data (found the schema already current via `supabase migration list --linked`; whether staging already carries the Harmony fixture or is schema-only was not verified live this phase due to the Vercel access blocker in §5 of `staging-architecture.md` — the NEXT session to work on staging should confirm this first via a direct query or through the deployed app itself, once reachable).

If seeding is needed: connect directly to the staging Postgres connection string (available via the Supabase Dashboard → Project Settings → Database, or `supabase projects api-keys`/connection-string tooling — never hand-typed into a doc or report) and run `supabase/seed.sql` against it, exactly as written — the same file local dev uses, no parallel "staging-only" seed file.

## Deploying to Vercel

This project already auto-deploys on every push to `main` via Vercel's GitHub App integration — **no manual deploy step is normally needed.** To check the status of the most recent deployment without Vercel dashboard access:

```bash
gh api repos/zenwardmobility/ZenwardApp/deployments --jq '.[0]'
gh api repos/zenwardmobility/ZenwardApp/deployments/<id>/statuses --jq '.[0]'
```

The `environment_url`/`target_url` field in the latest deployment status is a PER-DEPLOYMENT hash URL, not the project's own stable public domain, and for this project it is additionally gated by Deployment Protection — do not rely on it as "the staging URL." **The custom domain is `https://app.zenwardmobility.com`** (see "Working staging URL" above) — always use this. Still worth a quick `curl -I` before each session to confirm it resolves — see `docs/deployment/staging-auth-configuration.md` §Confirmed staging URL for the current reachability status.

## Vercel environment variables (staging)

Set in the Vercel Dashboard → Project Settings → Environment Variables, scoped to the environment staging actually runs in (Preview, or Production if that's genuinely what's configured — confirm which before setting, since Vercel's Preview and Production environments carry independent variable values for the same name):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The "ZenwardApp Staging" project's own API URL (`https://wyocbivzgrbekuyqdfts.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's own publishable key (Supabase Dashboard → Project Settings → API — never hand-copied into any doc or report) |
| `NEXT_PUBLIC_APP_URL` | The deployment's own reachable URL (currently unused by any code — see `environment-variable-inventory.md` — but still worth setting correctly) |

This runbook does not confirm whether these are ALREADY set correctly on the live Vercel project — that requires Vercel dashboard/CLI access this phase did not have (see the report's own §Blockers). If the live app fails to reach Supabase at all (a blank error page, not a normal sign-in screen), start here.

## Configuring Supabase Auth for staging

See `docs/deployment/staging-auth-configuration.md` for the exact Site URL / Redirect URL values, once the correct, currently-reachable staging URL is confirmed.

## Re-verifying staging after any change

1. `supabase migration list --linked` — confirm schema is current.
2. `gh api repos/zenwardmobility/ZenwardApp/deployments --jq '.[0]'` — confirm the latest deploy's commit matches `main`'s current HEAD and its `state` is `success`.
3. Visit the deployment's own URL directly (browser, or `curl` if Deployment Protection is off) — confirm `/sign-in` renders the real sign-in form, not an error page or an unexpected 404.
4. Run through the primary sign-up → onboarding → first-Trip flow once, end to end, exactly as documented in `docs/product/operator-onboarding-model.md` — the same flow already proven locally in the S9 report.

## Local regression stays the baseline

Every schema/RLS change still requires the full local regression before it is ever pushed to staging: `supabase db reset` (local), the full `supabase/tests/*.sql` suite, both concurrency scripts, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Staging verification is additive, never a substitute for local regression.
