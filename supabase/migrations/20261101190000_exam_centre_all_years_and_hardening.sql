-- Exam centre v2: every year group, six assessment cycles a year, GCSE mocks by exam board,
-- and hardening. Touches only exam_* objects.

------------------------------------------------------------------------------
-- Staff two-factor gate. When require_staff_mfa is on, staff powers need an aal2 session.
------------------------------------------------------------------------------
alter table public.exam_settings
  add column require_staff_mfa boolean not null default false,
  add column block_paste       boolean not null default true,
  add column max_photos        int     not null default 40 check (max_photos between 0 and 200),
  add column staff_idle_minutes int    not null default 30 check (staff_idle_minutes between 5 and 240);

create or replace function public.exam_mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select require_staff_mfa from exam_settings limit 1), false)
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Role checks now include the two-factor gate, so every existing policy picks it up.
create or replace function public.exam_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid()) and public.exam_mfa_ok();
$$;

create or replace function public.exam_is_tutor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tutor_profiles where user_id = auth.uid() and status = 'active') and public.exam_mfa_ok();
$$;

-- Students: Google sign-in, school domain, verified address, matched to an active child.
create or replace function public.exam_my_child_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id
    from children c
   where coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
     and normalise_email(auth.jwt() ->> 'email') like '%@baobabonlineacademy.com'
     and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, true)
     and c.meet_email is not null
     and normalise_email(c.meet_email) = normalise_email(auth.jwt() ->> 'email')
     and c.status = 'active'
   order by c.created_at
   limit 1;
$$;

------------------------------------------------------------------------------
-- Series: the six bi-monthly assessments and the GCSE mock series.
------------------------------------------------------------------------------
create table public.exam_series (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             text not null check (kind in ('assessment', 'mock')),
  academic_year    text not null check (academic_year ~ '^\d{4}/\d{2}$'),
  cycle            int check (cycle between 1 and 6),
  starts_on        date,
  ends_on          date,
  results_released boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (kind = 'mock' or cycle is not null)
);
create unique index exam_series_cycle_uq on public.exam_series (academic_year, cycle) where kind = 'assessment';
comment on table public.exam_series is 'An assessment window (six a year) or a mock series. Papers belong to a series.';
alter table public.exam_series enable row level security;
create policy "Staff read series" on public.exam_series for select to authenticated using ((select public.exam_is_staff()));
create policy "Admins insert series" on public.exam_series for insert to authenticated with check ((select public.exam_is_admin()));
create policy "Admins update series" on public.exam_series for update to authenticated using ((select public.exam_is_admin())) with check ((select public.exam_is_admin()));
create policy "Admins delete series" on public.exam_series for delete to authenticated using ((select public.exam_is_admin()));

alter table public.exam_papers
  add column series_id     uuid references public.exam_series (id),
  add column year_groups   text[] not null default '{}',
  add column qualification text,
  add column board         text,
  add column lock_after    int check (lock_after between 1 and 10),
  add column fullscreen    boolean;
create index exam_papers_series_id_idx on public.exam_papers (series_id);

alter table public.exam_entries add column board text;

alter table public.exam_attempts
  add column session_id   text,
  add column locked_at    timestamptz,
  add column last_seen_at timestamptz,
  add column client       jsonb not null default '{}'::jsonb;

------------------------------------------------------------------------------
-- Students no longer read exam tables directly; everything goes through functions.
------------------------------------------------------------------------------
drop policy "Staff read papers; students read open papers they are entered for" on public.exam_papers;
create policy "Staff read papers" on public.exam_papers for select to authenticated using ((select public.exam_is_staff()));

drop policy "Students read own attempts; staff read their students" on public.exam_attempts;
create policy "Staff read their students' attempts" on public.exam_attempts for select to authenticated using (public.exam_staff_sees(child_id));

drop policy "Students read own photos; staff read their students" on public.exam_photos;
create policy "Staff read their students' photos" on public.exam_photos for select to authenticated using (exists (
  select 1 from public.exam_attempts a where a.id = exam_photos.attempt_id and public.exam_staff_sees(a.child_id)));

