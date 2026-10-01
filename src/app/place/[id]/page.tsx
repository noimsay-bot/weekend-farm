import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Bed, BedPlanting } from "@/lib/field/beds";
import { Screen } from "@/components/ui";
import type { Sowing } from "@/app/plan/[id]/BedPlanEditor";
import { PlacePlanting } from "./PlacePlanting";

const BP_COLUMNS = "id, bed_id, crop_id, rows, layout, method, start_cm, length_cm, plant_count, carried_from_planting_id";

// 기록한 식재를 밭 그림의 구획에 놓는다 (이미 놓였으면 옮긴다).
export default async function PlacePage({ params }: PageProps<"/place/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: planting } = await supabase
    .from("plantings")
    .select("id, plan_id, crop_id, method, plant_count, bed_planting_id, crops(name), field_plans(farm_id, farms(width_m, height_m))")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (!planting) notFound();
  const plan = planting.field_plans as unknown as { farm_id: string; farms: { width_m: number; height_m: number } };

  const [beds, active, crops, own] = await Promise.all([
    supabase.from("field_beds").select("id, kind, x_cm, y_cm, w_cm, h_cm, label").eq("farm_id", plan.farm_id).order("created_at"),
    // 지금 밭에 있는 다른 작물 (재배 중인 식재의 구획 심기)
    supabase
      .from("plantings")
      .select(`plan_bed_plantings!plantings_bed_planting_id_fkey(${BP_COLUMNS}), field_plans!inner(farm_id, status)`)
      .eq("status", "active")
      .eq("field_plans.farm_id", plan.farm_id)
      .eq("field_plans.status", "confirmed")
      .not("bed_planting_id", "is", null)
      .neq("id", id),
    supabase.from("crops").select("id, name, plant_spacing_cm, row_spacing_cm, sow_method, sow_pattern"),
    planting.bed_planting_id
      ? supabase.from("plan_bed_plantings").select(BP_COLUMNS).eq("id", planting.bed_planting_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const others = ((active.data ?? []) as unknown as { plan_bed_plantings: BedPlanting | null }[])
    .map((r) => r.plan_bed_plantings)
    .filter((bp): bp is BedPlanting => Boolean(bp));
  const cropList = crops.data ?? [];
  const cropName = (planting.crops as unknown as { name: string }).name;

  return (
    <Screen title={`${cropName} 자리 정하기`}>
      {(beds.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">밭 그림에 구획이 없어요. 계획 화면의 &lsquo;구획 만들기&rsquo;에서 두둑을 먼저 그려 주세요.</p>
      ) : (
        <PlacePlanting
          plantingId={planting.id}
          cropId={planting.crop_id}
          cropName={cropName}
          method={planting.method as "direct" | "transplant" | null}
          plantCount={planting.plant_count}
          current={(own.data ?? null) as BedPlanting | null}
          widthCm={Math.round(Number(plan.farms.width_m) * 100)}
          heightCm={Math.round(Number(plan.farms.height_m) * 100)}
          beds={(beds.data ?? []) as Bed[]}
          others={others}
          cropNames={Object.fromEntries(cropList.map((c) => [c.id, c.name]))}
          spacing={Object.fromEntries(cropList.map((c) => [c.id, c.plant_spacing_cm === null ? null : Number(c.plant_spacing_cm)]))}
          sowing={
            Object.fromEntries(
              cropList.map((c) => [c.id, { sowMethod: c.sow_method, pattern: c.sow_pattern, rowSpacing: c.row_spacing_cm === null ? null : Number(c.row_spacing_cm) }]),
            ) as Record<string, Sowing>
          }
        />
      )}
    </Screen>
  );
}
