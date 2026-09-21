-- P1-PILOT-S5A1R -- retire the raw client INSERT surface on public.drivers.
--
-- FINDING (S5A1 audit, confirmed on local AND production read-only): the original
-- RLS migration granted INSERT on public.drivers to `authenticated` on ALL columns,
-- gated only by drivers_insert_org_admin (has_org_role organization_admin). That let
-- an Organization Admin create a Driver row with an ARBITRARY drivers.user_id --
-- e.g. link another member of their own organization as a Driver -- bypassing the
-- reviewed identity primitives. S9 (20260903100300) closed the UPDATE side of the
-- same hole but never the INSERT side.
--
-- INVARIANT (now enforced by privileges): a Driver <-> auth-user link is established
-- ONLY by the reviewed SECURITY DEFINER mutations
--   link_self_as_driver   (Organization Admin, self only)
--   redeem_driver_invite  (the invited person, email + token verified)
-- Both run as the function owner and are unaffected by this migration.
--
-- AUDIT RESULT: no legitimate direct client INSERT exists. Every application read of
-- `drivers` is a SELECT (dispatch-board, drivers-list, onboarding-checklist,
-- operations-brief); Driver creation happens only through create_driver_invite ->
-- redeem_driver_invite and link_self_as_driver. So the smallest safe fix is to remove
-- client INSERT entirely rather than re-grant a reduced column set.
--
-- The now-unreachable INSERT policy is dropped too, so that an accidental future
-- `grant insert` cannot silently re-open the hole (RLS default-deny then applies).
--
-- Deliberately unchanged: SELECT policies/grants; the UPDATE grant on
-- (display_name, phone, status) and drivers_update_org_admin (no product surface uses
-- it today, but removing it is a separate decision -- this phase does not broaden or
-- narrow Driver management beyond the identity column); the S5A1 unique index;
-- every Driver RPC and helper.

revoke insert on public.drivers from authenticated;
drop policy if exists drivers_insert_org_admin on public.drivers;

-- Idempotent explicit statement of the UPDATE side (already true since S9): no client
-- role may change drivers.user_id.
revoke update (user_id) on public.drivers from authenticated;

comment on table public.drivers is
  'TENANT-OWNED operational resource. user_id is optional and ON DELETE SET NULL -- a driver''s historical trip_assignments/trip_events remain valid even if the linked auth account is disabled or deleted. Clients have NO INSERT privilege (S5A1R) and no UPDATE on user_id (S9): rows are created only by link_self_as_driver / redeem_driver_invite (SECURITY DEFINER). Organization Admin may still UPDATE display_name, phone, status.';
