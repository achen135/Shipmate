-- Profiles: one row per auth user, created by a trigger on auth.users.
--
-- Columns follow Spec "Data model"; most are filled in by later milestones.
-- M1 adds `invited_at` (set only by redeem_invite) and `onboarding_step` (the
-- step the user is on, so they can leave and come back).
--
-- Access: a user reads and updates only their own row. Writes are limited by
-- column grants, not just RLS: the browser can never set `invited_at`, `email`,
-- or `user_id`. Each later milestone grants update on the columns its feature
-- edits.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text check (char_length(name) <= 100),
  phone text check (char_length(phone) <= 40),
  school text check (char_length(school) <= 150),
  degree text check (degree in ('associate', 'bachelors', 'masters', 'phd', 'other')),
  major text check (char_length(major) <= 100),
  grad_month smallint check (grad_month between 1 and 12),
  grad_year smallint check (grad_year between 2000 and 2100),
  work_authorized boolean,
  needs_sponsorship boolean,
  links jsonb not null default '[]'::jsonb,
  standard_answers jsonb not null default '{}'::jsonb,
  mode text not null default 'simple' check (mode in ('simple', 'ai')),
  ai_provider text check (ai_provider in ('anthropic', 'openai')),
  auto_tailor boolean not null default false,
  daily_cap smallint not null default 10 check (daily_cap between 0 and 100),
  notify_prefs jsonb not null default '{}'::jsonb,
  invited_at timestamptz,
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.invited_at is
  'When the user redeemed an invite. Null = signed in but not let in yet. Set only by redeem_invite().';
comment on column public.profiles.onboarding_step is
  'The onboarding step the user is on (Spec "Sign-up + onboarding" numbering). 1 = invite, 2 = basics.';

-- Shared helper: keep updated_at current on every update.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- access

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (
  name, school, degree, major, grad_month, grad_year,
  work_authorized, needs_sponsorship, onboarding_step
) on public.profiles to authenticated;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No insert or delete policy: rows are created by the trigger below and
-- removed by the auth.users cascade.

-- ---------------------------------------------------------------- auth.users sync

-- Runs as the table owner (security definer) because the signing-up user has
-- no insert privilege on profiles. Google sends `full_name` (and `name`) in
-- the user metadata; magic-link users start with no name.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, name)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ), 100), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Anyone who signed in before this migration (e.g. while testing M0) gets a row.
insert into public.profiles (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;
