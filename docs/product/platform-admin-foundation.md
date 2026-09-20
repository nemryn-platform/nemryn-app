# Platform Admin foundation (P1-PILOT-S4B-R4E)

The Nemryn **control plane** at `/platform`. It is not tenant Settings and not a super-dispatcher.

**Permanent rule: a Platform Admin does not inherit Organization Admin authority.** `PlatformAdminGrant` never satisfies `has_org_role`, `is_org_member` or `current_driver_id`. A Platform Admin with no Membership can operate Nemryn, not any transportation company. If a Platform Admin also holds a Membership, tenant permissions come from that Membership only.

## What Platform Admin can do
- See a tenant directory (server-side search, status filter, 25 per page) and per-organization health: access counts, operational-footprint **counts**, website-integration health (origin, active, requests received), notification delivery counts, "needs attention" (failed / partial / pending or dispatching > 15 min — observed, never auto-mutated).
- **Suspend / reactivate** an organization, with a required reason. This is the only tenant-affecting mutation.
- Read platform activity (suspend / reactivate history).

## What it cannot do
Read or write Requests, Trips, Passengers, Drivers, Vehicles, Facilities, Recurring Care, Proof of Service; edit tenant Settings / Team / Services / Website integrations / notification preferences / schedule; impersonate or "enter" a tenant; delete or purge an organization; grant or revoke Platform Admin (provisioning stays outside the product — service role / SQL).

## Lifecycle model
Stored vocabulary is the existing `organizations.status in ('active','inactive')`; the UI presents `inactive` as **Suspended**. Non-active means:
- Admin / Dispatcher: workspace denied (`is_org_member` / `has_org_role` are false → every RLS policy and tenant RPC denies).
- Driver: `current_driver_id` is null → Driver workspace and reads denied.
- Public website intake: rejected with the same generic `invalid_input` as an unknown integration (strict against a concurrent suspension: `FOR SHARE` on the organization row).
- Invitation acceptance into the organization: refused (`ZW003`).
- Nothing is deleted or rewritten: Memberships, Drivers, Requests, Trips, integrations (same id) and notification history are untouched. Reactivation restores everything with no re-provisioning.
- Multi-organization users keep their other active workspaces; only the suspended one is unavailable. A member can still read their own organization row (name/status) so the app can explain "Workspace suspended".

## Data access
No tenant table is granted to Platform Admin. All reads are `SECURITY DEFINER` functions returning aggregates: `platform_get_overview`, `platform_list_organizations`, `platform_get_organization`, `platform_list_organization_integrations`, `platform_list_notification_attention`, `platform_list_activity`; mutation `set_platform_organization_status`. The broad Platform Admin `SELECT` policy on `audit_events` was dropped.

## Activity
Platform activity reuses `audit_events` with an action whitelist (`platform_organization_suspended`, `platform_organization_reactivated`). The tenant's Settings → Activity shows the same two actions as "Organization suspended/reactivated by Nemryn" — actor "Nemryn", no reason, no platform-admin identity.

## "Last activity"
Latest of: any audit event for the organization, the latest Request received, the latest Trip change. It is **not** a login time (no login audit exists).

## System tenant
None exists in the schema or seed; no special cases.
