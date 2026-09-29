// 예방 방제 작업 생성 (계획서 M11 시기 기반 예방 방제)
// ① 식재 후 일수 ② 지역별 달력 기간 ③ 기상 조건(단기예보 연속 강우). 장마 시작일은 공식 예보가 없어 ②를 기본으로 ③으로 보완.
import { addDays } from "../dates";
import { isRainDay, nextOccurrence, type DailyForecast, type RainSettings } from "../weather/recommend";

export type PreventionSchedule = {
  id: string;
  crop_id: string;
  pest_name: string;
  basis: "days_after_planting" | "calendar_by_region" | "weather";
  days_after_planting: number | null;
  region: string | null;
  start_month: number | null;
  start_day: number | null;
  end_month: number | null;
  end_day: number | null;
  weather_condition: string | null;
  recommended_ingredients: string[] | null;
  source_text: string | null;
  source_url: string | null;
};

export type PreventionPlanting = {
  id: string;
  plan_crop_id: string;
  crop_id: string;
  crop_name: string;
  plantedOn: string;
};

export type PreventionTask = {
  planting_id: string;
  plan_crop_id: string;
  task_type: "pest_control";
  title: string;
  calculated_date: string;
  details: Record<string, unknown>;
  source_url: string | null;
  key: string; // 중복 생성 방지
};

// 단기예보에 강우 판정일이 이틀 이상 이어지면 첫날
export function consecutiveRainStart(forecast: DailyForecast[], rain: RainSettings, today: string): string | null {
  const days = forecast.filter((d) => d.date >= today);
  for (let i = 0; i + 1 < days.length; i++) {
    if (isRainDay(days[i], rain) && isRainDay(days[i + 1], rain)) return days[i].date;
  }
  return null;
}

export function preventionTasks(input: {
  today: string;
  region: string | null;
  plantings: PreventionPlanting[];
  schedules: PreventionSchedule[];
  forecast: DailyForecast[];
  rain: RainSettings;
}): PreventionTask[] {
  const out: PreventionTask[] = [];
  const rainStart = consecutiveRainStart(input.forecast, input.rain, input.today);

  for (const p of input.plantings) {
    const mine = input.schedules.filter((s) => s.crop_id === p.crop_id);
    // 지역 달력은 농장 지역 우선, 없으면 전국
    const calendar = mine.filter((s) => s.basis === "calendar_by_region");
    const regional = calendar.filter((s) => s.region === input.region);
    const usableCalendar = regional.length ? regional : calendar.filter((s) => s.region === "전국");

    for (const s of [...mine.filter((s) => s.basis !== "calendar_by_region"), ...usableCalendar]) {
      let date: string | null = null;
      let reason = "";
      if (s.basis === "days_after_planting" && s.days_after_planting !== null) {
        date = addDays(p.plantedOn, s.days_after_planting);
        reason = `심은 후 ${s.days_after_planting}일, ${s.pest_name} 예방`;
      } else if (s.basis === "calendar_by_region" && s.start_month && s.end_month) {
        const occ = nextOccurrence(
          { start_month: s.start_month, start_day: s.start_day ?? 1, end_month: s.end_month, end_day: s.end_day ?? 28 },
          input.today,
        );
        if (occ.end < p.plantedOn) continue;
        date = occ.start < p.plantedOn ? p.plantedOn : occ.start;
        reason = `${s.region ?? ""} ${s.start_month}월~${s.end_month}월 ${s.pest_name} 예방 시기`.trim();
      } else if (s.basis === "weather" && rainStart) {
        date = input.today;
        reason = `${s.weather_condition ?? "연속 강우"} — ${s.pest_name} 예방 (예보상 ${rainStart}부터 비)`;
      }
      if (!date) continue;
      const key = s.basis === "weather" ? `${s.id}:${p.id}:${rainStart}` : `${s.id}:${p.id}:${date.slice(0, 4)}`;
      out.push({
        planting_id: p.id,
        plan_crop_id: p.plan_crop_id,
        task_type: "pest_control",
        title: `${p.crop_name} ${s.pest_name} 예방 방제`,
        calculated_date: date,
        details: {
          key,
          reason,
          pest: s.pest_name,
          ingredients: s.recommended_ingredients ?? [],
          source_text: s.source_text,
        },
        source_url: s.source_url,
        key,
      });
    }
  }
  return out;
}
