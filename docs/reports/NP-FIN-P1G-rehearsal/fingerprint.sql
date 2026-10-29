select md5(string_agg(x, E'\n' order by x)) from (
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '') || ' ' || coalesce(md5(obj_description(p.oid, 'pg_proc')), '') as x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  union all select 'C ' || c.relname || ' ' || c.relkind::text || ' ' || c.relrowsecurity::text || ' ' || coalesce(c.relacl::text, '') || ' ' || coalesce(md5(obj_description(c.oid, 'pg_class')), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace
  union all select 'A ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || coalesce(a.attacl::text, '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
  union all select 'T ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all select 'P ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || md5(coalesce(qual, '') || coalesce(with_check, '') || roles::text || cmd)
    from pg_policies where schemaname = 'public'
  union all select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || md5(pg_get_constraintdef(oid))
    from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'Y ' || t.typname from pg_type t where t.typnamespace = 'public'::regnamespace
  union all select 'M ' || version || ' ' || coalesce(name, '') || ' ' || md5(coalesce(statements::text, '')) from supabase_migrations.schema_migrations
) s;
