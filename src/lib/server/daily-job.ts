import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatKDate } from "@/lib/dates";
import { composeForUser, type Item, type NotificationType } from "@/lib/notify/compose";
import { drainageAlert, frostDays, shouldLogRain } from "@/lib/notify/rules";
import { loadPesticideConflicts, loadWateringDue } from "@/lib/alerts";
import { toKmaGrid } from "@/lib/weather/grid";
import { toDaily } from "@/lib/weather/recommend";
import { nearest, WARNING_OFFICES } from "@/lib/weather/stations";
import { heatAdviceItems } from "@/lib/notify/heat";
import { sendToUser } from "./push";
import { syncPreventionTasks } from "./prevention-job";
import { collectWeeklyFarmInfo } from "./weekly-info";
import { recomputeFarmTiming, refreshFarmWeather } from "./weather-job";

type Farm = { id: string; name: string; lat: number; lng: number; region: string | null; nearest_station_id: string | null };

const ALERT_SITUATION: Record<string, string> = { 한파: "cold_wave", 폭염: "heat_wave", 태풍: "typhoon", 호우: "heavy_rain" };

async function guideFor(db: SupabaseClient, situation: string): Promise<string | null> {
  const { data } = await db.from("weather_response_guides").select("guide_text").eq("situation", situation).is("crop_id", null).limit(1);
  const text = data?.[0]?.guide_text as string | undefined;
  return text ? text.split("\n").slice(0, 2).join(" ") : null;
}

// 즉시 알림 중복 방지: 같은 key로 이미 보낸 이벤트가 있으면 건너뛴다
async function alreadySent(db: SupabaseClient, farmId: string, key: string) {
  const { data } = await db.from("notification_events").select("id").eq("farm_id", farmId).eq("payload->>key", key).limit(1);
  return Boolean(data?.length);
}

function eventText(type: string, p: Record<string, unknown>): string | null {
  const d = (v: unknown) => (typeof v === "string" ? formatKDate(v) : "");
  switch (type) {
    case "sowing_window":
      return `${p.crop} ${p.activity === "sow" ? "파종" : "정식"} 적기 확정 ${d(p.date)}${p.seedlings ? ` · 모종 ${p.seedlings}개 필요` : ""}`;
    case "seedling_start":
      return `${p.crop} 육묘 시작 권장 시기 (${d(p.date)}부터)`;
    case "harvest_rain":
      return `${p.crop} 수확 ${p.action === "earlier" ? "앞당기기" : "늦추기"} 권장 ${d(p.date)} (비 예보)`;
    case "plan_approval":
      return "작기 계획 확정 요청이 왔어요";
    case "planting_change":
      return p.action === "replaced" ? "함께하는 멤버가 식재 작물을 교체했어요" : "함께하는 멤버가 식재를 정리했어요";
    default:
      return null;
  }
}

