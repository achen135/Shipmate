-- A second look (lib/tailor/second-look.ts): notes a second read of the
-- finished tailored copy wrote for the user. Never applied to the resume.
-- [{ what }], at most 8 of at most 400 characters each, written by the
-- worker only; read through the existing "tailorings: read own" policy.
alter table public.tailorings
  add column suggestions jsonb not null default '[]' check (
    jsonb_typeof(suggestions) = 'array' and pg_column_size(suggestions) <= 10000
  );

comment on column public.tailorings.suggestions is
  'Second-look notes [{ what }] for the user; never applied to resume_content.';
