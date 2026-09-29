-- P1: 계획서 M0~M13 스키마 (M14 보류 제외)
-- 원칙
--  - 작업일·예정일은 date. timestamptz는 생성·수집 시각에만 쓴다.
--  - 작물 재배 수치는 농사로 원문에서만 채운다(P2). 모르는 값은 null로 둔다.
--  - 비료는 kg/10a 원값 저장. 화면 환산은 lib/units.ts.
--  - 작물 계열 테이블: 로그인 사용자 읽기 전용, 쓰기는 앱 관리자(app_admins)만.
--  - 농장 계열 테이블: farm_members만 읽기·쓰기.
--  - 날씨 테이블: 로그인 사용자 읽기 전용, 쓰기는 크론(service role, RLS 우회)만.

-- ─────────────────────────────── enum ───────────────────────────────

create type public.data_status as enum ('draft', 'confirmed');
create type public.sow_method as enum ('direct', 'transplant', 'both');
create type public.crop_season as enum ('spring', 'autumn', 'overwinter', 'perennial');
create type public.rotation_risk as enum ('high', 'low');
create type public.overwinter_default as enum ('keep', 'choose');
create type public.heat_tolerance as enum ('high', 'medium', 'low');
create type public.water_need as enum ('high', 'medium', 'low');
create type public.calendar_activity as enum ('sow', 'transplant', 'harvest');
create type public.fertilizer_stage as enum ('base', 'top_dressing');
create type public.prevention_basis as enum ('days_after_planting', 'calendar_by_region', 'weather');
create type public.companion_relation as enum ('good', 'bad');
create type public.plan_season as enum ('spring', 'autumn', 'overwinter');
create type public.plan_status as enum ('draft', 'pending_approval', 'confirmed');
create type public.carry_state as enum ('carried_occupied', 'released');
create type public.planting_method as enum ('direct', 'transplant');
create type public.planting_status as enum ('active', 'ended', 'replaced');
create type public.task_status as enum ('pending', 'done', 'cancelled');
-- 작업 종류: 밭만들기/파종/정식/추비/방제/물주기/가지치기/수확/기타/비(시스템 자동 기록)
create type public.work_type as enum (
  'field_prep', 'sowing', 'transplanting', 'top_dressing', 'pest_control',
  'watering', 'pruning', 'harvest', 'other', 'rain'
);
create type public.notification_type as enum (
  'task', 'sowing_window', 'seedling_start', 'pesticide_safety', 'watering', 'drainage',
  'weather_alert', 'harvest_rain', 'plan_approval', 'planting_change', 'heat_advice',
  'pest_prevention'
);

-- ─────────────────────────────── 앱 관리자 ───────────────────────────────

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- ─────────────────────────────── 작물 데이터 ───────────────────────────────

-- 과별 연작 예방조치 (농사로·농약안전사용지침)
create table public.crop_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  soil_diseases text,                     -- 주요 토양 병해 (예: 뿌리혹병)
  soil_treatment_ingredients text[],      -- 토양 처리 약제 성분
  lime_ph_guide text,                     -- 석회·산도 교정 안내
  drainage_guide text,                    -- 배수 관리 안내
  source_url text,
  status public.data_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  family_id uuid references public.crop_families (id),
  description text,
  sow_method public.sow_method,
  season public.crop_season,
  seedling_days int check (seedling_days > 0),
  -- 기후조건 (파종·정식 적정 기온)
  min_temp_c numeric(4, 1),
  max_temp_c numeric(4, 1),
  late_frost_sensitive boolean,
  days_to_harvest int check (days_to_harvest > 0),
  harvest_window_days int check (harvest_window_days >= 0),
  -- 연작
  rotation_risk public.rotation_risk,
  rest_seasons int check (rest_seasons >= 0),
  overwinter_default public.overwinter_default,
  -- 수확기 강우 회피
  harvest_avoid_rain boolean,
  rain_wait_days int check (rain_wait_days >= 0),
  rain_wait_condition text,
  schedule_tolerance_days int check (schedule_tolerance_days >= 0),
  -- 재식거리
  plant_spacing_cm numeric(6, 1) check (plant_spacing_cm > 0),
  row_spacing_cm numeric(6, 1) check (row_spacing_cm > 0),
  plants_per_pyeong numeric(6, 2) check (plants_per_pyeong > 0),
  -- 가지치기
  pruning_required boolean,
  pruning_method text,
  pruning_timing text,
  heat_tolerance public.heat_tolerance,
  -- 물주기: 간격(일) 또는 물 요구도
  watering_interval_days int check (watering_interval_days > 0),
  water_need public.water_need,
  source_url text,
  status public.data_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 지역별 관행 시기 (월·일 범위, 연도 무관)
