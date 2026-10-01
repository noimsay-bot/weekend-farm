-- 구획 심기 방식
-- layout: 여러 줄일 때 parallel(양옆 나란히) / staggered(줄끼리 엇갈려 지그재그)
-- method: plant(모종 정식) / row(줄뿌림) / hill(점뿌림) / broadcast(흩어뿌림)
alter table public.plan_bed_plantings
  add column layout text not null default 'parallel' check (layout in ('parallel', 'staggered')),
  add column method text not null default 'plant' check (method in ('plant', 'row', 'hill', 'broadcast'));

-- 직파 작물의 기본 파종 방식 (작물 백과 자료)
alter table public.crops add column sow_pattern text check (sow_pattern in ('row', 'hill', 'broadcast'));

-- 포기 수 자동 계산 (src/lib/field/beds.ts autoPlantCount와 같은 규칙). 줄뿌림·흩어뿌림은 포기 수를 세지 않는다.
create or replace function public.bed_planting_auto_count(p_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when bp.method in ('row', 'broadcast') then null
    when cr.plant_spacing_cm is null or cr.plant_spacing_cm <= 0 then null
    when b.kind = 'plot' then
      greatest(1, floor((r.x1 - r.x0) / cr.plant_spacing_cm))::int * greatest(1, floor((r.y1 - r.y0) / cr.plant_spacing_cm))::int
    else bp.rows * greatest(1, floor((case when b.h_cm >= b.w_cm then r.y1 - r.y0 else r.x1 - r.x0 end) / cr.plant_spacing_cm))::int
  end
  from public.plan_bed_plantings bp
  join public.field_beds b on b.id = bp.bed_id
  join public.crops cr on cr.id = bp.crop_id
  cross join public.bed_planting_rect(p_id) r
  where bp.id = p_id;
$$;

-- 확정: 모종 정식이면 정식, 파종 방식이면 직파로 식재를 만든다.
create or replace function public.finalize_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell_size numeric;
  v_cell record;
  v_next record;
  v_queue uuid[];
  v_current uuid;
  v_cur record;
  v_planting_id uuid;
  v_plan_crop_id uuid;
  v_assigned uuid[] := '{}';
  v_count int;
  v_bp record;
begin
  perform set_config('app.plan_edit', 'system', true);

  update public.field_plans set status = 'confirmed', confirmed_at = now() where id = p_plan_id;

  insert into public.plan_crops (plan_id, crop_id, is_companion)
  select distinct p_plan_id, crop_id, false from public.field_plan_cells
  where plan_id = p_plan_id and carry_state is distinct from 'carried_occupied'
  union
  select distinct p_plan_id, companion_crop_id, true from public.field_plan_cells
  where plan_id = p_plan_id and companion_crop_id is not null
    and carry_state is distinct from 'carried_occupied'
  on conflict do nothing;

  update public.field_plan_cells c set rotation_flag = true
  from public.plan_rotation_warnings(p_plan_id) w
  where c.plan_id = p_plan_id and c.x = w.x and c.y = w.y;

  select s.cell_size_m into v_cell_size
  from public.farm_settings s join public.field_plans p on p.farm_id = s.farm_id
  where p.id = p_plan_id;

  if exists (select 1 from public.plan_bed_plantings where plan_id = p_plan_id and carried_from_planting_id is null) then
    for v_bp in
      select bp.id, bp.crop_id, bp.plant_count, bp.method from public.plan_bed_plantings bp
      where bp.plan_id = p_plan_id and bp.carried_from_planting_id is null
      order by bp.created_at, bp.id
    loop
      insert into public.plan_crops (plan_id, crop_id, is_companion) values (p_plan_id, v_bp.crop_id, false)
      on conflict do nothing;
      select id into v_plan_crop_id from public.plan_crops
      where plan_id = p_plan_id and crop_id = v_bp.crop_id and not is_companion;

      insert into public.plantings (plan_id, plan_crop_id, crop_id, method, planned_plant_count, bed_planting_id)
      select p_plan_id, v_plan_crop_id, v_bp.crop_id,
        case when v_bp.method = 'plant' and cr.sow_method <> 'direct' then 'transplant'::public.planting_method
             else 'direct'::public.planting_method end,
        coalesce(v_bp.plant_count, public.bed_planting_auto_count(v_bp.id)), v_bp.id
      from public.crops cr where cr.id = v_bp.crop_id
      returning id into v_planting_id;

      insert into public.planting_cells (planting_id, cell_id)
      select v_planting_id, c.id
      from public.bed_planting_cells(v_bp.id, coalesce(v_cell_size, 0.5) * 100) bc
      join public.field_plan_cells c on c.plan_id = p_plan_id and c.x = bc.x and c.y = bc.y
      where c.crop_id = v_bp.crop_id and c.carry_state is distinct from 'carried_occupied'
        and not exists (select 1 from public.planting_cells pc where pc.cell_id = c.id);
    end loop;
  else
    -- 연속 영역 찾기 (flood fill). 이월된 점유 칸은 이전 식재를 그대로 쓰므로 제외.
    for v_cell in
      select id, crop_id from public.field_plan_cells
      where plan_id = p_plan_id and carry_state is distinct from 'carried_occupied'
      order by y, x
    loop
      continue when v_cell.id = any (v_assigned);

      select id into v_plan_crop_id from public.plan_crops
      where plan_id = p_plan_id and crop_id = v_cell.crop_id and not is_companion;

      insert into public.plantings (plan_id, plan_crop_id, crop_id, method)
      select p_plan_id, v_plan_crop_id, v_cell.crop_id,
        case cr.sow_method when 'direct' then 'direct'::public.planting_method
                           when 'transplant' then 'transplant'::public.planting_method end
      from public.crops cr where cr.id = v_cell.crop_id
      returning id into v_planting_id;

      v_queue := array[v_cell.id];
      v_assigned := v_assigned || v_cell.id;
      while array_length(v_queue, 1) > 0 loop
        v_current := v_queue[1];
        v_queue := v_queue[2:];
        insert into public.planting_cells (planting_id, cell_id) values (v_planting_id, v_current);
        select x, y, crop_id into v_cur from public.field_plan_cells where id = v_current;
        for v_next in
          select n.id from public.field_plan_cells n
          where n.plan_id = p_plan_id and n.crop_id = v_cur.crop_id
            and n.carry_state is distinct from 'carried_occupied'
            and abs(n.x - v_cur.x) + abs(n.y - v_cur.y) = 1
            and not (n.id = any (v_assigned))
        loop
          v_queue := v_queue || v_next.id;
          v_assigned := v_assigned || v_next.id;
        end loop;
      end loop;

      select count(*) into v_count from public.planting_cells where planting_id = v_planting_id;
      update public.plantings pl
      set planned_plant_count = public.plants_for_area(v_count * v_cell_size * v_cell_size, cr.plants_per_pyeong)
      from public.crops cr
      where pl.id = v_planting_id and cr.id = pl.crop_id;
    end loop;
  end if;

  perform set_config('app.plan_edit', '', true);
end;
$$;


-- 다음 계획으로 이월·복사할 때 심기 방식도 함께 옮긴다
create or replace function public.create_plan(
  p_farm_id uuid,
  p_year int,
  p_season public.plan_season,
  p_copy_from uuid default null,
  p_keep_plantings uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
begin
  if not public.is_farm_member(p_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;

  insert into public.field_plans (farm_id, year, season, copied_from_plan_id, created_by)
  values (p_farm_id, p_year, p_season, p_copy_from, auth.uid())
  returning id into v_plan_id;

  -- 이월 칸 (점유 유지)
  insert into public.field_plan_cells (plan_id, x, y, crop_id, carry_state, carried_from_planting_id)
  select distinct on (c.x, c.y) v_plan_id, c.x, c.y, pl.crop_id, 'carried_occupied', pl.id
  from public.plantings pl
  join public.crops cr on cr.id = pl.crop_id
  join public.planting_cells pc on pc.planting_id = pl.id
  join public.field_plan_cells c on c.id = pc.cell_id
  join public.field_plans p on p.id = pl.plan_id and p.farm_id = p_farm_id and p.status = 'confirmed'
  where pl.status = 'active'
    and public.season_order(p.year, p.season) < public.season_order(p_year, p_season)
    and (cr.season = 'perennial' or (p_season = 'spring' and pl.id = any (p_keep_plantings)))
  order by c.x, c.y, public.season_order(p.year, p.season) desc;

  -- 이월되는 식재의 구획 심기 (그림용, 잠금)
  insert into public.plan_bed_plantings (plan_id, bed_id, crop_id, rows, layout, method, start_cm, length_cm, plant_count, carried_from_planting_id)
  select v_plan_id, bp.bed_id, bp.crop_id, bp.rows, bp.layout, bp.method, bp.start_cm, bp.length_cm, coalesce(pl.plant_count, bp.plant_count), pl.id
  from public.plantings pl
  join public.plan_bed_plantings bp on bp.id = pl.bed_planting_id
  where exists (select 1 from public.field_plan_cells c where c.plan_id = v_plan_id and c.carried_from_planting_id = pl.id);

  -- 이전 계획 복사 (이월 칸과 겹치지 않는 칸만, 이월 상태는 복사하지 않음)
  if p_copy_from is not null then
    if public.plan_farm_id(p_copy_from) <> p_farm_id then
      raise exception 'plan from another farm' using errcode = '42501';
    end if;
    if exists (select 1 from public.plan_bed_plantings where plan_id = p_copy_from and carried_from_planting_id is null) then
      insert into public.plan_bed_plantings (plan_id, bed_id, crop_id, rows, layout, method, start_cm, length_cm, plant_count)
      select v_plan_id, bp.bed_id, bp.crop_id, bp.rows, bp.layout, bp.method, bp.start_cm, bp.length_cm, bp.plant_count
      from public.plan_bed_plantings bp
      join public.crops cr on cr.id = bp.crop_id and cr.status = 'confirmed'
      where bp.plan_id = p_copy_from and bp.carried_from_planting_id is null
        and not exists (
          select 1 from public.plan_bed_plantings k where k.plan_id = v_plan_id and k.bed_id = bp.bed_id
        );
      perform public.sync_plan_bed_cells(v_plan_id);
    else
      insert into public.field_plan_cells (plan_id, x, y, crop_id, companion_crop_id)
      select v_plan_id, c.x, c.y, c.crop_id, c.companion_crop_id
      from public.field_plan_cells c
      join public.crops cr on cr.id = c.crop_id and cr.status = 'confirmed'
      where c.plan_id = p_copy_from and c.carry_state is distinct from 'carried_occupied'
      on conflict (plan_id, x, y) do nothing;
    end if;
  end if;

  return v_plan_id;
end;
$$;

