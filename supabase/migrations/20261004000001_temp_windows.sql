-- 파종·정식 시기 기준을 날짜가 아니라 일평균기온으로 둔다. 날짜(crop_regional_calendars)는 관행 참고치.
-- 가을 작형은 기온이 내려가며(falling) from_c → to_c 구간, 봄 작형은 올라가며(rising) from_c → to_c 구간에 심는다.
-- basis: source(출처가 기온을 직접 말함) / normal(출처의 관행 날짜를 평년 일평균기온으로 환산)
create table public.crop_temp_windows (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  cropping_type text not null default '',
  activity public.calendar_activity not null check (activity in ('sow', 'transplant')),
  trend text not null check (trend in ('falling', 'rising')),
  from_c numeric(4, 1) not null,
  to_c numeric(4, 1) not null,
  basis text not null check (basis in ('source', 'normal')),
  note text,
  source_url text,
  sort int not null default 0,
  check ((trend = 'falling' and from_c > to_c) or (trend = 'rising' and from_c < to_c))
);
create index crop_temp_windows_crop_idx on public.crop_temp_windows (crop_id);

alter table public.crop_temp_windows enable row level security;
create policy crop_temp_windows_read on public.crop_temp_windows for select to authenticated
  using (exists (select 1 from public.crops c where c.id = crop_id and (c.status = 'confirmed' or public.is_app_admin())));
create policy crop_temp_windows_admin on public.crop_temp_windows for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

-- 재배법: 핵심 몇 줄(summary)만 먼저 보이고 본문(body)은 '더보기'
alter table public.crop_guides add column summary text[];

-- 적기 판정에 '늦음'(일평균기온이 구간을 지남) 추가
alter table public.plantings drop constraint plantings_window_stage_check;
alter table public.plantings add constraint plantings_window_stage_check
  check (window_stage in ('planned', 'waiting', 'confirmed', 'late'));
