-- 밭 대시보드 실시간 반영: 다른 멤버가 작업을 완료·미루거나 기록을 남기면 바로 다시 불러온다.
-- Realtime의 postgres_changes는 RLS를 따르므로 농장 멤버에게만 변경이 전달된다.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_logs') then
    alter publication supabase_realtime add table public.work_logs;
  end if;
end
$$;
