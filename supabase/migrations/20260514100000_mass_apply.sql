-- Mass Apply (M9 §1): "Tailor all" on To Apply.
--
-- Tailoring days. A tailoring now has a day, run_on (Eastern, the same day
-- the cap already used). The daily cap counts a day's tailorings instead of
-- the ones created that day, so a tailoring can be queued today for a later
-- day: that's how "Tailor all" queues what doesn't fit under today's cap
-- ("process what fits, queue the rest"). The worker doesn't take a row
-- before its day; on its day, the 30-minute Watch run drains it like any
-- other. Every row queued the old way gets run_on = the day it was created,
-- so nothing about those changes.
--
-- - tailor_all(): queue a tailoring for every open posting the caller saved
--   to To Apply that has none yet, today as far as the cap allows, then the
--   days after, each up to the cap. Priority companies (follows.priority)
--   first, then the order they were saved. Postings carry no deadline, so
--   there's no deadline order to use.
-- - claim_user_tailorings(): the worker takes more of one user's runnable
--   rows, to tailor them as one batch (lib/tailor/batch.ts).
-- - Users still can't set run_on, mass or queue_rank themselves: the insert
--   grant stays user_posting_id only. "Tailor this" queues for today, as
--   before.

create function public.tailoring_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/New_York')::date;
$$;

grant execute on function public.tailoring_today() to authenticated, service_role;

alter table public.tailorings
  add column run_on date,
  -- Queued by "Tailor all" (the To Apply screen says so).
  add column mass boolean not null default false,
  -- Order within one "Tailor all", priority first (they share created_at).
  add column queue_rank integer not null default 0;

update public.tailorings
   set run_on = (created_at at time zone 'America/New_York')::date;

alter table public.tailorings
  alter column run_on set not null,
  alter column run_on set default ((now() at time zone 'America/New_York')::date);

create index tailorings_by_user_run_on on public.tailorings (user_id, run_on);
drop index public.tailorings_queue;
create index tailorings_queue on public.tailorings (run_on, created_at) where state = 'queued';

-- The cap now counts the row's day. A day in the past can't be asked for.
create or replace function public.tailoring_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap smallint;
  v_mode text;
  v_used integer;
begin
  select up.posting_id into new.posting_id
  from public.user_postings up
  where up.id = new.user_posting_id and up.user_id = new.user_id;
  if new.posting_id is null then
    raise exception 'Only postings from your Inbox can be tailored' using errcode = 'P0001';
  end if;

  if new.run_on < public.tailoring_today() then
    new.run_on := public.tailoring_today();
  end if;

  select daily_cap, mode into v_cap, v_mode
  from public.profiles where user_id = new.user_id
  for update;
  if v_mode is distinct from 'ai' then
    raise exception 'Tailoring needs AI mode' using errcode = 'P0001';
  end if;

  select count(*) into v_used
  from public.tailorings
  where user_id = new.user_id
    and run_on = new.run_on
    and state <> 'failed';
  if v_used >= coalesce(v_cap, 0) then
    raise exception 'Daily cap reached' using errcode = 'P0001',
      hint = 'daily_cap';
  end if;
  return new;
end;
$$;

-- Worker: the oldest runnable queued row (its day has come).
create or replace function public.claim_tailoring(p_skip uuid[] default '{}')
returns setof public.tailorings
language sql
volatile
set search_path = ''
as $$
  update public.tailorings t
     set state = 'running',
         started_at = now(),
         attempts = t.attempts + 1
   where t.id = (
     select q.id from public.tailorings q
     where q.state = 'queued' and not (q.id = any (p_skip))
       and q.run_on <= public.tailoring_today()
     order by q.run_on, q.created_at, q.queue_rank
     limit 1
     for update skip locked
   )
  returning t.*;
$$;

