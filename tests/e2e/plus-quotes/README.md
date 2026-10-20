# Estimates & Quotes regression suites (Nemryn Plus)

Browser regression coverage for the Plus **Estimates & Quotes** module (NP-P2-S5: S2 drafts, S3A directory, S3B
lifecycle, S3C printing and follow-ups, O1 closed-opportunity notice, S4 integrated journey and accessibility).
They were proven during NP-P2-S5 (see `docs/reports/NP-P2-S5-S4-final-integration-report.txt`) and are preserved
here, before the canonical Nemryn UI overhaul, so the overhaul cannot silently change behaviour.

- `tests/e2e/plus-quotes/`: 7 **isolated** suites. They run only against a local Supabase stack with the
  repository's **fictional** seed data and a local `next start`.
- `tests/prod-readonly/plus-quotes/`: 3 **production read-only** verification scripts. They are **manual**,
  owner-authorized only, and never part of CI. See [Production read-only verification](#production-read-only-verification).
- `tests/shared/cdp.mjs`: a minimal Chrome DevTools Protocol harness (no Playwright), the pinned axe-core injector and
  the pinned pdf.js text extractor.

`npm test` (the node unit suites under `src/`) is unchanged and does **not** run any of these.

## Suites

| Key | File | What it protects | S4 baseline |
|---|---|---|---|
| `s2` | `s2-drafts.e2e.mjs` | draft create / edit / withdraw, server totals, OD-Q12, widths | 33 PASS |
| `s3a` | `s3a-directory.e2e.mjs` | organization-wide directory: counts, filters, search, paging, D1 | 31 PASS (**needs a fresh database**) |
| `s3b` | `s3b-lifecycle.e2e.mjs` | Mark sent review, responses, revise, sent withdrawal, OD-Q15 timelines, OD-Q16 DNC | 32 PASS |
| `s3c` | `s3c-print-followup.e2e.mjs` | staff print view (ZD-224), optional follow-up task (ZD-225), access, 404s | 54 PASS |
| `o1` | `o1-closed-notice.e2e.mjs` | "Opportunity closed" print notice (ZD-226) on screen / print media / PDF text | 27 PASS |
| `s4-integrated` | `s4-integrated.e2e.mjs` | end-to-end journey incl. Growth→Core conversion, ZD-227, role matrix, audit, zero outbound | 69 PASS |
| `s4-a11y` | `s4-a11y.e2e.mjs` | axe-core + keyboard on the panel, every quote dialog, the directory and the print page | S4: 18 PASS / 8 FAIL (U1 / U2) → **26 / 26 PASS since NP-UI-P1a** |

## Prerequisites

- Node 20+ and `npm ci` (installs the pinned dev tools `axe-core@4.10.2` and `pdfjs-dist@4.10.38`; no CDN is used at
  test time).
- Google Chrome or Chromium. Set `QUOTES_E2E_CHROME_PATH` if it isn't at the macOS default.
- Docker and the Supabase CLI.
- An **isolated** local Supabase project. By default its Postgres container must be `supabase_db_NemrynS1Iso`.

### Local Supabase setup (isolated stack)

1. Create a separate project directory for the isolated stack (outside this repository), with a `supabase/config.toml`
   whose `project_id` is `NemrynS1Iso` and non-default ports (for example API 54361), so it never collides with your
   everyday local stack.
2. Copy this repository's `supabase/migrations/`, `supabase/seed.sql` and `supabase/tests/` into it. Keep the
   migrations byte-identical (`diff -rq`).
3. Start it: `supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,storage,studio,vector`.
4. Build and serve the app against it on a local port:
   `supabase status -o env` gives `API_URL` / `PUBLISHABLE_KEY` / `SERVICE_ROLE_KEY`. Export them as
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, set
   `NEXT_PUBLIC_APP_URL=http://localhost:3100`, **unset any email provider key** (for example `RESEND_API_KEY`), then
   `npx next build && npx next start -p 3100`.
   Keep the exported values in your shell or a git-ignored file only. Never commit them.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `QUOTES_E2E_APP_URL` | `http://localhost:3100` | local app; must be `http://localhost:<port>` or `http://127.0.0.1:<port>` |
| `QUOTES_E2E_DB_CONTAINER` | `supabase_db_NemrynS1Iso` | local Postgres container (`docker exec`) |
| `QUOTES_E2E_ALLOW_OTHER_LOCAL_STACK` | unset | `1` to allow a different **local** container name |
| `QUOTES_E2E_SUPABASE_WORKDIR` | (required for resets) | the isolated stack's project directory (`supabase db reset --local` runs there) |
| `QUOTES_E2E_ARTIFACTS_DIR` | `$TMPDIR/nemryn-plus-quotes-e2e` | screenshots, PDFs, logs, throw-away browser profiles; must be **outside** the repository |
| `QUOTES_E2E_CHROME_PATH` / `CHROME_PATH` | macOS Chrome path | Chrome binary |

## Fictional fixtures

- The suites use only the repository seed (`supabase/seed.sql`): Org A / Org B, `org-a-admin@example.test`,
  `org-a-dispatcher@example.test`, `org-a-driver-a@example.test`, `org-b-admin@example.test` and
  `platform-admin@example.test`, all with the fictional local password from the seed.
- Each suite creates its own STAMP-suffixed fictional records through the real RPCs or the UI.
- Before running, every suite checks the database **is** the fictional seed: both seed organizations and
  `org-a-admin@example.test` exist, and the production Pilot Simulation organization does **not**. Otherwise it
  refuses.
- **Reset requirement:** the runner resets the isolated database before **each** suite (`supabase db reset --local`)
  and verifies it is fresh: latest migration, 0 quotes, 0 contacts. That way no state is shared between suites. `s3a`
  in particular counts pages and expired quotes and **requires** a fresh database.

## Commands

```bash
export QUOTES_E2E_SUPABASE_WORKDIR=/path/to/isolated-stack   # the NemrynS1Iso project directory
npm run test:e2e:quotes                    # all 7 suites, fresh reset before each
npm run test:e2e:quotes -- s3c o1          # selected suites
npm run test:e2e:quotes:strict             # UI-overhaul gate: known U1 / U2 defects FAIL the run
node tests/e2e/plus-quotes/s3b-lifecycle.e2e.mjs   # one suite directly (no reset; you manage the database)
```

Each run writes `run.log` per suite plus screenshots and PDFs under `QUOTES_E2E_ARTIFACTS_DIR`. The SQL / privilege /
tenant-isolation suites live in `supabase/tests/`. Run each from a fresh reset with
`psql -f supabase/tests/<suite>.sql`; concurrency scripts are `supabase/tests/*_test.sh`.

## Expected results

- `s2` 33, `s3a` 31, `s3b` 32, `s3c` 54, `o1` 27, `s4-integrated` 69: **all PASS**.
- `s4-a11y`: **26 / 26 PASS since NP-UI-P1a** (U1 and U2 fixed; `npm run test:e2e:quotes:strict` passes). Before that it had 18 PASS and these **8 known FAILs**, kept here as the regression reference:
  - U1, colour contrast. WCAG 2.2 SC **1.4.3** (AA), axe `color-contrast` serious. `--color-text-muted` `#646a70` on
    `--color-surface-secondary` `#e8e9e6` = **4.48:1** for 12 px text (needs ≥ 4.5:1). Failing checks: AXE create
    dialog, edit dialog, Mark sent dialog, Mark sent dialog with the do-not-contact warning, and the Estimates & Quotes
    directory (StatusBadge `cancelled` tone).
  - U2, focus not restored. WCAG 2.2 SC **2.4.3** (A). Closing a dialog with its own **Cancel** or **Close (X)** leaves
    focus on `<body>`; Escape restores it. Failing checks: KEY Edit draft → Cancel, Edit draft → Close (X), Record
    accepted → Cancel. Cause: the shared `src/components/ui/Dialog.tsx` unmounts without a native `close()` or focus
    restore.
- The default runner still labels a return of exactly these failures as **"KNOWN DEFECTS ONLY (U1 / U2)"** (exit 0) and
  **any other** failure as unexpected (exit 1). Since they are now fixed, treat any reappearance as a regression and use
  `--strict`, which fails on them. The suite's assertions are intentionally **not** relaxed.
- SQL (each from a fresh reset): 68 of 69 suites with 0 failures, privilege contract 0 / 29.

### Known existing harness exceptions (not product defects)

- `request_decision_expand_compat_tests`: 8 pass / 10 fail. It only applies to an intermediate EXPAND schema.
- `mutation_concurrency_test` CONCURRENCY-1 and `request_lifecycle_concurrency_test` REQUEST-CONCURRENCY-1: the harness
  client lacks the FOR UPDATE privilege (Core-only).
- `RTC-04` depends on the time of day.
- A modal `<dialog>` hands focus to the browser UI after its last control. The keyboard checks therefore Tab only
  through the dialog's own controls.

## Safe execution restrictions

- The isolated suites refuse non-localhost app URLs, non-local / non-`NemrynS1Iso` containers (unless explicitly
  allowed), non-seed databases, and artifact directories inside the repository.
- They write only fictional data to the isolated database, send nothing (the email provider key must be unset), and
  never contact production.
- No credentials, tokens or browser sessions are stored in the repository. Browser profiles are throw-away
  directories under the artifacts directory, deleted when the session closes.
- Do not add these suites to automatic CI without an isolated stack. **Never** add the production scripts to CI or
  npm scripts.

## Production read-only verification

`tests/prod-readonly/plus-quotes/`: `preflight.mjs` (release / database contract), `print-readonly.mjs` (print, O1
notice, ZD-227 wording, access) and `records-integrity-readonly.mjs` (`snapshot <name>` for the B6 integrity snapshot;
`check` for the B5 records / audit / timelines).

- Run **only** with an explicit owner authorization for a read-only verification:
  `QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/<script>.mjs`.
- The scripts refuse to start unless that variable is set and the Supabase CLI is linked to the expected project
  (`QUOTES_PROD_PROJECT_REF`, default `wyocbivzgrbekuyqdfts`).
- Database access is only `supabase db query --linked`, and `q()` refuses anything but a single SELECT / WITH (write
  and DDL keywords, multiple statements).
- Browser use is page views only: no form submission and no write action.
- SIM credentials are read from the **git-ignored** `.env.sim.local` (`QUOTES_SIM_ENV_FILE`). The script refuses a
  file that isn't ignored, and values are never printed.
- Evidence is written to `QUOTES_PROD_ARTIFACTS_DIR` (default `$TMPDIR/nemryn-plus-quotes-prod-readonly`), outside
  the repository.
- `preflight.mjs` compares production with the isolated reference stack
  (`QUOTES_PROD_REFERENCE_DB_CONTAINER`, default `supabase_db_NemrynS1Iso`), which must be running with the repository
  migrations.

## Protecting the canonical UI overhaul

- The suites select elements by `data-testid`, ARIA role and visible staff wording, not by styling. A visual redesign
  that keeps those hooks keeps the suites green.
- Overhaul **acceptance**: `npm run test:e2e:quotes:strict` must pass. U1 and U2 must be fixed, and every other
  suite stays at its S4 baseline. Preserve:
  - the `data-testid` hooks;
  - `role="status"` / `role="alert"` messages;
  - the `print:hidden` print toolbar;
  - screen / print parity of status banners and the closed-opportunity notice;
  - the staff-statement wording.
- If an intentional product change alters an expected value, update the assertion in the same PR, with the decision
  reference. Never relax a check to make a run green.
