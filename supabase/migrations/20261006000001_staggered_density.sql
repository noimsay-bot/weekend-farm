-- 엇갈려 심기(여러 줄)는 줄마다 포기 간격을 두 배로 띄운다: 나란히 두 줄에 4포기 들어갈 자리에 2포기.
-- src/lib/field/beds.ts autoPlantCount와 같은 규칙.
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
    else bp.rows * greatest(1, floor(
      (case when b.h_cm >= b.w_cm then r.y1 - r.y0 else r.x1 - r.x0 end)
      / (cr.plant_spacing_cm * case when bp.layout = 'staggered' and bp.rows > 1 then 2 else 1 end)
    ))::int
  end
  from public.plan_bed_plantings bp
  join public.field_beds b on b.id = bp.bed_id
  join public.crops cr on cr.id = bp.crop_id
  cross join public.bed_planting_rect(p_id) r
  where bp.id = p_id;
$$;

revoke execute on function public.bed_planting_auto_count(uuid) from public, anon;
