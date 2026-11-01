-- Baobab Digital Academy: GCSE mock exam centre.
-- Additive only: new exam_* tables, functions, one private storage bucket and one cron job.
-- Nothing existing is altered.

------------------------------------------------------------------------------
-- Who is this?
------------------------------------------------------------------------------
create or replace function public.exam_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid());
$$;

create or replace function public.exam_is_tutor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tutor_profiles where user_id = auth.uid() and status = 'active');
$$;

create or replace function public.exam_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.exam_is_admin() or public.exam_is_tutor();
$$;

-- A student is a signed-in Google account whose address is a child's school (Meet) address.
-- Google sign-in is required, so nobody can claim a student's address with a password account.
create or replace function public.exam_my_child_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id
    from children c
   where coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
     and c.meet_email is not null
     and normalise_email(c.meet_email) = normalise_email(auth.jwt() ->> 'email')
     and c.status = 'active'
   order by c.created_at
   limit 1;
$$;

-- Admins see every candidate; tutors see the children they teach.
create or replace function public.exam_staff_sees(p_child uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.exam_is_admin()
      or (public.exam_is_tutor() and p_child in (select public.child_ids_for_current_tutor()));
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.exam_settings (
  id                   boolean primary key default true check (id),
  lock_after           int  not null default 3  check (lock_after between 1 and 10),
  fullscreen           boolean not null default true,
  upload_grace_minutes int  not null default 10 check (upload_grace_minutes between 0 and 60),
  save_grace_seconds   int  not null default 120 check (save_grace_seconds between 0 and 600),
  updated_at           timestamptz not null default now()
);
comment on table public.exam_settings is 'Mock exam centre settings: strict-mode lock threshold, full screen, photo upload window.';
insert into public.exam_settings default values;

create table public.exam_papers (
  id          text primary key check (id ~ '^[A-Za-z0-9-]+$'),
  code        text not null,
  subject     text not null,
  title       text not null,
  tier        text check (tier in ('Higher', 'Foundation')),
  minutes     int  not null check (minutes between 1 and 300),
  total_marks int  not null check (total_marks > 0),
  calculator  boolean not null default true,
  sort        int  not null default 0,
  content     jsonb not null,            -- equipment, instructions, information, questions
  is_open     boolean not null default false,
  opened_at   timestamptz,
  opened_by   uuid,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.exam_papers is 'Mock exam papers. Students can read a paper only while it is open and they are entered for its subject and tier.';

create table public.exam_schemes (
  paper_id   text primary key references public.exam_papers (id) on delete cascade,
  items      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.exam_schemes is 'Mark schemes. Staff only; never readable by students.';

create sequence public.exam_candidate_seq start 101;

create table public.exam_candidates (
  child_id         uuid primary key references public.children (id) on delete cascade,
  candidate_number text not null unique,
  extra_time_pct   int  not null default 0 check (extra_time_pct in (0, 10, 25, 50)),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.exam_candidates is 'Children entered for the mock series, with candidate number and extra-time arrangement.';

create table public.exam_entries (
  child_id uuid not null references public.exam_candidates (child_id) on delete cascade,
  subject  text not null,
  tier     text check (tier in ('Higher', 'Foundation')),
  primary key (child_id, subject)
);
comment on table public.exam_entries is 'Which subjects (and tier) each candidate sits. Untiered subjects have a null tier.';

create table public.exam_attempts (
  id             uuid primary key default gen_random_uuid(),
  paper_id       text not null references public.exam_papers (id),
  child_id       uuid not null references public.children (id) on delete cascade,
  user_id        uuid not null,
  started_at     timestamptz not null default now(),
  limit_seconds  int  not null,
  deadline       timestamptz not null,
  extra_time_pct int  not null default 0,
  status         text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  submitted_at   timestamptz,
  auto_submitted boolean not null default false,
  answers        jsonb not null default '{}'::jsonb,
  flags          jsonb not null default '{}'::jsonb,
  violations     jsonb not null default '[]'::jsonb,
  strikes        int  not null default 0,
  locked         boolean not null default false,
  lock_count     int  not null default 0,
  unlock_count   int  not null default 0,
  saved_at       timestamptz,
  unique (paper_id, child_id)
);
create index exam_attempts_child_id_idx on public.exam_attempts (child_id);
comment on table public.exam_attempts is 'One sitting of one paper by one child. Written only through exam_* functions so the server enforces the deadline and strict mode.';

create table public.exam_photos (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.exam_attempts (id) on delete cascade,
  question_n   text not null,
  storage_path text not null unique,
  created_at   timestamptz not null default now()
);
create index exam_photos_attempt_id_idx on public.exam_photos (attempt_id);
comment on table public.exam_photos is 'Photos of rough working, stored in the private exam-working bucket.';

create table public.exam_marks (
  attempt_id uuid primary key references public.exam_attempts (id) on delete cascade,
  awarded    jsonb not null default '{}'::jsonb,
  feedback   text,
  total      int  not null default 0,
  max        int  not null,
  complete   boolean not null default false,
  marked_by  uuid,
  marked_at  timestamptz not null default now()
);
comment on table public.exam_marks is 'Teacher marks per attempt. Staff only for now.';

------------------------------------------------------------------------------
-- Row level security
------------------------------------------------------------------------------
alter table public.exam_settings   enable row level security;
alter table public.exam_papers     enable row level security;
alter table public.exam_schemes    enable row level security;
alter table public.exam_candidates enable row level security;
alter table public.exam_entries    enable row level security;
alter table public.exam_attempts   enable row level security;
alter table public.exam_photos     enable row level security;
alter table public.exam_marks      enable row level security;

create policy "Signed-in users read exam settings" on public.exam_settings
  for select to authenticated using (true);
create policy "Admins change exam settings" on public.exam_settings
  for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));

create policy "Staff read papers; students read open papers they are entered for" on public.exam_papers
  for select to authenticated using (
    (select public.exam_is_staff())
    or (is_open and exists (
          select 1 from public.exam_entries e
           where e.child_id = (select public.exam_my_child_id())
             and e.subject = exam_papers.subject
             and (exam_papers.tier is null or e.tier = exam_papers.tier))));
create policy "Admins insert papers" on public.exam_papers
  for insert to authenticated with check ((select public.exam_is_admin()));
create policy "Admins update papers" on public.exam_papers
  for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));
