-- Shared free AI key + Google as a provider (M7 §0.5; Alex, 2026-10-14).
--
-- AI mode no longer needs a personal key: anyone without one uses a shared
-- Gemini key Alex provides (Google's free tier, rate-limited, $0). Anyone
-- can still save their own key (Anthropic, OpenAI, or now Google).
--
-- - api_keys.provider / profiles.ai_provider: 'google' allowed.
-- - The M6 gate (`profiles_ai_mode_needs_key`) is dropped: the shared key
--   covers AI mode. Removing a personal key now only clears ai_provider; the
--   user stays in AI mode on the shared key instead of dropping to Simple.
-- - New accounts start in AI mode (no setup cost any more). Existing rows
--   keep the mode they chose.
-- - The shared key is a Supabase Vault secret named `shared_google_api_key`
--   (production: added by hand in the dashboard; local + CI: a fake value in
--   supabase/seed.sql). It's read by two functions only, and returned to no
--   one but the server:
--     shared_ai_key(p_secret): the web app's server, as an invited member,
--       with the server secret (the same check as sealed_api_key);
--     worker_shared_ai_key(): the worker's service role only.
--   Both return null when no key is set up.

-- ---------------------------------------------------------------- providers

alter table public.api_keys
  drop constraint api_keys_provider_check,
  add constraint api_keys_provider_check
    check (provider in ('anthropic', 'openai', 'google'));

alter table public.profiles
  drop constraint profiles_ai_provider_check,
  add constraint profiles_ai_provider_check
    check (ai_provider in ('anthropic', 'openai', 'google'));

-- ---------------------------------------------------------------- AI mode

drop trigger profiles_ai_mode_needs_key on public.profiles;
drop function public.ai_mode_needs_key();

-- Same trigger (api_keys_removed), new body: the user falls back to the
-- shared key, so only the provider of their own key is cleared.
create or replace function public.api_key_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set ai_provider = null
   where user_id = old.user_id;
  return old;
end;
$$;

alter table public.profiles alter column mode set default 'ai';

-- ---------------------------------------------------------------- shared key

create function public.shared_ai_key(p_secret text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.api_key_server_ok(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where user_id = v_uid and invited_at is not null
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (
    select decrypted_secret from vault.decrypted_secrets
    where name = 'shared_google_api_key'
    limit 1
  );
end;
$$;

revoke all on function public.shared_ai_key(text) from public, anon;
grant execute on function public.shared_ai_key(text) to authenticated;

create function public.worker_shared_ai_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'shared_google_api_key'
  limit 1;
$$;

revoke all on function public.worker_shared_ai_key() from public, anon, authenticated;
grant execute on function public.worker_shared_ai_key() to service_role;
