import { describe, expect, it } from "vitest";
import { badgesByPlanting, taskBadge, type Badge, type BadgeTask } from "./badges";
import { consecutiveRainStart, preventionTasks, type PreventionSchedule } from "./prevention";

const task = (over: Partial<BadgeTask>): BadgeTask => ({
  id: "t",
  planting_id: "p1",
  plan_crop_id: "pc",
  task_type: "top_dressing",
  title: "배추 1차 추비",
  calculated_date: "2026-10-10",
  adjusted_date: null,
  details: { reason: "정식 후 20일, 1차 추비 시기" },
  source_url: null,
  ...over,
});

describe("badges", () => {
  const lead = new Map([["harvest", 3]]);

  it("shows from due - lead days, overdue after due", () => {
    expect(taskBadge(task({}), "2026-10-04", lead)).toBeNull(); // 6일 전
    expect(taskBadge(task({}), "2026-10-05", lead)?.state).toBe("upcoming"); // 5일 전
    expect(taskBadge(task({}), "2026-10-11", lead)?.state).toBe("overdue");
    // 작업 종류별 표시 시작 일수
    expect(taskBadge(task({ task_type: "harvest" }), "2026-10-06", lead)).toBeNull();
    expect(taskBadge(task({ task_type: "harvest" }), "2026-10-07", lead)?.kind).toBe("harvest");
    // 조정일 기준
    expect(taskBadge(task({ adjusted_date: "2026-10-20" }), "2026-10-11", lead)).toBeNull();
  });

  it("date tasks on their planting, crop badges on all areas, sorted by priority", () => {
    const weather: Badge = { id: "w", kind: "weather", state: "weather", title: "폭염경보", date: null };
    const water: Badge = { id: "water", kind: "watering", state: "upcoming", title: "물주기", date: "2026-10-11" };
    const map = badgesByPlanting({
      today: "2026-10-11",
      plantings: [
        { plantingId: "p1", planCropId: "pc" },
        { plantingId: "p2", planCropId: "pc" },
      ],
      tasks: [task({ planting_id: "p1" }), task({ id: "t2", planting_id: "p2", calculated_date: "2026-10-12", title: "2회차 추비" })],
      leadDays: lead,
      cropBadges: [{ planCropId: "pc", badge: water }],
      weather: [weather],
    });
    expect(map.get("p1")!.map((b) => `${b.kind}:${b.state}`)).toEqual(["weather:weather", "top_dressing:overdue", "watering:upcoming"]);
    expect(map.get("p2")!.map((b) => b.title)).toEqual(["폭염경보", "물주기", "2회차 추비"]);
  });
});

describe("prevention tasks", () => {
  const sched = (over: Partial<PreventionSchedule>): PreventionSchedule => ({
    id: "s",
    crop_id: "c",
    pest_name: "탄저병",
    basis: "calendar_by_region",
    days_after_planting: null,
    region: "전국",
    start_month: 6,
    start_day: 15,
    end_month: 6,
    end_day: 30,
    weather_condition: null,
    recommended_ingredients: ["성분A"],
    source_text: "장마 전 예방",
    source_url: "u",
    ...over,
  });
  const planting = { id: "p", plan_crop_id: "pc", crop_id: "c", crop_name: "고추", plantedOn: "2026-05-01" };
  const rain = { popThreshold: 60, mmThreshold: null };
  const day = (date: string, pop: number) => ({ date, minC: 20, maxC: 28, pop, pcpMm: 0 });

  it("three bases: days after planting, regional calendar, consecutive rain", () => {
    const tasks = preventionTasks({
      today: "2026-06-10",
      region: "중부",
      plantings: [planting],
      schedules: [
        sched({ id: "a", basis: "days_after_planting", days_after_planting: 30, pest_name: "진딧물" }),
        sched({ id: "b" }),
        sched({ id: "c", basis: "weather", weather_condition: "연속 강우", region: null, start_month: null, end_month: null }),
      ],
      forecast: [day("2026-06-10", 20), day("2026-06-11", 80), day("2026-06-12", 90)],
      rain,
    });
    expect(tasks.map((t) => [t.title, t.calculated_date])).toEqual([
      ["고추 진딧물 예방 방제", "2026-05-31"],
      ["고추 탄저병 예방 방제", "2026-06-10"],
      ["고추 탄저병 예방 방제", "2026-06-15"],
    ]);
    expect(tasks[1].details.reason).toContain("2026-06-11부터 비");
  });

  it("regional calendar preferred over nationwide", () => {
    const tasks = preventionTasks({
      today: "2026-06-01",
      region: "남부",
      plantings: [planting],
      schedules: [sched({ id: "n" }), sched({ id: "s2", region: "남부", start_month: 6, start_day: 1 })],
      forecast: [],
      rain,
    });
    expect(tasks.map((t) => t.calculated_date)).toEqual(["2026-06-01"]);
  });

  it("consecutive rain needs two rain days in a row", () => {
    expect(consecutiveRainStart([day("2026-06-10", 80), day("2026-06-11", 10), day("2026-06-12", 80)], rain, "2026-06-10")).toBeNull();
  });
});
