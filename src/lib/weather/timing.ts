// 농장 단위 적기·강우 회피 계산 (크론과 "이번 주 적기" 조회가 함께 쓴다). DB 접근 없는 순수 함수.
import { addDays } from "../dates";
import {
  harvestRainAdvice,
  judgeMeanTemp,
  judgeWindow,
  nextOccurrence,
  seedlingStart,
  weekRange,
  type DailyForecast,
  type HarvestAdvice,
  type Observation,
  type RainSettings,
  type TempWindow,
  type WindowRange,
  type WindowResult,
} from "./recommend";

export type TimingCrop = {
  id: string;
  name: string;
  sow_method: "direct" | "transplant" | "both" | null;
  min_temp_c: number | null;
  max_temp_c: number | null;
  seedling_days: number | null;
  harvest_avoid_rain: boolean | null;
  harvest_window_days: number | null;
  rain_wait_days: number | null;
  temp_windows?: (TempWindow & { activity: "sow" | "transplant" })[];
};

export type TimingPlanting = {
  id: string;
  crop_id: string;
  method: "direct" | "transplant" | null;
  sow_date: string | null;
  transplant_date: string | null;
  planned_plant_count: number | null;
  window_stage: string | null;
  window_date: string | null;
  seedling_notified_on: string | null;
};

export type TimingCalendar = WindowRange & { crop_id: string; region: string; activity: "sow" | "transplant" | "harvest" };

export type TimingTask = {
  id: string;
  planting_id: string | null;
  crop_id: string;
  calculated_date: string;
  adjusted_date: string | null;
  status: string;
};

export type WeeklyItem = {
  kind: "sow" | "transplant" | "seedling" | "harvest";
  plantingId: string | null;
  taskId?: string;
  cropName: string;
  label: string;
  date: string | null;
  seedlings?: number | null;
  advice?: HarvestAdvice;
};

export type TimingOutput = {
  plantingUpdates: { id: string; window_stage: string; window_date: string | null }[];
  events: { type: "sowing_window" | "seedling_start" | "harvest_rain"; payload: Record<string, unknown> }[];
  seedlingNotified: string[];
  taskRecommendations: { id: string; recommendation: HarvestAdvice }[];
  weekly: WeeklyItem[];
};

// 지역 관행 시기 (없으면 '전국')
export function rangesFor(calendars: TimingCalendar[], cropId: string, activity: "sow" | "transplant", region: string | null) {
  const rows = calendars.filter((c) => c.crop_id === cropId && c.activity === activity);
  const regional = rows.filter((c) => c.region === region);
  return regional.length ? regional : rows.filter((c) => c.region === "전국");
}

function activityOf(p: TimingPlanting, crop: TimingCrop, calendars: TimingCalendar[], region: string | null): "sow" | "transplant" {
  if (p.method) return p.method === "direct" ? "sow" : "transplant";
  if (crop.sow_method === "direct") return "sow";
  if (crop.sow_method === "transplant") return "transplant";
  return rangesFor(calendars, crop.id, "transplant", region).length ? "transplant" : "sow";
}

// 일평균기온 기준(작형별)이 있으면 먼저 판정한다. 봄 작형(rising)은 1~7월, 가을 작형(falling)은 7~12월에만 본다.
// 적기(오늘·예보 안)가 있으면 그것을, 모두 지났으면 '늦음', 판단할 수 없으면 null(관행 날짜 판정으로).
function judgeByTemp(
  crop: TimingCrop,
  activity: "sow" | "transplant",
  ranges: TimingCalendar[],
  forecast: DailyForecast[],
  observations: Observation[],
  today: string,
): WindowResult | null {
  const month = Number(today.slice(5, 7));
  const windows = (crop.temp_windows ?? []).filter(
    (w) => w.activity === activity && (w.trend === "rising" ? month <= 7 : month >= 7),
  );
  if (windows.length === 0) return null;
  const results = windows.map((w) => {
    const ref = ranges.filter((r) => (r.cropping_type ?? "") === w.cropping_type);
    const occ = (ref.length ? ref : ranges).map((r) => nextOccurrence(r, today)).sort((a, b) => a.start.localeCompare(b.start))[0];
    return judgeMeanTemp(w, forecast, observations, today, occ ?? { start: today, end: today });
  });
  const confirmed = results.filter((r): r is Extract<WindowResult, { stage: "confirmed" }> => r?.stage === "confirmed").sort((a, b) => a.date.localeCompare(b.date));
  if (confirmed.length) return confirmed[0];
  if (results.every((r) => r?.stage === "late")) return results[0];
  return null;
}

