import { describe, expect, it } from "vitest";
import {
  harvestRainAdvice,
  isRainDay,
  judgeWindow,
  nextOccurrence,
  seedlingStart,
  toDaily,
  weekRange,
  type DailyForecast,
} from "./recommend";

const day = (date: string, minC: number, maxC: number, pop = 10, pcpMm = 0): DailyForecast => ({ date, minC, maxC, pop, pcpMm });
const rain = { popThreshold: 60, mmThreshold: null };

describe("forecast helpers", () => {
  it("aggregates hourly to daily", () => {
    const d = toDaily([
      { fcst_date: "2026-10-01", fcst_hour: 6, pop: 20, pcp_mm: 0, tmp_c: 9 },
      { fcst_date: "2026-10-01", fcst_hour: 15, pop: 70, pcp_mm: 3, tmp_c: 18 },
      { fcst_date: "2026-10-02", fcst_hour: 6, pop: 0, pcp_mm: null, tmp_c: 7 },
    ]);
    expect(d).toEqual([
      { date: "2026-10-01", minC: 9, maxC: 18, pop: 70, pcpMm: 3 },
      { date: "2026-10-02", minC: 7, maxC: 7, pop: 0, pcpMm: 0 },
    ]);
  });

  it("rain uses probability and amount together", () => {
    expect(isRainDay(day("d", 0, 0, 60), rain)).toBe(true);
    expect(isRainDay(day("d", 0, 0, 40, 8), rain)).toBe(false);
    expect(isRainDay(day("d", 0, 0, 40, 8), { popThreshold: 60, mmThreshold: 5 })).toBe(true);
  });

  it("next occurrence rolls to next year after window ends", () => {
    const r = { start_month: 3, start_day: 1, end_month: 4, end_day: 30 };
    expect(nextOccurrence(r, "2026-03-15")).toEqual({ start: "2026-03-01", end: "2026-04-30" });
    expect(nextOccurrence(r, "2026-10-01")).toEqual({ start: "2027-03-01", end: "2027-04-30" });
    const wrap = { start_month: 11, start_day: 1, end_month: 2, end_day: 28 };
    expect(nextOccurrence(wrap, "2027-01-10")).toEqual({ start: "2026-11-01", end: "2027-02-28" });
  });

  it("week range is Monday to Sunday", () => {
    expect(weekRange("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" }); // 목요일
    expect(weekRange("2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-04" }); // 일요일
  });
});

describe("judgeWindow", () => {
  const forecast = [day("2026-10-01", 5, 14), day("2026-10-02", 9, 18), day("2026-10-03", 10, 20)];
  const crop = { min_temp_c: 8, max_temp_c: 25 };

  it("planned when window is beyond forecast, with last-year temps", () => {
    const r = judgeWindow([{ start_month: 10, start_day: 10, end_month: 10, end_day: 20 }], crop, forecast, "2026-10-01", [
      { obs_date: "2025-10-10", min_temp_c: 6, max_temp_c: 16 },
      { obs_date: "2025-10-11", min_temp_c: 8, max_temp_c: 18 },
    ]);
    expect(r).toEqual({ stage: "planned", start: "2026-10-10", end: "2026-10-20", lastYear: { minC: 7, maxC: 17 } });
  });

  it("confirmed on first day meeting temperature (temperature wins over calendar)", () => {
    const r = judgeWindow([{ start_month: 9, start_day: 25, end_month: 10, end_day: 10 }], crop, forecast, "2026-10-01", []);
    expect(r).toMatchObject({ stage: "confirmed", date: "2026-10-02", basis: "temperature" });
  });

  it("waiting when no day meets conditions", () => {
    const cold = [day("2026-10-01", 2, 10), day("2026-10-02", 3, 11)];
    const r = judgeWindow([{ start_month: 9, start_day: 25, end_month: 10, end_day: 10 }], crop, cold, "2026-10-01", []);
    expect(r.stage).toBe("waiting");
  });

  it("none without practice calendar", () => {
    expect(judgeWindow([], crop, forecast, "2026-10-01", [])).toEqual({ stage: "none" });
  });

  it("seedling start from planned transplant window, not confirmed date", () => {
    expect(seedlingStart([{ start_month: 5, start_day: 1, end_month: 5, end_day: 20 }], 70, "2026-01-10")).toBe("2026-02-20");
    expect(seedlingStart([], 70, "2026-01-10")).toBeNull();
  });
});

describe("harvestRainAdvice", () => {
  it("harvest earlier when a dry day exists before rain inside window", () => {
    const f = [day("2026-06-10", 15, 25), day("2026-06-11", 15, 25), day("2026-06-12", 15, 25, 80)];
    expect(harvestRainAdvice("2026-06-12", 3, 2, f, rain, "2026-06-10")).toEqual({
      action: "earlier",
      date: "2026-06-11",
      rainDates: ["2026-06-12"],
    });
  });

  it("delay to first day meeting wait condition when no dry day before rain", () => {
    const f = [day("2026-06-10", 15, 25, 90), day("2026-06-11", 15, 25, 70), day("2026-06-12", 15, 25)];
    expect(harvestRainAdvice("2026-06-10", 1, 2, f, rain, "2026-06-10")).toEqual({
      action: "later",
      date: "2026-06-13",
      rainDates: ["2026-06-10", "2026-06-11"],
    });
  });

  it("no advice without rain in window", () => {
    const f = [day("2026-06-10", 15, 25), day("2026-06-20", 15, 25, 90)];
    expect(harvestRainAdvice("2026-06-10", 2, 2, f, rain, "2026-06-10")).toBeNull();
  });
});