create table public.crop_regional_calendars (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  region text not null,                   -- 예: 중부, 남부, 제주
  activity public.calendar_activity not null,
  start_month smallint not null check (start_month between 1 and 12),
  start_day smallint not null check (start_day between 1 and 31),
  end_month smallint not null check (end_month between 1 and 12),
  end_day smallint not null check (end_day between 1 and 31),
  source_url text,
  unique (crop_id, region, activity)
);

create table public.crop_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.crop_tag_map (
  crop_id uuid not null references public.crops (id) on delete cascade,
  tag_id uuid not null references public.crop_tags (id) on delete cascade,
  primary key (crop_id, tag_id)
);

-- 병해충-농약 성분
create table public.crop_pest_controls (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  pest_name text not null,
  ingredient_name text not null,
  moa_code text,                          -- 작용기작 (API에 없으면 null → 누락 리포트)
  formulation text,                       -- 제형 (액제·수화제·입제 등)
  dilution_factor int check (dilution_factor > 0),
  safe_days_before_harvest int check (safe_days_before_harvest >= 0),
  max_applications int check (max_applications > 0),
  is_organic boolean not null default false,
  source_url text
);

-- 시기별 비료 (kg/10a 원값)
create table public.crop_fertilizer_schedules (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  stage public.fertilizer_stage not null,
  sequence int not null default 1,
  days_after_planting int check (days_after_planting >= 0),
  n_kg_per_10a numeric(7, 2),
  p_kg_per_10a numeric(7, 2),
  k_kg_per_10a numeric(7, 2),
  compost_kg_per_10a numeric(8, 1),
  lime_kg_per_10a numeric(8, 1),
  note text,
  source_url text,
  unique (crop_id, stage, sequence)
);

-- 병해충별 예방 방제 시기
create table public.pest_prevention_schedules (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  pest_name text not null,
  basis public.prevention_basis not null,
  days_after_planting int check (days_after_planting >= 0),
  region text,
  start_month smallint check (start_month between 1 and 12),
  start_day smallint check (start_day between 1 and 31),
  end_month smallint check (end_month between 1 and 12),
  end_day smallint check (end_day between 1 and 31),
  weather_condition text,                 -- 예: 연속 강우 예상
  recommended_ingredients text[],
  source_text text,
  source_url text,
  check (
    (basis = 'days_after_planting' and days_after_planting is not null)
    or (basis = 'calendar_by_region' and region is not null and start_month is not null and end_month is not null)
    or (basis = 'weather' and weather_condition is not null)
  )
);

-- 작물 궁합. 쌍은 crop_a_id < crop_b_id로 정렬해 중복 없이 저장한다.
create table public.crop_companions (
  id uuid primary key default gen_random_uuid(),
  crop_a_id uuid not null references public.crops (id) on delete cascade,
  crop_b_id uuid not null references public.crops (id) on delete cascade,
  relation public.companion_relation not null,
  reason text,
  source_text text,
  source_url text,
  check (crop_a_id < crop_b_id),
  unique (crop_a_id, crop_b_id)
);

-- 필드별 추출 근거 원문과 승인 여부 (관리자 확정 절차)
create table public.crop_field_sources (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  field_name text not null,
  extracted_value text,
  source_text text,
  source_url text,
  approved boolean not null default false,
  manual_input boolean not null default false,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  unique (crop_id, field_name)
);

-- 기상특보·고온기 대응 문구 (농사로 기준)
create table public.weather_response_guides (
  id uuid primary key default gen_random_uuid(),
  situation text not null,                -- frost / cold_wave / heat_wave / typhoon / heavy_rain / high_temp
  crop_id uuid references public.crops (id) on delete cascade,
  guide_text text not null,
  source_text text,
  source_url text
);

