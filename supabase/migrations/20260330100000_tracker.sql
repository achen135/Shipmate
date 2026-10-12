-- The Tracker: user_postings rows with status applied or later, plus
-- status_events (one row per status change: the timeline).
--
-- - Tracker columns on user_postings (unsure, applied date, referral, notes,
--   term, resume note) and manual entries: posting_id becomes nullable, and a
--   manual row carries its own company / title / url / location in `manual`.
--   Manual rows never touch the shared postings table.
-- - status_events is written only by triggers (security definer): an update
--   that changes status logs from → to; an insert that starts past 'new'
--   (manual add, import) logs null → status, dated at the applied date.
-- - Setting status 'applied' stamps applied_at with today's date (app time
--   zone, America/Chicago, as lib/format/time.ts) when it's empty.

-- ---------------------------------------------------------------- user_postings

alter table public.user_postings
  alter column posting_id drop not null,
  add column status_unsure boolean not null default false,
  add column applied_at date,
  add column referral boolean not null default false,
  add column referrer text check (char_length(referrer) <= 200),
  add column notes text check (char_length(notes) <= 10000),
  add column term text check (char_length(term) between 1 and 40),
  -- Manual entries only: { company, title, url, location }.
  add column manual jsonb check (
    jsonb_typeof(manual) = 'object' and pg_column_size(manual) <= 4000
  ),
  -- Free text ("Resume v3") until M5/M7 link the exact PDF.
  add column resume_note text check (char_length(resume_note) <= 200),
  add constraint posting_or_manual check (
    posting_id is not null or coalesce(char_length(btrim(manual ->> 'company')), 0) > 0
  ),
  -- A manual row has no posting to show in the Inbox or To Apply, so it lives
  -- in the Tracker only.
  add constraint manual_rows_are_tracked check (
    posting_id is not null
    or status in ('applied', 'oa', 'interview', 'offer', 'rejected', 'withdrawn')
  );

comment on column public.user_postings.posting_id is
  'The shared posting, or null for a manual entry (company etc. in `manual`).';

create function public.stamp_applied_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'applied'
    and new.applied_at is null
    and (tg_op = 'INSERT' or old.status is distinct from 'applied')
  then
    new.applied_at := (now() at time zone 'America/Chicago')::date;
  end if;
  return new;
end;
$$;

create trigger user_postings_stamp_applied_at
  before insert or update of status on public.user_postings
  for each row execute function public.stamp_applied_at();

-- Users may set the tracker fields, on insert (manual add, import) and update.
-- user_id, posting_id (after insert), and the timestamps stay out of reach.
revoke insert, update on public.user_postings from authenticated;
grant insert (
  posting_id, watch_profile_id, status, status_unsure, applied_at, referral,
  referrer, notes, term, manual, resume_note
) on public.user_postings to authenticated;
grant update (
  status, skip_reason, seen_at, status_unsure, applied_at, referral, referrer,
  notes, term, manual, resume_note
) on public.user_postings to authenticated;
grant delete on public.user_postings to authenticated;

-- Manual rows can be deleted (a typo, a bad import). Rows for a shared posting
-- still can't: skipping is what keeps a posting from coming back.
create policy "user_postings: delete own manual"
  on public.user_postings for delete to authenticated
  using (user_id = (select auth.uid()) and posting_id is null);

-- ---------------------------------------------------------------- status_events

create table public.status_events (
  id uuid primary key default gen_random_uuid(),
  user_posting_id uuid not null references public.user_postings (id) on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now()
);

create index status_events_by_row on public.status_events (user_posting_id, at desc);

alter table public.status_events enable row level security;

revoke all on public.status_events from anon, authenticated;
grant select on public.status_events to authenticated;

create policy "status_events: read own"
  on public.status_events for select to authenticated
  using (
    exists (
      select 1 from public.user_postings up
      where up.id = user_posting_id and up.user_id = (select auth.uid())
    )
  );

-- No insert/update/delete policy or grant: only the triggers below write.

create function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.status_events (user_posting_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return null;
end;
$$;

-- Rows that start past 'new' (manual add, import) get their first event at
-- the applied date (noon in the app time zone; now if that's today), so the
-- timeline and the 30-day badge reflect when it really happened.
create function public.log_initial_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'new' then
    insert into public.status_events (user_posting_id, from_status, to_status, at)
    values (
      new.id,
      null,
      new.status,
      case
        when new.applied_at is null
          or new.applied_at >= (now() at time zone 'America/Chicago')::date
          then now()
        else (new.applied_at + time '12:00') at time zone 'America/Chicago'
      end
    );
  end if;
  return null;
end;
$$;

create trigger user_postings_log_status_change
  after update of status on public.user_postings
  for each row execute function public.log_status_change();

create trigger user_postings_log_initial_status
  after insert on public.user_postings
  for each row execute function public.log_initial_status();
