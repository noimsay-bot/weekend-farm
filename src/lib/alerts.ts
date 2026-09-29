// 작물 단위 판정 조회 (대시보드 배지와 일일 알림이 함께 쓴다). 사용자 세션·service role 모두 가능.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "./dates";
import { preHarvestConflicts, wateringDue, type WateringLog } from "./notify/rules";
import type { DailyForecast } from "./weather/recommend";

type ActiveCrop = { id: string; crop_id: string; crop_name: string; is_companion: boolean };

export async function loadWateringDue(
  db: SupabaseClient,
  active: ActiveCrop[],
  forecast: DailyForecast[],
  settings: { rain_pop_threshold: number | null; watering_rain_mm: number | string | null },
  today: string,
) {
  const mains = active.filter((a) => !a.is_companion);
  if (!mains.length) return [];
  const [{ data: crops }, { data: plantings }, { data: logs }] = await Promise.all([
    db.from("crops").select("id, watering_interval_days").in("id", mains.map((m) => m.crop_id)),
    db.from("plantings").select("plan_crop_id, sow_date, transplant_date").in("plan_crop_id", mains.map((m) => m.id)).eq("status", "active"),
    db
      .from("work_log_targets")
      .select("plan_crop_id, work_logs!inner(work_date, work_type)")
      .in("plan_crop_id", mains.map((m) => m.id))
      .in("work_logs.work_type", ["watering", "rain"])
      .gte("work_logs.work_date", addDays(today, -60)),
  ]);
  const interval = new Map((crops ?? []).map((c) => [c.id, c.watering_interval_days as number | null]));
  const planted = new Map<string, string>();
  for (const p of plantings ?? []) {
    const d = p.transplant_date ?? p.sow_date;
    if (d && (!planted.has(p.plan_crop_id) || d < planted.get(p.plan_crop_id)!)) planted.set(p.plan_crop_id, d);
  }
  return wateringDue(
    mains.map((m) => ({ planCropId: m.id, cropName: m.crop_name, intervalDays: interval.get(m.crop_id) ?? null, plantedOn: planted.get(m.id) ?? null })),
    ((logs ?? []) as unknown as { plan_crop_id: string; work_logs: { work_date: string; work_type: "watering" | "rain" } }[]).map(
      (l): WateringLog => ({ plan_crop_id: l.plan_crop_id, work_date: l.work_logs.work_date, work_type: l.work_logs.work_type }),
    ),
    forecast,
    {
      popThreshold: settings.rain_pop_threshold ?? 60,
      wateringRainMm: settings.watering_rain_mm === null || settings.watering_rain_mm === undefined ? null : Number(settings.watering_rain_mm),
    },
    today,
  );
}

export async function loadPesticideConflicts(db: SupabaseClient, farmId: string, today: string) {
  const { data: pestLogs } = await db
    .from("work_logs")
    .select(
      "work_date, work_log_targets(plan_crop_id, plan_crops(crop_id, crops(name))), work_log_pesticides(crop_pest_controls(crop_id, ingredient_name, safe_days_before_harvest))",
    )
    .eq("farm_id", farmId)
    .eq("work_type", "pest_control")
    .gte("work_date", addDays(today, -90));
  const uses = ((pestLogs ?? []) as unknown as {
    work_date: string;
    work_log_targets: { plan_crop_id: string; plan_crops: { crop_id: string; crops: { name: string } } }[];
    work_log_pesticides: { crop_pest_controls: { crop_id: string; ingredient_name: string; safe_days_before_harvest: number | null } }[];
  }[]).flatMap((l) =>
    l.work_log_targets.flatMap((t) =>
      l.work_log_pesticides
        .filter((p) => p.crop_pest_controls.crop_id === t.plan_crops.crop_id)
        .map((p) => ({
          planCropId: t.plan_crop_id,
          cropName: t.plan_crops.crops.name,
          appliedOn: l.work_date,
          ingredient: p.crop_pest_controls.ingredient_name,
          safeDays: p.crop_pest_controls.safe_days_before_harvest,
        })),
    ),
  );
  if (!uses.length) return [];
  const { data: harvests } = await db
    .from("tasks")
    .select("plan_crop_id, calculated_date, adjusted_date")
    .eq("farm_id", farmId)
    .eq("task_type", "harvest")
    .eq("status", "pending");
  return preHarvestConflicts(
    uses,
    (harvests ?? []).map((h) => ({ planCropId: h.plan_crop_id, date: h.adjusted_date ?? h.calculated_date })),
  );
}
