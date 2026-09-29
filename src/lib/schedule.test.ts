import { describe, expect, it } from "vitest";
import { addDays, diffDays, inMonthDayRange } from "./dates";
import { exceedsTolerance, generateTasks, pruningDays, splitStaggered, type ScheduleInput } from "./schedule";

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  farmId: "f",
  plantingId: "p",
  planCropId: "pc",
  plantedOn: "2026-09-01",
  method: "transplant",
  areaM2: 3.3058,
  crop: {
    name: "배추",
    days_to_harvest: 70,
    pruning_required: false,
    pruning_method: null,
    pruning_timing: null,
    source_url: "https://nongsaro",
  },
  daysToHarvest: 70,
  fertilizers: [
    { stage: "base", sequence: 1, days_after_planting: null, n_kg_per_10a: 20, p_kg_per_10a: 10, k_kg_per_10a: 12, compost_kg_per_10a: 1000, lime_kg_per_10a: 100, source_url: "s" },
    { stage: "top_dressing", sequence: 1, days_after_planting: 15, n_kg_per_10a: 3.5, p_kg_per_10a: 0, k_kg_per_10a: 2, compost_kg_per_10a: null, lime_kg_per_10a: null, source_url: "s" },
    { stage: "top_dressing", sequence: 2, days_after_planting: null, n_kg_per_10a: 4, p_kg_per_10a: 0, k_kg_per_10a: 2, compost_kg_per_10a: null, lime_kg_per_10a: null, source_url: "s" },
  ],
  rotation: null,
  ...over,
});

describe("dates", () => {
  it("adds and diffs days across months", () => {
    expect(addDays("2026-09-25", 10)).toBe("2026-10-05");
    expect(diffDays("2026-10-05", "2026-09-25")).toBe(10);
  });
  it("month-day ranges including year wrap", () => {
    const autumnSow = { start_month: 8, start_day: 11, end_month: 9, end_day: 10 };
    expect(inMonthDayRange("2026-08-20", autumnSow)).toBe(true);
    expect(inMonthDayRange("2026-09-20", autumnSow)).toBe(false);
    const harvest = { start_month: 9, start_day: 11, end_month: 4, end_day: 30 };
    expect(inMonthDayRange("2027-01-15", harvest)).toBe(true);
    expect(inMonthDayRange("2027-06-01", harvest)).toBe(false);
  });
});

describe("generateTasks", () => {
  it("creates field prep, dated top dressing and harvest", () => {
    const tasks = generateTasks(input());
    expect(tasks.map((t) => [t.task_type, t.calculated_date])).toEqual([
      ["field_prep", "2026-09-01"],
      ["top_dressing", "2026-09-16"],
      ["harvest", "2026-11-10"],
    ]);
    // 날짜 없는 2차 추비는 만들지 않는다
    expect(tasks.filter((t) => t.task_type === "top_dressing")).toHaveLength(1);
    expect(tasks[1].details.reason).toBe("정식 후 15일, 1차 추비 시기");
  });

  it("field prep includes base fertilizer per 평 and area total", () => {
    const prep = generateTasks(input({ areaM2: 3.3058 * 2 }))[0];
    const fert = prep.details.fertilizer as { perPyeong: { compost: number; lime: number }; total: { compost: number } };
    expect(fert.perPyeong.compost).toBe(3300); // 1000kg/10a × 3.3
    expect(fert.perPyeong.lime).toBe(330);
    expect(fert.total.compost).toBeCloseTo(6600);
  });

  it("adds rotation prevention checklist when flagged", () => {
    const prep = generateTasks(
      input({ rotation: { familyName: "십자화과", soilTreatmentIngredients: ["성분A"], limePhGuide: "석회 시용", drainageGuide: null } }),
    )[0];
    const rot = prep.details.rotation as { checklist: string[]; note: string };
    expect(rot.checklist).toEqual(["토양 처리 약제 성분: 성분A", "석회·산도: 석회 시용"]);
    expect(rot.note).toContain("줄입니다");
    expect(rot.note).not.toContain("방지");
  });

  it("uses variety days to harvest and skips harvest when unknown", () => {
    expect(generateTasks(input({ daysToHarvest: 55 })).at(-1)?.calculated_date).toBe("2026-10-26");
    expect(generateTasks(input({ daysToHarvest: null })).some((t) => t.task_type === "harvest")).toBe(false);
  });

  it("pruning only when timing has days", () => {
    expect(pruningDays("정식 후 20~25일 곁순 제거")).toBe(20);
    expect(pruningDays("1차 분지 아래 곁순")).toBeNull();
    const tasks = generateTasks(
      input({ crop: { ...input().crop, pruning_required: true, pruning_timing: "심은 후 10일", pruning_method: "곁순 제거" } }),
    );
    expect(tasks.find((t) => t.task_type === "pruning")?.calculated_date).toBe("2026-09-11");
  });
});

describe("schedule helpers", () => {
  it("tolerance warning", () => {
    expect(exceedsTolerance("2026-09-10", "2026-09-13", 3)).toBe(false);
    expect(exceedsTolerance("2026-09-10", "2026-09-14", 3)).toBe(true);
    expect(exceedsTolerance("2026-09-10", "2026-12-01", null)).toBe(false);
  });

  it("splits cells evenly with dates", () => {
    const parts = splitStaggered([1, 2, 3, 4, 5, 6, 7], 3, "2026-04-01", 14);
    expect(parts.map((p) => [p.cells.length, p.date])).toEqual([
      [3, "2026-04-01"],
      [2, "2026-04-15"],
      [2, "2026-04-29"],
    ]);
  });
});
