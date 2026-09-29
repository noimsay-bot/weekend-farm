import { describe, expect, it } from "vitest";
import { computeFarmTiming, type TimingCrop, type TimingPlanting } from "./timing";
import type { DailyForecast } from "./recommend";

const crop = (over: Partial<TimingCrop>): TimingCrop => ({
  id: "c",
  name: "배추",
  sow_method: "transplant",
  min_temp_c: 8,
  max_temp_c: 25,
  seedling_days: 25,
  harvest_avoid_rain: false,
  harvest_window_days: null,
  rain_wait_days: null,
  ...over,
});

const planting = (over: Partial<TimingPlanting>): TimingPlanting => ({
  id: "p",
  crop_id: "c",
  method: null,
  sow_date: null,
  transplant_date: null,
  planned_plant_count: 12,
  window_stage: null,
  window_date: null,
  seedling_notified_on: null,
  ...over,
});

const day = (date: string, minC: number, maxC: number, pop = 0): DailyForecast => ({ date, minC, maxC, pop, pcpMm: 0 });
const base = {
  today: "2026-10-01",
  region: "중부",
  rain: { popThreshold: 60, mmThreshold: null },
  observations: [],
  forecast: [day("2026-10-01", 5, 15), day("2026-10-02", 10, 20), day("2026-10-03", 11, 21)],
};

describe("computeFarmTiming", () => {
  it("confirms transplant window with seedlings needed and emits event once", () => {
    const calendars = [
      { crop_id: "c", region: "전국", activity: "transplant" as const, start_month: 9, start_day: 25, end_month: 10, end_day: 10 },
    ];
    const out = computeFarmTiming({ ...base, crops: [crop({})], plantings: [planting({})], calendars, harvestTasks: [] });
    expect(out.plantingUpdates).toEqual([{ id: "p", window_stage: "confirmed", window_date: "2026-10-02" }]);
    expect(out.events).toEqual([
      { type: "sowing_window", payload: { planting_id: "p", crop: "배추", activity: "transplant", date: "2026-10-02", seedlings: 12 } },
    ]);
    expect(out.weekly[0].label).toBe("정식 적기 10/2 · 모종 12개 필요");

    // 이미 같은 날짜로 확정돼 있으면 다시 알리지 않는다
    const again = computeFarmTiming({
      ...base,
      crops: [crop({})],
      plantings: [planting({ window_stage: "confirmed", window_date: "2026-10-02" })],
      calendars,
      harvestTasks: [],
    });
    expect(again.events).toEqual([]);
  });

  it("prefers regional calendar over nationwide", () => {
    const calendars = [
      { crop_id: "c", region: "전국", activity: "transplant" as const, start_month: 9, start_day: 25, end_month: 10, end_day: 10 },
      { crop_id: "c", region: "중부", activity: "transplant" as const, start_month: 11, start_day: 1, end_month: 11, end_day: 20 },
    ];
    const out = computeFarmTiming({ ...base, crops: [crop({})], plantings: [planting({})], calendars, harvestTasks: [] });
    expect(out.plantingUpdates[0].window_stage).toBe("planned");
  });

  it("skips plantings that already have dates", () => {
    const calendars = [
      { crop_id: "c", region: "전국", activity: "transplant" as const, start_month: 9, start_day: 25, end_month: 10, end_day: 10 },
    ];
    const out = computeFarmTiming({
      ...base,
      crops: [crop({})],
      plantings: [planting({ transplant_date: "2026-09-20" })],
      calendars,
      harvestTasks: [],
    });
    expect(out.plantingUpdates).toEqual([]);
  });

  it("seedling start event from practice window minus seedling days", () => {
    const calendars = [
      { crop_id: "c", region: "전국", activity: "transplant" as const, start_month: 10, start_day: 20, end_month: 10, end_day: 31 },
    ];
    // 10/20 - 25일 = 9/25 → 오늘(10/1)이 권장 시기 이후 2주 안
    const out = computeFarmTiming({ ...base, crops: [crop({})], plantings: [planting({})], calendars, harvestTasks: [] });
    expect(out.events).toContainEqual({ type: "seedling_start", payload: { planting_id: "p", crop: "배추", date: "2026-09-25" } });
    expect(out.seedlingNotified).toEqual(["p"]);
  });

  it("attaches harvest rain advice to harvest tasks of rain-avoid crops", () => {
    const potato = crop({ id: "k", name: "감자", harvest_avoid_rain: true, harvest_window_days: 3, rain_wait_days: 2 });
    const out = computeFarmTiming({
      ...base,
      forecast: [day("2026-10-01", 10, 20), day("2026-10-02", 10, 20), day("2026-10-03", 10, 20, 90)],
      crops: [potato],
      plantings: [],
      calendars: [],
      harvestTasks: [{ id: "t", planting_id: "p", crop_id: "k", calculated_date: "2026-10-03", adjusted_date: null, status: "pending" }],
    });
    expect(out.taskRecommendations).toEqual([
      { id: "t", recommendation: { action: "earlier", date: "2026-10-02", rainDates: ["2026-10-03"] } },
    ]);
    expect(out.weekly[0].label).toBe("수확 앞당기기 권장 10/2 (비 예보)");
  });
});
