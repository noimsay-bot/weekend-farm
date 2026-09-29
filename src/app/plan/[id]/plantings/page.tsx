import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { seasonLabel, type PlanSeason } from "@/lib/season";
import { Screen } from "@/components/ui";
import { PlantingForm, type PlantingData } from "./PlantingForm";

export default async function PlantingsPage({ params }: PageProps<"/plan/[id]/plantings">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("field_plans")
    .select("id, farm_id, year, season, status, farms(region)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) notFound();

  const { data: plantings } = await supabase
    .from("plantings")
    .select(
      "id, plan_crop_id, crop_id, variety_id, method, sow_date, transplant_date, planned_plant_count, plant_count, status, " +
        "planting_cells(cell_id, field_plan_cells(x, y, rotation_flag)), " +
        "crops(name, sow_method, days_to_harvest, pruning_required, pruning_method, pruning_timing, source_url, family_id, schedule_tolerance_days)",
    )
    .eq("plan_id", id)
    .eq("status", "active")
    .order("created_at");

  const list = (plantings ?? []) as unknown as PlantingData["plantings"];
  const cropIds = [...new Set(list.map((p) => p.crop_id))];
  const familyIds = [...new Set(list.map((p) => p.crops.family_id).filter(Boolean))] as string[];

  const [settings, varieties, fertilizers, calendars, families] = await Promise.all([
    supabase.from("farm_settings").select("cell_size_m").eq("farm_id", plan.farm_id).single(),
    supabase.from("crop_variety_values").select("*").in("crop_id", cropIds.length ? cropIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("crop_fertilizer_schedules").select("*").in("crop_id", cropIds.length ? cropIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("crop_regional_calendars").select("*").in("crop_id", cropIds.length ? cropIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("crop_families")
      .select("id, name, soil_treatment_ingredients, lime_ph_guide, drainage_guide")
      .in("id", familyIds.length ? familyIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const data: PlantingData = {
    farmId: plan.farm_id,
    region: (plan.farms as unknown as { region: string | null }).region,
    cellSizeM: Number(settings.data?.cell_size_m ?? 0.5),
    plantings: list,
    varieties: varieties.data ?? [],
    fertilizers: fertilizers.data ?? [],
    calendars: calendars.data ?? [],
    families: families.data ?? [],
  };

  return (
    <Screen title={`${seasonLabel({ year: plan.year, season: plan.season as PlanSeason })} 심은 날짜`}>
      <Link href={`/plan/${id}`} className="text-sm text-primary">
        ← 계획으로
      </Link>
      {plan.status !== "confirmed" ? (
        <p className="text-sm">계획을 먼저 확정하세요.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-neutral-500">재배 중인 식재가 없어요.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            지난 날짜도 입력할 수 있어요. 저장하면 밭만들기·추비·가지치기·수확 예정 작업이 자동으로 만들어져요.
          </p>
          {list.map((p) => (
            <PlantingForm key={p.id} planting={p} data={data} />
          ))}
        </>
      )}
    </Screen>
  );
}
