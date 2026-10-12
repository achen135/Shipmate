-- Watch profiles (saved searches) and user_postings (Inbox now; To Apply and
-- the Tracker later). Both per user: RLS `user_id = auth.uid()`.
--
-- Who writes user_postings:
-- - The worker (service role) inserts status 'new' rows for newly listed
--   postings that match a watch profile.
-- - The user inserts their own rows for the 7-day backfill, which runs as
--   them through RLS (never the service-role key, hard rule 5). Column
--   grants let them supply only posting_id and watch_profile_id; status
--   starts at 'new' and user_id defaults to auth.uid().
-- - The user updates only status, skip_reason, and seen_at this milestone.
--   status_events and its trigger come in M3.

-- ---------------------------------------------------------------- watch_profiles

create table public.watch_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  preset text not null check (
    preset in ('swe', 'ai_ml_data', 'quant', 'hardware', 'product', 'supply_chain_ops', 'custom')
  ),
  include_keywords text[] not null default '{}' check (cardinality(include_keywords) <= 50),
  exclude_keywords text[] not null default '{}' check (cardinality(exclude_keywords) <= 50),
  categories text[] not null default '{}' check (
    categories <@ array['Software', 'AI/ML/Data', 'Hardware', 'Quant', 'Product']
  ),
  terms text[] not null default '{"Summer 2027"}' check (cardinality(terms) between 1 and 12),
  locations text[] not null default '{}' check (cardinality(locations) <= 30),
  remote_ok boolean not null default true,
  needs_sponsorship boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index watch_profiles_user on public.watch_profiles (user_id);

create trigger watch_profiles_set_updated_at
  before update on public.watch_profiles
  for each row execute function public.set_updated_at();

alter table public.watch_profiles enable row level security;

revoke all on public.watch_profiles from anon, authenticated;
grant select, delete on public.watch_profiles to authenticated;
grant insert (
  name, preset, include_keywords, exclude_keywords, categories, terms,
  locations, remote_ok, needs_sponsorship, active
) on public.watch_profiles to authenticated;
grant update (
  name, preset, include_keywords, exclude_keywords, categories, terms,
  locations, remote_ok, needs_sponsorship, active
) on public.watch_profiles to authenticated;

create policy "watch_profiles: read own"
  on public.watch_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "watch_profiles: create own"
  on public.watch_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "watch_profiles: update own"
  on public.watch_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "watch_profiles: delete own"
  on public.watch_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- user_postings

create table public.user_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Not null for now; M3's manual entries will relax this.
  posting_id uuid not null references public.postings (id) on delete cascade,
  watch_profile_id uuid references public.watch_profiles (id) on delete set null,
  status text not null default 'new' check (
    status in ('new', 'saved', 'skipped', 'applied', 'oa', 'interview', 'offer', 'rejected', 'withdrawn')
  ),
  skip_reason text check (
    skip_reason in ('not_interested', 'location', 'not_eligible', 'already_applied', 'other')
  ),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, posting_id),
  constraint skip_reason_only_when_skipped check (skip_reason is null or status = 'skipped')
);

create index user_postings_by_status on public.user_postings (user_id, status, created_at desc);
create index user_postings_posting on public.user_postings (posting_id);

create trigger user_postings_set_updated_at
  before update on public.user_postings
  for each row execute function public.set_updated_at();

alter table public.user_postings enable row level security;

revoke all on public.user_postings from anon, authenticated;
grant select on public.user_postings to authenticated;
grant insert (posting_id, watch_profile_id) on public.user_postings to authenticated;
grant update (status, skip_reason, seen_at) on public.user_postings to authenticated;

create policy "user_postings: read own"
  on public.user_postings for select to authenticated
  using (user_id = (select auth.uid()));

-- The backfill: your own rows, attributed to one of your own watch profiles.
create policy "user_postings: create own"
  on public.user_postings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      watch_profile_id is null
      or exists (
        select 1 from public.watch_profiles w
        where w.id = watch_profile_id and w.user_id = (select auth.uid())
      )
    )
  );

create policy "user_postings: update own"
  on public.user_postings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No delete policy: skip instead, so a skipped posting never comes back.

-- ---------------------------------------------------------------- onboarding

comment on column public.profiles.onboarding_step is
  'The onboarding step the user is on (Spec "Sign-up + onboarding" numbering). 1 = invite, 2 = basics, 5 = what to watch; 3-4 come with the resume milestones.';