drop policy "Candidates read own record; staff read their students" on public.exam_candidates;
create policy "Staff read their students' candidate records" on public.exam_candidates for select to authenticated using (public.exam_staff_sees(child_id));

drop policy "Candidates read own entries; staff read their students" on public.exam_entries;
create policy "Staff read their students' entries" on public.exam_entries for select to authenticated using (public.exam_staff_sees(child_id));

-- Defence in depth: no anonymous access at all, and no direct writes where functions own the writing.
revoke all on public.exam_settings, public.exam_papers, public.exam_schemes, public.exam_candidates, public.exam_entries,
              public.exam_attempts, public.exam_photos, public.exam_marks, public.exam_series from anon;
revoke insert, update, delete on public.exam_attempts, public.exam_photos from authenticated;

------------------------------------------------------------------------------
-- Audit trail: append-only, written only by the database.
------------------------------------------------------------------------------
create table public.exam_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid default auth.uid(),
  kind       text not null,
  attempt_id uuid references public.exam_attempts (id) on delete set null,
  child_id   uuid references public.children (id) on delete set null,
  paper_id   text,
  detail     jsonb not null default '{}'::jsonb,
  ip         text,
  user_agent text
);
create index exam_events_attempt_idx on public.exam_events (attempt_id);
create index exam_events_child_idx on public.exam_events (child_id);
create index exam_events_at_idx on public.exam_events (at desc);
comment on table public.exam_events is 'Append-only audit trail for the exam centre: starts, exits, locks, unlocks, devices, marks and admin changes.';
alter table public.exam_events enable row level security;
create policy "Admins read all events; tutors read their students' events" on public.exam_events for select to authenticated
  using ((select public.exam_is_admin()) or (child_id is not null and public.exam_staff_sees(child_id)));
revoke all on public.exam_events from anon;
revoke insert, update, delete, truncate on public.exam_events from authenticated;

create or replace function public.exam_log(p_kind text, p_attempt uuid, p_child uuid, p_paper text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  insert into exam_events (kind, attempt_id, child_id, paper_id, detail, ip, user_agent)
  values (left(p_kind, 60), p_attempt, p_child, p_paper, coalesce(p_detail, '{}'::jsonb),
          left(coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1)), 64),
          left(h ->> 'user-agent', 300));
end;
$$;

-- Log every change to marks, entries, candidates, settings, papers and series.
create or replace function public.exam_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  v_child uuid; v_attempt uuid; v_paper text;
begin
  if tg_table_name = 'exam_marks' then
    v_attempt := (r ->> 'attempt_id')::uuid;
    select child_id, paper_id into v_child, v_paper from exam_attempts where id = v_attempt;
  elsif tg_table_name in ('exam_entries', 'exam_candidates') then
    v_child := (r ->> 'child_id')::uuid;
  elsif tg_table_name = 'exam_papers' then
    v_paper := r ->> 'id';
  end if;
  perform public.exam_log(tg_table_name || '.' || lower(tg_op), v_attempt, v_child, v_paper,
    case tg_table_name
      when 'exam_marks' then jsonb_build_object('total', r -> 'total', 'complete', r -> 'complete')
      when 'exam_papers' then jsonb_build_object('is_open', r -> 'is_open', 'code', r -> 'code')
      when 'exam_settings' then r
      when 'exam_series' then jsonb_build_object('name', r -> 'name', 'results_released', r -> 'results_released')
      else r end);
  return coalesce(new, old);
end;
$$;
create trigger exam_marks_audit      after insert or update or delete on public.exam_marks      for each row execute function public.exam_audit();
create trigger exam_entries_audit    after insert or update or delete on public.exam_entries    for each row execute function public.exam_audit();
create trigger exam_candidates_audit after insert or update or delete on public.exam_candidates for each row execute function public.exam_audit();
create trigger exam_settings_audit   after update on public.exam_settings                        for each row execute function public.exam_audit();
create trigger exam_papers_audit     after insert or update or delete on public.exam_papers     for each row execute function public.exam_audit();
create trigger exam_series_audit     after insert or update or delete on public.exam_series     for each row execute function public.exam_audit();

