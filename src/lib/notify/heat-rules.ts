// 폭염기 대체 작물 추천 (계획서 M10). 추천만 하고 계획을 바꾸지 않는다.
import { addDays } from "../dates";
import { inMonthDayRange } from "../dates";
import type { DailyForecast } from "../weather/recommend";

// 기상청 폭염주의보 기준(일 최고기온 33℃ 이상)을 단기예보 고온 판단에 쓴다.
export const HEAT_MAX_C = 33;

export function heatExpected(forecast: DailyForecast[], alerts: { alert_type: string; action: string | null }[], today: string): boolean {
  if (alerts.some((a) => a.alert_type === "폭염" && a.action !== "해제")) return true;
  return forecast.some((d) => d.date >= today && d.maxC !== null && d.maxC >= HEAT_MAX_C);
}

export type HeatCandidate = {
  id: string;
  name: string;
  family_id: string | null;
  rotation_risk: "high" | "low" | null;
  rest_seasons: number | null;
  sowWindows: { start_month: number; start_day: number; end_month: number; end_day: number }[];
};

// 고온 내성 높음 작물 중 관행 파종 기간이 앞으로 2주 안에 맞고, 연작 경고가 없는 작물
// history: 같은 칸들의 과거 확정 작기(최근 순, 0 = 현재 작기)에 있던 과(科)들
export function heatRecommendations(candidates: HeatCandidate[], history: Set<string>[], today: string): HeatCandidate[] {
  const soon = [0, 7, 14].map((d) => addDays(today, d));
  return candidates.filter((c) => {
    if (!c.sowWindows.some((w) => soon.some((d) => inMonthDayRange(d, w)))) return false;
    if (c.rotation_risk === "high" && c.family_id) {
      const seasons = Math.max(1, c.rest_seasons ?? 1);
      if (history.slice(0, seasons + 1).some((fams) => fams.has(c.family_id!))) return false;
    }
    return true;
  });
}
