-- Review page + notifications (M5).
--
-- - resumes + the private `uploads` Storage bucket: the one PDF a Simple-mode
--   user uploads. `text_content` is its plain text, extracted once at upload,
--   so the keyword match doesn't re-read the PDF on every page view.
-- - Standard answers: profiles already has `phone`, `standard_answers` and
--   `notify_prefs` (M0); this only lets the user edit them.
-- - postings.questions / questions_status: the application form's questions,
--   fetched the first time anyone opens the review page and cached for
--   everyone. Users can't write postings, so save_posting_questions() does it
--   (see the trust note on that function).
-- - user_postings.answer_sheet: per-user notes on one posting's form. M5 keeps
--   the questions the user pasted when Shipmate can't see the form.
-- - push_subscriptions: one row per device (browser endpoint). Written through
--   save_push_subscription() so a shared browser changes owner on sign-in.
-- - notifications: what the worker sent, so a retried run never pings twice.
--   Service role only.

-- ---------------------------------------------------------------- resumes

create table public.resumes (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'uploaded_pdf' check (kind in ('uploaded_pdf', 'structured')),
  -- Structured resume (Spec "Structured resume"). Unused until M6.
  content jsonb check (content is null or jsonb_typeof(content) = 'object'),
  -- Path inside the `uploads` bucket: {user_id}/resume.pdf.
  file_path text check (char_length(file_path) <= 300),
  file_name text check (char_length(file_name) <= 200),
  text_content text check (char_length(text_content) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uploaded_pdf_has_file check (kind <> 'uploaded_pdf' or file_path is not null)
);

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

alter table public.resumes enable row level security;

revoke all on public.resumes from anon, authenticated;
grant select, delete on public.resumes to authenticated;
grant insert (kind, file_path, file_name, text_content) on public.resumes to authenticated;
grant update (kind, file_path, file_name, text_content) on public.resumes to authenticated;

create policy "resumes: read own"
  on public.resumes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "resumes: create own"
  on public.resumes for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "resumes: update own"
  on public.resumes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "resumes: delete own"
  on public.resumes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- Storage

-- Private. PDFs only, 4 MB (Vercel's request body limit is 4.5 MB, and the
-- upload goes through the app).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 4194304, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each user's files live under a folder named for their user id. The policy
-- checks the first path segment, so no one can read, write, or replace a file
-- outside their own folder, whatever path they ask for.
create policy "uploads: read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "uploads: add to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "uploads: replace in own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "uploads: delete from own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------- profiles

-- Phone, standard answers (links, how-heard, demographics) and notification
-- preferences are edited from Profile. Shape is checked by the app's zod
-- schema; the database only keeps them small objects.
alter table public.profiles
  add constraint standard_answers_is_small_object check (
    jsonb_typeof(standard_answers) = 'object' and pg_column_size(standard_answers) <= 8000
  ),
  add constraint notify_prefs_is_small_object check (
    jsonb_typeof(notify_prefs) = 'object' and pg_column_size(notify_prefs) <= 2000
  );

grant update (phone, standard_answers, notify_prefs) on public.profiles to authenticated;

-- ---------------------------------------------------------------- postings.questions

alter table public.postings
  -- The form's questions as fetched (lib/questions/types.ts RawQuestion[]).
  -- Classified (standard / written / anti-bot) when read, never stored that
  -- way, so better rules apply to forms already cached.
  add column questions jsonb check (
    questions is null
    or (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 150000)
  ),
  -- ok = questions is the list; unknown = the ATS keeps its form behind a
  -- login (or isn't one we read); failed = we tried and it didn't work.
  add column questions_status text check (questions_status in ('ok', 'unknown', 'failed')),
  add column questions_fetched_at timestamptz;

-- Cache the questions fetched for a posting. Postings are shared and written
-- only by the worker, so the web app can't update them directly; this function
-- is the one door, and it is narrow:
--
-- - the caller is an invited member;
-- - it only writes when nothing is cached yet, or the cache is stale (a
--   failure after 10 minutes, a success after 7 days: forms change);
-- - it stores nothing but the questions array and a status, size-capped, every
--   item an object with a text label.
--
-- Trust note: the questions come from the caller's own fetch, which this
-- function can't verify. A member could therefore store wrong questions for a
-- posting until the cache goes stale. Members are invited friends, the content
-- is only ever shown as plain text, and it never changes a posting's fields,
-- matching, or anyone's data. If Shipmate opens up, move the fetch into the
-- worker. (Design Decisions, "Build (M5)".)
create function public.save_posting_questions(
  p_posting_id uuid,
  p_status text,
  p_questions jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null
     or not exists (
       select 1 from public.profiles
       where user_id = v_uid and invited_at is not null
     ) then
    return 'not_member';
  end if;

  if p_status is null or p_status not in ('ok', 'unknown', 'failed') then
    return 'invalid';
  end if;
  if p_status = 'ok' then
    if p_questions is null
       or jsonb_typeof(p_questions) <> 'array'
       or jsonb_array_length(p_questions) > 150
       or pg_column_size(p_questions) > 150000
       or exists (
         select 1 from jsonb_array_elements(p_questions) as q
         where jsonb_typeof(q) <> 'object'
            or jsonb_typeof(q -> 'label') is distinct from 'string'
            or char_length(q ->> 'label') > 2000
       ) then
      return 'invalid';
    end if;
  end if;

  update public.postings
  set questions = case when p_status = 'ok' then p_questions else null end,
      questions_status = p_status,
      questions_fetched_at = now()
  where id = p_posting_id
    and (
      questions_status is null
      or (questions_status = 'failed' and questions_fetched_at < now() - interval '10 minutes')
      or (questions_status <> 'failed' and questions_fetched_at < now() - interval '7 days')
    );
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'saved' else 'skipped' end;
end;
$$;

revoke execute on function public.save_posting_questions(uuid, text, jsonb) from public, anon;
grant execute on function public.save_posting_questions(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- user_postings.answer_sheet

alter table public.user_postings
  add column answer_sheet jsonb check (
    answer_sheet is null
    or (jsonb_typeof(answer_sheet) = 'object' and pg_column_size(answer_sheet) <= 40000)
  );

grant update (answer_sheet) on public.user_postings to authenticated;

-- ---------------------------------------------------------------- push_subscriptions

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (
    endpoint like 'https://%' and char_length(endpoint) <= 1000
  ),
  -- { p256dh, auth }: the device's public key and shared secret for encrypting
  -- the push payload. Only the worker reads this to send.
  keys jsonb not null check (
    jsonb_typeof(keys) = 'object'
    and jsonb_typeof(keys -> 'p256dh') = 'string'
    and jsonb_typeof(keys -> 'auth') = 'string'
    and pg_column_size(keys) <= 500
  ),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

create policy "push_subscriptions: read own"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions: delete own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- No insert or update grant: a browser endpoint belongs to whoever is signed
-- in on it now. Signing in as someone else on the same browser must move the
-- row (an insert would collide with the old owner's row, which RLS hides), and
-- otherwise the previous owner would keep getting the new owner's pings.
create function public.save_push_subscription(
  p_endpoint text,
  p_keys jsonb,
  p_user_agent text
)
returns text
language plpgsql
volatile
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
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000
     or p_keys is null or jsonb_typeof(p_keys) <> 'object'
     or jsonb_typeof(p_keys -> 'p256dh') is distinct from 'string'
     or jsonb_typeof(p_keys -> 'auth') is distinct from 'string'
     or pg_column_size(p_keys) > 500 then
    return 'invalid';
  end if;
  if not exists (
       select 1 from public.push_subscriptions
       where endpoint = p_endpoint and user_id = v_uid
     )
     and (select count(*) from public.push_subscriptions where user_id = v_uid) >= 10 then
    return 'limit';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, keys, user_agent)
  values (v_uid, p_endpoint, jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'),
          left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        keys = excluded.keys,
        user_agent = excluded.user_agent;
  return 'ok';
end;
$$;

revoke execute on function public.save_push_subscription(text, jsonb, text) from public, anon;
grant execute on function public.save_push_subscription(text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- notifications

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  -- What was said: counts and company names only (never resume or answer
  -- content).
  payload jsonb not null,
  sent_at timestamptz not null default now(),
  -- One digest per user per run per channel, even if a run is retried.
  unique (user_id, run_id, channel)
);

create index notifications_user on public.notifications (user_id, sent_at desc);

-- Service role only: RLS on, no grants, no policies.
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
