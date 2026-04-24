-- Tailoring (M7).
--
-- - tailorings: one attempt to tailor the user's master resume to one
--   posting. The user asks for one by inserting a row (state 'queued', and
--   nothing else is theirs to set); the worker claims queued rows one at a
--   time (claim_tailoring), runs the pipeline (lib/tailor), and writes the
--   result. Users read their own rows and may replace only the tailored copy
--   ("Edit this copy", save_tailored_copy), which asks the worker to print
--   its PDF again. Everything else is worker-only.
-- - The daily cap is enforced here, not just in the app: a row can't be
--   queued once today's (America/New_York) attempts that didn't fail reach
--   profiles.daily_cap, and only in AI mode. Same for the worker's
--   auto-tailor rows.
-- - Inserting a row (or saving an edited copy) starts tailor.yml through
--   GitHub's workflow_dispatch API, with the same Vault token and pg_net
--   call as dispatch_watch() (the token already has Actions: write;
--   repository_dispatch would need Contents: write, which can push code).
--   No token in Vault (local, CI): a notice, and the next Watch run drains
--   the queue instead.
-- - A 429 (rate limit) leaves the row queued with rate_limited_at set; the
--   next run retries it. Rows stuck in 'running' (a crashed run) are
--   requeued by the worker, up to 3 attempts.
-- - company_research: per company, shared, written by the worker; any
--   invited member can read it. Refetched after 30 days.
-- - postings.fetched_description: the full posting text the worker fetched
--   for tailoring when the source gave none (most Simplify rows). The
--   source's own description, when there is one, stays in `description`.
-- - Storage `pdfs`: private; tailored PDFs at {user_id}/{posting_id}.pdf,
--   written by the worker, readable by their owner only.

-- ---------------------------------------------------------------- helpers

create function public.is_invited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and invited_at is not null
  );
$$;

revoke all on function public.is_invited() from public, anon;
grant execute on function public.is_invited() to authenticated;

-- Start of the tailoring day. One fixed zone for everyone (the users are in
-- the US); the cap resets at midnight Eastern.
create function public.tailoring_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone 'America/New_York'))
         at time zone 'America/New_York';
$$;