create policy "Admins delete papers" on public.exam_papers
  for delete to authenticated using ((select public.exam_is_admin()));

create policy "Staff read mark schemes" on public.exam_schemes
  for select to authenticated using ((select public.exam_is_staff()));
create policy "Admins insert mark schemes" on public.exam_schemes
  for insert to authenticated with check ((select public.exam_is_admin()));
create policy "Admins update mark schemes" on public.exam_schemes
  for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));
create policy "Admins delete mark schemes" on public.exam_schemes
  for delete to authenticated using ((select public.exam_is_admin()));

create policy "Candidates read own record; staff read their students" on public.exam_candidates
  for select to authenticated using (child_id = (select public.exam_my_child_id()) or public.exam_staff_sees(child_id));
create policy "Admins insert candidates" on public.exam_candidates
  for insert to authenticated with check ((select public.exam_is_admin()));
create policy "Admins update candidates" on public.exam_candidates
  for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));
create policy "Admins delete candidates" on public.exam_candidates
  for delete to authenticated using ((select public.exam_is_admin()));

create policy "Candidates read own entries; staff read their students" on public.exam_entries
  for select to authenticated using (child_id = (select public.exam_my_child_id()) or public.exam_staff_sees(child_id));
create policy "Admins insert entries" on public.exam_entries
  for insert to authenticated with check ((select public.exam_is_admin()));
create policy "Admins update entries" on public.exam_entries
  for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));
create policy "Admins delete entries" on public.exam_entries
  for delete to authenticated using ((select public.exam_is_admin()));

create policy "Students read own attempts; staff read their students" on public.exam_attempts
  for select to authenticated using (child_id = (select public.exam_my_child_id()) or public.exam_staff_sees(child_id));
create policy "Admins delete attempts" on public.exam_attempts
  for delete to authenticated using ((select public.exam_is_admin()));

create policy "Students read own photos; staff read their students" on public.exam_photos
  for select to authenticated using (exists (
    select 1 from public.exam_attempts a
     where a.id = exam_photos.attempt_id
       and (a.child_id = (select public.exam_my_child_id()) or public.exam_staff_sees(a.child_id))));

