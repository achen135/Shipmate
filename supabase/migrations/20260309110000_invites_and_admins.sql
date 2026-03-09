-- Invite-only access.
--
-- OAuth creates the auth user before the app can check anything, so access is
-- gated on `profiles.invited_at`, not on account creation. A user gets in by
-- redeeming a single-use code through redeem_invite(), which marks the code
-- used and the profile invited in one transaction.
--
-- Admins come from `app_admins`, not an env var: RLS can't read Vercel env,
-- and the service-role key stays out of the web app (hard rule 5). So invite
-- writes go through RLS with an is_admin() check. There is no write policy on
-- app_admins; Alex is added with one SQL insert in the dashboard.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- app_admins

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to authenticated;

create policy "app_admins: read own"
  on public.app_admins for select
  to authenticated
  using (user_id = (select auth.uid()));

-- security definer so policies on other tables can call it without needing
-- read access to app_admins (and without RLS recursion).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- invites

-- 8 characters from a 31-letter alphabet with no look-alikes (no 0/O, 1/I/L):
-- 31^8 ≈ 8.5 × 10^11 codes. Rejection sampling keeps every letter equally
-- likely (248 = 31 × 8 is the largest multiple of 31 below 256).
create function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text := '';
  b int;
begin
  while char_length(code) < 8 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    if b < 248 then
      code := code || substr(alphabet, (b % 31) + 1, 1);
    end if;
  end loop;
  return code;
end;
$$;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_invite_code()
    check (code ~ '^[2-9A-HJKMNP-Z]{8}$'),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- "Used" means used_at is set. used_by can later go null if that account is
  -- deleted; the code stays spent.
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.invites is
  'Single-use invite codes. Admins create/list/revoke via RLS; redemption only through redeem_invite().';

alter table public.invites enable row level security;

-- Column grants: an admin can only supply a note on insert (code, created_by,
-- and timestamps come from defaults) and only change note/revoked_at after.
-- used_by/used_at are written solely by redeem_invite().
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;
grant insert (note) on public.invites to authenticated;
grant update (note, revoked_at) on public.invites to authenticated;

create policy "invites: admins read"
  on public.invites for select
  to authenticated
  using ((select public.is_admin()));

create policy "invites: admins create"
  on public.invites for insert
  to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "invites: admins update"
  on public.invites for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No delete policy: revoke instead, so the list stays a complete record.

-- ---------------------------------------------------------------- redeem_invite

-- Returns one of: ok, already_invited, invalid, used, revoked, not_signed_in.
--
-- Concurrency: the UPDATE … WHERE used_at IS NULL takes a row lock. If two
-- people race for one code, the second waits, then re-checks the WHERE against
-- the committed row, matches nothing, and gets 'used'. Locking the caller's
-- profile first stops one person spending two codes from two tabs.
create function public.redeem_invite(p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invited_at timestamptz;
  v_invite public.invites%rowtype;
begin
  if v_uid is null then
    return 'not_signed_in';
  end if;

  -- Normally the auth trigger already made this row; covers accounts created
  -- before it existed.
  insert into public.profiles (user_id, email)
  select id, email from auth.users where id = v_uid
  on conflict (user_id) do nothing;

  select invited_at into v_invited_at
  from public.profiles
  where user_id = v_uid
  for update;

  if v_invited_at is not null then
    return 'already_invited';
  end if;

  update public.invites
  set used_by = v_uid, used_at = now()
  where code = v_code and used_at is null and revoked_at is null
  returning * into v_invite;

  if not found then
    select * into v_invite from public.invites where code = v_code;
    if not found then
      return 'invalid';
    elsif v_invite.revoked_at is not null then
      return 'revoked';
    else
      return 'used';
    end if;
  end if;

  update public.profiles
  set invited_at = now(), onboarding_step = greatest(onboarding_step, 2)
  where user_id = v_uid;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;
-- Column defaults run with the inserting user's privileges, so admins (who are
-- `authenticated`) need this to create a code. It only returns a random string.
revoke execute on function public.generate_invite_code() from public, anon;
grant execute on function public.generate_invite_code() to authenticated;
