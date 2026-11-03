# "Add contact" from Core Request Details: isolated browser regression

Browser regression coverage for creating a Growth contact from a Core request's requester and linking it in one
database transaction (NP-CORE-PLUS-REQUEST, ZD-294..ZD-301). It runs **only** against a local, isolated Supabase stack
seeded with the repository's **fictional** seed data, plus a local production build of the app.

```
npm run test:e2e:request-contact                    # full run, screenshots included
npm run test:e2e:request-contact -- --no-screenshots
```

It reuses the isolated configuration and harness of the quote suites (`tests/e2e/plus-quotes/_config.mjs` and
`_harness.mjs`). Set up the stack and the app as in [the quote suites' README](../plus-quotes/README.md#prerequisites).
The same `QUOTES_E2E_*` variables apply: app URL, database container, Chrome path and artifacts directory.

## What it covers

| # | Scenario |
|---|---|
| 1 | Organization Admin: Add contact offered, requester prefill, every field editable, one contact + one link, Open in Plus |
| 2 | Dispatcher with a Plus **write** grant: the same workflow |
| 3 | Dispatcher with a **read** grant: sees Growth; no create / link controls; direct database calls refused |
| 4 | Organization without Plus: no Growth panel; cross-organization and no-Plus database calls refused |
| 5 | Feature disabled (the default): Add contact hidden, Link existing contact kept, direct call refused (`ZW004 request_contact_not_enabled`), and a form left open while the feature is switched off is refused by the server |
| 6 | Duplicates: matches listed, an active match linkable, an archived one not, explicit "Create a separate contact", no merge |
| 7 | Two signed-in sessions submit the same request at once: one attribution, no orphan contact, a clear message for both |
| 8 | Existing attribution: linked state, no Add contact; a stale open form gets "already linked" and creates nothing |
| 9 | Invalid data: field errors (`aria-invalid` + `aria-describedby`), typed values kept, nothing written |
| 10 | Core integrity: every Core row (requests, passengers, trips and their children, invoices, lines, payments) byte-identical; no opportunity, consent, task or quote; provenance audit holds the request id only |
| A11y | axe-core (pinned) on the unlinked panel, the form, validation errors, the duplicate warning and the linked state; keyboard walkthrough (open, Tab order, Shift+Tab, Cancel, Enter to submit, pending state); focus after Cancel (Add contact), after a refused submission (first invalid field, the server error or the duplicate explanation) and after success (the linked contact); the persistent status region announcing "Adding the contact…" and then the success, as the same node, with no second live region |
| Visual | Full-page and Growth-panel screenshots at 1440 / 1024 / 768: unlinked, form, validation, duplicates, success, read-only |

Focus after Cancel, after a validation error and after success is **asserted** since NP-CORE-PLUS-REQUEST-02C-R1
(findings A1–A4 fixed). The editor's height at each width is recorded in `findings.json`.

## Shared-stack safety

- It refuses to run unless the database is the fictional seed (`assertFictionalSeed`), migration `20261102100000` is
  applied, and **no** request-contact enablement exists.
- It does **not** reset the database. Every fixture is fictional and carries a per-run stamp (`RC02C … <stamp> Fictional`,
  `@example.test`). Org A is enabled only through the approved Platform Admin RPC, with data class `synthetic`.
- The `finally` block disables Org A through the same RPC and removes exactly what the run added. It also restores Org
  A / Org B's module rows. The run **fails** unless every watched table is back to its starting row count and no
  enablement remains.
- The app under test must answer as Nemryn at the start and at the end. That catches another local project taking the
  port.

## Local stack notes

The local API gateway (Kong) sometimes answers `502` ("upstream prematurely closed connection") to PostgREST calls.
When that hits the Growth read, the panel shows its "couldn't be loaded" state, or hides Add contact (the offer check
fails closed). The suite reloads up to twice and records each reload as a `NOTE — RETRY` line. A failure in a later
page refresh (for example, after a save) is **not** retried and fails the check. The `NOTE` explains what the page showed.
