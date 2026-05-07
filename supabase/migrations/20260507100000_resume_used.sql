-- Which PDF went with an application (Spec: user_postings.resume_used,
-- "tailoring or master snapshot"; M8 §1).
--
-- Every PDF Shipmate keeps is now written once to its own path and never
-- overwritten: the worker prints each tailored or edited copy to
-- pdfs/{user}/{posting}/{stamp}.pdf, and an uploaded resume goes to
-- uploads/{user}/resume-{stamp}.pdf. So recording the path records the
-- exact file. Older versions are removed only when no application points at
-- them (worker/tailor.ts, app/api/resume/route.ts).
--
-- resume_used: { kind: "tailored" | "uploaded", bucket, path, file_name,
-- tailoring_id, edited, recorded_at }. Written only through
-- record_resume_used() below (no column grant), so it always names a file
-- that is the user's own and exists. The first record wins: "Did you
-- submit? → Yes" and a later "Mark applied" don't overwrite what the
-- extension recorded as actually attached.

alter table public.user_postings
  add column resume_used jsonb check (
    resume_used is null
    or (jsonb_typeof(resume_used) = 'object' and pg_column_size(resume_used) <= 2000)
  );

-- The shared logic, for one user. Not callable directly: the wrappers say
-- who the user is (the signed-in caller here; the extension's token in its
-- own function).
create function public.resume_used_for(
  p_user uuid,
  p_user_posting_id uuid,
  p_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_record jsonb;
  v_tailoring record;
  v_resume record;
begin
  select up.resume_used into v_existing
  from public.user_postings up
  where up.id = p_user_posting_id and up.user_id = p_user
  for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_existing is not null then
    return v_existing;
  end if;

  -- A tailored PDF of this posting: the one named, or else the latest.
  select t.id, t.pdf_path, t.edited_at into v_tailoring
  from public.tailorings t
  where t.user_id = p_user
    and t.user_posting_id = p_user_posting_id
    and t.state = 'done'
    and t.pdf_path is not null
    and (p_path is null or t.pdf_path = p_path)
  order by t.created_at desc
  limit 1;
  if found then
    v_record := jsonb_build_object(
      'kind', 'tailored',
      'bucket', 'pdfs',
      'path', v_tailoring.pdf_path,
      'tailoring_id', v_tailoring.id,
      'edited', v_tailoring.edited_at is not null
    );
  else
    -- Otherwise their uploaded resume.
    select r.file_path, r.file_name into v_resume
    from public.resumes r
    where r.user_id = p_user
      and r.file_path is not null
      and (p_path is null or r.file_path = p_path);
    if found then
      v_record := jsonb_build_object(
        'kind', 'uploaded',
        'bucket', 'uploads',
        'path', v_resume.file_path,
        'file_name', v_resume.file_name
      );
    elsif p_path is not null then
      raise exception 'not your PDF for this posting' using errcode = '42501';
    else
      return null;
    end if;
  end if;

  -- The file itself must be there, in the user's own folder.
  if (storage.foldername(v_record ->> 'path'))[1] is distinct from p_user::text
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = v_record ->> 'bucket'
         and o.name = v_record ->> 'path'
     ) then
    return null;
  end if;

  v_record := v_record || jsonb_build_object('recorded_at', now());
  update public.user_postings
     set resume_used = v_record
   where id = p_user_posting_id and user_id = p_user;
  return v_record;
end;
$$;

revoke all on function public.resume_used_for(uuid, uuid, text) from public, anon, authenticated;

-- The signed-in user's own application.
create function public.record_resume_used(
  p_user_posting_id uuid,
  p_path text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.resume_used_for((select auth.uid()), p_user_posting_id, p_path);
$$;

revoke all on function public.record_resume_used(uuid, text) from public, anon;
grant execute on function public.record_resume_used(uuid, text) to authenticated;
