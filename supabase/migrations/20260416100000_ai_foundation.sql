-- AI foundation (M6).
--
-- - api_keys: one AI provider key per user, AES-256-GCM encrypted by the
--   server before it gets here. Nobody signed in can read `ciphertext` or
--   `iv`, not even the key's owner: those two columns have no select grant
--   for anon or authenticated. Users read provider + last4 through
--   api_keys_public and can delete their row; only the service role (the
--   app's key-saving Server Action and lib/ai, and the worker) writes or
--   reads the secret columns.
-- - profiles: mode / ai_provider / auto_tailor / daily_cap exist since M1.
--   Users may now set mode, auto_tailor and daily_cap; ai_provider follows
--   the saved key and is written by the server. AI mode needs a saved key
--   (trigger), and removing the key drops the user back to Simple.
-- - resumes.content: the structured resume (Spec "Structured resume"),
--   written by the import and the editor as the user.
-- - fact_bank: true things that aren't on the resume, own rows only.

-- ---------------------------------------------------------------- api_keys

create table public.api_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  -- base64(AES-256-GCM ciphertext || 16-byte auth tag); the plaintext is
  -- bound to (user_id, provider) as associated data.
  ciphertext text not null check (char_length(ciphertext) between 24 and 1000),
  -- base64 of the 12-byte nonce.
  iv text not null check (char_length(iv) = 16),
  last4 text not null check (char_length(last4) = 4),
  created_at timestamptz not null default now()
);

alter table public.api_keys enable row level security;

revoke all on public.api_keys from anon, authenticated;
grant select (user_id, provider, last4, created_at) on public.api_keys to authenticated;
grant delete on public.api_keys to authenticated;

create policy "api_keys: read own (no secret columns)"
  on public.api_keys for select to authenticated
  using (user_id = (select auth.uid()));

create policy "api_keys: delete own"
  on public.api_keys for delete to authenticated
  using (user_id = (select auth.uid()));

-- What the Profile screen shows. security_invoker: the caller's column
-- grants and the policy above still apply.
create view public.api_keys_public
  with (security_invoker = true)
  as select user_id, provider, last4, created_at from public.api_keys;

revoke all on public.api_keys_public from anon, authenticated;
grant select on public.api_keys_public to authenticated;

-- ---------------------------------------------------------------- profiles

grant update (mode, auto_tailor, daily_cap) on public.profiles to authenticated;

create function public.ai_mode_needs_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode = 'ai'
     and not exists (select 1 from public.api_keys where user_id = new.user_id) then
    raise exception 'AI mode needs a saved API key' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_ai_mode_needs_key
  before insert or update of mode on public.profiles
  for each row execute function public.ai_mode_needs_key();

-- Removing the key (or the account's key row going any other way) ends AI
-- mode, so nothing later tries to use a key that isn't there.
create function public.api_key_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set mode = 'simple', ai_provider = null
   where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.api_key_removed() from public, anon, authenticated;

create trigger api_keys_removed
  after delete on public.api_keys
  for each row execute function public.api_key_removed();

-- ---------------------------------------------------------------- resumes

-- The structured resume. Shape is checked by the app's zod schema
-- (lib/resume/structured.ts); the database keeps it a bounded object.
alter table public.resumes
  add constraint content_is_small check (content is null or pg_column_size(content) <= 100000),
  add constraint structured_has_content check (kind <> 'structured' or content is not null);

grant insert (content) on public.resumes to authenticated;
grant update (content) on public.resumes to authenticated;

-- ---------------------------------------------------------------- fact_bank

create table public.fact_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('skill', 'project', 'coursework', 'club', 'award', 'other')),
  -- { "text": "...", "detail": "..." } (lib/schemas/fact-bank.ts).
  content jsonb not null check (
    jsonb_typeof(content) = 'object' and pg_column_size(content) <= 4000
  ),
  source text not null default 'manual' check (source in ('manual', 'imported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fact_bank_by_user on public.fact_bank (user_id, kind, created_at);

create trigger fact_bank_set_updated_at
  before update on public.fact_bank
  for each row execute function public.set_updated_at();

-- At most 200 entries per person: plenty for one person's facts, and it
-- keeps the tailoring prompt (which includes them all) a sane size.
create function public.fact_bank_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.fact_bank where user_id = new.user_id) >= 200 then
    raise exception 'You can keep up to 200 entries' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fact_bank_limit
  before insert on public.fact_bank
  for each row execute function public.fact_bank_limit();

alter table public.fact_bank enable row level security;

revoke all on public.fact_bank from anon, authenticated;
grant select, delete on public.fact_bank to authenticated;
grant insert (kind, content, source) on public.fact_bank to authenticated;
grant update (kind, content) on public.fact_bank to authenticated;

create policy "fact_bank: read own"
  on public.fact_bank for select to authenticated
  using (user_id = (select auth.uid()));

create policy "fact_bank: create own"
  on public.fact_bank for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "fact_bank: update own"
  on public.fact_bank for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "fact_bank: delete own"
  on public.fact_bank for delete to authenticated
  using (user_id = (select auth.uid()));
