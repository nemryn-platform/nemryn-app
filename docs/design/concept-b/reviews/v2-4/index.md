# NP-UI-V2-4 — screenshot evidence

These are real browser captures of the isolated app: `NemrynS1Iso` on `localhost:3100`, a production build (Turbopack).
- Before and after were both captured on a fresh `supabase db reset` with the local Plus demo enabled.
- Growth empty states are captured first, then the fictional Growth / Quotes fixture is written through the Plus RPCs
  as `org-a-admin`.
- Capture tool: session scratchpad `v24/capture.mjs` (scratch tooling, not committed).

**Before:** `origin/main` `d14fbf5` (V2-3 merged).
**After:** the final NP-UI-V2-4 working tree.

## Sheets

| File | Content |
|---|---|
| `v2-4-buttons-before-vs-after.png` | Button harmonization: Trip Detail, Dispatch, Opportunity (sent and draft quote), Contact |
| `v2-4-empty-states-before-vs-after.png` | Tasks, Quotes, Standing Orders, filtered Tasks, Requests, Pipeline |
| `v2-4-dialogs-before-vs-after.png` | Cancel Trip, Decline Request, Assign Driver, Withdraw draft, New task |
| `v2-4-desktop-contact-sheet.png` | Every 1440 after capture |
| `v2-4-tablet-contact-sheet.png` | Every 768 after capture |
| `v2-4-mobile-auth-sheet.png` | Auth at 390×667, full page (`auth-390/`) |

## Captures (`before/` and `after/`, identical names)

| File | Screen | Width |
|---|---|---|
| `a01-sign-in-390x844` | Sign in | 390x844 |
| `a02-sign-up-390x667` | Sign up | 390x667 |
| `a03-forgot-390x844` | Forgot password | 390x844 |
| `b01-overview-1440` | Operations Overview (approved V2-1 reference) | 1440 |
| `b02-request-detail-1440` | Request Detail | 1440 |
| `b03-trip-detail-1440` | Trip Detail (Cancel Trip, Assign Driver) | 1440 |
| `b03-trip-detail-768` | Trip Detail (Cancel Trip, Assign Driver) | 768 |
| `b04-dispatch-1440` | Dispatch (queue Assign) | 1440 |
| `b04-dispatch-768` | Dispatch (queue Assign) | 768 |
| `b05-tomorrow-1440` | Tomorrow Readiness | 1440 |
| `b06-opportunity-detail-1440` | Opportunity (header order, Stage Move, quote actions) | 1440 |
| `b06-opportunity-detail-768` | Opportunity (header order, Stage Move, quote actions) | 768 |
| `b07-opportunity-draft-1440` | Opportunity with a draft quote (Withdraw draft) | 1440 |
| `b08-contact-detail-1440` | Contact (Add note, Archive contact) | 1440 |
| `b09-tasks-1440` | Tasks | 1440 |
| `b10-quotes-1440` | Estimates & Quotes directory | 1440 |
| `b11-settings-team-1440` | Settings, Team & Access | 1440 |
| `b12-settings-website-1440` | Settings, Notifications (two forms, two Saves) | 1440 |
| `d01-cancel-trip-dialog-1440` | Cancel Trip dialog | 1440 |
| `d02-decline-dialog-1440` | Decline Request dialog | 1440 |
| `d03-assign-dialog-1440` | Assign Driver dialog | 1440 |
| `d04-withdraw-draft-dialog-1440` | Withdraw draft quote dialog | 1440 |
| `d05-new-task-dialog-1440` | New task dialog | 1440 |
| `e01-growth-tasks-empty-1440` | Growth Tasks, no tasks | 1440 |
| `e01-growth-tasks-empty-768` | Growth Tasks, no tasks | 768 |
| `e02-quotes-empty-1440` | Estimates & Quotes, none yet | 1440 |
| `e03-pipeline-empty-1440` | Pipeline, empty | 1440 |
| `e04-contacts-empty-1440` | Contacts, empty | 1440 |
| `e05-growth-agent-empty-1440` | Growth Agent, nothing to review | 1440 |
| `e06-requests-empty-1440` | Requests, empty (Org B) | 1440 |
| `e07-standing-orders-empty-1440` | Standing Orders, empty (Org B) | 1440 |
| `e08-trips-filtered-empty-1440` | Trips, no search results | 1440 |
| `e09-tasks-filtered-empty-1440` | Tasks, no filter results | 1440 |
