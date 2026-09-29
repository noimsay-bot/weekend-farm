// 일일 알림 판정 규칙 (계획서 M4·M6). DB 접근 없는 순수 함수.
import { addDays, diffDays } from "../dates";
import { isRainDay, type DailyForecast } from "../weather/recommend";

// 비 자동 기록: 전일 관측 강수량이 물주기 대체 기준 이상일 때만 (기준이 없으면 만들지 않음)
export function shouldLogRain(rainMm: number | null, wateringRainMm: number | null): boolean {
  return rainMm !== null && wateringRainMm !== null && rainMm >= wateringRainMm;
}

export type WateringCrop = {
  planCropId: string;
  cropName: string;
  intervalDays: number | null;
  plantedOn: string | null; // 기록이 없을 때 기준일
};

export type WateringLog = { plan_crop_id: string; work_date: string; work_type: "watering" | "rain" };

// 작물별 물주기: 마지막 물주기(또는 비 기록) 이후 간격이 지났고, 단기예보에 기준 이상 비가 없으면 알림
export function wateringDue(
  crops: WateringCrop[],
  logs: WateringLog[],
  forecast: DailyForecast[],
  rain: { popThreshold: number; wateringRainMm: number | null },
  today: string,
) {
  const rainSoon = forecast
    .filter((d) => d.date >= today && d.date <= addDays(today, 2))
    .some((d) =>
      rain.wateringRainMm !== null ? d.pcpMm >= rain.wateringRainMm : isRainDay(d, { popThreshold: rain.popThreshold, mmThreshold: null }),
    );
  if (rainSoon) return [];

  const out: { planCropId: string; cropName: string; daysSince: number; lastType: "watering" | "rain" | "planted" }[] = [];
  for (const c of crops) {
    if (!c.intervalDays) continue;
    const mine = logs.filter((l) => l.plan_crop_id === c.planCropId && l.work_date <= today).sort((a, b) => b.work_date.localeCompare(a.work_date));
    const last = mine[0];
    const base = last?.work_date ?? c.plantedOn;
    if (!base) continue;
    const since = diffDays(today, base);
    if (since >= c.intervalDays) {
      out.push({ planCropId: c.planCropId, cropName: c.cropName, daysSince: since, lastType: last ? last.work_type : "planted" });
    }
  }
  return out;
}

// 배수점검: 단기예보 예상 강수량이 기준 이상이거나 호우특보 발표
export function drainageAlert(
  forecast: DailyForecast[],
  drainageMm: number | null,
  alerts: { alert_type: string; action: string | null }[],
  today: string,
): { reason: string } | null {
  const heavy = alerts.find((a) => a.alert_type === "호우" && a.action !== "해제");
  if (heavy) return { reason: "호우특보" };
  if (drainageMm === null) return null;
  const day = forecast.find((d) => d.date >= today && d.pcpMm >= drainageMm);
  return day ? { reason: `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))} 예상 강수량 ${day.pcpMm}mm` } : null;
}

export type PesticideUse = {
  planCropId: string;
  cropName: string;
  appliedOn: string;
  ingredient: string;
  safeDays: number | null;
};

// 방제 안전사용기준: 수확 예정일이 '마지막 살포일 + 수확 전 금지일수'보다 빠르면 경고
export function preHarvestConflicts(uses: PesticideUse[], harvests: { planCropId: string; date: string }[]) {
  const out: { planCropId: string; cropName: string; ingredient: string; harvestDate: string; safeFrom: string }[] = [];
  for (const u of uses) {
    if (u.safeDays === null) continue;
    const safeFrom = addDays(u.appliedOn, u.safeDays);
    for (const h of harvests.filter((h) => h.planCropId === u.planCropId)) {
      if (h.date < safeFrom) out.push({ planCropId: u.planCropId, cropName: u.cropName, ingredient: u.ingredient, harvestDate: h.date, safeFrom });
    }
  }
  return out;
}

// 서리 가능성: 단기예보 최저기온이 0℃ 이하인 날
export function frostDays(forecast: DailyForecast[], today: string): string[] {
  return forecast.filter((d) => d.date >= today && d.minC !== null && d.minC <= 0).map((d) => d.date);
}
