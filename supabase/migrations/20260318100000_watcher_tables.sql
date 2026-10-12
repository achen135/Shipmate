-- Watcher tables: the shared half of the data model (Spec "Data model").
--
-- Written only by the worker with the service-role key. Signed-in users may
-- read companies and postings (public job data); admins may read sources and
-- runs for the health page. posting_sources (raw upstream rows) is
-- worker-only.
--
-- Lifecycle lives on posting_sources, one row per (source, upstream job):
-- `active` is what the source says, `missed_runs` counts consecutive
-- successful snapshots that left the job out. A link is live while active and
-- missed_runs < 2; a posting is open while any of its links is live. The
-- worker computes that (lib/postings/lifecycle.ts) and writes postings.status.

-- ---------------------------------------------------------------- companies

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- lib/postings/normalize.ts normalizeCompany(): lowercase, no punctuation
  -- or legal suffixes. One company per normalized name.
  normalized_name text not null unique,
  website text,
  careers_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- sources

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  -- Stable identity for seeding and upserts, e.g. 'simplify:Owner/Repo'.
  key text not null unique,
  kind text not null check (
    kind in ('simplify_repo', 'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday')
  ),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  company_id uuid references public.companies (id) on delete cascade,
  tier text not null default 'hot' check (tier in ('hot', 'cold')),
  shard smallint,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  -- Active jobs in the last successful snapshot.
  last_count integer,
  last_error text,
  -- Set when the last check errored or the count fell by more than half;
  -- the admin health page shows it as a red badge.
  last_alert text,
  -- Commit SHA (aggregators) or ETag (boards) of the last snapshot. Unchanged
  -- = nothing downloaded.
  last_sha_or_etag text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- postings

create table public.postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  title text not null,
  url text not null,
  -- Dedupe keys of the primary link (lib/postings/url.ts, normalize.ts). Not
  -- unique constraints: an upstream URL edit could collide with another row
  -- mid-batch and fail the whole run. The worker's dedupe index keeps them
  -- unique in practice.
  canonical_url text not null,
  ats text,
  ats_job_id text,
  fuzzy_key text,
  locations text[] not null default '{}',
  -- Empty = unknown (Simplify's "N/A"); matching treats unknown as any term.
  terms text[] not null default '{}',
  category text check (category in ('Software', 'AI/ML/Data', 'Hardware', 'Quant', 'Product')),
  sponsorship text not null default 'unknown' check (
    sponsorship in ('unknown', 'offers', 'no_sponsorship', 'citizens_only')
  ),
  degrees text[] not null default '{}',
  description text,
  posted_at timestamptz,
  -- Display names of the sources that list it ("Simplify Summer 2027").
  source_names text[] not null default '{}',
  -- Hash of the combined fields, so unchanged postings aren't rewritten.
  content_hash text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index postings_ats_job on public.postings (ats, ats_job_id) where ats_job_id is not null;
create index postings_canonical_url on public.postings (canonical_url);
create index postings_fuzzy_key on public.postings (fuzzy_key);
create index postings_open_by_posted on public.postings (posted_at desc) where status = 'open';
create index postings_company on public.postings (company_id);

-- Only real changes: touch_seen() updates last_seen_at on every run.
create trigger postings_set_updated_at
  before update of content_hash, status on public.postings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- posting_sources

create table public.posting_sources (
  id uuid primary key default gen_random_uuid(),
  posting_id uuid not null references public.postings (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  -- The source's own id for the job (Simplify's row id, an ATS job id…).
  source_job_id text not null,
  -- This source's normalized view of the job (lib/sources/types.ts). The
  -- posting row is combined from all of its links.
  data jsonb not null,
  raw jsonb not null,
  content_hash text not null,
  active boolean not null default true,
  missed_runs smallint not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, source_job_id)
);

create index posting_sources_posting on public.posting_sources (posting_id);