------------------------------------------------------------------------------
-- Who may sit which paper.
-- Year group must match. Papers with a board or tier need an entry (board and tier must match).
-- Other papers are open to children taught that subject, or entered for it.
------------------------------------------------------------------------------
create or replace function public.exam_child_can_sit(p_child uuid, p_paper text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from children c, exam_papers p
     where c.id = p_child and p.id = p_paper and c.status = 'active'
       and c.grade_level = any (p.year_groups)
       and (
         exists (select 1 from exam_entries e
                  where e.child_id = c.id and e.subject = p.subject
                    and (p.tier is null or e.tier = p.tier)
                    and (p.board is null or e.board = p.board))
         or (p.board is null and p.tier is null and exists (
               select 1 from teacher_student_assignments t join subjects s on s.id = t.subject_id
                where t.child_id = c.id and t.status = 'active'
                  and (t.end_date is null or t.end_date >= current_date)
                  and s.name = p.subject))));
$$;

-- Effective strict settings for a paper.
create or replace function public.exam_paper_rules(p_paper text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lock_after', coalesce(p.lock_after, s.lock_after),
    'fullscreen', coalesce(p.fullscreen, s.fullscreen),
    'block_paste', s.block_paste,
    'upload_grace_minutes', s.upload_grace_minutes,
    'save_grace_seconds', s.save_grace_seconds,
    'max_photos', s.max_photos)
  from exam_papers p, exam_settings s where p.id = p_paper;
$$;

------------------------------------------------------------------------------
-- Identity
------------------------------------------------------------------------------
create or replace function public.exam_whoami() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_child uuid := public.exam_my_child_id();
  v jsonb;
  v_need_mfa boolean := not public.exam_mfa_ok();
  v_settings jsonb := (select jsonb_build_object('staff_idle_minutes', staff_idle_minutes, 'require_staff_mfa', require_staff_mfa) from exam_settings limit 1);
begin
  if exists (select 1 from admin_profiles where user_id = auth.uid()) then
    select jsonb_build_object('role', 'admin', 'name', full_name) into v from admin_profiles where user_id = auth.uid() limit 1;
    v := v || jsonb_build_object('mfa_needed', v_need_mfa);
  elsif exists (select 1 from tutor_profiles where user_id = auth.uid() and status = 'active') then
    select jsonb_build_object('role', 'tutor', 'name', full_name) into v from tutor_profiles where user_id = auth.uid() limit 1;
    v := v || jsonb_build_object('mfa_needed', v_need_mfa);
  elsif v_child is not null then
    select jsonb_build_object('role', 'student', 'name', c.name, 'child_id', c.id, 'year', c.grade_level,
                              'candidate_number', ec.candidate_number, 'extra_time_pct', coalesce(ec.extra_time_pct, 0))
      into v from children c left join exam_candidates ec on ec.child_id = c.id where c.id = v_child;
  else
    v := jsonb_build_object('role', null);
  end if;
  return v || jsonb_build_object('server_now', now(), 'settings', v_settings);
end;
$$;

------------------------------------------------------------------------------
-- Student dashboard: current series, papers I may sit now, my attempts, released results.
------------------------------------------------------------------------------
create or replace function public.exam_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_child uuid := public.exam_my_child_id();
  v_year text;
begin
  if v_child is null then raise exception 'Not a student account' using errcode = '42501'; end if;
  select academic_year into v_year from exam_series
   order by (current_date between coalesce(starts_on, current_date) and coalesce(ends_on, current_date)) desc, created_at desc limit 1;
  return jsonb_build_object(
    'server_now', now(),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'cycle', s.cycle,
                         'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.cycle nulls last, s.starts_on)
                        from exam_series s where s.academic_year = v_year and s.kind = 'assessment'), '[]'::jsonb),
    'academic_year', v_year,
    'papers', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'code', p.code, 'subject', p.subject, 'title', p.title, 'tier', p.tier, 'board', p.board,
                          'qualification', p.qualification, 'minutes', p.minutes, 'total_marks', p.total_marks, 'calculator', p.calculator,
                          'series', s.name, 'series_kind', s.kind, 'rules', public.exam_paper_rules(p.id),
                          'attempt', (select jsonb_build_object('id', a.id, 'status', a.status, 'deadline', a.deadline,
                                        'submitted_at', a.submitted_at, 'locked', a.locked)
                                        from exam_attempts a where a.paper_id = p.id and a.child_id = v_child))
                          order by p.sort, p.code)
                        from exam_papers p left join exam_series s on s.id = p.series_id
                       where public.exam_child_can_sit(v_child, p.id)
                         and (p.is_open or exists (select 1 from exam_attempts a where a.paper_id = p.id and a.child_id = v_child
                                                   and (a.status = 'in_progress' or a.submitted_at > now() - interval '1 hour')))), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('paper', p.code, 'subject', p.subject, 'title', p.title,
                           'series', s.name, 'total', m.total, 'max', m.max, 'feedback', m.feedback) order by s.created_at desc, p.sort)
                         from exam_attempts a join exam_papers p on p.id = a.paper_id join exam_series s on s.id = p.series_id
                         join exam_marks m on m.attempt_id = a.id
                        where a.child_id = v_child and s.results_released and m.complete), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------
