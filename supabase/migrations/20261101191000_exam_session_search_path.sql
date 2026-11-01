create or replace function public.exam_session() returns text
language sql stable set search_path = '' as $$ select coalesce(auth.jwt() ->> 'session_id', ''); $$;