const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function computeFarmTiming(input: {
  today: string;
  region: string | null;
  forecast: DailyForecast[];
  rain: RainSettings;
  observations: Observation[];
  crops: TimingCrop[];
  plantings: TimingPlanting[];
  calendars: TimingCalendar[];
  harvestTasks: TimingTask[];
}): TimingOutput {
  const { today, region } = input;
  const cropById = new Map(input.crops.map((c) => [c.id, c]));
  const week = weekRange(today);
  const inWeek = (d: string | null) => d !== null && d >= week.start && d <= week.end;
  const out: TimingOutput = { plantingUpdates: [], events: [], seedlingNotified: [], taskRecommendations: [], weekly: [] };

  for (const p of input.plantings) {
    const crop = cropById.get(p.crop_id);
    if (!crop || p.sow_date || p.transplant_date) continue; // 이미 심은 식재는 적기 판정 대상이 아님
    const activity = activityOf(p, crop, input.calendars, region);
    const verb = activity === "sow" ? "파종" : "정식";
    const ranges = rangesFor(input.calendars, crop.id, activity, region);
    const result: WindowResult =
      judgeByTemp(crop, activity, ranges, input.forecast, input.observations, today) ??
      judgeWindow(ranges, crop, input.forecast, today, input.observations);
    const seedlings = activity === "transplant" ? p.planned_plant_count : null;

    if (result.stage !== "none") {
      const date = result.stage === "confirmed" ? result.date : null;
      if (p.window_stage !== result.stage || p.window_date !== date) {
        out.plantingUpdates.push({ id: p.id, window_stage: result.stage, window_date: date });
        // 확정은 적기 당일이 아니라 확정되는 즉시 알린다
        if (result.stage === "confirmed") {
          out.events.push({
            type: "sowing_window",
            payload: { planting_id: p.id, crop: crop.name, activity, date, seedlings },
          });
        }
      }
    }

    if (result.stage === "confirmed" && result.date <= week.end) {
      out.weekly.push({
        kind: activity,
        plantingId: p.id,
        cropName: crop.name,
        label: `${verb} 적기 ${fmt(result.date)}${result.meanC !== undefined ? ` · 일평균 ${result.meanC}℃` : ""}${seedlings ? ` · 모종 ${seedlings}개 필요` : ""}`,
        date: result.date,
        seedlings,
      });
    } else if ((result.stage === "planned" || result.stage === "waiting") && result.start <= week.end && result.end >= week.start) {
      out.weekly.push({
        kind: activity,
        plantingId: p.id,
        cropName: crop.name,
        label:
          result.stage === "planned"
            ? `관행 ${verb} 기간 ${fmt(result.start)}~${fmt(result.end)} (예보 확정 전)`
            : `${verb}하기 아직 이름 — 기다리세요`,
        date: null,
        seedlings,
      });
    }

    if (result.stage === "late") {
      out.weekly.push({ kind: activity, plantingId: p.id, cropName: crop.name, label: `${verb} 적기 지남 · 지금 일평균 ${result.meanC}℃`, date: null, seedlings });
    }

    // 육묘 시작 권장 시기: 관행 정식 시작일 - 육묘일수 (안내만)
    if (activity === "transplant") {
      const start = seedlingStart(rangesFor(input.calendars, crop.id, "transplant", region), crop.seedling_days, today);
      if (start) {
        if (inWeek(start)) {
          out.weekly.push({ kind: "seedling", plantingId: p.id, cropName: crop.name, label: `육묘 시작 권장 ${fmt(start)}`, date: start });
        }
        if (start <= today && addDays(start, 14) >= today && !p.seedling_notified_on) {
          out.events.push({ type: "seedling_start", payload: { planting_id: p.id, crop: crop.name, date: start } });
          out.seedlingNotified.push(p.id);
        }
      }
    }
  }

  // 수확기 강우 회피
  for (const t of input.harvestTasks) {
    if (t.status !== "pending") continue;
    const crop = cropById.get(t.crop_id);
    if (!crop) continue;
    const due = t.adjusted_date ?? t.calculated_date;
    const advice = crop.harvest_avoid_rain
      ? harvestRainAdvice(due, crop.harvest_window_days, crop.rain_wait_days, input.forecast, input.rain, today)
      : null;
    out.taskRecommendations.push({ id: t.id, recommendation: advice });
    if (advice) {
      out.events.push({ type: "harvest_rain", payload: { task_id: t.id, crop: crop.name, ...advice } });
    }
    if (inWeek(due) || (advice && inWeek(advice.date))) {
      out.weekly.push({
        kind: "harvest",
        plantingId: t.planting_id,
        taskId: t.id,
        cropName: crop.name,
        label: advice
          ? `수확 ${advice.action === "earlier" ? "앞당기기" : "늦추기"} 권장 ${fmt(advice.date)} (비 예보)`
          : `수확 예정 ${fmt(due)}`,
        date: advice?.date ?? due,
        advice,
      });
    }
  }

  out.weekly.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return out;
}