-- Sitting a paper
------------------------------------------------------------------------------
create or replace function public.exam_session() returns text
language sql stable as $$ select coalesce(auth.jwt() ->> 'session_id', ''); $$;

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
  if not public.exam_child_can_sit(v_child, p_paper) then raise exception 'You are not entered for this paper' using errcode = '42501'; end if;
  select * into v_cand from exam_candidates where child_id = v_child;
  if not found then
    insert into exam_candidates (child_id, candidate_number)
    values (v_child, 'BDA-' || lpad(nextval('exam_candidate_seq')::text, 4, '0')) returning * into v_cand;
  end if;
  v_limit := round(v_paper.minutes * 60 * (100 + v_cand.extra_time_pct) / 100.0);
  insert into exam_attempts (paper_id, child_id, user_id, limit_seconds, deadline, extra_time_pct, session_id, last_seen_at)
  values (p_paper, v_child, auth.uid(), v_limit, now() + make_interval(secs => v_limit), v_cand.extra_time_pct, public.exam_session(), now())
  returning * into v_att;
  perform public.exam_log('attempt.start', v_att.id, v_child, p_paper, jsonb_build_object('limit_seconds', v_limit));
  return v_att;
end;
$$;

-- Session check used by every in-exam call. A second device or browser locks the paper.
create or replace function public.exam_guard_session(v exam_attempts) returns exam_attempts
language plpgsql security definer set search_path = public as $$
declare s text := public.exam_session();
begin
  if v.status = 'in_progress' and coalesce(v.session_id, '') <> s then
    perform public.exam_log('attempt.other_device', v.id, v.child_id, v.paper_id, jsonb_build_object('was_locked', v.locked));
    update exam_attempts
       set session_id = s, locked = true, locked_at = now(), strikes = 0,
           lock_count = lock_count + case when locked then 0 else 1 end,
           violations = violations || jsonb_build_object('type', 'Opened on another device or browser', 'at', now())
     where id = v.id returning * into v;
  end if;
  return v;
end;
$$;

create or replace function public.exam_open_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  p exam_papers;
begin
  if v.status <> 'in_progress' then
    return jsonb_build_object('status', v.status, 'submitted_at', v.submitted_at, 'auto_submitted', v.auto_submitted);
  end if;
  v := public.exam_guard_session(v);
  select * into p from exam_papers where id = v.paper_id;
  update exam_attempts set last_seen_at = now() where id = v.id;
  return jsonb_build_object(
    'status', v.status, 'server_now', now(),
    'attempt', jsonb_build_object('id', v.id, 'deadline', v.deadline, 'extra_time_pct', v.extra_time_pct, 'answers', v.answers,
                                  'flags', v.flags, 'locked', v.locked, 'strikes', v.strikes),
    'paper', jsonb_build_object('id', p.id, 'code', p.code, 'subject', p.subject, 'title', p.title, 'tier', p.tier, 'board', p.board,
                                'minutes', p.minutes, 'total_marks', p.total_marks, 'calculator', p.calculator, 'content', p.content),
    'rules', public.exam_paper_rules(p.id));
end;
$$;

