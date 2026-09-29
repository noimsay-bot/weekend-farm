// 기후 보정 적기 안내(계획서 M5)와 수확기 강우 회피. 모두 단기예보 기준, KST date 문자열.
import { addDays, diffDays } from "../dates";

export type HourlyForecast = { fcst_date: string; fcst_hour: number; pop: number | null; pcp_mm: number | null; tmp_c: number | null };
export type DailyForecast = { date: string; minC: number | null; maxC: number | null; pop: number; pcpMm: number };
export type RainSettings = { popThreshold: number; mmThreshold: number | null };

export function toDaily(hourly: HourlyForecast[]): DailyForecast[] {
  const by = new Map<string, HourlyForecast[]>();
  for (const h of hourly) by.set(h.fcst_date, [...(by.get(h.fcst_date) ?? []), h]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hs]) => {
      const temps = hs.map((h) => h.tmp_c).filter((t): t is number => t !== null).map(Number);
      return {
        date,
        minC: temps.length ? Math.min(...temps) : null,
        maxC: temps.length ? Math.max(...temps) : null,
        pop: Math.max(0, ...hs.map((h) => Number(h.pop ?? 0))),
        pcpMm: hs.reduce((s, h) => s + Number(h.pcp_mm ?? 0), 0),
      };
    });
}

// 강우 판정: 강수확률과 예상 강수량을 함께 본다 (강수량 기준이 없으면 확률만).
export function isRainDay(day: DailyForecast, s: RainSettings): boolean {
  return day.pop >= s.popThreshold || (s.mmThreshold !== null && day.pcpMm >= s.mmThreshold);
}

export type WindowRange = { start_month: number; start_day: number; end_month: number; end_day: number; cropping_type?: string };

// 오늘 이후 가장 가까운 관행 기간의 실제 날짜 (이미 지난 기간은 내년)
export function nextOccurrence(range: WindowRange, today: string): { start: string; end: string } {
  const year = Number(today.slice(0, 4));
  const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const wraps = range.start_month * 100 + range.start_day > range.end_month * 100 + range.end_day;
  for (const y of [year - 1, year, year + 1]) {
    const start = fmt(y, range.start_month, range.start_day);
    const end = fmt(wraps ? y + 1 : y, range.end_month, range.end_day);
    if (end >= today) return { start, end };
  }
  return { start: fmt(year + 1, range.start_month, range.start_day), end: fmt(year + 1, range.end_month, range.end_day) };
}

export type TempCondition = { min_temp_c: number | null; max_temp_c: number | null };

export function meetsTemperature(day: DailyForecast, c: TempCondition): boolean {
  if (c.min_temp_c !== null && (day.minC === null || day.minC < Number(c.min_temp_c))) return false;
  if (c.max_temp_c !== null && (day.maxC === null || day.maxC > Number(c.max_temp_c))) return false;
  return true;
}

export type WindowResult =
  | { stage: "none" }
  | {
      stage: "planned";
      start: string;
      end: string;
      lastYear: { minC: number; maxC: number } | null;
    }
  | { stage: "waiting"; start: string; end: string }
  | { stage: "confirmed"; date: string; start: string; end: string; basis: "temperature" | "calendar" };

export type Observation = { obs_date: string; min_temp_c: number | null; max_temp_c: number | null };

function lastYearTemps(start: string, end: string, obs: Observation[]) {
  const from = addDays(start, -365);
  const to = addDays(end, -365);
  const rows = obs.filter((o) => o.obs_date >= from && o.obs_date <= to && o.min_temp_c !== null && o.max_temp_c !== null);
  if (!rows.length) return null;
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return { minC: avg(rows.map((r) => Number(r.min_temp_c))), maxC: avg(rows.map((r) => Number(r.max_temp_c))) };
}

// 2단계 판정: 관행 기간이 단기예보 범위 밖이면 '예정', 안이면 기후조건 충족일로 '확정', 없으면 '아직 이름'.
export function judgeWindow(
  ranges: WindowRange[],
  crop: TempCondition,
  forecast: DailyForecast[],
  today: string,
  observations: Observation[],
): WindowResult {
  if (ranges.length === 0) return { stage: "none" };
  const occurrences = ranges.map((r) => nextOccurrence(r, today)).sort((a, b) => a.start.localeCompare(b.start));
  const { start, end } = occurrences[0];
  const horizon = forecast.length ? forecast[forecast.length - 1].date : today;

  if (start > horizon) {
    return { stage: "planned", start, end, lastYear: lastYearTemps(start, end, observations) };
  }
  const hasCondition = crop.min_temp_c !== null || crop.max_temp_c !== null;
  const candidates = forecast.filter((d) => d.date >= today && d.date >= start && d.date <= end);
  const ok = candidates.find((d) => meetsTemperature(d, crop));
  if (ok) return { stage: "confirmed", date: ok.date, start, end, basis: hasCondition ? "temperature" : "calendar" };
  return { stage: "waiting", start, end };
}

// 육묘 시작 권장 시기 = '예정' 단계의 관행 정식 시작일 - 육묘일수 (확정 정식일로 계산하지 않음)
export function seedlingStart(transplantRanges: WindowRange[], seedlingDays: number | null, today: string): string | null {
  if (!seedlingDays || transplantRanges.length === 0) return null;
  const starts = transplantRanges.map((r) => nextOccurrence(r, today).start).sort();
  return addDays(starts[0], -seedlingDays);
}

export type HarvestAdvice = { action: "earlier" | "later"; date: string; rainDates: string[] } | null;

// 수확 예정일 ± 수확 적기 폭이 예보와 겹치고 그 안에 비가 있으면:
// (a) 비 전에 적기 폭 안에서 수확 가능한 날(예정일에 가장 가까운 날)로 앞당기기
// (b) 없으면 마지막 강우일 + 대기 일수(최소 1일)로 늦추기
export function harvestRainAdvice(
  due: string,
  windowDays: number | null,
  rainWaitDays: number | null,
  forecast: DailyForecast[],
  settings: RainSettings,
  today: string,
): HarvestAdvice {
  const w = windowDays ?? 0;
  const from = addDays(due, -w);
  const to = addDays(due, w);
  const inWindow = forecast.filter((d) => d.date >= from && d.date <= to && d.date >= today);
  const rain = inWindow.filter((d) => isRainDay(d, settings)).map((d) => d.date);
  if (rain.length === 0) return null;

  const firstRain = rain[0];
  const dryBefore = inWindow.filter((d) => d.date < firstRain && !isRainDay(d, settings));
  if (dryBefore.length) {
    const best = dryBefore.sort((a, b) => Math.abs(diffDays(a.date, due)) - Math.abs(diffDays(b.date, due)))[0];
    return { action: "earlier", date: best.date, rainDates: rain };
  }
  // 첫 비부터 이어지는 강우일 묶음의 마지막 날 이후
  const allRain = forecast.filter((d) => d.date >= firstRain && isRainDay(d, settings)).map((d) => d.date);
  let last = firstRain;
  for (const d of allRain) if (diffDays(d, last) <= 1) last = d;
  return { action: "later", date: addDays(last, Math.max(1, rainWaitDays ?? 0)), rainDates: rain };
}

// 이번 주(KST 월~일) 범위
export function weekRange(today: string): { start: string; end: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일
  const start = addDays(today, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 6) };
}
