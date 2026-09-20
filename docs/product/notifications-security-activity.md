# Notifications, Security and Activity (P1-PILOT-S4B-R4D)

Tenant Settings only, **Organization Admin only** (page + Server Action + database). Not a Platform Admin console: a Platform Admin without a Membership is denied every function here (`ZW002`), and organization lifecycle (status) has no tenant control — it belongs to the Nemryn platform control plane (R4E).

## Notifications (`/operations/settings/notifications`)

Email only. Two events that Nemryn can identify at an authoritative, transactional moment:

| Event | Fires when | Default recipients |
|---|---|---|
| New website request | a genuinely **new** public Request is created | Organization Admins |
| Trip exception | a TripException is newly reported (Operations or Driver) | Organization Admins + Dispatchers |

Deliberately **not** offered: *Upcoming unassigned trip* and *Recurring care gap* (need periodic evaluation; no scheduler exists), *Proof needs review* (a derived read-time state, not a persisted moment). A switch that never fires would be misleading.

- **Model**: `organization_notification_settings(organization, event, recipient_roles)` — staff roles only, no addresses. No row = default; empty array = off. Set via `set_notification_settings` (audited `notification_preferences_updated`).
- **Durable events**: `notification_events` is written **in the same transaction** as the business change (`submit_public_transportation_request`, `report_trip_exception`). It holds no address or record content, only the reference and the delivery outcome. `unique(event_type, entity_id)`; an idempotent replay never reaches the enqueue, so it can never notify twice.
- **Dispatch** (server-side, after the response via `after()`): `claim_notification_dispatch` (service_role only) atomically claims the event (exactly one claimer wins) and resolves recipients from **live** Membership state (active staff holding an enabled role; never Drivers, inactive members or other organizations). One email per recipient. `complete_notification_dispatch` records `sent | partial | failed | skipped` with counts and a fixed failure reason (`provider_error | not_configured | build_failed`) — never provider text. No in-request retry; a future job can drain `failed` events. A provider outage never affects the business operation.
- **Email health**: `getEmailTransportStatus()` (no provider call, no secret). Only "unavailable" (production, no provider configured) is shown, as "Email delivery is currently unavailable." Tenants never configure the platform's email key.
- **Recent notifications** on the page shows honest outcomes (Sent / Partly sent / Not delivered / No recipients).

### Email privacy — exactly what is sent

- New website request: "A new transportation request was received through your website." + requested **date** (if given) + service **category** (if given) + link to the Request Hub.
- Trip exception: "An issue was reported on a trip." + scheduled pickup time (org timezone) + link to Trips.
- **Never**: requester/passenger names, phone, email, pickup/destination addresses, assistance/additional notes, exception type or description, internal ids, integration details, provider/technical information. Links are list pages (no record ids).

## Security (`/operations/settings/security`)

Only what exists: the signed-in account's email and verification state, sign-in method (email + password), the **existing** password-reset flow ("Send password reset email" → `/auth/confirm` type=recovery → `/auth/reset-password`; the address is taken from the session, so it can only ever mail the caller's own account), and a read-only staff-access summary (active Admins / Dispatchers, pending/expired invitations) linking to Team & Access. Account email change is **not** offered (no safe existing flow). No MFA, sessions, IP history, SSO, password policy or compliance claims are shown because none exist.

## Activity (`/operations/settings/activity`)

`list_activity_events` projects the **existing** `audit_events` (no second audit table): a whitelist of administrative actions, newest first, keyset-paged by `(occurred_at, id)` with an opaque cursor (30 per page, "Load older activity"). `activity-core.ts` turns each row into a title + a short safe summary server-side (field **names** changed, not values; team emails; service labels); raw before/after JSON, ids and codes never reach the browser. Actors are profile display names (else account email; a null actor shows "System"). An action with no mapping is omitted. Operational trip/request audit rows are never returned. Platform Admin does not gain tenant Activity access.
