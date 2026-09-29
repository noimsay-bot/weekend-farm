import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";
import { toKmaGrid } from "@/lib/weather/grid";
import { fetchAsosDaily, fetchShortTermForecast, fetchWarnings } from "@/lib/weather/kma";
import { nearest, regionOf, WARNING_OFFICES } from "@/lib/weather/stations";
import { loadTimingInput, type FarmForTiming } from "@/lib/weather/load";
import { computeFarmTiming } from "@/lib/weather/timing";

type Farm = FarmForTiming;

// 1) 날씨·특보 캐시 갱신 (농장 좌표 기준). 격자·관측소가 같은 농장은 캐시를 공유한다.
export async function refreshFarmWeather(db: SupabaseClient, farm: Farm, serviceKey: string, today: string, hourKst: number) {
  const region = regionOf(farm.lat, farm.lng);
  const station = nearest(farm.lat, farm.lng);
  if (farm.region !== region || farm.nearest_station_id !== station.id) {
    await db.from("farms").update({ region, nearest_station_id: station.id }).eq("id", farm.id);
    farm.region = region;
    farm.nearest_station_id = station.id;
  }

  const { nx, ny } = toKmaGrid(farm.lat, farm.lng);
  const hourly = await fetchShortTermForecast(serviceKey, nx, ny, today, hourKst);
  if (hourly.length) {
    await db.from("weather_cache").delete().eq("nx", nx).eq("ny", ny).lt("fcst_date", today);
    const up = await db.from("weather_cache").upsert(
      hourly.map((h) => ({ nx, ny, ...h, fetched_at: new Date().toISOString() })),
      { onConflict: "nx,ny,fcst_date,fcst_hour" },
    );
    if (up.error) throw up.error;
  }

  const office = nearest(farm.lat, farm.lng, WARNING_OFFICES);
  const alerts = await fetchWarnings(serviceKey, office.id, addDays(today, -1), today);
  if (alerts.length) {
    await db.from("weather_alerts").upsert(
      alerts.map((a) => ({ ...a, effective_from: a.announced_at, fetched_at: new Date().toISOString() })),
      { onConflict: "region_code,alert_type,announced_at", ignoreDuplicates: true },
    );
  }

  // 최근 강수 실적 (어제까지 3일)
  const recent = await fetchAsosDaily(serviceKey, station.id, addDays(today, -3), addDays(today, -1));
  // 작년 동기 기온: 작년 오늘부터 180일치가 없으면 한 번에 받는다
  const lastYearStart = addDays(today, -365);
  const { count } = await db
    .from("weather_observations")
    .select("obs_date", { count: "exact", head: true })
    .eq("station_id", station.id)
    .gte("obs_date", lastYearStart)
    .lte("obs_date", addDays(lastYearStart, 180));
  const lastYear = (count ?? 0) < 150 ? await fetchAsosDaily(serviceKey, station.id, lastYearStart, addDays(lastYearStart, 180)) : [];
  const obs = [...recent, ...lastYear];
  if (obs.length) {
    await db.from("weather_observations").upsert(
      obs.map((o) => ({ ...o, fetched_at: new Date().toISOString() })),
      { onConflict: "station_id,obs_date" },
    );
  }
  return { region, station: station.name, forecastRows: hourly.length, alerts: alerts.length, observations: obs.length };
}

// 2) 권장일·강우 회피 재계산과 알림 이벤트
export async function recomputeFarmTiming(db: SupabaseClient, farm: Farm, today: string) {
  const out = computeFarmTiming(await loadTimingInput(db, farm, today));

  for (const u of out.plantingUpdates) {
    await db.from("plantings").update({ window_stage: u.window_stage, window_date: u.window_date }).eq("id", u.id);
  }
  if (out.seedlingNotified.length) {
    await db.from("plantings").update({ seedling_notified_on: today }).in("id", out.seedlingNotified);
  }
  for (const r of out.taskRecommendations) {
    await db.from("tasks").update({ recommendation: r.recommendation }).eq("id", r.id);
  }
  if (out.events.length) {
    await db.from("notification_events").insert(
      out.events.map((e) => ({ farm_id: farm.id, type: e.type, payload: e.payload, immediate: false })),
    );
  }
  return { updated: out.plantingUpdates.length, events: out.events.length, weekly: out.weekly.length };
}
