-- NP-P2-S5-S3A -- Nemryn Plus Estimates & Quotes: organization-wide quote DIRECTORY reads (additive, read-only).
--
-- Two new read RPCs for Growth -> Estimates & Quotes (/operations/growth/quotes). They are a VIEW over the existing
-- quote domain: no new table, no stored copy of quote data, no write path, no change to any existing function, policy,
-- grant or table. The deployed S1 / S2 migrations are not modified.
--
--   plus_list_organization_quotes(org, search, status, sort, limit, offset)  -- one bounded page + the filtered total
--   plus_quote_directory_summary(org)                                         -- drafts / sent / accepted / expired counts
--
-- AUTHORIZATION (same contract as plus_list_quotes / plus_list_contacts): auth.uid() required (ZW001); Plus READ via
-- plus_can_read(org) (ZW002 otherwise -- driver, no grant, inactive, platform admin without membership, foreign
-- organization and locked Plus are indistinguishable from "not found"); every row is filtered by organization_id and
-- joined to its opportunity / contact on (id, organization_id). SECURITY DEFINER, search_path pinned, EXECUTE for
-- authenticated only.
--
-- EXPIRY is DERIVED, never stored: is_expired = status = 'sent' AND valid_until < the organization-local date
-- (_plus_org_local_today, organizations.timezone). The stored status is always returned unchanged.
-- STATUS FILTER: null / 'all' = every quote; 'draft' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' = that stored
-- status; 'sent' = EVERY stored sent quote (the OD-Q12 current-sent slot, including ones whose validity has passed --
-- they are flagged is_expired); 'expired' = the subset of stored sent quotes whose validity has passed.
-- SEARCH (<= 200 characters, case-insensitive, LIKE wildcards escaped): quote number (digits; also "Quote 12" /
-- "Estimate 12" / "#12"), kind (estimate / quote), opportunity title, contact display name. Never terms, labels, notes,
-- withdrawal reasons or any other free text.
-- SORT: 'newest' (default: created_at desc), 'oldest' (created_at asc), 'valid_until' (soonest first), 'number' (highest
-- first); every order ends in a unique tie-breaker (quote_number, id) so pages are stable.
-- PAGINATION: limit 1..100 (default 25), offset 0..100000; total_count = the filtered total (window count).

-- Index justified by the directory's own queries: the status filters (draft / sent / expired / ...) and the four summary
-- counts all read (organization_id, status[, valid_until]). The organization filter alone is already served by the
-- existing org-leading indexes (organization_id, opportunity_id, created_at desc) and unique (organization_id,
-- quote_number); the page ORDER BY is a per-organization sort of the filtered rows (bounded by the organization's own
-- quote volume), so no extra sort index is added.
create index plus_quotes_org_status_valid_idx on public.plus_quotes (organization_id, status, valid_until);

