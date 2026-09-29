import { describe, expect, it } from "vitest";
import { buildSeasonSummary, referenceLine } from "./build";

describe("season summary", () => {
  const summary = buildSeasonSummary({
    cropName: "고추",
    isCompanion: false,
    plantings: [
      { sow_date: null, transplant_date: "2026-05-20", method: "transplant", variety: "청양고추", status: "ended" },
      { sow_date: null, transplant_date: "2026-05-08", method: "transplant", variety: "오이고추", status: "ended" },
    ],
    logs: [
      { work_date: "2026-06-01", work_type: "top_dressing", memo: null, rain_mm: null, is_auto: false, ingredients: [] },
      { work_date: "2026-07-20", work_type: "pest_control", memo: "탄저병 방제", rain_mm: null, is_auto: false, ingredients: ["성분A"] },
      { work_date: "2026-08-01", work_type: "pest_control", memo: null, rain_mm: null, is_auto: false, ingredients: ["성분A", "성분B"] },
      { work_date: "2026-07-10", work_type: "rain", memo: "관측소 강수량 자동 기록", rain_mm: 25.5, is_auto: true, ingredients: [] },
      { work_date: "2026-07-11", work_type: "rain", memo: null, rain_mm: 12, is_auto: true, ingredients: [] },
      { work_date: "2026-07-01", work_type: "watering", memo: "진딧물 조금 보임", rain_mm: null, is_auto: false, ingredients: [] },
      { work_date: "2026-08-20", work_type: "harvest", memo: "많이 땄다", rain_mm: null, is_auto: false, ingredients: [] },
    ],
    doneTasks: [
      { task_type: "top_dressing", title: "고추 1차 추비", calculated_date: "2026-05-28", adjusted_date: null, done_date: "2026-06-01" },
      { task_type: "harvest", title: "고추 수확 예정", calculated_date: "2026-08-15", adjusted_date: "2026-08-20", done_date: null },
    ],
  });

  it("plantings by round with variety and method", () => {
    expect(summary.plantings.map((p) => [p.round, p.date, p.method, p.variety])).toEqual([
      [1, "2026-05-08", "정식", "오이고추"],
      [2, "2026-05-20", "정식", "청양고추"],
    ]);
  });

  it("history counts, ingredients, rain totals, planned vs actual, no yield", () => {
    expect(summary.topDressing).toEqual({ count: 1, dates: ["2026-06-01"] });
    expect(summary.pestControl).toEqual({ count: 2, dates: ["2026-07-20", "2026-08-01"], ingredients: ["성분A", "성분B"] });
    expect(summary.pestNotes).toEqual([
      { date: "2026-07-01", memo: "진딧물 조금 보임" },
      { date: "2026-07-20", memo: "탄저병 방제" },
    ]);
    expect(summary.rain).toEqual({ count: 2, totalMm: 37.5 });
    expect(summary.plannedVsActual).toEqual([{ title: "고추 1차 추비", planned: "2026-05-28", actual: "2026-06-01", diffDays: 4 }]);
    expect(JSON.stringify(summary)).not.toMatch(/yield|수확량|많이 땄다/);
  });

  it("reference line for next year", () => {
    expect(referenceLine(summary)).toBe("고추 5/8 정식 외 1회, 7/1 진딧물 조금 보임, 7/20 탄저병 방제, 추비 1회");
  });
});
