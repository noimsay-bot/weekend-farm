-- 밭 구획: 칸 격자 대신 두둑·네모 밭(직사각형 구획)을 놓고, 구획 위에 작물을 몇 줄로 심는다.
-- 좌표는 밭 왼쪽 위 기준 cm. 구획 사이 빈 땅이 고랑이다.
-- 기존 field_plan_cells(위치 칸)는 연작·이력 계산용 색인으로 남기고, 구획 심기에서 자동으로 만든다(sync_plan_bed_cells).

create table public.field_beds (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  kind text not null default 'bed' check (kind in ('bed', 'plot')),  -- bed: 두둑, plot: 네모 밭
  x_cm int not null check (x_cm >= 0),
  y_cm int not null check (y_cm >= 0),
  w_cm int not null check (w_cm >= 10),
  h_cm int not null check (h_cm >= 10),
  label text,
  created_at timestamptz not null default now()
);
create index field_beds_farm_idx on public.field_beds (farm_id);

-- 작기(계획)별 구획 심기. 두둑의 긴 방향으로 start_cm부터 length_cm(null이면 끝까지) 구간을 쓴다.
create table public.plan_bed_plantings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.field_plans (id) on delete cascade,
  bed_id uuid not null references public.field_beds (id) on delete restrict,
  crop_id uuid not null references public.crops (id),
  rows int not null default 1 check (rows between 1 and 12),
  start_cm int not null default 0 check (start_cm >= 0),
  length_cm int check (length_cm is null or length_cm >= 5),
  plant_count int check (plant_count is null or plant_count >= 0),
  carried_from_planting_id uuid,                 -- 월동·여러해살이 이월분 (편집 불가)
  created_at timestamptz not null default now()
);
create index plan_bed_plantings_plan_idx on public.plan_bed_plantings (plan_id);

alter table public.plantings add column bed_planting_id uuid references public.plan_bed_plantings (id) on delete set null;

alter table public.field_beds enable row level security;
alter table public.plan_bed_plantings enable row level security;
create policy field_beds_member on public.field_beds for all to authenticated
  using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id));
create policy plan_bed_plantings_member on public.plan_bed_plantings for all to authenticated
  using (public.is_farm_member(public.plan_farm_id(plan_id))) with check (public.is_farm_member(public.plan_farm_id(plan_id)));

-- 확정된 계획의 구획 심기는 바꿀 수 없다. 확정 대기 중에 바뀌면 초안으로 되돌린다. 이월분은 잠금.
create function public.guard_plan_bed_plantings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid := coalesce(new.plan_id, old.plan_id);
  v_status public.plan_status;
begin
  if current_setting('app.plan_edit', true) = 'system' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.field_plans where id = v_plan_id;
  if v_status = 'confirmed' then
    raise exception 'plan_confirmed' using errcode = 'P0001';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.carried_from_planting_id is not null then
    raise exception 'cell_locked' using errcode = 'P0001';
  end if;
  if v_status = 'pending_approval' then
    delete from public.field_plan_approvals where plan_id = v_plan_id;
    update public.field_plans set status = 'draft' where id = v_plan_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger plan_bed_plantings_guard
  before insert or update or delete on public.plan_bed_plantings
  for each row execute function public.guard_plan_bed_plantings();