create function public.plus_list_organization_quotes(
  p_organization_id uuid,
  p_search text,
  p_status text,
  p_sort text,
  p_limit integer,
  p_offset integer
)
returns table (
  quote_id uuid,
  quote_number integer,
  kind text,
  status text,
  is_expired boolean,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  contact_id uuid,
  contact_name text,
  service_type text,
  total_cents bigint,
  currency text,
  valid_until date,
  supersedes_quote_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := coalesce(nullif(p_status, ''), 'all');
  v_sort text := coalesce(nullif(p_sort, ''), 'newest');
  v_limit integer := coalesce(p_limit, 25);
  v_offset integer := coalesce(p_offset, 0);
  v_like text;
  v_number integer;
  v_kind text;
  v_today date;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_status not in ('all', 'draft', 'sent', 'accepted', 'declined', 'withdrawn', 'superseded', 'expired')
     or v_sort not in ('newest', 'oldest', 'valid_until', 'number')
     or v_limit < 1 or v_limit > 100 or v_offset < 0 or v_offset > 100000 or length(coalesce(v_q, '')) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_q is not null then
    -- LIKE pattern with the user's text escaped (\ % _ are literal); never concatenated into SQL
    v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- "12", "#12", "Quote 12", "Estimate 12" -> an exact quote number (bounded to a valid integer)
    if v_q ~* '^\s*(estimate|quote)?\s*#?\s*[0-9]{1,9}\s*$' then
      v_number := substring(v_q from '([0-9]{1,9})')::integer;
    end if;
    if lower(v_q) in ('estimate', 'estimates') then v_kind := 'estimate';
    elsif lower(v_q) in ('quote', 'quotes') then v_kind := 'quote';
    end if;
  end if;
  v_today := public._plus_org_local_today(p_organization_id);

  return query
  with filtered as (
    select q.id, q.quote_number, q.kind, q.status, (q.status = 'sent' and q.valid_until < v_today) as expired,
           q.opportunity_id, o.title, o.stage, c.id as contact_id, c.display_name, q.service_type, q.total_cents, q.currency,
           q.valid_until, q.supersedes_quote_id, q.created_at, q.updated_at
    from public.plus_quotes q
    join public.plus_opportunities o on o.id = q.opportunity_id and o.organization_id = q.organization_id
    join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
    where q.organization_id = p_organization_id
      and (v_status = 'all'
           or (v_status = 'expired' and q.status = 'sent' and q.valid_until < v_today)
           or (v_status <> 'expired' and q.status = v_status))
      and (v_q is null
           or q.quote_number = v_number
           or q.kind = v_kind
           or lower(o.title) like v_like
           or lower(c.display_name) like v_like)
  )
  select f.id, f.quote_number, f.kind, f.status, f.expired, f.opportunity_id, f.title, f.stage, f.contact_id, f.display_name,
         f.service_type, f.total_cents, f.currency, f.valid_until, f.supersedes_quote_id, f.created_at, f.updated_at,
         count(*) over ()
  from filtered f
  order by
    case when v_sort = 'newest' then f.created_at end desc,
    case when v_sort = 'oldest' then f.created_at end asc,
    case when v_sort = 'valid_until' then f.valid_until end asc,
    case when v_sort = 'number' then f.quote_number end desc,
    f.quote_number desc,
    f.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) is
  'NP-P2-S5-S3A. Plus READ (plus_can_read; ZW002 otherwise, ZW001 without a uid). One page (limit 1-100, default 25; offset 0-100000) of the organization''s estimates and quotes, newest first by default (sort newest | oldest | valid_until | number; always ending in quote_number, id). Status filter: all | draft | sent (every stored sent, incl. derived-expired) | accepted | declined | withdrawn | superseded | expired (stored sent past the organization-local valid_until). Search (<= 200, LIKE-escaped): quote number, kind, opportunity title, contact name -- never free text. is_expired is derived; the stored status is returned unchanged. total_count is the filtered total. Read-only; invalid input -> ZW006.';
revoke all on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.plus_list_organization_quotes(uuid, text, text, text, integer, integer) to authenticated;

create function public.plus_quote_directory_summary(p_organization_id uuid)
returns table (
  drafts bigint,
  sent bigint,
  accepted bigint,
  expired bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_today := public._plus_org_local_today(p_organization_id);
  return query
  select count(*) filter (where q.status = 'draft'),
         count(*) filter (where q.status = 'sent'),
         count(*) filter (where q.status = 'accepted'),
         count(*) filter (where q.status = 'sent' and q.valid_until < v_today)
  from public.plus_quotes q
  where q.organization_id = p_organization_id;
end;
$$;
comment on function public.plus_quote_directory_summary(uuid) is
  'NP-P2-S5-S3A. Plus READ (plus_can_read; ZW002 otherwise, ZW001 without a uid). Counts for the organization''s quote directory: drafts (stored draft = active drafts), sent (every stored sent = current sent quotes under OD-Q12, incl. derived-expired), accepted, expired (stored sent whose valid_until is before the organization-local date; a SUBSET of sent). No amounts, revenue or accounting figures.';
revoke all on function public.plus_quote_directory_summary(uuid) from public, anon, service_role;
grant execute on function public.plus_quote_directory_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
