-- Shipmate Autofill, the Chrome extension (M8 §2).
--
-- Auth: a token minted in Profile → Extension, shown once. Only its SHA-256
-- is stored (the token is 32 random bytes, so a fast hash is enough); one
-- active token per person; Disconnect revokes it. Signed-in users see that
-- they're connected and when it was last used, never the hash.
--
-- The extension's requests reach Next.js route handlers with no session
-- (a different origin and security model from the app's cookie). The web
-- app never uses the service-role key, so those routes act through the
-- functions below, which are callable without a session but require both
-- the server secret (Vault api_key_server_secret, as in M6) and an active
-- token's hash. Every one of them acts only on that token's user.
--
-- The PDF: extension_pdf() names the file to attach (the posting's latest
-- tailored PDF, else the uploaded resume) and opens a 60-second grant on
-- exactly that path, which is what lets the route download it without a
-- session (storage policy below). The route streams the bytes; the
-- extension never gets a link of its own.

-- ---------------------------------------------------------------- tokens

create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create unique index extension_tokens_one_active
  on public.extension_tokens (user_id) where revoked_at is null;

alter table public.extension_tokens enable row level security;
revoke all on public.extension_tokens from anon, authenticated;
grant select (id, created_at, last_used_at, revoked_at)
  on public.extension_tokens to authenticated;

create policy "extension_tokens: read own"
  on public.extension_tokens for select to authenticated
  using (user_id = (select auth.uid()));

-- Connect: replace any active token with this one (the app hashed it).
create function public.connect_extension(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not (select public.is_invited()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.extension_tokens
     set revoked_at = now()
   where user_id = (select auth.uid()) and revoked_at is null;
  insert into public.extension_tokens (user_id, token_hash)
  values ((select auth.uid()), p_token_hash)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.connect_extension(text) from public, anon;
grant execute on function public.connect_extension(text) to authenticated;

create function public.disconnect_extension()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.extension_tokens
     set revoked_at = now()
   where user_id = (select auth.uid()) and revoked_at is null;
$$;

revoke all on function public.disconnect_extension() from public, anon;
grant execute on function public.disconnect_extension() to authenticated;

-- Whose is this token? Server secret + an active token, else refused.
create function public.extension_user(p_secret text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.api_key_server_ok(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.extension_tokens t
     set last_used_at = now()
   where t.token_hash = p_token_hash and t.revoked_at is null
  returning t.user_id into v_user;
  if v_user is null or not exists (
    select 1 from public.profiles p
    where p.user_id = v_user and p.invited_at is not null
  ) then
    raise exception 'extension not connected' using errcode = '28000';
  end if;
  return v_user;
end;
$$;

revoke all on function public.extension_user(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- apply markers

-- The Apply button's #shipmate= marker (lib/extension/marker.ts) is signed
-- by the app; this records each one's nonce the first time it's used, so a
-- marker auto-fills once.
create table public.apply_marker_uses (
  nonce text primary key check (char_length(nonce) between 16 and 64),
  used_at timestamptz not null default now()
);

alter table public.apply_marker_uses enable row level security;
revoke all on public.apply_marker_uses from anon, authenticated;

-- ---------------------------------------------------------------- the fill

-- Which PDF the extension would attach for one application: the posting's
-- latest tailored PDF (state done, printed), else the uploaded resume.
-- `name` is the file name the form sees; the app fills in the tailored
-- one's First_Last_Resume_Company.pdf.
create function public.extension_pdf_choice(p_user uuid, p_user_posting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'kind', 'tailored', 'bucket', 'pdfs', 'path', t.pdf_path,
        'name', null, 'pending', t.pdf_requested_at is not null
      )
      from public.tailorings t
      where t.user_id = p_user
        and t.user_posting_id = p_user_posting_id
        and t.state = 'done'
        and t.pdf_path is not null
      order by t.created_at desc
      limit 1
    ),
    (
      select jsonb_build_object(
        'kind', 'uploaded', 'bucket', 'uploads', 'path', r.file_path,
        'name', r.file_name, 'pending', false
      )
      from public.resumes r
      where r.user_id = p_user and r.file_path is not null
    )
  );
$$;

revoke all on function public.extension_pdf_choice(uuid, uuid) from public, anon, authenticated;


-- Everything the extension needs to fill one application, for the
-- token's user: the posting (by the marker's Inbox row, or else by the
-- page's ATS job id or URL), its cached questions and boards, the profile's
-- answers, and which PDF would be attached. `auto` is true only for an
-- unused marker whose row is the user's: then the extension fills without
-- a click.
create function public.extension_context(
  p_secret text,
  p_token_hash text,
  p_ats text,
  p_ats_job_id text,
  p_url text,
  p_marker_user_posting_id uuid default null,
  p_marker_nonce text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.extension_user(p_secret, p_token_hash);
  v_up_id uuid;
  v_status text;
  v_posting_id uuid;
  v_auto boolean := false;
  v_profile jsonb;
  v_pdf jsonb;
  v_boards jsonb;
begin
  -- The marker's row, if it's this user's and its posting is this page's.
  if p_marker_user_posting_id is not null and p_marker_nonce is not null then
    select up.id, up.status, up.posting_id
      into v_up_id, v_status, v_posting_id
    from public.user_postings up
    join public.postings p on p.id = up.posting_id
    where up.id = p_marker_user_posting_id
      and up.user_id = v_user
      and (
        (p_ats_job_id is not null and p.ats = p_ats and p.ats_job_id = p_ats_job_id)
        or p.canonical_url = p_url
        or p.url = p_url
      );
    if found then
      insert into public.apply_marker_uses (nonce) values (p_marker_nonce)
      on conflict do nothing;
      v_auto := found;
    end if;
  end if;

  if v_up_id is null then
    select up.id, up.status, up.posting_id
      into v_up_id, v_status, v_posting_id
    from public.user_postings up
    join public.postings p on p.id = up.posting_id
    where up.user_id = v_user
      and (
        (p_ats_job_id is not null and p.ats = p_ats and p.ats_job_id = p_ats_job_id)
        or p.canonical_url = p_url
        or p.url = p_url
      )
    order by up.created_at desc
    limit 1;
  end if;

  delete from public.apply_marker_uses where used_at < now() - interval '2 days';

  if v_up_id is null then
    return jsonb_build_object('found', false);
  end if;

  select jsonb_build_object(
    'name', p.name, 'email', coalesce(p.email, u.email), 'phone', p.phone,
    'school', p.school, 'degree', p.degree, 'major', p.major,
    'grad_month', p.grad_month, 'grad_year', p.grad_year,
    'work_authorized', p.work_authorized,
    'needs_sponsorship', p.needs_sponsorship,
    'standard_answers', p.standard_answers
  ) into v_profile
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.user_id = v_user;

  v_pdf := public.extension_pdf_choice(v_user, v_up_id);

  -- The boards that list this posting (as posting_boards(), which needs a
  -- session), for locating its form when the questions aren't cached.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
    'kind', s.kind,
    'slug', s.config ->> 'slug',
    'eu', coalesce((s.config -> 'eu') = 'true'::jsonb, false)
  )), '[]'::jsonb)
  into v_boards
  from public.posting_sources ps
  join public.sources s on s.id = ps.source_id
  where ps.posting_id = v_posting_id
    and ps.active
    and s.kind in ('greenhouse', 'lever', 'ashby')
    and s.config ->> 'slug' is not null;

  return jsonb_build_object(
    'found', true,
    'auto', v_auto,
    'user_posting_id', v_up_id,
    'status', v_status,
    'posting', (
      select jsonb_build_object(
        'id', p.id, 'title', p.title, 'url', p.url,
        'canonical_url', p.canonical_url,
        'company', c.name,
        'questions', p.questions,
        'questions_status', p.questions_status,
        'questions_fetched_at', p.questions_fetched_at
      )
      from public.postings p
      left join public.companies c on c.id = p.company_id
      where p.id = v_posting_id
    ),
    'boards', v_boards,
    'profile', v_profile,
    'pdf', v_pdf
  );
end;
$$;

revoke all on function public.extension_context(text, text, text, text, text, uuid, text) from public, authenticated;
grant execute on function public.extension_context(text, text, text, text, text, uuid, text) to anon;

-- ---------------------------------------------------------------- the PDF

-- A 60-second permission to read exactly one file without a session: the
-- storage policy below checks it. Opened only by extension_pdf().
create table public.extension_file_grants (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('pdfs', 'uploads')),
  path text not null,
  expires_at timestamptz not null
);

create index extension_file_grants_by_path
  on public.extension_file_grants (bucket, path);

alter table public.extension_file_grants enable row level security;
revoke all on public.extension_file_grants from anon, authenticated;

create function public.extension_file_granted(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.extension_file_grants g
    where g.bucket = p_bucket and g.path = p_path and g.expires_at > now()
  );
$$;

revoke all on function public.extension_file_granted(text, text) from public, authenticated;
grant execute on function public.extension_file_granted(text, text) to anon;

create policy "pdfs and uploads: read a file the extension was granted"
  on storage.objects for select to anon
  using (
    bucket_id in ('pdfs', 'uploads')
    and public.extension_file_granted(bucket_id, name)
  );

-- The file to attach for this application, with a grant to read it now.
create function public.extension_pdf(
  p_secret text,
  p_token_hash text,
  p_user_posting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.extension_user(p_secret, p_token_hash);
  v_pdf jsonb;
  v_company text;
  v_name text;
begin
  select c.name, pr.name into v_company, v_name
  from public.user_postings up
  join public.postings p on p.id = up.posting_id
  left join public.companies c on c.id = p.company_id
  join public.profiles pr on pr.user_id = up.user_id
  where up.id = p_user_posting_id and up.user_id = v_user;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_pdf := public.extension_pdf_choice(v_user, p_user_posting_id);
  if v_pdf is null
     or (storage.foldername(v_pdf ->> 'path'))[1] is distinct from v_user::text then
    return null;
  end if;

  delete from public.extension_file_grants where expires_at < now();
  insert into public.extension_file_grants (bucket, path, expires_at)
  values (v_pdf ->> 'bucket', v_pdf ->> 'path', now() + interval '60 seconds');
  return v_pdf || jsonb_build_object('company', v_company, 'person', v_name);
end;
$$;

revoke all on function public.extension_pdf(text, text, uuid) from public, authenticated;
grant execute on function public.extension_pdf(text, text, uuid) to anon;

-- ---------------------------------------------------------------- submitted

-- "I submitted it", from the extension: the application is marked applied
-- (a no-op if it's already further along in the Tracker), and the PDF the
-- extension attached is recorded as the one sent (resume_used_for: it must
-- be this posting's tailored PDF or the user's upload; the first record
-- wins).
create function public.extension_submitted(
  p_secret text,
  p_token_hash text,
  p_user_posting_id uuid,
  p_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.extension_user(p_secret, p_token_hash);
begin
  update public.user_postings
     set status = 'applied', skip_reason = null
   where id = p_user_posting_id
     and user_id = v_user
     and status in ('new', 'saved', 'skipped');
  return public.resume_used_for(v_user, p_user_posting_id, p_path);
end;
$$;

revoke all on function public.extension_submitted(text, text, uuid, text) from public, authenticated;
grant execute on function public.extension_submitted(text, text, uuid, text) to anon;

-- The options page's "check connection": refused unless the token is live.
create function public.extension_status(p_secret text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.extension_user(p_secret, p_token_hash);
  return true;
end;
$$;

revoke all on function public.extension_status(text, text) from public, authenticated;
grant execute on function public.extension_status(text, text) to anon;