// 일일·특보 공통: 농장 하나의 알림 항목을 모은다. mode='alerts'면 특보·배수점검만.
export async function collectFarmItems(db: SupabaseClient, farm: Farm, today: string, mode: "daily" | "alerts") {
  const items: Item[] = [];
  const { nx, ny } = toKmaGrid(farm.lat, farm.lng);
  const office = nearest(farm.lat, farm.lng, WARNING_OFFICES);
  const [{ data: settings }, { data: hourly }, { data: alerts }] = await Promise.all([
    db.from("farm_settings").select("*").eq("farm_id", farm.id).single(),
    db.from("weather_cache").select("fcst_date, fcst_hour, pop, pcp_mm, tmp_c").eq("nx", nx).eq("ny", ny).gte("fcst_date", today),
    db
      .from("weather_alerts")
      .select("id, alert_type, level, action, announced_at")
      .eq("region_code", office.id)
      .gte("announced_at", `${addDays(today, -1)}T00:00:00+09:00`),
  ]);
  const forecast = toDaily(hourly ?? []);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  // 배수점검 (즉시)
  const drain = drainageAlert(forecast, num(settings?.drainage_check_mm), alerts ?? [], today);
  if (drain && !(await alreadySent(db, farm.id, `drainage:${today}`))) {
    items.push({ type: "drainage", text: `밭 배수로 점검 — ${drain.reason}` });
    await db.from("notification_events").insert({ farm_id: farm.id, type: "drainage", immediate: true, payload: { key: `drainage:${today}` }, sent_at: new Date().toISOString() });
  }

  // 기상특보 (즉시): 한파·폭염·태풍. 대응 문구는 DB의 농사로 기준 문구.
  for (const a of alerts ?? []) {
    if (!["한파", "폭염", "태풍"].includes(a.alert_type) || a.action === "해제") continue;
    const key = `alert:${a.id}`;
    if (await alreadySent(db, farm.id, key)) continue;
    const guide = await guideFor(db, ALERT_SITUATION[a.alert_type]);
    items.push({ type: "weather_alert", text: `${a.alert_type}${a.level ?? ""} ${a.action ?? "발표"}${guide ? ` — ${guide}` : ""}` });
    await db.from("notification_events").insert({ farm_id: farm.id, type: "weather_alert", immediate: true, payload: { key }, sent_at: new Date().toISOString() });
  }
  if (mode === "alerts") return items;

  // 오늘·내일 예정 작업
  const tomorrow = addDays(today, 1);
  const { data: tasks } = await db
    .from("tasks")
    .select("title, calculated_date, adjusted_date")
    .eq("farm_id", farm.id)
    .eq("status", "pending")
    .or(`adjusted_date.in.(${today},${tomorrow}),and(adjusted_date.is.null,calculated_date.in.(${today},${tomorrow}))`);
  for (const t of tasks ?? []) {
    items.push({ type: "task", text: `${(t.adjusted_date ?? t.calculated_date) === today ? "오늘" : "내일"} ${t.title}` });
  }

  // 대기 중 이벤트 (적기 확정·육묘·수확기 강우·공동 확정·식재 변경)
  const { data: events } = await db
    .from("notification_events")
    .select("id, type, recipient_id, payload")
    .eq("farm_id", farm.id)
    .is("sent_at", null)
    .eq("immediate", false);
  for (const e of events ?? []) {
    const text = eventText(e.type, e.payload ?? {});
    if (text) items.push({ type: e.type as NotificationType, text, recipientId: e.recipient_id });
  }
  if (events?.length) {
    await db.from("notification_events").update({ sent_at: new Date().toISOString() }).in("id", events.map((e) => e.id));
  }

  // 재배 중 작물
  const { data: active } = await db.from("active_plan_crops").select("id, crop_id, crop_name, is_companion").eq("farm_id", farm.id);
  const activeIds = (active ?? []).map((a) => a.id);

  // 비 자동 기록: 전일 관측 강수량이 물주기 대체 기준 이상이면 재배 중인 모든 작물에
  const yesterday = addDays(today, -1);
  if (farm.nearest_station_id && activeIds.length) {
    const { data: obs } = await db
      .from("weather_observations")
      .select("rain_mm")
      .eq("station_id", farm.nearest_station_id)
      .eq("obs_date", yesterday)
      .maybeSingle();
    const { data: existing } = await db.from("work_logs").select("id").eq("farm_id", farm.id).eq("work_type", "rain").eq("work_date", yesterday).limit(1);
    if (shouldLogRain(num(obs?.rain_mm), num(settings?.watering_rain_mm)) && !existing?.length) {
      const { data: log } = await db
        .from("work_logs")
        .insert({ farm_id: farm.id, work_date: yesterday, work_type: "rain", rain_mm: obs!.rain_mm, is_auto: true, memo: "관측소 강수량 자동 기록" })
        .select("id")
        .single();
      if (log) await db.from("work_log_targets").insert(activeIds.map((id) => ({ work_log_id: log.id, plan_crop_id: id })));
    }
  }

  // 물주기 (작물별, 주작물만)
  if (settings?.watering_alert_enabled && activeIds.length) {
    for (const w of await loadWateringDue(db, active ?? [], forecast, settings, today)) {
      items.push({ type: "watering", text: `${w.cropName} 물주기 (마지막 ${w.lastType === "rain" ? "비" : w.lastType === "watering" ? "물주기" : "심은 날"} 후 ${w.daysSince}일)` });
    }
  }

  // 방제 안전사용기준: 최근 방제 성분의 수확 전 금지기간과 수확 예정일
  for (const c of await loadPesticideConflicts(db, farm.id, today)) {
    items.push({ type: "pesticide_safety", text: `${c.cropName} 수확 예정 ${formatKDate(c.harvestDate)}은 ${c.ingredient} 수확 전 금지기간이에요 (${formatKDate(c.safeFrom)}부터 수확)` });
  }

  // 서리 가능성 (예보 최저 0℃ 이하)
  const frost = frostDays(forecast, today);
  if (frost.length) {
    const guide = await guideFor(db, "frost");
    items.push({ type: "weather_alert", text: `${frost.map(formatKDate).join(", ")} 최저기온 0℃ 이하 예보 — 서리 대비${guide ? `: ${guide}` : ""}` });
  }

  // 주간농사정보: 재배 중 작물에 해당하는 병해충 항목
  if (active?.length) {
    const { data: weekly } = await db
      .from("weekly_farm_info")
      .select("crop_name, summary, crop_id")
      .in("crop_id", [...new Set(active.map((a) => a.crop_id))])
      .gte("week_start", addDays(today, -7));
    for (const w of weekly ?? []) items.push({ type: "pest_prevention", text: `주간농사정보 · ${w.crop_name}: ${w.summary}` });
  }

  // 폭염기 대응 (P8)
  items.push(...(await heatAdviceItems(db, farm, forecast, alerts ?? [], today)));

  return items;
}

