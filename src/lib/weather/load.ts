// 적기 계산 입력을 DB에서 모은다. 사용자 세션(RLS)과 크론(service role) 모두 쓴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { toKmaGrid } from "./grid";
import { toDaily } from "./recommend";
import { computeFarmTiming, type TimingCalendar, type TimingCrop, type TimingPlanting, type TimingTask } from "./timing";

export type FarmForTiming = { id: string; lat: number; lng: number; region: string | null; nearest_station_id: string | null };

export async function loadTimingInput(db: SupabaseClient, farm: FarmForTiming, today: string) {
  const { nx, ny } = toKmaGrid(farm.lat, farm.lng);
  const lastYearFrom = new Date(`${today}T00:00:00Z`);
  lastYearFrom.setUTCDate(lastYearFrom.getUTCDate() - 400);

  const [settings, forecast, observations, plantings, tasks] = await Promise.all([
    db.from("farm_settings").select("rain_pop_threshold, rain_mm_threshold").eq("farm_id", farm.id).single(),
    db.from("weather_cache").select("fcst_date, fcst_hour, pop, pcp_mm, tmp_c").eq("nx", nx).eq("ny", ny).gte("fcst_date", today),
    farm.nearest_station_id
      ? db
          .from("weather_observations")
          .select("obs_date, min_temp_c, max_temp_c")
          .eq("station_id", farm.nearest_station_id)
          .gte("obs_date", lastYearFrom.toISOString().slice(0, 10))
      : Promise.resolve({ data: [] }),
    db
      .from("plantings")
      .select(
        "id, crop_id, method, sow_date, transplant_date, planned_plant_count, window_stage, window_date, seedling_notified_on, field_plans!inner(farm_id, status)",
      )
      .eq("status", "active")
      .eq("field_plans.farm_id", farm.id)
      .eq("field_plans.status", "confirmed"),
    db
      .from("tasks")
      .select("id, planting_id, calculated_date, adjusted_date, status, plantings(crop_id)")
      .eq("farm_id", farm.id)
      .eq("task_type", "harvest")
      .eq("status", "pending"),
  ]);

  const plantingRows = (plantings.data ?? []) as unknown as TimingPlanting[];
  const taskRows: TimingTask[] = ((tasks.data ?? []) as unknown as (Omit<TimingTask, "crop_id"> & { plantings: { crop_id: string } | null })[])
    .filter((t) => t.plantings)
    .map((t) => ({ ...t, crop_id: t.plantings!.crop_id }));
  const cropIds = [...new Set([...plantingRows.map((p) => p.crop_id), ...taskRows.map((t) => t.crop_id)])];
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [crops, calendars] = await Promise.all([
    db
      .from("crops")
      .select("id, name, sow_method, min_temp_c, max_temp_c, seedling_days, harvest_avoid_rain, harvest_window_days, rain_wait_days")
      .in("id", cropIds.length ? cropIds : none),
    db.from("crop_regional_calendars").select("*").in("crop_id", cropIds.length ? cropIds : none),
  ]);

  return {
    today,
    region: farm.region,
    forecast: toDaily(forecast.data ?? []),
    rain: {
      popThreshold: settings.data?.rain_pop_threshold ?? 60,
      mmThreshold: settings.data?.rain_mm_threshold === null || settings.data?.rain_mm_threshold === undefined ? null : Number(settings.data.rain_mm_threshold),
    },
    observations: observations.data ?? [],
    crops: (crops.data ?? []) as TimingCrop[],
    plantings: plantingRows,
    calendars: (calendars.data ?? []) as TimingCalendar[],
    harvestTasks: taskRows,
  };
}

// "이번 주 적기" 조회 (파종·정식·육묘 시작·수확 권장). 화면 표시는 P9 대시보드.
export async function getWeeklyWindows(db: SupabaseClient, farm: FarmForTiming, today: string) {
  return computeFarmTiming(await loadTimingInput(db, farm, today)).weekly;
}
