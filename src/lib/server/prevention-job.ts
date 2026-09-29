import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { preventionTasks, type PreventionSchedule } from "@/lib/dashboard/prevention";
import { toKmaGrid } from "@/lib/weather/grid";
import { toDaily } from "@/lib/weather/recommend";

type Farm = { id: string; lat: number; lng: number; region: string | null };

// 예방 방제 작업을 만든다 (이미 같은 key가 있으면 건너뜀)
export async function syncPreventionTasks(db: SupabaseClient, farm: Farm, today: string) {
  const { data: plantings } = await db
    .from("plantings")
    .select("id, plan_crop_id, crop_id, sow_date, transplant_date, crops(name), field_plans!inner(farm_id, status)")
    .eq("status", "active")
    .eq("field_plans.farm_id", farm.id)
    .eq("field_plans.status", "confirmed");
  const planted = ((plantings ?? []) as unknown as {
    id: string;
    plan_crop_id: string;
    crop_id: string;
    sow_date: string | null;
    transplant_date: string | null;
    crops: { name: string };
  }[]).filter((p) => p.sow_date || p.transplant_date);
  if (!planted.length) return 0;

  const { nx, ny } = toKmaGrid(farm.lat, farm.lng);
  const [{ data: schedules }, { data: hourly }, { data: settings }, { data: existing }] = await Promise.all([
    db.from("pest_prevention_schedules").select("*").in("crop_id", [...new Set(planted.map((p) => p.crop_id))]),
    db.from("weather_cache").select("fcst_date, fcst_hour, pop, pcp_mm, tmp_c").eq("nx", nx).eq("ny", ny).gte("fcst_date", today),
    db.from("farm_settings").select("rain_pop_threshold, rain_mm_threshold").eq("farm_id", farm.id).single(),
    db.from("tasks").select("details").eq("farm_id", farm.id).eq("task_type", "pest_control").not("details->>key", "is", null),
  ]);
  const have = new Set((existing ?? []).map((t) => (t.details as { key?: string }).key));
  const drafts = preventionTasks({
    today,
    region: farm.region,
    plantings: planted.map((p) => ({
      id: p.id,
      plan_crop_id: p.plan_crop_id,
      crop_id: p.crop_id,
      crop_name: p.crops.name,
      plantedOn: (p.transplant_date ?? p.sow_date)!,
    })),
    schedules: (schedules ?? []) as PreventionSchedule[],
    forecast: toDaily(hourly ?? []),
    rain: {
      popThreshold: settings?.rain_pop_threshold ?? 60,
      mmThreshold: settings?.rain_mm_threshold === null || settings?.rain_mm_threshold === undefined ? null : Number(settings.rain_mm_threshold),
    },
  }).filter((t) => !have.has(t.key));

  if (drafts.length) {
    await db.from("tasks").insert(
      drafts.map(({ key: _key, ...t }) => {
        void _key;
        return { ...t, farm_id: farm.id };
      }),
    );
  }
  return drafts.length;
}
