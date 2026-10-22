# NP-UI-V2-2 — screenshot evidence

These are real browser captures of the isolated app: `NemrynS1Iso` on `localhost:3100`, a production build (Turbopack).
- Before and after were both captured on a fresh `supabase db reset` followed by the same fictional capture fixture.
- The fixture covers the seed's **Harmony Medical Transport** demo tenant: requests in every state, tomorrow and
  yesterday trips, two standing orders and one open exception.
- Signed in as the seed owner, Renata Castillo.
- Empty states are captured on Fictional Org B.
- Capture tool: session scratchpad `v22/capture.mjs` + `v22/fixture.sql` (scratch tooling, not committed).

**Before:** `origin/main` `ca2dc2e` (V2-1 merged), built locally.
**After:** the final NP-UI-V2-2 working tree.

## Comparison sheets

| File | Content |
|---|---|
| `v2-2-before-vs-after-1.png` | Before \| after: Request detail, Trip detail, Dispatch (1440), Standing Order detail, Log Request, Dispatch at 768 |
| `v2-2-before-vs-after-2.png` | Before \| after: Requests list, Trips list, Tomorrow Readiness, New Trip, Passengers, Requests empty state |
| `v2-2-contact-sheet.png` | All 47 after captures (top of page) |

## Captures (`before/` and `after/`, identical names)

| File | Screen | Width |
|---|---|---|
| `c00-overview-1440` | Operations Overview (the V2-1 reference, unchanged) | 1440 (fold) |
| `c01-requests-{1440,1024,768}` | Requests directory, All view | 1440 / 1024 / 768 |
| `c01p-requests-pending-1440` | Requests directory, Pending view | 1440 |
| `c02-request-detail-{1440,1024,768}` | Request detail, pending, passenger not linked | 1440 / 1024 / 768 |
| `c02a-request-accepted-1440` | Request detail, accepted, ready to schedule | 1440 |
| `c02b-decline-dialog-1440` | Decline Request dialog | 1440 |
| `c03-log-request-{1440,768}` | Log Request form | 1440 / 768 |
| `c04-trips-{1440,1024,768}` | Trips directory | 1440 / 1024 / 768 |
| `c05-trip-detail-{1440,1024,768}` | Trip detail, en route | 1440 / 1024 / 768 |
| `c05a-trip-exception-1440` | Trip detail, scheduled and unassigned, with an open exception | 1440 |
| `c05b-assignment-dialog-1440` | Manage Assignment dialog | 1440 |
| `c06-new-trip-{1440,768}` | New Trip form | 1440 / 768 |
| `c07-dispatch-{1440,1024,768}` | Dispatch, today | 1440 / 1024 / 768 |
| `c07t-dispatch-tomorrow-1440` | Dispatch, tomorrow | 1440 |
| `c08-tomorrow-{1440,768}` | Tomorrow Readiness | 1440 / 768 |
| `c09-standing-orders-{1440,768}` | Standing Orders list | 1440 / 768 |
| `c09b-standing-order-detail-1440` | Standing Order detail | 1440 |
| `c09c-new-standing-order-1440` | New standing order | 1440 |
| `c09d-create-missing-1440` | Review missing rides | 1440 |
| `c10-passengers-1440` | Passengers | 1440 |
| `c10b-add-passenger-dialog-1440` | Add Passenger dialog | 1440 |
| `c11-facilities-1440` | Facilities | 1440 |
| `c12-drivers-1440` | Drivers | 1440 |
| `c13-vehicles-1440` | Vehicles | 1440 |
| `c14-proof-of-service-{1440,768}` | Proof of Service | 1440 / 768 |
| `c15-notice-390` | 390 px: the approved Operations notice (unchanged) | 390 |
| `e01-requests-empty-1440` | Requests, empty | 1440 |
| `e04-trips-filtered-empty-1440` | Trips, no search results | 1440 |
| `e07-dispatch-empty-1440` | Dispatch tomorrow, nothing to assign | 1440 |
| `e08-tomorrow-empty-1440` | Tomorrow Readiness, sparse workspace | 1440 |
| `e09-standing-orders-empty-1440` | Standing Orders, empty | 1440 |
| `e10-proof-of-service-empty-1440` | Proof of Service, empty | 1440 |

"Full page" captures are sized to the content height (capped at 4000 px); dialogs are 900 px viewport captures.
