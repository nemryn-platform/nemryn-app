# NP-UI-V2-3 — screenshot evidence

These are real browser captures of the isolated app: `NemrynS1Iso` on `localhost:3100`, a production build (Turbopack).
- Before and after were both captured on a fresh `supabase db reset`, with the local Plus demo enabled (Fictional Org A,
  Plus active).
- Growth empty states are captured first. Then the same fictional Growth / Quotes fixture is written through the real
  Plus RPCs as `org-a-admin`:
  - 6 contacts, one marked do-not-contact;
  - 7 opportunities across the stages, one lost;
  - quotes: draft, sent, accepted, and a revision with its history;
  - tasks: overdue, today, upcoming and done;
  - timeline notes.
- Capture tool: session scratchpad `v23/capture.mjs` + `v23/fixture-growth.mjs` (scratch tooling, not committed).

**Before:** `origin/main` `e3f6630` (V2-2 merged).
**After:** the final NP-UI-V2-3 working tree.

## Comparison sheets

| File | Content |
|---|---|
| `v2-3-before-vs-after-growth.png` | Before \| after: Growth Dashboard, Pipeline board, Opportunity detail, Contact detail, Estimates & Quotes, quote print |
| `v2-3-before-vs-after-settings-auth.png` | Before \| after: Settings home, Team & Access, Nemryn Plus, Sign in, Forgot password, Sign in at 390 |
| `v2-3-contact-sheet.png` | All 77 after captures (top of page) |

## Captures (`before/` and `after/`, identical names)

| File | Screen | Width |
|---|---|---|
| `a01-sign-in-1024` | Sign in | 1024 |
| `a01-sign-in-1440` | Sign in | 1440 |
| `a01-sign-in-390` | Sign in | 390 |
| `a01-sign-in-768` | Sign in | 768 |
| `a02-sign-in-error-1440` | Sign in, invalid credentials | 1440 |
| `a03-forgot-password-1440` | Forgot password | 1440 |
| `a03-forgot-password-390` | Forgot password | 390 |
| `a04-sign-up-1440` | Sign up | 1440 |
| `a04-sign-up-390` | Sign up | 390 |
| `a05-join-invalid-1440` | Driver invite, invalid token | 1440 |
| `a05-join-invalid-390` | Driver invite, invalid token | 390 |
| `a06-team-invite-invalid-1440` | Team invite, invalid token | 1440 |
| `a07-reset-password-1440` | Reset password without a session (expired link) | 1440 |
| `a08-auth-code-error-1440` | Auth link expired | 1440 |
| `a08-auth-code-error-390` | Auth link expired | 390 |
| `a09-complete-signup-1440` | Complete sign-up (signed out) | 1440 |
| `e20-growth-dashboard-empty-1440` | Growth Dashboard, Plus active, no Growth records | 1440 |
| `e21-pipeline-empty-1440` | Pipeline, empty | 1440 |
| `e22-contacts-empty-1440` | Contacts, empty | 1440 |
| `e23-tasks-empty-1440` | Tasks, empty | 1440 |
| `e24-quotes-empty-1440` | Estimates & Quotes, empty | 1440 |
| `g01-growth-dashboard-1024` | Growth Dashboard | 1024 |
| `g01-growth-dashboard-1440` | Growth Dashboard | 1440 |
| `g01-growth-dashboard-768` | Growth Dashboard | 768 |
| `g02-pipeline-board-1024` | Pipeline, board (open) | 1024 |
| `g02-pipeline-board-1440` | Pipeline, board (open) | 1440 |
| `g02-pipeline-board-768` | Pipeline, board (open) | 768 |
| `g02l-pipeline-list-1440` | Pipeline, list | 1440 |
| `g02x-pipeline-lost-1440` | Pipeline, lost view | 1440 |
| `g03-opportunity-detail-1024` | Opportunity detail, current sent quote, overdue task | 1024 |
| `g03-opportunity-detail-1440` | Opportunity detail, current sent quote, overdue task | 1440 |
| `g03-opportunity-detail-768` | Opportunity detail, current sent quote, overdue task | 768 |
| `g03a-opportunity-accepted-1440` | Opportunity with an accepted quote | 1440 |
| `g03b-opportunity-history-1440` | Opportunity with a revised quote (history) | 1440 |
| `g03c-opportunity-lost-1440` | Lost opportunity (closed notice) | 1440 |
| `g03d-mark-lost-dialog-1440` | Mark as lost dialog | 1440 |
| `g04-new-opportunity-1440` | New opportunity | 1440 |
| `g05-contacts-1440` | Contacts directory | 1440 |
| `g05-contacts-768` | Contacts directory | 768 |
| `g06-contact-detail-1440` | Contact detail with timeline | 1440 |
| `g06-contact-detail-768` | Contact detail with timeline | 768 |
| `g06a-contact-dnc-1440` | Do-not-contact contact | 1440 |
| `g06b-add-note-1440` | Add note dialog | 1440 |
| `g07-new-contact-1440` | New contact | 1440 |
| `g08-tasks-1440` | Tasks | 1440 |
| `g08-tasks-768` | Tasks | 768 |
| `g08a-task-dialog-1440` | New task dialog | 1440 |
| `g09-quotes-1024` | Estimates & Quotes directory | 1024 |
| `g09-quotes-1440` | Estimates & Quotes directory | 1440 |
| `g09-quotes-768` | Estimates & Quotes directory | 768 |
| `g10-quote-draft-editor-1440` | Quote draft editor (Edit draft) | 1440 |
| `g10n-quote-new-editor-1440` | New estimate or quote editor | 1440 |
| `g11-quote-print-1440` | Staff quote print view | 1440 |
| `g11-quote-print-768` | Staff quote print view | 768 |
| `g11x-quote-print-sent-1440` | Print view, quote valid until tomorrow | 1440 |
| `g12-growth-agent-1440` | Growth Agent | 1440 |
| `s01-settings-1024` | Settings home | 1024 |
| `s01-settings-1440` | Settings home | 1440 |
| `s01-settings-768` | Settings home | 768 |
| `s02-organization-1440` | Settings, Organization | 1440 |
| `s02-organization-768` | Settings, Organization | 768 |
| `s03-team-1440` | Settings, Team & Access | 1440 |
| `s03-team-768` | Settings, Team & Access | 768 |
| `s04-plus-1440` | Settings, Nemryn Plus | 1440 |
| `s05-services-1440` | Settings, Services & Intake | 1440 |
| `s06-operations-1440` | Settings, Operations | 1440 |
| `s07-notifications-1440` | Settings, Notifications | 1440 |
| `s08-security-1440` | Settings, Security | 1440 |
| `s09-my-access-1440` | Settings, My Access | 1440 |
| `s10-activity-1440` | Settings, Activity | 1440 |
| `s11-integrations-1440` | Settings, Integrations | 1440 |
| `s12-website-requests-1440` | Settings, Website Requests (local loopback guard; see the report) | 1440 |
| `s12a-website-form-1440` | Website Requests, hosted form (guard) | 1440 |
| `s12b-website-existing-form-1440` | Website Requests, existing form (guard) | 1440 |
| `s12c-website-developer-1440` | Website Requests, developer (guard) | 1440 |
| `s13-missing-route-1440` | Unknown Operations route (not-found state) | 1440 |
| `s14-dispatcher-settings-restricted-1440` | Dispatcher opening an admin Settings page (redirected, unchanged) | 1440 |

"Full page" captures are sized to the content height (capped at 4000 px); dialogs are 900 px viewport captures.