create or replace function public.exam_save(p_attempt uuid, p_answers jsonb, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  g int := (select save_grace_seconds from exam_settings limit 1);
begin
  if v.status <> 'in_progress' then return jsonb_build_object('ok', false, 'status', v.status); end if;
  if coalesce(v.session_id, '') <> public.exam_session() then
    perform public.exam_log('save.other_device_refused', v.id, v.child_id, v.paper_id);
    return jsonb_build_object('ok', false, 'reason', 'other_device');
  end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_flags) <> 'object'
     or pg_column_size(p_answers) > 400000 or pg_column_size(p_flags) > 20000 then
    raise exception 'Answers are not in the expected form' using errcode = '22023';
  end if;
  if now() > v.deadline + make_interval(secs => g) then
    update exam_attempts set status = 'submitted', submitted_at = v.deadline, auto_submitted = true where id = v.id;
    perform public.exam_log('attempt.auto_submit', v.id, v.child_id, v.paper_id, jsonb_build_object('reason', 'late_save'));
    return jsonb_build_object('ok', false, 'status', 'submitted', 'reason', 'time_up');
  end if;
  if v.locked and now() > coalesce(v.locked_at, now()) + interval '15 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  update exam_attempts set answers = p_answers, flags = p_flags, saved_at = now(), last_seen_at = now() where id = v.id;
  return jsonb_build_object('ok', true, 'saved_at', now(), 'server_now', now());
end;
$$;

