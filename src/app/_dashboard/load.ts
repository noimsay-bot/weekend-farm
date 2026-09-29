import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPesticideConflicts, loadWateringDue } from "@/lib/alerts";
import { badgesByPlanting, type Badge, type BadgeTask } from "@/lib/dashboard/badges";
import { addDays, formatKDate } from "@/lib/dates";
import type { FertilizerRow, ProductRow } from "@/lib/fertilizer-text";
import { drainageAlert, frostDays } from "@/lib/notify/rules";
import { seasonOf } from "@/lib/season";
import { toKmaGrid } from "@/lib/weather/grid";
import { getWeeklyWindows } from "@/lib/weather/load";
import { toDaily } from "@/lib/weather/recommend";
import { nearest, WARNING_OFFICES } from "@/lib/weather/stations";
import type { WeeklyItem } from "@/lib/weather/timing";

const ORDER: Record<string, number> = { spring: 0, autumn: 1, overwinter: 2 };

export type DashPlanting = {
  id: string;
  planCropId: string;
  cropId: string;
  cropName: string;
  plantedOn: string | null;
  plantCount: number | null;
  cells: { x: number; y: number }[];
};

export type DashboardData = {
  today: string;
  farmId: string;
  planId: string;
  planLabel: { year: number; season: string };
  cols: number;
  rows: number;
  cellSizeM: number;
  cells: { x: number; y: number; crop_id: string; companion_crop_id: string | null; carry_state: string | null }[];
  cropNames: Record<string, string>;
  plantings: DashPlanting[];
  badges: Record<string, Badge[]>;
  todo: (Badge & { cropName: string; plantingId: string | null })[];
  weekly: WeeklyItem[];
  fertilizers: Record<string, (FertilizerRow & { sequence: number; source_url: string | null })[]>;
  pests: Record<string, { pest_name: string; ingredient_name: string; moa_code: string | null; formulation: string | null; dilution_factor: number | null; safe_days_before_harvest: number | null; max_applications: number | null; is_organic: boolean }[]>;
  products: ProductRow[];
  productSettings: { usage: string; product_id: string }[];
};

