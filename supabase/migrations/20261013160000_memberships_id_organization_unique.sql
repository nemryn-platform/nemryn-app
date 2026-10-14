-- NP-P1-S3 -- additive Core constraint for named-staff Nemryn Plus grants (PD-20; OWNER-APPROVED 2026-10-14, recorded
-- as ZD-209 in docs/product/decision-register.md).
--
-- WHY: membership_module_grants (next migration) references a membership with the tenant-isolating composite FK
-- convention used by every tenant table -- (membership_id, organization_id) -> memberships (id, organization_id) -- so a
-- grant can never point at another organization's membership, structurally. A composite FK needs a unique constraint
-- on exactly those referenced columns.
--
-- SAFETY (verified on the local schema, NP-P1-S3): memberships has PK (id) and unique (organization_id, user_id) only,
-- and no table references memberships. Because id is already unique, (id, organization_id) is unique for every
-- possible row: the constraint cannot fail on existing data, changes no row, policy, trigger, function or privilege,
-- and alters no Core behaviour. It adds one btree index (the same width as the PK plus one uuid).
-- This is the one Core schema touch in NP-P1 (docs/product/plus-domain-model.md section 5).
--
-- ROLLBACK (only after membership_module_grants and its FK are gone):
--   alter table public.memberships drop constraint memberships_id_organization_id_key;

alter table public.memberships
  add constraint memberships_id_organization_id_key unique (id, organization_id);

comment on constraint memberships_id_organization_id_key on public.memberships is
  'NP-P1-S3 (PD-20). Additive: lets tenant tables reference a membership with the composite (id, organization_id) FK convention. Always satisfiable because id is the primary key.';