export async function notifyFarm(db: SupabaseClient, farm: Farm, items: Item[], today: string) {
  const { data: members } = await db.from("farm_members").select("user_id").eq("farm_id", farm.id);
  let sent = 0;
  for (const { user_id } of members ?? []) {
    const { data: settings } = await db.from("notification_settings").select("type, enabled").eq("user_id", user_id);
    const disabled = new Set((settings ?? []).filter((s) => !s.enabled).map((s) => s.type as NotificationType));
    const { summary, immediate } = composeForUser(items, user_id, disabled, formatKDate(today));
    sent += await sendToUser(db, user_id, [...immediate, ...(summary ? [summary] : [])]);
  }
  return sent;
}

export async function runForAllFarms(db: SupabaseClient, today: string, hourKst: number, mode: "daily" | "alerts") {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  // Supabase 일시정지 방지 핑을 겸한다
  const { data: farms, error } = await db.from("farms").select("id, name, lat, lng, region, nearest_station_id");
  if (error) throw error;
  const report: Record<string, unknown>[] = [];
  const nongsaroKey = process.env.NONGSARO_API_KEY;
  if (mode === "daily" && nongsaroKey) {
    try {
      report.push({ weeklyFarmInfo: await collectWeeklyFarmInfo(db, nongsaroKey, today) });
    } catch (e) {
      report.push({ weeklyFarmInfo: (e as Error).message });
    }
  }
  for (const farm of (farms ?? []) as Farm[]) {
    const r: Record<string, unknown> = { farm: farm.id };
    try {
      if (serviceKey) {
        r.weather = mode === "daily" ? await refreshFarmWeather(db, farm, serviceKey, today, hourKst) : await refreshAlertsOnly(db, farm, serviceKey, today);
      } else {
        r.weather = "DATA_GO_KR_SERVICE_KEY not set";
      }
      if (mode === "daily") {
        r.timing = await recomputeFarmTiming(db, farm, today);
        r.prevention = await syncPreventionTasks(db, farm, today);
      }
      const items = await collectFarmItems(db, farm, today, mode);
      r.items = items.length;
      r.sent = await notifyFarm(db, farm, items, today);
    } catch (e) {
      r.error = (e as Error).message;
    }
    report.push(r);
  }
  return report;
}

async function refreshAlertsOnly(db: SupabaseClient, farm: Farm, serviceKey: string, today: string) {
  const { fetchWarnings } = await import("@/lib/weather/kma");
  const office = nearest(farm.lat, farm.lng, WARNING_OFFICES);
  const alerts = await fetchWarnings(serviceKey, office.id, addDays(today, -1), today);
  if (alerts.length) {
    await db.from("weather_alerts").upsert(
      alerts.map((a) => ({ ...a, effective_from: a.announced_at, fetched_at: new Date().toISOString() })),
      { onConflict: "region_code,alert_type,announced_at", ignoreDuplicates: true },
    );
  }
  return { alerts: alerts.length };
}
