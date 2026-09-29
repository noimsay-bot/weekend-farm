-- 농장 가로·세로는 온보딩 '가상 밭' 단계에서 입력한다. 농장 생성 시에는 이름·위치만 받는다.
alter table public.farms alter column width_m drop not null;
alter table public.farms alter column height_m drop not null;

drop function public.create_farm(text, double precision, double precision, numeric, numeric);

create function public.create_farm(
  p_name text,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.farms (name, lat, lng, created_by)
  values (p_name, p_lat, p_lng, auth.uid())
  returning id into v_farm_id;

  insert into public.farm_members (farm_id, user_id, role)
  values (v_farm_id, auth.uid(), 'owner');

  return v_farm_id;
end;
$$;

revoke execute on function public.create_farm(text, double precision, double precision) from public, anon;
grant execute on function public.create_farm(text, double precision, double precision) to authenticated;