-- ---------------------------------------------------------------- runs

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- GITHUB_EVENT_NAME (schedule / workflow_dispatch) or 'local'.
  trigger text,
  github_run_id text,
  -- True when any source took its first snapshot this run. Postings from a
  -- first snapshot never reach inboxes as new (only via the 7-day backfill).
  is_seed boolean not null default false,
  ok boolean,
  -- Per source: fetched/active/new/merged/updated/closed/reopened, duration;
  -- plus matching counts. See worker/run.ts.
  stats jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index runs_started on public.runs (started_at desc);

-- ---------------------------------------------------------------- touch_seen

-- Bump last_seen_at for every link the worker saw this run (and its posting)
-- in one statement. Thousands of ids per call, so a POST body beats a URL.
create function public.touch_seen(p_link_ids uuid[])
returns void
language sql
volatile
set search_path = ''
as $$
  update public.posting_sources set last_seen_at = now() where id = any(p_link_ids);
  update public.postings set last_seen_at = now()
  where id in (select posting_id from public.posting_sources where id = any(p_link_ids));
$$;

revoke execute on function public.touch_seen(uuid[]) from public, anon, authenticated;

-- Bulk link updates from the worker's plan (lib/postings/plan.ts LinkUpdate).
-- Lifecycle fields always; data/raw/content_hash only when present, because
-- a link the snapshot left out has no new raw row to store.
create function public.update_links(p_links jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.posting_sources s
  set active = x.active,
      missed_runs = x.missed_runs,
      data = coalesce(x.data, s.data),
      raw = coalesce(x.raw, s.raw),
      content_hash = coalesce(x.content_hash, s.content_hash)
  from jsonb_to_recordset(p_links) as x (
    id uuid, active boolean, missed_runs smallint,
    data jsonb, raw jsonb, content_hash text
  )
  where s.id = x.id;
$$;

revoke execute on function public.update_links(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- access

alter table public.companies enable row level security;
alter table public.sources enable row level security;
alter table public.postings enable row level security;
alter table public.posting_sources enable row level security;
alter table public.runs enable row level security;

revoke all on public.companies, public.sources, public.postings,
  public.posting_sources, public.runs from anon, authenticated;

grant select on public.companies, public.postings to authenticated;
grant select on public.sources, public.runs to authenticated;

create policy "companies: signed-in users read"
  on public.companies for select to authenticated using (true);

create policy "postings: signed-in users read"
  on public.postings for select to authenticated using (true);

create policy "sources: admins read"
  on public.sources for select to authenticated using ((select public.is_admin()));

create policy "runs: admins read"
  on public.runs for select to authenticated using ((select public.is_admin()));

-- No write policies anywhere: only the service role (which bypasses RLS)
-- writes these tables.

-- ---------------------------------------------------------------- seed sources

-- The three Simplify-format aggregators (CLAUDE.md "Aggregators"). Same JSON
-- shape with small differences the adapter handles via config:
-- - New-Grad rows have no terms → defaultTerms.
-- - vanshb03 has `season` ("Summer") instead of `terms` → seasonYears.
insert into public.sources (key, kind, name, config) values
  (
    'simplify:SimplifyJobs/Summer2027-Internships',
    'simplify_repo',
    'Simplify Summer 2027',
    '{"repo": "SimplifyJobs/Summer2027-Internships", "branch": "dev", "path": ".github/scripts/listings.json"}'
  ),
  (
    'simplify:SimplifyJobs/New-Grad-Positions',
    'simplify_repo',
    'Simplify New Grad',
    '{"repo": "SimplifyJobs/New-Grad-Positions", "branch": "dev", "path": ".github/scripts/listings.json", "defaultTerms": ["New Grad"]}'
  ),
  (
    'simplify:vanshb03/Summer2027-Internships',
    'simplify_repo',
    'vanshb03 Summer 2027',
    '{"repo": "vanshb03/Summer2027-Internships", "branch": "dev", "path": ".github/scripts/listings.json", "seasonYears": {"Summer": 2027, "Fall": 2026, "Winter": 2027, "Spring": 2027}}'
  );
