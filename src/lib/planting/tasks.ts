// 식재 하나의 예정 작업(tasks)을 심은 날짜·면적에 맞춰 다시 만든다. 완료한 작업은 그대로 둔다.
// 면적: 밭 그림에 놓였으면 그 구간 넓이, 칸만 있으면 칸 넓이, 아직 안 놓였으면 포기 수 × 포기·줄 간격으로 어림한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateTasks, type ScheduleFertilizer } from "@/lib/schedule";
import { segmentRect, type Bed } from "@/lib/field/beds";
import { cellsToM2 } from "@/lib/units";

type Row = {
  id: string;
  plan_crop_id: string;
  crop_id: string;
  variety_id: string | null;
  method: "direct" | "transplant" | null;
  sow_date: string | null;
  transplant_date: string | null;
  plant_count: number | null;
  planned_plant_count: number | null;
  field_plans: { farm_id: string };
  planting_cells: { field_plan_cells: { rotation_flag: boolean } }[];
  plan_bed_plantings: { start_cm: number; length_cm: number | null; field_beds: Bed } | null;
  crops: {
    name: string;
    days_to_harvest: number | null;
    pruning_required: boolean | null;
    pruning_method: string | null;
    pruning_timing: string | null;
    source_url: string | null;
    family_id: string | null;
    plant_spacing_cm: number | null;
    row_spacing_cm: number | null;
  };
};

export async function regenerateTasks(db: SupabaseClient, plantingId: string): Promise<void> {
  const { data, error } = await db
    .from("plantings")
    .select(
      "id, plan_crop_id, crop_id, variety_id, method, sow_date, transplant_date, plant_count, planned_plant_count, " +
        "field_plans(farm_id), planting_cells(field_plan_cells(rotation_flag)), " +
        "plan_bed_plantings!plantings_bed_planting_id_fkey(start_cm, length_cm, field_beds(id, kind, x_cm, y_cm, w_cm, h_cm, label)), " +
        "crops(name, days_to_harvest, pruning_required, pruning_method, pruning_timing, source_url, family_id, plant_spacing_cm, row_spacing_cm)",
    )
    .eq("id", plantingId)
    .single();
  if (error || !data) throw error ?? new Error("planting not found");
  const p = data as unknown as Row;
  const plantedOn = p.method === "transplant" ? p.transplant_date : p.sow_date;
  if (!plantedOn || !p.method) return;

  const farmId = p.field_plans.farm_id;
  const rotationFlag = p.planting_cells.some((c) => c.field_plan_cells.rotation_flag);
  const [settings, variety, fertilizers, family] = await Promise.all([
    db.from("farm_settings").select("cell_size_m").eq("farm_id", farmId).single(),
    p.variety_id ? db.from("crop_variety_values").select("days_to_harvest").eq("variety_id", p.variety_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("crop_fertilizer_schedules").select("*").eq("crop_id", p.crop_id),
    rotationFlag && p.crops.family_id
      ? db.from("crop_families").select("name, soil_treatment_ingredients, lime_ph_guide, drainage_guide").eq("id", p.crops.family_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const tasks = generateTasks({
    farmId,
    plantingId: p.id,
    planCropId: p.plan_crop_id,
    plantedOn,
    method: p.method,
    areaM2: areaOf(p, Number(settings.data?.cell_size_m ?? 0.5)),
    crop: p.crops,
    daysToHarvest: (variety.data as { days_to_harvest: number | null } | null)?.days_to_harvest ?? p.crops.days_to_harvest,
    fertilizers: (fertilizers.data ?? []) as ScheduleFertilizer[],
    rotation: family.data
      ? {
          familyName: family.data.name,
          soilTreatmentIngredients: family.data.soil_treatment_ingredients ?? [],
          limePhGuide: family.data.lime_ph_guide,
          drainageGuide: family.data.drainage_guide,
        }
      : null,
  });

  const del = await db.from("tasks").delete().eq("planting_id", p.id).eq("status", "pending");
  if (del.error) throw del.error;
  if (tasks.length) {
    const ins = await db.from("tasks").insert(tasks);
    if (ins.error) throw ins.error;
  }
}

function areaOf(p: Row, cellSizeM: number): number {
  const bp = p.plan_bed_plantings;
  if (bp?.field_beds) {
    const r = segmentRect(bp.field_beds, bp);
    return ((r.x1 - r.x0) * (r.y1 - r.y0)) / 10000;
  }
  if (p.planting_cells.length) return cellsToM2(p.planting_cells.length, cellSizeM);
  const count = p.plant_count ?? p.planned_plant_count;
  const ps = Number(p.crops.plant_spacing_cm ?? 0);
  const rs = Number(p.crops.row_spacing_cm ?? p.crops.plant_spacing_cm ?? 0);
  return count && ps ? (count * ps * rs) / 10000 : 0;
}
