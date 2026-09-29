-- P3: 계획 생성·공동 확정·월동 이월·연작 판정·확정 후 변경

-- 연작으로 확정된 칸 표시 (P4 밭만들기 작업에 예방조치 체크 항목 추가용)
alter table public.field_plan_cells add column rotation_flag boolean not null default false;

-- 작기 순서: 같은 해 봄 → 가을 → 월동
create function public.season_order(p_year int, p_season public.plan_season)
returns int
language sql
immutable
as $$
  select p_year * 3 + case p_season when 'spring' then 0 when 'autumn' then 1 else 2 end;
$$;

-- 평당 표준 포기 수로 계획 포기 수 계산 (lib/units.ts plantsForArea와 같은 식)
create function public.plants_for_area(p_area_m2 numeric, p_plants_per_pyeong numeric)
returns int
language sql
immutable
as $$
  select case when p_plants_per_pyeong is null then null
    else round(p_area_m2 / 3.3058 * p_plants_per_pyeong)::int end;
$$;

-- ───────────── 편집 잠금 ─────────────
-- 확정된 계획의 칸은 식재 종료·교체 함수만 바꿀 수 있다 (app.plan_edit = 'system').
-- 확정 대기 중에 칸이 바뀌면 받은 확정을 모두 지우고 초안으로 되돌린다.
-- 점유 유지(carried_occupied) 칸은 해제 전까지 바꿀 수 없다.
create function public.guard_plan_cells()
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
    raise exception 'plan_confirmed' using errcode = 'P0001',
      hint = '확정된 계획은 식재 종료·교체로만 바꿀 수 있어요';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.carry_state = 'carried_occupied' then
    raise exception 'cell_locked' using errcode = 'P0001';
  end if;

  if v_status = 'pending_approval' then
    delete from public.field_plan_approvals where plan_id = v_plan_id;
    update public.field_plans set status = 'draft' where id = v_plan_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger field_plan_cells_guard
  before insert or update or delete on public.field_plan_cells
  for each row execute function public.guard_plan_cells();

