-- Live "X of Y used today" for the shared Gemini key (Fix Handoff "live quota
-- visibility, honest fallback note" §1).
--
-- Nothing recorded how many requests the shared key had made, only how many
-- tailorings it had turned away (tailorings.rate_limit_hits), so the AI
-- screen could explain the limit but not show it. Now every successful call
-- on the shared key writes one row here, and shared_ai_quota() counts today's
-- rows per model for any invited member.
--
-- - shared_ai_calls: one row per call, written only through
--   record_shared_ai_call() (the app's server as the signed-in member, or the
--   worker's service role). No policies: nobody reads the table directly.
-- - The day is Google's: free-tier daily limits reset at midnight Pacific,
--   not Eastern like the per-user tailoring cap.
-- - Rows older than 3 days are deleted as new ones come in. Counts only, no
--   user id: this table says how busy the key is, not who used it.

create table public.shared_ai_calls (
  id bigint generated always as identity primary key,
  model text not null check (char_length(model) <= 100),
  called_at timestamptz not null default now()
);

create index shared_ai_calls_by_time on public.shared_ai_calls (called_at);

alter table public.shared_ai_calls enable row level security;

-- Record one call on the shared key. Invited members only (the app's server
-- calls it as the signed-in user), or the worker's service role.
create function public.record_shared_ai_call(p_model text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' and not public.is_invited() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.shared_ai_calls (model) values (left(p_model, 100));
  delete from public.shared_ai_calls
   where called_at < now() - interval '3 days';
end;
$$;

revoke all on function public.record_shared_ai_call(text) from public, anon;
grant execute on function public.record_shared_ai_call(text) to authenticated, service_role;

-- Today's calls per model, for the AI settings screen and anything else that
-- wants the same numbers. Invited members only.
create function public.shared_ai_quota()
returns table (model text, used bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_invited() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.model, count(*)::bigint
      from public.shared_ai_calls c
     where c.called_at >=
           (date_trunc('day', now() at time zone 'America/Los_Angeles'))
           at time zone 'America/Los_Angeles'
     group by c.model;
end;
$$;

revoke all on function public.shared_ai_quota() from public, anon;
grant execute on function public.shared_ai_quota() to authenticated;
