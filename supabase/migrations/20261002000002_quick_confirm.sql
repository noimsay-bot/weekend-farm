-- 간단 확정: 원문에서 뽑은 값은 모두 승인하고, 원문에 없는 필드는 비워 둔 채 확정한다.
-- 빈 필드는 앱에서 '모름'으로 처리되며(경고·계산 생략), 나중에 상세 화면에서 채울 수 있다.
-- 원문(source_url)이 없는 작물은 대상이 아니다.
create function public.quick_confirm_crops(p_crop_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select array_agg(id) into v_ids
  from public.crops
  where id = any (p_crop_ids) and status = 'draft' and source_url is not null;
  if v_ids is null then
    return 0;
  end if;

  update public.crop_field_sources
  set approved = true, approved_by = auth.uid(), approved_at = now()
  where crop_id = any (v_ids) and extracted_value is not null and not approved and not manual_input;

  update public.crops set status = 'confirmed' where id = any (v_ids);
  update public.crop_families set status = 'confirmed'
  where id in (select family_id from public.crops where id = any (v_ids));

  return array_length(v_ids, 1);
end;
$$;

revoke execute on function public.quick_confirm_crops(uuid[]) from public, anon;
grant execute on function public.quick_confirm_crops(uuid[]) to authenticated;