create policy "Staff read marks for their students" on public.exam_marks
  for select to authenticated using (exists (
    select 1 from public.exam_attempts a where a.id = exam_marks.attempt_id and public.exam_staff_sees(a.child_id)));
create policy "Staff record marks for their students" on public.exam_marks
  for insert to authenticated with check (exists (
    select 1 from public.exam_attempts a where a.id = exam_marks.attempt_id and public.exam_staff_sees(a.child_id)));
create policy "Staff update marks for their students" on public.exam_marks
  for update to authenticated
  using (exists (select 1 from public.exam_attempts a where a.id = exam_marks.attempt_id and public.exam_staff_sees(a.child_id)))
  with check (exists (select 1 from public.exam_attempts a where a.id = exam_marks.attempt_id and public.exam_staff_sees(a.child_id)));

------------------------------------------------------------------------------
-- Functions the apps call
------------------------------------------------------------------------------
create or replace function public.exam_whoami() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_child uuid := public.exam_my_child_id();
  v jsonb;
begin
  if public.exam_is_admin() then
    select jsonb_build_object('role', 'admin', 'name', full_name) into v from admin_profiles where user_id = auth.uid() limit 1;
  elsif public.exam_is_tutor() then
    select jsonb_build_object('role', 'tutor', 'name', full_name) into v from tutor_profiles where user_id = auth.uid() limit 1;
  elsif v_child is not null then
    select jsonb_build_object('role', 'student', 'name', c.name, 'child_id', c.id, 'year', c.grade_level,
                              'candidate_number', ec.candidate_number, 'extra_time_pct', coalesce(ec.extra_time_pct, 0))
      into v
      from children c left join exam_candidates ec on ec.child_id = c.id
     where c.id = v_child;
  else
    v := jsonb_build_object('role', null, 'email', auth.jwt() ->> 'email');
  end if;
  return v || jsonb_build_object('server_now', now(),
    'settings', (select to_jsonb(s) - 'id' from exam_settings s limit 1));
end;
$$;

create or replace function public.exam_start(p_paper text) returns public.exam_attempts
language plpgsql security definer set search_path = public as $$
declare
  v_child uuid := public.exam_my_child_id();
  v_paper exam_papers;
  v_cand  exam_candidates;
  v_att   exam_attempts;
  v_limit int;
begin
  if v_child is null then raise exception 'Only students can start a paper' using errcode = '42501'; end if;
  select * into v_att from exam_attempts where paper_id = p_paper and child_id = v_child;
  if found then return v_att; end if;
  select * into v_paper from exam_papers where id = p_paper;
  if not found or not v_paper.is_open then raise exception 'This paper is not open' using errcode = 'P0001'; end if;
  select * into v_cand from exam_candidates where child_id = v_child;
  if not found then raise exception 'You are not entered for the mock series' using errcode = '42501'; end if;
  if not exists (select 1 from exam_entries e where e.child_id = v_child and e.subject = v_paper.subject
                  and (v_paper.tier is null or e.tier = v_paper.tier)) then
    raise exception 'You are not entered for this paper' using errcode = '42501';
  end if;
  v_limit := round(v_paper.minutes * 60 * (100 + v_cand.extra_time_pct) / 100.0);
  insert into exam_attempts (paper_id, child_id, user_id, limit_seconds, deadline, extra_time_pct)
  values (p_paper, v_child, auth.uid(), v_limit, now() + make_interval(secs => v_limit), v_cand.extra_time_pct)
  returning * into v_att;
  return v_att;
end;
$$;

-- Returns the attempt row for the caller's own attempt, locked for update.
create or replace function public.exam_own_attempt(p_attempt uuid) returns public.exam_attempts
language plpgsql security definer set search_path = public as $$
declare v exam_attempts;
begin
  select * into v from exam_attempts where id = p_attempt and child_id = public.exam_my_child_id() for update;
  if not found then raise exception 'Attempt not found' using errcode = '42501'; end if;
  return v;
end;
$$;

create or replace function public.exam_save(p_attempt uuid, p_answers jsonb, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  g int := (select save_grace_seconds from exam_settings limit 1);
begin
  if v.status <> 'in_progress' then return jsonb_build_object('ok', false, 'status', v.status); end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_flags) <> 'object'
     or pg_column_size(p_answers) > 400000 then
    raise exception 'Answers are not in the expected form' using errcode = '22023';
  end if;
  if now() > v.deadline + make_interval(secs => g) then
    update exam_attempts set status = 'submitted', submitted_at = v.deadline, auto_submitted = true where id = v.id;
    return jsonb_build_object('ok', false, 'status', 'submitted', 'reason', 'time_up');
  end if;
  update exam_attempts set answers = p_answers, flags = p_flags, saved_at = now() where id = v.id;
  return jsonb_build_object('ok', true, 'saved_at', now(), 'server_now', now());
