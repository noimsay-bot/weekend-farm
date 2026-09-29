-- P2: 작물 데이터 확정 절차 (관리자)

-- 재배작형(봄 재배, 가을 재배 등)마다 시기가 다르므로 달력 키에 포함한다.
alter table public.crop_regional_calendars add column cropping_type text not null default '';
alter table public.crop_regional_calendars
  drop constraint crop_regional_calendars_crop_id_region_activity_key;
alter table public.crop_regional_calendars
  add constraint crop_regional_calendars_key unique (crop_id, region, cropping_type, activity);

-- 확정 전에 승인 또는 수동 입력이 필요한 crops 필드. src/lib/crop-fields.ts와 같아야 한다.
create function public.crop_required_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'family_id', 'sow_method', 'season', 'seedling_days', 'min_temp_c', 'max_temp_c',
    'late_frost_sensitive', 'days_to_harvest', 'harvest_window_days', 'rotation_risk',
    'rest_seasons', 'overwinter_default', 'harvest_avoid_rain', 'rain_wait_days',
    'schedule_tolerance_days', 'plant_spacing_cm', 'row_spacing_cm', 'plants_per_pyeong',
    'pruning_required', 'pruning_method', 'pruning_timing', 'heat_tolerance',
    'watering_interval_days'
  ]::text[];
$$;

-- 선택 입력 필드 (확정 조건 아님)
create function public.crop_optional_fields()
returns text[]
language sql
immutable
as $$
  select array['description', 'water_need', 'rain_wait_condition', 'source_url']::text[];
$$;

-- 추출값 승인
create function public.approve_crop_field(p_crop_id uuid, p_field text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.crop_field_sources
  set approved = true, approved_by = auth.uid(), approved_at = now()
  where crop_id = p_crop_id and field_name = p_field;
  if not found then
    raise exception 'no extracted value for %', p_field using errcode = 'P0001';
  end if;
end;
$$;

-- 수동 입력. p_value가 null이면 '해당 없음'. family_id는 과 이름으로 받는다.
create function public.set_crop_field(p_crop_id uuid, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_family_id uuid;
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not (p_field = any (public.crop_required_fields() || public.crop_optional_fields())) then
    raise exception 'unknown field %', p_field using errcode = 'P0001';
  end if;

  if p_field = 'family_id' then
    if p_value is not null then
      insert into public.crop_families (name) values (trim(p_value))
      on conflict (name) do nothing;
      select id into v_family_id from public.crop_families where name = trim(p_value);
    end if;
    update public.crops set family_id = v_family_id where id = p_crop_id;
  else
    select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
    where a.attrelid = 'public.crops'::regclass and a.attname = p_field;
    execute format('update public.crops set %I = $1::%s where id = $2', p_field, v_type)
      using p_value, p_crop_id;
  end if;

  insert into public.crop_field_sources
    (crop_id, field_name, extracted_value, manual_input, approved, approved_by, approved_at)
  values (p_crop_id, p_field, p_value, true, true, auth.uid(), now())
  on conflict (crop_id, field_name) do update
  set extracted_value = excluded.extracted_value,
      manual_input = true,
      approved = true,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at;
end;
$$;

-- 확정: 모든 필수 필드가 승인 또는 수동 입력되어야 한다.
create function public.confirm_crop(p_crop_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select array_agg(f order by f) into v_missing
  from unnest(public.crop_required_fields()) f
  where not exists (
    select 1 from public.crop_field_sources s
    where s.crop_id = p_crop_id and s.field_name = f and (s.approved or s.manual_input)
  );

  if v_missing is not null then
    raise exception 'incomplete: %', array_to_string(v_missing, ',') using errcode = 'P0001';
  end if;

  update public.crops set status = 'confirmed' where id = p_crop_id;
  update public.crop_families set status = 'confirmed'
  where id = (select family_id from public.crops where id = p_crop_id);
end;
$$;

-- 관리자가 아직 없으면 요청한 사용자를 첫 관리자로 등록한다.
create function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  lock table public.app_admins in exclusive mode;
  if exists (select 1 from public.app_admins) then
    return false;
  end if;
  insert into public.app_admins (user_id) values (auth.uid());
  return true;
end;
$$;

revoke execute on function public.approve_crop_field(uuid, text) from public, anon;
revoke execute on function public.set_crop_field(uuid, text, text) from public, anon;
revoke execute on function public.confirm_crop(uuid) from public, anon;
revoke execute on function public.claim_first_admin() from public, anon;
grant execute on function public.approve_crop_field(uuid, text) to authenticated;
grant execute on function public.set_crop_field(uuid, text, text) to authenticated;
grant execute on function public.confirm_crop(uuid) to authenticated;
grant execute on function public.claim_first_admin() to authenticated;
