import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item } from "./compose";
import type { DailyForecast } from "../weather/recommend";
import { heatExpected, heatRecommendations, type HeatCandidate } from "./heat-rules";

type Farm = { id: string; region: string | null };

const ORDER: Record<string, number> = { spring: 0, autumn: 1, overwinter: 2 };

// 단기예보 고온 또는 폭염특보 시, 고온 내성 낮음 작물이 재배 중이면 대응 안내와 이어 심을 작물 추천 (P6 요약에 포함)
export async function heatAdviceItems(
  db: SupabaseClient,
  farm: Farm,
  forecast: DailyForecast[],
  alerts: { alert_type: string; action: string | null }[],
  today: string,
): Promise<Item[]> {
  if (!heatExpected(forecast, alerts, today)) return [];

  const { data: weak } = await db
    .from("plantings")
    .select("id, crop_id, crops!inner(name, heat_tolerance), field_plans!inner(farm_id, status), planting_cells(field_plan_cells(x, y))")
    .eq("status", "active")
    .eq("field_plans.farm_id", farm.id)
    .eq("field_plans.status", "confirmed")
    .eq("crops.heat_tolerance", "low");
  if (!weak?.length) return [];

  const rows = weak as unknown as { crops: { name: string }; planting_cells: { field_plan_cells: { x: number; y: number } }[] }[];
  const cells = new Set(rows.flatMap((r) => r.planting_cells.map((c) => `${c.field_plan_cells.x},${c.field_plan_cells.y}`)));

  // 같은 칸들의 확정 작기별 과(科) 이력 (최근 순)
  const { data: plans } = await db
    .from("field_plans")
    .select("year, season, field_plan_cells(x, y, crops(family_id))")
    .eq("farm_id", farm.id)
    .eq("status", "confirmed");
  const history = ((plans ?? []) as unknown as { year: number; season: string; field_plan_cells: { x: number; y: number; crops: { family_id: string | null } }[] }[])
    .sort((a, b) => b.year - a.year || ORDER[b.season] - ORDER[a.season])
    .map((p) => new Set(p.field_plan_cells.filter((c) => cells.has(`${c.x},${c.y}`)).map((c) => c.crops.family_id).filter(Boolean) as string[]));

  const { data: strong } = await db
    .from("crops")
    .select("id, name, family_id, rotation_risk, rest_seasons, crop_regional_calendars(region, activity, start_month, start_day, end_month, end_day)")
    .eq("heat_tolerance", "high")
    .eq("status", "confirmed");
  const candidates: HeatCandidate[] = ((strong ?? []) as unknown as (Omit<HeatCandidate, "sowWindows"> & {
    crop_regional_calendars: { region: string; activity: string; start_month: number; start_day: number; end_month: number; end_day: number }[];
  })[]).map((c) => {
    const sow = c.crop_regional_calendars.filter((w) => w.activity !== "harvest");
    const regional = sow.filter((w) => w.region === farm.region);
    return { ...c, sowWindows: regional.length ? regional : sow.filter((w) => w.region === "전국") };
  });
  const recs = heatRecommendations(candidates, history, today);

  const { data: guide } = await db.from("weather_response_guides").select("guide_text").eq("situation", "heat_wave").is("crop_id", null).limit(1);
  const guideText = (guide?.[0]?.guide_text as string | undefined)?.split("\n")[0];
  const names = [...new Set(rows.map((r) => r.crops.name))].join(", ");
  return [
    {
      type: "heat_advice",
      text:
        `고온 예보: ${names}은(는) 더위에 약해요.` +
        (guideText ? ` ${guideText}` : "") +
        (recs.length ? ` 이어 심기 추천: ${recs.map((r) => r.name).join(", ")}` : ""),
    },
  ];
}
