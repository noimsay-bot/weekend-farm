-- 기록부터 하기: 캘린더에서 '파종/정식 + 작물'을 기록하면 식재가 생기고, 밭 그림에는 나중에 배치한다.
-- 계획을 먼저 세운 경우에는 계획에 있는(아직 안 심은) 식재에 날짜만 넣는다.

-- 날짜가 속한 작기 (src/lib/season.ts seasonOf와 같은 규칙: 3~8월 봄, 9~11월 가을, 12~2월 월동)
create function public.season_of(p_date date)
returns table (year int, season public.plan_season)
language sql
immutable
set search_path = ''
as $$
  select
    case when extract(month from p_date) <= 2 then extract(year from p_date)::int - 1 else extract(year from p_date)::int end,
    case
      when extract(month from p_date) between 3 and 8 then 'spring'::public.plan_season
      when extract(month from p_date) between 9 and 11 then 'autumn'::public.plan_season
      else 'overwinter'::public.plan_season
    end;
$$;

-- 파종·정식 기록. p_planting_id가 있으면 그 식재(계획에 있던 것)에 날짜를 넣고,
-- 없으면 그 날짜 작기의 계획에 새 식재를 만든다(밭 배치 전). 계획이 없으면 기록으로 시작한 확정 계획을 만든다.
create function public.record_planting(
  p_farm_id uuid,
  p_crop_id uuid,
  p_date date,
  p_method public.planting_method,
  p_plant_count int default null,
  p_planting_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.field_plans;
  v_year int;
  v_season public.plan_season;
  v_plan_crop_id uuid;
  v_id uuid;
begin
  if not public.is_farm_member(p_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;

  if p_planting_id is not null then
    update public.plantings pl
    set method = p_method,
        sow_date = case when p_method = 'direct' then p_date end,
        transplant_date = case when p_method = 'transplant' then p_date end,
        plant_count = coalesce(p_plant_count, pl.plant_count)
    where pl.id = p_planting_id and pl.status = 'active'
      and public.plan_farm_id(pl.plan_id) = p_farm_id
    returning pl.id into v_id;
    if v_id is null then
      raise exception 'planting not found' using errcode = 'P0002';
    end if;
    return v_id;
  end if;

  if not exists (select 1 from public.crops where id = p_crop_id and status = 'confirmed') then
    raise exception 'crop not available' using errcode = 'P0002';
  end if;

  select s.year, s.season into v_year, v_season from public.season_of(p_date) s;
  select * into v_plan from public.field_plans where farm_id = p_farm_id and year = v_year and season = v_season;
  if v_plan.id is null then
    perform set_config('app.plan_edit', 'system', true);
    insert into public.field_plans (farm_id, year, season, status, created_by, confirmed_at)
    values (p_farm_id, v_year, v_season, 'confirmed', auth.uid(), now())
    returning * into v_plan;
    perform set_config('app.plan_edit', '', true);
  elsif v_plan.status <> 'confirmed' then
    -- 짜고 있는 계획이 있으면 그 계획을 확정한 뒤 기록한다 (확정 전 계획에는 식재가 없다)
    raise exception 'plan_not_confirmed' using errcode = 'P0001';
  end if;

  insert into public.plan_crops (plan_id, crop_id, is_companion) values (v_plan.id, p_crop_id, false)
  on conflict do nothing;
  select id into v_plan_crop_id from public.plan_crops where plan_id = v_plan.id and crop_id = p_crop_id and not is_companion;

  insert into public.plantings (plan_id, plan_crop_id, crop_id, method, sow_date, transplant_date, planned_plant_count, plant_count, created_by)
  values (
    v_plan.id, v_plan_crop_id, p_crop_id, p_method,
    case when p_method = 'direct' then p_date end,
    case when p_method = 'transplant' then p_date end,
    p_plant_count, p_plant_count, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- 식재를 밭 그림의 구획에 놓는다(이미 놓였으면 옮긴다). 확정된 계획에서도 이 함수로만 바꿀 수 있다.
create function public.place_planting(
  p_planting_id uuid,
  p_bed_id uuid,
  p_rows int,
  p_layout text,
  p_method text,
  p_start_cm numeric,
  p_length_cm numeric,
  p_plant_count int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pl record;
  v_bp_id uuid;
  v_cell numeric;
begin
  select pl.id, pl.plan_id, pl.crop_id, pl.bed_planting_id, public.plan_farm_id(pl.plan_id) as farm_id
  into v_pl from public.plantings pl where pl.id = p_planting_id and pl.status = 'active';
  if v_pl.id is null then
    raise exception 'planting not found' using errcode = 'P0002';
  end if;
  if not public.is_farm_member(v_pl.farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.field_beds where id = p_bed_id and farm_id = v_pl.farm_id) then
    raise exception 'bed not found' using errcode = 'P0002';
  end if;

  perform set_config('app.plan_edit', 'system', true);

  if v_pl.bed_planting_id is not null then
    update public.plan_bed_plantings
    set bed_id = p_bed_id, rows = p_rows, layout = p_layout, method = p_method,
        start_cm = p_start_cm, length_cm = p_length_cm, plant_count = p_plant_count
    where id = v_pl.bed_planting_id
    returning id into v_bp_id;
  end if;
  if v_bp_id is null then
    insert into public.plan_bed_plantings (plan_id, bed_id, crop_id, rows, layout, method, start_cm, length_cm, plant_count)
    values (v_pl.plan_id, p_bed_id, v_pl.crop_id, p_rows, p_layout, p_method, p_start_cm, p_length_cm, p_plant_count)
    returning id into v_bp_id;
    update public.plantings set bed_planting_id = v_bp_id where id = v_pl.id;
  end if;

  -- 위치 칸(연작 판정·이력용)을 새 자리로 맞춘다. 다른 식재가 쓰는 칸은 건드리지 않는다.
  delete from public.planting_cells where planting_id = v_pl.id;
  v_cell := public.plan_cell_cm(v_pl.plan_id);
  insert into public.field_plan_cells (plan_id, x, y, crop_id)
  select v_pl.plan_id, c.x, c.y, v_pl.crop_id from public.bed_planting_cells(v_bp_id, v_cell) c
  on conflict (plan_id, x, y) do nothing;
  insert into public.planting_cells (planting_id, cell_id)
  select v_pl.id, fc.id
  from public.bed_planting_cells(v_bp_id, v_cell) c
  join public.field_plan_cells fc on fc.plan_id = v_pl.plan_id and fc.x = c.x and fc.y = c.y
  where not exists (select 1 from public.planting_cells pc where pc.cell_id = fc.id);
  -- 아무 식재도 쓰지 않는 칸은 정리
  delete from public.field_plan_cells fc
  where fc.plan_id = v_pl.plan_id and fc.carry_state is null
    and not exists (select 1 from public.planting_cells pc where pc.cell_id = fc.id)
    and exists (select 1 from public.field_plans p where p.id = fc.plan_id and p.status = 'confirmed');

  update public.plantings
  set planned_plant_count = coalesce(p_plant_count, public.bed_planting_auto_count(v_bp_id), planned_plant_count)
  where id = v_pl.id;

  perform set_config('app.plan_edit', '', true);
  return v_bp_id;
end;
$$;

revoke execute on function public.record_planting(uuid, uuid, date, public.planting_method, int, uuid) from public, anon;
revoke execute on function public.place_planting(uuid, uuid, int, text, text, numeric, numeric, int) from public, anon;
grant execute on function public.record_planting(uuid, uuid, date, public.planting_method, int, uuid) to authenticated;
grant execute on function public.place_planting(uuid, uuid, int, text, text, numeric, numeric, int) to authenticated;
