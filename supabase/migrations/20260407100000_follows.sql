-- Followed companies (M4). A follow is per user (RLS: user_id = auth.uid());
-- the company boards they point at are shared, so creating a follow may also
-- create a shared company and source row, which users can't write directly
-- (hard rule 5: the service-role key stays out of the web app). Two
-- security-definer functions do that, with the checks the worker's data needs:
--
-- - follow_company(company_id): follow a company that already exists.
-- - follow_board(kind, config, name, normalized_name): follow a company by
--   its careers-site board; creates the company and the hot-tier source if
--   they don't exist yet, and shares them if they do (one source row per
--   board, no matter how many users follow it).
--
-- There is no insert grant on follows at all: both ways in go through those
-- functions, which enforce membership and a cap per user.

create table public.follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Stored for now; M5 notifies priority companies first.
  priority boolean not null default false,
  -- Which board Shipmate watches for this company, if any (the sources table
  -- is admin-only, so the Companies screen reads this instead).
  board_kind text check (
    board_kind in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday')
  ),
  board_ref text check (char_length(board_ref) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index follows_company on public.follows (company_id);

alter table public.follows enable row level security;

revoke all on public.follows from anon, authenticated;
grant select, delete on public.follows to authenticated;
grant update (priority) on public.follows to authenticated;

create policy "follows: read own"
  on public.follows for select to authenticated
  using (user_id = (select auth.uid()));

create policy "follows: update own"
  on public.follows for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "follows: delete own"
  on public.follows for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- functions

-- Follows per user. Each followed board is checked every 30 minutes, so this
-- is what keeps the free tiers inside budget.
create function public.max_follows()
returns integer
language sql
immutable
set search_path = ''
as $$ select 50; $$;

-- Shared by both functions: is the caller an invited member under the cap?
-- Returns 'ok', 'not_member', or 'limit'. A follow that already exists never
-- counts against the cap (re-following to change the board is allowed).
create function public.follow_precheck(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or not exists (
       select 1 from public.profiles
       where user_id = v_uid and invited_at is not null
     ) then
    return 'not_member';
  end if;
  if p_company_id is not null
     and exists (
       select 1 from public.follows
       where user_id = v_uid and company_id = p_company_id
     ) then
    return 'ok';
  end if;
  if (select count(*) from public.follows where user_id = v_uid) >= public.max_follows() then
    return 'limit';
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.max_follows() from public, anon;
grant execute on function public.max_follows() to authenticated;
revoke execute on function public.follow_precheck(uuid) from public, anon, authenticated;

-- Returns jsonb: {"status": "ok", "company_id": …} or
-- {"status": "not_member" | "limit" | "not_found"}.
create function public.follow_company(p_company_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := public.follow_precheck(p_company_id);
begin
  if v_status <> 'ok' then
    return jsonb_build_object('status', v_status);
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  insert into public.follows (user_id, company_id)
  values (auth.uid(), p_company_id)
  on conflict (user_id, company_id) do nothing;
  return jsonb_build_object('status', 'ok', 'company_id', p_company_id);
end;
$$;

revoke execute on function public.follow_company(uuid) from public, anon;
grant execute on function public.follow_company(uuid) to authenticated;

-- Returns jsonb: {"status": "ok", "company_id": …, "source_id": …,
-- "created_source": bool} or {"status": "not_member" | "limit" | "invalid"}.
--
-- p_config carries only what the kind needs, and is rebuilt below so nothing
-- else the caller sends is stored:
--   greenhouse / ashby / smartrecruiters: {slug}
--   lever:                                {slug, eu?}
--   workday:                              {tenant, wdNumber, site}
-- p_normalized_name is lib/postings/normalize.ts normalizeCompany(p_company_name);
-- the database can't compute it, so it is only checked for shape.
create function public.follow_board(
  p_kind text,
  p_config jsonb,
  p_company_name text,
  p_normalized_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_company_name, ''));
  v_slug_re constant text := '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';
  v_label text;
  v_ref text;
  v_key text;
  v_config jsonb;
  v_status text;
  v_company_id uuid;
  v_source_id uuid;
  v_created boolean := false;
begin
  if char_length(v_name) not between 1 and 120
     or p_normalized_name is null
     or p_normalized_name !~ '^[a-z0-9]+( [a-z0-9]+)*$'
     or char_length(p_normalized_name) > 120
     or p_config is null
     or jsonb_typeof(p_config) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;

  if p_kind in ('greenhouse', 'ashby', 'smartrecruiters', 'lever') then
    -- coalesce: a missing key makes the test null, and null must not pass.
    if not coalesce(
         jsonb_typeof(p_config -> 'slug') = 'string'
         and (p_config ->> 'slug') ~ v_slug_re,
         false
       ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_ref := p_config ->> 'slug';
    v_config := jsonb_build_object('slug', v_ref, 'company', v_name);
    v_key := p_kind || ':' || lower(v_ref);
    if p_kind = 'lever' and (p_config -> 'eu') = 'true'::jsonb then
      v_config := v_config || '{"eu": true}'::jsonb;
      v_key := 'lever-eu:' || lower(v_ref);
    end if;
    v_label := case p_kind
      when 'greenhouse' then 'Greenhouse'
      when 'ashby' then 'Ashby'
      when 'smartrecruiters' then 'SmartRecruiters'
      else 'Lever'
    end;
  elsif p_kind = 'workday' then
    if not coalesce(
         jsonb_typeof(p_config -> 'tenant') = 'string'
         and (p_config ->> 'tenant') ~ v_slug_re
         and jsonb_typeof(p_config -> 'site') = 'string'
         and (p_config ->> 'site') ~ v_slug_re
         and jsonb_typeof(p_config -> 'wdNumber') = 'number'
         and (p_config ->> 'wdNumber') ~ '^[1-9][0-9]{0,2}$',
         false
       ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_ref := (p_config ->> 'tenant') || '/' || (p_config ->> 'site');
    v_config := jsonb_build_object(
      'tenant', p_config ->> 'tenant',
      'wdNumber', (p_config ->> 'wdNumber')::int,
      'site', p_config ->> 'site',
      'company', v_name
    );
    v_key := 'workday:' || lower(v_ref) || ':wd' || (p_config ->> 'wdNumber');
    v_label := 'Workday';
  else
    return jsonb_build_object('status', 'invalid');
  end if;

  -- The company, shared by normalized name ("Stripe, Inc." and "Stripe").
  select id into v_company_id
  from public.companies where normalized_name = p_normalized_name;

  v_status := public.follow_precheck(v_company_id);
  if v_status <> 'ok' then
    return jsonb_build_object('status', v_status);
  end if;

  if v_company_id is null then
    insert into public.companies (name, normalized_name)
    values (v_name, p_normalized_name)
    on conflict (normalized_name) do nothing
    returning id into v_company_id;
    if v_company_id is null then
      select id into v_company_id
      from public.companies where normalized_name = p_normalized_name;
    end if;
  end if;

  -- The source, shared by key: a second follower finds the first one's row.
  insert into public.sources (key, kind, name, config, company_id, tier)
  values (v_key, p_kind, v_name || ' (' || v_label || ')', v_config, v_company_id, 'hot')
  on conflict (key) do nothing
  returning id into v_source_id;
  if v_source_id is not null then
    v_created := true;
  else
    select id into v_source_id from public.sources where key = v_key;
  end if;

  insert into public.follows (user_id, company_id, board_kind, board_ref)
  values (auth.uid(), v_company_id, p_kind, v_ref)
  on conflict (user_id, company_id) do update
    set board_kind = excluded.board_kind, board_ref = excluded.board_ref;

  return jsonb_build_object(
    'status', 'ok',
    'company_id', v_company_id,
    'source_id', v_source_id,
    'created_source', v_created
  );
end;
$$;

revoke execute on function public.follow_board(text, jsonb, text, text) from public, anon;
grant execute on function public.follow_board(text, jsonb, text, text) to authenticated;