export async function loadDashboard(db: SupabaseClient, farmId: string, today: string): Promise<DashboardData | null> {
  const { data: farm } = await db.from("farms").select("id, lat, lng, region, nearest_station_id, width_m, height_m").eq("id", farmId).single();
  if (!farm) return null;

  const { data: plantingRows } = await db
    .from("plantings")
    .select(
      "id, plan_id, plan_crop_id, crop_id, sow_date, transplant_date, plant_count, planned_plant_count, crops(name), field_plans!inner(farm_id, status, year, season), planting_cells(field_plan_cells(x, y, plan_id))",
    )
    .eq("status", "active")
    .eq("field_plans.farm_id", farmId)
    .eq("field_plans.status", "confirmed");
  type Row = {
    id: string;
    plan_id: string;
    plan_crop_id: string;
    crop_id: string;
    sow_date: string | null;
    transplant_date: string | null;
    plant_count: number | null;
    planned_plant_count: number | null;
    crops: { name: string };
    field_plans: { year: number; season: string };
    planting_cells: { field_plan_cells: { x: number; y: number; plan_id: string } }[];
  };
  const rows = (plantingRows ?? []) as unknown as Row[];
  if (!rows.some((r) => r.sow_date || r.transplant_date)) return null;

  // 표시할 계획: 이번 작기 확정 계획, 없으면 재배 중 식재가 있는 가장 최근 계획
  const cur = seasonOf(today);
  const plans = [...new Map(rows.map((r) => [r.plan_id, { id: r.plan_id, ...r.field_plans }])).values()].sort(
    (a, b) => b.year * 3 + ORDER[b.season] - (a.year * 3 + ORDER[a.season]),
  );
  const shown = plans.find((p) => p.year === cur.year && p.season === cur.season) ?? plans[0];

  const { nx, ny } = toKmaGrid(farm.lat, farm.lng);
  const office = nearest(farm.lat, farm.lng, WARNING_OFFICES);
  const [cellsRes, settingsRes, tasksRes, leadRes, activeRes, hourlyRes, alertsRes, productsRes, productSettingsRes] = await Promise.all([
    db.from("field_plan_cells").select("x, y, crop_id, companion_crop_id, carry_state, carried_from_planting_id").eq("plan_id", shown.id),
    db.from("farm_settings").select("*").eq("farm_id", farmId).single(),
    db
      .from("tasks")
      .select("id, planting_id, plan_crop_id, task_type, title, calculated_date, adjusted_date, details, source_url")
      .eq("farm_id", farmId)
      .eq("status", "pending"),
    db.from("dashboard_settings").select("task_type, badge_lead_days").eq("farm_id", farmId),
    db.from("active_plan_crops").select("id, crop_id, crop_name, is_companion").eq("farm_id", farmId),
    db.from("weather_cache").select("fcst_date, fcst_hour, pop, pcp_mm, tmp_c").eq("nx", nx).eq("ny", ny).gte("fcst_date", today),
    db.from("weather_alerts").select("alert_type, level, action, announced_at").eq("region_code", office.id).gte("announced_at", `${addDays(today, -1)}T00:00:00+09:00`),
    db.from("fertilizer_products").select("id, farm_id, name, n_pct, p_pct, k_pct, is_default"),
    db.from("farm_fertilizer_settings").select("usage, product_id").eq("farm_id", farmId),
  ]);

  const cells = cellsRes.data ?? [];
  const settings = settingsRes.data;
  const active = activeRes.data ?? [];
  const forecast = toDaily(hourlyRes.data ?? []);
  const alerts = alertsRes.data ?? [];

  const plantings: DashPlanting[] = rows.map((r) => ({
    id: r.id,
    planCropId: r.plan_crop_id,
    cropId: r.crop_id,
    cropName: r.crops.name,
    plantedOn: r.transplant_date ?? r.sow_date,
    plantCount: r.plant_count ?? r.planned_plant_count,
    cells: [
      ...r.planting_cells.filter((c) => c.field_plan_cells.plan_id === shown.id).map((c) => ({ x: c.field_plan_cells.x, y: c.field_plan_cells.y })),
      ...cells.filter((c) => c.carried_from_planting_id === r.id).map((c) => ({ x: c.x, y: c.y })),
    ],
  }));

  // 기상 경보 배지 (모든 영역)
  const weather: Badge[] = [];
  for (const a of alerts) {
    if (["폭염", "한파", "태풍", "호우"].includes(a.alert_type) && a.action !== "해제") {
      weather.push({ id: `alert-${a.alert_type}`, kind: "weather", state: "weather", title: `${a.alert_type}${a.level ?? ""}`, date: null });
    }
  }
  const frost = frostDays(forecast, today);
  if (frost.length) weather.push({ id: "frost", kind: "weather", state: "weather", title: `서리 주의 ${frost.map(formatKDate).join(", ")}`, date: frost[0] });
  const drain = drainageAlert(forecast, settings?.drainage_check_mm === null || settings?.drainage_check_mm === undefined ? null : Number(settings.drainage_check_mm), alerts, today);
  if (drain) weather.push({ id: "drainage", kind: "weather", state: "weather", title: `배수로 점검 (${drain.reason})`, date: null });

  // 작물 단위 배지: 물주기, 방제 주의, 주간농사정보
  const cropBadges: { planCropId: string; badge: Badge }[] = [];
  if (settings?.watering_alert_enabled) {
    for (const w of await loadWateringDue(db, active, forecast, settings, today)) {
      cropBadges.push({
        planCropId: w.planCropId,
        badge: {
          id: `water-${w.planCropId}`,
          kind: "watering",
          state: "upcoming",
          title: `${w.cropName} 물주기`,
          date: today,
          detail: { reason: `마지막 ${w.lastType === "rain" ? "비" : w.lastType === "watering" ? "물주기" : "심은 날"} 후 ${w.daysSince}일`, planCropId: w.planCropId },
        },
      });
    }
  }
  for (const c of await loadPesticideConflicts(db, farmId, today)) {
    cropBadges.push({
      planCropId: c.planCropId,
      badge: {
        id: `safety-${c.planCropId}-${c.ingredient}`,
        kind: "pesticide_safety",
        state: "upcoming",
        title: `${c.cropName} 방제 주의`,
        date: c.harvestDate,
        detail: { reason: `${c.ingredient} 수확 전 금지기간 — ${formatKDate(c.safeFrom)}부터 수확하세요` },
      },
    });
  }
  const cropIds = [...new Set(active.map((a) => a.crop_id))];
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [weeklyInfo, ferts, pests] = await Promise.all([
    db.from("weekly_farm_info").select("crop_id, crop_name, summary, source_url").in("crop_id", cropIds.length ? cropIds : none).gte("week_start", addDays(today, -7)),
    db.from("crop_fertilizer_schedules").select("*").in("crop_id", cropIds.length ? cropIds : none),
    db.from("crop_pest_controls").select("*").in("crop_id", cropIds.length ? cropIds : none),
  ]);
  for (const w of weeklyInfo.data ?? []) {
    for (const a of active.filter((a) => a.crop_id === w.crop_id && !a.is_companion)) {
      cropBadges.push({
        planCropId: a.id,
        badge: { id: `weekly-${a.id}`, kind: "prevention", state: "upcoming", title: `${w.crop_name} 주간농사정보`, date: today, detail: { reason: w.summary, source_url: w.source_url } },
      });
    }
  }

  const leadDays = new Map((leadRes.data ?? []).map((l) => [l.task_type as string, l.badge_lead_days as number]));
  const badgeMap = badgesByPlanting({
    today,
    plantings: plantings.map((p) => ({ plantingId: p.id, planCropId: p.planCropId })),
    tasks: (tasksRes.data ?? []) as BadgeTask[],
    leadDays,
    cropBadges,
    weather,
  });

  // 오늘·이번 주 할 일 (배지 중복 제거)
  const seen = new Set<string>();
  const todo: DashboardData["todo"] = [];
  for (const p of plantings) {
    for (const b of badgeMap.get(p.id) ?? []) {
      if (seen.has(b.id) || (b.date && b.date > addDays(today, 7) && b.state !== "weather")) continue;
      seen.add(b.id);
      todo.push({ ...b, cropName: b.kind === "weather" ? "" : p.cropName, plantingId: b.kind === "weather" ? null : p.id });
    }
  }

  const byCrop = <T extends { crop_id: string }>(list: T[]) =>
    list.reduce<Record<string, T[]>>((acc, r) => ((acc[r.crop_id] ??= []).push(r), acc), {});

  return {
    today,
    farmId,
    planId: shown.id,
    planLabel: { year: shown.year, season: shown.season },
    cols: Math.max(1, Math.ceil(Number(farm.width_m) / Number(settings?.cell_size_m ?? 0.5))),
    rows: Math.max(1, Math.ceil(Number(farm.height_m) / Number(settings?.cell_size_m ?? 0.5))),
    cellSizeM: Number(settings?.cell_size_m ?? 0.5),
    cells,
    cropNames: Object.fromEntries([...rows.map((r) => [r.crop_id, r.crops.name]), ...active.map((a) => [a.crop_id, a.crop_name])]),
    plantings,
    badges: Object.fromEntries(badgeMap),
    todo,
    weekly: await getWeeklyWindows(db, farm, today),
    fertilizers: byCrop((ferts.data ?? []) as (FertilizerRow & { crop_id: string; sequence: number; source_url: string | null })[]),
    pests: byCrop((pests.data ?? []) as (DashboardData["pests"][string][number] & { crop_id: string })[]),
    products: (productsRes.data ?? []) as ProductRow[],
    productSettings: productSettingsRes.data ?? [],
  };
}
