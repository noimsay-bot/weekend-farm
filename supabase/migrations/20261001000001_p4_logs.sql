-- P4: 시차 파종 분할, 예정 작업 완료 → 작업 기록, 사진 저장소

-- 식재 영역을 여러 식재로 나눈다. p_parts: 칸 id 배열의 배열. 첫 묶음은 원래 식재에 남는다.
create function public.split_planting(p_planting_id uuid, p_parts jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid := public.planting_farm_id(p_planting_id);
  v_old public.plantings%rowtype;
  v_part jsonb;
  v_new uuid;
  v_ids uuid[] := array[p_planting_id];
  v_cell_size numeric;
  i int := 0;
begin
  if not public.is_farm_member(v_farm_id) then
    raise exception 'not a farm member' using errcode = '42501';
  end if;
  select * into v_old from public.plantings where id = p_planting_id and status = 'active' for update;
  if not found then
    raise exception 'planting_not_active' using errcode = 'P0001';
  end if;
  select cell_size_m into v_cell_size from public.farm_settings where farm_id = v_farm_id;

  for v_part in select * from jsonb_array_elements(p_parts) loop
    i := i + 1;
    continue when i = 1;
    insert into public.plantings (plan_id, plan_crop_id, crop_id, variety_id, method, created_by)
    values (v_old.plan_id, v_old.plan_crop_id, v_old.crop_id, v_old.variety_id, v_old.method, auth.uid())
    returning id into v_new;
    update public.planting_cells set planting_id = v_new
    where planting_id = p_planting_id
      and cell_id in (select (jsonb_array_elements_text(v_part))::uuid);
    v_ids := v_ids || v_new;
  end loop;

  -- 계획 포기 수 다시 계산
  update public.plantings pl
  set planned_plant_count = public.plants_for_area(
        (select count(*) from public.planting_cells pc where pc.planting_id = pl.id) * v_cell_size * v_cell_size,
        cr.plants_per_pyeong)
  from public.crops cr
  where pl.id = any (v_ids) and cr.id = pl.crop_id;
  return v_ids;
end;
$$;

-- 예정 작업 완료: 작업 기록으로 전환한다. 대상 작물은 작업의 plan_crop.
create function public.complete_task(p_task_id uuid, p_work_date date, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_log uuid;
  v_plan_crop uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or not public.is_farm_member(v_task.farm_id) then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  if v_task.status <> 'pending' then
    raise exception 'task_not_pending' using errcode = 'P0001';
  end if;

  insert into public.work_logs (farm_id, work_date, work_type, memo, created_by)
  values (v_task.farm_id, p_work_date, v_task.task_type, coalesce(p_memo, v_task.title), auth.uid())
  returning id into v_log;

  v_plan_crop := coalesce(v_task.plan_crop_id, (select plan_crop_id from public.plantings where id = v_task.planting_id));
  if v_plan_crop is not null then
    insert into public.work_log_targets (work_log_id, plan_crop_id) values (v_log, v_plan_crop);
  end if;

  update public.tasks set status = 'done', done_work_log_id = v_log where id = p_task_id;
  return v_log;
end;
$$;

revoke execute on function public.split_planting(uuid, jsonb) from public, anon;
revoke execute on function public.complete_task(uuid, date, text) from public, anon;
grant execute on function public.split_planting(uuid, jsonb) to authenticated;
grant execute on function public.complete_task(uuid, date, text) to authenticated;

-- 기록 대상 작물: 재배 중 식재가 있는 plan_crops (사이작물은 같은 계획 주작물 식재 상태를 따른다)
create view public.active_plan_crops
with (security_invoker = true)
as
select pc.id, pc.plan_id, pc.crop_id, pc.is_companion, p.farm_id, p.year, p.season, c.name as crop_name
from public.plan_crops pc
join public.field_plans p on p.id = pc.plan_id
join public.crops c on c.id = pc.crop_id
where (not pc.is_companion and exists (
         select 1 from public.plantings pl where pl.plan_crop_id = pc.id and pl.status = 'active'))
   or (pc.is_companion and exists (
         select 1 from public.plantings pl
         join public.planting_cells plc on plc.planting_id = pl.id
         join public.field_plan_cells fc on fc.id = plc.cell_id
         where pl.plan_id = pc.plan_id and pl.status = 'active' and fc.companion_crop_id = pc.crop_id));

-- 사진: 비공개 버킷. 경로 첫 폴더가 farm_id이며 멤버만 접근한다. (Supabase에만 storage 스키마가 있다)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('work-photos', 'work-photos', false, 1048576, array['image/jpeg', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$
      create policy work_photos_member on storage.objects
        for all to authenticated
        using (bucket_id = 'work-photos' and public.is_farm_member(((storage.foldername(name))[1])::uuid))
        with check (bucket_id = 'work-photos' and public.is_farm_member(((storage.foldername(name))[1])::uuid))
    $p$;
  end if;
end;
$$;