end;
$$;

create or replace function public.exam_submit(p_attempt uuid, p_answers jsonb, p_flags jsonb, p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  g int := (select save_grace_seconds from exam_settings limit 1);
  v_at timestamptz;
begin
  if v.status = 'submitted' then return jsonb_build_object('ok', true, 'submitted_at', v.submitted_at); end if;
  if now() <= v.deadline + make_interval(secs => g)
     and jsonb_typeof(p_answers) = 'object' and jsonb_typeof(p_flags) = 'object'
     and pg_column_size(p_answers) <= 400000 then
    update exam_attempts set answers = p_answers, flags = p_flags, saved_at = now() where id = v.id;
  end if;
  update exam_attempts
     set status = 'submitted', submitted_at = least(now(), deadline), auto_submitted = coalesce(p_auto, false) or now() > deadline
   where id = v.id
  returning submitted_at into v_at;
  return jsonb_build_object('ok', true, 'submitted_at', v_at);
end;
$$;

create or replace function public.exam_report_exit(p_attempt uuid, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  n int := (select lock_after from exam_settings limit 1);
  ev jsonb := jsonb_build_object('type', left(coalesce(p_type, 'Left the exam'), 80), 'at', now());
  s int;
begin
  if v.status <> 'in_progress' then return jsonb_build_object('locked', false, 'strikes', v.strikes, 'lock_after', n); end if;
  if v.locked then
    update exam_attempts set violations = violations || ev where id = v.id;
    return jsonb_build_object('locked', true, 'strikes', v.strikes, 'lock_after', n);
  end if;
  s := v.strikes + 1;
  if s >= n then
    update exam_attempts set violations = violations || ev, strikes = 0, locked = true, lock_count = lock_count + 1 where id = v.id;
    return jsonb_build_object('locked', true, 'strikes', 0, 'lock_after', n);
  end if;
  update exam_attempts set violations = violations || ev, strikes = s where id = v.id;
  return jsonb_build_object('locked', false, 'strikes', s, 'lock_after', n);
end;
$$;

create or replace function public.exam_unlock(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v exam_attempts;
begin
  select * into v from exam_attempts where id = p_attempt for update;
  if not found or not public.exam_staff_sees(v.child_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update exam_attempts
     set locked = false, strikes = 0, unlock_count = unlock_count + 1,
         violations = violations || jsonb_build_object('type', 'Unlocked by teacher', 'at', now(), 'by', auth.uid())
   where id = p_attempt;
end;
$$;

create or replace function public.exam_set_open(p_paper text, p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.exam_is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update exam_papers
     set is_open = p_open,
         opened_at = case when p_open then now() else opened_at end,
         opened_by = case when p_open then auth.uid() else opened_by end,
         closed_at = case when p_open then null else now() end,
         updated_at = now()
   where id = p_paper;
  if not found then raise exception 'Paper not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.exam_enrol(p_child uuid) returns public.exam_candidates
language plpgsql security definer set search_path = public as $$
declare v exam_candidates;
begin
  if not public.exam_is_admin() then raise exception 'Only admins can enter candidates' using errcode = '42501'; end if;
  insert into exam_candidates (child_id, candidate_number)
  values (p_child, 'BDA-' || lpad(nextval('exam_candidate_seq')::text, 4, '0'))
  on conflict (child_id) do update set updated_at = now()
  returning * into v;
  return v;
end;
$$;

-- Photo upload window: while sitting (to the deadline plus save grace) and for upload_grace_minutes after submitting.
create or replace function public.exam_upload_open(p_attempt uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from exam_attempts a, exam_settings s
     where a.id = p_attempt
       and a.child_id = public.exam_my_child_id()
       and ((a.status = 'in_progress' and now() <= a.deadline + make_interval(secs => s.save_grace_seconds))
         or (a.status = 'submitted' and now() <= a.submitted_at + make_interval(mins => s.upload_grace_minutes))));
$$;

create or replace function public.exam_path_attempt(p_name text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return split_part(p_name, '/', 2)::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.exam_add_photo(p_attempt uuid, p_question text, p_path text) returns public.exam_photos
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts;
  r exam_photos;
begin
  select * into v from exam_attempts where id = p_attempt and child_id = public.exam_my_child_id();
  if not found or not public.exam_upload_open(p_attempt) then raise exception 'The upload window for this paper is closed' using errcode = '42501'; end if;
  if p_path not like v.child_id::text || '/' || v.id::text || '/%' then raise exception 'Bad photo path' using errcode = '22023'; end if;
  insert into exam_photos (attempt_id, question_n, storage_path) values (p_attempt, left(p_question, 10), p_path) returning * into r;
  return r;
end;
$$;

create or replace function public.exam_remove_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text; v_att uuid;
begin
  select p.storage_path, p.attempt_id into v_path, v_att from exam_photos p where p.id = p_photo;
  if v_path is null or not public.exam_upload_open(v_att) then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from exam_photos where id = p_photo;
  return v_path;
end;
$$;

-- Server-side auto-submit for students who closed the page and never came back.
create or replace function public.exam_finalise_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update exam_attempts a
     set status = 'submitted', submitted_at = a.deadline, auto_submitted = true
    from exam_settings s
   where a.status = 'in_progress' and now() > a.deadline + make_interval(secs => s.save_grace_seconds);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Lock every new function down, then open only what the apps call.
revoke all on function
  public.exam_is_admin(), public.exam_is_tutor(), public.exam_is_staff(), public.exam_my_child_id(),
  public.exam_staff_sees(uuid), public.exam_whoami(), public.exam_start(text), public.exam_own_attempt(uuid),
  public.exam_save(uuid, jsonb, jsonb), public.exam_submit(uuid, jsonb, jsonb, boolean), public.exam_report_exit(uuid, text),
  public.exam_unlock(uuid), public.exam_set_open(text, boolean), public.exam_enrol(uuid), public.exam_upload_open(uuid),
  public.exam_path_attempt(text), public.exam_add_photo(uuid, text, text), public.exam_remove_photo(uuid),
  public.exam_finalise_overdue()
  from public, anon;

grant execute on function
  public.exam_is_admin(), public.exam_is_tutor(), public.exam_is_staff(), public.exam_my_child_id(),
  public.exam_staff_sees(uuid), public.exam_whoami(), public.exam_start(text),
  public.exam_save(uuid, jsonb, jsonb), public.exam_submit(uuid, jsonb, jsonb, boolean), public.exam_report_exit(uuid, text),
  public.exam_unlock(uuid), public.exam_set_open(text, boolean), public.exam_enrol(uuid), public.exam_upload_open(uuid),
  public.exam_path_attempt(text), public.exam_add_photo(uuid, text, text), public.exam_remove_photo(uuid)
  to authenticated;
revoke all on function public.exam_own_attempt(uuid), public.exam_finalise_overdue() from authenticated;

revoke all on sequence public.exam_candidate_seq from public, anon, authenticated;

------------------------------------------------------------------------------
-- Storage: private bucket for photos of working, folder = <child_id>/<attempt_id>/
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-working', 'exam-working', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Students upload working to their open attempt" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'exam-working'
    and split_part(name, '/', 1) = (select public.exam_my_child_id())::text
    and public.exam_upload_open(public.exam_path_attempt(name)));

create policy "Students and their teachers view working" on storage.objects
  for select to authenticated using (
    bucket_id = 'exam-working'
    and (split_part(name, '/', 1) = (select public.exam_my_child_id())::text
         or exists (select 1 from public.exam_attempts a
                     where a.id = public.exam_path_attempt(name) and public.exam_staff_sees(a.child_id))));

create policy "Students remove working while the window is open" on storage.objects
  for delete to authenticated using (
    bucket_id = 'exam-working'
    and split_part(name, '/', 1) = (select public.exam_my_child_id())::text
    and public.exam_upload_open(public.exam_path_attempt(name)));

------------------------------------------------------------------------------
-- Every minute, submit papers whose time ran out while the student was away.
------------------------------------------------------------------------------
select cron.schedule('exam-finalise-overdue', '* * * * *', $$select public.exam_finalise_overdue();$$);
