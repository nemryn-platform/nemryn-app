# QA2 regression suites (Core, Growth, Auth)

These suites are the browser regression protection for Nemryn's Core operations, the Growth workspace and the
auth / access boundaries. They were created in NP-UI-QA2 before the UI-P2 visual refinement, so later UI work can't
silently change behaviour. Estimates & Quotes keep their own suites in [`../plus-quotes`](../plus-quotes/README.md).

The suites:
- select elements by `data-testid`, ARIA role, accessible name, form-field `name` and visible operator wording;
- verify **outcomes in the isolated database** (rows written, states changed, nothing duplicated), not just that a
  page rendered.

| Key | File | What it protects |
|---|---|---|
| `core-requests` | `core-requests.e2e.mjs` | See below |
| `core-trips-dispatch` | `core-trips-dispatch.e2e.mjs` | See below |
| `core-records` | `core-records.e2e.mjs` | See below |
| `growth` | `growth.e2e.mjs` | See below |
| `auth-access` | `auth-access.e2e.mjs` | See below |

**`core-requests`**
- The Requests list and status tabs.
- Log Request: required-field validation and the outcome.
- Request decisions:
  - accept;
  - add and link a passenger;
  - **Create Trip handoff** (Request → Trip);
  - decline and cancel with structured reasons.
- List badges.
- Driver refusal and tenant isolation.
- Keyboard dialog focus (U2), axe, 768px.

**`core-trips-dispatch`**
- The Trips list and its search / date / assignment filters.
- New Trip: validation, passenger search and creation.
- Trip Detail: edit / correction, notes, assign / reassign (keyboard), cancel.
- The Dispatch Board:
  - Today / Tomorrow;
  - the Needs Assignment queue;
  - keyboard assignment with focus return;
  - contained grid scrolling at 1024 / 768.
- Tomorrow Readiness and the Day Sheet.
- Role and tenant boundaries.

**`core-records`**
- Standing Orders:
  - create an arrangement;
  - create one occurrence;
  - review and bulk-create missing rides, with no duplicates.
- Passengers (add, edit via the row action), Facilities (add), Vehicles (add), Drivers (invite).
- Proof of Service (yesterday).
- Dispatcher read-only records; 768px.

**`growth`**
- The Dashboard.
- Contacts: validation, create, list.
- Pipeline: an opportunity from the contact.
- Tasks: create, list, mark done.
- The **Growth → Core handoff**: an opportunity becomes exactly one pending transportation request.
- Entitlement: no grant, a read grant, revoke, Plus disabled.
- Tenant isolation.

**`auth-access`**
- Sign-in (bad and good credentials) and sign-out.
- Workspace selection and switching.
- Role permissions.
- The driver invitation (invite → `/join` → account → driver app).
- New-business sign-up and onboarding.
- Error and not-found states.
- A per-route **one-h1 + axe sweep** of 29 Core and Growth screens.
- The 390px notice.

## Running

Same prerequisites as the quote suites: an isolated local Supabase stack (`NemrynS1Iso`), the repository's fictional
seed, the app served locally on `http://localhost:3100`, and Chrome. See
[`../plus-quotes/README.md`](../plus-quotes/README.md#prerequisites).

```bash
export QA2_E2E_SUPABASE_WORKDIR=/path/to/isolated-stack   # the NemrynS1Iso project directory
npm run test:e2e:qa2                      # all 5 suites, fresh reset before each
npm run test:e2e:qa2 -- core-requests     # selected suites
npm run test:e2e:qa2:strict               # known baseline defects FAIL the run (the UI-P2 acceptance gate)
node tests/e2e/qa2/growth.e2e.mjs         # one suite directly (no reset; you manage the database)
```

The runner resets the isolated database before **each** suite and verifies the reset is fresh. Each suite writes
`results.txt` and screenshots under `$TMPDIR/nemryn-plus-quotes-e2e/qa2-<suite>/`, and the runner writes
`qa2-<suite>-run.log` there too.

## Safety

The suites refuse to run against anything that isn't the fictional seed database (`assertFictionalSeed`), and they
only use localhost URLs.

Fixtures are created through the real UI or real routes where it matters, otherwise with harness SQL:
- a fictional website connection, posted to through the **real** public intake route;
- fictional passengers and trips;
- Nemryn Plus module rows and named grants.

Other guarantees:
- No email is sent: the isolated environment has no email provider.
- Every browser call is time-bounded, so a stalled browser fails by name instead of hanging the run.
- No credentials, sessions or tokens are stored in the repository.

## Known baseline defects

Real defects found on the unchanged P1b application. They are **not** relaxed. `--strict` fails while any remains:
- `S5 arrangement detail: exactly one visible h1 (page title)`
- `H1 /operations/recurring-care/[id]: exactly one visible h1`

Both are the same defect: the Standing Order detail page renders no `<h1>`.

Coverage limits are recorded in `docs/reports/NP-UI-QA2-regression-preservation.txt`:
- staff (team) invitations, whose link is only delivered through the server's development mail log;
- the platform admin console;
- the driver mobile app's internals.