-- ───────────── 연작 판정 ─────────────
-- 칸마다 직전 rest_seasons개 작기의 확정 계획에서 같은 과(rotation_risk=high)가 있었는지.
-- 과거 작물은 칸의 주작물과, 그 칸에서 교체·종료된 식재의 작물을 모두 본다. 사이작물은 제외.
create function public.plan_rotation_warnings(p_plan_id uuid)
returns table (
  x int,
  y int,
  crop_id uuid,
  family_id uuid,
  prev_plan_id uuid,
  prev_year int,
  prev_season public.plan_season,
  prev_crop_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with plan as (
    select id, farm_id, public.season_order(year, season) as ord
    from public.field_plans where id = p_plan_id
  ),
  cur as (
    select c.x, c.y, c.crop_id, cr.family_id, cr.rest_seasons
    from public.field_plan_cells c
    join public.crops cr on cr.id = c.crop_id
    where c.plan_id = p_plan_id
      and cr.rotation_risk = 'high' and cr.family_id is not null and coalesce(cr.rest_seasons, 0) > 0
      and c.carry_state is distinct from 'carried_occupied'
  ),
  history as (
    select p.id as plan_id, p.year, p.season, public.season_order(p.year, p.season) as ord,
           hc.x, hc.y, hc.crop_id
    from public.field_plans p
    join plan on p.farm_id = plan.farm_id and public.season_order(p.year, p.season) < plan.ord
    join lateral (
      select c.x, c.y, c.crop_id from public.field_plan_cells c where c.plan_id = p.id
      union
      select c.x, c.y, pl.crop_id
      from public.field_plan_cells c
      join public.planting_cells pc on pc.cell_id = c.id
      join public.plantings pl on pl.id = pc.planting_id
      where c.plan_id = p.id
    ) hc on true
    where p.status = 'confirmed'
  )
  select distinct on (cur.x, cur.y, h.plan_id)
    cur.x, cur.y, cur.crop_id, cur.family_id, h.plan_id, h.year, h.season, h.crop_id
  from cur
  cross join plan
  join history h on h.x = cur.x and h.y = cur.y
  join public.crops hcr on hcr.id = h.crop_id and hcr.family_id = cur.family_id
  where h.ord >= plan.ord - cur.rest_seasons
  order by cur.x, cur.y, h.plan_id;
$$;

-- ───────────── 확정 처리 ─────────────
-- 계획 작물(plan_crops), 같은 작물 연속 영역(상하좌우) 식재(plantings)와 계획 포기 수, 연작 플래그를 만든다.
create function public.finalize_plan(p_plan_id uuid)
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

  perform set_config('app.plan_edit', '', true);
end;
$$;

-- 확정 요청: 멤버가 1명이면 즉시 확정, 아니면 요청자 확정을 남기고 다른 멤버에게 알림 이벤트.
create function public.request_plan_confirmation(p_plan_id uuid)
returns public.plan_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid := public.plan_farm_id(p_plan_id);
  v_status public.plan_status;
  v_members int;
begin
  if not public.is_farm_member(v_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  select status into v_status from public.field_plans where id = p_plan_id for update;
  if v_status <> 'draft' then
    raise exception 'plan_not_draft' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.field_plan_cells where plan_id = p_plan_id) then
    raise exception 'plan_empty' using errcode = 'P0001';
  end if;

  select count(*) into v_members from public.farm_members where farm_id = v_farm_id;
  if v_members <= 1 then
    perform public.finalize_plan(p_plan_id);
    return 'confirmed';
  end if;

  update public.field_plans set status = 'pending_approval' where id = p_plan_id;
  insert into public.field_plan_approvals (plan_id, user_id) values (p_plan_id, auth.uid());
  insert into public.notification_events (farm_id, recipient_id, type, payload)
  select v_farm_id, m.user_id, 'plan_approval', jsonb_build_object('plan_id', p_plan_id, 'requested_by', auth.uid())
  from public.farm_members m
  where m.farm_id = v_farm_id and m.user_id <> auth.uid();
  return 'pending_approval';
end;
$$;

-- 멤버 확정: 모든 멤버가 확정하면 confirmed.
create function public.approve_plan(p_plan_id uuid)
returns public.plan_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid := public.plan_farm_id(p_plan_id);
  v_status public.plan_status;
begin
  if not public.is_farm_member(v_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  select status into v_status from public.field_plans where id = p_plan_id for update;
  if v_status <> 'pending_approval' then
    raise exception 'plan_not_pending' using errcode = 'P0001';
  end if;

  insert into public.field_plan_approvals (plan_id, user_id) values (p_plan_id, auth.uid())
  on conflict do nothing;

  if not exists (
    select 1 from public.farm_members m
    where m.farm_id = v_farm_id
      and not exists (select 1 from public.field_plan_approvals a where a.plan_id = p_plan_id and a.user_id = m.user_id)
  ) then
    perform public.finalize_plan(p_plan_id);
    return 'confirmed';
  end if;
  return 'pending_approval';
end;
$$;

-- ───────────── 계획 생성 (복사·월동 이월) ─────────────
-- 새 봄 계획에 이월할 후보: 직전 가을·월동 확정 계획의 월동·여러해살이 작물 중 재배 중인 식재.
create function public.carry_over_candidates(p_farm_id uuid, p_year int)
returns table (
  planting_id uuid,
  crop_id uuid,
  crop_name text,
  season public.crop_season,
  overwinter_default public.overwinter_default,
  cells jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pl.id, pl.crop_id, cr.name, cr.season, cr.overwinter_default,
         jsonb_agg(jsonb_build_object('x', c.x, 'y', c.y) order by c.y, c.x)
  from public.field_plans p
  join public.plantings pl on pl.plan_id = p.id and pl.status = 'active'
  join public.crops cr on cr.id = pl.crop_id and cr.season in ('overwinter', 'perennial')
  join public.planting_cells pc on pc.planting_id = pl.id
  join public.field_plan_cells c on c.id = pc.cell_id
  where p.farm_id = p_farm_id and p.status = 'confirmed'
    and ((p.year = p_year - 1 and p.season in ('autumn', 'overwinter'))
         -- 여러해살이는 가장 최근 계획에서 계속 이어진다
         or (cr.season = 'perennial' and public.season_order(p.year, p.season) < public.season_order(p_year, 'spring')))
  group by pl.id, pl.crop_id, cr.name, cr.season, cr.overwinter_default;
$$;

-- 계획 생성. p_copy_from: 이전 계획 복사. p_keep_plantings: 점유 유지로 이월할 식재 id.
-- 여러해살이 식재는 선택과 무관하게 항상 이월한다 (봄 계획이 아니어도).
create function public.create_plan(
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

  -- 이전 계획 복사 (이월 칸과 겹치지 않는 칸만, 이월 상태는 복사하지 않음)
  if p_copy_from is not null then
    if public.plan_farm_id(p_copy_from) <> p_farm_id then
      raise exception 'plan from another farm' using errcode = '42501';
    end if;
    insert into public.field_plan_cells (plan_id, x, y, crop_id, companion_crop_id)
    select v_plan_id, c.x, c.y, c.crop_id, c.companion_crop_id
    from public.field_plan_cells c
    join public.crops cr on cr.id = c.crop_id and cr.status = 'confirmed'
    where c.plan_id = p_copy_from and c.carry_state is distinct from 'carried_occupied'
    on conflict (plan_id, x, y) do nothing;
  end if;

  return v_plan_id;
end;
$$;

-- ───────────── 잠금 해제 ─────────────
-- 월동 이월 칸은 수확 기록이 입력되면, 여러해살이 칸은 식재 종료 시에만 해제한다.
create function public.release_carried_cells(p_planting_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.plan_edit', 'system', true);
  update public.field_plan_cells c
  set carry_state = 'released'
  from public.plantings pl
  join public.crops cr on cr.id = pl.crop_id
  where c.carried_from_planting_id = p_planting_id
    and pl.id = p_planting_id
    and c.carry_state = 'carried_occupied'
    and (p_reason = 'ended' or cr.season <> 'perennial');
  perform set_config('app.plan_edit', '', true);
end;
$$;

create function public.on_harvest_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_planting uuid;
begin
  if (select work_type from public.work_logs where id = new.work_log_id) <> 'harvest' then
    return new;
  end if;
  for v_planting in select id from public.plantings where plan_crop_id = new.plan_crop_id loop
    perform public.release_carried_cells(v_planting, 'harvest');
  end loop;
  return new;
end;
$$;

create trigger work_log_targets_release_on_harvest
  after insert on public.work_log_targets
  for each row execute function public.on_harvest_logged();

-- ───────────── 확정 후 작기 중 변경 (멤버 단독) ─────────────
create function public.end_planting(p_planting_id uuid, p_ended_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid := public.planting_farm_id(p_planting_id);
begin
  if not public.is_farm_member(v_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  update public.plantings set status = 'ended', ended_on = p_ended_on where id = p_planting_id and status = 'active';
  if not found then
    raise exception 'planting_not_active' using errcode = 'P0001';
  end if;
  update public.tasks set status = 'cancelled' where planting_id = p_planting_id and status = 'pending';
  perform public.release_carried_cells(p_planting_id, 'ended');
  insert into public.notification_events (farm_id, recipient_id, type, payload)
  select v_farm_id, m.user_id, 'planting_change',
         jsonb_build_object('action', 'ended', 'planting_id', p_planting_id, 'by', auth.uid())
  from public.farm_members m where m.farm_id = v_farm_id and m.user_id <> auth.uid();
end;
$$;

-- 작물 교체: 기존 식재는 replaced로 남아 연작 이력에 반영되고, 같은 칸에 새 식재를 만든다.
create function public.replace_planting(p_planting_id uuid, p_new_crop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid := public.planting_farm_id(p_planting_id);
  v_old public.plantings%rowtype;
  v_plan_crop_id uuid;
  v_new_id uuid;
  v_cell_size numeric;
  v_count int;
begin
  if not public.is_farm_member(v_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  select * into v_old from public.plantings where id = p_planting_id and status = 'active' for update;
  if not found then
    raise exception 'planting_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.crops where id = p_new_crop_id and status = 'confirmed') then
    raise exception 'crop_not_available' using errcode = 'P0001';
  end if;

  perform set_config('app.plan_edit', 'system', true);

  insert into public.plan_crops (plan_id, crop_id, is_companion)
  values (v_old.plan_id, p_new_crop_id, false)
  on conflict (plan_id, crop_id, is_companion) do nothing;
  select id into v_plan_crop_id from public.plan_crops
  where plan_id = v_old.plan_id and crop_id = p_new_crop_id and not is_companion;

  select count(*) into v_count from public.planting_cells where planting_id = p_planting_id;
  select s.cell_size_m into v_cell_size from public.farm_settings s where s.farm_id = v_farm_id;

  insert into public.plantings (plan_id, plan_crop_id, crop_id, method, planned_plant_count, created_by)
  select v_old.plan_id, v_plan_crop_id, cr.id,
    case cr.sow_method when 'direct' then 'direct'::public.planting_method
                       when 'transplant' then 'transplant'::public.planting_method end,
    public.plants_for_area(v_count * v_cell_size * v_cell_size, cr.plants_per_pyeong),
    auth.uid()
  from public.crops cr where cr.id = p_new_crop_id
  returning id into v_new_id;

  insert into public.planting_cells (planting_id, cell_id)
  select v_new_id, cell_id from public.planting_cells where planting_id = p_planting_id;

  update public.field_plan_cells c set crop_id = p_new_crop_id
  from public.planting_cells pc where pc.planting_id = p_planting_id and pc.cell_id = c.id;

  update public.plantings
  set status = 'replaced', ended_on = (now() at time zone 'Asia/Seoul')::date, replaced_by_planting_id = v_new_id
  where id = p_planting_id;
  update public.tasks set status = 'cancelled' where planting_id = p_planting_id and status = 'pending';

  perform set_config('app.plan_edit', '', true);

  insert into public.notification_events (farm_id, recipient_id, type, payload)
  select v_farm_id, m.user_id, 'planting_change',
         jsonb_build_object('action', 'replaced', 'planting_id', p_planting_id, 'new_planting_id', v_new_id, 'by', auth.uid())
  from public.farm_members m where m.farm_id = v_farm_id and m.user_id <> auth.uid();
  return v_new_id;
end;
$$;

-- field_plans 직접 insert/update로 상태를 바꾸지 못하게: 상태 전이는 함수로만.
create function public.guard_plan_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and current_user in ('authenticated', 'anon') then
    raise exception 'use plan functions to change status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger field_plans_guard_status
  before update on public.field_plans
  for each row execute function public.guard_plan_status();

create function public.guard_plan_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'draft' and current_user in ('authenticated', 'anon') then
    raise exception 'new plans start as draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger field_plans_guard_insert
  before insert on public.field_plans
  for each row execute function public.guard_plan_insert();

revoke execute on function public.finalize_plan(uuid) from public, anon, authenticated;
revoke execute on function public.release_carried_cells(uuid, text) from public, anon, authenticated;
revoke execute on function public.request_plan_confirmation(uuid) from public, anon;
revoke execute on function public.approve_plan(uuid) from public, anon;
revoke execute on function public.create_plan(uuid, int, public.plan_season, uuid, uuid[]) from public, anon;
revoke execute on function public.end_planting(uuid, date) from public, anon;
revoke execute on function public.replace_planting(uuid, uuid) from public, anon;
grant execute on function public.request_plan_confirmation(uuid) to authenticated;
grant execute on function public.approve_plan(uuid) to authenticated;
grant execute on function public.create_plan(uuid, int, public.plan_season, uuid, uuid[]) to authenticated;
grant execute on function public.end_planting(uuid, date) to authenticated;
grant execute on function public.replace_planting(uuid, uuid) to authenticated;
grant execute on function public.plan_rotation_warnings(uuid) to authenticated;
grant execute on function public.carry_over_candidates(uuid, int) to authenticated;