-- Ask GitHub to run tailor.yml now. Same token and shape as dispatch_watch.
create function public.dispatch_tailor()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'github_watch_dispatch_token'
  limit 1;

  if coalesce(v_token, '') = '' then
    raise notice 'dispatch_tailor: no github_watch_dispatch_token in Vault; skipping';
    return null;
  end if;

  return net.http_post(
    url := 'https://api.github.com/repos/achen135/Shipmate/actions/workflows/tailor.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || v_token,
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'Shipmate-dispatcher (github.com/achen135/Shipmate)'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function public.dispatch_tailor() from public, anon, authenticated;

-- ---------------------------------------------------------------- postings

alter table public.postings
  add column fetched_description text check (char_length(fetched_description) <= 100000),
  add column description_fetched_at timestamptz;

-- ---------------------------------------------------------------- company_research

create table public.company_research (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- lib/tailor/research.ts CompanyResearch: { status, summary, values[],
  -- tech[], sources[] }.
  content jsonb not null check (
    jsonb_typeof(content) = 'object' and pg_column_size(content) <= 20000
  ),
  fetched_at timestamptz not null default now()
);

alter table public.company_research enable row level security;

revoke all on public.company_research from anon, authenticated;
grant select on public.company_research to authenticated;

create policy "company_research: invited members read"
  on public.company_research for select to authenticated
  using ((select public.is_invited()));

-- ---------------------------------------------------------------- tailorings

create table public.tailorings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_posting_id uuid not null references public.user_postings (id) on delete cascade,
  -- Set by the trigger below from user_postings, so it can't disagree.
  posting_id uuid references public.postings (id) on delete cascade,
  state text not null default 'queued'
    check (state in ('queued', 'running', 'done', 'failed')),
  auto boolean not null default false,
  attempts smallint not null default 0,
  rate_limited_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  score_before smallint check (score_before between 0 and 100),
  score_after smallint check (score_after between 0 and 100),
  matched text[] not null default '{}',
  missing text[] not null default '{}',
  -- [{ what, why }] (lib/tailor/report.ts), shown as "What changed".
  changes jsonb not null default '[]' check (
    jsonb_typeof(changes) = 'array' and pg_column_size(changes) <= 30000
  ),
  -- Warnings (lib/review/warnings.ts, plus the skills gap) and plain notes
  -- ("too little posting text to score", "still over one page").
  warnings jsonb not null default '[]' check (
    jsonb_typeof(warnings) = 'array' and pg_column_size(warnings) <= 20000
  ),
  notes jsonb not null default '[]' check (
    jsonb_typeof(notes) = 'array' and pg_column_size(notes) <= 10000
  ),
  resume_content jsonb check (
    resume_content is null
    or (jsonb_typeof(resume_content) = 'object' and pg_column_size(resume_content) <= 100000)
  ),
  -- The user replaced the tailored copy in the editor.
  edited_at timestamptz,
  pdf_path text check (char_length(pdf_path) <= 300),
  -- Set when the PDF needs printing again (an edited copy).
  pdf_requested_at timestamptz,
  provider text check (provider in ('anthropic', 'openai', 'google')),
  model text check (char_length(model) <= 100),
  -- Whose key ran it: the user's own, or the shared free one.
  key_source text check (key_source in ('own', 'shared')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  est_cost numeric(8, 4) not null default 0,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tailorings_by_user_day on public.tailorings (user_id, created_at);
create index tailorings_by_posting on public.tailorings (user_posting_id, created_at desc);
create index tailorings_queue on public.tailorings (created_at) where state = 'queued';
-- At most one queued or running tailoring per posting per user.
create unique index tailorings_one_active
  on public.tailorings (user_posting_id) where state in ('queued', 'running');

create trigger tailorings_set_updated_at
  before update on public.tailorings
  for each row execute function public.set_updated_at();

-- Fill posting_id from the Inbox row, and enforce AI mode + the daily cap.
-- Locks the profile row so two inserts at once can't both slip under the
-- cap.
create function public.tailoring_before_insert()
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

  select daily_cap, mode into v_cap, v_mode
  from public.profiles where user_id = new.user_id
  for update;
  if v_mode is distinct from 'ai' then
    raise exception 'Tailoring needs AI mode' using errcode = 'P0001';
  end if;

  select count(*) into v_used
  from public.tailorings
  where user_id = new.user_id
    and created_at >= public.tailoring_day_start()
    and state <> 'failed';
  if v_used >= coalesce(v_cap, 0) then
    raise exception 'Daily cap reached' using errcode = 'P0001',
      hint = 'daily_cap';
  end if;
  return new;
end;
$$;

revoke all on function public.tailoring_before_insert() from public, anon, authenticated;

create trigger tailorings_before_insert
  before insert on public.tailorings
  for each row execute function public.tailoring_before_insert();

create function public.tailoring_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.dispatch_tailor();
  return null;
end;
$$;

revoke all on function public.tailoring_after_insert() from public, anon, authenticated;

-- Once per statement: the worker queuing several auto-tailors at once
-- starts one run, not one each.
create trigger tailorings_dispatch
  after insert on public.tailorings
  for each statement execute function public.tailoring_after_insert();

alter table public.tailorings enable row level security;

revoke all on public.tailorings from anon, authenticated;
grant select on public.tailorings to authenticated;
grant insert (user_posting_id) on public.tailorings to authenticated;

create policy "tailorings: read own"
  on public.tailorings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "tailorings: queue own"
  on public.tailorings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and state = 'queued'
    and (select public.is_invited())
  );

-- "Edit this copy": replace the tailored copy (never the master) and ask
-- for its PDF to be printed again. The content's shape is checked by the
-- app (lib/resume/structured.ts); here it's a bounded object.
create function public.save_tailored_copy(p_id uuid, p_content jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_content) is distinct from 'object'
     or pg_column_size(p_content) > 100000 then
    raise exception 'Not a resume' using errcode = 'P0001';
  end if;
  update public.tailorings
     set resume_content = p_content,
         edited_at = now(),
         pdf_requested_at = now()
   where id = p_id
     and user_id = (select auth.uid())
     and state = 'done';
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.dispatch_tailor();
end;
$$;

revoke all on function public.save_tailored_copy(uuid, jsonb) from public, anon;
grant execute on function public.save_tailored_copy(uuid, jsonb) to authenticated;

-- Worker: take the oldest queued row (skipping any the caller has already
-- put back this run), mark it running, and return it. SKIP LOCKED: two
-- workers at once (a Watch run and a tailor run) never take the same row.
create function public.claim_tailoring(p_skip uuid[] default '{}')
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
     order by q.created_at
     limit 1
     for update skip locked
   )
  returning t.*;
$$;

revoke all on function public.claim_tailoring(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_tailoring(uuid[]) to service_role;

-- ---------------------------------------------------------------- Storage

-- Private. PDFs only, 2 MB (a one-page resume is ~50-100 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 2097152, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read only: the worker (service role) writes.
create policy "pdfs: read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