-- Worker: up to p_limit more of one user's runnable queued rows, in queue
-- order, marked running, to tailor together with one already claimed.
create function public.claim_user_tailorings(
  p_user uuid,
  p_skip uuid[] default '{}',
  p_limit integer default 1
)
returns setof public.tailorings
language sql
volatile
set search_path = ''
as $$
  -- Picked once (materialized), then updated: "where id in (subquery with
  -- limit … skip locked)" may run the subquery again mid-update and take
  -- fewer rows than asked for.
  with picked as materialized (
    select q.id from public.tailorings q
    where q.user_id = p_user
      and q.state = 'queued' and not (q.id = any (p_skip))
      and q.run_on <= public.tailoring_today()
    order by q.run_on, q.created_at, q.queue_rank
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.tailorings t
     set state = 'running',
         started_at = now(),
         attempts = t.attempts + 1
    from picked
   where t.id = picked.id
  returning t.*;
$$;

revoke all on function public.claim_user_tailorings(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.claim_user_tailorings(uuid, uuid[], integer) to service_role;

-- "Tailor all": every open posting the caller saved that has no tailoring
-- queued, running or done. Today up to the cap, then each later day up to
-- the cap. One insert statement, so the tailor workflow is started once.
create function public.tailor_all()
returns table (
  queued_today integer,
  queued_later integer,
  last_day date,
  already integer,
  daily_cap smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := public.tailoring_today();
  v_cap smallint;
  v_mode text;
  v_day date;
  v_used integer;
  v_ids uuid[] := '{}';
  v_days date[] := '{}';
  v_row record;
begin
  if v_user is null or not public.is_invited() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Locked, like the insert trigger does, so a "Tailor this" at the same
  -- moment can't slip a row into a day already counted here.
  select p.daily_cap, p.mode into v_cap, v_mode
  from public.profiles p where p.user_id = v_user
  for update;
  if v_mode is distinct from 'ai' then
    raise exception 'Tailoring needs AI mode' using errcode = 'P0001';
  end if;
  if coalesce(v_cap, 0) < 1 then
    raise exception 'Daily cap is 0' using errcode = 'P0001', hint = 'daily_cap';
  end if;

  v_day := v_today;
  select count(*) into v_used from public.tailorings t
   where t.user_id = v_user and t.run_on = v_day and t.state <> 'failed';

  for v_row in
    select up.id
      from public.user_postings up
      join public.postings p on p.id = up.posting_id
      left join public.follows f
        on f.user_id = up.user_id and f.company_id = p.company_id
     where up.user_id = v_user
       and up.status = 'saved'
       and p.status = 'open'
       and not exists (
         select 1 from public.tailorings t
          where t.user_posting_id = up.id
            and t.state in ('queued', 'running', 'done')
       )
     order by coalesce(f.priority, false) desc,
              coalesce(
                (select max(e.at) from public.status_events e
                  where e.user_posting_id = up.id and e.to_status = 'saved'),
                up.updated_at
              ),
              up.id
  loop
    while v_used >= v_cap loop
      v_day := v_day + 1;
      select count(*) into v_used from public.tailorings t
       where t.user_id = v_user and t.run_on = v_day and t.state <> 'failed';
    end loop;
    v_ids := v_ids || v_row.id;
    v_days := v_days || v_day;
    v_used := v_used + 1;
  end loop;

  if cardinality(v_ids) > 0 then
    insert into public.tailorings (user_id, user_posting_id, run_on, mass, queue_rank)
    select v_user, q.id, q.day, true, q.rank::integer
      from unnest(v_ids, v_days) with ordinality as q(id, day, rank);
  end if;

  return query
    select
      (select count(*)::integer from unnest(v_days) d where d = v_today),
      (select count(*)::integer from unnest(v_days) d where d > v_today),
      (select max(d) from unnest(v_days) d where d > v_today),
      (select count(*)::integer
         from public.user_postings up
         join public.postings p on p.id = up.posting_id
        where up.user_id = v_user and up.status = 'saved' and p.status = 'open'
          and exists (
            select 1 from public.tailorings t
             where t.user_posting_id = up.id
               and t.state in ('queued', 'running', 'done')
               and not (t.user_posting_id = any (v_ids))
          )),
      v_cap;
end;
$$;

revoke all on function public.tailor_all() from public, anon;
grant execute on function public.tailor_all() to authenticated;
