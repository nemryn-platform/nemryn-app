# Team & Access, Services & Intake, Operations preferences (P1-PILOT-S4B-R4C)

Tenant administration under **Settings**, all **Organization Admin only** (page guard + Server Action guard + database function). Dispatcher, Driver, no-Membership and inactive Memberships are denied independently in the database (`ZW002`).

## Team & Access (`/operations/settings/team`)

STAFF only — `organization_admin` and `dispatcher`. Drivers keep their own lifecycle (Drivers page / `driver_invites`); a staff invitation can never carry the driver role and never converts a Driver Membership.

- **Invitations** (`staff_invites`, closed table): 256-bit random token, **only its SHA-256 stored**, 7-day expiry, single use, one pending invitation per (organization, email). `create_staff_invite` / `resend_staff_invite` / `cancel_staff_invite` / `accept_staff_invite` / `get_staff_invite_preview` (anon, token-gated) / `list_staff_invites`. **Resend re-issues**: fresh token + fresh expiry; the previous link stops working (never two valid tokens). Expired, cancelled and used links fail safely.
- **Acceptance** takes only the token: organization and role come from the invitation row; the caller's own account email must equal the invited email. Existing Nemryn users keep every Membership and gain the new one (no second identity); new users sign up through `/team-invite/<token>` (or arrive via `/complete-signup` after email confirmation — a pending staff invitation is handled **before** and **instead of** fresh-organization creation; a dead one goes to Access unavailable, never to "Set up your organization").
- **Privacy**: the Admin UI only ever says "Invitation sent." — never whether an address has a Nemryn account.
- **Role change / deactivate / reactivate**: `change_membership_role`, `set_membership_status`. `memberships` is no longer directly writable by any client role (INSERT/UPDATE/DELETE revoked; the two inert policies dropped). Deactivation keeps the row and audit history; reactivation is a clean toggle (chosen over "invite again" because the model supports it cleanly).
- **Last-admin safety**: an organization can never lose its final active Organization Admin (`ZW004 last_admin`) by demotion or deactivation, including self-management. Serialized per organization by an advisory lock; the caller is re-authorized after the lock so an Admin removed by a concurrent transaction cannot complete one more admin action. Proven with real parallel sessions (`supabase/tests/team_last_admin_concurrency_test.sh`, incl. a negative control).
- Audit: `staff_invitation_created | _resent | _cancelled | _accepted`, `membership_role_changed | _deactivated | _reactivated`.

## Services & Intake (`/operations/settings/services`)

Which canonical service types the organization provides (the platform's existing list — same eight values as `transportation_requests_service_type_check`; labels live in code, only identifiers are stored). `organization_service_offerings` holds one row per **enabled** type.

- **No rows = never configured** → public intake behaves exactly as before (backwards compatible; the temporary production QA integration is unaffected). **≥1 row = authoritative**; the setter guarantees at least one after the first save.
- The **only** change to `submit_public_transportation_request`: when the resolved organization is configured, a supplied `serviceType` it has not enabled is rejected with the same generic `invalid_input`. Payload, endpoint, Origin, rate limit, idempotency, service_role boundary unchanged; an omitted `serviceType` is unaffected; historical Requests are never touched.
- Nemryn's own Request/Trip forms do not ask an operator to choose a service type (service type is only displayed on the Request detail), so there was nothing to constrain internally.
- Audit: `organization_services_configured` (first save), `organization_service_offerings_updated`.

## Operations (`/operations/settings/operations`)

A weekly operating schedule (`operating_days` ISO weekdays, `operating_opens_at`, `operating_closes_at`; all-or-nothing, opens < closes, no overnight) in the **organization timezone** (`organizations.timezone`, edited only under Settings → Organization). Business phone / email / primary contact are **referenced**, not duplicated. **Informational**: consumed only by the Operations Overview "Operating hours" line; nothing is rejected or blocked because of it. Audit: `organization_operating_schedule_updated`.

## Organization direct writes

`authenticated` now has **no UPDATE privilege of any kind on `organizations`**. `update_organization_settings` also owns `business_stage` and `service_area_description` (onboarding uses it); organization `status` is not writable through any client path.