-- 주간농사정보 수집본
create table public.weekly_farm_info (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  crop_name text not null,
  crop_id uuid references public.crops (id) on delete set null,
  pest_name text,
  summary text not null,
  source_url text,
  collected_at timestamptz not null default now()
);

create index weekly_farm_info_week_idx on public.weekly_farm_info (week_start);

-- ─────────────────────────────── 농장 설정 ───────────────────────────────

alter table public.farms add column region text;              -- GPS로 자동 판정 (P5)
alter table public.farms add column nearest_station_id text;  -- 가장 가까운 ASOS 관측소 (P5)

create table public.farm_settings (
  farm_id uuid primary key references public.farms (id) on delete cascade,
  cell_size_m numeric(4, 2) not null default 0.5 check (cell_size_m > 0),
  geofence_radius_m int not null default 200 check (geofence_radius_m > 0),
  rain_pop_threshold int not null default 60 check (rain_pop_threshold between 0 and 100),
  -- 아래 강수량 기준은 계획서상 미확정(농사로 확인 후 결정)이라 기본값을 두지 않는다.
  rain_mm_threshold numeric(5, 1) check (rain_mm_threshold >= 0),
  watering_rain_mm numeric(5, 1) check (watering_rain_mm >= 0),
  drainage_check_mm numeric(5, 1) check (drainage_check_mm >= 0),
  watering_alert_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 작업 종류별 배지 표시 시작 일수. 행이 없으면 기본 5일.
create table public.dashboard_settings (
  farm_id uuid not null references public.farms (id) on delete cascade,
  task_type public.work_type not null,
  badge_lead_days int not null default 5 check (badge_lead_days >= 0),
  primary key (farm_id, task_type)
);

-- farm_id가 null이면 공용 기본 제품
create table public.fertilizer_products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.farms (id) on delete cascade,
  name text not null,
  n_pct numeric(5, 2) not null check (n_pct between 0 and 100),
  p_pct numeric(5, 2) not null check (p_pct between 0 and 100),
  k_pct numeric(5, 2) not null check (k_pct between 0 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.farm_fertilizer_settings (
  farm_id uuid not null references public.farms (id) on delete cascade,
  usage public.fertilizer_stage not null,
  product_id uuid not null references public.fertilizer_products (id) on delete cascade,
  primary key (farm_id, usage)
);

-- 품종. farm_id가 null이면 공용 시드(부록 A), 아니면 농장이 추가한 품종.
-- override 값이 null이면 작물 값을 쓴다 (crop_variety_values view).
create table public.crop_varieties (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops (id) on delete cascade,
  farm_id uuid references public.farms (id) on delete cascade,
  name text not null,
  days_to_harvest int check (days_to_harvest > 0),
  harvest_window_days int check (harvest_window_days >= 0),
  plant_spacing_cm numeric(6, 1) check (plant_spacing_cm > 0),
  row_spacing_cm numeric(6, 1) check (row_spacing_cm > 0),
  plants_per_pyeong numeric(6, 2) check (plants_per_pyeong > 0),
  memo text,
  value_source text not null default 'user' check (value_source in ('user', 'nongsaro')),
  source_text text,
  source_url text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (crop_id, farm_id, name)
);

-- ─────────────────────────────── 계획 ───────────────────────────────

create table public.field_plans (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  season public.plan_season not null,
  status public.plan_status not null default 'draft',
  copied_from_plan_id uuid references public.field_plans (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (farm_id, year, season)
);

create table public.field_plan_approvals (
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  approved_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create table public.field_plan_cells (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  x int not null check (x >= 0),
  y int not null check (y >= 0),
  crop_id uuid not null references public.crops (id),
  companion_crop_id uuid references public.crops (id),
  carry_state public.carry_state,
  -- 월동·여러해살이 이월 시 원래 식재 (수확·종료 시 잠금 해제 판단)
  carried_from_planting_id uuid,
  check (companion_crop_id is null or companion_crop_id <> crop_id),
  unique (plan_id, x, y)
);

-- 확정 계획 × 작물. 기록·히스토리 단위.
create table public.plan_crops (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  crop_id uuid not null references public.crops (id),
  is_companion boolean not null default false,
  created_at timestamptz not null default now(),
  unique (plan_id, crop_id, is_companion)
);

-- ─────────────────────────────── 식재·일정 ───────────────────────────────

create table public.plantings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  plan_crop_id uuid not null references public.plan_crops (id) on delete cascade,
  crop_id uuid not null references public.crops (id),
  variety_id uuid references public.crop_varieties (id) on delete set null,
  method public.planting_method,
  sow_date date,
  transplant_date date,
  status public.planting_status not null default 'active',
  planned_plant_count int check (planned_plant_count >= 0),
  plant_count int check (plant_count >= 0),
  ended_on date,
  replaced_by_planting_id uuid references public.plantings (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.field_plan_cells
  add constraint field_plan_cells_carried_from_fkey
  foreign key (carried_from_planting_id) references public.plantings (id) on delete set null;

-- 식재 영역 (칸 묶음)
create table public.planting_cells (
  planting_id uuid not null references public.plantings (id) on delete cascade,
  cell_id uuid not null references public.field_plan_cells (id) on delete cascade,
  primary key (planting_id, cell_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  planting_id uuid references public.plantings (id) on delete cascade,
  plan_crop_id uuid references public.plan_crops (id) on delete cascade,
  task_type public.work_type not null,
  title text not null,
  calculated_date date not null,
  adjusted_date date,
  status public.task_status not null default 'pending',
  details jsonb not null default '{}',            -- 비료량, 연작 예방조치 체크 항목 등
  recommendation jsonb,                           -- 수확기 강우 회피 권장안 등
  source_url text,
  done_work_log_id uuid,
  created_at timestamptz not null default now()
);

create index tasks_farm_date_idx on public.tasks (farm_id, calculated_date);

-- ─────────────────────────────── 작업 기록 ───────────────────────────────

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  work_date date not null,
  work_type public.work_type not null,
  memo text,
  rain_mm numeric(5, 1) check (rain_mm >= 0),     -- 비 자동 기록의 강수량
  is_auto boolean not null default false,
  created_by uuid references auth.users (id),     -- 자동 기록은 null
  created_at timestamptz not null default now(),
  check (work_type <> 'rain' or rain_mm is not null)
);

create index work_logs_farm_date_idx on public.work_logs (farm_id, work_date);

alter table public.tasks
  add constraint tasks_done_work_log_fkey
  foreign key (done_work_log_id) references public.work_logs (id) on delete set null;

create table public.work_log_targets (
  work_log_id uuid not null references public.work_logs (id) on delete cascade,
  plan_crop_id uuid not null references public.plan_crops (id) on delete cascade,
  primary key (work_log_id, plan_crop_id)
);

create table public.work_log_photos (
  id uuid primary key default gen_random_uuid(),
  work_log_id uuid not null references public.work_logs (id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table public.work_log_pesticides (
  work_log_id uuid not null references public.work_logs (id) on delete cascade,
  pest_control_id uuid not null references public.crop_pest_controls (id),
  primary key (work_log_id, pest_control_id)
);

-- 작기 결산 (plan_crops별)
create table public.season_summaries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  plan_crop_id uuid not null unique references public.plan_crops (id) on delete cascade,
  summary jsonb not null,
  representative_photo_id uuid references public.work_log_photos (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── 알림 ───────────────────────────────

-- 발송 대기 알림 이벤트 (확정 요청, 적기 확정, 식재 종료·교체 등). 발송은 P6 크론.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete cascade,  -- null이면 농장 멤버 전체
  type public.notification_type not null,
  payload jsonb not null default '{}',
  immediate boolean not null default false,        -- 기상특보·배수점검만 즉시 발송
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_events_unsent_idx on public.notification_events (created_at) where sent_at is null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- 행이 없으면 켜짐으로 본다.
create table public.notification_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.notification_type not null,
  enabled boolean not null,
  primary key (user_id, type)
);

-- ─────────────────────────────── 날씨 ───────────────────────────────

-- 단기예보 (기상청 격자 nx, ny)
create table public.weather_cache (
  nx int not null,
  ny int not null,
  fcst_date date not null,
  fcst_hour smallint not null check (fcst_hour between 0 and 23),
  pop smallint check (pop between 0 and 100),     -- 강수확률 %
  pcp_mm numeric(5, 1) check (pcp_mm >= 0),        -- 예상 강수량
  tmp_c numeric(4, 1),
  fetched_at timestamptz not null default now(),
  primary key (nx, ny, fcst_date, fcst_hour)
);

create table public.weather_alerts (
  id uuid primary key default gen_random_uuid(),
  region_code text not null,
  alert_type text not null,                       -- 한파, 폭염, 태풍, 호우, 서리 등
  level text,                                     -- 주의보, 경보
  announced_at timestamptz not null,
  effective_from timestamptz,
  effective_to timestamptz,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  unique (region_code, alert_type, announced_at)
);

-- ASOS 일자료
create table public.weather_observations (
  station_id text not null,
  obs_date date not null,
  rain_mm numeric(5, 1),
  min_temp_c numeric(4, 1),
  max_temp_c numeric(4, 1),
  fetched_at timestamptz not null default now(),
  primary key (station_id, obs_date)
);

-- ─────────────────────────────── 조회 view ───────────────────────────────

-- 품종 override가 null이면 작물 값을 쓴다. *_from_variety는 "사용자 입력" 표시용.
create view public.crop_variety_values
with (security_invoker = true)
as
select
  v.id as variety_id,
  v.crop_id,
  v.farm_id,
  v.name,
  v.memo,
  v.value_source,
  coalesce(v.days_to_harvest, c.days_to_harvest) as days_to_harvest,
  v.days_to_harvest is not null as days_to_harvest_from_variety,
  coalesce(v.harvest_window_days, c.harvest_window_days) as harvest_window_days,
  v.harvest_window_days is not null as harvest_window_days_from_variety,
  coalesce(v.plant_spacing_cm, c.plant_spacing_cm) as plant_spacing_cm,
  v.plant_spacing_cm is not null as plant_spacing_cm_from_variety,
  coalesce(v.row_spacing_cm, c.row_spacing_cm) as row_spacing_cm,
  v.row_spacing_cm is not null as row_spacing_cm_from_variety,
  coalesce(v.plants_per_pyeong, c.plants_per_pyeong) as plants_per_pyeong,
  v.plants_per_pyeong is not null as plants_per_pyeong_from_variety
from public.crop_varieties v
join public.crops c on c.id = v.crop_id;

-- ─────────────────────────────── RLS 헬퍼 ───────────────────────────────

create function public.plan_farm_id(p_plan_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select farm_id from public.field_plans where id = p_plan_id;
$$;

create function public.work_log_farm_id(p_work_log_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select farm_id from public.work_logs where id = p_work_log_id;
$$;

create function public.planting_farm_id(p_planting_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.farm_id from public.plantings pl join public.field_plans p on p.id = pl.plan_id
  where pl.id = p_planting_id;
$$;

-- ─────────────────────────────── RLS ───────────────────────────────

-- 작물 계열: 로그인 사용자 읽기(crops·crop_families는 confirmed만, 관리자는 전부), 쓰기 관리자
do $$
declare
  t text;
begin
  foreach t in array array[
    'crop_regional_calendars', 'crop_tags', 'crop_tag_map', 'crop_pest_controls',
    'crop_fertilizer_schedules', 'pest_prevention_schedules', 'crop_companions',
    'weather_response_guides', 'weekly_farm_info'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin())',
      t || '_admin_write', t
    );
  end loop;

  foreach t in array array['crops', 'crop_families'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (status = ''confirmed'' or public.is_app_admin())',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin())',
      t || '_admin_write', t
    );
  end loop;

  -- 날씨: 읽기만. 쓰기는 service role(RLS 우회)
  foreach t in array array['weather_cache', 'weather_alerts', 'weather_observations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select', t
    );
  end loop;

  -- farm_id를 직접 가진 농장 테이블: 멤버 전체 권한
  foreach t in array array[
    'farm_settings', 'dashboard_settings', 'farm_fertilizer_settings', 'field_plans',
    'tasks', 'work_logs', 'notification_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id))',
      t || '_member', t
    );
  end loop;

  -- 계획 하위 테이블
  foreach t in array array[
    'field_plan_approvals', 'field_plan_cells', 'plan_crops', 'plantings', 'season_summaries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_farm_member(public.plan_farm_id(plan_id))) with check (public.is_farm_member(public.plan_farm_id(plan_id)))',
      t || '_member', t
    );
  end loop;

  -- 작업 기록 하위 테이블
  foreach t in array array['work_log_targets', 'work_log_photos', 'work_log_pesticides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_farm_member(public.work_log_farm_id(work_log_id))) with check (public.is_farm_member(public.work_log_farm_id(work_log_id)))',
      t || '_member', t
    );
  end loop;
end;
$$;

alter table public.app_admins enable row level security;
create policy app_admins_select on public.app_admins
  for select to authenticated using (user_id = auth.uid());

alter table public.crop_field_sources enable row level security;
create policy crop_field_sources_admin on public.crop_field_sources
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

alter table public.planting_cells enable row level security;
create policy planting_cells_member on public.planting_cells
  for all to authenticated
  using (public.is_farm_member(public.planting_farm_id(planting_id)))
  with check (public.is_farm_member(public.planting_farm_id(planting_id)));

-- 공용 기본 제품은 모두 읽기, 농장 제품은 멤버만
alter table public.fertilizer_products enable row level security;
create policy fertilizer_products_select on public.fertilizer_products
  for select to authenticated using (farm_id is null or public.is_farm_member(farm_id));
create policy fertilizer_products_farm_write on public.fertilizer_products
  for all to authenticated
  using (farm_id is not null and public.is_farm_member(farm_id))
  with check (farm_id is not null and public.is_farm_member(farm_id));
create policy fertilizer_products_admin_write on public.fertilizer_products
  for all to authenticated
  using (farm_id is null and public.is_app_admin())
  with check (farm_id is null and public.is_app_admin());

-- 공용 품종 시드는 모두 읽기·관리자 쓰기, 농장 품종은 멤버
alter table public.crop_varieties enable row level security;
create policy crop_varieties_select on public.crop_varieties
  for select to authenticated using (farm_id is null or public.is_farm_member(farm_id));
create policy crop_varieties_farm_write on public.crop_varieties
  for all to authenticated
  using (farm_id is not null and public.is_farm_member(farm_id))
  with check (farm_id is not null and public.is_farm_member(farm_id));
create policy crop_varieties_admin_write on public.crop_varieties
  for all to authenticated
  using (farm_id is null and public.is_app_admin())
  with check (farm_id is null and public.is_app_admin());

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.notification_settings enable row level security;
create policy notification_settings_own on public.notification_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke execute on function public.is_app_admin() from public, anon;
revoke execute on function public.plan_farm_id(uuid) from public, anon;
revoke execute on function public.work_log_farm_id(uuid) from public, anon;
revoke execute on function public.planting_farm_id(uuid) from public, anon;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.plan_farm_id(uuid) to authenticated;
grant execute on function public.work_log_farm_id(uuid) to authenticated;
grant execute on function public.planting_farm_id(uuid) to authenticated;

-- ─────────────────────────────── 트리거 ───────────────────────────────

-- 농장 생성 시 설정 행을 기본값으로 만든다.
create function public.create_farm_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.farm_settings (farm_id) values (new.id);
  return new;
end;
$$;

create trigger farms_create_settings
  after insert on public.farms
  for each row execute function public.create_farm_settings();

insert into public.farm_settings (farm_id)
select id from public.farms
on conflict (farm_id) do nothing;

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger crops_touch before update on public.crops
  for each row execute function public.touch_updated_at();
create trigger crop_families_touch before update on public.crop_families
  for each row execute function public.touch_updated_at();
create trigger farm_settings_touch before update on public.farm_settings
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────── 시드 ───────────────────────────────

-- 기본 비료 제품 (제품 라벨 기준 성분비)
insert into public.fertilizer_products (farm_id, name, n_pct, p_pct, k_pct, is_default) values
  (null, '요소', 46, 0, 0, true),
  (null, '복합비료', 21, 17, 17, true);