create or replace function public.exam_heartbeat(p_attempt uuid, p_client jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v exam_attempts := public.exam_own_attempt(p_attempt);
begin
  if v.status = 'in_progress' and coalesce(v.session_id, '') = public.exam_session() then
    update exam_attempts set last_seen_at = now(),
           client = case when jsonb_typeof(p_client) = 'object' and pg_column_size(p_client) < 4000 then p_client else client end
     where id = v.id;
  end if;
  return jsonb_build_object('status', v.status, 'locked', v.locked, 'deadline', v.deadline, 'server_now', now(),
                            'other_device', coalesce(v.session_id, '') <> public.exam_session());
end;
$$;

create or replace function public.exam_report_exit(p_attempt uuid, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts := public.exam_own_attempt(p_attempt);
  n int := coalesce((public.exam_paper_rules(v.paper_id) ->> 'lock_after')::int, 3);
  ev jsonb := jsonb_build_object('type', left(coalesce(p_type, 'Left the exam'), 80), 'at', now());
  last_at timestamptz := (v.violations -> -1 ->> 'at')::timestamptz;
  s int;
begin
  if v.status <> 'in_progress' or coalesce(v.session_id, '') <> public.exam_session() then
    return jsonb_build_object('locked', v.locked, 'strikes', v.strikes, 'lock_after', n);
  end if;
  if last_at is not null and last_at > now() - interval '2 seconds' then    -- one exit, several browser events
    return jsonb_build_object('locked', v.locked, 'strikes', v.strikes, 'lock_after', n);
  end if;
  perform public.exam_log('attempt.exit', v.id, v.child_id, v.paper_id, ev);
  if v.locked then
    update exam_attempts set violations = violations || ev where id = v.id;
    return jsonb_build_object('locked', true, 'strikes', v.strikes, 'lock_after', n);
  end if;
  s := v.strikes + 1;
  if s >= n then
    update exam_attempts set violations = violations || ev, strikes = 0, locked = true, locked_at = now(), lock_count = lock_count + 1 where id = v.id;
    perform public.exam_log('attempt.locked', v.id, v.child_id, v.paper_id, ev);
    return jsonb_build_object('locked', true, 'strikes', 0, 'lock_after', n);
  end if;
  update exam_attempts set violations = violations || ev, strikes = s where id = v.id;
  return jsonb_build_object('locked', false, 'strikes', s, 'lock_after', n);
end;
$$;

-- Other integrity signals from the browser (blocked paste, second screen, split screen, print attempt).
create or replace function public.exam_report_signal(p_attempt uuid, p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v exam_attempts := public.exam_own_attempt(p_attempt);
begin
  if v.status <> 'in_progress' then return; end if;
  if p_kind not in ('paste_blocked', 'copy_blocked', 'second_screen', 'split_screen', 'print_blocked', 'shortcut_blocked', 'connection_lost', 'connection_back') then return; end if;
  if (select count(*) from exam_events where attempt_id = v.id and at > now() - interval '1 minute') > 30 then return; end if;  -- rate limit
  perform public.exam_log('signal.' || p_kind, v.id, v.child_id, v.paper_id,
    case when jsonb_typeof(p_detail) = 'object' and pg_column_size(p_detail) < 2000 then p_detail else '{}'::jsonb end);
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
  if coalesce(v.session_id, '') <> public.exam_session() then
    perform public.exam_log('submit.other_device_refused', v.id, v.child_id, v.paper_id);
    return jsonb_build_object('ok', false, 'reason', 'other_device');
  end if;
  if now() <= v.deadline + make_interval(secs => g)
     and not (v.locked and now() > coalesce(v.locked_at, now()) + interval '15 seconds')
     and jsonb_typeof(p_answers) = 'object' and jsonb_typeof(p_flags) = 'object'
     and pg_column_size(p_answers) <= 400000 and pg_column_size(p_flags) <= 20000 then
    update exam_attempts set answers = p_answers, flags = p_flags, saved_at = now() where id = v.id;
  end if;
  update exam_attempts
     set status = 'submitted', submitted_at = least(now(), deadline), auto_submitted = coalesce(p_auto, false) or now() > deadline
   where id = v.id returning submitted_at into v_at;
  perform public.exam_log('attempt.submit', v.id, v.child_id, v.paper_id, jsonb_build_object('auto', coalesce(p_auto, false)));
  return jsonb_build_object('ok', true, 'submitted_at', v_at);
end;
$$;

------------------------------------------------------------------------------
-- Photos of working
------------------------------------------------------------------------------
create or replace function public.exam_my_photos(p_attempt uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'question_n', ph.question_n, 'storage_path', ph.storage_path) order by ph.created_at), '[]'::jsonb)
    from exam_photos ph join exam_attempts a on a.id = ph.attempt_id
   where a.id = p_attempt and a.child_id = public.exam_my_child_id();
$$;

create or replace function public.exam_add_photo(p_attempt uuid, p_question text, p_path text) returns public.exam_photos
language plpgsql security definer set search_path = public as $$
declare
  v exam_attempts;
  r exam_photos;
begin
  select * into v from exam_attempts where id = p_attempt and child_id = public.exam_my_child_id();
  if not found or not public.exam_upload_open(p_attempt) then raise exception 'The upload window for this paper is closed' using errcode = '42501'; end if;
  if p_path not like v.child_id::text || '/' || v.id::text || '/%' or p_path ~ '\.\.' then raise exception 'Bad photo path' using errcode = '22023'; end if;
  if (select count(*) from exam_photos where attempt_id = v.id) >= (select max_photos from exam_settings limit 1) then
    raise exception 'You have reached the photo limit for this paper' using errcode = '54000';
  end if;
  insert into exam_photos (attempt_id, question_n, storage_path) values (p_attempt, left(p_question, 10), p_path) returning * into r;
  perform public.exam_log('photo.add', v.id, v.child_id, v.paper_id, jsonb_build_object('question', r.question_n));
  return r;
end;
$$;

create or replace function public.exam_remove_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text; v_att uuid; v_child uuid; v_paper text;
begin
  select p.storage_path, p.attempt_id, a.child_id, a.paper_id into v_path, v_att, v_child, v_paper
    from exam_photos p join exam_attempts a on a.id = p.attempt_id where p.id = p_photo;
  if v_path is null or not public.exam_upload_open(v_att) then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from exam_photos where id = p_photo;
  perform public.exam_log('photo.remove', v_att, v_child, v_paper, jsonb_build_object('path', v_path));
  return v_path;
end;
$$;

------------------------------------------------------------------------------
-- Staff actions
------------------------------------------------------------------------------
create or replace function public.exam_unlock(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v exam_attempts;
begin
  select * into v from exam_attempts where id = p_attempt for update;
  if not found or not public.exam_staff_sees(v.child_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update exam_attempts
     set locked = false, locked_at = null, strikes = 0, unlock_count = unlock_count + 1,
         violations = violations || jsonb_build_object('type', 'Unlocked by teacher', 'at', now(), 'by', auth.uid())
   where id = p_attempt;
  perform public.exam_log('attempt.unlock', v.id, v.child_id, v.paper_id);
end;
$$;

create or replace function public.exam_extend_time(p_attempt uuid, p_minutes int, p_reason text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v exam_attempts; d timestamptz;
begin
  select * into v from exam_attempts where id = p_attempt for update;
  if not found or not public.exam_staff_sees(v.child_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_minutes not between 1 and 60 then raise exception 'Choose between 1 and 60 minutes' using errcode = '22023'; end if;
  if v.status <> 'in_progress' then raise exception 'This paper has already been submitted' using errcode = 'P0001'; end if;
  update exam_attempts set deadline = deadline + make_interval(mins => p_minutes) where id = p_attempt returning deadline into d;
  perform public.exam_log('attempt.extend', v.id, v.child_id, v.paper_id, jsonb_build_object('minutes', p_minutes, 'reason', left(p_reason, 200)));
  return d;
end;
$$;

create or replace function public.exam_reset_attempt(p_attempt uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v exam_attempts;
begin
  if not public.exam_is_admin() then raise exception 'Only admins can reset a sitting' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  select * into v from exam_attempts where id = p_attempt;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  perform public.exam_log('attempt.reset', v.id, v.child_id, v.paper_id,
    jsonb_build_object('reason', left(p_reason, 300), 'answers', v.answers, 'violations', v.violations, 'status', v.status));
  delete from exam_attempts where id = p_attempt;
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

-- Server-side auto-submit, now logged.
create or replace function public.exam_finalise_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    update exam_attempts a
       set status = 'submitted', submitted_at = a.deadline, auto_submitted = true
      from exam_settings s
     where a.status = 'in_progress' and now() > a.deadline + make_interval(secs => s.save_grace_seconds)
    returning a.id, a.child_id, a.paper_id
  loop
    perform public.exam_log('attempt.auto_submit', r.id, r.child_id, r.paper_id, jsonb_build_object('reason', 'time_up'));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Function permissions: internal helpers closed; the app's entry points open to signed-in users only.
revoke all on function
  public.exam_mfa_ok(), public.exam_log(text, uuid, uuid, text, jsonb), public.exam_audit(), public.exam_child_can_sit(uuid, text),
  public.exam_paper_rules(text), public.exam_my_dashboard(), public.exam_session(), public.exam_guard_session(public.exam_attempts),
  public.exam_open_attempt(uuid), public.exam_heartbeat(uuid, jsonb), public.exam_report_signal(uuid, text, jsonb),
  public.exam_my_photos(uuid), public.exam_extend_time(uuid, int, text), public.exam_reset_attempt(uuid, text)
  from public, anon;
grant execute on function
  public.exam_mfa_ok(), public.exam_my_dashboard(), public.exam_open_attempt(uuid), public.exam_heartbeat(uuid, jsonb),
  public.exam_report_signal(uuid, text, jsonb), public.exam_my_photos(uuid), public.exam_extend_time(uuid, int, text),
  public.exam_reset_attempt(uuid, text), public.exam_session()
  to authenticated;
revoke all on function public.exam_log(text, uuid, uuid, text, jsonb), public.exam_audit(), public.exam_child_can_sit(uuid, text),
  public.exam_paper_rules(text), public.exam_guard_session(public.exam_attempts) from authenticated;

------------------------------------------------------------------------------
-- Data: put the existing Maths paper in an Edexcel GCSE mock series, and create this year's six assessments.
------------------------------------------------------------------------------
insert into public.exam_series (name, kind, academic_year) values ('GCSE Mock Examinations', 'mock', '2026/27');
update public.exam_papers
   set series_id = (select id from public.exam_series where kind = 'mock' and academic_year = '2026/27' limit 1),
       year_groups = '{Year 10,Year 11}', qualification = 'GCSE', board = 'Pearson Edexcel'
 where id = '1MA1-1H';
insert into public.exam_series (name, kind, academic_year, cycle)
select 'Assessment ' || g, 'assessment', '2026/27', g from generate_series(1, 6) g;
