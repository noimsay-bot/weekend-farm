-- 승인 취소: 확정된 작물을 다시 검토 중(draft)으로 돌린다. 필드 승인 기록은 그대로 둔다.
-- 계획에 쓰인 작물은 draft가 되면 일반 사용자에게 보이지 않으므로 취소할 수 없다.
create function public.unconfirm_crop(p_crop_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if exists (select 1 from public.plan_crops where crop_id = p_crop_id)
     or exists (select 1 from public.field_plan_cells where crop_id = p_crop_id or companion_crop_id = p_crop_id)
     or exists (select 1 from public.plantings where crop_id = p_crop_id) then
    raise exception 'crop_in_use' using errcode = 'P0001';
  end if;
  update public.crops set status = 'draft' where id = p_crop_id;
end;
$$;

revoke execute on function public.unconfirm_crop(uuid) from public, anon;
grant execute on function public.unconfirm_crop(uuid) to authenticated;