-- 구획 심기가 차지하는 직사각형 (cm). 세로 두둑(h >= w)은 y 방향, 가로 두둑은 x 방향으로 구간을 자른다.
create function public.bed_planting_rect(p_id uuid)
returns table (x0 numeric, y0 numeric, x1 numeric, y1 numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when b.h_cm >= b.w_cm then b.x_cm else b.x_cm + least(bp.start_cm, b.w_cm) end,
    case when b.h_cm >= b.w_cm then b.y_cm + least(bp.start_cm, b.h_cm) else b.y_cm end,
    case when b.h_cm >= b.w_cm then b.x_cm + b.w_cm
         else b.x_cm + least(b.w_cm, bp.start_cm + coalesce(bp.length_cm, b.w_cm)) end,
    case when b.h_cm >= b.w_cm then b.y_cm + least(b.h_cm, bp.start_cm + coalesce(bp.length_cm, b.h_cm))
         else b.y_cm + b.h_cm end
  from public.plan_bed_plantings bp join public.field_beds b on b.id = bp.bed_id
  where bp.id = p_id;
$$;

-- 구획 심기 → 위치 칸(field_plan_cells). 칸 중심이 구획 안에 있으면 그 작물 칸으로 본다.
-- 칸보다 작은 구획은 구획 중심이 있는 칸 하나를 쓴다. 겹치면 먼저 만든 심기가 칸을 가진다.
create function public.bed_planting_cells(p_id uuid, p_cell_cm numeric)
returns table (x int, y int)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (select * from public.bed_planting_rect(p_id)),
  inside as (
    select gx::int as x, gy::int as y
    from r,
      generate_series(floor(r.x0 / p_cell_cm)::int, ceil(r.x1 / p_cell_cm)::int) gx,
      generate_series(floor(r.y0 / p_cell_cm)::int, ceil(r.y1 / p_cell_cm)::int) gy
    where (gx + 0.5) * p_cell_cm >= r.x0 and (gx + 0.5) * p_cell_cm < r.x1
      and (gy + 0.5) * p_cell_cm >= r.y0 and (gy + 0.5) * p_cell_cm < r.y1
  )
  select x, y from inside
  union all
  select floor(((r.x0 + r.x1) / 2) / p_cell_cm)::int, floor(((r.y0 + r.y1) / 2) / p_cell_cm)::int
  from r where not exists (select 1 from inside);
$$;

-- 포기 수 자동 계산 (src/lib/field/beds.ts autoPlantCount와 같은 규칙): 두둑은 줄 수 × (구간 길이 / 포기 간격), 네모 밭은 가로·세로로.
create function public.bed_planting_auto_count(p_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
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

create function public.plan_cell_cm(p_plan_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.cell_size_m, 0.5) * 100
  from public.field_plans p left join public.farm_settings s on s.farm_id = p.farm_id
  where p.id = p_plan_id;
$$;

create function public.sync_plan_bed_cells(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell numeric := public.plan_cell_cm(p_plan_id);
  v_bp record;
begin
  if not public.is_farm_member(public.plan_farm_id(p_plan_id)) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  if (select status from public.field_plans where id = p_plan_id) = 'confirmed' then
    raise exception 'plan_confirmed' using errcode = 'P0001';
  end if;
  delete from public.field_plan_cells where plan_id = p_plan_id and carry_state is distinct from 'carried_occupied';
  for v_bp in
    select id, crop_id from public.plan_bed_plantings
    where plan_id = p_plan_id and carried_from_planting_id is null
    order by created_at, id
  loop
    insert into public.field_plan_cells (plan_id, x, y, crop_id)
    select p_plan_id, c.x, c.y, v_bp.crop_id from public.bed_planting_cells(v_bp.id, v_cell) c
    on conflict (plan_id, x, y) do nothing;
  end loop;
end;
$$;

-- 확정: 구획 심기가 있으면 심기 하나가 식재 하나가 된다 (포기 수는 심기의 plant_count).
-- 구획 심기가 없는 예전 계획은 기존 방식(이어진 칸 묶기)을 그대로 쓴다.
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
      select bp.id, bp.crop_id, bp.plant_count from public.plan_bed_plantings bp
      where bp.plan_id = p_plan_id and bp.carried_from_planting_id is null
      order by bp.created_at, bp.id
    loop
      insert into public.plan_crops (plan_id, crop_id, is_companion) values (p_plan_id, v_bp.crop_id, false)
      on conflict do nothing;
      select id into v_plan_crop_id from public.plan_crops
      where plan_id = p_plan_id and crop_id = v_bp.crop_id and not is_companion;

      insert into public.plantings (plan_id, plan_crop_id, crop_id, method, planned_plant_count, bed_planting_id)
      select p_plan_id, v_plan_crop_id, v_bp.crop_id,
        case cr.sow_method when 'direct' then 'direct'::public.planting_method
                           when 'transplant' then 'transplant'::public.planting_method end,
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

-- 새 계획: 이월되는 식재의 구획 심기와 이전 계획의 구획 심기도 함께 옮긴다.
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
  insert into public.plan_bed_plantings (plan_id, bed_id, crop_id, rows, start_cm, length_cm, plant_count, carried_from_planting_id)
  select v_plan_id, bp.bed_id, bp.crop_id, bp.rows, bp.start_cm, bp.length_cm, coalesce(pl.plant_count, bp.plant_count), pl.id
  from public.plantings pl
  join public.plan_bed_plantings bp on bp.id = pl.bed_planting_id
  where exists (select 1 from public.field_plan_cells c where c.plan_id = v_plan_id and c.carried_from_planting_id = pl.id);

  -- 이전 계획 복사 (이월 칸과 겹치지 않는 칸만, 이월 상태는 복사하지 않음)
  if p_copy_from is not null then
    if public.plan_farm_id(p_copy_from) <> p_farm_id then
      raise exception 'plan from another farm' using errcode = '42501';
    end if;
    if exists (select 1 from public.plan_bed_plantings where plan_id = p_copy_from and carried_from_planting_id is null) then
      insert into public.plan_bed_plantings (plan_id, bed_id, crop_id, rows, start_cm, length_cm, plant_count)
      select v_plan_id, bp.bed_id, bp.crop_id, bp.rows, bp.start_cm, bp.length_cm, bp.plant_count
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

revoke execute on function public.bed_planting_rect(uuid) from public, anon;
revoke execute on function public.bed_planting_cells(uuid, numeric) from public, anon;
revoke execute on function public.plan_cell_cm(uuid) from public, anon;
revoke execute on function public.bed_planting_auto_count(uuid) from public, anon;
revoke execute on function public.sync_plan_bed_cells(uuid) from public, anon;
grant execute on function public.sync_plan_bed_cells(uuid) to authenticated;
