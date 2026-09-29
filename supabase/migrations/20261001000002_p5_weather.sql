-- P5: 적기 판정 상태 (크론이 매일 갱신)
alter table public.plantings add column window_stage text
  check (window_stage in ('planned', 'waiting', 'confirmed'));
alter table public.plantings add column window_date date;
alter table public.plantings add column seedling_notified_on date;

-- 특보 동작(발표/해제/변경)
alter table public.weather_alerts add column action text;
